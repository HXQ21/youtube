// Blender in the video pipeline: three ways to get a prettier picture out of the same shot, side by side.
//   node scripts/blender.mjs make    --name bakery-test [--episode croissant --shot q05 --frames 150 --camera main:table --params '{"items":"croissant"}']
//   node scripts/blender.mjs export  --name bakery-test     set.glb + scene.json + card pictures (src/core/BlenderExport.tsx)
//   node scripts/blender.mjs three   --name bakery-test [--baked]   the shot rendered by three.js (baseline, or with the baked set)
//   node scripts/blender.mjs stills  --name bakery-test [--at 0,75,149 --scale 0.5]   a few three.js frames (framing check)
//   node scripts/blender.mjs bake    --name bakery-test     Blender Cycles bakes the light of the set  -> set-baked.glb + lightmap.png
//   node scripts/blender.mjs render  --name bakery-test     Blender Eevee renders the whole shot       -> blender.mp4
//   node scripts/blender.mjs ai      --name bakery-test [--model seedance_2.0|grok_imagine_1.5_lite] [--run --credit-ceiling N]
//                                     Dreamina video from the Blender render (Seedance: the clip steers the motion;
//                                     Grok: first frame only). Without --run it only saves the node and quotes.  -> ai.mp4
//   node scripts/blender.mjs compare --name bakery-test     every finished version side by side        -> compare.mp4
//   node scripts/blender.mjs all     --name bakery-test     all of the above in order (skips Blender steps when Blender is missing)
// Blender: --blender <path to blender.exe>, or BLENDER_EXE, or the newest install under Program Files\Blender Foundation.
// Files: out/_blender/<name>/ ; the baked set is copied to public/_blender/<name>/ so the renderer can load it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { ROOT, ConfigError, readJson, writeJson } from "./lib/config.mjs";
import { dm } from "./lib/dreamina.mjs";
import { findBlender as findBlenderAt } from "./lib/blender-exe.mjs";

