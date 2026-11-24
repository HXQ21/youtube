// node --test tests/        (no network, no API credits: every ElevenLabs call here goes to an injected fake fetch)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "food-test-"));
const epDir = path.join(tmp, "episodes");
fs.cpSync(path.resolve("episodes/croissant"), path.join(epDir, "croissant"), { recursive: true, filter: (s) => !/[\\/](voice|audio)([\\/]|$)/.test(s) && !/timeline.*\.json$/.test(s) });
process.env.FOOD_EPISODES_DIR = epDir;
process.env.FOOD_OUT_DIR = path.join(tmp, "out"); // status files written by CLI runs in the tests stay out of the real out/
const cfg = await import("../scripts/lib/config.mjs");
const tlm = await import("../scripts/lib/timeline.mjs");
const el = await import("../scripts/lib/eleven.mjs");
const edit = (rel, fn) => { const f = path.join(epDir, "croissant", rel), j = JSON.parse(fs.readFileSync(f, "utf8")); fn(j); fs.writeFileSync(f, JSON.stringify(j)); };
const restore = (rel) => fs.copyFileSync(path.resolve("episodes/croissant", rel), path.join(epDir, "croissant", rel));

// ------------------------------------------------------------ presets and overrides
test("presets: short is 75 s vertical, long is 600 s (480-720) horizontal, both 30 fps; Shorts carry captions", () => {
  assert.deepEqual(cfg.resolveRender("short"), { format: "short", targetDurationSec: 75, minDurationSec: 60, maxDurationSec: 90, aspectRatio: "9:16", width: 1080, height: 1920, fps: 30, captions: true, labels: false });
  const l = cfg.resolveRender("long");
  assert.equal(l.targetDurationSec, 600); assert.equal(l.minDurationSec, 480); assert.equal(l.maxDurationSec, 720); assert.equal(`${l.width}x${l.height}`, "1920x1080");
});
test("override order: preset, then episode file, then CLI", () => {
  const r = cfg.resolveRender("short", { aspectRatio: "1:1", captions: true }, { aspectRatio: "16:9" });
  assert.equal(`${r.width}x${r.height}`, "1920x1080"); assert.equal(r.aspectRatio, "16:9"); assert.equal(r.captions, true);
});
test("aspect only derives the size; neither format is locked to an orientation", () => {
  assert.equal(`${cfg.resolveRender("long", {}, { aspectRatio: "9:16" }).width}x${cfg.resolveRender("long", {}, { aspectRatio: "9:16" }).height}`, "1080x1920");
  const sq = cfg.resolveRender("short", {}, { aspectRatio: "4:5" }); assert.equal(`${sq.width}x${sq.height}`, "1080x1350");
  const w = cfg.resolveRender("short", {}, { width: 720 }); assert.equal(w.height, 1280);
});
test("size that contradicts the aspect ratio is an error, not a silent crop", () => {
  assert.throws(() => cfg.resolveRender("short", {}, { aspectRatio: "16:9", width: 1000, height: 1000 }), /mâu thuẫn/);
  assert.equal(cfg.resolveRender("short", {}, { aspectRatio: "16:9", width: 1280, height: 720 }).width, 1280);
});
test("a new duration keeps a window around it and is never forced back to the preset", () => {
  const r = cfg.resolveRender("long", {}, { targetDurationSec: 900 });
  assert.equal(r.targetDurationSec, 900); assert.equal(r.minDurationSec, 720); assert.equal(r.maxDurationSec, 1080);
  assert.throws(() => cfg.resolveRender("long", {}, { targetDurationSec: 900, maxDurationSec: 800 }), /Khoảng thời lượng/);
  assert.throws(() => cfg.resolveRender("medium"), /Format không hợp lệ/);
  assert.throws(() => cfg.resolveRender("short", {}, { targetDurationSec: -5 }), /số giây dương/);
  assert.throws(() => cfg.parseAspect("wide"), /Tỷ lệ không hợp lệ/);
});

