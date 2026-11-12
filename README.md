# VNG Campus Online (tên tạm)

Campus ảo 3D chạy trên trình duyệt, dựng theo VNG Campus: đăng nhập, điều khiển avatar đi lại trong khuôn viên, gặp đồng nghiệp đang online và cùng làm **nhiệm vụ hằng ngày** do admin tạo.

**Trạng thái:** đã có khung dự án chạy được (P0.1). Tiến độ từng gói việc ở [roadmap](docs/10-roadmap.md).

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
| `web` — game | http://localhost:5173 | Hiện một khối xoay và trạng thái kết nối tới API + realtime |
| `admin` | http://localhost:5174 | Trang trống, xây ở P5 |
| `api` | http://localhost:3001/api/health | REST (Fastify) |
| `realtime` | http://localhost:2567/health | Colyseus |

Trang web chỉ nói chuyện với **chính origin của nó**: `/api` là REST, `/rt` là realtime. Lúc dev, Vite đóng vai reverse proxy; khi triển khai thật, Caddy làm việc đó.

Mở thêm một tab nữa sẽ thấy số "người đang xem" tăng lên — đó là hai trình duyệt cùng ở trong một phòng realtime.

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
| `pnpm smoke` | Khởi động bản build của `api` và `realtime`, kiểm tra health |
| `pnpm check` | Tất cả các bước trên theo thứ tự — chạy trước khi commit; CI chạy đúng chuỗi này |

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