const args = {}; const av = process.argv.slice(2), cmd = av[0] && !av[0].startsWith("--") ? av.shift() : "all";
for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) args[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith("--") ? av[++i] : true;
const name = String(args.name ?? "bakery-test"), DIR = path.join(ROOT, "out", "_blender", name), PUB = path.join(ROOT, "public", "_blender", name);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const tlFile = path.join(DIR, "timeline.json");

export const findBlender = () => findBlenderAt(args.blender);
const findChrome = () => [process.env.FOOD_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((x) => x && fs.existsSync(x));
const tmpDir = () => { const d = process.env.REMOTION_TMP || path.join(ROOT, ".cache", "remotion-tmp"); fs.mkdirSync(d, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = d; };
let served = null;
const serve = async () => {
  if (served) return served;
  tmpDir();
  const { bundle } = await import("@remotion/bundler");
  console.log("Đóng gói dự án...");
  served = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
  return served;
};
const loadTl = () => { if (!fs.existsSync(tlFile)) throw new ConfigError(`Chưa có ${rel(tlFile)}: chạy "make" trước`); return readJson(tlFile); };

// ------------------------------------------------------------------ make: a one-shot test clip cut from an episode
const make = () => {
  const ep = String(args.episode ?? "croissant"), src = readJson(path.join(ROOT, "episodes", ep, "short", "timeline.json"));
  const base = src.shots.find((s) => s.id === String(args.shot ?? "q05")); if (!base) throw new ConfigError(`Không có shot ${args.shot} trong ${ep}`);
  const N = Number(args.frames ?? 150), [from, to] = String(args.camera ?? "main:table").split(":");
  const params = { ...base.params, ...(base.scene === "bakery" ? { era: "1839", items: "croissant", action: "knead" } : {}), ...(args.params ? JSON.parse(args.params) : {}) };
  const shot = { ...base, id: "T1", a: 0, b: N, startSec: 0, camera: to ? { from, to, ease: "smooth" } : from, params, light: args.light ?? null, legend: false, static: false, transition: "cut", claims: [], label: null };
  const tl = { ...src, slug: `_blender-${name}`, timing: "aligned", totalFrames: N, durationSec: N / src.fps, captions: false, labels: false, words: [], segments: [], events: [], placeholders: [],
    chapters: [{ id: shot.chapter, title: "test", startSec: 0, endSec: N / src.fps, startFrame: 0, endFrame: N }], shots: [shot] };
  writeJson(tlFile, tl);
  console.log(`Cảnh thử ${N} frame (${(N / src.fps).toFixed(1)}s), ${base.scene}, camera ${from}${to ? " -> " + to : ""}, ${JSON.stringify(params)} -> ${rel(tlFile)}`);
};

// ------------------------------------------------------------------ export: set + camera + cards for Blender
const exportShot = async () => {
  const tl = loadTl(), a = 0, b = tl.totalFrames - 1;
  fs.rmSync(path.join(DIR, "cards"), { recursive: true, force: true });
  const got = [];
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") { res.end(); return; }
    const file = decodeURIComponent((req.url ?? "/").slice(1));
    if (req.method !== "POST" || !file || file.includes("..")) { res.statusCode = 400; res.end(); return; }
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { const out = path.join(DIR, file); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.concat(chunks)); got.push(file); res.end("ok"); });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const sink = `http://127.0.0.1:${server.address().port}`;
  try {
    const serveUrl = await serve(), { renderStill, selectComposition } = await import("@remotion/renderer");
    const browserExecutable = findChrome(), chromiumOptions = { gl: args.gl ?? "angle" }, inputProps = { timeline: tl, a, b, sink };
    const composition = await selectComposition({ serveUrl, id: "BlenderExport", inputProps, browserExecutable, chromiumOptions });
    let err = null; const t0 = Date.now();
    await renderStill({ composition, serveUrl, frame: 0, output: path.join(DIR, "_export.jpg"), imageFormat: "jpeg", scale: 0.05, inputProps, browserExecutable, chromiumOptions, timeoutInMilliseconds: 900000, logLevel: "error",
      onBrowserLog: (l) => { if (l.text.startsWith("BLENDER_EXPORT_ERROR")) err = l.text; else if (l.type === "error") console.log(`[trình duyệt] ${l.text.slice(0, 240)}`); } });
    fs.rmSync(path.join(DIR, "_export.jpg"), { force: true });
    if (err) throw new Error(err);
    const sc = readJson(path.join(DIR, "scene.json"));
    console.log(`Xuất xong trong ${((Date.now() - t0) / 1000).toFixed(0)}s: set.glb ${(fs.statSync(path.join(DIR, "set.glb")).size / 1e6).toFixed(1)} MB, ${sc.statics.length} vật đứng yên, ${Object.keys(sc.dynamic).length} vật chuyển động, ${sc.cards.length} nhân vật, ${got.filter((f) => f.startsWith("cards/")).length} hình vẽ nhân vật -> ${rel(DIR)}`);
  } finally { server.close(); }
};

// ------------------------------------------------------------------ three: the shot rendered by the video's own renderer
const three = async (baked) => {
  const tl = loadTl();
  if (baked) {
    const sc = readJson(path.join(DIR, "scene.json"));
    for (const f of ["set-baked.glb", "lightmap.png"]) if (!fs.existsSync(path.join(DIR, f))) throw new ConfigError(`Chưa có ${f}: chạy "bake" trước`);
    fs.mkdirSync(PUB, { recursive: true });
    fs.copyFileSync(path.join(DIR, "set-baked.glb"), path.join(PUB, "set-baked.glb")); fs.copyFileSync(path.join(DIR, "lightmap.png"), path.join(PUB, "lightmap.png"));
    tl.assets = { ...tl.assets, [`_baked/${sc.scene}`]: `_blender/${name}/set-baked.glb`, [`_baked/${sc.scene}-light`]: `_blender/${name}/lightmap.png` };
  }
  const serveUrl = await serve(), { renderMedia, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = findChrome(), chromiumOptions = { gl: args.gl ?? "angle" }, inputProps = { timeline: tl, mode: "final" };
  const composition = await selectComposition({ serveUrl, id: "FoodEpisode", inputProps, browserExecutable, chromiumOptions });
  const out = path.join(DIR, baked ? "threejs-baked.mp4" : "threejs.mp4"), t0 = Date.now(); let last = -1;
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: out, inputProps, crf: 18, muted: true, browserExecutable, chromiumOptions, timeoutInMilliseconds: 240000,
    concurrency: Math.min(6, Math.max(2, Math.floor(os.cpus().length / 3))),
    onBrowserLog: (l) => { if (l.type === "error") console.log(`[trình duyệt] ${l.text.slice(0, 240)}`); },
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; process.stdout.write(`\r  three.js${baked ? " (đã nướng sáng)" : ""}: ${p * 10}%  `); } } });
  console.log(`\r  three.js${baked ? " (đã nướng sáng)" : ""}: xong trong ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${rel(out)}`);
};

