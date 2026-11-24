#!/usr/bin/env node
// Food-history video toolkit CLI.   node scripts/food.mjs <lệnh> --episode <slug> --format short|long [tùy chọn]
// Lệnh: doctor | validate | voices | tts | timeline | assets | studio | still | render | mix | mux | qa | new | pipeline | scriptcheck | monitor | texture
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import http from "node:http";
import { ROOT, PRESETS, QUALITY, ConfigError, loadEpisode, paths, outDir, readJson, writeJson, parseFile, AssetManifestSchema } from "./lib/config.mjs";
import { buildTimeline, checkTimeline, checkPace, estimateTranscript } from "./lib/timeline.mjs";
import { STAGES, STAGE_VI, NEXT_VI, readPipe, resolveSlug, updatePipe, readStatus, setStatus, outRel, scaffoldEpisode, checkScript } from "./lib/pipeline.mjs";
import { planTextures, saveNodes, quoteNodes, runNodes } from "./lib/dreamina.mjs";
import { ElevenError, synthesize, importVoice, listVoices, rankVoices, subscription, getKey, call, API, probeDuration } from "./lib/eleven.mjs";

// ---------------------------------------------------------------- args / env
const argv = process.argv.slice(2), cmd = argv[0];
const args = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) throw new ConfigError(`Tham số lạ: ${a}`);
  const [k, v] = a.slice(2).split("=");
  if (v !== undefined) args[k] = v; else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[k] = argv[++i]; else args[k] = true;
}
const onOff = (v, name) => { if (v === undefined) return undefined; if (["on", "true", true, "1"].includes(v)) return true; if (["off", "false", "0"].includes(v)) return false; throw new ConfigError(`--${name} nhận on|off`); };
const num = (v, name) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new ConfigError(`--${name} phải là số, nhận "${v}"`); return n; };
const cliRender = () => ({ targetDurationSec: num(args.duration, "duration"), aspectRatio: args.aspect, width: num(args.width, "width"), height: num(args.height, "height"), fps: num(args.fps, "fps"),
  captions: onOff(args.captions, "captions"), labels: onOff(args.labels, "labels") });

