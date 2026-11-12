# VNG Campus Online — Plan & Technical Design

> **Trạng thái:** Plan v0.1 — 12/11/2026. Chưa có code. Bộ tài liệu này là "hợp đồng" để implement từng phần ở các phiên làm việc sau.
> **Tên sản phẩm** "VNG Campus Online" là tên tạm.

## 1. Ý tưởng trong 5 dòng

- Một **campus ảo 3D chạy ngay trên trình duyệt** (desktop + mobile, không cài đặt), dựng theo VNG Campus thật ở KCX Tân Thuận, Quận 7.
- Mỗi người đăng nhập → có một **avatar "nhân viên"** → bước vào campus và **thấy đồng nghiệp đang online** đi lại, vẫy tay, ngồi cà phê, chat.
- **Mỗi ngày admin tạo một nhiệm vụ hệ thống** (ghé địa điểm, thu thập vật phẩm, trả lời quiz, chào đồng nghiệp, tụ tập chụp ảnh…). Người chơi hoàn thành ngay trong map để nhận điểm, giữ streak, lên bảng xếp hạng.
- Lấy cảm hứng từ làn sóng "chùa online" (Sansa – Hàn Quốc, Niệm Phật Online – Việt Nam): vào nhanh, nhẹ nhàng, cùng-có-mặt, có nhiệm vụ hằng ngày.
- Làm theo từng lát mỏng chạy được: đi dạo một mình → gặp nhau → có tài khoản → có nhiệm vụ → admin tự vận hành → làm đẹp → mở cửa.

## 2. Giải pháp kỹ thuật tóm tắt

| Lớp | Lựa chọn | Lý do chính |
|---|---|---|
| Client 3D | **Three.js + React Three Fiber** (Vite, React, TypeScript) | Nhẹ, tải nhanh trên mobile, hệ sinh thái lớn; UI dùng luôn React |
| Va chạm / di chuyển | Capsule + **three-mesh-bvh** (navmesh thêm sau cho NPC, tap-to-move) | Không cần physics engine nặng cho thế giới tĩnh |
| Realtime | **Colyseus 0.18** (Node.js), 1 phòng = 1 "kênh" campus, ~100 người/kênh | Đồng bộ state delta sẵn có, matchmaking, reconnect, scale ngang bằng Redis |
| REST API | **Fastify** + zod, tiến trình tách riêng khỏi realtime | Deploy API không làm rớt kết nối người chơi |
| Dữ liệu | **PostgreSQL** (Drizzle ORM) + **Redis** (presence, BXH, pub/sub, hàng đợi) | Nguồn sự thật bền vững + dữ liệu nóng |
| Bản đồ | **Map-data dạng JSON** → dựng greybox thủ tục → thay dần bằng model Blender (GLB + Meshopt + KTX2) | Chơi được ngay khi chưa có art; một nguồn toạ độ dùng chung cho client, server, admin |
| Nhiệm vụ | **Mission engine hướng sự kiện, server-authoritative**, nhiệm vụ = dữ liệu ghép từ các loại objective | Admin tạo nhiệm vụ mới mỗi ngày không cần deploy code |
| Admin | SPA React riêng, RBAC, trình soạn nhiệm vụ + chọn vị trí trên bản đồ 2D | Vận hành hằng ngày bởi người không biết code |
| Hạ tầng | Giai đoạn đầu: 1 VPS (Docker Compose) + CDN; có lộ trình scale lên nhiều node | Chi phí thấp, đủ cho vài trăm người đồng thời |

Chi tiết và các phương án đã cân nhắc nằm ở [02-architecture.md](02-architecture.md).

## 3. Mục lục

