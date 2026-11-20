// Shared configuration for the food-history toolkit: presets, override resolution, schemas, file helpers.
// Used by every CLI command (scripts/food.mjs) and by the tests. No Remotion / browser imports here.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EPISODES = process.env.FOOD_EPISODES_DIR ? path.resolve(process.env.FOOD_EPISODES_DIR) : path.join(ROOT, "episodes"); // override only for tests

// ---------------------------------------------------------------- presets
export const PRESETS = {
  short: { format: "short", targetDurationSec: 75, minDurationSec: 60, maxDurationSec: 90, aspectRatio: "9:16", width: 1080, height: 1920, fps: 30, captions: false, labels: false },
  long: { format: "long", targetDurationSec: 600, minDurationSec: 480, maxDurationSec: 720, aspectRatio: "16:9", width: 1920, height: 1080, fps: 30, captions: false, labels: false },
};
/** render scale per quality; final = composition size, hq = 1440x2560 / 2560x1440 for the default presets */
export const QUALITY = { draft: 1 / 3, preview: 0.5, final: 1, hq: 4 / 3 };

export class ConfigError extends Error {}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const even = (n) => 2 * Math.round(n / 2);
export const parseAspect = (s) => {
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  if (!m) throw new ConfigError(`Tỷ lệ không hợp lệ: "${s}" (ví dụ đúng: 9:16, 16:9, 1:1, 4:5)`);
  const a = Number(m[1]), b = Number(m[2]);
  if (!(a > 0 && b > 0)) throw new ConfigError(`Tỷ lệ không hợp lệ: "${s}"`);
  return a / b;
};
export const aspectString = (w, h) => { const g = gcd(w, h); return `${w / g}:${h / g}`; };
/** size for an aspect ratio with the SHORT side at `shortSide` px (1080 by default), both even */
export const sizeForAspect = (aspect, shortSide = 1080) => {
  const r = parseAspect(aspect);
  return r >= 1 ? { width: even(shortSide * r), height: shortSide } : { width: shortSide, height: even(shortSide / r) };
};
const sameAspect = (w, h, aspect) => Math.abs(w / h - parseAspect(aspect)) / parseAspect(aspect) < 0.01;

/** apply one override layer (episode file or CLI) on top of the current render settings */
const applyLayer = (cur, layer, name) => {
  const o = { ...cur };
  const L = Object.fromEntries(Object.entries(layer ?? {}).filter(([, v]) => v !== undefined && v !== null));
  const hasA = "aspectRatio" in L, hasW = "width" in L, hasH = "height" in L;
  if (hasA) parseAspect(L.aspectRatio);
  if (hasW && hasH) {
    if (hasA && !sameAspect(L.width, L.height, L.aspectRatio))
      throw new ConfigError(`${name}: kích thước ${L.width}x${L.height} mâu thuẫn với tỷ lệ ${L.aspectRatio}. Bỏ một trong hai, hoặc sửa cho khớp.`);
    o.width = L.width; o.height = L.height; o.aspectRatio = hasA ? L.aspectRatio : aspectString(L.width, L.height);
  } else if (hasW || hasH) {
    const r = parseAspect(hasA ? L.aspectRatio : cur.aspectRatio);
    if (hasA) o.aspectRatio = L.aspectRatio;
    if (hasW) { o.width = L.width; o.height = even(L.width / r); } else { o.height = L.height; o.width = even(L.height * r); }
  } else if (hasA) {
    o.aspectRatio = L.aspectRatio; Object.assign(o, sizeForAspect(L.aspectRatio, Math.min(cur.width, cur.height)));
  }
  if ("targetDurationSec" in L) {
    const t = Number(L.targetDurationSec);
    if (!(t > 0)) throw new ConfigError(`${name}: thời lượng phải là số giây dương, nhận được "${L.targetDurationSec}"`);
    o.targetDurationSec = t;
    // a new target without an explicit window keeps the preset's relative window (short 60-90 of 75, long 480-720 of 600)
    if (!("minDurationSec" in L)) o.minDurationSec = Math.round(t * 0.8);
    if (!("maxDurationSec" in L)) o.maxDurationSec = Math.round(t * 1.2);
  }
  for (const k of ["minDurationSec", "maxDurationSec", "fps", "captions", "labels"]) if (k in L) o[k] = L[k];
  return o;
};