/** explicit config loading: process env first, then .env.local (git-ignored, never under public/), then (Windows) the user-level variable */
const loadEnv = () => {
  const f = path.join(ROOT, ".env.local");
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  if (process.platform === "win32") for (const k of ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "ELEVENLABS_OUTPUT_FORMAT", "REMOTION_TMP", "FOOD_CHROME"]) if (!process.env[k]) {
    try { const v = execFileSync("powershell", ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('${k}','User')`], { encoding: "utf8" }).trim(); if (v) process.env[k] = v; } catch { /* ignore */ }
  }
  if (process.platform === "win32" && !/ffmpeg/i.test(process.env.PATH ?? "")) { // PATH from a terminal opened before ffmpeg was installed
    try { const p = execFileSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8" }).trim(); process.env.PATH = `${process.env.PATH};${p}`; } catch { /* ignore */ }
  }
};
const applyVoiceEnv = (ep) => {
  const v = ep.episode.voice;
  if (process.env.ELEVENLABS_VOICE_ID) v.voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (process.env.ELEVENLABS_MODEL_ID) v.modelId = process.env.ELEVENLABS_MODEL_ID;
  if (process.env.ELEVENLABS_OUTPUT_FORMAT) v.outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT;
  return ep;
};
const findChrome = () => {
  const c = [process.env.FOOD_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return c.find((x) => x && fs.existsSync(x)) ?? null; // null -> Remotion uses its own headless shell
};
const tmpDir = () => { const d = process.env.REMOTION_TMP || path.join(ROOT, ".cache", "remotion-tmp"); fs.mkdirSync(d, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = d; return d; };
const need = (k) => { if (!args[k] || args[k] === true) throw new ConfigError(`Thiếu --${k}`); return args[k]; };
const slugFmt = () => { const format = args.format ?? "short"; if (!PRESETS[format]) throw new ConfigError(`--format nhận short | long (nhận được "${format}")`); return [resolveSlug(need("episode")), format]; };
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const tool = (bin, a = ["-version"]) => { try { return execFileSync(bin, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(/\r?\n/)[0]; } catch { return null; } };
const python = () => (tool("python", ["--version"]) ? "python" : tool("python3", ["--version"]) ? "python3" : null);
/** variant tag: CLI size overrides get their own timeline/output so the default files are never overwritten */
const variant = (ep) => { const base = loadEpisode(ep.slug, ep.format).render; return base.width === ep.render.width && base.height === ep.render.height ? "" : `.${ep.render.width}x${ep.render.height}`; };
const tlFile = (ep) => path.join(ep.p.fm, `timeline${variant(ep)}.json`);
const name = (ep, q) => `${ep.slug}-${ep.format}-${ep.render.width}x${ep.render.height}-${q}`;

// ---------------------------------------------------------------- assets
const scanAssets = (ep) => {
  const pub = path.join(ROOT, "public");
  return ep.manifest.assets.map((a) => {
    const dir = path.join(pub, a.targetDir), found = {};
    const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
    const ext = a.kind === "texture" ? /\.(png|jpe?g|webp)$/i : /\.(glb|gltf)$/i; // a texture asset holds images, a model asset GLB/glTF
    const files = walk(dir), models = files.filter((f) => ext.test(f));
    for (const key of Object.keys(a.files)) { // a key is a model base name; the file may sit in any sub-folder
      const explicit = a.files[key]; // an explicit mapping (logical name -> real file) wins; otherwise match the file base name
      if (explicit && fs.existsSync(path.join(pub, explicit))) { found[key] = explicit; continue; }
      const hit = models.find((f) => path.basename(f).replace(ext, "").toLowerCase() === key.toLowerCase());
      found[key] = hit ? path.relative(pub, hit).replace(/\\/g, "/") : null;
    }
    const missingKeys = Object.keys(found).filter((k) => !found[k]);
    const present = models.length > 0 && missingKeys.length === 0;
    return { ...a, files: found, modelCount: models.length, missingKeys, present, status: present ? (a.status === "validated" ? "validated" : "downloaded") : "missing" };
  });
};
const assetProblems = (ep, scanned) => {
  const used = new Set(ep.storyboard.shots.flatMap((s) => s.assets));
  return scanned.filter((a) => a.required && used.has(a.id) && !a.present).map((a) => ({ id: a.id, name: a.name, dir: rel(path.join(ROOT, "public", a.targetDir)), missingKeys: a.missingKeys, modelCount: a.modelCount }));
};

// ---------------------------------------------------------------- commands
const commands = {
  async doctor() {
    const rows = [["Node", process.version], ["npm package", readJson(path.join(ROOT, "package.json")).name]];
    for (const d of ["remotion", "@remotion/three", "@remotion/bundler", "@remotion/renderer", "three", "@react-three/fiber", "@react-three/postprocessing", "postprocessing", "zod"]) {
      const f = path.join(ROOT, "node_modules", d, "package.json"); rows.push([d, fs.existsSync(f) ? readJson(f).version : "THIẾU (chạy npm install)"]);
    }
    const py = python(); rows.push(["Python", py ? tool(py, ["--version"]) : "THIẾU"]);
    if (py) for (const m of ["numpy", "scipy", "PIL"]) { const r = spawnSync(py, ["-c", `import ${m};print(${m}.__version__)`], { encoding: "utf8" }); rows.push([`  ${m}`, r.status === 0 ? r.stdout.trim() : "THIẾU (pip install numpy scipy pillow)"]); }
    rows.push(["ffmpeg", tool("ffmpeg") ?? "THIẾU"], ["ffprobe", tool("ffprobe") ?? "THIẾU"], ["Chrome", findChrome() ?? "không thấy: Remotion sẽ tự tải headless shell (đặt FOOD_CHROME để chỉ định)"],
      ["Thư mục tạm", tmpDir()], ["ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY ? "đã đặt (không hiển thị)" : "CHƯA đặt"], ["ELEVENLABS_VOICE_ID", process.env.ELEVENLABS_VOICE_ID ? "đã đặt" : "chưa đặt (dùng voiceId trong episode.json)"]);
    const w = Math.max(...rows.map((r) => r[0].length));
    for (const [k, v] of rows) console.log(`${k.padEnd(w)}  ${v}`);
    const free = fs.statfsSync ? (() => { const s = fs.statfsSync(ROOT); return `${((s.bavail * s.bsize) / 2 ** 30).toFixed(0)} GB trống`; })() : "?";
    console.log(`${"Ổ đĩa dự án".padEnd(w)}  ${free}`);
    if (rows.some((r) => String(r[1]).startsWith("THIẾU"))) process.exitCode = 1;
  },

  async validate() {
    const [slug, format] = slugFmt(), ep = applyVoiceEnv(loadEpisode(slug, format, cliRender()));
    const r = ep.render;
    console.log(`Tập ${slug} / ${format}: ${r.width}x${r.height} (${r.aspectRatio}) ${r.fps} fps, mục tiêu ${r.targetDurationSec}s (cho phép ${r.minDurationSec}-${r.maxDurationSec}s), phụ đề ${r.captions ? "bật" : "tắt"}, nhãn ${r.labels ? "bật" : "tắt"}`);
    console.log(`Kịch bản: ${ep.script.segments.length} đoạn, ${ep.words} từ, ước lượng ${ep.estSec.toFixed(0)}s ở ${ep.config.estimateWpm} từ/phút. Storyboard: ${ep.storyboard.chapters.length} chương, ${ep.storyboard.shots.length} shot.`);
    const st = {}; for (const c of ep.sources.claims) st[c.status] = (st[c.status] ?? 0) + 1;
    console.log(`Nguồn: ${ep.sources.sources.length} nguồn, ${ep.sources.claims.length} claim (${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(", ")}).`);
    const uncited = ep.script.segments.filter((s) => !s.claims.length).map((s) => s.id);
    if (uncited.length) console.log(`Đoạn không gắn claim (chỉ được là câu dẫn/chuyển ý, không chứa dữ kiện lịch sử): ${uncited.join(", ")}`);
    const scanned = scanAssets(ep), miss = assetProblems(ep, scanned);
    for (const m of miss) ep.warnings.push(`Asset bắt buộc thiếu: ${m.id} (${m.name}) -> đặt vào ${m.dir} ${m.missingKeys.length ? `(thiếu model: ${m.missingKeys.join(", ")})` : ""}. Xem episodes/${slug}/DOWNLOAD_GUIDE.md`);
    const tf = tlFile(ep);
    if (fs.existsSync(tf)) {
      const tl = readJson(tf), errs = checkTimeline(tl);
      errs.forEach((e) => ep.errors.push(`timeline: ${e}`));
      const d = tl.durationSec;
      console.log(`Timeline: ${tl.totalFrames} frame = ${d.toFixed(1)}s, timing "${tl.timing}", lệch mục tiêu ${(d - r.targetDurationSec).toFixed(1)}s.`);
      if (tl.timing === "aligned" && (d < r.minDurationSec || d > r.maxDurationSec)) ep.errors.push(`Thời lượng thực ${d.toFixed(1)}s nằm ngoài khoảng ${r.minDurationSec}-${r.maxDurationSec}s. Chỉnh nội dung/nhịp kịch bản (không kéo dài bằng khoảng lặng).`);
      { const pc = checkPace(tl); pc.warnings.forEach((w) => ep.warnings.push(`nhịp cắt: ${w}`)); if (pc.untyped.length) ep.warnings.push(`nhịp cắt: ${pc.untyped.length} shot chưa ghi pace (${pc.untyped.slice(0, 8).join(", ")}${pc.untyped.length > 8 ? ", ..." : ""})`); }
      if (tl.fingerprint && tl.timing === "aligned") { const fresh = buildTimeline(ep, readJson(ep.p.transcript), miss.map((m) => m.id)); if (fresh.fingerprint !== tl.fingerprint) ep.warnings.push("timeline.json cũ hơn kịch bản/storyboard/cấu hình: chạy lại lệnh timeline"); }
    } else console.log("Timeline: chưa tạo (chạy lệnh timeline).");
    ep.warnings.forEach((w) => console.log(`CẢNH BÁO  ${w}`));
    ep.errors.forEach((e) => console.log(`LỖI       ${e}`));
    console.log(ep.errors.length ? `\nKHÔNG ĐẠT: ${ep.errors.length} lỗi.` : `\nĐẠT${ep.warnings.length ? ` (${ep.warnings.length} cảnh báo)` : ""}.`);
    if (ep.errors.length) process.exitCode = 1;
  },

  async voices() {
    const sub = await subscription();
    console.log(`Gói: ${sub.tier} (${sub.status}). Ký tự đã dùng ${sub.character_count}/${sub.character_limit} (còn ${sub.character_limit - sub.character_count}).`);
    const model = args.model ?? "eleven_multilingual_v2", ranked = rankVoices(await listVoices(), model);
    console.log(`Giọng nữ, American English mà tài khoản dùng được (xếp theo nhãn ấm/kể chuyện), ${ranked.length} giọng:`);
    for (const v of ranked.slice(0, Number(args.top ?? 12))) console.log(`  ${v.voice_id}  ${v.name}  [${v.category}]  ${Object.entries(v.labels).map(([k, x]) => `${k}=${x}`).join(", ")}  điểm ${v.score}`);
    if (!ranked.length) console.log("  (không có giọng nào khớp nhãn nữ + American: cần bạn chọn giọng trong thư viện ElevenLabs và đặt ELEVENLABS_VOICE_ID)");
    writeJson(path.join(ROOT, ".cache", "voices.json"), { fetchedAt: new Date().toISOString(), tier: sub.tier, remaining: sub.character_limit - sub.character_count, ranked });
  },

  async tts() {
    const [slug, format] = slugFmt(), ep = applyVoiceEnv(loadEpisode(slug, format));
    if (ep.errors.length) throw new ConfigError(`Tập chưa hợp lệ, chạy validate trước:\n  ${ep.errors.join("\n  ")}`);
    if (args.import) { const t = importVoice(ep, path.resolve(args.import), path.resolve(need("words"))); console.log(`Đã nhập audio + mốc thời gian: ${t.words.length} từ, ${t.audio.durationSec}s -> ${rel(ep.p.transcript)}`); return; }
    if (args.sample) {
      const text = typeof args.sample === "string" ? args.sample : ep.script.segments[0].text, v = ep.episode.voice;
      if (!v.voiceId) throw new ConfigError("Chưa có voiceId (episode.json hoặc ELEVENLABS_VOICE_ID).");
      if (args["dry-run"]) { console.log(`Mẫu giọng (dry-run): ${text.length} ký tự, voice ${v.voiceId}, model ${v.modelId}. Không gọi API.`); return; }
      const out = path.join(outDir(slug, format), "..", "voice-sample.mp3"); fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = await call({ method: "POST", url: `${API}/v1/text-to-speech/${v.voiceId}/with-timestamps?output_format=mp3_44100_128`, key: getKey(), body: { text, model_id: v.modelId, ...(Object.keys(v.settings).length ? { voice_settings: v.settings } : {}) } });
      fs.writeFileSync(out, Buffer.from(r.json.audio_base64, "base64"));
      console.log(`Mẫu giọng: ${rel(out)} (${probeDuration(out).toFixed(1)}s, ${text.length} ký tự, character-cost ${r.headers.characterCost ?? "?"}). Hãy nghe thử trước khi tạo toàn bài.`);
      return;
    }
    const r = await synthesize(ep, { dryRun: !!args["dry-run"], force: !!args.force, allowOverBudget: !!args["allow-over-budget"], retryUnknown: !!args["retry-unknown"] });
    const s = r.summary;
    console.log(`${s.format}: voice ${s.voiceId ?? "(chưa đặt)"}, model ${s.modelId}, ${s.outputFormat}, cài đặt ${JSON.stringify(s.settings)}`);
    console.log(`${s.segments} đoạn lời -> ${s.chunks} yêu cầu API, tổng ${s.totalChars} ký tự; đã có cache ${s.cachedChunks}; sẽ gửi ${s.charsToSend} ký tự. Đã dùng ${s.alreadySpentChars}/${s.budget.maxTotalChars} ký tự ngân sách.`);
    for (const c of s.chunkList) console.log(`  yêu cầu ${c.index + 1}: ${c.chars} ký tự, đoạn ${c.segments}${c.cached ? " (cache)" : ""}`);
    if (r.dryRun) { console.log("Dry-run: không gọi API, không tốn credit."); return; }
    const t = r.transcript;
    console.log(`Xong: ${rel(ep.p.voiceWav)} dài ${t.audio.durationSec}s, ${t.words.length} từ có mốc thời gian thật -> ${rel(ep.p.transcript)}`);
  },

  async timeline() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender());
    if (ep.errors.length) throw new ConfigError(`Tập chưa hợp lệ:\n  ${ep.errors.join("\n  ")}`);
    let tr;
    if (fs.existsSync(ep.p.transcript) && !args.estimate) tr = readJson(ep.p.transcript);
    else if (args.estimate) tr = estimateTranscript(ep.script, ep.config.estimateWpm, ep.config.leadInSec);
    else throw new ConfigError(`Chưa có giọng đọc (${rel(ep.p.transcript)}). Chạy lệnh tts, hoặc thêm --estimate để dựng timeline NHÁP cho blockout (không dùng được cho bản cuối).`);
    const scanned = scanAssets(ep), miss = assetProblems(ep, scanned);
    const tl = buildTimeline(ep, tr, miss.map((m) => m.id));
    tl.assets = Object.fromEntries(scanned.flatMap((a) => Object.entries(a.files).filter(([, f]) => f).map(([k, f]) => [`${a.id}/${k}`, f])));
    const errs = checkTimeline(tl); if (errs.length) throw new ConfigError(`Timeline lỗi:\n  ${errs.join("\n  ")}`);
    const tf = tlFile(ep); writeJson(tf, tl); writeJson(tf.replace(/\.json$/, ".props.json"), { timeline: tl });
    console.log(`${rel(tf)}: ${tl.totalFrames} frame (${tl.durationSec}s) ${tl.width}x${tl.height}@${tl.fps}, ${tl.shots.length} shot, ${tl.events.length} sự kiện, timing "${tl.timing}".`);
    console.log(`So với mục tiêu ${tl.target.targetDurationSec}s: lệch ${tl.target.deviationSec >= 0 ? "+" : ""}${tl.target.deviationSec}s (khoảng cho phép ${tl.target.minDurationSec}-${tl.target.maxDurationSec}s).`);
    { const pc = checkPace(tl), n = {}; for (const s of tl.shots) n[s.pace ?? "chưa ghi"] = (n[s.pace ?? "chưa ghi"] ?? 0) + 1;
      console.log(`Nhịp cắt: ${Object.entries(n).map(([k, v]) => `${k} ${v}`).join(", ")}; ${pc.warnings.length ? `${pc.warnings.length} shot lệch khung:` : "không shot nào lệch khung."}`); pc.warnings.forEach((w) => console.log(`  CẢNH BÁO ${w}`)); }
    for (const c of tl.chapters) console.log(`  chương ${c.id} "${c.title}": ${c.startSec.toFixed(1)}s -> ${c.endSec.toFixed(1)}s (${(c.endSec - c.startSec).toFixed(0)}s${c.targetSec ? `, dự kiến ${c.targetSec}s` : ""})`);
    for (const b of tl.adBreaks) console.log(`  gợi ý điểm nghỉ quảng cáo trước chương ${b.beforeChapter}: ${Math.floor(b.sec / 60)}:${String(Math.floor(b.sec % 60)).padStart(2, "0")} (khoảng lặng ${b.pauseSec}s)`);
    if (miss.length) console.log(`CHÚ Ý: ${miss.length} asset bắt buộc còn thiếu (${miss.map((m) => m.id).join(", ")}): preview sẽ gắn nhãn NHÁP, bản final bị chặn.`);
    writeJson(path.join(ep.p.fm, `chapters${variant(ep)}.json`), { note: "Mốc chương và gợi ý điểm nghỉ quảng cáo (tham khảo khi đặt mid-roll trong YouTube Studio; không tự bật quảng cáo).",
      youtubeChapters: tl.chapters.map((c, i) => `${Math.floor((i ? c.startSec : 0) / 60)}:${String(Math.floor((i ? c.startSec : 0) % 60)).padStart(2, "0")} ${c.title}`), chapters: tl.chapters, adBreaks: tl.adBreaks });
  },

  async assets() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format), scanned = scanAssets(ep);
    if (args["mark-validated"]) { const a = scanned.find((x) => x.id === args["mark-validated"]); if (!a) throw new ConfigError(`Không có asset "${args["mark-validated"]}"`); if (!a.present) throw new ConfigError(`Asset ${a.id} chưa đủ file, không thể đánh dấu validated`); a.status = "validated"; }
    const today = new Date().toISOString().slice(0, 10);
    const next = { assets: scanned.map(({ modelCount, missingKeys, present, ...a }) => ({ ...a, checkedOn: today })) };
    parseFile(AssetManifestSchema, ep.p.manifest); writeJson(ep.p.manifest, next);
    for (const a of scanned) console.log(`${a.status.padEnd(10)} ${a.required ? "bắt buộc" : "tùy chọn"}  ${a.id}  (${a.modelCount} model trong public/${a.targetDir})${a.missingKeys.length ? `  thiếu: ${a.missingKeys.join(", ")}` : ""}`);
    const miss = assetProblems(ep, scanned);
    console.log(miss.length ? `\nCòn thiếu ${miss.length} asset bắt buộc cho ${format}. Xem ${rel(path.join(ep.p.ep, "DOWNLOAD_GUIDE.md"))}` : `\nĐủ asset bắt buộc cho ${format}.`);
  },

  /** live preview in Remotion Studio, with the current mix as sound (scrub, step frames, hot reload on code changes) */
  async studio() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), tf = tlFile(ep);
    if (!fs.existsSync(tf)) throw new ConfigError(`Chưa có ${rel(tf)}. Chạy lệnh timeline trước.`);
    const tl = readJson(tf), mix = path.join(ep.p.audioDir, "mix.wav"), props = { timeline: tl, mode: "preview" };
    if (fs.existsSync(mix)) { // a small mp3 copy under public/_preview so the Studio player can play it
      const relAudio = `_preview/${slug}-${format}.mp3`, out = path.join(ROOT, "public", relAudio); fs.mkdirSync(path.dirname(out), { recursive: true });
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mix, "-c:a", "libmp3lame", "-b:a", "128k", out]); props.audio = relAudio;
    } else console.log("Chưa có mix.wav: Studio sẽ không có tiếng (chạy lệnh mix trước nếu muốn nghe).");
    const pf = tf.replace(/\.json$/, ".studio.props.json"); writeJson(pf, props);
    const port = String(args.port ?? 3123);
    console.log(`Remotion Studio: http://localhost:${port}  (composition FoodEpisode, ${tl.totalFrames} frame). Ctrl+C để dừng.`);
    // relative props path: the shell would split an absolute path that contains a space
    spawnSync("npx", ["remotion", "studio", `--props=${rel(pf)}`, `--port=${port}`, "--no-open"], { cwd: ROOT, stdio: "inherit", shell: true });
  },
  /** camera audit: every frame of every camera path measured against every 2D character (see src/core/direct.ts) */
  async camcheck() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), tf = args.timeline ? path.resolve(args.timeline) : tlFile(ep);
    if (!fs.existsSync(tf)) throw new ConfigError(`Chưa có ${rel(tf)}. Chạy lệnh timeline trước.`);
    const tl = readJson(tf); tmpDir();
    const { bundle } = await import("@remotion/bundler"), { renderStill, selectComposition } = await import("@remotion/renderer");
    const browserExecutable = findChrome() ?? undefined, chromiumOptions = { gl: args.gl ?? "angle" }, inputProps = { timeline: tl, audit: true, legacy: !!args.legacy };
    const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
    const composition = await selectComposition({ serveUrl, id: "FoodEpisode", inputProps, browserExecutable, chromiumOptions });
    const parts = []; let total = 0;
    const dir = path.join(outDir(slug, format), `camera-audit${args.tag ? `-${args.tag}` : ""}`); fs.mkdirSync(dir, { recursive: true });
    await renderStill({ composition, serveUrl, frame: 0, output: path.join(dir, "_audit.jpg"), imageFormat: "jpeg", scale: 0.1, inputProps, browserExecutable, chromiumOptions, timeoutInMilliseconds: 900000,
      onBrowserLog: (l) => { const m = /^CAMAUDIT (\d+)\/(\d+) ([\s\S]*)$/.exec(l.text); if (m) { parts[Number(m[1]) - 1] = m[3]; total = Number(m[2]); } else if (l.type === "error") console.log(`[trình duyệt] ${l.text.slice(0, 240)}`); } });
    fs.rmSync(path.join(dir, "_audit.jpg"), { force: true });
    if (!total || parts.filter(Boolean).length !== total) throw new ConfigError(`Không nhận đủ dữ liệu kiểm tra từ trình duyệt (${parts.filter(Boolean).length}/${total}).`);
    const rep = JSON.parse(parts.join("")), notes = new Map(tl.shots.map((s) => [s.id, s.note ?? ""]));
    const KIND = { wide: "Toàn cảnh", medium: "Trung cảnh", closeup: "Cận cảnh nhân vật", food: "Cận món ăn / đạo cụ", detail: "Chi tiết thao tác", top: "Từ trên xuống (chỉ 3D)" };
    const errs = rep.shots.flatMap((s) => s.issues.filter((i) => i.level === "error").map((i) => ({ s, i }))), warns = rep.shots.flatMap((s) => s.issues.filter((i) => i.level === "warn").map((i) => ({ s, i })));
    const md = [`# Kiểm tra camera: ${slug} / ${format}${args.tag ? ` (${args.tag})` : ""}`, "", `- Timeline: ${rel(tf)} (${tl.totalFrames} frame, ${tl.shots.length} shot, ${tl.width}x${tl.height})${args.legacy ? " — đo theo hành vi CŨ (trước khi sửa)" : ""}`,
      `- Kết quả: **${errs.length} lỗi, ${warns.length} cảnh báo** trên ${rep.shots.length} shot; mọi frame của mọi đường camera đều được đo.`,
      `- Ngưỡng: nghiêng máy > ${rep.rules.rollDeg} độ khi có nhân vật = lỗi; lệch tầm mắt > ${rep.rules.pitchWarn} độ = cảnh báo, > ${rep.rules.pitchErr} độ = lỗi; thẻ lệch khỏi máy quay > ${rep.rules.edgeDeg} độ = lỗi; hình chính diện trượt ngang > ${rep.rules.slideMs} m/s = lỗi.`, "",
      "| Shot | Giây | Cảnh | Góc máy | Loại | NV 2D | Nhân vật chính | Cao % khung | Lệch tầm mắt (độ) | Vấn đề | Lý do chọn |", "|---|---|---|---|---|---|---|---|---|---|---|"];
    for (const s of rep.shots) { const m = s.actors.find((a) => a.id === s.mainActor);
      md.push(`| ${s.id} | ${s.sec} | ${s.scene} | ${s.camera} | ${KIND[s.kind] ?? s.kind} | ${s.chars ? "có" : "ẩn"} | ${m ? m.id : "-"} | ${m ? `${Math.round(m.screenH[0] * 100)}-${Math.round(m.screenH[1] * 100)}` : "-"} | ${m ? `${m.pitch[0]} .. ${m.pitch[1]}` : "-"} | ${s.issues.map((i) => `${i.level === "error" ? "LỖI" : "cảnh báo"} ${i.code} (f${i.first}-${i.last})`).join("; ") || "-"} | ${notes.get(s.id) || ""} |`); }
    md.push("", "## Chi tiết vấn đề", ...(errs.length + warns.length ? [...errs, ...warns].map(({ s, i }) => `- **${i.level === "error" ? "LỖI" : "Cảnh báo"}** ${s.id} (${s.scene}, ${s.camera}), frame ${i.first}-${i.last} (${i.frames} frame): ${i.msg}`) : ["- (không có)"]),
      "", "Số đo chỉ hỗ trợ: bố cục, nhịp và cảm giác chuyển động vẫn phải xem trên ảnh và clip.");
    writeJson(path.join(dir, "camera-audit.json"), rep); fs.writeFileSync(path.join(dir, "camera-audit.md"), md.join("\n") + "\n");
    console.log(`Kiểm tra camera: ${errs.length} lỗi, ${warns.length} cảnh báo trên ${rep.shots.length} shot -> ${rel(path.join(dir, "camera-audit.md"))}`);
    for (const { s, i } of errs) console.log(`  LỖI ${s.id} [${s.camera}] f${i.first}-${i.last}: ${i.msg}`);
    for (const { s, i } of warns.slice(0, Number(args.warns ?? 40))) console.log(`  cảnh báo ${s.id} [${s.camera}] f${i.first}-${i.last}: ${i.msg}`);
    if (errs.length) process.exitCode = 1;
  },
  // ---------------------------------------------------------------- dish workflow (/mon-... commands)
  /** scaffold episodes/<slug>/ for a new dish and make it the current one */
  async new() {
    const slug = need("episode"), dish = String(args.dish ?? slug), formats = String(args.formats ?? "short").split(",").map((s) => s.trim());
    for (const f of formats) if (!PRESETS[f]) throw new ConfigError(`--formats nhận short, long hoặc short,long (nhận "${f}")`);
    const { dir, made } = scaffoldEpisode(slug, dish, formats);
    console.log(`Đã tạo tập "${slug}" (${dish}) tại ${rel(dir)}: ${made.join(", ")}.`);
    console.log(`Món đang làm: ${slug}. Tiếp: nghiên cứu (research.md, sources.json), rồi viết ${formats.map((f) => `${f}/script.json`).join(" và ")}.`);
  },
  /** show the workflow state; --stage / --current / --formats / --dish / --note change it */
  async pipeline() {
    let p = readPipe();
    const slug = args.episode ? resolveSlug(String(args.episode)) : args.current ? String(args.current) : p.current;
    if (args.current || args.stage || args.formats || args.dish || args.note) {
      if (!slug) throw new ConfigError("Chưa có món đang làm: thêm --episode <slug> hoặc --current <slug>.");
      if (!fs.existsSync(path.join(paths(slug, "short").ep))) throw new ConfigError(`Không có tập "${slug}" trong episodes/.`);
      p = updatePipe(slug, { stage: args.stage, dish: args.dish, formats: args.formats ? String(args.formats).split(",") : undefined }, args.note ? String(args.note) : null);
    }
    console.log(`Món đang làm: ${p.current ?? "(chưa có)"}`);
    for (const [s, e] of Object.entries(p.episodes)) console.log(`  ${s === p.current ? "*" : " "} ${s.padEnd(22)} ${String(e.dish).padEnd(22)} ${(e.formats ?? []).join("+").padEnd(11)} ${STAGE_VI[e.stage] ?? e.stage}  ->  ${NEXT_VI[e.stage] ?? ""}`);
    if (!Object.keys(p.episodes).length) console.log("  (chưa có món nào; /mon-goi-y hoặc /mon-lam <tên món>)");
    console.log(`Các bước: ${STAGES.join(" -> ")}`);
  },
  /** the pre-voice checklist, automated: claims exist, years / numbers / sentence length within the template's limits, length estimate */
  async scriptcheck() {
    const [slug, format] = slugFmt(), p = paths(slug, format), file = args.file ? path.join(p.fm, String(args.file)) : p.script;
    for (const f of [file, p.sources]) if (!fs.existsSync(f)) throw new ConfigError(`Thiếu ${rel(f)}`);
    const cfg = fs.existsSync(p.config) ? readJson(p.config) : {}, r = checkScript(format, readJson(file), readJson(p.sources), cfg), s = r.stats, rp = PRESETS[format];
    console.log(`${rel(file)}: ${s.segments} câu, ${s.words} từ, ${s.chars} ký tự ElevenLabs, ước lượng ${s.estSec}s (khoảng cho phép ${rp.minDurationSec}-${rp.maxDurationSec}s), ${s.years} mốc năm, ${s.numbers} con số.`);
    if (s.estSec < rp.minDurationSec || s.estSec > rp.maxDurationSec) r.warnings.push(`độ dài ước lượng ${s.estSec}s nằm ngoài ${rp.minDurationSec}-${rp.maxDurationSec}s`);
    if (s.softClaims.length) console.log(`Câu dựa trên claim chưa chắc chắn (lời phải rào đúng mức): ${s.softClaims.join(", ")}`);
    r.warnings.forEach((w) => console.log(`CẢNH BÁO  ${w}`)); r.errors.forEach((e) => console.log(`LỖI       ${e}`));
    console.log(r.errors.length ? "\nKHÔNG ĐẠT." : r.warnings.length ? "\nĐẠT, có cảnh báo (xem lại trước khi thu giọng)." : "\nĐẠT.");
    if (r.errors.length) process.exitCode = 1;
  },
  /** local page that follows the current dish while it is made: stage, per-shot stills, render progress, finished chunks, preview, QA */
  async monitor() {
    const port = Number(args.port ?? 3124), page = path.join(ROOT, "scripts", "monitor.html"), outRoot = path.join(ROOT, "out");
    const TYPES = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".md": "text/plain; charset=utf-8", ".wav": "audio/wav" };
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(fs.readFileSync(page)); }
        if (u.pathname === "/status") {
          const p = readPipe(), slug = u.searchParams.get("episode") || p.current, e = slug ? p.episodes[slug] ?? null : null;
          const formats = Object.fromEntries(["short", "long"].map((f) => [f, slug ? readStatus(slug, f) : null]).filter(([, v]) => v));
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          return res.end(JSON.stringify({ slug, episode: e, stageVi: e ? STAGE_VI[e.stage] : null, nextVi: e ? NEXT_VI[e.stage] : null, formats, studio: "http://localhost:3123" }));
        }
        if (u.pathname.startsWith("/files/")) {
          const f = path.resolve(outRoot, decodeURIComponent(u.pathname.slice(7)));
          if (!f.startsWith(outRoot + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
          const size = fs.statSync(f).size, type = TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream", range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
          if (range) { // video seeking
            const a = range[1] ? Number(range[1]) : size - Number(range[2]), b = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            res.writeHead(206, { "content-type": type, "content-range": `bytes ${a}-${b}/${size}`, "accept-ranges": "bytes", "content-length": b - a + 1, "cache-control": "no-store" });
            return fs.createReadStream(f, { start: a, end: b }).pipe(res);
          }
          res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "no-store" });
          return fs.createReadStream(f).pipe(res);
        }
        res.writeHead(404); res.end();
      } catch (e) { res.writeHead(500); res.end(String(e.message)); }
    });
    server.listen(port, "127.0.0.1", () => console.log(`Trang theo dõi: http://localhost:${port}  (món đang làm: ${readPipe().current ?? "chưa có"}). Ctrl+C để dừng.`));
    await new Promise(() => {}); // runs until stopped
  },

  /** image textures made with Dreamina for asset entries of kind "texture" (see asset-manifest.json `generator`).
   *  --quote: save the nodes and print the credit quote (free). --run --credit-ceiling N: generate under that approved ceiling. */
  async texture() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format);
    const ids = args.id ? String(args.id).split(",") : null;
    if (!ids && !args.all) throw new ConfigError("Chọn --id <asset> (có thể nhiều, cách nhau dấu phẩy) hoặc --all");
    const items = planTextures(ep.manifest, { ids, force: !!args.force });
    if (!items.length) { console.log("Không còn texture nào cần tạo (thêm --force để tạo lại)."); return; }
    console.log(`${items.length} ảnh:`); for (const it of items) console.log(`  ${it.asset.id}/${it.key} -> public/${it.target}  [${it.asset.generator.model}, ${it.asset.generator.resolution}, ${it.asset.generator.ratio}, ${it.asset.generator.refs.length} ảnh mẫu]`);
    if (args["dry-run"]) { for (const it of items) console.log(`\n--- ${it.asset.id}/${it.key}\n${it.prompt}`); console.log("\n(--dry-run: không gọi Dreamina, không tốn credit)"); return; }
    const saved = saveNodes(ep, items), q = quoteNodes(saved[0].projectId, saved.map((s) => s.nodeId));
    for (const s of saved) console.log(`  báo giá ${s.asset.id}/${s.key}: ${q.items[s.nodeId]} credit`);
    console.log(`Tổng tối đa: ${q.total} credit. Canvas: ${saved[0].webUrl}`);
    if (!args.run) { console.log(`Chưa tạo ảnh. Khi người dùng duyệt: texture ... --run --credit-ceiling ${q.total}`); return; }
    const ceiling = Number(args["credit-ceiling"]);
    if (!Number.isFinite(ceiling) || ceiling <= 0) throw new ConfigError("--run cần --credit-ceiling <số credit người dùng đã duyệt>");
    const res = runNodes(ep, saved, ceiling);
    for (const r of res) console.log(`${r.ok ? "xong" : "LỖI"}  ${r.asset.id}/${r.key}${r.ok ? `  public/${r.file}  (${r.credits ?? "?"} credit)` : ""}`);
    if (res.some((r) => !r.ok)) process.exitCode = 1;
  },

  async still() { await render("still"); },
  async render() { await render("video"); },

  async mix() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), tf = tlFile(ep), py = python();
    if (!py) throw new ConfigError("Không tìm thấy Python.");
    if (!fs.existsSync(tf)) throw new ConfigError("Chưa có timeline. Chạy lệnh timeline.");
    const tl = readJson(tf), hasVoice = fs.existsSync(ep.p.voiceWav) && tl.timing === "aligned";
    if (!hasVoice) console.log("CHÚ Ý: chưa có giọng đọc thật -> chỉ mix nhạc + SFX (bản nháp, không phải video hoàn chỉnh).");
    const r = spawnSync(py, [path.join(ROOT, "scripts", "audio", "mix.py"), tf, hasVoice ? ep.p.voiceWav : "-", ep.p.audioDir, ...(args.force ? ["--force"] : [])], { stdio: "inherit" });
    if (r.status !== 0) { setStatus(slug, format, { step: "error", stepVi: "Mix lỗi" }, "Mix lỗi"); throw new ConfigError("mix.py lỗi (xem thông báo phía trên)."); }
    setStatus(slug, format, { step: "mixed", stepVi: "Đã mix tiếng" }, "Mix xong");
  },

  async mux() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), q = args.quality ?? "preview", dir = outDir(slug, format);
    const video = path.join(dir, `${name(ep, q)}.silent.mp4`), mix = path.join(ep.p.audioDir, "mix.wav"), out = path.join(dir, `${name(ep, q)}.mp4`);
    for (const f of [video, mix]) if (!fs.existsSync(f)) throw new ConfigError(`Thiếu ${rel(f)} (chạy render / mix trước).`);
    // the silent video says what made it (film.mjs assemble = Blender/Seedance, render = three.js) and for which timeline
    const made = fs.existsSync(video.replace(/\.mp4$/, ".json")) ? readJson(video.replace(/\.mp4$/, ".json")) : null, tlNow = readJson(tlFile(ep));
    if (!made) console.log(`CHÚ Ý: ${rel(video)} không ghi nguồn (bản dựng trước 2026-11-24); không kiểm được nó khớp timeline hiện tại.`);
    else {
      if (made.fingerprint !== tlNow.fingerprint) throw new ConfigError(`${rel(video)} được dựng cho timeline cũ (${made.fingerprint} ≠ ${tlNow.fingerprint}): dựng lại hình (${made.source === "film" ? "film.mjs assemble" : "render"}) trước khi ghép tiếng.`);
      console.log(`Hình: ${made.source === "film" ? `film.mjs assemble (${(made.segments ?? []).filter((s) => s.kind === "ai").length} đoạn Seedance, ${(made.segments ?? []).filter((s) => s.kind === "guide").length} đoạn bản mốc)` : "three.js render"}.`);
    }
    const dv = probeDuration(video), da = probeDuration(mix);
    if (Math.abs(dv - da) > 0.25) throw new ConfigError(`Hình ${dv.toFixed(2)}s và tiếng ${da.toFixed(2)}s lệch nhau > 0.25s: mix hoặc render đang cũ so với timeline. Chạy lại bước cũ hơn.`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", out]);
    const d = probeDuration(out), r = ep.render, tl = readJson(tlFile(ep));
    console.log(`${rel(out)}: ${d.toFixed(2)}s (hình ${dv.toFixed(2)}s, tiếng ${da.toFixed(2)}s).`);
    setStatus(slug, format, { step: "muxed", stepVi: `Đã ghép hình và tiếng (${q})`, video: { file: outRel(out), quality: q, sec: +d.toFixed(2), v: Date.now() } }, `Ghép xong ${q}: ${d.toFixed(2)}s`);
    if (tl.timing !== "aligned") console.log("CHÚ Ý: timeline ước lượng, chưa có giọng thật -> đây là PREVIEW, không phải video hoàn chỉnh.");
    else if (d < r.minDurationSec || d > r.maxDurationSec) { console.log(`KHÔNG ĐẠT thời lượng: ${d.toFixed(1)}s ngoài khoảng ${r.minDurationSec}-${r.maxDurationSec}s.`); process.exitCode = 1; }
    else console.log(`Thời lượng đạt khoảng ${r.minDurationSec}-${r.maxDurationSec}s (mục tiêu ${r.targetDurationSec}s).`);
  },

  async qa() {
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), q = args.quality ?? "preview", dir = outDir(slug, format), py = python();
    const video = args.video ? path.resolve(args.video) : [path.join(dir, `${name(ep, q)}.mp4`), path.join(dir, `${name(ep, q)}.silent.mp4`)].find((f) => fs.existsSync(f));
    if (!video || !fs.existsSync(video)) throw new ConfigError(`Chưa có video ${q} để kiểm tra trong ${rel(dir)}.`);
    const r = spawnSync(py, [path.join(ROOT, "scripts", "qa", "qa_stream.py"), video, tlFile(ep), path.join(dir, `qa-${q}${variant(ep)}`), ...(args.every ? ["--every", String(args.every)] : [])], { stdio: "inherit" });
    if (r.status !== 0) process.exitCode = 1;
    const ok = r.status === 0; setStatus(slug, format, { step: ok ? "qa-ok" : "qa-fail", stepVi: ok ? `QA đạt (${q})` : `QA KHÔNG ĐẠT (${q})`, qa: { ok, quality: q, dir: outRel(path.join(dir, `qa-${q}${variant(ep)}`)) } }, ok ? "QA đạt" : "QA không đạt");
  },
  async pace() {
    // shots with people / food (storyboard notes), frozen half-seconds and motion (video), words per second (timeline)
    const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), q = args.quality ?? "preview", dir = outDir(slug, format), py = python();
    const video = args.video ? path.resolve(args.video) : [path.join(dir, `${name(ep, q)}.mp4`), path.join(dir, `${name(ep, q)}.silent.mp4`)].find((f) => fs.existsSync(f));
    const sb = path.join(path.dirname(tlFile(ep)), "storyboard.json"), out = path.join(dir, `pace-${q}${variant(ep)}.md`);
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync(py, [path.join(ROOT, "scripts", "qa", "pace.py"), sb, tlFile(ep), video ?? "-", out], { stdio: "inherit" });
    console.log(`-> ${rel(out)}`);
    if (r.status !== 0) process.exitCode = 1;
  },
};

