# Bộ công cụ video hoạt hình lịch sử món ăn

Tạo video kể nguồn gốc và quá trình biến đổi của món ăn khắp thế giới, cho khán giả Mỹ: lời dẫn American English (giọng nữ ấm, sinh động qua ElevenLabs), phong cách "nhân vật 2D trong không gian 3D" của skill [claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts), render bằng three.js trong Remotion ngay trên máy.

Mỗi tập có hai bản dùng chung nghiên cứu và asset:

| | Short | Long |
|---|---|---|
| Thời lượng mục tiêu | 75 giây (60-90) | 600 giây (480-720, đủ điều kiện đặt quảng cáo giữa video) |
| Khung hình mặc định | 9:16, 1080x1920 | 16:9, 1920x1080 |
| fps | 30 | 30 |

Thời lượng, tỷ lệ, kích thước, phụ đề và nhãn đều đổi được cho từng tập hoặc từng lần chạy. Chưa có tập nào: mọi tập, video và bối cảnh Blender đã xóa ngày 2026-11-26, chỉ giữ phần khung. Dữ liệu mẫu cho test nằm ở `tests/fixtures/croissant`.

Thư mục `src/videos/bridge` chỉ còn các module hình dùng chung (nét mực, nhòe ống kính, chỉnh màu, tô hai tông, ánh sáng, nhân vật); phần riêng của video cây cầu đã bỏ ngày 2026-11-25. Quy tắc của kênh chỉ nằm trong `skill/cartoon-3d-short/huong-dan/`.

## 1. Kiểm tra môi trường

```bash
node scripts/food.mjs doctor
```

Lệnh báo phiên bản Node, Python (numpy, scipy, Pillow), ffmpeg, Chrome, thư mục tạm và việc đã có khóa ElevenLabs hay chưa (không in giá trị khóa). Phiên bản đã kiểm chứng trên máy này (2026-11-17): Node 24.21, Remotion 4.0.541, three 0.175.0, @react-three/fiber 9.1.2, postprocessing 6.37.2, zod 4.6.7, Python 3.14.7, numpy 2.5.4, scipy 1.18.1, Pillow 13.0, ffmpeg 9.0.2. Nếu thiếu gói Node: `npm install` (dùng `package-lock.json` có sẵn).

`src/videos/bridge/shade.ts` vá shader của three.js và sẽ báo lỗi rõ (`three lights_fragment_begin changed`) nếu đổi phiên bản three không tương thích. Đừng nâng three khi chưa thử.

## 2. Khóa ElevenLabs

Khóa chỉ đọc từ biến môi trường, không ghi vào file dự án, không in ra log:

```powershell
setx ELEVENLABS_API_KEY "khóa-của-bạn"
```

Mở terminal mới sau khi đặt. Cách khác: sao chép `.env.example` thành `.env.local` (đã bị git bỏ qua, không nằm trong `public/`). Biến tùy chọn: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_OUTPUT_FORMAT`, `FOOD_CHROME`, `REMOTION_TMP`.

## 3. Quy trình cho một tập

Mọi lệnh có dạng `node scripts/food.mjs <lệnh> --episode <slug> --format short|long`.

```bash
# kiểm tra dữ liệu: schema, claim <-> nguồn, shot <-> lời dẫn, asset, thời lượng
node scripts/food.mjs validate --episode croissant --format short

# giọng đọc
node scripts/food.mjs voices                                         # giọng nữ American dùng được + hạn mức còn lại
node scripts/food.mjs tts --episode croissant --format short --dry-run   # số ký tự, số yêu cầu, không tốn credit
node scripts/food.mjs tts --episode croissant --format short --sample    # một mẫu ngắn để nghe
node scripts/food.mjs tts --episode croissant --format short             # tạo giọng + mốc thời gian từng từ

# timeline chuẩn (hình, phụ đề, âm thanh, QA cùng đọc file này)
node scripts/food.mjs timeline --episode croissant --format short

