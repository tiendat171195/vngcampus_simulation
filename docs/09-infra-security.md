# 09 — Hạ tầng, bảo mật & pháp lý

## 1. Môi trường

| Môi trường | Mục đích | Cấu hình |
|---|---|---|
| **Local** | Phát triển | `docker compose` chạy Postgres + Redis; các app chạy bằng `pnpm dev` |
| **Staging** | Thử trước khi phát hành, pilot nhóm nhỏ | Giống production, máy nhỏ hơn, dữ liệu riêng; tự deploy khi merge vào nhánh chính |
| **Production** | Người dùng thật | Deploy thủ công có phê duyệt, theo tag phiên bản |

## 2. Các bậc triển khai

### Bậc 0 — một máy (MVP, pilot, tới vài trăm người đồng thời)

```mermaid
flowchart TB
  U["Người dùng"] --> CF["CDN + DNS + TLS"]
  CF --> CADDY
  subgraph VPS["1 VPS — 4 vCPU / 8 GB — Docker Compose"]
    CADDY["Caddy<br/>/ → app tĩnh · /api → api · /rt → realtime"]
    API["api"]
    RT["realtime"]
    WK["worker"]
    PG[("Postgres")]
    RD[("Redis")]
    CADDY --> API
    CADDY --> RT
    API --> PG
    API --> RD
    RT --> PG
    RT --> RD
    WK --> PG
    WK --> RD
  end
  CF --> OBJ["Object storage<br/>asset có hash (/assets)"]
  PG -. "sao lưu hằng đêm" .-> OBJ
```

### Bậc 1 — tách dữ liệu, nhân đôi (tới vài nghìn người đồng thời)

- Postgres và Redis chuyển sang dịch vụ quản lý (có sao lưu theo thời điểm).
- 2 máy ứng dụng. `api` chạy nhiều bản sau cân bằng tải.
- `realtime` chạy nhiều tiến trình (mỗi nhân CPU một tiến trình), bật Redis presence + driver; mỗi tiến trình có địa chỉ công khai riêng dạng `/rt/<cổng>/…`.

### Bậc 2 — co giãn (công khai, hàng chục nghìn người)

- Điều phối container có tự co giãn theo số người; hàng chờ khi quá tải; bản sao chỉ đọc cho DB.
- Lúc này mới đáng đánh giá lại phương án edge/serverless (xem ADR-03 ở [02](02-architecture.md)).

### Chi phí ước lượng (rất thô, cần kiểm tra giá lúc triển khai)

| Bậc | Thành phần | Mỗi tháng |
|---|---|---|
| 0 | 1 VPS 4 vCPU/8 GB, CDN gói miễn phí, object storage vài GB, tên miền | khoảng 30–60 USD |
| 1 | 2 máy ứng dụng + Postgres và Redis quản lý + giám sát | khoảng 200–400 USD |

**Vị trí máy chủ:** Singapore (trễ khoảng 30–50 ms từ TP.HCM) hoặc trong nước (5–15 ms). Cả hai đều thừa cho game đi dạo đồng bộ 10 Hz. Nếu dự án thành chính thức của công ty, **VNG Cloud** là lựa chọn tự nhiên, vừa gần người dùng vừa đáp ứng yêu cầu đặt dữ liệu trong nước.

## 3. Định tuyến

| Đường dẫn | Tới | Cache |
|---|---|---|
| `/` , `/play`, … | App tĩnh (HTML không cache, JS/CSS có hash cache vĩnh viễn) | CDN |
| `/assets/*` | Object storage: GLB, KTX2, audio, manifest | CDN, `immutable` |
| `/api/*` | `api` | Không |
| `/rt/*` | `realtime` (WebSocket; timeout đọc/ghi dài, tắt buffering) | Không |

## 4. CI/CD

| Workflow | Kích hoạt | Bước |
|---|---|---|
| `ci` | Mọi push / PR | Cài đặt → lint → typecheck → unit + integration test → build → kiểm tra ngân sách (bundle, asset) |
| `e2e` | PR vào nhánh chính | Dựng stack bằng compose → Playwright (hai trình duyệt thấy nhau, hoàn thành nhiệm vụ mẫu) |
| `deploy-staging` | Merge vào nhánh chính | Build image → đẩy lên registry → migration → `compose pull && up -d` → kiểm tra health |
| `deploy-prod` | Tag phiên bản + phê duyệt | Như staging |

