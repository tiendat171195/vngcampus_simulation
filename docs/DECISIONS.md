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

## 2026-11-14 — Rà soát bảo mật P7.2: những gì đã sửa và còn lại

- Gói việc: P7.2
- Bối cảnh: danh sách kiểm tra ở 09 §7.2 trước khi mở cửa.
- Quyết định: (1) **Chuyển hướng mở:** `return` của đăng nhập OIDC chặn `//` và `/\` nhưng cho qua ký tự tab/xuống dòng — trình duyệt bỏ chúng, nên `/<tab>/evil.example` thành `//evil.example`. Nay chỉ nhận đường dẫn không có khoảng trắng, ký tự điều khiển hay `\` (có test). (2) **Danh bạ online** `/rt/online` trả tên người cho bất kỳ ai: nay cần access token (trừ server dev có danh tính dev). (3) **Số liệu nội bộ** `/rt/metrics` (có cả `?reset=1`) bị chặn ở Caddy — kiểm thử stack phát hiện lệnh `respond` đặt ngoài khối `/rt` không có tác dụng, đã chuyển vào trong. (4) Message WebSocket tối đa 4 KB (thiết kế ghi 1 KB, nhưng message `profile` mang access token gần 1 KB). (5) CSP chặt ở Caddy, cho phép `style` inline (thuộc tính `style` của React, SVG bản đồ). (6) Xoá tài khoản: người dùng tự xoá (`DELETE /me`, phải gửi `confirm: true`, giao diện bắt gõ "XOÁ"), quản trị viên xoá người khác; dữ liệu đi theo cascade, nhật ký không giữ dữ liệu cá nhân. Người bị quản trị viên xoá khi đang online còn ở trong phòng tới khi access token hết hạn (≤ 15 phút) — muốn đẩy ra ngay thì khoá tài khoản trước. (7) Dọn: khách không hoạt động 30 ngày, phiên đã kết thúc 30 ngày. (8) Trang `/terms`. Phiên bản thông báo quyền riêng tư giữ nguyên 1: chỉ thêm cách tự xoá, quyền đã hứa từ trước. (9) `pnpm audit --prod --audit-level high` trong CI.
- Khác plan ở đâu: đã sửa `05-multiplayer.md` §7, `07-backend-data.md` §4, `09-infra-security.md` §7.2 (đánh dấu từng mục), §8.
- Hệ quả: còn lại trước khi mở cửa — diễn tập khôi phục trên staging thật, giới hạn kết nối mỗi IP ở tầng mạng nếu mở ra ngoài công ty, và rà soát của bộ phận an ninh/pháp chế nếu dự án thành chính thức.

## 2026-11-14 — Hạ tầng một máy: một Dockerfile, Caddy phục vụ cả hai app, admin ở /admin/

- Gói việc: P7.1
- Bối cảnh: thiết kế có app tĩnh sau CDN, Redis, worker riêng, BullMQ, Sentry và Prometheus; chưa có máy chủ, tài khoản CDN hay dịch vụ giám sát nào. Admin chạy riêng cổng 5174 lúc dev nhưng phải dùng chung cookie phiên với game.
- Quyết định: (1) Một `Dockerfile` nhiều target: `api` (kèm `dist/migrate.mjs` — bước migration riêng của production), `realtime`, `web` (Caddy chứa sẵn bản build của game và admin). Server chỉ mang dependency npm production (`pnpm deploy --prod`); mã workspace đã nằm trong bundle. (2) `infra/compose.prod.yaml`: Postgres, `migrate` chạy một lần trước `api`/`realtime`, Caddy tự xin TLS, `backup` dump hằng đêm. Không có Redis, worker, BullMQ: job chạy trong tiến trình API, realtime đọc DB mỗi 5 giây (đủ cho một tiến trình realtime). (3) Admin build với `base: '/admin/'` và router bỏ tiền tố — cùng host nên dùng chung cookie, không cần CORS hay domain cookie. (4) `TRUST_PROXY` (mặc định `true`) để rate limit theo IP thật sau Caddy; chỉ đúng khi API không lộ trực tiếp ra ngoài. (5) CI dựng thật cả stack từ image và kiểm tra qua Caddy (`infra/smoke-stack.sh`), thay cho e2e chạy qua compose. (6) Deploy bằng SSH + compose với tag image bất biến; lùi phiên bản = đổi `IMAGE_TAG`.
- Khác plan ở đâu: đã sửa `09-infra-security.md` §4–§6, §10 (trỏ tới `runbook.md` mới), `08-admin-cms.md` §8, README.
- Hệ quả: Sentry, Prometheus/Grafana, uptime từ ngoài và chép sao lưu ra object storage là việc cấu hình khi có máy thật (runbook ghi cách). Khi cần nhiều tiến trình realtime (bậc 1) mới thêm Redis presence/driver.