| # | Tài liệu | Nội dung |
|---|---|---|
| 01 | [Sản phẩm](01-product.md) | Tầm nhìn, bài học từ dự án tham chiếu, vai trò, vòng lặp hằng ngày, phạm vi MVP / V1 / V2, KPI |
| 02 | [Kiến trúc tổng thể](02-architecture.md) | Sơ đồ hệ thống, tech stack + phiên bản, các quyết định kiến trúc (ADR), cấu trúc monorepo, quy ước, kiểm thử |
| 03 | [Bản đồ, asset & avatar](03-world-and-assets.md) | Dữ liệu thật về campus, hệ toạ độ, phân khu, định dạng map-data, pipeline greybox → art, ngân sách asset, hệ avatar |
| 04 | [Client](04-client.md) | Kiến trúc runtime, render & mức chất lượng, điều khiển, camera, HUD, chiến lược tải, hiệu năng |
| 05 | [Multiplayer](05-multiplayer.md) | Kênh/phòng, schema state, giao thức message, đồng bộ & nội suy, chat, presence, lộ trình scale |
| 06 | [Hệ thống nhiệm vụ](06-missions.md) | Mô hình dữ liệu, danh mục objective, engine, vòng đời, phần thưởng, BXH, chống gian lận |
| 07 | [Backend & dữ liệu](07-backend-data.md) | Dịch vụ, schema DB, Redis keyspace, REST API, xác thực, job nền |
| 08 | [Admin CMS](08-admin-cms.md) | Phân quyền, màn hình, quy trình soạn & lên lịch nhiệm vụ, vận hành, kiểm duyệt |
| 09 | [Hạ tầng, bảo mật & pháp lý](09-infra-security.md) | Môi trường, các bậc triển khai, CI/CD, giám sát, bảo mật, dữ liệu cá nhân |
| 10 | [Roadmap](10-roadmap.md) | Các phase P0 → P8, gói việc, tiêu chí nghiệm thu, cách gọi implement |
| 11 | [Rủi ro & câu hỏi mở](11-risks-open-questions.md) | Quyết định cần chốt, sổ rủi ro, danh sách thứ cần bạn cung cấp |
| — | [reference/](reference/) | Sơ đồ nền từ OpenStreetMap ([SVG](reference/site-osm-reference.svg), [GeoJSON](reference/osm-campus.geojson)) |

## 4. Các quyết định cần bạn chốt (đã có mặc định đề xuất)

Plan được viết theo cột "Mặc định". Nếu bạn không nói gì, các phase sau sẽ đi theo mặc định. Chi tiết từng lựa chọn ở [11-risks-open-questions.md](11-risks-open-questions.md).

| # | Quyết định | Mặc định đề xuất |
|---|---|---|
| D1 | Đối tượng: nội bộ nhân viên hay công khai? | **Nội bộ trước** (pilot vài chục → toàn công ty), kiến trúc để ngỏ chế độ khách |
| D2 | Đăng nhập | **Khách (tên hiển thị) ở giai đoạn dựng**, sau đó **OIDC** (Google/Microsoft) giới hạn theo domain email công ty |
| D3 | Phong cách hình ảnh | **Low-poly cách điệu**, không chạy theo ảnh thực |
| D4 | Phạm vi bản đồ MVP | Ngoại cảnh toàn khu + tầng trệt các khu công cộng (sảnh, Atrium, canteen, hồ Koi/cà phê, hồ bơi); tầng văn phòng làm giản lược |
| D5 | Hạ tầng | 1 VPS khu vực Singapore/Việt Nam + CDN; cân nhắc VNG Cloud nếu dự án thành chính thức |
| D6 | Phần thưởng | **Chỉ là điểm/cosmetic trong game**, không quy đổi hiện vật |
| D7 | Chat | Chat gần + emote ở MVP, có lọc từ & báo cáo; voice để sau |
| D8 | Ngôn ngữ | Tiếng Việt trước, khung i18n sẵn cho tiếng Anh |

## 5. Cách dùng bộ plan này để implement

1. Mỗi phase trong [10-roadmap.md](10-roadmap.md) chia thành **gói việc** có mã (ví dụ `P1.2`), kèm phạm vi, kết quả bàn giao và tiêu chí nghiệm thu.
2. Khi muốn làm tiếp, chỉ cần nói: **"Implement P1.2 theo plan"**. Phiên làm việc mới sẽ đọc `CLAUDE.md` ở gốc repo, rồi đọc đúng phần liên quan.
3. Xong mỗi gói việc: cập nhật cột trạng thái trong roadmap, ghi lại chỗ nào làm khác thiết kế vào `docs/DECISIONS.md`.
4. Thiết kế không phải bất biến: nếu thực tế cho thấy một lựa chọn sai, sửa tài liệu trước rồi mới sửa code.

## 6. Giả định nền của plan

- Người dùng chủ yếu ở Việt Nam, mở bằng điện thoại tầm trung và laptop văn phòng; link thường được mở từ trong ứng dụng chat (trình duyệt nhúng).
- Quy mô mục tiêu: vài trăm người đồng thời ở giờ cao điểm, thiết kế để mở rộng lên vài nghìn.
- Chưa có sơ đồ mặt bằng chính thức; bản đồ khởi đầu từ dữ liệu công khai (OpenStreetMap, báo chí) và sẽ hiệu chỉnh bằng ảnh/sơ đồ bạn gửi.
- Đội làm rất nhỏ (bạn + Claude), nên ưu tiên công nghệ phổ biến, ít thành phần vận hành.
