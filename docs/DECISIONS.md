# Nhật ký quyết định

Ghi lại mọi chỗ **làm khác với thiết kế** trong bộ plan, và các quyết định mới phát sinh khi implement. Các quyết định kiến trúc ban đầu (ADR-01 … ADR-14) nằm ở [02-architecture.md](02-architecture.md#4-các-quyết-định-kiến-trúc-adr-tóm-tắt); các câu hỏi đang chờ chốt (D1 … D12) nằm ở [11-risks-open-questions.md](11-risks-open-questions.md).

Mỗi mục mới thêm vào **đầu** danh sách, theo mẫu:

```
## YYYY-MM-DD — Tiêu đề ngắn
- Gói việc: P?.?
- Bối cảnh: vấn đề gặp phải
- Quyết định: làm gì
- Khác plan ở đâu: tài liệu/mục nào đã được sửa theo
- Hệ quả: việc phải làm thêm hoặc rủi ro mới
```

---

## 2026-11-13 — Tài khoản khách thật, realtime nhận JWT

- Gói việc: P3.1
- Bối cảnh: thay danh tính tự đặt của P2 bằng tài khoản thật lưu ở Postgres.
- Quyết định:
  - Trình duyệt luôn vào phòng bằng access token của API (`services/auth.ts`): `/auth/refresh` bằng cookie, không có thì tạo khách. Tên trên màn hình chào chỉ còn là gợi ý điền sẵn (`localStorage` `campus.name.v1`).
  - Các lần làm mới token được xếp hàng giữa các tab bằng Web Locks, vì refresh token xoay vòng và hai lần dùng đồng thời bị coi là bị đánh cắp.
  - Realtime kiểm tra token bằng JWKS của API (`AUTH_JWKS_URL`). `DEV_GUEST_AUTH` vẫn giữ cho bot thử tải; e2e chạy với nó **tắt**.
  - Chọn chỗ xuất hiện (`spawn`) tách thành cờ riêng `DEV_SPAWN` (mặc định bật ngoài production) để test vẫn dùng được khi danh tính dev tắt.
  - Giới hạn làm mới token 300/phút/IP thay vì 30: cả văn phòng chung một IP NAT. Thêm `RATE_LIMIT_SCALE`. Khoá theo cookie không dùng được vì token đổi sau mỗi lần làm mới.
  - Bản build của API mang theo thư mục migration (`dist/drizzle`) — trước đó bản bundle không tìm thấy migration khi tự migrate.
  - Bảng `user_stats` làm cùng sổ cái ở P4.1, vì chỉ có nghĩa khi có phần thưởng.
- Khác plan ở đâu: `07-backend-data.md` §5.1 (luồng phía trình duyệt, giới hạn tần suất), `05-multiplayer.md` §6 (tuỳ chọn khi vào phòng, vào lại), roadmap P3.1/P4.1.
- Hệ quả:
  - Tài khoản bị khoá không lấy được token mới (có test), nhưng token còn hạn (≤ 15 phút) vẫn vào được phòng cho tới khi P5 có tín hiệu moderation.
  - Mã khôi phục của khách chưa có giao diện (P3.4); cookie bị xoá thì mất tài khoản khách.
  - Mất phiên (cookie hết hạn, bị thu hồi) rồi bấm "Thử lại" sẽ tạo tài khoản khách mới.

## 2026-11-13 — Thử tải: chưa cần tinh chỉnh; số đo nội bộ qua `/rt/metrics`

- Gói việc: P2.4
- Bối cảnh: plan đặt giả thuyết "một tiến trình chịu vài trăm người"; cần số đo.
- Quyết định: thêm `GET /rt/metrics` (JSON: thời gian mã hoá patch, độ trễ event loop, CPU, RAM, message/giây, số phòng/người) và `tools/loadtest`. Kết quả ở `05-multiplayer.md` §11: 1.000 bot dùng ~22% một nhân, nên giữ nguyên thiết kế (đồng bộ cả phòng, 10 Hz, kênh 80/100), không làm lọc theo vùng.
- Khác plan ở đâu: plan dự định dùng `@colyseus/loadtest`; công cụ tự viết dùng chính SDK của game, đo thêm băng thông và thời gian vào phòng, không cần thêm gói.
- Hệ quả: `/rt/metrics` là endpoint nội bộ — P7.1 phải chặn nó ở reverse proxy (hoặc chuyển sang định dạng Prometheus sau lớp xác thực).

## 2026-11-13 — Giao lưu: emote, ghế, chat gần, vắng mặt, danh bạ

- Gói việc: P2.3
- Quyết định:
  - **Emote** là tư thế thủ tục của avatar tạm (6 loại). Server giữ `emote` + `emoteSeq`, tối đa 1 emote/2 giây.
  - **Ghế:** server cấp ghế khi người chơi đứng trong 2,5 m, cùng tầng, ghế trống; tự trả ghế khi đi xa quá 1,5 m hoặc rời phòng.
  - **Bộ lọc từ chat** nằm ở `packages/core`. Từ tục tiếng Việt chỉ bắt khi viết **có dấu**, vì bỏ dấu sẽ trùng từ thường ("lồn"/"lớn", "cặc"/"các"); viết tắt ASCII (đm, vcl…) và tiếng Anh bắt theo nguyên từ. Ưu tiên không che nhầm câu bình thường; phần lọt lưới để báo cáo/kiểm duyệt (P5.4) xử lý.
  - **Chưa có bộ đệm chat 24 giờ** cho báo cáo vi phạm (plan §8): làm cùng nút báo cáo ở P5.4, khi có Redis. Hiện chat chỉ đi qua bộ nhớ, không lưu ở đâu.
  - **Vắng mặt / treo máy:** tab ẩn hoặc 5 phút không thao tác → "vắng mặt"; 30 phút → mời ra (mã 4103).
  - **Danh bạ online** dùng hash của Colyseus presence thay cho các khoá Redis tự đặt (`presence:user:*`), để chạy được cả một tiến trình lẫn nhiều tiến trình mà không đổi mã.
  - **Chuyển kênh giữ vị trí** qua tuỳ chọn `resume` khi vào phòng; server chỉ chấp nhận chỗ đi được.
  - **Kích thước kênh** chỉnh được bằng `CHANNEL_SOFT_CAP` / `CHANNEL_HARD_CAP` (test e2e dùng ngưỡng mềm 3).
- Khác plan ở đâu: đã sửa `05-multiplayer.md` §7.
- Hệ quả: tuỳ chọn "ẩn khỏi danh sách online" làm ở P3.4 cùng hồ sơ.

## 2026-11-13 — Lớp mạng phía client và test e2e

- Gói việc: P2.2
- Quyết định:
  - **Điểm xuất hiện** là điểm ở cổng xa người đang đứng nhất (trước là xoay vòng, hai người vào liền nhau đứng chồng lên nhau).
  - **Rời trang = rời phòng ngay:** trình duyệt đóng WebSocket với mã 1001 khi đóng/rời trang; server không giữ chỗ 30 giây cho mã này. Rớt mạng thật (1006) vẫn được giữ chỗ.
  - **Kết nối lại:** SDK chỉ tự thử lại khi đã ở trong phòng ≥ 5 giây và chờ tối đa 5 giây giữa các lần; hạ xuống 1 giây và 3 giây. Không gửi `move` khi đang kết nối lại, để không dồn các gói cũ.
  - **Người ở xa** vẽ bằng một `InstancedMesh` hình nộm hai khối (một draw call cho tất cả); avatar đầy đủ chỉ cho người gần nhất: 24 / 48 / 96 người theo mức Thấp / Trung bình / Cao. Thẻ tên cho 12 người gần nhất trong 24 m.
  - **Ngoại hình tạm** suy ra từ userId (băm), nên mọi người thấy cùng một dáng cho cùng một người cho tới khi có avatar thật (P3.3).
  - **Tên hiển thị** nhập ở màn hình chào, nhớ cùng id khách trong trình duyệt.
  - **Test e2e** (`tests/e2e`, Playwright) chạy trên bản build: API, realtime và `vite preview`. `@playwright/test` ghim ở 1.63.0 cho khớp trình duyệt cài sẵn trong môi trường phát triển; CI tự cài Chromium. `?debug` mở `window.campus.remotes()` chỉ để test đọc.
- Khác plan ở đâu: không đổi thiết kế tổng thể; các chi tiết trên bổ sung cho `05-multiplayer.md` §5–§6.
- Hệ quả: CI có thêm job e2e (~1 phút test + cài Chromium).

## 2026-11-13 — Phòng realtime: danh tính dev, xếp kênh bằng metadata, đồng hồ phòng

- Gói việc: P2.1
- Quyết định:
  - **Danh tính tạm cho dev:** client gửi `guest: { id, name }` khi vào phòng (id ngẫu nhiên do trình duyệt giữ). Chỉ được chấp nhận khi `DEV_GUEST_AUTH=on`; mặc định bật ở mọi môi trường trừ production. P3.1 thay bằng JWT.
  - **Xếp kênh** dựa trên tính năng sẵn có của Colyseus (lọc theo metadata `open`, sắp theo số người) thay vì một endpoint xếp kênh riêng; xem `05-multiplayer.md` §1.
  - **Đồng hồ phòng:** state có `time` (ms từ lúc tạo phòng) thay cho bộ đếm `tick`; `pong` trả cùng đồng hồ đó để client tính lệch giờ.
  - **Một người một phiên** dùng pub/sub của Colyseus presence: mỗi lần vào phòng phát `{ userId, sessionId }`, mọi phòng đóng phiên cũ của người đó bằng mã 4101. Chạy được nhiều tiến trình khi bật Redis presence.
  - Ngắt kết nối do server chủ động (mã 41xx) không giữ chỗ; mọi trường hợp rớt mạng khác giữ chỗ 30 giây, trạng thái người chơi chuyển "đang kết nối lại".
  - Phòng `hello` của P0.1 đã bỏ; trang kiểm tra trạng thái realtime qua `GET /rt/channels`.
- Khác plan ở đâu: đã sửa `05-multiplayer.md` §1 và §3.
- Hệ quả: chừng nào chưa có P3.1, ai biết địa chỉ server dev cũng vào được với tên tự đặt — không mở server dev ra internet.

## 2026-11-13 — Vỏ ứng dụng: tầm nhìn dài hơn, minimap xoay theo hướng nhìn, cửa chính rộng hơn

- Gói việc: P1.4
- Bối cảnh và quyết định:
  - **Tầm nhìn** đổi từ 80/150/300 m thành 140/220/400 m. Cảnh được gộp thành vài lưới lớn nên mặt phẳng xa gần như không cắt bớt được gì; sương dày ở 80 m chỉ làm mất định hướng trong một campus rộng 350 m. Nút thắt hiệu năng thật là độ phân giải (DPR) và số avatar, nên thang tự động điều chỉnh hai thứ đó.
  - **Minimap xoay theo hướng camera** (phía trước luôn ở trên). Ở cổng, người chơi nhìn vào toà nhà theo hướng +Z, tức là hướng *xuống* trên bản đồ cố định — rất dễ nhầm. Nhãn trên minimap là phần tử HTML riêng, luôn đứng thẳng.
  - **Cửa chính phía bắc rộng 12 m** (trước là 8 m): điểm xuất hiện ở cổng trải rộng 9 m, đi thẳng từ điểm ngoài cùng sẽ đâm vào tường cạnh cửa. Có test cho mọi điểm xuất hiện.
  - **Màn hình chào nằm trong chunk riêng** (69 KB gzip), three.js tải sau; campus chỉ được dựng sau khi màn hình chào đã hiện. Nút "Vào campus" là khoảnh khắc "đi làm" và cũng là thao tác người dùng cần có để bật âm thanh sau này.
- Khác plan ở đâu: đã sửa `04-client.md` §4 và §13; vị trí cửa trong map-data.
- Hệ quả: avatar giả hiện mỗi người là một draw call; trần LOD và impostor làm ở P2.2.

## 2026-11-13 — Nhân vật tạm dựng bằng code thay vì bộ CC0

- Gói việc: P1.3
- Bối cảnh: P1.3 ghi "nhân vật mẫu có xương (CC0)". Bộ Quaternius là file zip 120–600 MB ở định dạng FBX/glTF, cần chuyển đổi và nén — việc của pipeline asset (P6.1), chưa có.
- Quyết định: dựng một nhân vật khối bằng code (12 xương, skin cứng) với animation thủ tục. Đủ để kiểm chứng điều khiển, camera, va chạm và LOD đám đông; không thêm byte nào vào lần tải đầu.
- Khác plan ở đâu: đã ghi chú ở `03-world-and-assets.md` §7.
- Hệ quả: P3.3 thay bằng nhân vật module thật (gộp mesh, bảng màu, chuỗi cấu hình). Giao diện `Avatar` (`update(dt, { anim, speed })`, `setLook`) được giữ để phần còn lại không phải sửa.

## 2026-11-13 — Điều khiển: joystick nổi, chạy bằng cách đẩy hết cần

- Gói việc: P1.3
- Bối cảnh: cần một sơ đồ chạm dùng được bằng một ngón trên điện thoại cầm dọc.
- Quyết định: chạm ở 45% bên trái màn hình làm joystick hiện ngay dưới ngón tay; đẩy quá 85% bán kính thì chạy. Phần còn lại kéo để xoay camera, hai ngón để zoom. Nút nhảy chỉ hiện trên thiết bị cảm ứng. Mô phỏng chạy bước cố định 60 Hz, vẽ nội suy giữa hai bước. Camera tự do của P1.2 chuyển vào bảng Debug (thu gọn mặc định).
- Khác plan ở đâu: khớp `04-client.md` §5–§6; không đổi tài liệu.
- Hệ quả: chưa có emote, tương tác, chạm-để-đi (để P2.3, P4.3, P6.6).

## 2026-11-13 — Greybox không dùng tone mapping; lớp phẳng vẽ bằng polygon offset

- Gói việc: P1.2
- Bối cảnh: với tone mapping ACES, màu của bản dựng khối bị xỉn và trần nhà quá tối. Ngoài ra các lớp phẳng trên mặt đất (cỏ, đường, sàn, nước) chỉ cách nhau vài mm nên nhấp nháy khi nhìn từ xa.
- Quyết định: tắt tone mapping cho greybox, thêm một đèn ambient. Mỗi lớp phẳng là một lưới riêng có polygon offset tăng dần.
- Khác plan ở đâu: `04-client.md` §4 ghi "tone mapping AgX/ACES" — đã sửa; cách dựng mô tả ở `03-world-and-assets.md` §5.0.
- Hệ quả: thêm khoảng 7 draw call cho các lớp phẳng (tổng vẫn dưới 50). Đánh giá lại tone mapping khi có lightmap ở P6.

## 2026-11-13 — Bản đồ v0: định dạng chỉnh lại và bố cục giả định

- Gói việc: P1.1
- Bối cảnh: khi viết bộ dựng thật mới thấy định dạng trong plan thiếu vài thứ để dựng được nhà có cửa và cầu thang; đồng thời OSM không cho biết cổng vào ở đâu.
- Quyết định:
  - `Structure` có `voids` (lỗ sàn theo từng tầng, thay cho `holes`), `openings` (cửa) và `height` tuỳ chọn. `Connector` là một vế thang thẳng xác định bởi hai đầu + bề rộng; bộ dựng tự khoét sàn tầng trên. Bỏ loại POI `sign` (bảng tên khu suy ra từ area).
  - Gói có hai lối vào: `@campus/map-data` (thư viện) và `@campus/map-data/campus` (dữ liệu), để bộ sinh bản đồ không phải nạp chính file nó sắp ghi.
  - `campus.json` do `pnpm map:build` sinh ra từ OSM + bố cục giả định; không sửa tay.
  - Cổng chính đặt ở **giữa mặt đường Tân Thuận**, thẳng cửa bắc của block chính (từ cổng tới cửa 23 m, qua cửa thêm 22 m là tới Atrium). Đây là lựa chọn vì trải nghiệm, không phải dữ liệu thật.
  - Mã khu dùng tên trung tính: `area.cafe_terrace`, `structure.cafe_kiosk` thay vì tên thương hiệu.
- Khác plan ở đâu: đã viết lại `03-world-and-assets.md` §3 và §4.
- Hệ quả: P6.2 cần xác nhận vị trí cổng, sảnh, canteen, hồ Koi, cầu thang bằng tư liệu thật. Đổi id area/POI sau khi đã có nhiệm vụ tham chiếu là thay đổi phá vỡ (tăng major của bản đồ).

## 2026-11-12 — Mặc định chỉ lắng nghe trên 127.0.0.1

- Gói việc: P0.1
- Bối cảnh: `api` và `realtime` lúc dev không cần mở ra mạng LAN; điện thoại thử nghiệm đi qua Vite (`--host`), Vite proxy tiếp vào localhost.
- Quyết định: `API_HOST` và `REALTIME_HOST` mặc định là `127.0.0.1`.
- Khác plan ở đâu: plan chưa nói tới; ghi lại để P7.1 nhớ.
- Hệ quả: Dockerfile/Compose production phải đặt hai biến này thành `0.0.0.0`.

## 2026-11-12 — Dùng `@colyseus/core` trực tiếp, state khai báo bằng builder

- Gói việc: P0.1
- Bối cảnh: gói gộp `colyseus` export lại cả `@colyseus/auth`, `playground`, `monitor`, `redis-*` và nạp chúng ngay khi import. Plan đã quyết không dùng các gói còn beta. Ngoài ra decorator `@type()` cần `experimentalDecorators`, không hợp với `erasableSyntaxOnly`.
- Quyết định: `apps/realtime` phụ thuộc `@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema`. State khai báo bằng `schema({...})` và `t.*`. Route HTTP (health) dùng `createRouter`/`createEndpoint` của core, không cài express.
- Khác plan ở đâu: đã sửa bảng tech stack ở `02-architecture.md` và ví dụ schema ở `05-multiplayer.md` §3.
- Hệ quả: khi cần Redis presence/driver, monitor, loadtest thì cài từng gói riêng.

## 2026-11-12 — Gói nội bộ xuất mã TypeScript; app Node bundle bằng tsdown

- Gói việc: P0.1
- Bối cảnh: plan ghi "build bằng `tsc`". Với `tsc`, mỗi gói nội bộ phải có bước build riêng ra `dist/` và phải chạy watch song song lúc dev.
- Quyết định: gói trong `packages/` xuất thẳng `src/index.ts`. `api` và `realtime` dùng `tsx watch` lúc dev và bundle bằng tsdown ra `dist/index.mjs` cho production (gộp mã gói nội bộ, để thư viện npm bên ngoài). Thêm `pnpm smoke` chạy thử bản build.
- Khác plan ở đâu: đã sửa `02-architecture.md` §3 và §5.
- Hệ quả: thư viện npm mà gói nội bộ dùng phải được khai báo cả trong `dependencies` của app bundle nó. TypeScript 7.0.2 chạy tốt với toàn bộ toolchain, không phải lùi về 6.x.

## 2026-11-12 — Biome không format Markdown

- Gói việc: P0.1
- Bối cảnh: Biome 2.6 format cả Markdown và căn đều cột của bảng, làm mọi thay đổi nhỏ trong bảng (ví dụ cột trạng thái ở roadmap) thành diff lớn.
- Quyết định: loại `**/*.md` khỏi Biome.
- Khác plan ở đâu: đã ghi chú ở bảng công cụ trong `02-architecture.md`.
- Hệ quả: tài liệu giữ dạng bảng gọn, viết tay.

## 2026-11-12 — Lập plan v0.1
- Gói việc: —
- Bối cảnh: khởi tạo dự án, chưa có code.
- Quyết định: chấp nhận bộ tài liệu `docs/01` … `docs/11` làm thiết kế gốc; đi theo các mặc định D1 … D12 cho tới khi có quyết định khác.
- Khác plan ở đâu: —
- Hệ quả: P0 có thể bắt đầu ngay.