## 2026-11-14 — Báo cáo vi phạm đi qua realtime; số liệu đếm sẵn, không lưu sự kiện thô

- Gói việc: P5.4
- Bối cảnh: thiết kế có `POST /reports` ở API với ngữ cảnh chat lấy từ bộ đệm Redis của phòng, bảng `analytics_events` thô phân vùng theo tháng cộng job `analytics-rollup` hằng giờ, và `/presence/summary` cho số online. Chưa có Redis; API không biết ai đã nghe dòng chat nào.
- Quyết định: (1) Báo cáo là message `report` gửi tới phòng realtime. Phòng giữ 200 dòng chat gần nhất **trong bộ nhớ**, mỗi dòng nhớ ai đã nhận; báo cáo chỉ kèm các dòng **người báo cáo đã thấy** trong 30 phút (tối đa 20) — không bịa được ngữ cảnh, không lộ chat của người khác. Rate limit 5 liền rồi 1 mỗi 2 phút; báo cáo lặp khi bản cũ còn mở chỉ cập nhật. (2) Xử lý: một quyết định đóng mọi báo cáo đang mở về cùng người; "nhắc nhở" là án `warn` 24 giờ không hạn chế gì, realtime hiện một lần. (3) Không lưu sự kiện thô: `analytics_daily` (ngày, chỉ số, chiều, giá trị) được cộng dồn khi sự kiện tới — realtime gom trong bộ nhớ và ghi mỗi phút, API đếm sự kiện client vào khoảng (thời gian tải, FPS) rồi bỏ đi. Để đếm DAU và người quay lại, `activity_days` lưu mã băm SHA-256 có muối bí mật (`ANALYTICS_SALT`, bắt buộc ở production) của id, giữ 90 ngày. Không còn job rollup. (4) Số online trên dashboard đọc `/rt/channels` (đã có, chỉ số đếm) mỗi 5 giây. (5) Chat đính trong báo cáo xoá 180 ngày sau khi xử lý (đúng bảng lưu trữ ở 09 và trang quyền riêng tư). Trang quyền riêng tư nói thêm về mã băm, không đổi phiên bản đồng ý vì không thêm loại dữ liệu cá nhân nào mới về nội dung.
- Khác plan ở đâu: đã sửa `05-multiplayer.md` §8, `07-backend-data.md` §2.4, §3, §4, §5, §6, §8, `08-admin-cms.md` §6–7, `09-infra-security.md` (bảng lưu trữ).
- Hệ quả: báo cáo về người ở kênh khác không có ngữ cảnh; phòng đóng là mất bộ đệm chat (chấp nhận được). Độ dài phiên và "thời gian trung vị" phiên chỉ biết theo khoảng; đổi kênh làm một phiên thành hai đoạn độ dài. Mất tối đa một phút bộ đếm nếu realtime sập. Muốn D7 hay số online theo khu thì thêm sau trên cùng hai bảng.

## 2026-11-13 — Mẫu, tự điền, thông báo và công tắc khẩn

