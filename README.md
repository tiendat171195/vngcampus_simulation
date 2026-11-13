# VNG Campus Online (tên tạm)

Campus ảo 3D chạy trên trình duyệt, dựng theo VNG Campus: đăng nhập, điều khiển avatar đi lại trong khuôn viên, gặp đồng nghiệp đang online và cùng làm **nhiệm vụ hằng ngày** do admin tạo.

**Trạng thái:** xong phase P1 (P0.1 → P1.4): mở trang → màn hình chào → "Vào campus" → điều khiển nhân vật đi khắp campus 3D dạng khối, có minimap, tên khu khi bước vào, cài đặt chất lượng, và avatar giả để thử đám đông. Chưa có multiplayer (P2).

## Chạy thử

Cần **Node.js ≥ 22.12** và **pnpm 10** (chạy `corepack enable` là có đúng phiên bản pnpm).

```bash
pnpm install
```

```bash
pnpm dev
```

| App | Địa chỉ | Ghi chú |
|---|---|---|
| `web` — game | http://localhost:5173 | Nhân vật đi trong campus 3D. WASD/mũi tên, Shift chạy, Space nhảy, kéo chuột xoay, lăn zoom. Nút **Debug** góc phải: camera tự do, cắt lớp theo tầng, lưới va chạm |
| `web` — bản đồ debug | http://localhost:5173/debug/map | Sơ đồ 2D từng tầng, toạ độ và khu vực dưới con trỏ |
| `admin` | http://localhost:5174 | Trang trống, xây ở P5 |
| `api` | http://localhost:3001/api/health | REST (Fastify) |
| `realtime` | http://localhost:2567/health | Colyseus |

Trang web chỉ nói chuyện với **chính origin của nó**: `/api` là REST, `/rt` là realtime. Lúc dev, Vite đóng vai reverse proxy; khi triển khai thật, Caddy làm việc đó.

Mở thêm một tab nữa sẽ thấy số "người đang xem" tăng lên — đó là hai trình duyệt cùng ở trong một phòng realtime.

Tham số URL hữu ích: `?enter` (bỏ qua nút "Vào campus"), `?bots=50` (50 avatar giả đi lang thang), `?quality=low|medium|high`, `?spawn=poi.checkpoint.atrium` (xuất hiện ở chỗ khác — danh sách POI xem ở `/debug/map`).

**Thử trên điện thoại cùng Wi-Fi:**

```bash
pnpm --filter @campus/web dev --host
```

rồi mở địa chỉ "Network" mà Vite in ra.

### Postgres và Redis

Chưa app nào dùng tới cho đến P2.3 / P3.1, nhưng đã có sẵn cấu hình. Cần Docker.

```bash
pnpm infra:up
```

```bash
pnpm infra:down
```

## Lệnh

| Lệnh | Việc làm |
|---|---|
| `pnpm dev` | Chạy cả 4 app, tự nạp lại khi sửa code |
| `pnpm lint` | Kiểm tra lint + format (Biome) |
| `pnpm format` | Tự sửa format và sắp xếp import |
| `pnpm typecheck` | Kiểm tra kiểu toàn bộ workspace |
| `pnpm test` | Chạy test (Vitest) |
| `pnpm build` | Build cả 4 app |
| `pnpm budget` | Kiểm tra dung lượng JS của bản build web theo ngân sách tải (màn hình chào ≤ 120 KB, trước khi đi được ≤ 600 KB, gzip) |
| `pnpm smoke` | Khởi động bản build của `api` và `realtime`, kiểm tra health |
| `pnpm check` | Tất cả các bước trên theo thứ tự — chạy trước khi commit; CI chạy đúng chuỗi này |
| `pnpm map:build` | Sinh lại `packages/map-data/src/campus.json` từ dữ liệu OpenStreetMap + bố cục giả định |

Chạy lệnh cho một gói: `pnpm --filter @campus/api test`.

## Cấu trúc

```
apps/
  web/        game client — Vite + React + React Three Fiber
  admin/      admin CMS — Vite + React
  api/        REST API — Fastify
  realtime/   phòng multiplayer — Colyseus
packages/
  shared/     hằng số, zod schema, mã hoá dữ liệu trên đường truyền (chạy được ở cả browser và Node)
  map-data/   địa lý campus: hệ toạ độ, khu vực, POI (browser + Node)
  core/       nghiệp vụ phía server
  db/         kết nối Postgres + schema Drizzle
infra/        Docker Compose cho môi trường dev
tools/
  map-tools/  sinh bản đồ campus từ dữ liệu OpenStreetMap
scripts/      script bảo trì repo (smoke test)
docs/         plan và thiết kế kỹ thuật
```

Các gói trong `packages/` xuất thẳng mã TypeScript, không có bước build riêng. `api` và `realtime` được bundle bằng tsdown thành `dist/index.mjs` và chạy bằng `node`.

## Cấu hình

Mọi biến môi trường đều có giá trị mặc định cho dev, nên không cần file `.env`. Muốn đổi cổng hay mức log thì sao chép [`.env.example`](.env.example) thành `.env` ở gốc repo.

## Tài liệu

Toàn bộ plan và thiết kế kỹ thuật nằm trong [`docs/`](docs/README.md):

- [Tổng quan + các quyết định cần chốt](docs/README.md)
- [Sản phẩm](docs/01-product.md) · [Kiến trúc](docs/02-architecture.md) · [Bản đồ & asset](docs/03-world-and-assets.md) · [Client](docs/04-client.md)
- [Multiplayer](docs/05-multiplayer.md) · [Nhiệm vụ](docs/06-missions.md) · [Backend & dữ liệu](docs/07-backend-data.md) · [Admin CMS](docs/08-admin-cms.md)
- [Hạ tầng, bảo mật & pháp lý](docs/09-infra-security.md) · [**Roadmap**](docs/10-roadmap.md) · [Rủi ro & câu hỏi mở](docs/11-risks-open-questions.md)
- [Nhật ký quyết định](docs/DECISIONS.md) — những chỗ làm khác thiết kế ban đầu
