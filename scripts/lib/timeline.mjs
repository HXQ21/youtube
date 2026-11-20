// One canonical timeline.json per episode format, built from the transcript (real word timings) + the storyboard.
// Picture, captions, sound (Python reads this file) and QA all use it; nothing else declares times by hand.
// Conventions: frame = round(sec * fps), integers; intervals are half-open [a, b) in frames; seconds are absolute.
import { ConfigError, sha } from "./config.mjs";

export const toFrame = (sec, fps) => Math.round(sec * fps);
export const norm = (w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9']+/g, "");
export const tokens = (text) => text.trim().split(/\s+/).filter(Boolean);

/** Estimated transcript (NO audio yet): segment lengths from the word count at a fixed pace. Marked "estimated";
 *  only for blockout previews. Final renders refuse an estimated timeline. */
export const estimateTranscript = (script, wpm, leadInSec) => {
  let t = leadInSec;
  const words = [], segments = [];
  for (const s of script.segments) {
    const tk = tokens(s.text), per = 60 / wpm, start = t;
    for (const w of tk) { words.push({ text: w, startSec: +t.toFixed(3), endSec: +(t + per * 0.86).toFixed(3), segment: s.id }); t += per; }
    segments.push({ id: s.id, startSec: +start.toFixed(3), endSec: +(t - per * 0.14).toFixed(3) });
    t += 0.28; // sentence gap
  }
  return { source: "estimate", timing: "estimated", audio: { durationSec: +(t - 0.28).toFixed(3) }, words, segments };
};

const resolveAt = (at, tr, what) => {
  const seg = tr.segments.find((s) => s.id === at.segment);
  if (!seg) throw new ConfigError(`${what}: không có mốc thời gian cho đoạn "${at.segment}" trong transcript`);
  let sec = seg.startSec;
  if (at.word) {
    const want = norm(at.word), hits = tr.words.filter((w) => w.segment === at.segment && norm(w.text) === want);
    const hit = hits[(at.occurrence ?? 1) - 1];
    if (!hit) throw new ConfigError(`${what}: không tìm thấy từ "${at.word}"${at.occurrence ? ` (lần ${at.occurrence})` : ""} trong đoạn ${at.segment}. Các từ có: ${tr.words.filter((w) => w.segment === at.segment).map((w) => w.text).join(" ")}`);
    sec = hit.startSec;
  }
  return sec + (at.offsetSec ?? 0);
};

/** Build the timeline. `ep` = loadEpisode() result, `tr` = transcript ({words, segments, audio, timing}). */
export const buildTimeline = (ep, tr, missingAssets = []) => {
  const { render, config, script, storyboard, sources } = ep, fps = render.fps;
  const have = new Set(tr.segments.map((s) => s.id));
  for (const s of script.segments) if (!have.has(s.id)) throw new ConfigError(`Transcript thiếu đoạn "${s.id}": lời dẫn đã đổi sau khi tạo giọng. Chạy lại bước tts (chỉ đoạn thay đổi mới tốn ký tự).`);
  const durationSec = tr.audio.durationSec + config.tailPadSec;
  const totalFrames = Math.ceil(durationSec * fps);
  const segT = new Map(tr.segments.map((s) => [s.id, s]));
  const segments = script.segments.map((s) => { const t = segT.get(s.id); return { id: s.id, chapter: s.chapter, text: s.text, claims: s.claims, startSec: t.startSec, endSec: t.endSec, startFrame: toFrame(t.startSec, fps), endFrame: toFrame(t.endSec, fps) }; });

  // shots: start a few frames before their anchor so the picture leads the word; each ends where the next begins
  const LEAD = 0.12;
  const starts = storyboard.shots.map((sh, i) => (i === 0 ? 0 : Math.max(0, toFrame((sh.from ? segT.get(sh.from).startSec : resolveAt(sh.at, tr, `shot ${sh.id}`)) - LEAD, fps))));
  const shots = storyboard.shots.map((sh, i) => {
    const a = starts[i], b = i + 1 < starts.length ? starts[i + 1] : totalFrames;
    if (b - a < Math.round(0.3 * fps)) throw new ConfigError(`shot ${sh.id}: chỉ dài ${b - a} frame (${((b - a) / fps).toFixed(2)} giây). Gộp shot hoặc dời mốc.`);
    const seg = sh.from ?? sh.at.segment;
    return { id: sh.id, scene: sh.scene, a, b, startSec: +(a / fps).toFixed(3), chapter: script.segments.find((s) => s.id === seg).chapter, camera: sh.camera, params: sh.params,
      light: sh.light ?? null, legend: sh.legend, static: sh.static, transition: sh.transition, claims: sh.claims, assets: sh.assets, label: sh.label ?? null, pace: sh.pace ?? null, note: sh.note ?? null, seed: parseInt(sha(sh.id).slice(0, 6), 16) };
  });
  const events = [];
  for (const sh of storyboard.shots) for (const ev of sh.events) {
    const sec = resolveAt(ev.at, tr, `sự kiện ${ev.name} (shot ${sh.id})`);
    if (sec < 0 || sec > durationSec) throw new ConfigError(`sự kiện ${ev.name} (shot ${sh.id}) rơi ngoài video: ${sec.toFixed(2)} giây`);
    events.push({ type: ev.type, name: ev.name, shot: sh.id, sec: +sec.toFixed(3), frame: toFrame(sec, fps), gainDb: ev.gainDb ?? 0, durSec: ev.durSec ?? null });
  }
  events.sort((x, y) => x.frame - y.frame);

  const chapters = storyboard.chapters.map((c) => {
    const segs = segments.filter((s) => s.chapter === c.id);
    if (!segs.length) throw new ConfigError(`chapter ${c.id}: không có đoạn lời nào`);
    return { id: c.id, title: c.title, startSec: segs[0].startSec, endSec: segs[segs.length - 1].endSec, startFrame: segs[0].startFrame, endFrame: segs[segs.length - 1].endFrame,
      words: segs.reduce((n, s) => n + tokens(s.text).length, 0), targetSec: c.targetSec ?? null, adBreakBefore: c.adBreakBefore };
  });
  // suggested mid-roll points: the middle of the natural pause before a chapter flagged adBreakBefore (editorial hint only)
  const adBreaks = chapters.flatMap((c, i) => {
    if (!c.adBreakBefore || i === 0) return [];
    const prevEnd = chapters[i - 1].endSec, sec = +((prevEnd + c.startSec) / 2).toFixed(2);
    return [{ beforeChapter: c.id, sec, frame: toFrame(sec, fps), pauseSec: +(c.startSec - prevEnd).toFixed(2) }];
  });
  const legendClaims = new Set(sources.claims.filter((c) => c.status === "legend").map((c) => c.id));
  return {
    version: 1, slug: ep.slug, format: ep.format, timing: tr.timing ?? "aligned", locale: ep.episode.locale,
    fps, width: render.width, height: render.height, aspectRatio: render.aspectRatio, totalFrames, durationSec: +(totalFrames / fps).toFixed(3),
    target: { targetDurationSec: render.targetDurationSec, minDurationSec: render.minDurationSec, maxDurationSec: render.maxDurationSec, deviationSec: +(totalFrames / fps - render.targetDurationSec).toFixed(1) },
    audio: { voiceDurationSec: tr.audio.durationSec, leadInSec: config.leadInSec, tailPadSec: config.tailPadSec, source: tr.source ?? null },
    captions: render.captions, labels: render.labels,
    music: config.music, sfxGainDb: config.sfxGainDb,
    chapters, adBreaks, segments, words: tr.words.map((w) => ({ t: w.text, s: w.startSec, e: w.endSec })), shots, events,
    legendClaims: [...legendClaims], placeholders: missingAssets,
    fingerprint: sha({ script: script.segments.map((s) => [s.id, s.text]), storyboard, render, words: tr.words.length, dur: tr.audio.durationSec }).slice(0, 16),
  };
};

/** Shot length by type of passage (user's table, FEEDBACK_LOG #6), seconds [min, max].
 *  hook: opening curiosity, the viewer must recognise the dish and what is odd about it.
 *  story: events, people, journey; cut on a new idea, action or reaction.
 *  process: handling and transforming the food; hold while the change is still visible (max is soft).
 *  insert: a comic reaction or quick detail, short for emphasis. */
export const PACE = { hook: [1, 3], story: [2, 4], process: [3, 6], insert: [1, 2] };
const PACE_SOFT_MAX = { process: 9 };

/** Warnings for shots whose length does not fit their `pace` (one frame of tolerance). Returns { warnings, untyped }. */
export const checkPace = (tl) => {
  const warnings = [], untyped = [], tol = 1 / tl.fps;
  for (const s of tl.shots) {
    if (!s.pace) { untyped.push(s.id); continue; }
    const [lo, hi] = PACE[s.pace], max = PACE_SOFT_MAX[s.pace] ?? hi, d = (s.b - s.a) / tl.fps;
    if (d < lo - tol) warnings.push(`shot ${s.id} (${s.pace}) dài ${d.toFixed(2)}s, ngắn hơn ${lo}s: gộp với shot kế bên hoặc dời mốc`);
    else if (d > max + tol) warnings.push(`shot ${s.id} (${s.pace}) dài ${d.toFixed(2)}s, quá ${max}s: tách theo ý mới, hành động hoặc phản ứng`);
  }
  return { warnings, untyped };
};

/** sanity checks on a built timeline (used by `validate`, the tests and QA) */
export const checkTimeline = (tl) => {
  const errs = [];
  if (!Number.isInteger(tl.totalFrames) || tl.totalFrames <= 0) errs.push("totalFrames phải là số nguyên dương");
  tl.shots.forEach((s, i) => {
    if (!Number.isInteger(s.a) || !Number.isInteger(s.b)) errs.push(`shot ${s.id}: mốc frame không nguyên`);
    if (i === 0 && s.a !== 0) errs.push("shot đầu phải bắt đầu ở frame 0");
    if (i > 0 && s.a !== tl.shots[i - 1].b) errs.push(`shot ${s.id}: không liền mạch với shot trước (${tl.shots[i - 1].b} -> ${s.a})`);
    if (s.b <= s.a) errs.push(`shot ${s.id}: độ dài không dương`);
  });
  if (tl.shots[tl.shots.length - 1].b !== tl.totalFrames) errs.push("shot cuối phải kết thúc đúng totalFrames");
  for (const e of tl.events) if (e.frame < 0 || e.frame >= tl.totalFrames) errs.push(`sự kiện ${e.name}: frame ${e.frame} ngoài video`);
  for (let i = 1; i < tl.segments.length; i++) if (tl.segments[i].startSec < tl.segments[i - 1].endSec - 0.05) errs.push(`đoạn ${tl.segments[i].id}: chồng lên đoạn trước`);
  const last = tl.segments[tl.segments.length - 1];
  if (last.endSec > tl.totalFrames / tl.fps) errs.push("lời dẫn dài hơn video");
  return errs;
};
