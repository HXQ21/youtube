// ElevenLabs adapter (runs locally in Node, never inside the render browser).
// API facts checked against the official docs on 2026-11-16:
//   POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=...   body {text, model_id, voice_settings, previous_text, next_text, ...}
//   -> { audio_base64, alignment, normalized_alignment } with characters / character_start_times_seconds / character_end_times_seconds
//   GET /v2/voices (search, category, page_size, next_page_token), GET /v1/user/subscription, response headers character-cost / request-id.
// The docs' error page was not readable (403), so error classification below relies on HTTP status first and on
// `detail.status` strings only as a hint.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ConfigError, sha, ttsText, writeJson, readJson } from "./config.mjs";
import { tokens } from "./timeline.mjs";

export const API = "https://api.elevenlabs.io";
/** per-request text limits from the models page (characters); unknown models fall back to the most conservative */
export const MODEL_LIMITS = { eleven_v4: 10000, eleven_v3: 5000, eleven_multilingual_v2: 10000, eleven_flash_v2_5: 40000, eleven_turbo_v2_5: 40000, eleven_flash_v2: 30000 };
export const modelLimit = (id) => MODEL_LIMITS[id] ?? 5000;

export class ElevenError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}
/** auth | quota | rate_limit | voice | validation | server | network | unknown */
export const classifyError = (status, body) => {
  const d = body && typeof body === "object" ? body.detail : null;
  const tag = (d && typeof d === "object" && !Array.isArray(d) ? d.status ?? d.code ?? "" : "").toString().toLowerCase();
  const msg = d ? (typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : d.message ?? JSON.stringify(d)) : "";
  if (tag.includes("quota") || status === 402) return { kind: "quota", msg };
  if (status === 429 || tag.includes("too_many") || tag.includes("rate_limit") || tag.includes("system_busy")) return { kind: "rate_limit", msg };
  if (status === 401 || status === 403 || tag.includes("api_key") || tag.includes("unauthorized")) return { kind: "auth", msg };
  if (status === 404 || tag.includes("voice_not_found")) return { kind: "voice", msg };
  if (status === 400 || status === 422) return { kind: "validation", msg };
  if (status >= 500) return { kind: "server", msg };
  return { kind: "unknown", msg };
};
const HELP = {
  auth: "Khóa bị từ chối. Kiểm tra biến ELEVENLABS_API_KEY trên máy (không dán khóa vào chat).",
  quota: "Tài khoản hết hạn mức ký tự. Chờ kỳ reset, nâng gói, hoặc giảm độ dài.",
  rate_limit: "Bị giới hạn tốc độ. Thử lại sau ít phút.",
  voice: "Không truy cập được Voice ID này. Chạy lệnh voices để xem giọng dùng được.",
  validation: "Yêu cầu không hợp lệ (model, định dạng hoặc tham số).",
  server: "Lỗi phía ElevenLabs.", network: "Lỗi mạng: không rõ yêu cầu đã được xử lý hay chưa.", unknown: "Lỗi chưa phân loại.",
};

export const getKey = (env = process.env) => {
  const k = env.ELEVENLABS_API_KEY;
  if (!k) throw new ElevenError("auth", "Chưa có ELEVENLABS_API_KEY. Trên Windows: chạy `setx ELEVENLABS_API_KEY \"<khóa>\"` rồi mở terminal mới. Khóa không được ghi vào file dự án.");
  return k;
};

