// The film after three.js (2026-11-24): Blender lays out each stretch, Seedance 2.0 Mini paints it, Remotion assembles.
//   node scripts/film.mjs segments --episode <slug> [--format short]          cut the timeline into AI segments (<= 15 s, one location each)
//   node scripts/film.mjs guide    --episode <slug> [--segment s01] [--quality draft|preview] [--frames a-b]
//                                   Blender layout render of each segment from blender/sets/<scene>.blend -> out/<slug>/<format>/guide/sNN.mp4
//   node scripts/film.mjs ai       --episode <slug> [--segment s01]         quote every segment on Dreamina (no credits spent)
//   node scripts/film.mjs ai       --episode <slug> --segment s01 --run --credit-ceiling N    generate after the user approved N credits
//   node scripts/film.mjs assemble --episode <slug> [--quality preview|final]  Seedance clips (or guides) + 2D layer -> silent mp4 (then food.mjs mux)
// Credits: only `ai --run` spends them, never above --credit-ceiling, and only after a quote the user approved.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, PRESETS, ConfigError, loadEpisode, outDir, readJson, writeJson } from "./lib/config.mjs";
import { resolveSlug } from "./lib/pipeline.mjs";
import { planSegments, picturesFor, aiPrompt } from "./lib/film.mjs";
import { dm } from "./lib/dreamina.mjs";
import { findBlender } from "./lib/blender-exe.mjs";