// ------------------------------------------------------------ episode validation (missing / wrong input)
test("the demo episode validates in both formats", () => {
  for (const f of ["short", "long"]) { const ep = cfg.loadEpisode("croissant", f); assert.deepEqual(ep.errors, [], f); }
});
test("a claim that no source backs, or a legend shown as fact, is rejected", () => {
  edit("short/script.json", (j) => { j.segments[0].claims = ["c99"]; });
  assert.match(cfg.loadEpisode("croissant", "short").errors.join("\n"), /claim "c99" không có/); restore("short/script.json");
  edit("short/storyboard.json", (j) => { j.shots.find((s) => s.id === "q11").legend = false; });
  assert.match(cfg.loadEpisode("croissant", "short").errors.join("\n"), /legend/); restore("short/storyboard.json");
  edit("short/storyboard.json", (j) => { j.shots[6].label = { text: "Vienna, 1683", claim: "c03" }; });
  assert.match(cfg.loadEpisode("croissant", "short").errors.join("\n"), /chỉ được dựa trên claim "documented"/); restore("short/storyboard.json");
  edit("sources.json", (j) => { j.claims[0].source_ids = ["nope"]; });
  assert.match(cfg.loadEpisode("croissant", "short").errors.join("\n"), /source_id "nope"/); restore("sources.json");
});
test("broken structure is reported with the file and field", () => {
  edit("short/storyboard.json", (j) => { delete j.shots[0].scene; });
  assert.throws(() => cfg.loadEpisode("croissant", "short"), /storyboard\.json[\s\S]*scene/); restore("short/storyboard.json");
  edit("short/storyboard.json", (j) => { j.shots[3].from = "s99"; });
  assert.match(cfg.loadEpisode("croissant", "short").errors.join("\n"), /đoạn lời "s99" không tồn tại/); restore("short/storyboard.json");
  assert.throws(() => cfg.loadEpisode("no-such-dish", "short"), /Không có tập/);
});

// ------------------------------------------------------------ timeline
test("seconds -> frames are integers; shots tile the film exactly; events land inside it", () => {
  assert.equal(tlm.toFrame(1.0167, 30), 31); assert.equal(tlm.toFrame(0.0166, 30), 0);
  for (const f of ["short", "long"]) {
    const ep = cfg.loadEpisode("croissant", f), tr = tlm.estimateTranscript(ep.script, ep.config.estimateWpm, ep.config.leadInSec), tl = tlm.buildTimeline(ep, tr);
    assert.deepEqual(tlm.checkTimeline(tl), []); assert.equal(tl.timing, "estimated");
    assert.equal(tl.shots[0].a, 0); assert.equal(tl.shots.at(-1).b, tl.totalFrames);
    assert.equal(tl.totalFrames, Math.ceil((tr.audio.durationSec + ep.config.tailPadSec) * 30));
    for (const s of tl.shots) assert.ok(Number.isInteger(s.a) && Number.isInteger(s.b) && s.b > s.a, s.id);
    for (const e of tl.events) assert.ok(e.frame >= 0 && e.frame < tl.totalFrames, e.name);
    for (const c of tl.chapters) assert.ok(c.endFrame > c.startFrame, c.id);
  }
});
test("pace: shot lengths are checked against the type table; untyped shots are listed", () => {
  const mk = (pace, frames) => ({ id: `s${frames}`, pace, a: 0, b: frames });
  const tl = { fps: 30, shots: [mk("hook", 45), mk("story", 45), mk("process", 120), mk("process", 240), mk("insert", 75), mk("insert", 30), mk(undefined, 60), mk("story", 59)] };
  const { warnings, untyped } = tlm.checkPace(tl);
  assert.deepEqual(tlm.PACE, { hook: [1, 3], story: [2, 4], process: [3, 6], insert: [1, 2] });
  assert.equal(warnings.length, 2, warnings.join("\n"));            // story 1.5 s too short, insert 2.5 s too long
  assert.match(warnings[0], /s45 \(story\).*ngắn hơn 2s/); assert.match(warnings[1], /s75 \(insert\).*quá 2s/);
  assert.deepEqual(untyped, ["s60"]);                                 // 59 frames of story is within one frame of 2 s
  const ep = cfg.loadEpisode("croissant", "short"), tr = tlm.estimateTranscript(ep.script, ep.config.estimateWpm, ep.config.leadInSec);
  assert.ok(tlm.buildTimeline(ep, tr).shots.every((s) => s.pace), "every demo Short shot has a pace");
});

