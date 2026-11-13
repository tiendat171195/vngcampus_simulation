# 08 — Admin CMS

## 1. Mục tiêu

Một người **không biết code** (HR, truyền thông nội bộ) vận hành được game mỗi ngày trong khoảng 10 phút: tạo nhiệm vụ cho ngày mai, gửi thông báo, xem hôm nay có bao nhiêu người chơi.

Admin là một SPA riêng (`apps/admin`), dùng chung đăng nhập và REST API với game, khác ở vai trò.

## 2. Vai trò và quyền

| Chức năng | Biên tập viên | Kiểm duyệt viên | Quản trị |
|---|:-:|:-:|:-:|
| Xem dashboard số liệu | ✔ | ✔ | ✔ |
| Soạn nhiệm vụ, mẫu, ngân hàng quiz | ✔ | — | ✔ |
| Xuất bản, gỡ, kết thúc sớm nhiệm vụ | ✔ | — | ✔ |
| Gửi thông báo | ✔ | — | ✔ |
| Xem báo cáo vi phạm, mute/ban | — | ✔ | ✔ |
| Quản lý người dùng và vai trò | — | — | ✔ |
| Cấu hình hệ thống, cờ tính năng, công tắc khẩn | — | — | ✔ |
| Xem nhật ký thao tác | Của mình | Của mình | Tất cả |

## 3. Sơ đồ màn hình

| Mục | Màn hình | Nội dung |
|---|---|---|
| **Tổng quan** | Dashboard | Số người online theo kênh (trực tiếp), DAU, nhiệm vụ hôm nay: số tham gia / hoàn thành, cảnh báo (ngày mai chưa có nhiệm vụ, báo cáo chờ xử lý) |
| **Nhiệm vụ** | Lịch | Lịch tháng/tuần; mỗi ngày hiện nhiệm vụ đã lên lịch, ngày trống tô đỏ, ngày "tự điền" có nhãn |
| | Danh sách | Lọc theo trạng thái, loại; nhân bản |
| | Trình soạn | Xem mục 4 |
| | Kết quả | Phễu tham gia → hoàn thành, thời gian trung vị, BXH, tiến độ theo từng objective |
| | Mẫu | Kho nhiệm vụ mẫu; bật/tắt cho tự điền |
| | Ngân hàng quiz | Câu hỏi, đáp án, giải thích, tag; nhập hàng loạt từ CSV |
| **Vận hành** | Thông báo | Soạn, hẹn giờ, phát ngay tới mọi kênh |
| | Cấu hình | Sức chứa kênh, chat, chế độ khách, domain email, lịch ngày nghỉ, cờ tính năng |
| | Công tắc khẩn | Tắt chat toàn hệ thống · chế độ bảo trì · kết thúc sớm nhiệm vụ lỗi |
| **Cộng đồng** | Người dùng | Tìm kiếm, xem hồ sơ + chỉ số game, đổi vai trò, áp/gỡ án phạt |
| | Báo cáo | Hàng đợi báo cáo kèm đoạn chat ngữ cảnh; xử lý: bỏ qua / nhắc / mute / ban |
| **Nội dung** | Cosmetic, huy hiệu | Danh mục vật phẩm, giá điểm, thời gian mở bán (V1) |
| **Hệ thống** | Nhật ký thao tác | Ai làm gì, lúc nào, thay đổi gì |

## 4. Quy trình soạn nhiệm vụ

```
1. Chọn mẫu (hoặc bắt đầu trống)        →  2. Thông tin chung: tên, mô tả, ảnh bìa
3. Thêm objective từ danh mục           →  4. Điền tham số + đặt vị trí trên bản đồ
5. Phần thưởng, giờ vàng, mục tiêu cộng đồng
6. Chọn ngày/khung giờ                  →  7. Kiểm tra tự động
8. Xem thử trong game                   →  9. Xuất bản
```

### 4.1 Trình soạn objective

- Mỗi loại objective có **form sinh tự động từ zod schema** của nó (`paramsSchema`), nên thêm loại mới gần như không tốn công giao diện. **Đã làm (P5.2):** form viết tay cho bốn loại MVP (ghé điểm, thu thập, quiz, chào hỏi) với chữ dễ hiểu cho người không biết code; server vẫn kiểm tra bằng zod schema. Sinh form tự động để dành cho khi có thêm loại (V1).
- Các trường tham chiếu bản đồ (`areaId`, `poiId`, `spawnSet`, toạ độ) dùng widget **chọn trên bản đồ**.
- Kéo thả để sắp thứ tự objective; chọn chế độ "tất cả / theo thứ tự / N trong số M".

### 4.2 Bản đồ chọn vị trí

- Bản đồ 2D từng tầng, vẽ bằng chính hàm `renderFloorSvg()` của `packages/map-data` (cùng hàm với minimap trong game).
- Thao tác: chuyển tầng; bấm chọn khu vực hoặc POI có sẵn; bấm để thả điểm mới; kéo để dời; kéo tay nắm để chỉnh bán kính; vẽ chuỗi checkpoint cho objective `race`. **Đã làm (P5.2):** chuyển tầng, rê chuột thấy tên chỗ sẽ chọn, bấm chọn khu vực hoặc POI (POI gần nhất trong 4 m, nếu không thì khu vực); chỗ đã chọn được tô sáng. Thả điểm tự do, kéo bán kính và vẽ đường chạy chưa làm — các loại objective MVP chỉ cần khu vực/POI có sẵn.
- Điểm thả tự kiểm tra **nằm trong vùng đi được**; thả vào tường hoặc mặt nước thì báo lỗi ngay.
- Hiện lớp phủ các objective khác của cùng nhiệm vụ để tránh đặt chồng.