/** preset first, then the episode's per-format overrides, then CLI overrides (the newest choice wins) */
export const resolveRender = (format, fileOverrides = {}, cliOverrides = {}) => {
  const preset = PRESETS[format];
  if (!preset) throw new ConfigError(`Format không hợp lệ: "${format}" (chỉ nhận short | long)`);
  let r = applyLayer({ ...preset }, fileOverrides, "config.json");
  r = applyLayer(r, cliOverrides, "CLI");
  for (const k of ["width", "height"]) if (!Number.isInteger(r[k]) || r[k] < 64 || r[k] % 2) throw new ConfigError(`${k} phải là số nguyên chẵn >= 64, nhận được ${r[k]}`);
  if (!Number.isInteger(r.fps) || r.fps < 1 || r.fps > 120) throw new ConfigError(`fps không hợp lệ: ${r.fps}`);
  if (!(r.minDurationSec <= r.targetDurationSec && r.targetDurationSec <= r.maxDurationSec))
    throw new ConfigError(`Khoảng thời lượng không hợp lệ: min ${r.minDurationSec} <= target ${r.targetDurationSec} <= max ${r.maxDurationSec} phải đúng`);
  return r;
};

// ---------------------------------------------------------------- schemas
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, "id chỉ gồm chữ, số, - và _");
const At = z.object({ segment: id, word: z.string().min(1).optional(), occurrence: z.number().int().min(1).optional(), offsetSec: z.number().optional() }).strict();

export const EpisodeSchema = z.object({
  id, dish: z.string().min(1), englishName: z.string().min(1),
  nativeNames: z.array(z.object({ name: z.string().min(1), lang: z.string().min(2), script: z.string().optional(), pronunciation: z.string().optional(), note: z.string().optional() }).strict()).min(1),
  aliases: z.array(z.string()).default([]),
  culturalRegions: z.array(z.string().min(1)).min(1),
  originNote: z.string().optional(),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default("en-US"),
  voice: z.object({
    provider: z.literal("elevenlabs"), voiceId: z.string().min(8).nullable(), voiceName: z.string().optional(),
    modelId: z.string().min(3), outputFormat: z.string().min(3),
    settings: z.object({ stability: z.number().min(0).max(1).optional(), similarity_boost: z.number().min(0).max(1).optional(), style: z.number().min(0).max(1).optional(),
      use_speaker_boost: z.boolean().optional(), speed: z.number().min(0.7).max(1.2).optional() }).strict().default({}),
    pronunciations: z.array(z.object({ written: z.string().min(1), tts: z.string().min(1), note: z.string().optional() }).strict()).default([]),
    chunkMaxChars: z.number().int().min(200).max(40000).default(4500), chunkGapSec: z.number().min(0).max(3).default(0.45),
    budget: z.object({ maxTotalChars: z.number().int().positive(), maxRegenerations: z.number().int().min(0) }).strict(),
  }).strict(),
}).strict();

export const FormatConfigSchema = z.object({
  format: z.enum(["short", "long"]),
  render: z.object({ targetDurationSec: z.number().positive(), minDurationSec: z.number().positive(), maxDurationSec: z.number().positive(), aspectRatio: z.string(),
    width: z.number().int(), height: z.number().int(), fps: z.number().int(), captions: z.boolean(), labels: z.boolean() }).partial().strict().default({}),
  leadInSec: z.number().min(0).max(5).default(0.4), tailPadSec: z.number().min(0).max(10).default(1.2),
  estimateWpm: z.number().min(100).max(220).default(162),
  music: z.object({ style: z.string().default("cafe"), gainDb: z.number().default(-21), duckDb: z.number().default(-9), file: z.string().nullable().default(null), credit: z.string().optional() }).strict().default({ style: "cafe", gainDb: -21, duckDb: -9, file: null }),
  sfxGainDb: z.number().default(-14),
  // per-format voice settings on top of episode.json (e.g. a quicker read for the Short without touching the Long's cached audio)
  voiceSettings: z.object({ stability: z.number().min(0).max(1), similarity_boost: z.number().min(0).max(1), style: z.number().min(0).max(1), use_speaker_boost: z.boolean(), speed: z.number().min(0.7).max(1.2) }).partial().strict().optional(),
}).strict();