/** one HTTP call; never logs the key. `fetchImpl` is injectable for tests. */
export const call = async ({ method = "GET", url, key, body, fetchImpl = fetch, timeoutMs = 300000 }) => {
  let res;
  try {
    res = await fetchImpl(url, { method, headers: { "xi-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new ElevenError("network", `${HELP.network} (${e.name}: ${e.message})`); }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) { const c = classifyError(res.status, json); throw new ElevenError(c.kind, `${HELP[c.kind]} [HTTP ${res.status}${c.msg ? `: ${String(c.msg).slice(0, 300)}` : ""}]`, { status: res.status }); }
  return { json, headers: { characterCost: res.headers.get("character-cost"), requestId: res.headers.get("request-id") } };
};

// ---------------------------------------------------------------- planning (pure, no network)
/** Split the script into API requests at segment boundaries, preferring chapter boundaries, never inside a sentence.
 *  Each chunk: { index, segmentIds, parts:[{id, text, offset}], text, chars, previousText, nextText }. */
export const planChunks = (episode, script, maxChars = episode.voice.chunkMaxChars) => {
  const limit = Math.min(maxChars, modelLimit(episode.voice.modelId));
  const segs = script.segments.map((s) => ({ id: s.id, chapter: s.chapter, text: ttsText(episode, s).replace(/\s+/g, " ").trim() }));
  for (const s of segs) if (s.text.length > limit) throw new ConfigError(`Đoạn ${s.id} dài ${s.text.length} ký tự, vượt giới hạn ${limit} của một yêu cầu. Tách đoạn này thành các câu ngắn hơn trong script.json.`);
  const total = segs.reduce((n, s) => n + s.text.length, 0) + Math.max(0, segs.length - 1);
  const groups = [];
  if (total <= limit) groups.push(segs);
  else {
    // chapters first; a chapter longer than the limit is cut between segments
    let cur = [];
    const size = (a) => a.reduce((n, s) => n + s.text.length + 1, 0);
    const flush = () => { if (cur.length) groups.push(cur); cur = []; };
    for (const s of segs) {
      const newChapter = cur.length && cur[cur.length - 1].chapter !== s.chapter;
      if (newChapter || size(cur) + s.text.length > limit) flush();
      cur.push(s);
    }
    flush();
  }
  return groups.map((g, index) => {
    let text = "";
    const parts = g.map((s) => { if (text) text += " "; const offset = text.length; text += s.text; return { id: s.id, text: s.text, offset }; });
    return { index, segmentIds: g.map((s) => s.id), parts, text, chars: text.length };
  }).map((c, i, all) => ({ ...c, previousText: i ? all[i - 1].text.slice(-300) : null, nextText: i + 1 < all.length ? all[i + 1].text.slice(0, 300) : null }));
};
/** cache identity of one request: everything that changes the audio */
export const chunkKey = (episode, chunk) => sha({ text: chunk.text, prev: chunk.previousText, next: chunk.nextText, voice: episode.voice.voiceId, model: episode.voice.modelId, settings: episode.voice.settings, format: episode.voice.outputFormat, pron: episode.voice.pronunciations }).slice(0, 20);

// ---------------------------------------------------------------- alignment -> words
/** Character alignment -> words. Splits on whitespace characters, keeps punctuation attached to its word, and uses
 *  the real character times (never an even split). Returns [{text, startSec, endSec, charStart, charEnd}]. */
export const alignmentToWords = (al) => {
  const ch = al?.characters, st = al?.character_start_times_seconds, en = al?.character_end_times_seconds;
  if (!Array.isArray(ch) || !Array.isArray(st) || !Array.isArray(en) || ch.length !== st.length || ch.length !== en.length || !ch.length)
    throw new ElevenError("validation", "Alignment thiếu hoặc lệch độ dài: không có mốc thời gian dùng được.");
  const words = [];
  let cur = null;
  ch.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) { words.push(cur); cur = null; } return; }
    if (!cur) cur = { text: "", startSec: st[i], endSec: en[i], charStart: i, charEnd: i + 1 };
    cur.text += c; cur.endSec = Math.max(cur.endSec, en[i]); cur.charEnd = i + 1;
  });
  if (cur) words.push(cur);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!(w.endSec >= w.startSec) || (i && w.startSec < words[i - 1].startSec - 1e-6)) throw new ElevenError("validation", `Mốc thời gian không đơn điệu ở từ "${w.text}".`);
  }
  return words;
};

/** Map the words of one chunk back to script segments by character offset (alignment characters == request text).
 *  If the returned characters differ from the request (the service normalised the text), fall back to counting
 *  whitespace-separated tokens per segment, and fail loudly when even the token counts disagree. */
export const mapWordsToSegments = (chunk, alignment) => {
  const words = alignmentToWords(alignment), joined = alignment.characters.join("");
  const out = [];
  if (joined === chunk.text) {
    for (const w of words) {
      let seg = chunk.parts[0];
      for (const p of chunk.parts) if (w.charStart >= p.offset) seg = p;
      out.push({ text: w.text, startSec: w.startSec, endSec: w.endSec, segment: seg.id });
    }
    return { words: out, method: "char-offset" };
  }
  const counts = chunk.parts.map((p) => tokens(p.text).length), totalTok = counts.reduce((a, b) => a + b, 0);
  if (totalTok !== words.length) throw new ElevenError("validation", `Không ghép được mốc thời gian với lời dẫn: yêu cầu có ${totalTok} từ, alignment trả ${words.length} từ. Dùng forced alignment hoặc kiểm tra văn bản.`);
  let k = 0;
  chunk.parts.forEach((p, pi) => { for (let j = 0; j < counts[pi]; j++, k++) out.push({ text: words[k].text, startSec: words[k].startSec, endSec: words[k].endSec, segment: p.id }); });
  return { words: out, method: "token-count" };
};

