// The dish workflow behind the /mon-... commands: which episode is current, which stage it is in, the render
// status file the monitor page reads, a scaffold for a new episode, and the pre-voice script check.
// No Remotion imports here (used by the CLI, the monitor server and the tests).
import fs from "node:fs";
import path from "node:path";
import { ROOT, EPISODES, ConfigError, readJson, writeJson } from "./config.mjs";

// ---------------------------------------------------------------- pipeline state (episodes/_pipeline.json)
export const PIPE = () => path.join(EPISODES, "_pipeline.json");
export const STAGES = ["suggested", "research", "script", "approved", "assets", "production", "preview", "final"];
export const STAGE_VI = {
  suggested: "đã gợi ý", research: "đang nghiên cứu và viết kịch bản", script: "kịch bản chờ duyệt", approved: "kịch bản đã duyệt",
  assets: "chờ tải asset 3D", production: "đang tạo video", preview: "preview xong, chờ duyệt", final: "đã xuất final",
};
export const NEXT_VI = {
  suggested: "/mon-lam <số hoặc tên món>", research: "(Claude đang làm)", script: "/mon-dong-y hoặc /mon-viet-lai <góp ý>",
  approved: "(Claude đang lập danh sách asset)", assets: "tải asset theo DOWNLOAD_GUIDE.md rồi /mon-hoan-thanh", production: "(đang tạo; xem trang theo dõi)",
  preview: "xem preview, báo lỗi hoặc yêu cầu xuất final", final: "/mon-goi-y cho món mới",
};
export const readPipe = () => (fs.existsSync(PIPE()) ? readJson(PIPE()) : { current: null, episodes: {} });
export const writePipe = (p) => writeJson(PIPE(), p);
/** "current" -> the slug the workflow is on; anything else is returned as is */
export const resolveSlug = (s) => {
  if (s !== "current") return s;
  const cur = readPipe().current;
  if (!cur) throw new ConfigError("Chưa có món nào đang làm (episodes/_pipeline.json). Dùng /mon-lam hoặc --episode <slug>.");
  return cur;
};
/** set stage / current / formats; every change is logged with a time */
export const updatePipe = (slug, patch = {}, note = null) => {
  const p = readPipe(), now = new Date().toISOString();
  const e = (p.episodes[slug] ??= { dish: patch.dish ?? slug, formats: ["short"], stage: "research", created: now, log: [] });
  if (patch.stage && !STAGES.includes(patch.stage)) throw new ConfigError(`--stage nhận ${STAGES.join(" | ")}`);
  Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== "current" && v !== undefined)), { updated: now });
  if (patch.stage || note) e.log = [...(e.log ?? []), { at: now, stage: e.stage, note }].slice(-50);
  if (patch.current !== false) p.current = slug;
  writePipe(p);
  return p;
};

// ---------------------------------------------------------------- render status (out/<slug>/<format>/render-status.json)
export const OUT_ROOT = () => (process.env.FOOD_OUT_DIR ? path.resolve(process.env.FOOD_OUT_DIR) : path.join(ROOT, "out")); // override only for tests
export const statusFile = (slug, format) => path.join(OUT_ROOT(), slug, format, "render-status.json");
export const readStatus = (slug, format) => { try { return JSON.parse(fs.readFileSync(statusFile(slug, format), "utf8")); } catch { return null; } };
/** merge a patch (object or fn(old) -> object) into the status file; an optional log line is kept (last 40) */
export const setStatus = (slug, format, patch, line = null) => {
  const f = statusFile(slug, format), old = readStatus(slug, format) ?? {}, now = new Date().toISOString();
  const next = { ...old, slug, format, ...(typeof patch === "function" ? patch(old) : patch), updated: now };
  if (line) next.log = [...(old.log ?? []), { at: now, msg: line }].slice(-40);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(next, null, 1)); fs.renameSync(tmp, f); // the monitor never reads half a file
  return next;
};
/** path under out/ as the monitor serves it (/files/<this>) */
export const outRel = (f) => path.relative(OUT_ROOT(), f).replace(/\\/g, "/");

