# Sổ tay vận hành

Cách cài, cập nhật, lùi phiên bản, sao lưu và khôi phục VNG Campus Online trên **một máy** (bậc 0 ở [09](09-infra-security.md#2-các-bậc-triển-khai)). Mọi lệnh chạy trên máy chủ trong thư mục `/srv/campus` trừ khi ghi khác.

## 1. Thành phần

| Container | Image | Việc |
|---|---|---|
| `web` | `…/web:<tag>` | Caddy: TLS, game ở `/`, admin ở `/admin/`, chuyển `/api` và `/rt`; chặn `/rt/metrics` từ ngoài |
| `api` | `…/api:<tag>` | REST API + job mỗi phút (chốt nhiệm vụ, tự điền 23:00, hết hạn án phạt, dọn dữ liệu) |
| `realtime` | `…/realtime:<tag>` | Phòng Colyseus; đọc án phạt, cấu hình, thông báo từ DB mỗi 5 giây |
| `migrate` | `…/api:<tag>` | Chạy migration rồi thoát; `api` và `realtime` chỉ khởi động khi nó xong |
| `postgres` | `postgres:17-alpine` | Dữ liệu; volume `campus_postgres-data` |
| `backup` | `postgres:17-alpine` | `pg_dump` mỗi đêm (02:30) vào `./backups`, giữ 14 ngày |

Image được workflow `Deploy` build và đẩy lên GitHub Container Registry: mỗi lần vào nhánh chính (tag = 12 ký tự đầu của commit) và mỗi tag phiên bản `v*`.

## 2. Cài lần đầu

1. Máy Linux 4 vCPU / 8 GB, cài Docker Engine + Compose plugin. Mở cổng 80 và 443. Trỏ DNS của tên miền về máy.
2. Tạo người dùng `deploy` thuộc nhóm `docker`, thêm khoá SSH công khai của workflow vào `~deploy/.ssh/authorized_keys`.
3. `sudo mkdir -p /srv/campus && sudo chown deploy /srv/campus`, rồi chép `infra/compose.prod.yaml`, `infra/backup.sh` và `infra/prod.env.example` vào đó.
4. `cp prod.env.example prod.env && chmod 600 prod.env`, điền:
   - `IMAGE_REPO=ghcr.io/<owner>/<repo>`, `IMAGE_TAG=<tag muốn chạy>`, `SITE_ADDRESS` (tên miền; Caddy tự lấy chứng chỉ Let's Encrypt), `PUBLIC_URL`;
   - `POSTGRES_PASSWORD` (chuỗi ngẫu nhiên dài) và cùng mật khẩu đó trong `DATABASE_URL`;
   - `JWT_PRIVATE_KEY`: chạy `node scripts/generate-jwt-key.mjs` trên máy có repo, dán cả dòng;
   - `ANALYTICS_SALT`: `openssl rand -base64 33`;
   - đăng nhập công ty (`GOOGLE_*` hoặc `OIDC_*`), `AUTH_EMAIL_DOMAINS`, `ADMIN_EMAILS` (quản trị viên đầu tiên). Đăng ký redirect URI `<PUBLIC_URL>/api/v1/auth/oidc/<google|oidc>/callback` ở nhà cung cấp.
5. Nếu image để riêng tư: `docker login ghcr.io` bằng một token chỉ có quyền `read:packages`.
6. Chạy:
   ```bash
   docker compose --env-file prod.env -f compose.prod.yaml up -d
   ```
   `migrate` tạo bảng, rồi `api`, `realtime`, `web` lên; Caddy tự xin chứng chỉ.
7. Kiểm tra `https://<tên miền>/api/health` và `/rt/health` trả `"status":"ok"`, mở game, đăng nhập bằng một email trong `ADMIN_EMAILS`, mở `/admin/`.
8. Nạp phòng ban (nếu có file CSV) từ một máy có repo, trỏ `DATABASE_URL` tới DB qua đường hầm SSH: `pnpm db:import-departments <file.csv>`.

## 3. Cập nhật (deploy)

**Tự động:** đặt ở GitHub (Settings → Secrets and variables → Actions):

| Loại | Tên | Giá trị |
|---|---|---|
| Variable | `STAGING_HOST`, `PRODUCTION_HOST` | Tên miền của từng máy |
| Variable | `DEPLOY_USER` | `deploy` (mặc định) |
| Secret | `DEPLOY_SSH_KEY` | Khoá SSH riêng của workflow |
| Secret | `DEPLOY_KNOWN_HOSTS` | Kết quả `ssh-keyscan <máy>` (đã đối chiếu vân tay) |

Environment `production` cần đặt **Required reviewers** để mỗi lần lên production phải có người duyệt. Đẩy vào nhánh chính → staging. Gắn tag `v1.2.3` → production sau khi được duyệt.

**Bằng tay** (ví dụ khi chưa có workflow):

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v1.2.3/' prod.env
```

```bash
docker compose --env-file prod.env -f compose.prod.yaml pull
```

```bash
docker compose --env-file prod.env -f compose.prod.yaml run --rm migrate
```

```bash
docker compose --env-file prod.env -f compose.prod.yaml up -d
```

Realtime khởi động lại thì người chơi tự vào lại sau vài giây (tiến độ nhiệm vụ đã lưu). Muốn báo trước: phát thông báo dạng dòng chạy ở admin vài phút trước khi deploy.

## 4. Lùi phiên bản

Migration chỉ thêm (thêm bảng, thêm cột), nên code cũ chạy được với schema mới. `infra/deploy.sh` ghi tag trước đó vào `previous-tag`:

```bash
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$(cat previous-tag)/" prod.env
```

```bash
docker compose --env-file prod.env -f compose.prod.yaml up -d
```

## 5. Sao lưu và khôi phục

- `backup` ghi `campus-YYYYMMDD-HHMMSS.dump` vào `/srv/campus/backups` lúc 02:30, giữ 14 ngày, ghi giờ lần thành công vào `backups/last-success`. Container chuyển **unhealthy** nếu bản tốt gần nhất cũ hơn 26 giờ.
- **Chép ra khỏi máy** mỗi ngày (bản sao trên cùng ổ đĩa không cứu được khi mất ổ), ví dụ cron của `deploy` lúc 03:00 với rclone tới object storage: `rclone copy /srv/campus/backups remote:campus-backups --max-age 48h`.
- **Khôi phục** (thử trên staging trước khi mở cửa, sau đó mỗi quý):
  ```bash
  docker compose --env-file prod.env -f compose.prod.yaml stop api realtime
  ```
  ```bash
  docker compose --env-file prod.env -f compose.prod.yaml exec -T postgres pg_restore -U campus -d campus --clean --if-exists < backups/campus-YYYYMMDD-HHMMSS.dump
  ```
  ```bash
  docker compose --env-file prod.env -f compose.prod.yaml up -d
  ```
- Mất dữ liệu tối đa: 24 giờ. Thứ không cần sao lưu: vị trí người chơi, chat (không lưu), bộ đếm của phút cuối.

## 6. Giám sát

| Kiểm tra | Cách |
|---|---|
| Sống/chết | Dịch vụ kiểm tra từ bên ngoài (UptimeRobot, Uptime Kuma…) gọi `https://<tên miền>/api/health` và `/rt/health` mỗi phút, báo khi hỏng 2 lần liền |
| Container | `docker compose … ps`: `api`, `realtime` có healthcheck; `backup` unhealthy = sao lưu hỏng |
| Số liệu realtime | `docker compose … exec realtime wget -qO- http://127.0.0.1:2567/metrics` — số phòng, số người, thời gian tick/patch, message/giây (không mở ra ngoài) |
| Log | `docker compose … logs -f api realtime` (JSON, xoay vòng 5 × 20 MB mỗi container) |
| Dung lượng | Cảnh báo khi đĩa > 80% (`df -h`); dọn image cũ: `docker image prune -a --filter until=168h` |
| Người dùng | Trang Tổng quan trong admin: online theo kênh, cảnh báo nhiệm vụ, báo cáo chờ xử lý |

## 7. Sự cố thường gặp

| Triệu chứng | Làm gì |
|---|---|
| Quấy rối, spam trong chat | Admin → Cấu hình → **Tắt chat** (có hiệu lực trong 5 giây); xử lý báo cáo; bật lại |
| Cần dừng để sửa | Admin → Cấu hình → **Bật bảo trì** kèm lời nhắn: người mới không vào được, người đang chơi thấy dòng nhắn, nhân viên vẫn vào kiểm tra được |
| Nhiệm vụ đang chạy bị lỗi | Mở nhiệm vụ trong admin → **Kết thúc sớm**; nhân bản để sửa |
| `migrate` thất bại | `api`/`realtime` cũ vẫn chạy (chúng không bị dừng khi `run --rm migrate` lỗi). Xem `docker compose … logs migrate`, sửa rồi deploy lại |
| Đăng nhập công ty lỗi | Kiểm tra redirect URI ở nhà cung cấp, `PUBLIC_URL`, `AUTH_EMAIL_DOMAINS`; log `api` ghi mã lỗi (`failed`, `domain`, …) |
| Mọi người bị đăng xuất sau deploy | `JWT_PRIVATE_KEY` đã đổi hoặc trống — đặt lại khoá cũ |
| Ai đó yêu cầu xoá dữ liệu | Người đó tự xoá trong Hồ sơ → Xoá tài khoản; hoặc quản trị viên mở trang người dùng → Xoá vĩnh viễn. Nếu họ đang online và cần ra ngay, khoá tài khoản trước rồi xoá |
| Không ai thấy nhau | `realtime` có healthy không; Caddy có chuyển `/rt` (WebSocket) không: `curl -i https://<tên miền>/rt/health` |

## 8. Bí mật

`prod.env` chỉ nằm trên máy chủ (quyền 600), không bao giờ vào repo. Đổi `JWT_PRIVATE_KEY` làm mọi người đăng nhập lại; đổi `ANALYTICS_SALT` làm số "người quay lại" bắt đầu lại từ đầu; đổi `POSTGRES_PASSWORD` phải đổi cả trong Postgres (`ALTER USER campus PASSWORD '…'`).