- Gói việc: P5.3
- Bối cảnh: thiết kế đưa cấu hình và thông báo qua Redis pub/sub, có endpoint `broadcast` riêng, gửi thông báo và cờ tính năng qua `/world/bootstrap`, và để sức chứa kênh, chế độ khách, domain email trong bảng `settings`.
- Quyết định: (1) Realtime đọc `settings` và thông báo đang phát **mỗi 5 giây từ Postgres** (như án phạt ở P5.1) và gửi một message `ops` gộp (chat bật/tắt, bảo trì, thông báo đang phát) khi vào phòng và khi có thay đổi; không có `announce` riêng. (2) Thông báo "phát ngay" là thông báo bắt đầu từ bây giờ — không cần endpoint `broadcast`; huỷ bằng `POST /announcements/:id/cancel`. Mức toàn màn hình chỉ quản trị viên. (3) Bảo trì không đẩy người đang chơi ra, chỉ báo; nhân viên vẫn vào được; người khác bị từ chối với mã 503 và đọc được lời nhắn. (4) Sức chứa kênh, `GUEST_MODE`, domain email và email quản trị **vẫn là biến môi trường**: đổi giữa chừng ảnh hưởng an ninh hoặc các phòng đang mở, và hiếm khi cần. (5) Cờ tính năng chưa làm vì chưa có tính năng nào cần (cửa hàng, voice đều V1); bảng `settings` thêm khoá mới được ngay. (6) Tự điền chạy trong vòng job mỗi phút của API, chỉ làm từ 23:00, chọn mẫu đang bật lâu chưa dùng nhất và còn qua kiểm tra xuất bản; "báo biên tập viên" là nhãn "tự điền" trên lịch và dòng nhật ký (cảnh báo dashboard ở P5.4). (7) Giá trị mặc định và schema cấu hình nằm ở `packages/shared` (`operationalSettingsSchema`, `DEFAULT_SETTINGS`); khoá thiếu hoặc hỏng thì lấy mặc định, hạn mức thưởng khi xuất bản đọc từ đây.
- Khác plan ở đâu: đã sửa `05-multiplayer.md` §4 (message `ops`, mã từ chối), `07-backend-data.md` §5–§7, `08-admin-cms.md` §3, §4.5, §5, `06-missions.md` (ngày trống).
- Hệ quả: khi có nhiều tiến trình realtime vẫn đúng (mỗi tiến trình tự đọc DB), chỉ tốn thêm vài truy vấn nhẹ mỗi 5 giây; chuyển sang Redis khi cần độ trễ dưới giây. Thông báo đóng rồi được nhớ theo máy (localStorage), không theo tài khoản.

## 2026-11-13 — Trình soạn nhiệm vụ

- Gói việc: P5.2
- Quyết định:
  - Form viết tay cho 4 loại objective MVP thay vì sinh từ zod schema: nhãn và lựa chọn dễ hiểu hơn cho người không biết code; schema vẫn là chuẩn kiểm tra ở server.
  - Bản đồ chọn vị trí chỉ chọn khu vực/POI có sẵn (đủ cho 4 loại MVP); thả điểm tự do, chỉnh bán kính, vẽ đường chạy để V1 khi có `race`/`deliver`.
  - Kiểm tra trước khi xuất bản chạy ở server (`checkMissionForPublish`), gọi lại sau mỗi lần sửa (trễ 0,5 giây); chưa làm cảnh báo ước lượng thời gian hoàn thành.
  - Nhiệm vụ đã bắt đầu chỉ được sửa chữ và tăng thưởng; muốn đổi cấu trúc thì kết thúc sớm rồi nhân bản (đúng docs/06 §6).
  - Xem thử: tiến độ chỉ trong bộ nhớ, không ghi DB với `is_preview` — đơn giản hơn và vẫn đảm bảo không vào BXH, không trao thưởng.
  - Admin nhập `@campus/map-data` (bản đồ và bộ điểm) để vẽ và chọn vị trí.
- Khác plan ở đâu: `08-admin-cms.md` §4.1, §4.2, §4.4.
- Hệ quả: e2e có thêm bản build admin (cổng 4174) và tài khoản quản trị e2e qua IdP giả lập.

## 2026-11-13 — Admin: vỏ, phân quyền, người dùng, án phạt

- Gói việc: P5.1
- Quyết định:
  - Admin dùng React thuần + hook nhỏ và CSS thuần, chưa dùng TanStack Query/React Router/Tailwind/shadcn như ghi chú kỹ thuật ở docs/08 §8 — ít màn hình, ít phụ thuộc. Sẽ cân nhắc lại khi làm trình soạn nhiệm vụ (P5.2).
  - Không có màn hình đăng nhập riêng cho admin: dùng chung phiên của game (cookie refresh cùng host), và cùng khoá Web Lock khi làm mới token để không giẫm lên tab game.
  - Quyền kiểm tra ở server bằng vai trò đọc từ DB mỗi request, không tin token.
  - Án phạt có hiệu lực trong game qua việc realtime đọc DB mỗi 5 giây (chưa có Redis pub/sub). Đáp ứng "sau vài giây" của nghiệm thu P5.
  - Kiểm duyệt viên không phạt được quản trị viên; không ai tự phạt hay tự đổi vai trò của mình.