export const ScriptSchema = z.object({
  locale: z.string(), title: z.string().optional(),
  segments: z.array(z.object({ id, chapter: id, text: z.string().min(1), tts: z.string().min(1).optional(), claims: z.array(id).default([]), note: z.string().optional() }).strict()).min(1),
}).strict();

const Shot = z.object({
  id, scene: id, from: id.optional(), at: At.optional(),
  camera: z.union([z.string(), z.object({ from: z.string(), to: z.string(), ease: z.enum(["linear", "smooth", "out"]).optional() }).strict()]).default("main"),
  params: z.record(z.string(), z.any()).default({}), light: z.string().optional(), legend: z.boolean().default(false), static: z.boolean().default(false),
  transition: z.enum(["cut", "dip", "whip"]).default("cut"), claims: z.array(id).default([]), assets: z.array(id).default([]),
  pace: z.enum(["hook", "story", "process", "insert"]).optional(), // shot length class, see PACE in timeline.mjs
  label: z.object({ text: z.string().min(1), claim: id }).strict().optional(),
  events: z.array(z.object({ type: z.enum(["sfx", "action"]), name: z.string().min(1), at: At, gainDb: z.number().optional(), durSec: z.number().positive().optional() }).strict()).default([]),
  note: z.string().optional(),
}).strict().refine((s) => !!s.from !== !!s.at, "mỗi shot cần đúng một trong hai: from (id đoạn lời) hoặc at (mốc trong đoạn)");
export const StoryboardSchema = z.object({
  chapters: z.array(z.object({ id, title: z.string().min(1), adBreakBefore: z.boolean().default(false), targetSec: z.number().positive().optional() }).strict()).min(1),
  shots: z.array(Shot).min(1),
}).strict();

export const SourcesSchema = z.object({
  sources: z.array(z.object({ id, title: z.string().min(1), author: z.string().nullable(), org: z.string().nullable(), url: z.string().url(), published: z.string().nullable(), accessed: z.string(),
    lang: z.string(), kind: z.string(), read: z.enum(["read", "partial", "pointer", "unreachable"]), note: z.string().optional() }).strict()).min(1),
  claims: z.array(z.object({ id, claim: z.string().min(1), status: z.enum(["documented", "disputed", "legend", "unknown"]), source_ids: z.array(id),
    evidence: z.array(z.object({ source_id: id, quote: z.string().optional(), translation: z.string().optional(), location: z.string().optional() }).strict()).default([]), limits: z.string().optional() }).strict()).min(1),
}).strict();

export const AssetManifestSchema = z.object({
  assets: z.array(z.object({ id, name: z.string().min(1), author: z.string().nullable(), sourceUrl: z.string().url().nullable(), license: z.string().nullable(), attribution: z.string().nullable(),
    price: z.string().nullable(), formats: z.string().nullable(), required: z.boolean(), usedIn: z.array(z.string()).default([]), targetDir: z.string().min(1),
    files: z.record(z.string(), z.string().nullable()).default({}), status: z.enum(["missing", "downloaded", "validated"]), checkedOn: z.string().nullable().default(null), note: z.string().optional(),
    // "model" = GLB/glTF files the user downloads; "texture" = image files (walls, facades, floors, skies, backdrops), usually made with Dreamina
    kind: z.enum(["model", "texture"]).default("model"),
    // how a texture is made: one Dreamina image per files key (see `food.mjs texture`); credits are filled in after the run
    generator: z.object({ tool: z.literal("dreamina"), model: z.string().min(3), resolution: z.string().default("2K"), ratio: z.string().default("1:1"),
      refs: z.array(z.string()).default([]), prompts: z.record(z.string(), z.string().min(20)),
      runs: z.record(z.string(), z.object({ nodeId: z.string(), resourceId: z.string().nullable(), credits: z.number().nullable(), at: z.string() }).strict()).default({}) }).strict().optional() }).strict()),
}).strict();

