# Trạng thái dự án (cập nhật 2026-11-17)

Tóm tắt để tiếp tục công việc sau khi nén ngữ cảnh. Chi tiết lệnh: `README.md`. Quy trình Claude: `D:\AI repo\Youtube\skill\cartoon-3d-short\SKILL.md`.

## Đường dẫn

| Thứ | Vị trí |
|---|---|
| Bộ công cụ (dự án Remotion) | `D:\AI repo\Youtube\repo-tool\my-video` |
| CLI | `node scripts/food.mjs <lệnh> --episode croissant --format short` |
| Skill | `D:\AI repo\Youtube\skill\cartoon-3d-short` (junction từ `~/.claude/skills/cartoon-3d-short`) |
| Video xuất ra | `D:\AI repo\Youtube\video-output` (junction từ `my-video\out`) |
| Bản trước khi sửa camera | `out/croissant/short/before/` |

## Tập mẫu croissant

- **Short (đang làm):** kịch bản v2 "giữ chân" 13 câu, 162 từ; giọng Bella `hpp4J3VqNfWAUOO0d1Us`, speed 1.0 (chỉ cho Short, đặt trong `short/config.json`); 44 shot cắt nhanh; dài 67,9 giây; mix -15,0 LUFS. Preview đã render, QA đạt. **Bản final 1080x1920 đã xuất ngày 2026-11-17**: `out/croissant/short/croissant-short-1080x1920-final.mp4` (53,6 MB, H.264 + AAC, 67,87 giây), QA final đạt (-15,0 LUFS, -1,5 dBTP). Chưa đăng lên đâu cả.
- **Long: TẠM HOÃN** theo yêu cầu người dùng. Giọng, timeline, mix đã có và dùng lại được. Còn thiếu 3 gói Kenney (Castle, Factory, Mini Shop) — xem `episodes/croissant/DOWNLOAD_GUIDE.md`. Không làm Long cho tới khi người dùng nhắc lại. **Nháp Long v2 (2026-11-17)** theo mẫu `skill/cartoon-3d-short/templates/STORY_STRUCTURE.md`: `long/script.v2-draft.json` + bản dịch `long/SCRIPT_V2_VI.md` (70 câu, 1.278 từ, 4 mốc năm, ước 8:30). Chưa thu giọng (cần ~7.200 ký tự, vượt ngân sách còn lại), chưa storyboard; v1 giữ nguyên. Thêm nguồn `cnrtl-viennoiserie` và claim `c21` vào `sources.json`.
- ElevenLabs: khóa chỉ đọc từ biến môi trường người dùng `ELEVENLABS_API_KEY`. Đã dùng khoảng 9.700 ký tự cho tập này (Short v1 1.121, Short v2 939, Long 7.545, mẫu 131).

## Hệ thống camera (sửa ngày 2026-11-17)

Nguyên nhân nhân vật 2D bị nghiêng, mỏng như tờ giấy, méo:
1. Góc `dutch` nghiêng máy 7 độ khi có nhân vật (q07); rung máy có xoay (q06, q13, q20).
2. Góc nhìn từ trên cao vượt 20 độ so với tầm mắt (q03, q15, q25): thẻ phẳng bị bẹt.
3. Người đi đường dùng hình **chính diện** nhưng trượt ngang 0,8–1,1 m/s (q03, q04, q07, q20, q21, q23, q44): trượt chân.
4. Khung dọc đặt máy quá xa/quá xiên: đầu ra ngoài khung (q15, q21, q26), mặt bị quầy kính che (q25).

Đã sửa:
- `src/core/direct.ts` (mới): chọn camera cho từng frame, roll = 0 khi có nhân vật, rung chỉ tịnh tiến, và bộ đo `auditTimeline` chạy trên **mọi frame của mọi đường camera**.
- `src/core/stage.ts`: `charCam` (ngang tầm mắt ±10 độ, phía trước sân khấu |yaw| ≤ 40 độ, ống 26–36 độ, khung riêng cho dọc) và `noChars` cho cảnh chỉ có món ăn.
- `src/scenes/people.ts`: hình **đi nghiêng** (`bodySide`) cho người đi ngang, bước chân gắn với quãng đường nên không trượt; người mặc váy (không có hình đi nghiêng) đứng yên. Hình được chọn theo hành động trong shot, không theo vị trí camera. Không có hình sau lưng hay ba phần tư.
- `src/scenes/bakery.ts`, `street.ts`, `docs.ts`: preset theo cỡ cảnh (toàn, trung, cận, chi tiết, từ trên xuống); góc trên cao/từ trên xuống chỉ dùng khi ẩn nhân vật; quầy kính ẩn khi máy quay xuyên qua.
- `episodes/croissant/short/storyboard.json`: 44 shot, mỗi shot có `note` ghi lý do chọn góc.
- Lệnh mới `camcheck`: `node scripts/food.mjs camcheck --episode croissant --format short` (thêm `--legacy` để đo theo hành vi cũ).

Kết quả đo: **trước 34 lỗi, 5 cảnh báo → sau 0 lỗi, 0 cảnh báo** (44 shot, 2.036 frame).
Báo cáo: `out/croissant/short/camera-audit-before/` và `camera-audit-after/` (gồm `camera-audit.md`, `before-after.jpg`, `walk-strips.jpg`).

## Tay làm việc và nét mực tòa nhà (sửa ngày 2026-11-17, sau góp ý của người dùng)