# xem trước
node scripts/food.mjs still --episode croissant --format short           # ảnh đầu, giữa, cuối
node scripts/food.mjs still --episode croissant --format short --shots all
node scripts/food.mjs render --episode croissant --format short --quality preview

# âm thanh, ghép, kiểm tra
node scripts/food.mjs mix --episode croissant --format short
node scripts/food.mjs mux --episode croissant --format short --quality preview
node scripts/food.mjs qa  --episode croissant --format short --quality preview

# bản cuối (bị chặn nếu thiếu asset bắt buộc hoặc chưa có giọng thật)
node scripts/food.mjs render --episode croissant --format short --quality final
node scripts/food.mjs mux --episode croissant --format short --quality final
node scripts/food.mjs qa  --episode croissant --format short --quality final
```

Bản Long dùng đúng các lệnh trên với `--format long`. Render Long được chia đoạn 900 khung, đoạn nào xong rồi thì lần sau bỏ qua (chạy lại lệnh để tiếp tục sau khi bị ngắt). Chỉ render một chương hoặc một khoảng: `--chapter ch5` hoặc `--frames 9000-9899` (khung tuyệt đối, hoạt ảnh và SFX không bị khởi động lại).

Chất lượng: `draft` (1/3), `preview` (1/2), `final` (đúng kích thước), `hq` (4/3: 1440x2560 dọc, 2560x1440 ngang).

Xem trực tiếp trong lúc làm (có tiếng, kéo thanh thời gian, xem từng khung, tự cập nhật khi sửa mã cảnh): `node scripts/food.mjs studio --episode croissant --format short` rồi mở http://localhost:3123 và chọn composition `FoodEpisode`. Sau khi đổi kịch bản, storyboard hoặc giọng, chạy lại `timeline` (và `mix`) rồi khởi động lại lệnh `studio`.

## 4. Chọn Short/Long, đổi thời lượng và tỷ lệ

Thứ tự áp dụng: preset của format, rồi `episodes/<slug>/<format>/config.json` (mục `render`), rồi tham số dòng lệnh.

```bash
node scripts/food.mjs timeline --episode croissant --format short --aspect 16:9   # Short ngang
node scripts/food.mjs render   --episode croissant --format short --aspect 16:9 --quality preview
node scripts/food.mjs validate --episode croissant --format long --duration 900   # mục tiêu 15 phút
node scripts/food.mjs timeline --episode croissant --format long --aspect 9:16 --captions on
```

- Chỉ đổi tỷ lệ: kích thước được suy ra (cạnh ngắn 1080). `--width` hoặc `--height` đơn lẻ suy ra cạnh còn lại.
- Kích thước mâu thuẫn tỷ lệ (ví dụ `--aspect 16:9 --width 1000 --height 1000`) báo lỗi, không tự cắt.
- `--duration` là mục tiêu để viết kịch bản và để kiểm tra; độ dài render thật luôn theo giọng đọc cộng phần đệm, và lệnh `timeline` in độ lệch. Không có gì tự kéo giãn hay cắt cho khớp.
- Kích thước khác mặc định được ghi vào file riêng (`timeline.1920x1080.json`, video `...-1920x1080-preview.mp4`), không đè bản mặc định.
- `--captions on|off`, `--labels on|off`: phụ đề tiếng Anh và nhãn địa điểm/năm, mặc định tắt. Nhãn chỉ được gắn vào claim có trạng thái `documented`.

## 5. Cấu trúc

```
episodes/<slug>/
  episode.json            món ăn, tên bản địa, vùng văn hóa, cấu hình giọng, ngân sách ký tự
  research.md             tóm tắt nghiên cứu cho người đọc
  sources.json            nguồn + claim (claim_id, trạng thái documented | disputed | legend | unknown, trích dẫn, vị trí)
  ASSET_PLAN.md, DOWNLOAD_GUIDE.md, asset-manifest.json
  short/ long/            config.json, script.json, storyboard.json, timeline.json, chapters.json, voice/, audio/