// ------------------------------------------------------------------ stills: a few three.js frames for framing a shot fast
const stills = async () => {
  const tl = loadTl(), N = tl.totalFrames, at = String(args.at ?? `0,${Math.floor(N / 2)},${N - 1}`).split(",").map(Number);
  const serveUrl = await serve(), { renderStill, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = findChrome(), chromiumOptions = { gl: args.gl ?? "angle" }, inputProps = { timeline: tl, mode: "final" };
  const composition = await selectComposition({ serveUrl, id: "FoodEpisode", inputProps, browserExecutable, chromiumOptions });
  const dir = path.join(DIR, "stills"); fs.mkdirSync(dir, { recursive: true });
  for (const fr of at) { const out = path.join(dir, `f${String(fr).padStart(3, "0")}.jpg`);
    await renderStill({ composition, serveUrl, frame: fr, output: out, imageFormat: "jpeg", scale: Number(args.scale ?? 0.5), inputProps, browserExecutable, chromiumOptions, timeoutInMilliseconds: 240000, logLevel: "error" });
    console.log("  " + rel(out)); }
};

// ------------------------------------------------------------------ Blender steps
const blender = (script, extra = []) => {
  const exe = findBlender();
  if (!exe) throw new ConfigError("Chưa tìm thấy Blender. Cài Blender rồi chạy lại, hoặc chỉ đường dẫn: --blender \"C:/.../blender.exe\" (hoặc biến môi trường BLENDER_EXE).");
  if (!fs.existsSync(path.join(DIR, "scene.json"))) throw new ConfigError(`Chưa có ${rel(path.join(DIR, "scene.json"))}: chạy "export" trước`);
  const t0 = Date.now();
  const r = spawnSync(exe, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", path.join(ROOT, "blender", script), "--", DIR, ...extra], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 1 << 28 });
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
  for (const l of lines) if (/^(\[cb\]|Error|Traceback|  File|\w+Error)/.test(l)) console.log("  " + l);
  if (r.status !== 0) { fs.writeFileSync(path.join(DIR, `${script}.log`), `${r.stdout}\n${r.stderr}`); throw new Error(`Blender (${script}) lỗi, mã ${r.status}. Nhật ký: ${rel(path.join(DIR, `${script}.log`))}`); }
  console.log(`  Blender ${script}: xong trong ${((Date.now() - t0) / 1000).toFixed(0)}s`);
};
const ffmpeg = (a) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: "inherit" }); if (r.status !== 0) throw new Error("ffmpeg lỗi"); };
const render = () => {
  blender("render.py", ["samples", "exposure", "sky", "glow", "cardglow", "ink", "upgrade", "bevel", "relief", "lamp", "atmo", "worldcool", "sunsat", "rt"].flatMap((k) => (args[k] !== undefined && args[k] !== true ? [`--${k}`, String(args[k])] : [])));
  const sc = readJson(path.join(DIR, "scene.json")), out = path.join(DIR, "blender.mp4");
  // finish with the same colour grade as the three.js renderer (FOOD_GRADES of the shot's light), unless --nograde
  let frames = path.join(DIR, "frames");
  if (!args.nograde && sc.grade) {
    const g = path.join(DIR, "frames_graded"), py = process.platform === "win32" ? "python" : "python3";
    fs.rmSync(g, { recursive: true, force: true });
    const r = spawnSync(py, [path.join(ROOT, "scripts", "grade_frames.py"), path.join(DIR, "scene.json"), frames, g], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`grade_frames.py lỗi: ${(r.stderr || r.stdout).slice(-400)}`);
    console.log(`  ${r.stdout.trim()}`); frames = g;
  }
  ffmpeg(["-framerate", String(sc.fps), "-i", path.join(frames, "f%04d.png"), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out]);
  console.log(`  -> ${rel(out)}`);
};
const VERSIONS = [["threejs.mp4", "three.js (hien tai)"], ["threejs-baked.mp4", "Blender nuong sang + three.js"], ["blender.mp4", "Blender render"], ["ai.mp4", "Dreamina AI"]];
const compare = () => {
  const have = VERSIONS.filter(([f]) => fs.existsSync(path.join(DIR, f)));
  if (have.length < 2) throw new ConfigError("Cần ít nhất 2 bản để so sánh");
  const font = "C\\:/Windows/Fonts/segoeuib.ttf", inputs = have.flatMap(([f]) => ["-i", path.join(DIR, f)]);
  const chains = have.map(([, label], i) => `[${i}:v]fps=30,scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1,drawtext=fontfile='${font}':text='${label}':x=(w-tw)/2:y=24:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10[v${i}]`);
  const out = path.join(DIR, "compare.mp4");
  ffmpeg([...inputs, "-filter_complex", `${chains.join(";")};${have.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${have.length},trim=duration=5[o]`, "-map", "[o]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", out]);
  console.log(`So sánh ${have.length} bản -> ${rel(out)}`);
};

