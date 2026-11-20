// Dreamina CLI bridge for image textures (walls, facades, floors, skies, backdrops) used by the 3D scenes.
// The official CLI (dreamina-canvas) is driven as a subprocess with --format json; nothing here talks to Dreamina directly.
// Credits are only spent by runTextures(), and only under a ceiling the user approved (server-side credit token).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { ROOT, ConfigError, readJson, writeJson } from "./config.mjs";

export const dreaminaBin = () => {
  if (process.env.DREAMINA_CLI) return process.env.DREAMINA_CLI;
  const def = "D:/CLI/dreamina/dreamina-canvas.exe";
  return fs.existsSync(def) ? def : "dreamina-canvas";
};
/** run one CLI command and return its `data` (throws ConfigError with the CLI's own message on failure) */
export const dm = (args, { bin = dreaminaBin() } = {}) => {
  let out;
  try { out = execFileSync(bin, ["--format", "json", "--non-interactive", ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String(e.stdout || ""); if (!out.trim()) throw new ConfigError(`Dreamina CLI lỗi (${args.slice(0, 3).join(" ")}): ${String(e.stderr || e.message).slice(0, 400)}`); }
  let j; try { j = JSON.parse(out); } catch { throw new ConfigError(`Dreamina CLI trả về không phải JSON: ${out.slice(0, 300)}`); }
  if (!j.ok) { const d = (j.error?.diagnostics ?? []).map((x) => x.detail).join("; "); throw new ConfigError(`Dreamina: ${j.error?.message ?? "lỗi"}${d ? ` (${d})` : ""} [mã ${j.error?.code}]`); }
  return j.data;
};

/** the selected texture assets and, per asset, the keys still to make (or all keys with force) */
export const planTextures = (manifest, { ids = null, force = false, pub = path.join(ROOT, "public") } = {}) => {
  const items = [];
  for (const a of manifest.assets) {
    if (a.kind !== "texture" || !a.generator) continue;
    if (ids && !ids.includes(a.id)) continue;
    for (const [key, prompt] of Object.entries(a.generator.prompts)) {
      const file = a.files[key], have = !!file && fs.existsSync(path.join(pub, file));
      if (have && !force) continue;
      items.push({ asset: a, key, prompt, target: `${a.targetDir}/${key}.png` });
    }
  }
  if (ids) for (const id of ids) if (!manifest.assets.some((a) => a.id === id && a.kind === "texture" && a.generator)) throw new ConfigError(`Không có texture "${id}" có phần generator trong asset-manifest.json`);
  return items;
};

/** per-episode Dreamina canvas + uploaded reference cache, kept in episodes/<slug>/dreamina.json */
const stateFile = (epDir) => path.join(epDir, "dreamina.json");
const loadState = (epDir) => (fs.existsSync(stateFile(epDir)) ? readJson(stateFile(epDir)) : { projectId: null, webUrl: null, refs: {} });
const ensureCanvas = (epDir, slug, st) => {
  if (st.projectId) return st;
  const d = dm(["canvas", "create", `Crumb Trail - ${slug} textures`]);
  st.projectId = d.project.projectId; st.webUrl = d.project.webUrl; writeJson(stateFile(epDir), st); return st;
};
const refFor = (epDir, st, ref) => {
  const abs = path.isAbsolute(ref) ? ref : path.join(ROOT, ref);
  if (!fs.existsSync(abs)) throw new ConfigError(`Ảnh mẫu không có: ${ref}`);
  const sig = `${abs}|${fs.statSync(abs).mtimeMs}`;
  if (!st.refs[sig]) { st.refs[sig] = dm(["resource", "upload", "--project-id", st.projectId, "--file", abs]).resourceId; writeJson(stateFile(epDir), st); }
  return st.refs[sig];
};

/** save (create or edit) one node per planned texture; returns [{...item, nodeId}] — saving is free */
export const saveNodes = (ep, items) => {
  const st = ensureCanvas(ep.p.ep, ep.slug, loadState(ep.p.ep));
  return items.map((it) => {
    const g = it.asset.generator, refs = g.refs.map((r) => `res:${refFor(ep.p.ep, st, r)}`);
    const gen = ["--project-id", st.projectId, "--model", g.model, "--mode", refs.length ? "i2i" : "t2i", "--ratio", g.ratio, "--resolution", g.resolution, "--count", "1", ...refs.flatMap((r) => ["--ref", r]), "--prompt", it.prompt];
    const prev = g.runs?.[it.key]?.nodeId;
    const d = prev ? dm(["node", "edit", "image", "--node-id", prev, ...gen]) : dm(["node", "create", "image", "--title", `${it.asset.id}/${it.key}`, ...gen]);
    return { ...it, nodeId: d.node.nodeId, projectId: st.projectId, webUrl: st.webUrl };
  });
};
export const quoteNodes = (projectId, nodeIds) => {
  const d = dm(["node", "quote", "--project-id", projectId, ...nodeIds.flatMap((n) => ["--node-id", n])]);
  return { total: d.totalMaxCredits, items: Object.fromEntries(d.items.map((x) => [x.nodeId, x.maxCredits])), confirmationRequired: d.confirmationRequired };
};
/** run the saved nodes under an approved ceiling, wait, download into public/, and record the run in the manifest entry */
export const runNodes = (ep, saved, ceiling, { log = console.log, timeoutSec = 600, pub = path.join(ROOT, "public") } = {}) => {
  const projectId = saved[0].projectId, ids = saved.map((s) => s.nodeId), q = quoteNodes(projectId, ids);
  if (q.total > ceiling) throw new ConfigError(`Báo giá ${q.total} credit vượt mức đã duyệt ${ceiling}. Không chạy gì.`);
  const nodeArgs = ids.flatMap((n) => ["--node-id", n]);
  const conf = q.confirmationRequired ? dm(["node", "confirm", "--project-id", projectId, ...nodeArgs, "--credit-ceiling", String(ceiling)]) : {};
  const submit = ids.flatMap(() => ["--submit-id", crypto.randomUUID()]);
  dm(["node", "run", "--project-id", projectId, ...nodeArgs, ...submit, ...(conf.creditConfirmationToken ? ["--credit-token", conf.creditConfirmationToken] : [])]);
  log(`Đã gửi ${ids.length} ảnh (tối đa ${q.total} credit). Đang chờ Dreamina...`);
  const t0 = Date.now(); let nodes = [];
  for (;;) {
    nodes = dm(["node", "show", "--project-id", projectId, ...nodeArgs]).nodes.map((n) => n.node);
    const busy = nodes.filter((n) => !["success", "failed", "fail", "error"].includes(n.status));
    if (!busy.length) break;
    if ((Date.now() - t0) / 1000 > timeoutSec) throw new ConfigError(`Quá ${timeoutSec}s mà còn ${busy.length} ảnh chưa xong. Chạy lại lệnh với cùng tham số để kiểm tra; không tạo node mới.`);
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},6000)"]); // plain wait between polls
  }
  const results = [];
  for (const s of saved) {
    const n = nodes.find((x) => x.nodeId === s.nodeId), r = (n?.resources ?? []).find((x) => x.status === "success");
    if (!r) { results.push({ ...s, ok: false }); continue; }
    const out = path.join(pub, s.target), part = `${out}.${r.resourceId.slice(0, 8)}.part`; fs.mkdirSync(path.dirname(out), { recursive: true });
    // the CLI refuses an existing destination: download beside it, then replace (a --force remake keeps the old file until the new one is here)
    if (fs.existsSync(part)) fs.rmSync(part);
    dm(["resource", "download", r.resourceId, "--project-id", projectId, "-o", part]);
    fs.renameSync(part, out);
    results.push({ ...s, ok: true, resourceId: r.resourceId, credits: r.creditsAmount ?? q.items[s.nodeId] ?? null, file: s.target });
  }
  // record in the manifest: files, status, and the run (node, resource, credits) per key
  const mf = readJson(ep.p.manifest), now = new Date().toISOString();
  for (const r of results) {
    const a = mf.assets.find((x) => x.id === r.asset.id); a.generator.runs ??= {};
    a.generator.runs[r.key] = { nodeId: r.nodeId, resourceId: r.resourceId ?? null, credits: r.credits ?? null, at: now };
    if (r.ok) a.files[r.key] = r.file;
    const done = Object.keys(a.generator.prompts).every((k) => a.files[k] && fs.existsSync(path.join(pub, a.files[k])));
    a.status = done ? (a.status === "validated" ? "validated" : "downloaded") : "missing";
  }
  writeJson(ep.p.manifest, mf);
  return results;
};
