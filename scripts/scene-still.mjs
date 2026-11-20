// Render check stills of ONE scene without an episode (scene / asset checks in any aspect ratio).
//   node scripts/scene-still.mjs --scene pastry [--params '{"item":"cut"}'] [--camera macro] [--aspect 9:16,16:9] [--at 0.1,0.5,0.9]
//        [--light table] [--legend] [--assets episodes/<slug>/asset-manifest.json] [--out out/_scenes] [--scale 0.5]
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { ROOT, sizeForAspect, readJson } from "./lib/config.mjs";

const a = {}; const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith("--") ? av[++i] : true;
if (!a.scene) { console.log("Thiếu --scene <id>"); process.exit(1); }
const tmp = process.env.REMOTION_TMP || path.join(ROOT, ".cache", "remotion-tmp"); fs.mkdirSync(tmp, { recursive: true }); process.env.TEMP = process.env.TMP = tmp;
const chrome = [process.env.FOOD_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((x) => x && fs.existsSync(x));
const dur = Number(a.frames ?? 150), outDir = path.resolve(ROOT, a.out ?? "out/_scenes"); fs.mkdirSync(outDir, { recursive: true });
let assets = {};
if (a.assets) { // same key -> file mapping the timeline command produces
  const pub = path.join(ROOT, "public"), walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  for (const as of readJson(path.resolve(ROOT, a.assets)).assets) { const ext = as.kind === "texture" ? /\.(png|jpe?g|webp)$/i : /\.(glb|gltf)$/i, files = walk(path.join(pub, as.targetDir)).filter((f) => ext.test(f));
    for (const k of Object.keys(as.files)) { const hit = files.find((f) => path.basename(f).replace(ext, "").toLowerCase() === k.toLowerCase()); if (hit) assets[`${as.id}/${k}`] = path.relative(pub, hit).replace(/\\/g, "/"); } }
}
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
const events = a.actions ? JSON.parse(a.actions).map((e) => ({ type: "action", name: e.name, shot: "s", sec: e.t, frame: Math.round(e.t * 30), gainDb: 0, durSec: null })) : [];
for (const aspect of String(a.aspect ?? "9:16,16:9").split(",")) {
  const { width, height } = sizeForAspect(aspect);
  const timeline = { version: 1, slug: "scene-check", format: "short", timing: "aligned", locale: "en-US", fps: 30, width, height, aspectRatio: aspect, totalFrames: dur, durationSec: dur / 30, captions: false, labels: !!a.labels,
    chapters: [], segments: [], words: [], events, placeholders: [], assets,
    shots: [{ id: "s", scene: a.scene, a: 0, b: dur, startSec: 0, chapter: "c", camera: a.camera ?? "main", params: a["params-file"] ? JSON.parse(fs.readFileSync(a["params-file"], "utf8")) : a.params ? JSON.parse(a.params) : {}, light: a.light ?? null, legend: !!a.legend, static: false, transition: "cut", claims: [], assets: [], label: null, seed: 7 }] };
  const inputProps = { timeline, mode: "final" }, chromiumOptions = { gl: "angle" };
  const composition = await selectComposition({ serveUrl, id: "FoodEpisode", inputProps, browserExecutable: chrome, chromiumOptions });
  for (const u of String(a.at ?? "0.5").split(",").map(Number)) {
    const frame = Math.min(dur - 1, Math.round(u * (dur - 1))), tag = a.tag ? `_${a.tag}` : "", out = path.join(outDir, `${a.scene}${tag}_${a.camera ?? "main"}_${aspect.replace(":", "x")}_f${frame}.jpg`);
    await renderStill({ composition, serveUrl, frame, output: out, imageFormat: "jpeg", jpegQuality: 90, scale: Number(a.scale ?? 0.5), inputProps, browserExecutable: chrome, chromiumOptions, timeoutInMilliseconds: 240000,
      onBrowserLog: (l) => { if (l.type === "error") console.log("[trình duyệt]", l.text.slice(0, 300)); } });
    console.log(path.relative(ROOT, out).replace(/\\/g, "/"));
  }
}