test("dish workflow: new scaffolds an episode and makes it current; stages are logged; the script check counts the template limits", async () => {
  const pl = await import("../scripts/lib/pipeline.mjs");
  const { made } = pl.scaffoldEpisode("test-dish", "Test Dish", ["short"]);
  assert.ok(made.includes("episode.json") && made.includes("short/config.json") && made.includes("sources.json"));
  assert.throws(() => pl.scaffoldEpisode("test-dish", "x"), /đã có/);
  assert.throws(() => pl.scaffoldEpisode("Bad Slug", "x"), /chữ thường/);
  assert.equal(pl.readPipe().current, "test-dish"); assert.equal(pl.resolveSlug("current"), "test-dish"); assert.equal(pl.resolveSlug("croissant"), "croissant");
  pl.updatePipe("test-dish", { stage: "script" }, "v1");
  const e = pl.readPipe().episodes["test-dish"]; assert.equal(e.stage, "script"); assert.equal(e.log.at(-1).note, "v1");
  assert.throws(() => pl.updatePipe("test-dish", { stage: "nope" }), /--stage/);
  const sources = { claims: [{ id: "c1", status: "documented" }, { id: "c2", status: "legend" }] };
  const script = { segments: [
    { id: "a", chapter: "x", text: "In 1830 and 1850 it changed.", claims: ["c1"] },
    { id: "b", chapter: "x", text: "It had twenty-seven layers and three folds, not hundreds.", claims: ["c2", "c9"] },
    { id: "c", chapter: "x", text: "This sentence is deliberately much longer than the limit allows so that the short check is clearly exceeded right here.", claims: [] }] };
  const r = pl.checkScript("short", script, sources);
  assert.equal(r.stats.years, 2); assert.equal(r.stats.numbers, 2); // "twenty-seven" counts once; vague "hundreds" is not data
  assert.match(r.errors.join(), /c9/); assert.deepEqual(r.stats.softClaims, ["b:c2=legend"]);
  assert.equal(r.warnings.length, 3, r.warnings.join("\n"));
  const demo = pl.checkScript("short", JSON.parse(fs.readFileSync(path.resolve("episodes/croissant/short/script.json"), "utf8")), JSON.parse(fs.readFileSync(path.resolve("episodes/croissant/sources.json"), "utf8")));
  assert.deepEqual(demo.errors, []); assert.equal(demo.stats.years, 1); assert.equal(demo.stats.numbers, 1);
  const st = pl.setStatus("test-dish", "short", { step: "render", pct: 10 }, "start"); assert.equal(st.pct, 10);
  const st2 = pl.setStatus("test-dish", "short", (o) => ({ pct: o.pct + 5 })); assert.equal(st2.pct, 15); assert.equal(st2.log.length, 1);
  assert.ok(pl.statusFile("test-dish", "short").startsWith(path.join(tmp, "out"))); // never the real out/
});

test("textures: a manifest entry of kind texture carries a Dreamina recipe; only missing keys are planned", async () => {
  const dr = await import("../scripts/lib/dreamina.mjs");
  const entry = { id: "wall-a", name: "Wall", author: null, sourceUrl: null, license: null, attribution: null, price: null, formats: "PNG", required: false, usedIn: [], targetDir: "assets/_t/wall-a",
    files: { wall: null, floor: "assets/_t/wall-a/floor.png" }, status: "missing", kind: "texture",
    generator: { tool: "dreamina", model: "seedream_4.7", prompts: { wall: "Warm cream plaster wall, toon style, no text", floor: "Old wooden floor boards, toon style, no text" } } };
  const parsed = cfg.AssetManifestSchema.parse({ assets: [entry] });
  assert.equal(parsed.assets[0].generator.resolution, "2K"); assert.equal(parsed.assets[0].generator.ratio, "1:1"); assert.deepEqual(parsed.assets[0].generator.runs, {});
  assert.equal(cfg.AssetManifestSchema.parse({ assets: [{ ...entry, kind: undefined, generator: undefined }] }).assets[0].kind, "model");
  const pub = fs.mkdtempSync(path.join(tmp, "pub-")); fs.mkdirSync(path.join(pub, "assets/_t/wall-a"), { recursive: true }); fs.writeFileSync(path.join(pub, "assets/_t/wall-a/floor.png"), "x");
  const plan = dr.planTextures(parsed, { pub });
  assert.deepEqual(plan.map((p) => p.key), ["wall"]);                      // floor already exists
  assert.equal(plan[0].target, "assets/_t/wall-a/wall.png");
  assert.deepEqual(dr.planTextures(parsed, { pub, force: true }).map((p) => p.key), ["wall", "floor"]);
  assert.throws(() => dr.planTextures(parsed, { pub, ids: ["nope"] }), /Không có texture/);
});