**Đã làm (P7.1):** `ci.yml` có thêm job `images`: build ba image (`api`, `realtime`, `web`) từ `Dockerfile` rồi chạy `infra/smoke-stack.sh` — dựng `compose.prod.yaml` thật, kiểm tra qua Caddy: hai app tĩnh, header cache/bảo mật, `/rt/metrics` bị chặn, đăng ký khách (DB đã migrate), giữ chỗ realtime bằng token của API, nâng cấp WebSocket, bản sao lưu đầu tiên. `e2e` chạy ở mọi push trên bản build, không qua compose. `deploy.yml` gộp hai workflow deploy: một job build và đẩy image lên GHCR (tag = 12 ký tự commit, hoặc `v*`), job `staging` (nhánh `main`) và `production` (tag `v*`, environment `production` cần người duyệt) gọi `infra/deploy.sh` qua SSH: chép compose, đổi `IMAGE_TAG`, `pull`, `run --rm migrate`, `up -d`, kiểm tra health qua địa chỉ công khai. Job deploy chỉ chạy khi có biến `STAGING_HOST`/`PRODUCTION_HOST`. Chưa có asset riêng trên object storage (P6.1), nên "asset trước" chưa áp dụng.

Nguyên tắc deploy:

- **Asset trước, app sau.** Asset có hash tải lên trước; bản app mới trỏ tới chúng. Bản cũ vẫn chạy được trong lúc chuyển.
- **Migration kiểu mở rộng rồi thu hẹp:** thêm cột/bảng mới trước, deploy code, dọn cột cũ ở lần sau. Không có migration nào làm vỡ bản code đang chạy.
- **Realtime tắt êm:** tiến trình cũ báo client rồi mới thoát; client tự vào lại (xem [05](05-multiplayer.md)).
- **Lùi phiên bản:** triển khai lại tag trước đó. Vì migration chỉ mở rộng nên code cũ vẫn chạy với schema mới.

## 5. Giám sát

| Lớp | Công cụ | Theo dõi |
|---|---|---|
| Lỗi | Sentry (client + server) | Lỗi JS, lỗi server, mất WebGL context |
| Log | pino JSON → nơi gom log | Có request id / session id; không chứa dữ liệu cá nhân |
| Metric | prom-client → Prometheus/Grafana (hoặc dịch vụ tương đương) | Số người online, số phòng, thời gian tick, độ trễ event loop, message/giây, băng thông, kết nối DB, độ dài hàng đợi |
| Phòng | `@colyseus/monitor` (sau lớp xác thực) | Xem phòng và client đang kết nối |
| Uptime | Kiểm tra từ bên ngoài mỗi phút | `/api/health`, `/rt/health` |

**Đã làm (P7.1), bậc 0:** healthcheck Docker cho `api`, `realtime` và `backup` (unhealthy khi bản dump tốt gần nhất cũ hơn 26 giờ); log JSON của container xoay vòng 5 × 20 MB; `/metrics` của realtime (JSON: phòng, người, tick, patch, message) chỉ đọc được trong mạng nội bộ. Uptime từ bên ngoài, Sentry, Prometheus/Grafana và cảnh báo chưa dựng — chọn dịch vụ khi có máy thật (xem runbook §6).

**Cảnh báo:** health check thất bại; tỉ lệ lỗi tăng vọt; tick p95 > 10 ms; độ trễ event loop > 50 ms; số người online tụt đột ngột; đĩa > 80%; sao lưu thất bại.

## 6. Sao lưu và khôi phục

| Hạng mục | Bậc 0 | Bậc 1 |
|---|---|---|
| Postgres | `pg_dump` hằng đêm lên object storage, giữ 14 ngày (mất tối đa 24 giờ dữ liệu). **Đã làm (P7.1):** container `backup` dump lúc 02:30 vào thư mục trên máy, giữ 14 ngày; chép ra object storage bằng cron + rclone theo runbook | Sao lưu theo thời điểm của dịch vụ quản lý |
| Redis | Không cần sao lưu; có script dựng lại BXH từ Postgres | Như bậc 0 |
| Asset | Lưu trên object storage + nguồn trong repo/kho riêng | Như bậc 0 |
| Diễn tập | Khôi phục thử vào staging trước khi mở cửa, sau đó mỗi quý | Như bậc 0 |

## 7. Bảo mật

### 7.1 Mô hình đe doạ tóm tắt