// ---------------------------------------------------------------- render (stills + video, chunked, resumable)
async function render(kind) {
  const [slug, format] = slugFmt(), ep = loadEpisode(slug, format, cliRender()), tf = tlFile(ep), q = args.quality ?? "preview";
  if (!(q in QUALITY)) throw new ConfigError(`--quality nhận ${Object.keys(QUALITY).join(" | ")}`);
  if (!fs.existsSync(tf)) throw new ConfigError(`Chưa có ${rel(tf)}. Chạy lệnh timeline (cùng các tham số --aspect/--width/--height nếu có).`);
  const tl = readJson(tf), final = q === "final" || q === "hq";
  if (final && kind === "video") {
    if (tl.timing !== "aligned") throw new ConfigError("Bản final cần timeline từ giọng đọc thật (timing aligned). Hiện là timeline ước lượng: chạy tts rồi timeline.");
    const miss = assetProblems(ep, scanAssets(ep));
    if (miss.length) throw new ConfigError(`Bản final bị chặn vì thiếu asset bắt buộc:\n${miss.map((m) => `  - ${m.id} (${m.name}) -> ${m.dir}${m.missingKeys.length ? ` thiếu model: ${m.missingKeys.join(", ")}` : ""}`).join("\n")}\nXem ${rel(path.join(ep.p.ep, "DOWNLOAD_GUIDE.md"))}. Dùng --quality preview để xem bản nháp có placeholder.`);
  }
  tmpDir();
  const { bundle } = await import("@remotion/bundler"), { renderStill, renderMedia, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = findChrome() ?? undefined, chromiumOptions = { gl: args.gl ?? "angle" }, scale = QUALITY[q], dir = outDir(slug, format);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Đóng gói dự án...`);
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
  const inputProps = { timeline: tl, mode: final ? "final" : "preview" };
  const composition = await selectComposition({ serveUrl, id: "FoodEpisode", inputProps, browserExecutable, chromiumOptions });
  const onBrowserLog = (l) => { if (l.type === "error") console.log(`[trình duyệt] ${l.text.slice(0, 240)}`); };
  const frameOf = (v) => { const s = tl.shots.find((x) => x.id === v); return s ? Math.floor((s.a + s.b) / 2) : Number(v); };
  if (kind === "still") {
    const list = args.frames ? String(args.frames).split(",").map(frameOf) : args.shots === "all" ? tl.shots.map((s) => Math.floor((s.a + s.b) / 2)) : [Math.min(15, tl.totalFrames - 1), Math.floor(tl.totalFrames / 2), tl.totalFrames - Math.min(20, tl.totalFrames)];
    const sdir = path.join(dir, `stills${variant(ep)}`); fs.mkdirSync(sdir, { recursive: true });
    const sheet = args.shots === "all"; // a full contact sheet replaces the monitor's still list; single frames are added to it
    setStatus(slug, format, (o) => ({ step: "stills", stepVi: `Ảnh tĩnh ${list.length} khung (${q})`, quality: q, stills: sheet ? [] : o.stills ?? [] }), `Bắt đầu ảnh tĩnh: ${list.length} khung`);
    for (const f of list) {
      if (!Number.isInteger(f) || f < 0 || f >= tl.totalFrames) throw new ConfigError(`Frame không hợp lệ: ${f} (video có ${tl.totalFrames} frame)`);
      const t0 = Date.now(), shot = tl.shots.find((s) => f >= s.a && f < s.b), out = path.join(sdir, `f${String(f).padStart(5, "0")}_${shot.id}.jpg`);
      await renderStill({ composition, serveUrl, frame: f, output: out, imageFormat: "jpeg", jpegQuality: 90, scale, inputProps, browserExecutable, chromiumOptions, timeoutInMilliseconds: 240000, onBrowserLog });
      console.log(`  ${rel(out)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      const item = { file: outRel(out), frame: f, shot: shot.id, pace: shot.pace ?? null, sec: +(f / tl.fps).toFixed(2), v: Date.now() };
      setStatus(slug, format, (o) => ({ stills: [...(o.stills ?? []).filter((x) => x.frame !== f), item].sort((a, b) => a.frame - b.frame) }));
    }
    setStatus(slug, format, { step: "stills-done", stepVi: `Xong ${list.length} ảnh tĩnh` }, `Xong ${list.length} ảnh tĩnh`);
    return;
  }
  // video: one range (--frames a-b / --chapter id) or the whole film in resumable chunks
  let range = null;
  if (args.frames) { const m = /^(\d+)-(\d+)$/.exec(String(args.frames)); if (!m) throw new ConfigError("--frames nhận a-b"); range = [Number(m[1]), Number(m[2])]; }
  if (args.chapter) { const shots = tl.shots.filter((s) => s.chapter === args.chapter); if (!shots.length) throw new ConfigError(`Không có chương "${args.chapter}"`); range = [shots[0].a, shots[shots.length - 1].b - 1]; }
  const concurrency = args.concurrency ? Number(args.concurrency) : Math.min(8, Math.max(2, Math.floor(os.cpus().length / 3)));
  const crf = final ? 16 : 22;
  const one = async (a, b, out, onPct = () => {}) => {
    const t0 = Date.now(); let lastPct = -1, lastStatus = -1;
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: out, inputProps, frameRange: [a, b], scale, crf, concurrency, muted: true, browserExecutable, chromiumOptions, timeoutInMilliseconds: 240000, onBrowserLog,
      onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== lastPct) { lastPct = p; process.stdout.write(`\r  frame ${a}-${b}: ${p * 10}%   `); } const s = Math.floor(progress * 50); if (s !== lastStatus) { lastStatus = s; onPct(progress); } } });
    const sec = (Date.now() - t0) / 1000; process.stdout.write(`\r  frame ${a}-${b}: xong trong ${sec.toFixed(0)}s (${(sec / (b - a + 1)).toFixed(2)}s/frame)\n`);
  };
  if (range) {
    if (range[0] < 0 || range[1] >= tl.totalFrames || range[0] > range[1]) throw new ConfigError(`Khoảng frame ngoài video (0-${tl.totalFrames - 1})`);
    const out = path.join(dir, `${name(ep, q)}.f${range[0]}-${range[1]}.mp4`); await one(range[0], range[1], out); console.log(rel(out)); return;
  }
  const size = Number(args["chunk-frames"] ?? 900), cdir = path.join(dir, "chunks", `${tl.fingerprint}-${tl.width}x${tl.height}-${q}`); fs.mkdirSync(cdir, { recursive: true });
  const parts = [];
  setStatus(slug, format, { step: "render", stepVi: `Đang render video (${q})`, quality: q, pct: 0, frame: 0, totalFrames: tl.totalFrames, chunks: [] }, `Bắt đầu render ${q}: ${tl.totalFrames} frame`);
  for (let a = 0; a < tl.totalFrames; a += size) {
    const b = Math.min(tl.totalFrames, a + size) - 1, out = path.join(cdir, `c${String(a).padStart(6, "0")}-${String(b).padStart(6, "0")}.mp4`);
    if (fs.existsSync(out) && !args.force) console.log(`  frame ${a}-${b}: đã có, bỏ qua (dùng --force để render lại)`); else { const tmp = out.replace(/\.mp4$/, ".part.mp4"); await one(a, b, tmp, (pr) => setStatus(slug, format, { pct: +((100 * (a + pr * (b - a + 1))) / tl.totalFrames).toFixed(1), frame: Math.round(a + pr * (b - a + 1)) })); fs.renameSync(tmp, out); }
    parts.push(out);
    setStatus(slug, format, (o) => ({ pct: +((100 * (b + 1)) / tl.totalFrames).toFixed(1), frame: b + 1, chunks: [...(o.chunks ?? []), { file: outRel(out), a, b, startSec: +(a / tl.fps).toFixed(2), v: fs.statSync(out).mtimeMs }] }), `Xong đoạn frame ${a}-${b}`);
  }
  const listFile = path.join(cdir, "list.txt"); fs.writeFileSync(listFile, parts.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  const silent = path.join(dir, `${name(ep, q)}.silent.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", silent]);
  writeJson(silent.replace(/\.mp4$/, ".json"), { source: "three", quality: q, fingerprint: tl.fingerprint, at: new Date().toISOString() });
  const d = probeDuration(silent);
  console.log(`${rel(silent)}: ${d.toFixed(2)}s (timeline ${tl.durationSec}s)${Math.abs(d - tl.durationSec) > 0.2 ? "  <-- LỆCH, kiểm tra các đoạn" : ""}. Tiếp: mix rồi mux.`);
  setStatus(slug, format, { step: "rendered", stepVi: "Render xong hình (chưa có tiếng)", pct: 100 }, `Render xong: ${d.toFixed(2)}s`);
}

// ---------------------------------------------------------------- main
const HELP = `Bộ công cụ video lịch sử món ăn
  node scripts/food.mjs <lệnh> --episode <slug> --format short|long [tùy chọn]
Lệnh:
  doctor                 kiểm tra môi trường (Node, Python, ffmpeg, Chrome, khóa ElevenLabs có/không)
  validate               kiểm tra tập: schema, claim <-> nguồn, shot <-> lời dẫn, asset, thời lượng
  voices                 liệt kê giọng nữ American English tài khoản dùng được (+ hạn mức còn lại)
  tts [--dry-run] [--sample ["câu"]] [--force] [--import a.wav --words w.json]
  timeline [--estimate]  dựng timeline.json từ giọng thật (hoặc ước lượng cho blockout)
  assets [--mark-validated <id>]   đối chiếu asset-manifest.json với file trên đĩa
  camcheck [--tag x]     đo mọi frame của mọi đường camera so với nhân vật 2D (nghiêng, lệch tầm mắt, che mặt, trượt chân...)
  studio [--port 3123]   xem trực tiếp trong Remotion Studio, có tiếng (kéo thanh thời gian, xem từng khung)
  still [--frames 0,300,shotId | --shots all] [--quality draft|preview|final|hq]
  render [--quality ...] [--frames a-b | --chapter id] [--chunk-frames 900] [--concurrency n] [--force]
  mix [--force]          nhạc nền + SFX + giọng -> stems + mix.wav (-14 LUFS, <= -1 dBTP)
  mux [--quality ...]    ghép hình + mix.wav -> MP4, kiểm tra thời lượng
  qa [--quality ...] [--video f.mp4] [--every 10]
  pace [--quality ...] [--video f.mp4]   kiểm nhịp: % shot có người / món, nửa giây đứng yên, chuyển động, tốc độ lời
Quy trình món ăn (các lệnh /mon-... trong Claude Code dùng các lệnh này; --episode current = món đang làm):
  new --episode <slug> --dish "Tên món" [--formats short|short,long]   tạo thư mục tập mới, đặt làm món đang làm
  pipeline [--current <slug>] [--stage <bước>] [--note "..."]          xem / đổi bước của món (suggested ... final)
  scriptcheck [--file script.v2-draft.json]   kiểm kịch bản trước khi thu giọng: claim, số năm, con số, độ dài câu, độ dài ước lượng
  texture --id <asset>|--all [--dry-run] [--run --credit-ceiling N] [--force]   ảnh vân bề mặt / phông nền bằng Dreamina CLI (mặc định chỉ báo giá)
  monitor [--port 3124]  trang theo dõi: ảnh từng shot, tiến độ render, các đoạn đã render, preview, QA
Tùy chỉnh mỗi lần chạy (preset trước, config.json của tập sau, tham số dòng lệnh cuối cùng):
  --duration <giây>  --aspect 9:16|16:9|1:1|4:5  --width n --height n  --fps n  --captions on|off  --labels on|off`;

loadEnv();
try {
  if (!cmd || cmd === "help" || cmd === "--help") console.log(HELP);
  else if (!commands[cmd]) { console.log(`Không có lệnh "${cmd}".\n\n${HELP}`); process.exitCode = 1; }
  else await commands[cmd]();
} catch (e) {
  // a failed picture/sound step must not leave the monitor page saying "rendering"
  if (["still", "render", "mix", "mux", "qa"].includes(cmd) && args.episode) {
    try { setStatus(resolveSlug(String(args.episode)), args.format ?? "short", { step: "error", stepVi: `LỖI ở bước ${cmd}: ${String(e.message).split("\n")[0].slice(0, 240)}` }, `Lỗi ${cmd}`); } catch { /* status is best effort */ }
  }
  if (e instanceof ConfigError || e instanceof ElevenError) { console.error(`\nLỖI${e.kind ? ` [${e.kind}]` : ""}: ${e.message}`); process.exitCode = 1; }
  else throw e;
}