test("picture and sound stay in sync: an event anchored to a word sits on that word's time", () => {
  const ep = cfg.loadEpisode("croissant", "short"), tr = tlm.estimateTranscript(ep.script, 160, 0.3), tl = tlm.buildTimeline(ep, tr);
  const w = tr.words.find((x) => x.segment === "t07" && x.text === "opened"), ev = tl.events.find((e) => e.name === "bell");
  assert.equal(ev.frame, tlm.toFrame(w.startSec, 30));
  const shot = tl.shots.find((s) => s.id === "q29"), anchor = tr.words.find((x) => x.segment === "t08" && x.text === "Crescent.");
  assert.ok(Math.abs(shot.a / 30 - anchor.startSec) < 0.2); // the picture leads the word by a few frames
});
test("long audio: stretching every word time moves shots, chapters and ad-break hints with it", () => {
  const ep = cfg.loadEpisode("croissant", "long"), tr = tlm.estimateTranscript(ep.script, 150, 0.6), a = tlm.buildTimeline(ep, tr);
  const slow = { ...tr, audio: { durationSec: tr.audio.durationSec * 1.25 }, words: tr.words.map((w) => ({ ...w, startSec: w.startSec * 1.25, endSec: w.endSec * 1.25 })), segments: tr.segments.map((s) => ({ ...s, startSec: s.startSec * 1.25, endSec: s.endSec * 1.25 })) };
  const b = tlm.buildTimeline(ep, slow);
  assert.ok(Math.abs(b.totalFrames - (a.totalFrames - 60) * 1.25 - 60) <= 2);
  assert.ok(Math.abs(b.chapters[3].startSec - a.chapters[3].startSec * 1.25) < 0.01);
  assert.equal(b.adBreaks.length, 2); assert.equal(b.adBreaks[0].beforeChapter, "ch4");
  assert.deepEqual(tlm.checkTimeline(b), []);
});
test("timeline errors are explicit: stale transcript, unknown anchor word, shots out of order", () => {
  const ep = cfg.loadEpisode("croissant", "short"), tr = tlm.estimateTranscript(ep.script, 160, 0.3);
  assert.throws(() => tlm.buildTimeline(ep, { ...tr, segments: tr.segments.slice(1) }), /Transcript thiếu đoạn "t01"/);
  const bad = structuredClone(ep); bad.storyboard.shots[1].at.word = "Budapest";
  assert.throws(() => tlm.buildTimeline(bad, tr), /không tìm thấy từ "Budapest"/);
  const bad2 = structuredClone(ep); bad2.storyboard.shots[13].at = { segment: "t04", word: "Legend" }; // anchored before the previous shot
  assert.throws(() => tlm.buildTimeline(bad2, tr), /chỉ dài -?\d+ frame/);
});