### 4.3 Kiểm tra tự động trước khi xuất bản

| Kiểm tra | Mức |
|---|---|
| Thời gian hợp lệ; không trùng một nhiệm vụ ngày khác | Chặn |
| Có tiêu đề và mô tả tiếng Việt | Chặn |
| Mọi `areaId` / `poiId` / `spawnSet` tồn tại trong phiên bản map hiện hành | Chặn |
| Điểm đặt tay nằm trong vùng đi được, đúng tầng | Chặn |
| `collect`: số điểm trong `spawnSet` ≥ số vật phẩm cần | Chặn |
| `quiz`: đủ câu hỏi đang bật theo tag | Chặn |
| Tổng thưởng nằm trong hạn mức cấu hình | Chặn |
| `gather`: số người yêu cầu cao hơn số online trung bình của khung giờ | Cảnh báo |
| Ước lượng thời gian hoàn thành tối thiểu (tổng quãng đường ÷ tốc độ chạy) quá dài hoặc quá ngắn | Cảnh báo |

API chạy cùng bộ kiểm tra này (`POST /admin/missions/validate` và khi xuất bản), không tin vào kiểm tra phía trình duyệt.

### 4.4 Xem thử trong game

Nút **Xem thử** mở game với `?preview=<missionId>`. Chỉ người đó thấy vật thể của bản nháp; tiến độ ghi với cờ `is_preview`, không vào BXH, không trao thưởng. **Đã làm (P5.2):** chỉ biên tập viên và quản trị viên (vai trò trong token) được xem thử; tiến độ xem thử **chỉ giữ trong bộ nhớ** của phòng, không ghi DB; không có thông báo cả phòng.

### 4.5 Mẫu và tự điền

- Bất kỳ nhiệm vụ nào cũng lưu được thành mẫu.
- Bật "tự điền ngày trống": lúc 23:00, nếu ngày mai chưa có nhiệm vụ ngày, hệ thống chọn một mẫu đang bật (xoay vòng, không lặp lại trong N ngày gần nhất) và lên lịch. Biên tập viên nhận thông báo và vẫn sửa được.
- Mục đích: **không bao giờ có ngày không có nhiệm vụ**, kể cả khi admin bận.

## 5. Vận hành trực tiếp

- **Thông báo:** ba mức — dòng chạy nhẹ, hộp nổi, toàn màn hình (chỉ dùng cho bảo trì). Phát ngay hoặc hẹn giờ.
- **Cấu hình có hiệu lực ngay** (đi qua Redis pub/sub), không cần khởi động lại.
- **Công tắc khẩn:** tắt chat toàn hệ thống; chế độ bảo trì (người mới không vào được, người đang chơi nhận thông báo); kết thúc sớm một nhiệm vụ đang lỗi. Mỗi lần bật đều ghi nhật ký.

## 6. Kiểm duyệt

1. Người chơi bấm **Báo cáo** trên thẻ hồ sơ hoặc trên một tin chat, chọn lý do.
2. Hệ thống chụp đoạn chat xung quanh (từ bộ đệm 24 giờ) đính vào báo cáo.
3. Kiểm duyệt viên xem hàng đợi và quyết định: bỏ qua · nhắc nhở · cấm chat (1 giờ / 1 ngày / 7 ngày) · khoá tài khoản.
4. Án phạt có hiệu lực ngay trong game; người bị phạt thấy lý do và thời hạn.
5. Mọi quyết định ghi vào nhật ký thao tác.

Trong chế độ nội bộ, tên hiển thị gắn với danh tính thật nên lượng vi phạm kỳ vọng thấp. Công cụ này quan trọng hơn nhiều nếu mở chế độ khách.

## 7. Dashboard số liệu

| Nhóm | Chỉ số |
|---|---|
| Trực tiếp | Số người online, theo kênh và theo khu; số phiên theo loại thiết bị |
| Hằng ngày | DAU, người mới, tỉ lệ quay lại D1/D7, thời lượng phiên trung vị |
| Nhiệm vụ | Tham gia, hoàn thành, thời gian trung vị, objective nào làm người chơi bỏ cuộc nhiều nhất |
| Giao lưu | Số emote, tin chat, lượt ngồi ghế mỗi phiên |
| Kỹ thuật | Thời gian tải, FPS theo nhóm thiết bị, tỉ lệ lỗi |

Mọi số liệu đều ở dạng **tổng hợp**; không có báo cáo theo từng cá nhân.

## 8. Ghi chú kỹ thuật

- Stack: Vite + React + TanStack Query + React Router + Tailwind + bộ component shadcn/ui; form bằng react-hook-form + zod. **Đã làm (P5.1):** chỉ React + vài hook nhỏ (`useLoad`, `usePath`) và CSS thuần — admin còn ít màn hình, chưa cần thêm thư viện (xem DECISIONS).
- Đăng nhập: admin không có màn hình đăng nhập riêng; dùng chung cookie phiên với game (cùng host). Chưa đăng nhập hoặc không đủ quyền thì admin chỉ đường sang game để đăng nhập bằng tài khoản công ty.
- Kiểu dữ liệu và schema lấy từ `packages/shared`; hình học bản đồ từ `packages/map-data`.
- Số người online trực tiếp: gọi lại `/presence/summary` mỗi vài giây (không cần WebSocket riêng cho admin).
- Trước khi có admin (P4), nhiệm vụ được tạo bằng file JSON và một lệnh CLI seed — cùng schema, nên dữ liệu chuyển thẳng sang admin sau này.
