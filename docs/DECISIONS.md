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
