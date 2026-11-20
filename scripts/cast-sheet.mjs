// Render a character sheet with the video's own character code (src/core/CastSheet.tsx).
//   node scripts/cast-sheet.mjs --who chef [--v 0] [--out out/_cast]
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { ROOT } from "./lib/config.mjs";

const a = {}; const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith("--") ? av[++i] : true;
const who = String(a.who ?? "chef"), v = Number(a.v ?? 0), outDir = path.resolve(ROOT, a.out ?? "out/_cast"); fs.mkdirSync(outDir, { recursive: true });
const tmp = process.env.REMOTION_TMP || path.join(ROOT, ".cache", "remotion-tmp"); fs.mkdirSync(tmp, { recursive: true }); process.env.TEMP = process.env.TMP = tmp;
const chrome = [process.env.FOOD_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((x) => x && fs.existsSync(x));
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public"), outDir: path.join(ROOT, ".cache", "bundle") });
const inputProps = { who, v }, composition = await selectComposition({ serveUrl, id: "CastSheet", inputProps, browserExecutable: chrome });
const out = path.join(outDir, `${who}-v${v}.png`);
await renderStill({ composition, serveUrl, frame: 0, output: out, inputProps, browserExecutable: chrome, imageFormat: "png" });
console.log(path.relative(ROOT, out).split(path.sep).join("/"));
