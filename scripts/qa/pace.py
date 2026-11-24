"""Pace check for one episode (2026-11-24, targets agreed with the user in VISUAL_DENSITY.md):
  - people:  share of shots with hands or faces            reference 60-70 %, NOT a pass/fail check (2026-11-24 review):
             a dough shot needs the hands on the dough, a cross-section needs the crumb; adding a face to reach a quota
             makes the food smaller. Each shot must show its subject clearly instead.
  - food:    share of shots that show the dish              target ~70 %
  - still:   share of 0.5 s steps that are nearly frozen    target <= 3 %   (delta < 3 on a 0-255 scale, as in the study)
  - motion:  median delta between 0.5 s steps               target >= 16
  - speech:  words per second of narration                  Short 2.8-3.0, Long 2.4-2.6
People and food come from the storyboard notes: the 5-part note format "người: ...; món: ...; máy: ...; sáng: ...; tiếng: ..."
is read exactly; older free-text notes are classified by keywords and the report says so ("ước lượng").
    python scripts/qa/pace.py <storyboard.json> <timeline.json> <video or -> <out.md>
Exit code 1 when a measured value misses its target.
"""
import json, re, subprocess, sys
import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PEOPLE_WORDS = re.compile(r"nhân vật|thợ|người|khách|tay |bàn tay|mặt |lính|sĩ quan|bà |ông |cô |chú |baker|hand|face|character|crowd", re.I)
FOOD_WORDS = re.compile(r"bánh|croissant|kipfer|bột|bơ|món|ổ bánh|sừng|dough|butter|pastry|bread|roll", re.I)
EMPTY = {"", "-", "—", "không", "none", "no", "ẩn"}


def field(note, key):
    m = re.search(rf"(?:^|;)\s*{key}\s*:\s*([^;]*)", note or "", re.I)
    return m.group(1).strip() if m else None


def classify(shots):
    rows, exact = [], 0
    for s in shots:
        note = s.get("note") or ""
        p, f = field(note, "người"), field(note, "món")
        if p is not None or f is not None:
            exact += 1
            rows.append((s["id"], p is not None and p.lower() not in EMPTY, f is not None and f.lower() not in EMPTY))
        else:
            rows.append((s["id"], bool(PEOPLE_WORDS.search(note)), bool(FOOD_WORDS.search(note))))
    return rows, exact


def motion(video):
    """mean absolute difference between frames 0.5 s apart (gray, 180x320), on a 0-255 scale"""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", video, "-vf", "fps=2,scale=180:320,format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 320, 180).astype(np.float32)
    if len(fr) < 2:
        return None
    return np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))


def main():
    sb_path, tl_path, video, out = sys.argv[1:5]
    sb, tl = json.load(open(sb_path, encoding="utf-8")), json.load(open(tl_path, encoding="utf-8"))
    rows, exact = classify(sb["shots"])
    n = len(rows) or 1
    people = sum(r[1] for r in rows) / n
    food = sum(r[2] for r in rows) / n
    words = tl.get("words") or []
    voice = (words[-1]["e"] - words[0]["s"]) if len(words) > 1 else 0
    wps = len(words) / voice if voice > 0 else None
    short = tl.get("format") == "short"
    lo, hi = (2.8, 3.0) if short else (2.4, 2.6)
    d = motion(video) if video != "-" else None
    still = float((d < 3).mean()) if d is not None else None
    med = float(np.median(d)) if d is not None else None
    checks = [
        ("Shot có người hoặc tay", f"{people * 100:.0f} %", "60–70 % (tham khảo)", None),
        ("Shot có món ăn", f"{food * 100:.0f} %", "khoảng 70 %", 0.6 <= food),
        ("Bước 0,5 s đứng yên", "-" if still is None else f"{still * 100:.1f} %", "≤ 3 %", None if still is None else still <= 0.03),
        ("Chuyển động (trung vị Δ)", "-" if med is None else f"{med:.1f}", "≥ 16", None if med is None else med >= 16),
        ("Tốc độ lời", "-" if wps is None else f"{wps:.2f} từ/s", f"{lo}–{hi} từ/s", None if wps is None else lo - 0.05 <= wps <= hi + 0.05),
    ]
    how = "đọc đúng mục 'người:' / 'món:' của ghi chú" if exact == len(rows) else f"{exact}/{len(rows)} shot có ghi chú 5 mục; còn lại ước lượng theo từ khóa"
    md = [f"# Kiểm nhịp: {tl.get('slug')} / {tl.get('format')}", "",
          f"- Storyboard: {len(rows)} shot ({how})", f"- Video: {video if video != '-' else '(chưa có, bỏ qua phần chuyển động)'}", "",
          "| Chỉ số | Đo được | Mục tiêu | Đạt |", "|---|---|---|---|"]
    md += [f"| {a} | {b} | {c} | {'-' if ok is None else 'đạt' if ok else 'CHƯA'} |" for a, b, c, ok in checks]
    md += ["", "## Shot không có người", ", ".join(r[0] for r in rows if not r[1]) or "(không có)"]
    open(out, "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("\n".join(md[:len(checks) + 7]))
    sys.exit(0 if all(ok is not False for *_, ok in checks) else 1)


if __name__ == "__main__":
    main()