- **Tay:** `bodyFront` trong `src/videos/bridge/toon.ts` có thêm tùy chọn `hands` (vị trí hai bàn tay, vẽ trước thân, khuỷu tay gập ra ngoài). `Person.pose` trong `people.ts` nhận `hands` theo mét và `hold` (cầm bánh); `handWorld` cho vị trí bàn tay trong không gian 3D.
- **Tiệm bánh** (`bakery.ts`): nhào bột (hai tay ấn theo nhịp cục bột, cục bột dời tới ngay dưới tay); đẩy xẻng (thợ đứng yên, xẻng trượt qua tay vào miệng lò, cán xẻng gắn vào tay); đưa bánh qua tủ kính; nghe tin thì giơ tay lên má; cậu học việc xếp bánh lên khay, lo lắng thì chắp tay. Không ai trượt trên sàn bằng hình chính diện.
- **Phố** (`street.ts`): người lính đứng thì chỉ tay về tiệm; một người xếp hàng cầm bánh.
- **Nét đứt:** các tòa nhà sát nhau trên cùng một mặt phẳng để lại khe hở cỡ điểm ảnh, bộ vẽ nét mực vẽ thành vệt đứt dọc chỗ nối. Giờ các nhà xen kẽ lùi vào 0,45 m. Bảng hiệu nhô 0,27 m, cửa và cửa sổ có khung sâu (bước cũ vài cm nằm dưới ngưỡng nét mực nên nét lúc có lúc không).
- Ảnh kiểm tra: `out/_fix/` (`street_before_after.jpg`, `sheet_knead.jpg`, `sheet_peel_serve.jpg`). camcheck vẫn 0 lỗi (`camera-audit-after-hands`).

## Nhịp cắt theo loại đoạn (2026-11-17, góp ý #6 của người dùng)

- Mỗi shot có `pace`: `hook` 1–3 s, `story` 2–4 s, `process` 3–6 s (tới 9 s không cảnh báo), `insert` 1–2 s. Bảng `PACE` và `checkPace` trong `scripts/lib/timeline.mjs`; `timeline` in tổng kết, `validate` cảnh báo shot lệch khung.
- Short cắt lại: 44 → 34 shot (hook 5, story 15, insert 11, process 3), không shot nào lệch khung. Gấp bột thành 3 shot dài (3,8 s, 5,1 s, 3,1 s) có máy chuyển góc trong shot. 38 sự kiện âm thanh/hành động giữ nguyên frame.
- Cảnh gấp bột: thêm thân bàn dưới mặt bàn (hết dải trắng ở đáy khung, lỗi cũ q37/q38) và camera `layer` nhìn thấp, sát mặt cắt để thấy 27 lớp.
- Preview đã render lại 2026-11-18, QA đạt (2.036 frame, -15,0 LUFS, -1,5 dBTP); ảnh kiểm tra `out/_fix/pace/`.
- Bản cũ: `out/croissant/short/before-pace/` (storyboard + timeline). Bản final cũ (44 shot) chưa bị ghi đè; muốn xuất lại: `render --quality final`, `mux --quality final`, `qa --quality final`.

## Quy trình bằng lệnh /mon-... (2026-11-18, theo yêu cầu người dùng)

- Lệnh (skill dự án trong `D:\AI repo\Youtube\.claude\skills\`): `/mon-goi-y`, `/mon-lam <số | tên món> [long]`, `/mon-viet-lai <góp ý>`, `/mon-dong-y`, `/mon-hoan-thanh`, `/mon-trang-thai`. Bảng tóm tắt trong README mục 8 và SKILL.md `cartoon-3d-short`.
- Lệnh CLI mới: `new` (tạo tập), `pipeline` (bước của món, lưu ở `episodes/_pipeline.json`), `scriptcheck` (kiểm kịch bản trước khi thu giọng), `monitor` (trang theo dõi http://localhost:3124, file `scripts/monitor.html`). `--episode current` = món đang làm. Mã trong `scripts/lib/pipeline.mjs`.
- `still`, `render`, `mix`, `mux`, `qa` ghi `out/<slug>/<format>/render-status.json`; lỗi giữa chừng cũng được ghi lên trang.
- `.claude/launch.json` (ở `D:\AI repo\Youtube`): `food-monitor` (3124), `food-studio` (3123, món đang làm, Short), `food-studio-long` (3125).
- Sửa kèm: chất lượng `draft` giờ là đúng 1/3 (trước là 0,3334 làm video draft lỗi vì chiều cao không nguyên).
- Món đang làm: croissant, bước `preview`.

## Việc còn lại cho bản Short

1. Người dùng xem preview, nghe giọng mới và duyệt.
2. ~~Xuất final~~: đã xong. Muốn xuất lại sau khi sửa: `render --quality final --force`, `mux --quality final`, `qa --quality final`.
3. Hạn chế đã biết: chưa có hình nhân vật nhìn nghiêng khi đứng, ba phần tư hay sau lưng, nên góc quay quanh nhân vật bị cấm; vài shot nền trơn màu kem còn nhạt.

## Kiểm tra đã chạy

`npx tsc --noEmit` sạch; `node --test tests/food.test.mjs` 22/22; `camcheck` 0 lỗi; `qa` preview đạt (2.036 frame, -15,0 LUFS, true peak -1,5 dBTP).