// ------------------------------------------------------------ ElevenLabs adapter (fixtures only)
const align = (text, cps = 15) => ({ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i / cps), character_end_times_seconds: [...text].map((_, i) => (i + 1) / cps) });
test("character alignment -> words keeps punctuation, numbers and real character times", () => {
  const w = el.alignmentToWords(align("In 1683, bakers didn't sleep."));
  assert.deepEqual(w.map((x) => x.text), ["In", "1683,", "bakers", "didn't", "sleep."]);
  assert.ok(Math.abs(w[1].startSec - 3 / 15) < 1e-9 && Math.abs(w[1].endSec - 8 / 15) < 1e-9);
  assert.throws(() => el.alignmentToWords({ characters: ["a"], character_start_times_seconds: [], character_end_times_seconds: [] }), /Alignment thiếu/);
  assert.throws(() => el.alignmentToWords(null), /Alignment thiếu/);
  assert.throws(() => el.alignmentToWords({ characters: ["a", " ", "b"], character_start_times_seconds: [1, 1.1, 0.2], character_end_times_seconds: [1.1, 1.2, 0.3] }), /không đơn điệu/);
});
test("words map back to script segments by character offset; normalised text falls back to token counts; mismatch fails", () => {
  const chunk = { parts: [{ id: "a", text: "Paris, 1839.", offset: 0 }, { id: "b", text: "Kipfel sold well.", offset: 13 }], text: "Paris, 1839. Kipfel sold well." };
  const m = el.mapWordsToSegments(chunk, align(chunk.text));
  assert.equal(m.method, "char-offset"); assert.deepEqual(m.words.map((w) => w.segment), ["a", "a", "b", "b", "b"]);
  const n = el.mapWordsToSegments(chunk, align("Paris, eighteen-thirty-nine. Kipfel sold well.")); // same token count, different characters
  assert.equal(n.method, "token-count"); assert.deepEqual(n.words.map((w) => w.segment), ["a", "a", "b", "b", "b"]);
  assert.throws(() => el.mapWordsToSegments(chunk, align("Paris, eighteen thirty nine. Kipfel sold well.")), /Không ghép được mốc thời gian/);
});
test("chunk plan: one request for a Short, chapter boundaries for a Long, never inside a segment", () => {
  const s = cfg.loadEpisode("croissant", "short"), l = cfg.loadEpisode("croissant", "long");
  assert.equal(el.planChunks(s.episode, s.script).length, 1);
  const chunks = el.planChunks(l.episode, l.script);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.flatMap((c) => c.segmentIds), l.script.segments.map((x) => x.id));
  for (const c of chunks) { assert.ok(c.chars <= l.episode.voice.chunkMaxChars); for (const p of c.parts) assert.equal(c.text.slice(p.offset, p.offset + p.text.length), p.text); }
  const firstOf = (c) => l.script.segments.find((x) => x.id === c.segmentIds[0]).chapter, lastOf = (c) => l.script.segments.find((x) => x.id === c.segmentIds.at(-1)).chapter;
  for (let i = 1; i < chunks.length; i++) assert.notEqual(lastOf(chunks[i - 1]), firstOf(chunks[i])); // cuts fall between chapters here
  assert.equal(chunks[0].previousText, null); assert.ok(chunks[1].previousText.length > 0 && chunks[0].nextText.length > 0);
  assert.ok(el.planChunks(l.episode, l.script, 700).every((c) => c.chars <= 700));
  assert.throws(() => el.planChunks(l.episode, l.script, 100), /vượt giới hạn/);
  assert.ok(el.planChunks(l.episode, l.script).some((c) => c.text.includes("Croissan-wich") && !c.text.includes("Croissan'wich"))); // pronunciation text is what is sent
});
test("cache key changes with anything that changes the audio, and only then", () => {
  const ep = cfg.loadEpisode("croissant", "short"), c = el.planChunks(ep.episode, ep.script)[0], k = el.chunkKey(ep.episode, c);
  assert.equal(el.chunkKey(structuredClone(ep.episode), structuredClone(c)), k);
  const v = structuredClone(ep.episode);
  v.voice.voiceId = "other-voice-id"; assert.notEqual(el.chunkKey(v, c), k);
  const s = structuredClone(ep.episode); s.voice.settings.stability = 0.9; assert.notEqual(el.chunkKey(s, c), k);
  const m = structuredClone(ep.episode); m.voice.modelId = "eleven_flash_v2_5"; assert.notEqual(el.chunkKey(m, c), k);
  assert.notEqual(el.chunkKey(ep.episode, { ...c, text: c.text + " More." }), k);
});
test("errors are told apart: auth, quota, rate limit, voice, validation, server", () => {
  assert.equal(el.classifyError(401, { detail: { status: "invalid_api_key", message: "x" } }).kind, "auth");
  assert.equal(el.classifyError(401, { detail: { status: "quota_exceeded", message: "x" } }).kind, "quota");
  assert.equal(el.classifyError(429, { detail: { status: "too_many_concurrent_requests" } }).kind, "rate_limit");
  assert.equal(el.classifyError(404, { detail: { status: "voice_not_found" } }).kind, "voice");
  assert.equal(el.classifyError(422, { detail: [{ msg: "field required" }] }).kind, "validation");
  assert.equal(el.classifyError(503, null).kind, "server");
  assert.throws(() => el.getKey({}), /Chưa có ELEVENLABS_API_KEY/);
});