// ------------------------------------------------------------------ ai: Dreamina video steered by the Blender render
// The look level follows skill/cartoon-3d-short/templates/VISUAL_DENSITY.md ("stylised cartoon game world, not a photo").
// Two lessons: "richly detailed film" (street test, 2026-11-22) came out too realistic; a strict "keep exactly, add
// nothing" (bakery-move v1, 2026-11-23) returned a near copy of the guide with no gain. The middle prompt keeps layout,
// camera, objects and characters but asks the model to RE-LIGHT and RE-TEXTURE at the cartoon level.
const AI_LOOK = "Re-light and re-texture this shot as a stylized cartoon 3D world: warm light pools from the visible light sources " +
  "(fire, windows, lamps) with soft falloff into cooler shade, soft contact shadows and gentle bounce light; clean hand-painted " +
  "textures with visible wood grain, brick, plaster and stone; simple rounded shapes; bold black ink outlines on characters and main " +
  "objects; natural colours slightly brighter than life. NOT photorealistic: no grime, no film grain, no lens flare.";
const AI_KEEP = "Keep the same camera move, framing, timing, layout and objects of the reference video; do not add new objects or " +
  "people. Keep every character as the same flat 2D stick-figure cartoon (big round head, small body, thin stick limbs, bold ink " +
  "outline) with the same clothes, pose and action. No text, no captions, no logos, no watermark.";