- Khác plan ở đâu: `08-admin-cms.md` §8, `07-backend-data.md` §4 (Admin).
- Hệ quả: khi có Redis (P7) có thể đổi sang pub/sub để nhanh hơn 5 giây.

## 2026-11-13 — Phần thưởng và bảng xếp hạng không cần Redis/BullMQ

- Gói việc: P4.4
- Bối cảnh: thiết kế dùng Redis cho BXH và BullMQ cho job; dự án chưa có Redis (P7), và môi trường dev/CI hiện chỉ có Postgres.
- Quyết định:
  - BXH tính bằng truy vấn Postgres có `rank()` (điểm theo tuần/tháng/mọi lúc theo lịch Việt Nam, phòng ban theo điểm trung bình trên người có điểm trong tuần, nhiệm vụ theo thời gian hoàn thành). Ở quy mô một công ty (vài nghìn người) truy vấn có index là đủ; nếu chậm sẽ thêm cache hoặc chuyển sang Redis ở P7 mà không đổi API.
  - Job chốt nhiệm vụ và chụp BXH chạy mỗi phút ngay trong tiến trình API. Không cần khoá: mỗi bước tự "nhận việc" trong transaction (dòng `mission_stats` được chèn trước, ràng buộc khoá chính chặn tiến trình thứ hai), nên chạy nhiều bản API cùng lúc vẫn an toàn.
  - Thưởng mục tiêu chung trả lúc chốt nhiệm vụ (không trả ngay khi đạt mốc) cho mọi người đã hoàn thành.
  - Phần thưởng `item`/`badge` vẫn chưa trao (chờ cửa hàng/huy hiệu ở V1).
  - Ở chế độ `GUEST_MODE=limited` khách không lên BXH điểm.
- Khác plan ở đâu: `06-missions.md` §7, `07-backend-data.md` §4, §6.
- Hệ quả: khi bật Redis ở P7 có thể chuyển BXH sang sorted set nếu cần; bảng `mission_stats` vừa là tổng kết vừa là dấu "đã chốt".

## 2026-11-13 — Giao diện nhiệm vụ

- Gói việc: P4.3
- Quyết định:
  - Chỉ đường bằng la bàn giữa mép trên + cột sáng tại đích (đơn giản, rõ trên điện thoại) thay cho mũi tên chạy theo mép màn hình.
  - Lời nhắc tương tác dùng chung cho ghế và vật thể nhiệm vụ; vật thể nhiệm vụ được ưu tiên.
  - Phát hiện khi làm: nhiệm vụ bắt đầu lúc người chơi đã đứng sẵn ở điểm cần ghé thì trước đây không được tính tới khi họ di chuyển — server giờ kiểm tra lại vị trí mọi người khi tập nhiệm vụ đổi (có test).
  - E2E nhiệm vụ (`specs/z-missions.spec.ts`) tự đăng một nhiệm vụ sự kiện vào DB e2e, chạy cuối cùng để biểu ngữ không chen vào các test khác, và dùng `?spawn=<POI>` để tới từng vật phẩm — mỗi lần là một lần thoát ra vào lại, nên cũng kiểm tra luôn tiến độ được giữ.
- Khác plan ở đâu: `06-missions.md` §8.
- Hệ quả: mô hình vật phẩm/kiosk/NPC là tạm, thay ở P6.

## 2026-11-13 — Runtime nhiệm vụ trong phòng

- Gói việc: P4.2
- Quyết định:
  - Vật thể nhiệm vụ (chung và riêng) đi bằng message `mission:entities` gửi riêng từng người, không đặt trong state đồng bộ của phòng: người này nhặt vật phẩm riêng thì người khác không cần biết, và vật phẩm chung đã bị lấy chỉ cần gửi lại danh sách.
  - Sự kiện `emote.performed` mang danh sách người gần kèm khoảng cách (≤ 15 m); mỗi objective `social` tự lọc theo bán kính của nó.
  - Realtime đọc/ghi Postgres trực tiếp (`DATABASE_URL`); không có DB thì phòng vẫn chạy, chỉ không có nhiệm vụ. Làm mới mỗi 15 giây, chưa dùng Redis pub/sub (P7).
  - Danh tính dev (bot thử tải) không được lưu tiến độ.
  - Thông báo "X vừa hoàn thành nhiệm vụ" giới hạn một lần mỗi 5 giây mỗi phòng.