// a real (tiny) mp3 so the decode -> 48 kHz WAV -> concat path is exercised without the API
const mp3 = path.join(tmp, "tone.mp3");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
const B64 = fs.readFileSync(mp3).toString("base64");
const fakeEp = (dir) => {
  const ep = cfg.loadEpisode("croissant", "short"); ep.p = { ...ep.p, voiceDir: dir, transcript: path.join(dir, "transcript.json"), voiceWav: path.join(dir, "voice.wav") };
  ep.script = { ...ep.script, segments: [{ id: "s01", chapter: "hook", text: "Butter makes layers.", claims: [] }, { id: "s02", chapter: "hook", text: "Steam lifts them.", claims: [] }] };
  return ep;
};
const okFetch = (log) => async (url, init) => { const body = JSON.parse(init.body); log.push({ url, body, key: init.headers["xi-api-key"] });
  return new Response(JSON.stringify({ audio_base64: B64, alignment: align(body.text, body.text.length / 3.8), normalized_alignment: align(body.text, body.text.length / 3.8) }), { status: 200, headers: { "character-cost": String(body.text.length), "request-id": "req-" + log.length } }); };

test("synthesize: dry-run sends nothing; a real run decodes, aligns and writes voice.wav + transcript; a second run is all cache", async () => {
  const dir = path.join(tmp, "v1"), ep = fakeEp(dir), log = [];
  const dry = await el.synthesize(ep, { dryRun: true, fetchImpl: okFetch(log), key: "k" });
  assert.equal(log.length, 0); assert.equal(dry.summary.charsToSend, "Butter makes layers. Steam lifts them.".length); assert.equal(dry.summary.chunks, 1);
  const r = await el.synthesize(ep, { fetchImpl: okFetch(log), key: "test-key", log: () => {} });
  assert.equal(log.length, 1); assert.match(log[0].url, /\/v1\/text-to-speech\/.+\/with-timestamps\?output_format=mp3_44100_128$/);
  assert.equal(log[0].key, "test-key"); assert.equal(log[0].body.model_id, "eleven_multilingual_v2"); assert.equal(log[0].body.voice_settings.speed, ep.episode.voice.settings.speed);
  const t = r.transcript; assert.equal(t.words.length, 6); assert.deepEqual(t.segments.map((s) => s.id), ["s01", "s02"]);
  assert.ok(Math.abs(t.words[0].startSec - ep.config.leadInSec) < 0.01);            // offsets include the lead-in
  assert.ok(Math.abs(t.audio.durationSec - (ep.config.leadInSec + 4.0)) < 0.15);  // real decoded length, not a guess
  assert.ok(t.segments[1].startSec > t.segments[0].endSec);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", ep.p.voiceWav], { encoding: "utf8" })).streams[0];
  assert.equal(probe.sample_rate, "48000"); assert.equal(probe.codec_name, "pcm_s16le");                // a real WAV, not a renamed mp3
  const ledger = JSON.parse(fs.readFileSync(path.join(dir, "ledger.json"), "utf8")); assert.equal(ledger.requests[0].status, "complete"); assert.ok(!JSON.stringify(ledger).includes("test-key"));
  await el.synthesize(ep, { fetchImpl: okFetch(log), key: "k", log: () => {} }); assert.equal(log.length, 1);   // cache hit: no second charge
  ep.script.segments[1].text = "Steam lifts every one."; await el.synthesize(ep, { fetchImpl: okFetch(log), key: "k", log: () => {} }); assert.equal(log.length, 2); // changed text -> new request
});
test("synthesize: several chunks are joined with gaps and every later word is shifted by the real audio lengths", async () => {
  const dir = path.join(tmp, "v2"), ep = fakeEp(dir), log = []; ep.episode.voice.chunkMaxChars = 200;
  ep.script.segments = [{ id: "a", chapter: "c1", text: "One two three." }, { id: "b", chapter: "c2", text: "Four five six." }];
  const { transcript: t } = await el.synthesize(ep, { fetchImpl: okFetch(log), key: "k", log: () => {} });
  assert.equal(log.length, 1); // fits one request
  ep.episode.voice.chunkMaxChars = 200; const dir3 = path.join(tmp, "v3"), ep3 = fakeEp(dir3), log3 = [];
  ep3.script.segments = Array.from({ length: 4 }, (_, i) => ({ id: "p" + i, chapter: "c" + i, text: "This sentence is long enough to need its own request, number " + i + ", so the plan must split it at the chapter boundary and nowhere else at all." }));
  ep3.episode.voice.chunkMaxChars = 200;
  const r3 = await el.synthesize(ep3, { fetchImpl: okFetch(log3), key: "k", log: () => {} });
  assert.equal(log3.length, 4); assert.ok(log3[1].body.previous_text && log3[1].body.next_text && !log3[0].body.previous_text);
  const ch = r3.transcript.chunks, gap = ep3.episode.voice.chunkGapSec;
  for (let i = 1; i < ch.length; i++) assert.ok(Math.abs(ch[i].offsetSec - (ch[i - 1].offsetSec + ch[i - 1].durationSec + gap)) < 0.01);
  const firstOfLast = r3.transcript.words.find((w) => w.segment === "p3"); assert.ok(Math.abs(firstOfLast.startSec - ch[3].offsetSec) < 0.01);
  assert.ok(Math.abs(r3.transcript.audio.durationSec - (ch[3].offsetSec + ch[3].durationSec)) < 0.1); assert.ok(t.words.length === 6);
});
test("synthesize: budget, missing voice, quota and ambiguous network failures are handled without blind retries", async () => {
  const ep = fakeEp(path.join(tmp, "v4")); ep.episode.voice.budget.maxTotalChars = 10;
  await assert.rejects(el.synthesize(ep, { fetchImpl: okFetch([]), key: "k", log: () => {} }), /Vượt ngân sách ký tự/);
  const noVoice = fakeEp(path.join(tmp, "v5")); noVoice.episode.voice.voiceId = null;
  await assert.rejects(el.synthesize(noVoice, { fetchImpl: okFetch([]), key: "k" }), /chưa có voice\.voiceId/);
  const q = fakeEp(path.join(tmp, "v6")); let calls = 0;
  await assert.rejects(el.synthesize(q, { key: "k", log: () => {}, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "no credits" } }), { status: 401 }); } }), (e) => e.kind === "quota");
  assert.equal(calls, 1);
  const net = fakeEp(path.join(tmp, "v7")); let n = 0;
  await assert.rejects(el.synthesize(net, { key: "k", log: () => {}, fetchImpl: async () => { n++; throw new TypeError("fetch failed"); } }), (e) => e.kind === "network");
  assert.equal(n, 1); // not replayed: the request may have been processed and charged
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "v7", "ledger.json"), "utf8")).requests[0].status, "unknown");
  await assert.rejects(el.synthesize(net, { key: "k", log: () => {}, fetchImpl: okFetch([]) }), /chưa rõ đã bị tính ký tự/);
  const done = await el.synthesize(net, { key: "k", log: () => {}, fetchImpl: okFetch([]), retryUnknown: true }); assert.ok(done.transcript.words.length > 0);
  const rl = fakeEp(path.join(tmp, "v8")); let k = 0;
  await el.synthesize(rl, { key: "k", log: () => {}, backoffScale: 0.001, fetchImpl: async (u, i) => (++k < 3 ? new Response(JSON.stringify({ detail: { status: "too_many_concurrent_requests" } }), { status: 429 }) : okFetch([])(u, i)) });
  assert.equal(k, 3); // rate limits are retried a bounded number of times
});
test("importing existing audio + word timings works, and a word-count mismatch is refused", () => {
  const ep = fakeEp(path.join(tmp, "v9")), wf = path.join(tmp, "words.json");
  fs.writeFileSync(wf, JSON.stringify(["Butter", "makes", "layers.", "Steam", "lifts", "them."].map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })))); // the bridge skill's old format
  const t = el.importVoice(ep, mp3, wf); assert.equal(t.segments[1].startSec, 1.5); assert.equal(t.source, "import");
  fs.writeFileSync(wf, JSON.stringify([{ word: "Butter", start: 0, end: 1 }])); assert.throws(() => el.importVoice(ep, mp3, wf), /không ghép được/);
});