| Nguy cơ | Biện pháp |
|---|---|
| Mạo danh đồng nghiệp | Đăng nhập OIDC giới hạn domain; khách có nhãn "Khách" rõ ràng trên thẻ tên; tên hiển thị của tài khoản thật lấy từ IdP |
| Gian lận nhiệm vụ | Server quyết định tiến độ (xem [06](06-missions.md)) |
| Quấy rối qua chat | Rate limit, lọc từ, báo cáo, mute/ban, công tắc tắt chat |
| Làm quá tải | Rate limit ở proxy và ứng dụng; trần người mỗi kênh; giới hạn kích thước message WebSocket (1 KB); giới hạn kết nối mỗi IP |
| XSS qua tên/chat | React tự escape; không chèn HTML thô; tên vẽ vào canvas; Content-Security-Policy chặt |
| Đánh cắp phiên | Access token ngắn hạn trong bộ nhớ; refresh token trong cookie HttpOnly, xoay vòng, phát hiện dùng lại |
| Chiếm quyền admin | Admin bắt buộc đăng nhập bằng IdP (không cho khách); phân quyền theo vai trò; nhật ký thao tác; tuỳ chọn giới hạn IP |
| Lộ dữ liệu | Thu thập tối thiểu; log không chứa dữ liệu cá nhân; DB không mở ra internet; người dùng DB quyền tối thiểu |
| Chuỗi cung ứng | Khoá phiên bản bằng lockfile; quét lỗ hổng phụ thuộc trong CI; cập nhật có kiểm soát |

### 7.2 Danh sách kiểm tra trước khi mở cửa

Tình trạng sau P7.2 (14/11/2026). Ô còn trống cần làm trên máy thật trước khi mở cửa.