const AI_DESC = {
  bakery: "A small Paris bakery workshop in the 1830s at dawn: brick bread oven with a glowing wood fire, lime-plaster walls with dark timber " +
    "framing, wooden shelves of loaves, copper pans on the wall, flour sacks, a wooden kneading trough, stone floor, warm window light.",
  street: "A Paris street in the 1830s: a small bakery shopfront with a painted sign, tall townhouses with shutters, cobblestones, " +
    "people queueing at the door, soft daylight.",
};
const ai = () => {
  const model = String(args.model ?? "seedance_2.0"), seed = model.startsWith("seedance");
  const src = ["blender.mp4", "threejs-baked.mp4", "threejs.mp4"].map((f) => path.join(DIR, f)).find((f) => fs.existsSync(f));
  if (!src) throw new ConfigError("Chưa có bản render nào để làm mốc (chạy render hoặc three trước)");
  const stFile = path.join(DIR, "dreamina.json"), st = fs.existsSync(stFile) ? readJson(stFile) : { refs: {} };
  if (!st.projectId) { const d = dm(["canvas", "create", "Crumb Trail - Blender tests"]); st.projectId = d.project.projectId; st.webUrl = d.project.webUrl; writeJson(stFile, st); }
  const up = (file) => { const sig = `${file}|${fs.statSync(file).mtimeMs}`; if (!st.refs[sig]) { st.refs[sig] = dm(["resource", "upload", "--project-id", st.projectId, "--file", file]).resourceId; writeJson(stFile, st); } return st.refs[sig]; };
  const first = path.join(DIR, "ai-first.png");
  ffmpeg(["-i", src, "-frames:v", "1", first]);
  // extra image refs for Seedance (max 9 images): the channel's character sheet, plus --refs a.png,b.png
  const extra = seed ? [path.join(ROOT, "..", "..", "brand", "character", "stick-turnaround.png"), ...String(args.refs ?? "").split(",").filter(Boolean).map((f) => path.resolve(ROOT, f))].filter((f) => fs.existsSync(f)) : [];
  const refs = seed ? [`res:${up(src)}`, `res:${up(first)}`, ...extra.map((f) => `res:${up(f)}`)] : [`res:${up(first)}`];
  const sceneId = fs.existsSync(path.join(DIR, "scene.json")) ? readJson(path.join(DIR, "scene.json")).scene : "";
  const AI_PROMPT = [args.desc && args.desc !== true ? String(args.desc) : AI_DESC[sceneId] ?? "", AI_LOOK, AI_KEEP].filter(Boolean).join(" ");
  const key = `${model}|${path.basename(src)}|v3`, gen = ["--project-id", st.projectId, "--model", model, "--mode", seed ? "m2v" : "first_last_frame", "--ratio", "9:16",
    "--resolution", seed ? "720p" : "720P", "--duration", "5", ...refs.flatMap((r) => ["--ref", r]), "--prompt", AI_PROMPT];
  st.nodes ??= {};
  const node = st.nodes[key] ? dm(["node", "edit", "video", "--node-id", st.nodes[key], ...gen]).node.nodeId : dm(["node", "create", "video", "--title", `ai ${model}`, "--x", "0", "--y", "0", ...gen]).node.nodeId;
  st.nodes[key] = node; writeJson(stFile, st);
  const q = dm(["node", "quote", "--project-id", st.projectId, "--node-id", node]);
  console.log(`Clip AI ${model} 720p 5s, mốc: ${path.basename(src)}${seed ? ` (video dẫn chuyển động + ${extra.length + 1} ảnh tham chiếu)` : " (chỉ khung đầu)"}. Báo giá: ${q.totalMaxCredits} credit.`);
  if (!args.run) { console.log(`Chưa tạo. Khi đã duyệt: node scripts/blender.mjs ai --name ${name} --model ${model} --run --credit-ceiling ${q.totalMaxCredits}`); return; }
  const ceiling = Number(args["credit-ceiling"]);
  if (!Number.isFinite(ceiling)) throw new ConfigError("--run cần --credit-ceiling <số credit đã duyệt>");
  if (q.totalMaxCredits > ceiling) throw new ConfigError(`Báo giá ${q.totalMaxCredits} vượt mức duyệt ${ceiling}. Không chạy.`);
  const conf = q.confirmationRequired ? dm(["node", "confirm", "--project-id", st.projectId, "--node-id", node, "--credit-ceiling", String(ceiling)]) : {};
  dm(["node", "run", "--project-id", st.projectId, "--node-id", node, "--submit-id", crypto.randomUUID(), ...(conf.creditConfirmationToken ? ["--credit-token", conf.creditConfirmationToken] : [])]);
  console.log("Đã gửi, đang chờ Dreamina (video có thể mất vài phút)...");
  const t0 = Date.now(); let n;
  for (;;) {
    n = dm(["node", "show", "--project-id", st.projectId, "--node-id", node]).nodes[0].node;
    if (["success", "failed", "fail", "error"].includes(n.status)) break;
    if (Date.now() - t0 > 30 * 60e3) throw new ConfigError(`Quá 30 phút. Kiểm tra lại: node ${node} trên ${st.webUrl}`);
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
  }
  const r = (n.resources ?? []).find((x) => x.status === "success");
  if (!r) throw new ConfigError(`Dreamina báo lỗi (${n.status}). Node ${node}`);
  const out = path.join(DIR, "ai.mp4"), part = `${out}.${r.resourceId.slice(0, 8)}.part`; if (fs.existsSync(part)) fs.rmSync(part);
  dm(["resource", "download", r.resourceId, "--project-id", st.projectId, "-o", part]); fs.renameSync(part, out);
  console.log(`Xong (${r.creditsAmount ?? q.totalMaxCredits} credit) -> ${rel(out)}`);
};

try {
  fs.mkdirSync(DIR, { recursive: true });
  if (cmd === "make") make();
  else if (cmd === "export") await exportShot();
  else if (cmd === "three") await three(!!args.baked);
  else if (cmd === "stills") await stills();
  else if (cmd === "bake") blender("bake.py", args.res ? ["--res", String(args.res)] : []);
  else if (cmd === "render") render();
  else if (cmd === "compare") compare();
  else if (cmd === "ai") ai();
  else if (cmd === "all") {
    if (!fs.existsSync(tlFile) || args.remake) make();
    await exportShot(); await three(false);
    if (findBlender()) { blender("bake.py"); await three(true); render(); compare(); } else console.log("Chưa có Blender: bỏ qua bước nướng sáng, render Blender và so sánh.");
  } else throw new ConfigError(`Lệnh lạ: ${cmd} (make | export | three | stills | bake | render | ai | compare | all)`);
} catch (e) { console.error(e instanceof ConfigError ? e.message : e?.stack ?? e); process.exit(1); }