scripts/food.mjs          CLI      scripts/lib/   cấu hình, timeline, adapter ElevenLabs
scripts/audio/mix.py      nhạc nền + SFX + giọng, đọc timeline.json
scripts/qa/qa_stream.py   QA đọc video theo luồng
scripts/scene-still.mjs   ảnh kiểm tra một cảnh / asset ở nhiều tỷ lệ
src/core/                 bộ render chung (Episode.tsx, stage.ts, types.ts)
src/scenes/               thư viện cảnh: pastry, lamination, bakery, street, siege, page, factory
src/videos/bridge/        module hình dùng chung: ink, lens blur, grade, tô hai tông, ánh sáng, nhân vật
public/assets/            model 3D (xem asset-manifest.json)
out/<slug>/<format>/      video, ảnh, báo cáo QA
tests/food.test.mjs       node --test tests/food.test.mjs
```

Một timeline duy nhất: `timeline.json` được dựng từ mốc thời gian thật của giọng đọc và storyboard. Khung là số nguyên, khoảng là nửa mở `[a, b)`. Python đọc chính file này, không có lịch thời gian viết tay thứ hai. Đổi kịch bản hoặc giọng thì chạy lại `tts` (chỉ đoạn đổi mới tốn ký tự) rồi `timeline`; `mix` tự nhận biết đầu vào đổi qua fingerprint.

## 6. Quy tắc lịch sử được máy kiểm tra

- Mỗi câu có dữ kiện gắn `claims`; mỗi claim phải có nguồn trong `sources.json`.
- Claim `documented` mà chỉ có nguồn dạng chỉ dẫn (Wikipedia) hoặc không đọc được: cảnh báo.
- Shot minh họa claim `legend` bắt buộc có `legend: true` (hình ngả sepia, khung giấy), nếu không `validate` báo lỗi.
- Nhãn địa điểm/năm chỉ được dựa trên claim `documented`.
- Lệnh `validate` liệt kê các đoạn không gắn claim để bạn rà: chúng chỉ được là câu dẫn hoặc chuyển ý.

Máy không thay được việc đọc nguồn: `research.md` ghi rõ nguồn nào đã đọc, nguồn nào không truy cập được, và giới hạn của từng kết luận.

## 7. Asset 3D

```bash
node scripts/food.mjs assets --episode croissant --format long
```

Lệnh đối chiếu `asset-manifest.json` với file trong `public/assets/...` và cập nhật trạng thái `missing | downloaded | validated`. Khi thiếu asset bắt buộc: preview vẫn chạy, hiện khối sọc xám và nhãn DRAFT; `render --quality final` dừng với mã asset, thư mục cần đặt và trỏ tới `DOWNLOAD_GUIDE.md`. Sau khi xem ảnh kiểm tra: `assets --mark-validated <id>`.

Ảnh kiểm tra một cảnh ở cả hai tỷ lệ:

```bash
node scripts/scene-still.mjs --scene siege --legend --aspect 9:16,16:9 --assets episodes/<món>/asset-manifest.json
```

## 8. Thêm một món mới

**Cách dùng hằng ngày: gõ lệnh trong Claude Code** (mở Claude Code ở thư mục `D:\AI repo\Youtube`):

| Lệnh | Việc Claude làm | Bạn làm tiếp |
|---|---|---|
| `/mon-goi-y [số món] [chủ đề]` | Gợi ý món, mỗi món kèm kịch bản ngắn theo nhịp, cảnh 3D cần, độ chắc của nguồn | Chọn món |
| `/mon-lam <số hoặc tên món> [long]` | Tạo tập, nghiên cứu nguồn, viết kịch bản đầy đủ + bản dịch `SCRIPT_VI.md` | Đọc và duyệt |
| `/mon-viet-lai <góp ý>` | Ghi góp ý vào sổ lỗi, viết lại kịch bản | Đọc lại |
| `/mon-dong-y` | Lập storyboard và góc máy, liệt kê asset 3D còn thiếu kèm link tải miễn phí và thư mục đích; trong lúc chờ thì thu giọng và dựng cảnh | Tải asset vào đúng thư mục |
| `/mon-hoan-thanh` | Kiểm asset, mở trang theo dõi (http://localhost:3124) và Studio 3D (http://localhost:3123), tạo video, báo kết quả | Xem trong lúc render, báo lỗi ngay |
| `/mon-trang-thai` | Món đang ở bước nào, lệnh tiếp theo | |

Trang theo dõi (`node scripts/food.mjs monitor`) cho thấy ảnh tĩnh từng shot ngay khi render xong (kèm nhãn nhịp cắt), thanh tiến độ render theo frame, từng đoạn 30 giây đã render để xem ngay, bản preview có tiếng và kết quả QA. Bước của mỗi món lưu trong `episodes/_pipeline.json` (`node scripts/food.mjs pipeline`); `--episode current` là món đang làm.

Làm bằng tay (các lệnh ở trên dùng chính các bước này):

1. `node scripts/food.mjs new --episode <slug> --dish "Tên món"` tạo `episodes/<slug>/` (`episode.json`, `sources.json`, `research.md`, `asset-manifest.json`, `short/` và `long/` với `config.json`). Kịch bản và storyboard viết sau khi nghiên cứu. `scriptcheck` kiểm kịch bản trước khi thu giọng.
2. Nghiên cứu trước, ghi claim và nguồn; viết hai kịch bản riêng (Short không phải bản Long cắt cụt).
3. Trong storyboard, chọn cảnh có sẵn bằng `scene` và `params`. Chỉ dùng cảnh có sẵn thì **không phải sửa mã**.
4. Món cần hình khối riêng (tô phở, bánh mì dẹt, nồi lẩu...): thêm một file trong `src/scenes/` và một dòng đăng ký ở `src/scenes/index.ts`. Lõi render không đổi. Không có cấu hình nào tự dựng được mọi món.
5. Lập `ASSET_PLAN.md`, `DOWNLOAD_GUIDE.md`, `asset-manifest.json` cho bối cảnh cần tải.
6. Chạy `validate`, `tts --dry-run`, `tts`, `timeline`, `still`, `render`, `mix`, `mux`, `qa`.

## 7b. Nhân vật người que

Nhân vật trong video được vẽ bằng code (`src/videos/bridge/toon.ts`; trang phục từng loại người ở `outfitFor` trong `src/scenes/people.ts`). Quy tắc thiết kế nhân vật: `skill/cartoon-3d-short/huong-dan/05-nhan-vat.md`.
- Xem một nhân vật đúng như trong video: `node scripts/cast-sheet.mjs --who chef [--v 0]` xuất `out/_cast/<who>-v<v>.png`, gồm 7 biểu cảm, 4 tư thế tay làm việc và dáng đi nghiêng.
- Loại người hiện có: `baker`, `chef` (thợ bánh cổ điển: mũ cao, áo hai hàng cúc, tạp dề dài, khăn cổ đỏ, ria mép to), `apprentice`, `towns`, `paris`, `officer`, `worker`, `modern`.

## 8a. Vân bề mặt và phông nền bằng Dreamina

Tường, mặt tiền, sàn, bầu trời đúng thời kỳ có thể tạo bằng Dreamina CLI (`D:\CLI\dreamina\dreamina-canvas.exe`, hoặc biến môi trường `DREAMINA_CLI`).
1. Trong `asset-manifest.json`, thêm một mục `"kind": "texture"` có phần `generator`: `{ "tool": "dreamina", "model": "seedream_4.7", "resolution": "2K", "ratio": "16:9", "refs": ["<ảnh mẫu phong cách, đường dẫn tính từ my-video>"], "prompts": { "wall": "..." } }`.
2. `node scripts/food.mjs texture --episode <slug> --all`: lưu bản thiết kế lên canvas Dreamina riêng của tập và **chỉ báo giá** (miễn phí). Thêm `--dry-run` để xem câu lệnh mà không gọi Dreamina.
3. Người dùng duyệt số credit, rồi chạy `... --run --credit-ceiling <số>`: tạo ảnh, tải về `public/<targetDir>/<tên>.png`, ghi nút, tài nguyên và credit thật vào `generator.runs`. Muốn làm lại một ảnh: `--id <id> --force`.
4. Trong cảnh: `env.tex("<id>/<tên>", { repeat: [x, y] })` trả ảnh hoặc `null` (khi đó cảnh dùng màu vẽ tay). Cảnh `pastry` nhận sẵn `params.wallTex`.

Canvas và ảnh mẫu đã tải lên được ghi trong `episodes/<slug>/dreamina.json`.

## 8b. Dựng nhịp nhanh: góc máy, cắt cảnh, hiệu ứng nhấn

Tất cả khai báo trong `storyboard.json`, không sửa mã:

- **Góc máy**: mỗi cảnh có nhiều góc đặt tên. `pastry`: main, macro, top, low, wide, side, back, heroUp, dutch, orbit. `lamination`: main, top, macro, side, low, ots, dutch. `bakery`: main, oven, table, counter, baker, helper, high, low, shelf, tray. `street`: main, shop, low, sign, high, door, face, skyline, dutch. `page`: main, macro, top, low, dutch. Di chuyển máy giữa hai góc: `"camera": { "from": "door", "to": "face", "ease": "out" }`.
- **Cắt theo từ**: shot bắt đầu ở một từ của lời dẫn bằng `"at": { "segment": "t04", "word": "Danger," }` (thêm `occurrence` nếu từ lặp lại). Shot ngắn nhất 0,3 giây.
- **Hành động liền mạch qua nhiều lần cắt**: `"params": { "span": [0, 0.45] }` rồi `[0.45, 1]` ở shot kế để động tác (gấp bột, nướng) chạy tiếp thay vì bắt đầu lại.
- **Chuyển cảnh**: `"transition": "cut" | "dip" | "whip"` (whip = quét ngang nhòe 4 khung).
- **Nhấn nhịp** (sự kiện `"type": "action"`): `kick` rung máy tắt dần, `flash` chớp trắng 5 khung, `crunch` bẻ đôi bánh, `mark` tô sáng dòng tư liệu.
- **Tốc độ đọc riêng cho từng bản**: `"voiceSettings": { "speed": 1.0 }` trong `config.json` của format (không ảnh hưởng cache giọng của bản còn lại).

## 8c. Blender → Seedance → Remotion (đường mới, không three.js)

Blender chỉ dựng bố cục (vị trí, máy quay, nhân vật, động tác); Seedance vẽ lại hình đẹp; Remotion chồng chữ và ghép (`scripts/film.mjs`).

| Bước | Lệnh | Ra |
|---|---|---|
| Chia đoạn AI (≤ 15 giây, mỗi đoạn một địa điểm) | `node scripts/film.mjs segments --episode <slug> --format short` | `segments.json`, danh sách bối cảnh `.blend` còn thiếu |
| Bản mốc Blender | `node scripts/film.mjs guide --episode <slug> --format short [--segment s01] [--quality draft]` | `guide/sNN.mp4` (`blender/shot.py` trên `blender/sets/<cảnh>.blend`) |
| Seedance (chỉ báo giá) | `node scripts/film.mjs ai ...` rồi `--run --credit-ceiling N` khi đã duyệt | `ai/sNN.mp4` |
| Duyệt clip đã xem | `node scripts/film.mjs approve --episode <slug> --segment s01,s02` | `ai/sNN.json` ghi `approved` |
| Ghép | `node scripts/film.mjs assemble ...` (`--quality final` chỉ nhận clip đã duyệt) | `<slug>-<format>-WxH-<q>.silent.mp4` + `.json` ghi nguồn và timeline; rồi `food.mjs mix`, `mux`, `qa` |

Mỗi đoạn tách khi đổi bối cảnh, thành phố, thời kỳ hoặc giữa giai thoại và tư liệu. Mỗi `guide/sNN.mp4` và `ai/sNN.mp4` có file `.json` ghi khóa của đoạn (shot, máy quay, tham số, sự kiện có mốc thời gian trong đoạn); clip làm cho bản cắt cũ không bao giờ được dùng, và `mux` dừng khi hình được dựng cho timeline khác. Prompt Seedance dựng từ `params` (thêm câu tiếng Anh bằng trường `ai` của shot), không dùng `note`.

Bối cảnh `blender/sets/<cảnh>.blend` theo quy ước `CAM-<tên>`, `MARK-<vai>`, `ACT-<tên>`; nhân vật và động tác ở `blender/sets/<cảnh>.py`. Nhân vật Grease Pencil được vẽ một lần mỗi tư thế thành ảnh PNG (`blender/kit.py`, lưu ở `out/_cache/cards`) và dựng trên tấm phẳng để bối cảnh che được nhân vật. Blender: `D:pplender.exe`, hoặc `--blender <đường dẫn>` / biến `BLENDER_EXE`.

## 9. Âm thanh

- Giọng: ElevenLabs `POST /v1/text-to-speech/{voice_id}/with-timestamps`; lưu audio gốc và alignment gốc trong `voice/cache`, chuyển sang WAV 48 kHz bằng ffmpeg, mốc từng từ lấy từ thời gian ký tự thật. Bản Long chia theo ranh giới chương, có `previous_text`/`next_text`, cộng offset theo độ dài audio đã giải mã.
- Ngân sách: `voice.budget` trong `episode.json` (tổng ký tự, số lần tạo lại). Vượt thì lệnh dừng và cần `--allow-over-budget`. Yêu cầu gặp lỗi mạng được ghi `unknown` trong `voice/ledger.json` và không tự gửi lại.
- Có sẵn audio và mốc thời gian: `tts --import voice.wav --words words.json`.
- Nhạc nền là bản tổng hợp đơn giản, không phải nhạc của thời kỳ nào. Dùng file nhạc có quyền rõ ràng: đặt `music.file` và `music.credit` trong `config.json`.
- SFX chỉ phát theo sự kiện khai báo trong storyboard: crunch, thump, roll, knife, bell, page, steam, whoosh, fire, street, night, conveyor.
- Bản mix: stereo 48 kHz, khoảng -14 LUFS, true peak dưới -1 dBTP; các stem nằm trong `audio/`.

## 10. YouTube

`chapters.json` của bản Long có mốc chương (dán được vào phần mô tả) và các điểm nghỉ tự nhiên gợi ý cho quảng cáo giữa video. Đó chỉ là gợi ý biên tập: video dài từ 8 phút mới đặt được mid-roll, kênh vẫn phải đủ điều kiện kiếm tiền, và không có gì bảo đảm doanh thu hay việc quảng cáo sẽ hiện ở từng điểm. Công cụ này không đăng video và không bật quảng cáo.

## 11. Giới hạn

- Các cảnh là hình dựng bằng code cùng model low-poly; chất lượng hình cần người xem duyệt, số đo QA không thay được.
- Phát âm tên riêng do model giọng quyết định; cần nghe kiểm tra. Sửa cách đọc trong `episode.json` mục `voice.pronunciations` hoặc trường `tts` của từng đoạn.
- Trang tài liệu lỗi của ElevenLabs không đọc được lúc viết, nên việc phân loại lỗi dựa chủ yếu vào mã HTTP.