const args = {}; const av = process.argv.slice(2), cmd = av[0] && !av[0].startsWith("--") ? av.shift() : "help";
for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) args[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith("--") ? av[++i] : true;
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const SETS = path.join(ROOT, "blender", "sets");
const BRAND_REFS = [path.join(ROOT, "..", "..", "brand", "character", "stick-turnaround.png")];

const ctx = () => {
  if (!args.episode) throw new ConfigError("Thiếu --episode <slug>");
  const format = String(args.format ?? "short");
  if (!PRESETS[format]) throw new ConfigError(`--format nhận short | long`);
  const slug = resolveSlug(String(args.episode)), ep = loadEpisode(slug, format), dir = outDir(slug, format);
  const tf = path.join(ep.p.fm, "timeline.json");
  if (!fs.existsSync(tf)) throw new ConfigError(`Chưa có ${rel(tf)}: chạy food.mjs timeline trước`);
  const tl = readJson(tf), segFile = path.join(dir, "segments.json");
  return { slug, format, ep, dir, tf, tl, segFile };
};
const loadSegments = (c) => {
  if (!fs.existsSync(c.segFile)) { const s = planSegments(c.tl); writeJson(c.segFile, { timeline: rel(c.tf), segments: s }); return s; }
  return readJson(c.segFile).segments;
};
const pick = (segs) => (args.segment ? segs.filter((g) => String(args.segment).split(",").includes(g.id)) : segs);

// ------------------------------------------------------------------ segments
const segments = () => {
  const c = ctx(), s = planSegments(c.tl);
  writeJson(c.segFile, { timeline: rel(c.tf), segments: s });
  const total = s.reduce((n, g) => n + g.genSec, 0);
  console.log(`${s.length} đoạn AI, tổng ${total}s tạo (phim ${c.tl.durationSec}s) -> ${rel(c.segFile)}`);
  for (const g of s) console.log(`  ${g.id}  ${g.scene.padEnd(10)} ${(g.a / c.tl.fps).toFixed(2)}–${(g.b / c.tl.fps).toFixed(2)}s  ${g.sec}s -> tạo ${g.genSec}s  shot ${g.shots.join(",")}`);
  const missing = [...new Set(s.map((g) => g.scene))].filter((sc) => !fs.existsSync(path.join(SETS, `${sc}.blend`)));
  if (missing.length) console.log(`Bối cảnh Blender chưa có: ${missing.map((m) => `blender/sets/${m}.blend`).join(", ")}`);
};

// ------------------------------------------------------------------ guide: Blender layout render
const guide = () => {
  const c = ctx(), exe = findBlender(args.blender);
  if (!exe) throw new ConfigError("Chưa tìm thấy Blender (--blender <đường dẫn> hoặc BLENDER_EXE)");
  const q = String(args.quality ?? "draft");
  for (const g of pick(loadSegments(c))) {
    const set = path.join(SETS, `${g.scene}.blend`);
    if (!fs.existsSync(set)) throw new ConfigError(`Chưa có bối cảnh ${rel(set)} cho đoạn ${g.id} (dựng qua Blender MCP theo quy ước CAM-/MARK-)`);
    const fdir = path.join(c.dir, "guide", g.id), out = path.join(c.dir, "guide", `${g.id}.mp4`);
    fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir, { recursive: true });
    const extra = args.frames ? ["--frames", String(args.frames)] : [];
    const t0 = Date.now();
    const r = spawnSync(exe, ["-b", set, "--python-exit-code", "1", "--python", path.join(ROOT, "blender", "shot.py"), "--",
      "--timeline", c.tf, "--segment", JSON.stringify(g), "--out", fdir, "--quality", q, ...extra], { encoding: "utf8", maxBuffer: 1 << 28 });
    for (const l of `${r.stdout}\n${r.stderr}`.split(/\r?\n/)) if (/^\[shot\]|Error|Traceback|  File/.test(l)) console.log("  " + l);
    if (r.status !== 0) throw new Error(`Blender lỗi ở đoạn ${g.id} (mã ${r.status})`);
    if (!args.frames) {
      const ff = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(c.tl.fps), "-i", path.join(fdir, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out]);
      if (ff.status !== 0) throw new Error(`ffmpeg lỗi khi ghép ${g.id}`);
    }
    console.log(`${g.id}: ${args.frames ? `khung ${args.frames}` : rel(out)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
};

// ------------------------------------------------------------------ ai: Seedance 2.0 Mini per segment (quote first)
const ai = () => {
  const c = ctx(), segs = pick(loadSegments(c)), model = String(args.model ?? "seedance_2.0_mini");
  const stFile = path.join(c.dir, "dreamina.json"), st = fs.existsSync(stFile) ? readJson(stFile) : { refs: {}, nodes: {} };
  if (!st.projectId) { const d = dm(["canvas", "create", `Crumb Trail - ${c.slug} ${c.format}`]); st.projectId = d.project.projectId; st.webUrl = d.project.webUrl; writeJson(stFile, st); }
  const up = (file) => { const sig = `${file}|${fs.statSync(file).mtimeMs}`; if (!st.refs[sig]) { st.refs[sig] = dm(["resource", "upload", "--project-id", st.projectId, "--file", file]).resourceId; writeJson(stFile, st); } return st.refs[sig]; };
  const byId = Object.fromEntries(c.tl.shots.map((s) => [s.id, s]));
  const refsExtra = [...BRAND_REFS, ...String(args.refs ?? "").split(",").filter(Boolean).map((f) => path.resolve(ROOT, f))].filter((f) => fs.existsSync(f));
  let total = 0;
  for (const g of segs) {
    const gv = path.join(c.dir, "guide", `${g.id}.mp4`);
    if (!fs.existsSync(gv)) throw new ConfigError(`Chưa có bản mốc ${rel(gv)}: chạy film.mjs guide --segment ${g.id}`);
    const ratio = c.tl.width > c.tl.height ? "16:9" : c.tl.width === c.tl.height ? "1:1" : "9:16";
    const gen = ["--project-id", st.projectId, "--model", model, "--mode", "m2v", "--ratio", ratio, "--resolution", "720p", "--duration", String(g.genSec),
      "--ref", `res:${up(gv)}`, ...refsExtra.flatMap((f) => ["--ref", `res:${up(f)}`]), "--prompt", aiPrompt(g, byId)];
    st.nodes ??= {};
    const key = `${g.id}|${model}`;
    const node = st.nodes[key] ? dm(["node", "edit", "video", "--node-id", st.nodes[key], ...gen]).node.nodeId : dm(["node", "create", "video", "--title", `${c.slug} ${g.id}`, "--x", "0", "--y", "0", ...gen]).node.nodeId;
    st.nodes[key] = node; writeJson(stFile, st);
    const q = dm(["node", "quote", "--project-id", st.projectId, "--node-id", node]);
    total += q.totalMaxCredits;
    console.log(`${g.id} (${g.genSec}s, ${g.scene}): ${q.totalMaxCredits} credit`);
    if (!args.run) continue;
    const ceiling = Number(args["credit-ceiling"]);
    if (!Number.isFinite(ceiling)) throw new ConfigError("--run cần --credit-ceiling <số credit đã duyệt>");
    if (total > ceiling) throw new ConfigError(`Tổng báo giá ${total} vượt mức duyệt ${ceiling}. Dừng trước ${g.id}.`);
    const conf = q.confirmationRequired ? dm(["node", "confirm", "--project-id", st.projectId, "--node-id", node, "--credit-ceiling", String(ceiling)]) : {};
    dm(["node", "run", "--project-id", st.projectId, "--node-id", node, "--submit-id", crypto.randomUUID(), ...(conf.creditConfirmationToken ? ["--credit-token", conf.creditConfirmationToken] : [])]);
    const t0 = Date.now(); let n;
    for (;;) {
      n = dm(["node", "show", "--project-id", st.projectId, "--node-id", node]).nodes[0].node;
      if (["success", "failed", "fail", "error"].includes(n.status)) break;
      if (Date.now() - t0 > 30 * 60e3) throw new ConfigError(`Quá 30 phút: node ${node} trên ${st.webUrl}`);
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
    }
    const r = (n.resources ?? []).find((x) => x.status === "success");
    if (!r) throw new ConfigError(`Dreamina báo lỗi (${n.status}) ở ${g.id}`);
    const out = path.join(c.dir, "ai", `${g.id}.mp4`), part = `${out}.part`;
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.rmSync(part, { force: true });
    dm(["resource", "download", r.resourceId, "--project-id", st.projectId, "-o", part]); fs.renameSync(part, out);
    console.log(`  -> ${rel(out)}`);
  }
  console.log(`Tổng báo giá ${segs.length} đoạn: ${total} credit.${args.run ? "" : ` Chưa tạo. Khi đã duyệt: node scripts/film.mjs ai --episode ${c.slug}${args.segment ? ` --segment ${args.segment}` : ""} --run --credit-ceiling ${total}`}`);
};

// ------------------------------------------------------------------ assemble: clips + 2D layer -> silent mp4
const assemble = async () => {
  const c = ctx(), segs = loadSegments(c), q = String(args.quality ?? "preview");
  const have = (f) => fs.existsSync(path.join(c.dir, f));
  const pics = picturesFor(segs, have), missing = segs.filter((_, i) => !pics[i]).map((g) => g.id);
  if (missing.length && !args.allowGaps) throw new ConfigError(`Chưa có hình cho đoạn ${missing.join(", ")} (cần ai/ hoặc guide/). Thêm --allow-gaps để dựng bản nháp có chỗ trống.`);
  const pub = path.join(ROOT, "public", "_film", c.slug, c.format);
  fs.rmSync(pub, { recursive: true, force: true }); fs.mkdirSync(pub, { recursive: true });
  const pictures = pics.filter(Boolean).map((p) => { const dst = path.join(pub, p.src.replace("/", "_")); fs.copyFileSync(path.join(c.dir, p.src), dst); return { ...p, src: `_film/${c.slug}/${c.format}/${path.basename(dst)}` }; });
  const tmp = process.env.REMOTION_TMP || path.join(ROOT, ".cache", "remotion-tmp"); fs.mkdirSync(tmp, { recursive: true }); process.env.TEMP = process.env.TMP = tmp;
  const { bundle } = await import("@remotion/bundler"), { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
  const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((x) => fs.existsSync(x));
  const inputProps = { timeline: c.tl, pictures, mode: q === "final" ? "final" : "preview" };
  const composition = await selectComposition({ serveUrl, id: "FoodAssembly", inputProps, browserExecutable: chrome });
  const out = path.join(c.dir, `${c.slug}-${c.format}-${c.tl.width}x${c.tl.height}-${q}.silent.mp4`);
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: out, inputProps, crf: 18, muted: true, browserExecutable: chrome,
    concurrency: Math.min(6, Math.max(2, Math.floor(os.cpus().length / 3))) });
  console.log(`${rel(out)}: ${pictures.filter((p) => p.kind === "ai").length} đoạn Seedance, ${pictures.filter((p) => p.kind === "guide").length} đoạn bản mốc. Tiếp: food.mjs mux.`);
};

try {
  if (cmd === "segments") segments();
  else if (cmd === "guide") guide();
  else if (cmd === "ai") ai();
  else if (cmd === "assemble") await assemble();
  else console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
} catch (e) { console.error(e instanceof ConfigError ? e.message : e?.stack ?? e); process.exit(1); }