// ---------------------------------------------------------------- audio helpers (ffmpeg / ffprobe)
export const probeDuration = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).trim());
const toWav = (src, dst) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", dst]);
const EXT = (fmt) => (fmt.startsWith("mp3") ? "mp3" : fmt.startsWith("opus") ? "opus" : fmt.startsWith("wav") ? "wav" : fmt.startsWith("pcm") ? "pcm" : "bin");

// ---------------------------------------------------------------- synthesis with cache + ledger
/** Generate (or reuse) every chunk, decode to 48 kHz WAV, concatenate with the configured gap and write
 *  voice.wav + transcript.json. Options: { dryRun, force, allowOverBudget, fetchImpl, key, log }. */
export const synthesize = async (ep, opt = {}) => {
  const { episode, script, p } = ep, log = opt.log ?? console.log, v = episode.voice;
  const chunks = planChunks(episode, script), cacheDir = path.join(p.voiceDir, "cache"), ledgerFile = path.join(p.voiceDir, "ledger.json");
  const ledger = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : { requests: [], runs: 0 };
  const plan = chunks.map((c) => { const key = chunkKey(episode, c); const done = fs.existsSync(path.join(cacheDir, `${key}.json`)) && !opt.force; return { ...c, key, cached: done }; });
  const todo = plan.filter((c) => !c.cached), chars = todo.reduce((n, c) => n + c.chars, 0), totalChars = plan.reduce((n, c) => n + c.chars, 0);
  const spent = ledger.requests.filter((r) => r.status === "complete").reduce((n, r) => n + r.chars, 0);
  const summary = { format: ep.format, voiceId: v.voiceId, modelId: v.modelId, outputFormat: v.outputFormat, settings: v.settings, segments: script.segments.length, chunks: plan.length,
    totalChars, cachedChunks: plan.length - todo.length, charsToSend: chars, alreadySpentChars: spent, budget: v.budget, chunkList: plan.map((c) => ({ index: c.index, chars: c.chars, segments: `${c.segmentIds[0]}..${c.segmentIds[c.segmentIds.length - 1]}`, cached: c.cached })) };
  if (opt.dryRun) return { dryRun: true, summary };
  if (!v.voiceId) throw new ConfigError("episode.json chưa có voice.voiceId. Chạy `voices` để xem giọng dùng được rồi ghi ID vào (không đoán ID theo tên).");
  if (chars && spent + chars > v.budget.maxTotalChars && !opt.allowOverBudget)
    throw new ConfigError(`Vượt ngân sách ký tự: đã dùng ${spent}, sắp gửi ${chars}, giới hạn ${v.budget.maxTotalChars} (episode.json voice.budget). Thêm --allow-over-budget nếu bạn đồng ý.`);
  if (opt.force && ledger.runs > v.budget.maxRegenerations && !opt.allowOverBudget)
    throw new ConfigError(`Đã tạo lại ${ledger.runs} lần, giới hạn ${v.budget.maxRegenerations}. Thêm --allow-over-budget nếu bạn đồng ý.`);
  const pending = ledger.requests.filter((r) => r.status === "unknown" && todo.some((c) => c.key === r.key));
  if (pending.length && !opt.retryUnknown)
    throw new ConfigError(`Có ${pending.length} yêu cầu trước đó kết thúc bằng lỗi mạng, chưa rõ đã bị tính ký tự hay chưa. Kiểm tra lịch sử/usage trên ElevenLabs rồi chạy lại với --retry-unknown.`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = todo.length ? opt.key ?? getKey() : null;
  for (const c of todo) {
    const entry = { key: c.key, chunk: c.index, chars: c.chars, at: new Date().toISOString(), status: "sent" };
    ledger.requests.push(entry); writeJson(ledgerFile, ledger);
    const body = { text: c.text, model_id: v.modelId, ...(Object.keys(v.settings).length ? { voice_settings: v.settings } : {}), ...(c.previousText ? { previous_text: c.previousText } : {}), ...(c.nextText ? { next_text: c.nextText } : {}) };
    let r = null;
    for (let attempt = 1; ; attempt++) {
      try { r = await call({ method: "POST", url: `${API}/v1/text-to-speech/${encodeURIComponent(v.voiceId)}/with-timestamps?output_format=${encodeURIComponent(v.outputFormat)}`, key, body, fetchImpl: opt.fetchImpl }); break; }
      catch (e) {
        // rate limits were rejected before processing: safe to retry a few times. Network errors are ambiguous: stop.
        if (e.kind === "rate_limit" && attempt < 4) { const wait = 5000 * attempt * (opt.backoffScale ?? 1); log(`  giới hạn tốc độ, chờ ${wait / 1000}s rồi thử lại (${attempt}/3)`); await new Promise((res) => setTimeout(res, wait)); continue; }
        entry.status = e.kind === "network" ? "unknown" : "failed"; entry.error = e.kind; writeJson(ledgerFile, ledger);
        throw e;
      }
    }
    if (!r.json?.audio_base64) { entry.status = "failed"; entry.error = "no_audio"; writeJson(ledgerFile, ledger); throw new ElevenError("validation", "Phản hồi không có audio_base64."); }
    const alignment = r.json.alignment ?? r.json.normalized_alignment;
    const audioFile = path.join(cacheDir, `${c.key}.${EXT(v.outputFormat)}`);
    fs.writeFileSync(audioFile, Buffer.from(r.json.audio_base64, "base64"));
    writeJson(path.join(cacheDir, `${c.key}.json`), { key: c.key, text: c.text, parts: c.parts, alignment: r.json.alignment ?? null, normalized_alignment: r.json.normalized_alignment ?? null, usedAlignment: r.json.alignment ? "alignment" : "normalized_alignment",
      characterCost: r.headers.characterCost, requestId: r.headers.requestId, audio: path.basename(audioFile), createdAt: entry.at });
    entry.status = "complete"; entry.characterCost = r.headers.characterCost; entry.requestId = r.headers.requestId; writeJson(ledgerFile, ledger);
    if (!alignment) throw new ElevenError("validation", "API không trả alignment. Cần forced alignment (xem README) trước khi dựng timeline.");
    log(`  đoạn ${c.index + 1}/${plan.length}: ${c.chars} ký tự, character-cost ${r.headers.characterCost ?? "?"}`);
  }
  if (todo.length) { ledger.runs += 1; writeJson(ledgerFile, ledger); }
  return { ...assemble(ep, plan, cacheDir), summary };
};

/** decode cached chunks, concatenate with gaps, shift word times by the real decoded durations */
export const assemble = (ep, plan, cacheDir) => {
  const { episode, config, p } = ep, gap = episode.voice.chunkGapSec, lead = config.leadInSec;
  const wavs = [], words = [], methods = [];
  let t = lead;
  for (const c of plan) {
    const meta = readJson(path.join(cacheDir, `${c.key}.json`)), wav = path.join(cacheDir, `${c.key}.wav`);
    if (!fs.existsSync(wav)) toWav(path.join(cacheDir, meta.audio), wav);
    const dur = probeDuration(wav), al = meta.alignment ?? meta.normalized_alignment;
    const m = mapWordsToSegments(c, al); methods.push(m.method);
    const lastEnd = m.words[m.words.length - 1].endSec;
    if (lastEnd > dur + 0.25) throw new ElevenError("validation", `Đoạn ${c.index + 1}: mốc cuối ${lastEnd.toFixed(2)}s vượt độ dài audio ${dur.toFixed(2)}s.`);
    for (const w of m.words) words.push({ text: w.text, startSec: +(w.startSec + t).toFixed(3), endSec: +(w.endSec + t).toFixed(3), segment: w.segment });
    wavs.push({ wav, offsetSec: +t.toFixed(3), durationSec: dur });
    t += dur + gap;
  }
  const total = t - gap;
  // build voice.wav: lead-in silence + chunks separated by silence (adelay keeps every chunk at its exact offset)
  const args = ["-y", "-loglevel", "error"];
  for (const w of wavs) args.push("-i", w.wav);
  const fc = wavs.map((w, i) => `[${i}:a]adelay=${Math.round(w.offsetSec * 1000)}:all=1[a${i}]`).join(";") + ";" + wavs.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${wavs.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(3)}[o]`;
  args.push("-filter_complex", fc, "-map", "[o]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", p.voiceWav);
  execFileSync("ffmpeg", args);
  const durationSec = probeDuration(p.voiceWav);
  const segments = ep.script.segments.map((s) => { const ws = words.filter((w) => w.segment === s.id); if (!ws.length) throw new ElevenError("validation", `Không có từ nào cho đoạn ${s.id} trong alignment.`); return { id: s.id, startSec: ws[0].startSec, endSec: ws[ws.length - 1].endSec }; });
  const transcript = { source: "elevenlabs", timing: "aligned", voiceId: episode.voice.voiceId, modelId: episode.voice.modelId, audio: { file: "voice.wav", durationSec: +durationSec.toFixed(3), sampleRate: 48000 },
    chunks: wavs.map((w, i) => ({ index: i, key: plan[i].key, offsetSec: w.offsetSec, durationSec: +w.durationSec.toFixed(3), mapping: methods[i] })), words, segments };
  writeJson(p.transcript, transcript);
  return { transcript };
};

/** Import existing audio + word timings ([{text|word, startSec|start, endSec|end}]) instead of calling the API. */
export const importVoice = (ep, audioFile, wordsFile) => {
  const raw = readJson(wordsFile), list = Array.isArray(raw) ? raw : raw.words;
  if (!Array.isArray(list) || !list.length) throw new ConfigError("File mốc thời gian phải là mảng các từ {text|word, start|startSec, end|endSec}.");
  const ws = list.map((w) => ({ text: String(w.text ?? w.word ?? ""), startSec: Number(w.startSec ?? w.start), endSec: Number(w.endSec ?? w.end) })).filter((w) => w.text.trim());
  if (ws.some((w) => !Number.isFinite(w.startSec) || !Number.isFinite(w.endSec))) throw new ConfigError("Có từ thiếu mốc start/end hợp lệ.");
  const counts = ep.script.segments.map((s) => tokens(s.text).length), total = counts.reduce((a, b) => a + b, 0);
  if (total !== ws.length) throw new ConfigError(`Kịch bản có ${total} từ nhưng file mốc có ${ws.length} từ: không ghép được. Dùng forced alignment với đúng transcript.`);
  fs.mkdirSync(ep.p.voiceDir, { recursive: true });
  toWav(audioFile, ep.p.voiceWav);
  let k = 0;
  const words = [], segments = [];
  ep.script.segments.forEach((s, i) => { const a = k; for (let j = 0; j < counts[i]; j++, k++) words.push({ ...ws[k], segment: s.id }); segments.push({ id: s.id, startSec: ws[a].startSec, endSec: ws[k - 1].endSec }); });
  const transcript = { source: "import", timing: "aligned", audio: { file: "voice.wav", durationSec: +probeDuration(ep.p.voiceWav).toFixed(3), sampleRate: 48000 }, words, segments };
  writeJson(ep.p.transcript, transcript);
  return transcript;
};

// ---------------------------------------------------------------- voices / account
export const listVoices = async ({ key = getKey(), fetchImpl } = {}) => {
  const all = [];
  let token = null;
  for (let page = 0; page < 10; page++) {
    const u = new URL(`${API}/v2/voices`); u.searchParams.set("page_size", "100"); if (token) u.searchParams.set("next_page_token", token);
    const { json } = await call({ url: u.toString(), key, fetchImpl });
    all.push(...(json.voices ?? []));
    if (!json.has_more || !json.next_page_token) break;
    token = json.next_page_token;
  }
  return all;
};
/** rank voices for "female, American English, warm, lively narration" from their own labels/description (no guessing by name) */
export const rankVoices = (voices, modelId) => voices.map((v) => {
  const L = Object.fromEntries(Object.entries(v.labels ?? {}).map(([k, x]) => [k.toLowerCase(), String(x).toLowerCase()]));
  const text = `${Object.values(L).join(" ")} ${(v.description ?? "").toLowerCase()}`;
  const female = L.gender === "female", american = (L.accent ?? "").includes("american") || (v.verified_languages ?? []).some((x) => x.language === "en" && /american|us/i.test(`${x.accent ?? ""} ${x.locale ?? ""}`));
  let score = 0;
  if (female) score += 5; if (american) score += 5;
  for (const [w, k] of [["warm", 3], ["narrat", 2], ["storytell", 2], ["engag", 2], ["lively", 2], ["friendly", 1], ["bright", 1], ["expressive", 1], ["documentary", 2], ["calm", 0.5], ["upbeat", 1]]) if (text.includes(w)) score += k;
  if ((v.high_quality_base_model_ids ?? []).includes(modelId)) score += 1;
  return { voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {}, description: v.description ?? "", female, american, score };
}).filter((v) => v.female && v.american).sort((a, b) => b.score - a.score);
export const subscription = async ({ key = getKey(), fetchImpl } = {}) => (await call({ url: `${API}/v1/user/subscription`, key, fetchImpl })).json;