export const zerr = (file, e) => new ConfigError(`${file}:\n` + e.issues.map((i) => `  - ${i.path.join(".") || "(gốc)"}: ${i.message}`).join("\n"));
export const readJson = (file) => {
  if (!fs.existsSync(file)) throw new ConfigError(`Thiếu file: ${path.relative(ROOT, file)}`);
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (e) { throw new ConfigError(`${path.relative(ROOT, file)}: JSON lỗi (${e.message})`); }
};
export const parseFile = (schema, file) => { const r = schema.safeParse(readJson(file)); if (!r.success) throw zerr(path.relative(ROOT, file), r.error); return r.data; };
export const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n"); };
export const sha = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

// ---------------------------------------------------------------- episode loading
export const paths = (slug, format) => {
  const ep = path.join(EPISODES, slug), fm = path.join(ep, format);
  return { ep, fm, episode: path.join(ep, "episode.json"), sources: path.join(ep, "sources.json"), manifest: path.join(ep, "asset-manifest.json"),
    config: path.join(fm, "config.json"), script: path.join(fm, "script.json"), storyboard: path.join(fm, "storyboard.json"),
    voiceDir: path.join(fm, "voice"), transcript: path.join(fm, "voice", "transcript.json"), voiceWav: path.join(fm, "voice", "voice.wav"),
    timeline: path.join(fm, "timeline.json"), props: path.join(fm, "timeline.props.json"), audioDir: path.join(fm, "audio") };
};
export const outDir = (slug, format) => path.join(ROOT, "out", slug, format);