- Khác plan ở đâu: `05-multiplayer.md` §4 (payload message), `06-missions.md` §5.1, §5.3.
- Hệ quả: P4.3 vẽ vật thể từ `mission:entities` và cần presenter cho `visit`/`collect`/`quiz`/`social`.

## 2026-11-13 — Engine nhiệm vụ: chi tiết chốt khi làm

- Gói việc: P4.1
- Quyết định:
  - `quiz.answered` mang sẵn `correct` (server tra ngân hàng câu hỏi trước khi gọi engine); handler không cần biết đáp án. Bỏ `runId`: một "lượt" quiz là danh sách câu đang hỏi trong trạng thái của objective. Hết lượt mà chưa đủ câu đúng thì quay lại kiosk để rút lượt mới, không lặp các câu đã đúng.
  - `collect` kiểu `perPlayer` sinh đúng `target` vật phẩm cho mỗi người, chọn từ bộ điểm theo hạt giống `missionId:objectiveId:userId`. Kiểm tra bản đồ chặn bộ điểm nhỏ hơn `target`.
  - Sự kiện `area.entered` dùng chung cho khu vực và cho POI-có-bán-kính (id POI đặt vào `areaId`), để `visit` chỉ cần một loại sự kiện.
  - Trao thưởng: hàng `mission_progress` được đánh dấu `completed_at` trong cùng transaction là cửa chặn chính (chỉ một lần chuyển từ chưa xong sang xong); ràng buộc duy nhất của `wallet_ledger` là lớp thứ hai. Test gửi hai lần hoàn thành cùng lúc.
  - Phần thưởng `item` và `badge` chưa được trao (chưa có bảng `items`/`badges`) — làm ở P4.4/V1. Thưởng mốc streak cố định: 3/7/14/30 ngày → 20/50/100/200 điểm; cấp độ theo 50·n·(n−1) xp.
  - Ngày lễ đọc từ `settings` khoá `holidays` (mảng `YYYY-MM-DD`); admin sửa ở P5.
  - Test DB của engine (store, phần thưởng) nằm trong bộ test của `apps/api`, nơi đã có Postgres riêng cho test, để hai gói không cùng xoá/dựng lại một database khi `pnpm test` chạy song song.
  - Thêm `tools/mission-tools` (nạp nhiệm vụ và câu hỏi từ JSON); nhiệm vụ mẫu ở bản đồ hiện tại có `mapVersion` 0.1.0.
- Khác plan ở đâu: `06-missions.md` §3, §5.1, §7.
- Hệ quả: P4.2 cần một `QuestionPicker` đọc bảng `quiz_questions`, và realtime giờ phụ thuộc `@campus/db`.

## 2026-11-13 — Hồ sơ, phòng ban tự chọn, lần đầu vào game

- Gói việc: P3.4
- Quyết định:
  - **Phòng ban do mỗi người tự chọn** từ danh sách nhập bằng CSV (chỉ tên và phòng cha), không nhập danh sách nhân sự theo email: đúng nguyên tắc "phòng ban tuỳ chọn" ở docs/09 §8, và không phải giữ dữ liệu nhân sự của người chưa từng vào game. Thêm cột `title` (chức danh tự ghi). Migration `0001_profile`.
  - Ẩn khỏi danh sách online đi trong token (claim `hidden`), cập nhật giữa chừng bằng message `profile` như tên và avatar.
  - Thẻ hồ sơ mở từ bảng Mọi người hoặc chạm vào người trong campus; chưa có cấp/huy hiệu/streak (P4) và nút báo cáo (P5).
  - Lần đầu trên một trình duyệt (cờ trong `localStorage`): nếu tài khoản chưa có avatar thì mở trình chỉnh avatar ("Để sau" giữ avatar sinh tự động), rồi thẻ hướng dẫn 3 bước — đi, xoay camera, vẫy tay — tự chuyển bước khi làm xong, có "Bỏ qua". Plan nói "3–4 lựa chọn mỗi mục"; dùng luôn trình chỉnh đầy đủ cho đơn giản.
  - Mã khôi phục của khách: tạo trong bảng Hồ sơ, dùng ở màn hình chào ("Đã có tài khoản khách?").