// ---------------------------------------------------------------- new episode scaffold
const VOICE = { // the voice the user approved for the croissant episode (Bella, American, warm); change per episode if asked
  provider: "elevenlabs", voiceId: "hpp4J3VqNfWAUOO0d1Us", voiceName: "Bella - Professional, Bright, Warm (premade; labels: female, american, informative_educational)",
  modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128",
  settings: { stability: 0.42, similarity_boost: 0.78, style: 0.3, use_speaker_boost: true, speed: 0.93 },
  pronunciations: [], chunkMaxChars: 4500, chunkGapSec: 0.55, budget: { maxTotalChars: 10000, maxRegenerations: 1 },
};
const FORMAT_CONFIG = {
  short: { format: "short", render: {}, leadInSec: 0.15, tailPadSec: 0.6, estimateWpm: 175, voiceSettings: { speed: 1.1 }, music: { style: "cafe", gainDb: -20, duckDb: -9, file: null }, sfxGainDb: -13 },
  long: { format: "long", render: {}, leadInSec: 0.6, tailPadSec: 2.0, estimateWpm: 151, music: { style: "cafe", gainDb: -22, duckDb: -9, file: null }, sfxGainDb: -14 },
};
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const scaffoldEpisode = (slug, dish, formats = ["short"]) => {
  if (!SLUG_RE.test(slug)) throw new ConfigError(`Tên tập "${slug}" chỉ gồm chữ thường không dấu, số và dấu -, ví dụ: pizza-margherita`);
  const dir = path.join(EPISODES, slug);
  if (fs.existsSync(dir)) throw new ConfigError(`Tập "${slug}" đã có (${dir}).`);
  const made = [], w = (rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); typeof data === "string" ? fs.writeFileSync(f, data) : writeJson(f, data); made.push(rel); };
  w("episode.json", { id: slug, dish, englishName: dish, nativeNames: [{ name: dish, lang: "en", note: "Điền tên gốc, ngôn ngữ và cách đọc sau khi nghiên cứu" }], aliases: [], culturalRegions: ["(điền sau khi nghiên cứu)"], originNote: "", locale: "en-US", voice: VOICE });
  w("sources.json", { sources: [], claims: [] });
  w("research.md", `# ${dish}: ghi chú nghiên cứu\n\nNguồn đã đọc, mốc sớm nhất tìm được, món hình thành thế nào, khi nào phổ biến, ai được cho là người làm ra (tách riêng truyền thuyết). Nguồn không truy cập được ghi rõ.\n`);
  w("ASSET_PLAN.md", `# ${dish}: kế hoạch asset 3D\n\n(Viết sau khi kịch bản được duyệt.)\n`);
  w("DOWNLOAD_GUIDE.md", `# ${dish}: hướng dẫn tải asset\n\n(Viết sau khi kịch bản được duyệt.)\n`);
  w("asset-manifest.json", { assets: [] });
  for (const f of ["short", "long"]) w(`${f}/config.json`, FORMAT_CONFIG[f]);
  updatePipe(slug, { dish, formats, stage: "research" }, "tạo tập mới");
  return { dir, made };
};

// ---------------------------------------------------------------- script check (the pre-voice checklist, automated)
const YEAR = /\b(1[0-9]{3}|20[0-9]{2})s?\b/g;
// spoken numbers; a hyphenated one ("twenty-seven") counts once. "one", "half" and vague plurals ("hundreds of years") are not data.
const NW = "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen";
const NUMWORD = new RegExp(`\\b(?:${NW})(?:-(?:one|${NW}))?\\b`, "gi");
export const LIMITS = { short: { yearsTotal: 1, numbersTotal: 1, sentenceWords: 15 }, long: { yearsPerChapter: 2, yearsTotal: 6, sentenceWords: 22 } };
/** counts and limits for a script (object) against its sources (object); returns { errors, warnings, stats } */
export const checkScript = (format, script, sources, cfg = {}) => {
  const L = LIMITS[format], errors = [], warnings = [], status = Object.fromEntries((sources.claims ?? []).map((c) => [c.id, c.status]));
  let words = 0, chars = 0; const years = [], numbers = [], longSent = [], perChapter = {}, softClaims = [];
  for (const s of script.segments ?? []) {
    const text = s.text, spoken = s.tts ?? s.text;
    words += text.split(/\s+/).filter(Boolean).length; chars += spoken.length + 1;
    const y = text.match(YEAR) ?? []; years.push(...y.map((v) => `${s.id}:${v}`)); (perChapter[s.chapter] ??= []).push(...y);
    const withoutYears = text.replace(YEAR, "");
    const n = [...(withoutYears.match(/\b\d[\d,.]*\b/g) ?? []), ...(withoutYears.match(NUMWORD) ?? [])]; numbers.push(...n.map((v) => `${s.id}:${v}`));
    for (const sen of text.split(/(?<=[.?!])\s+/)) { const k = sen.split(/\s+/).filter(Boolean).length; if (k > L.sentenceWords) longSent.push(`${s.id} (${k} từ)`); }
    for (const c of s.claims ?? []) { if (!(c in status)) errors.push(`${s.id}: claim "${c}" không có trong sources.json`); else if (status[c] !== "documented") softClaims.push(`${s.id}:${c}=${status[c]}`); }
  }
  if (years.length > L.yearsTotal) warnings.push(`${years.length} mốc năm đọc thành lời (giới hạn ${L.yearsTotal}): ${years.join(", ")}`);
  if (L.yearsPerChapter) for (const [ch, y] of Object.entries(perChapter)) if (y.length > L.yearsPerChapter) warnings.push(`chương ${ch}: ${y.length} mốc năm (giới hạn ${L.yearsPerChapter}): ${y.join(", ")}`);
  if (L.numbersTotal !== undefined && numbers.length > L.numbersTotal) warnings.push(`${numbers.length} con số (giới hạn ${L.numbersTotal}; kiểm bằng mắt, có thể là từ thường): ${numbers.join(", ")}`);
  if (longSent.length) warnings.push(`câu dài hơn ${L.sentenceWords} từ: ${longSent.join(", ")}`);
  const wpm = cfg.estimateWpm ?? (format === "short" ? 143 : 151), estSec = (words / wpm) * 60 + (cfg.leadInSec ?? 0) + (cfg.tailPadSec ?? 0);
  return { errors, warnings, stats: { segments: (script.segments ?? []).length, words, chars, years: years.length, numbers: numbers.length, estSec: +estSec.toFixed(1), softClaims } };
};
