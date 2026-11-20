"""Streaming QA for Short and Long videos.

  python scripts/qa/qa_stream.py <video.mp4> <timeline.json> <out_dir> [--every 10]

Reads the video frame by frame through an ffmpeg pipe at 96 px wide, greyscale (a 10-minute film never sits in RAM;
only one small frame and running statistics are kept). Checks, per frame / shot / chapter:
  - container: size, fps, frame count and duration against the timeline; audio stream present, 48 kHz, duration match
  - black / white frames, frozen runs (declared static shots and the paper "dip" transitions are not errors)
  - a visible change at every declared cut between different scenes
  - the END of the film: last shot, last chapter and last 3 seconds are checked explicitly
  - loudness (integrated LUFS, true peak) of the muxed audio
Writes report.json, report.md and contact sheets (one tile every --every seconds, or one per shot when the film is short).
Technical numbers only: picture quality and historical accuracy still need a human look.
"""
import json, math, os, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace"); sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # Windows pipes default to cp1252
import numpy as np
from PIL import Image, ImageDraw

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)
def frac(s):
    a, b = s.split("/"); return float(a) / float(b) if float(b) else 0.0

def main():
    argv = sys.argv[1:]; every = None
    if "--every" in argv: i = argv.index("--every"); every = float(argv[i + 1]); del argv[i:i + 2]
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 3: sys.exit(__doc__)
    video, tl_path, out = args
    tl = json.load(open(tl_path, encoding="utf8")); os.makedirs(out, exist_ok=True)
    fps, total = tl["fps"], tl["totalFrames"]; issues, notes = [], []
    info = probe(video); vs = next(s for s in info["streams"] if s["codec_type"] == "video"); au = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    W, H, vfps, vdur = vs["width"], vs["height"], frac(vs["avg_frame_rate"]), float(info["format"]["duration"])
    scale = W / tl["width"]
    if abs(W / H - tl["width"] / tl["height"]) > 0.01: issues.append(f"Tỷ lệ khung hình {W}x{H} khác timeline {tl['width']}x{tl['height']}")
    if abs(vfps - fps) > 0.01: issues.append(f"fps {vfps:.3f} khác timeline {fps}")
    if abs(vdur - total / fps) > 0.2: issues.append(f"Thời lượng video {vdur:.2f}s khác timeline {total / fps:.2f}s")
    if vs.get("codec_name") != "h264": issues.append(f"Codec hình là {vs.get('codec_name')}, cần h264")
    tgt = tl["target"]
    if tl["timing"] == "aligned" and not (tgt["minDurationSec"] <= vdur <= tgt["maxDurationSec"]): issues.append(f"Thời lượng {vdur:.1f}s nằm ngoài khoảng {tgt['minDurationSec']}-{tgt['maxDurationSec']}s của format {tl['format']}")
    if tl["timing"] != "aligned": notes.append("Timeline ước lượng (chưa có giọng thật): đây là bản nháp.")
    if tl.get("placeholders"): notes.append(f"Còn asset placeholder: {', '.join(tl['placeholders'])}")

    # ---- streaming picture pass
    w = 96; h = max(2, int(round(w * H / W / 2)) * 2); n = 0
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={w}:{h}", "-pix_fmt", "gray", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    shots = tl["shots"]; si = 0; prev = None
    per_shot = [{"id": s["id"], "scene": s["scene"], "a": s["a"], "b": s["b"], "mean": 0.0, "motion": 0.0, "n": 0, "frozenMax": 0, "cutDiff": None} for s in shots]
    black, white, frozen_runs, run = [], [], [], 0
    last3 = {"n": 0, "mean": 0.0, "motion": 0.0}
    dip = set()
    for i, s in enumerate(shots):
        if s["transition"] == "dip": dip.update(range(s["a"] - 8, s["a"] + 8))
    for e in tl["events"]:                                   # declared white flashes are not "white frame" errors
        if e["type"] == "action" and e["name"] == "flash": dip.update(range(e["frame"], e["frame"] + 5))
    while True:
        buf = proc.stdout.read(w * h)
        if len(buf) < w * h: break
        f = np.frombuffer(buf, np.uint8).astype(np.float32); m, sd = float(f.mean()), float(f.std())
        while si + 1 < len(shots) and n >= shots[si]["b"]: si += 1
        ps = per_shot[si]; d = float(np.abs(f - prev).mean()) if prev is not None else 0.0
        if n == shots[si]["a"] and si > 0: ps["cutDiff"] = d
        if m < 9 and sd < 5: black.append(n)
        if m > 246 and sd < 6 and n not in dip: white.append(n)
        if prev is not None and d < 0.02 and n != shots[si]["a"]:
            run += 1; ps["frozenMax"] = max(ps["frozenMax"], run)
        else:
            if run >= fps and not shots[si]["static"]: frozen_runs.append({"endFrame": n, "frames": run, "shot": ps["id"]})
            run = 0
        ps["mean"] += m; ps["motion"] += d; ps["n"] += 1
        if n >= total - 3 * fps: last3["n"] += 1; last3["mean"] += m; last3["motion"] += d
        prev = f; n += 1
    proc.wait()
    if run >= fps and not shots[si]["static"]: frozen_runs.append({"endFrame": n, "frames": run, "shot": per_shot[si]["id"]})
    if n != total: issues.append(f"Đọc được {n} frame, timeline có {total}")
    for ps in per_shot:
        if ps["n"]: ps["mean"] = round(ps["mean"] / ps["n"], 1); ps["motion"] = round(ps["motion"] / ps["n"], 3)
        else: issues.append(f"Shot {ps['id']} không có frame nào trong video")
    if black: issues.append(f"{len(black)} frame đen (đầu tiên: frame {black[0]})")
    if white: issues.append(f"{len(white)} frame trắng ngoài các chuyển cảnh đã khai báo (đầu tiên: frame {white[0]})")
    for r in frozen_runs: issues.append(f"Đứng hình {r['frames']} frame ({r['frames'] / fps:.1f}s) ở shot {r['shot']}, kết thúc frame {r['endFrame']} (không khai báo static)")
    for i in range(1, len(shots)):
        ps = per_shot[i]
        if shots[i]["scene"] != shots[i - 1]["scene"] and shots[i]["transition"] == "cut" and ps["cutDiff"] is not None and ps["cutDiff"] < 1.0:
            issues.append(f"Không thấy thay đổi hình ở điểm cắt vào shot {ps['id']} (frame {ps['a']}, chênh {ps['cutDiff']:.2f})")
    # ---- the end of the film
    end = {"lastShot": per_shot[-1]["id"], "lastShotFrames": per_shot[-1]["n"], "last3sMean": round(last3["mean"] / max(1, last3["n"]), 1), "last3sMotion": round(last3["motion"] / max(1, last3["n"]), 3)}
    if per_shot[-1]["n"] < fps: issues.append("Shot cuối ngắn hơn 1 giây trong video: bản xuất có thể bị cắt cụt")
    if last3["n"] and last3["mean"] / last3["n"] < 9: issues.append("3 giây cuối gần như đen")
    last_seg = tl["segments"][-1] if tl["segments"] else None
    if last_seg and last_seg["endSec"] > vdur: issues.append(f"Lời dẫn kết thúc ở {last_seg['endSec']:.2f}s nhưng video chỉ dài {vdur:.2f}s")
    chapters = []
    for c in tl["chapters"]:
        ss = [p for p, s in zip(per_shot, shots) if s["chapter"] == c["id"]]
        fr = sum(p["n"] for p in ss); chapters.append({"id": c["id"], "title": c["title"], "shots": len(ss), "seconds": round(fr / fps, 1), "meanLuma": round(sum(p["mean"] * p["n"] for p in ss) / max(1, fr), 1), "motion": round(sum(p["motion"] * p["n"] for p in ss) / max(1, fr), 3)})
        if not fr: issues.append(f"Chương {c['id']} không có frame nào")

    # ---- audio
    audio = None
    if au is None: notes.append("File không có tiếng (bản .silent hoặc chưa mux).")
    else:
        adur = float(au.get("duration", vdur)); sr = int(au["sample_rate"])
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
        I = float(r.rsplit("I:", 1)[1].split("LUFS")[0]); tp = float(r.rsplit("Peak:", 1)[1].split("dBFS")[0])
        audio = {"durationSec": round(adur, 3), "sampleRate": sr, "channels": au.get("channels"), "codec": au.get("codec_name"), "integratedLUFS": I, "truePeakDb": tp}
        if abs(adur - vdur) > 0.25: issues.append(f"Tiếng {adur:.2f}s lệch hình {vdur:.2f}s")
        if sr != 48000: issues.append(f"Tiếng {sr} Hz, cần 48000")
        if abs(I + 15) > 1.5: issues.append(f"Âm lượng {I:.1f} LUFS lệch mục tiêu -15")
        if tp > -0.5: issues.append(f"True peak {tp:.1f} dBTP vượt trần")   # AAC encoding may add a few tenths over the -1 dBTP WAV ceiling
        if I < -60: issues.append("Track tiếng gần như im lặng (mux nhầm track?)")

    # ---- contact sheets (one ffmpeg seek per tile; nothing bulk-loaded)
    step = every or (10 if vdur > 180 else None)
    marks = [(t, f"{int(t // 60)}:{int(t % 60):02d}") for t in np.arange(step / 2, vdur, step)] if step else [((s["a"] + s["b"]) / 2 / fps, s["id"]) for s in shots]
    if vdur - 1.0 > 0: marks.append((vdur - 1.0, "end"))
    tw = 240; th = int(round(tw * H / W)); cols = 6 if W >= H else 8; per = cols * (4 if W >= H else 3); sheets = []
    for k in range(0, len(marks), per):
        chunk = marks[k:k + per]; rows = math.ceil(len(chunk) / cols); sheet = Image.new("RGB", (cols * tw, rows * (th + 18)), "#1b1b1b"); dr = ImageDraw.Draw(sheet)
        for j, (t, lab) in enumerate(chunk):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", video, "-frames:v", "1", "-vf", f"scale={tw}:{th}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            if len(raw) == tw * th * 3: sheet.paste(Image.frombytes("RGB", (tw, th), raw), ((j % cols) * tw, (j // cols) * (th + 18)))
            dr.text(((j % cols) * tw + 4, (j // cols) * (th + 18) + th + 3), str(lab), fill="#e8e8e8")
        p = os.path.join(out, f"sheet_{k // per + 1:02d}.jpg"); sheet.save(p, quality=88); sheets.append(os.path.basename(p))

    rep = {"video": os.path.basename(video), "format": tl["format"], "ok": not issues, "issues": issues, "notes": notes,
           "container": {"width": W, "height": H, "fps": vfps, "frames": n, "durationSec": round(vdur, 3), "codec": vs.get("codec_name"), "renderScale": round(scale, 4)},
           "target": tgt, "audio": audio, "end": end, "chapters": chapters, "adBreaks": tl.get("adBreaks", []), "shots": per_shot, "sheets": sheets}
    json.dump(rep, open(os.path.join(out, "report.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)
    md = [f"# QA: {os.path.basename(video)}", "", f"- Kết quả kỹ thuật: **{'ĐẠT' if not issues else 'CÓ VẤN ĐỀ'}**", f"- {W}x{H}, {vfps:.2f} fps, {n} frame, {vdur:.2f} giây (mục tiêu {tgt['targetDurationSec']}s, cho phép {tgt['minDurationSec']}-{tgt['maxDurationSec']}s)"]
    if audio: md.append(f"- Tiếng: {audio['durationSec']}s, {audio['sampleRate']} Hz, {audio['integratedLUFS']:.1f} LUFS, true peak {audio['truePeakDb']:.1f} dBTP")
    md += [f"- Đoạn cuối: shot {end['lastShot']} ({end['lastShotFrames']} frame), 3 giây cuối sáng trung bình {end['last3sMean']}, chuyển động {end['last3sMotion']}", ""]
    md += ["## Vấn đề"] + ([f"- {x}" for x in issues] or ["- (không có)"]) + ["", "## Ghi chú"] + ([f"- {x}" for x in notes] or ["- (không có)"])
    md += ["", "## Theo chương", "| Chương | Shot | Giây | Sáng TB | Chuyển động |", "|---|---|---|---|---|"] + [f"| {c['id']} {c['title']} | {c['shots']} | {c['seconds']} | {c['meanLuma']} | {c['motion']} |" for c in chapters]
    md += ["", "Số đo kỹ thuật không thay thế việc xem hình và kiểm tra nội dung lịch sử.", "", "Contact sheet: " + ", ".join(sheets)]
    open(os.path.join(out, "report.md"), "w", encoding="utf8").write("\n".join(md) + "\n")
    print(f"QA {'ĐẠT' if not issues else 'CÓ VẤN ĐỀ'}: {n} frame, {vdur:.2f}s" + (f", {audio['integratedLUFS']:.1f} LUFS / {audio['truePeakDb']:.1f} dBTP" if audio else ", không có tiếng") + f" -> {out}")
    for x in issues: print("  -", x)
    for x in notes: print("  (ghi chú)", x)
    sys.exit(0 if not issues else 1)

main()