// ------------------------------------------------------------ CLI behaviour on missing input
const cli = (...a) => spawnSync(process.execPath, ["scripts/food.mjs", ...a], { encoding: "utf8", env: { ...process.env, FOOD_EPISODES_DIR: "" } });
test("CLI: final render stops with the asset id and folder when a required asset is missing; bad options explain themselves", () => {
  const r = cli("render", "--episode", "croissant", "--format", "long", "--quality", "final"), out = r.stdout + r.stderr;
  if (/thiếu asset bắt buộc/.test(out)) { assert.equal(r.status, 1); assert.match(out, /kenney-\w+-kit|kenney-mini-shop/); assert.match(out, /DOWNLOAD_GUIDE\.md/); }
  else assert.match(out, /timeline|Đóng gói/); // assets already delivered on this machine
  const c = cli("validate", "--episode", "croissant", "--format", "short", "--aspect", "16:9", "--width", "1000", "--height", "1000"); assert.equal(c.status, 1); assert.match(c.stdout + c.stderr, /mâu thuẫn/);
  const f = cli("validate", "--episode", "croissant", "--format", "medium"); assert.equal(f.status, 1); assert.match(f.stdout + f.stderr, /short \| long/);
  const e = cli("validate", "--episode", "pho", "--format", "short"); assert.equal(e.status, 1); assert.match(e.stdout + e.stderr, /Không có tập "pho"/);
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("film: AI segments never cross a location or a shot, stay <= 15 s, and short ones are generated at 4 s", async () => {
  const film = await import("../scripts/lib/film.mjs");
  const shot = (id, scene, a, b) => ({ id, scene, a, b, note: `note ${id}` });
  const tl = { fps: 30, shots: [shot("a", "bakery", 0, 60), shot("b", "bakery", 60, 300), shot("c", "bakery", 300, 500), shot("d", "street", 500, 530), shot("e", "bakery", 530, 900)] };
  const s = film.planSegments(tl);
  assert.deepEqual(s.map((g) => [g.scene, g.shots.join("")]), [["bakery", "ab"], ["bakery", "c"], ["street", "d"], ["bakery", "e"]]);
  assert.ok(s.every((g) => g.genSec >= 4 && g.genSec <= 15 && g.genSec >= g.sec - 1e-6));
  assert.equal(s[2].genSec, 4);                                    // a 1 s street insert is made at 4 s and trimmed
  assert.throws(() => film.planSegments({ fps: 30, shots: [shot("x", "bakery", 0, 16 * 30)] }), /15s/);
  // a new segment at every change of city, era or legend status, even inside one set
  const tl2 = { fps: 30, width: 1080, height: 1920, events: [{ type: "action", name: "kick", frame: 40 }], shots: [
    { ...shot("v", "street", 0, 60), params: { place: "vienna" } }, { ...shot("p", "street", 60, 120), params: { place: "paris" } },
    { ...shot("l", "page", 120, 180), legend: true, params: {} }, { ...shot("d", "page", 180, 240), params: {} }] };
  const s2 = film.planSegments(tl2);
  assert.deepEqual(s2.map((g) => g.shots.join("")), ["v", "p", "l", "d"]);
  // the segment key follows the content of that stretch only
  const k = film.segmentKey(tl2, s2[0]), moved = { ...tl2, events: [{ ...tl2.events[0], frame: 43 }] };
  assert.notEqual(film.segmentKey(moved, s2[0]), k);                                  // emphasis moved inside s01
  assert.equal(film.segmentKey(moved, s2[1]), film.segmentKey(tl2, s2[1]));          // s02 untouched
  // final takes only an approved clip made for this key; preview falls back to the matching guide; stale is never used
  const m = (key, approved) => ({ key, approved });
  assert.equal(film.chooseClip(s2[0], k, { ai: m(k, false), guide: m(k) }, true), null);
  assert.equal(film.chooseClip(s2[0], k, { ai: m(k, true), guide: null }, true).kind, "ai");
  assert.equal(film.chooseClip(s2[0], k, { ai: m("old", true), guide: m(k) }, false).kind, "guide");
  assert.equal(film.chooseClip(s2[0], k, { ai: m("old", true), guide: m("old") }, false), null);
  const pics = film.picturesFor(s2, (g) => (g.id === "s01" ? { src: "ai/s01.mp4", kind: "ai", approved: true } : null));
  assert.deepEqual(pics.map((p) => p && p.kind), ["ai", null, null, null]);
  // the Seedance prompt comes from structured params, never the editor's note, and never asks for sepia or text
  const pr = film.aiPrompt(s2[0], Object.fromEntries(tl2.shots.map((x) => [x.id, x])));
  assert.match(pr, /Vienna street/); assert.doesNotMatch(pr, /note v/); assert.match(pr, /no sepia/); assert.match(pr, /first 2\.0 s/);
});