- [x] HTTPS toàn bộ, HSTS, CSP, cookie `Secure` + `HttpOnly` + `SameSite` — Caddy tự xin TLS, gửi HSTS và CSP chặt (mọi thứ từ cùng origin, không script inline; đã chạy game trên stack production trong Chromium: không vi phạm nào); cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure` ở production, path `/api/v1/auth`
- [x] Mọi endpoint và message đều validate bằng zod; có rate limit — đăng ký/đăng nhập/refresh/analytics theo IP, mọi message realtime theo phiên; message WebSocket tối đa 4 KB. Chưa có giới hạn số kết nối mỗi IP (Caddy bản chuẩn không có; thêm ở CDN/tường lửa nếu cần)
- [x] Endpoint admin kiểm tra vai trò ở server, có test — vai trò đọc từ DB mỗi request
- [x] Bí mật nằm trong biến môi trường / kho bí mật, không trong repo — `infra/prod.env` bị gitignore, quyền 600; production từ chối chạy thiếu `JWT_PRIVATE_KEY`, `ANALYTICS_SALT`
- [x] Postgres và Redis chỉ nghe trong mạng nội bộ — compose không mở cổng Postgres; chưa dùng Redis
- [ ] Sao lưu chạy và đã khôi phục thử — CI dựng stack, dump và khôi phục thử ở mỗi lần push; **còn diễn tập trên staging thật** (runbook §5)
- [x] Chạy rà soát bảo mật trên toàn bộ thay đổi — rà soát P7.2 (DECISIONS 2026-11-14): sửa chuyển hướng mở qua ký tự tab ở `return`, khoá `/rt/online`, chặn `/rt/metrics`; `pnpm audit --prod` trong CI
- [x] Có trang chính sách quyền riêng tư và điều khoản sử dụng — `/privacy`, `/terms`, liên kết ở màn hình vào

## 8. Dữ liệu cá nhân

Khung pháp lý hiện hành: **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15** (hiệu lực 01/01/2026) và **Nghị định 356/2025/NĐ-CP** hướng dẫn thi hành. Phần dưới là nguyên tắc thiết kế, **không phải tư vấn pháp lý**; nếu dự án thành chính thức cần làm việc với bộ phận pháp chế.

| Nguyên tắc | Cách áp dụng |
|---|---|
| Thu thập tối thiểu | Chỉ lưu: tên hiển thị, email (nếu đăng nhập thật), phòng ban (tuỳ chọn), cấu hình avatar, dữ liệu chơi |
| Minh bạch và đồng ý | Lần đăng nhập đầu hiện thông báo: thu thập gì, để làm gì, giữ bao lâu; lưu phiên bản đã đồng ý |
| Quyền của người dùng | Xem và sửa hồ sơ; yêu cầu xoá tài khoản (`DELETE /me`); ẩn mình khỏi danh sách online. **Đã làm (P7.2):** tự xoá trong Hồ sơ (gõ "XOÁ" để xác nhận), hoặc quản trị viên xoá ở trang người dùng |
| Không giám sát nhân viên | Không lưu chat; số liệu chỉ ở dạng tổng hợp; không có báo cáo thời gian online theo cá nhân |
| Giới hạn lưu trữ | Theo bảng dưới, job `data-retention` tự xoá |

| Dữ liệu | Thời hạn lưu |
|---|---|
| Hồ sơ người dùng và tiến độ | Tới khi người dùng yêu cầu xoá hoặc tài khoản bị vô hiệu |
| Tài khoản khách không hoạt động | 30 ngày (P7.2: job mỗi giờ trong API) |
| Phiên đăng nhập đã hết hạn hoặc thu hồi | 30 ngày sau khi kết thúc (P7.2) |
| Bộ đệm chat (trong bộ nhớ phòng realtime, P5.4) | 24 giờ, hoặc tới khi phòng đóng |
| Báo cáo vi phạm kèm ngữ cảnh | Đoạn chat đính kèm xoá 180 ngày sau khi xử lý; quyết định giữ lại |
| Sự kiện analytics thô | Không lưu (P5.4): đếm thẳng vào `analytics_daily`, giữ lâu |
| Mã băm "ai có mặt ngày nào" (`activity_days`) | 90 ngày |
| Log ứng dụng | 30 ngày |
| Nhật ký thao tác admin | 1 năm |

## 9. Thương hiệu và an ninh nơi làm việc

Dự án dựng lại một trụ sở có thật, nên có vài việc cần làm rõ **trước khi mở cho nhiều người**:

| Vấn đề | Việc cần làm |
|---|---|
| Tên và logo VNG, hình ảnh campus | Xin phép bộ phận phụ trách thương hiệu/truyền thông. Trong lúc chờ, giữ quyền truy cập ở phạm vi nhóm nhỏ |
| An ninh vật lý | **Không dựng** vị trí camera, phòng kỹ thuật, phòng máy chủ, chi tiết hệ thống kiểm soát ra vào. Khu văn phòng dựng cách điệu, không theo đúng sơ đồ chỗ ngồi |
| Sơ đồ và ảnh nội bộ dùng làm tham chiếu | Không đưa vào repo công khai; lưu ở kho riêng tư |
| Thương hiệu đối tác (các quầy cà phê…) | Dùng tên chung cho tới khi được phép |
| Nếu mở ra ngoài công ty | Rà soát lại toàn bộ với truyền thông và an ninh thông tin |

## 10. Sổ tay vận hành (tối thiểu)

Bản đầy đủ — cài đặt, deploy, lùi phiên bản, sao lưu/khôi phục, giám sát — ở [runbook.md](runbook.md).

| Tình huống | Cách xử lý |
|---|---|
| Realtime quá tải (tick tăng, lag) | Hạ ngưỡng mềm của kênh để dàn người; bật thêm tiến trình; bật chế độ giảm tần suất patch |
| Một nhiệm vụ bị lỗi | Công tắc khẩn: kết thúc sớm → sửa bản nhân bản → xuất bản lại |
| Chat bị lạm dụng | Tắt chat toàn hệ thống trong lúc xử lý từng trường hợp |
| Mất Redis | Khởi động lại; chạy script dựng lại BXH từ Postgres; presence tự hồi phục khi client kết nối lại |
| DB hết kết nối | Kiểm tra pool của từng tiến trình; khởi động lại tiến trình rò rỉ |
| Cần bảo trì | Bật chế độ bảo trì kèm thông báo trước 10 phút |

## 11. Nguồn tham khảo

- [Nghị định 356/2025/NĐ-CP — Thư Viện Pháp Luật](https://thuvienphapluat.vn/van-ban/Quyen-dan-su/Nghi-dinh-356-2025-ND-CP-huong-dan-Luat-Bao-ve-du-lieu-ca-nhan-687428.aspx)
- [VnEconomy — Những điểm mới trong Luật Bảo vệ dữ liệu cá nhân từ 1/1/2026](https://vneconomy.vn/nhung-diem-moi-trong-luat-bao-ve-du-lieu-ca-nhan-tu-112026.htm)
- [VCCI — Lưu ý về hành lang pháp lý mới cho doanh nghiệp](https://www.vcci.com.vn/tin-tuc/luat-bao-ve-du-lieu-ca-nhan-luu-y-ve-hanh-lang-phap-ly-moi-cho-doanh-nghiep)
- [Colyseus — Scalability](https://docs.colyseus.io/scalability), [Deployment](https://docs.colyseus.io/deployment)