/** load + cross-check everything an episode format needs. Returns data and a list of problems (errors / warnings). */
export const loadEpisode = (slug, format, cli = {}) => {
  if (!PRESETS[format]) throw new ConfigError(`Format không hợp lệ: "${format}" (short | long)`);
  const p = paths(slug, format);
  if (!fs.existsSync(p.ep)) throw new ConfigError(`Không có tập "${slug}" trong episodes/. Các tập hiện có: ${fs.existsSync(EPISODES) ? fs.readdirSync(EPISODES).filter((d) => !d.startsWith("_")).join(", ") || "(trống)" : "(chưa có thư mục episodes)"}`);
  const episode = parseFile(EpisodeSchema, p.episode);
  const config = parseFile(FormatConfigSchema, p.config);
  if (config.voiceSettings) episode.voice.settings = { ...episode.voice.settings, ...config.voiceSettings };
  const script = parseFile(ScriptSchema, p.script);
  const storyboard = parseFile(StoryboardSchema, p.storyboard);
  const sources = parseFile(SourcesSchema, p.sources);
  const manifest = fs.existsSync(p.manifest) ? parseFile(AssetManifestSchema, p.manifest) : { assets: [] };
  const render = resolveRender(format, config.render, cli);
  const errors = [], warnings = [];
  if (episode.id !== slug) errors.push(`episode.json: id "${episode.id}" khác tên thư mục "${slug}"`);
  if (config.format !== format) errors.push(`${format}/config.json: format ghi "${config.format}"`);
  const dup = (arr, what) => { const s = new Set(); for (const x of arr) { if (s.has(x)) errors.push(`${what}: id trùng "${x}"`); s.add(x); } return s; };
  const segIds = dup(script.segments.map((s) => s.id), "script.segments"), chapIds = dup(storyboard.chapters.map((c) => c.id), "storyboard.chapters");
  dup(storyboard.shots.map((s) => s.id), "storyboard.shots");
  const srcIds = dup(sources.sources.map((s) => s.id), "sources"), claimIds = dup(sources.claims.map((c) => c.id), "claims");
  const assetIds = dup(manifest.assets.map((a) => a.id), "asset-manifest");
  for (const c of sources.claims) {
    for (const s of c.source_ids) if (!srcIds.has(s)) errors.push(`claim ${c.id}: source_id "${s}" không có trong sources`);
    for (const e of c.evidence) if (!srcIds.has(e.source_id)) errors.push(`claim ${c.id}: evidence dùng source "${e.source_id}" không tồn tại`);
    if (c.status === "documented" && !c.source_ids.length) errors.push(`claim ${c.id}: ghi "documented" nhưng không có nguồn`);
    const readable = c.source_ids.filter((s) => ["read", "partial"].includes(sources.sources.find((x) => x.id === s)?.read));
    if (c.status === "documented" && c.source_ids.length && !readable.length) warnings.push(`claim ${c.id}: "documented" nhưng chưa có nguồn nào thực sự đọc được (chỉ pointer/unreachable)`);
  }
  for (const s of script.segments) {
    if (!chapIds.has(s.chapter)) errors.push(`segment ${s.id}: chapter "${s.chapter}" không có trong storyboard.chapters`);
    for (const c of s.claims) if (!claimIds.has(c)) errors.push(`segment ${s.id}: claim "${c}" không có trong sources.json`);
  }
  const order = new Map(script.segments.map((s, i) => [s.id, i]));
  for (let i = 1; i < script.segments.length; i++) {
    const a = storyboard.chapters.findIndex((c) => c.id === script.segments[i - 1].chapter), b = storyboard.chapters.findIndex((c) => c.id === script.segments[i].chapter);
    if (b < a) errors.push(`segment ${script.segments[i].id}: thứ tự chapter đi lùi (${script.segments[i].chapter} sau ${script.segments[i - 1].chapter})`);
  }
  let last = -1;
  for (const sh of storyboard.shots) {
    const seg = sh.from ?? sh.at.segment;
    if (!segIds.has(seg)) { errors.push(`shot ${sh.id}: đoạn lời "${seg}" không tồn tại`); continue; }
    const k = order.get(seg);
    if (k < last) errors.push(`shot ${sh.id}: bắt đầu ở đoạn ${seg}, đứng trước shot liền trước (shot phải theo thứ tự lời dẫn)`);
    last = k;
    for (const c of sh.claims) if (!claimIds.has(c)) errors.push(`shot ${sh.id}: claim "${c}" không có trong sources.json`);
    if (sh.label && !claimIds.has(sh.label.claim)) errors.push(`shot ${sh.id}: nhãn dựa trên claim "${sh.label.claim}" không tồn tại`);
    if (sh.label) { const st = sources.claims.find((c) => c.id === sh.label.claim)?.status; if (st && st !== "documented") errors.push(`shot ${sh.id}: nhãn địa điểm/năm chỉ được dựa trên claim "documented" (claim ${sh.label.claim} là "${st}")`); }
    for (const a of sh.assets) if (!assetIds.has(a)) errors.push(`shot ${sh.id}: asset "${a}" không có trong asset-manifest.json`);
    for (const c of sh.claims) { const st = sources.claims.find((x) => x.id === c)?.status; if (st === "legend" && !sh.legend) errors.push(`shot ${sh.id}: minh họa claim "${c}" (legend) nhưng chưa bật legend: true — hình không được biến giai thoại thành sự thật`); }
    for (const ev of sh.events) if (!segIds.has(ev.at.segment)) errors.push(`shot ${sh.id}: sự kiện ${ev.name} trỏ tới đoạn "${ev.at.segment}" không tồn tại`);
  }
  if ((storyboard.shots[0].from ?? storyboard.shots[0].at.segment) !== script.segments[0].id) errors.push(`shot đầu tiên phải bắt đầu ở đoạn lời đầu tiên (${script.segments[0].id})`);
  if (format === "long" && storyboard.chapters.length < 3) warnings.push("Bản Long nên chia ít nhất 3 chương");
  const words = script.segments.reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0);
  const estSec = (words / config.estimateWpm) * 60 + config.leadInSec + config.tailPadSec;
  if (estSec < render.minDurationSec || estSec > render.maxDurationSec)
    warnings.push(`Ước lượng từ kịch bản: ${words} từ ≈ ${estSec.toFixed(0)} giây ở ${config.estimateWpm} từ/phút, nằm ngoài khoảng ${render.minDurationSec}-${render.maxDurationSec} giây (mục tiêu ${render.targetDurationSec})`);
  return { slug, format, p, episode, config, script, storyboard, sources, manifest, render, words, estSec, errors, warnings };
};

/** text actually sent to TTS for a segment: explicit `tts`, else `text` with the episode's pronunciation replacements */
export const ttsText = (episode, seg) => {
  if (seg.tts) return seg.tts;
  let t = seg.text;
  for (const pr of episode.voice.pronunciations) t = t.split(pr.written).join(pr.tts);
  return t;
};