- Khác plan ở đâu: `07-backend-data.md` §2.1, §4; `05-multiplayer.md` §7.
- Hệ quả: hướng dẫn lần đầu nhớ theo trình duyệt, không theo tài khoản — vào bằng máy mới sẽ thấy lại (có nút bỏ qua).

## 2026-11-13 — Avatar module dựng bằng code thay cho bộ asset Quaternius

- Gói việc: P3.3
- Bối cảnh: plan chọn bộ nhân vật CC0 của Quaternius, tách thành phần rời rồi chỉnh phong cách. Việc đó cần Blender và một quy trình asset (tách mesh, gắn lại xương, nén) chưa có trong repo; tải về rồi mới biết các phần có ghép được với nhau không.
- Quyết định:
  - Mở rộng nhân vật khối của P1.3 thành hệ module thật: mỗi phần (tóc, áo, quần/váy, giày, phụ kiện, dáng) là một hàm dựng hình trên cùng bộ xương, gộp thành một skinned mesh màu đỉnh. Không tải asset, không tốn ngân sách 1,5 MB cho avatar.
  - Chuỗi cấu hình dùng một chữ số hệ 36 cho mỗi lựa chọn để luôn ≤ 32 byte (ví dụ trong plan có số hai chữ số).
  - Avatar đi trong access token; đổi avatar giữa chừng bằng message `profile` mang token mới, nên server realtime vẫn không cần đọc DB và client không tự khai avatar của mình.
  - LOD1 không cần mesh riêng (mesh gốc đã dưới mức ~1.200 tam giác của LOD1); LOD2 (hình nộm) giờ dùng cho cả người ở xa hơn tầm LOD1, đúng bảng thiết kế — trước đó người ở xa vẫn là avatar đầy đủ chạy 5 Hz.
- Khác plan ở đâu: `03-world-and-assets.md` §7 (Hiện tại, nguồn asset, chuỗi cấu hình), `05-multiplayer.md` §4, `07-backend-data.md` §4–5.
- Hệ quả: hình dáng còn khối vuông; nâng cấp mỹ thuật (glTF, bo tròn, khuôn mặt) để P6, giữ nguyên chuỗi cấu hình và đồng bộ.

## 2026-11-13 — Đăng nhập công ty qua OIDC, liên kết khách, đồng ý quyền riêng tư

- Gói việc: P3.2
- Bối cảnh: D2 (Google Workspace hay Microsoft 365, domain nào) chưa chốt.
- Quyết định:
  - Làm hai loại nhà cung cấp cắm qua biến môi trường: `google` và `oidc` tổng quát (dùng cho Microsoft Entra ID hay bất kỳ IdP chuẩn nào). Thiếu cấu hình thì nút không hiện.
  - **Không có `POST /auth/link/:provider` riêng:** liên kết xảy ra ngay ở callback khi trình duyệt đang là khách — vì OIDC là chuyển trang, cookie refresh của khách đi theo tới callback.
  - Tài khoản thật lấy tên hiển thị từ IdP mỗi lần đăng nhập và không đổi tên được (chống mạo danh, docs/09 §6); khách có nhãn "Khách" trên đầu.
  - Khi khách thành tài khoản thật, mã khôi phục của khách bị xoá.
  - Đồng ý là một ô đánh dấu trên màn hình chào (không phải màn hình riêng sau khi đăng nhập), để chưa đồng ý thì chưa tạo tài khoản nào. Server cũng bắt buộc: tạo khách thiếu `consent` thì lỗi 400.
  - Thêm `tools/mock-idp` để dev và e2e chạy được luồng OIDC thật mà không cần tài khoản Google.
- Khác plan ở đâu: `07-backend-data.md` §4 (bảng API), §5.2, §5.3; D2 trong `11-risks-open-questions.md`.
- Hệ quả:
  - Danh sách domain đang ở biến môi trường; P5 chuyển vào bảng `settings` để admin sửa.
  - Đổi email ở IdP sang một email đã thuộc tài khoản khác sẽ lỗi (ràng buộc unique) — hiếm, xử lý khi có admin.
  - Nội dung `/privacy` là bản viết theo nguyên tắc ở docs/09 §8, chưa qua pháp chế.

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
