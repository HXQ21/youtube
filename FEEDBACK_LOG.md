# Sổ ghi lỗi người dùng phản ánh

Mỗi lần người dùng báo một lỗi, Claude ghi thêm một mục vào đây: ngày, tập/bản, lỗi người dùng thấy, nguyên nhân, cách sửa, file đã sửa, cách kiểm tra và bài học cho các tập sau.
Trước khi làm một tập mới hoặc xuất bản final, đọc phần **Bài học** để không lặp lại lỗi cũ.

## Bài học (áp dụng cho mọi tập)

1. Kịch bản không được nặng số liệu. Short tối đa một năm, một con số, một tên người; Long tối đa khoảng 6 năm đọc thành lời cả bài, còn lại để nhãn trên hình. Viết theo mẫu chung `skill/cartoon-3d-short/templates/STORY_STRUCTURE.md` (#1).
2. Độ dài shot theo loại đoạn (#2, #6). Mở đầu gây tò mò: 1–3 giây. Kể sự kiện, nhân vật, hành trình: 2–4 giây, cắt khi chuyển ý, có hành động hoặc phản ứng. Thao tác và biến đổi món ăn: 3–6 giây, có thể lâu hơn khi người xem còn thấy quá trình tiến triển. Phản ứng hài hoặc chi tiết chèn nhanh: 1–2 giây. Mỗi shot ghi `pace` trong storyboard; lệnh `timeline` và `validate` cảnh báo shot lệch khung.
3. Nhân vật 2D: máy ngang tầm mắt ±10°, không nghiêng máy, không quay từ trên cao hay sau lưng, người đi ngang dùng hình đi nghiêng (#3).
4. Nhân vật đang làm việc phải dùng tay: nhào bột, cầm dụng cụ, đưa đồ. Không để tay buông khi cảnh nói về công việc đó (#4).
5. Các khối 3D đặt sát nhau phải lệch hẳn ra (≥ 0,3 m) hoặc liền một khối; chi tiết nhô ra chỉ vài cm sẽ làm nét mực bị đứt (#5).
6. Xem ảnh tĩnh ở kích thước thật, phóng to chỗ nối và viền, trước khi báo xong.
7. Nhân vật của kênh là **người que 2D** (đầu tròn to, thân nhỏ đơn giản, tay chân là nét que). Mọi ảnh tham chiếu hay thiết kế nhân vật phải theo kiểu này, không vẽ người đầy đủ (#8).
8. Ảnh Dreamina chỉ là **tham chiếu**. "Tạo nhân vật" mặc định là dựng nhân vật bằng code để dùng trong video; chỉ tạo ảnh Dreamina khi người dùng nói rõ cần ảnh, và luôn báo credit trước (#9).

## Lỗi đã biết từ repo gốc (video cây cầu, mromidev/claude-animated-shorts)

Nguồn: `skill/cartoon-3d-short/references/BRIDGE_WORKFLOW.md` (mục Gotchas và Readability traps). Cột cuối cho biết bộ công cụ món ăn đã xử lý chưa.

| Lỗi trong repo cũ | Cách tránh | Bộ công cụ món ăn |
|---|---|---|
| Mỗi lần đóng gói, Remotion chép `public/` vào thư mục tạm mà không xóa; ổ hệ thống đầy 60+ GB, render chết vì hết chỗ | Đặt TEMP/TMP sang ổ lớn; xóa thư mục `remotion-webpack-bundle-*` cũ khi không render (hỏi người dùng trước) | Đã xử lý: `REMOTION_TMP` = `D:\AI repo\Youtube\repo-tool\remotion-tmp` (hiện 523 MB) |
| Viết đường dẫn `"D:\remotion-tmp"` trong chuỗi JS: `\r` thành ký tự xuống dòng | Dùng `/` trong đường dẫn | Đã xử lý (dùng `path.join`) |
| Remotion ghi kèm một rãnh âm thanh câm | Ghép tiếng bằng `-map 0:v:0 -map 1:a:0` | Đã xử lý trong lệnh `mux` |
| Nét mực nằm chung pass với làm mờ hậu cảnh thì bị ghi đè | Nét mực là một pass riêng, chạy trước làm mờ | Giữ nguyên từ repo gốc |
| Thông số tính bằng điểm ảnh không đổi theo độ phân giải | Nhân theo chiều cao khung (`pxScale`) | Giữ nguyên |
| Camera nằm trong nhà, vật chắn tầm nhìn | Bỏ vật chắn trên đường ngắm | Có kiểm tra OCCLUDED trong `camcheck` và ẩn quầy kính khi máy nhìn xuyên qua |
| Nhiễu hạt phim 2,5 % làm file 2K nặng 910 MB, lên YouTube bị nhòe | Tắt nhiễu hạt | Đang tắt |
| File `.ts` nháp trong `out/` làm `tsc` báo lỗi | Đặt tên `.txt` | Lưu ý khi làm |
| Đạo cụ cách ống kính dưới ~2 m thành mảng to bị cắt ở mép khung; bụi cây ở tiền cảnh bị cắt thành "quả bóng xanh" | Đạo cụ tiền cảnh phải nhận ra được hoặc bỏ đi; khi dời camera thì xem lại | Có quy tắc MIN_DIST cho nhân vật; đạo cụ thì kiểm bằng mắt trên ảnh tĩnh |
| Biển hiệu vẽ bị nắng chiếu ngang thành xám xanh, không đọc được | Mặt biển dùng vật liệu không nhận ánh sáng | Cần kiểm khi đổi ánh sáng phố (biển hiện vẫn đọc rõ) |
| Viền sáng vàng làm bằng bản sao lệch ra ngoài biến mũ thành khung tranh | Chỉ viền sáng phía trong, chỉ đầu và thân | Giữ nguyên |
| Lan can ngang ngực cắt qua người | Đặt ống kính cao ~2,5 m để lan can cắt chân | Lưu ý cho cảnh có lan can |
| Đoạn đứng yên bị QA coi là khung hình đứng hình (≥ 12 frame) | Mọi đoạn giữ khung đều có đẩy máy chậm | `drift` trong mọi camera; QA vẫn đo |
| Cờ đỏ sao vàng bị đọc nhầm thành cờ Việt Nam | Dùng cờ đúng thời kỳ | Lưu ý khi thêm cờ |

## Lỗi kỹ thuật Claude gặp khi dựng bộ công cụ món ăn

| Lỗi | Nguyên nhân | Đã sửa |
|---|---|---|
| kenney.nl chặn tải tự động (403) | Trang chặn bot | Người dùng tải tay |
| Model Kenney thiếu `Textures/colormap.png` (404) | Thiếu thư mục Textures | Chép thư mục Textures cùng model |
| Cảnh rộng sau cảnh cận bị mờ cả khung | near/far của camera đổi theo shot, pass làm mờ dùng giá trị cũ | near/far cố định cho cả phim |
| Mái nhà bị lộn hoặc mất | Hình học mái sai | Mái là khối lăng trụ dựng tay (`gable`) |
| Mặt đất hết giữa khung | Mặt đất quá nhỏ | Mở rộng mặt đất |
| Mix vượt trần đỉnh thật (true peak) | Chỉ chỉnh âm lượng | Thêm limiter rồi bù âm lượng tĩnh |
| Mix lỗi lệch độ dài 1 mẫu | Nhạc nền dài hơn 1 mẫu | Cắt hoặc độn nhạc đúng độ dài |
| QA đọc sai `--every 1.5` | Phân tích tham số sai | Sửa cách đọc tham số |
| Lệnh `studio` hỏng vì dấu cách trong `D:\AI repo` | Đường dẫn tuyệt đối bị tách | Dùng đường dẫn tương đối |
| Một shot dài âm 100 frame | Chữ "In" xuất hiện hai lần trong lời | Thêm `occurrence: 2` |
| Cục bột biến mất khỏi bàn (2026-11-17) | Chú thích viết cùng dòng đã biến lệnh `bench.add` thành chú thích | Tách chú thích; luôn xem ảnh tĩnh sau khi sửa |
| Ảnh tường Dreamina thử nghiệm ra cả cảnh bàn và croissant (2026-11-19) | Ảnh mẫu là shot món ăn, câu lệnh chưa đòi mặt phẳng trống | Quy tắc mới trong `/mon-dong-y` bước 6b: mặt phẳng trống nhìn thẳng, ảnh mẫu chỉ để lấy phong cách, xem từng ảnh trước khi dùng |
| QA và mix chết khi in tiếng Việt qua ống dẫn (2026-11-17) | Python trên Windows dùng cp1252 khi đầu ra bị chuyển hướng | `sys.stdout.reconfigure(encoding="utf-8")` trong `qa_stream.py` và `mix.py` |

## Các lỗi đã ghi

| # | Ngày | Tập / bản | Lỗi người dùng thấy | Nguyên nhân | Cách sửa (file) | Kiểm tra | Trạng thái |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | croissant Short | Kịch bản máy móc, nhiều dữ liệu, khó hiểu | Viết như bài tóm tắt nghiên cứu, nhiều năm và tên | Viết lại v2: mở đầu gây sốc trong 3 giây, câu hỏi treo, kéo lại giữa video, cú xoay, kết vòng lặp (`episodes/croissant/short/script.json`, SKILL.md bước 3) | Người dùng đọc bản dịch | Đã sửa |
| 2 | 2026-11-17 | croissant Short | Muốn chuyển cảnh qua nhiều góc quay liên tục | Shot dài, ít góc | Cắt lại thành 44 shot, thêm whip/flash (`short/storyboard.json`) | Preview | Đã sửa |
| 3 | 2026-11-17 | croissant Short | Nhân vật 2D bị nghiêng, mỏng như tờ giấy, méo | Máy nghiêng 7°, rung có xoay, quay từ trên cao quá 20°, người đi ngang dùng hình chính diện nên trượt chân | Quy tắc camera trong `src/core/direct.ts`, `charCam`/`noChars` trong `stage.ts`, hình đi nghiêng trong `people.ts` | camcheck từ 34 lỗi xuống 0 | Đã sửa |
| 4 | 2026-11-17 | croissant Short | Nhân vật không cử động tay khi nặn bánh hay làm việc | Hình chính diện chỉ có tay buông hoặc vẫy | Tùy chọn `hands` trong `toon.ts` và `people.ts`. Tiệm bánh: nhào bột, đẩy xẻng vào lò, đưa bánh, học việc xếp khay (`bakery.ts`). Phố: người lính chỉ tay về tiệm (`street.ts`) | Ảnh tĩnh `out/_fix/sheet_knead.jpg`, `sheet_peel_serve.jpg`; camcheck 0 lỗi | Đã sửa, có trong bản final 2026-11-17 |
| 5 | 2026-11-17 | croissant Short | Viền tòa nhà và cửa bị nét đứt đen chạy dọc | Các nhà đặt sát nhau cùng một mặt phẳng nên có khe hở cỡ điểm ảnh ở chỗ nối; bảng hiệu nhô 14 cm, cửa nhô 4 cm, dưới ngưỡng nét mực | Nhà xen kẽ lùi 0,45 m, bảng hiệu nhô 0,27 m, cửa và cửa sổ có khung sâu (`street.ts`) | `out/_fix/street_before_after.jpg` | Đã sửa, có trong bản final 2026-11-17 |
| 6 | 2026-11-17 | croissant Short | Muốn cắt cảnh theo bảng độ dài shot theo loại đoạn (mở đầu 1–3 s, kể chuyện 2–4 s, thao tác món ăn 3–6 s, chèn nhanh 1–2 s) | Storyboard cắt đều 1–2 s cho mọi đoạn: nhiều shot kể chuyện dưới 1 s, các shot gấp bột chỉ 0,5–2 s nên không kịp thấy bột biến đổi | Thêm trường `pace` và bước kiểm độ dài (`config.mjs`, `timeline.mjs`, `food.mjs`); cắt lại `short/storyboard.json` theo bảng; gấp bột thành 3 shot dài có máy chuyển góc trong shot; mẫu `STORY_STRUCTURE.md` và SKILL.md | `timeline` + `validate`: 0 shot lệch khung; camcheck 0 lỗi; test 23/23; preview + QA đạt; ảnh `out/_fix/pace/` | Đã sửa trong preview 2026-11-18; bản final chưa xuất lại |
| 7 | 2026-11-18 | croissant Short | Khi máy quay nghiêng (đổi góc hoặc di chuyển), nhân vật cũng xoay theo máy | Thẻ nhân vật 2D quay mặt về phía máy quay ở **mọi khung** (`Card.face` trong `src/core/stage.ts`, gọi từ `people.ts` mỗi frame). Máy trượt sang bên thì thẻ xoay theo, trông như tấm bìa quay; giữa hai góc đối diện nhân vật cũng "quay người" | Đang sửa: cố định hướng thẻ trong cả shot và giới hạn góc thẻ được xoay về phía máy | Ảnh trước/sau, camcheck, preview | Đang sửa |
| 8 | 2026-11-18 | Kênh (thiết kế nhân vật) | Bảng thiết kế nhân vật vẽ người đầy đủ (thân, tay chân có da thịt, nhiều chi tiết); người dùng chỉ cần ảnh tham chiếu cho nhân vật 2D **người que** của kênh | Claude không hỏi lại kiểu dáng, viết prompt theo kiểu nhân vật minh họa thông thường thay vì kiểu người que (đầu tròn to, tay chân là nét que) | Viết lại prompt theo đúng kiểu người que, dùng ảnh nhân vật trong video làm mẫu phong cách (`brand/prompt-char-*-stick.txt`) | Bảng mới `brand/character/stick-turnaround.png`, `stick-expressions.png` | Đã sửa 2026-11-18 (thêm 46 credit) |
| 9 | 2026-11-19 | Kênh (nhân vật) | Yêu cầu "tạo nhân vật đầu bếp từ mẫu tham chiếu" là để **dựng bằng code cho video**; Claude lại tạo thêm ảnh Dreamina (46 credit) | Hiểu "tạo nhân vật" là tạo ảnh; không hỏi lại đầu ra là ảnh hay nhân vật trong video | Dựng thợ bánh người que bằng code (`src/videos/bridge/toon.ts`, `src/scenes/people.ts`), render bảng nhân vật từ chính bộ dựng video | `node scripts/cast-sheet.mjs --who chef` -> `out/_cast/chef-v0.png`, so với `brand/character/chef-*.png` | Đã sửa 2026-11-19 (nhân vật `chef` có trong code, chưa đưa vào cảnh) |
