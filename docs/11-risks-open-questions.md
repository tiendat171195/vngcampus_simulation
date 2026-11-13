# 11 — Rủi ro & câu hỏi mở

## 1. Quyết định cần bạn chốt

Plan đang đi theo cột **Mặc định**. Có thể bắt đầu P0–P2 ngay mà chưa cần trả lời câu nào; cột "Cần trước" cho biết hạn chót thực tế của từng quyết định.

| # | Câu hỏi | Các lựa chọn | Mặc định | Nếu chọn khác thì ảnh hưởng gì | Cần trước |
|---|---|---|---|---|---|
| D1 | **Ai được vào?** | (a) Chỉ nhân viên · (b) Nhân viên + khách mời · (c) Công khai | (a), kiến trúc để ngỏ (b) | (c) đổi hẳn bài toán: kiểm duyệt nặng, cần chịu tải đột biến, bắt buộc có phép về thương hiệu | P3 |
| D2 | **Đăng nhập bằng gì?** | (a) OIDC Google/Microsoft theo domain email công ty · (b) Khách + **mã mời** · (c) Zalo | Khách ở giai đoạn dựng → (a) khi mở rộng | Nếu công ty không cho dùng IdP cho dự án này thì dùng (b): vẫn giữ được phạm vi nội bộ, nhưng tên hiển thị không gắn danh tính thật. P3.2 đã làm cả Google lẫn OIDC tổng quát (Microsoft dùng được qua OIDC), chỉ cần cấu hình — vẫn cần chốt IdP nào và domain email nào | Trước khi mở cho nhiều người |
| D3 | **Phong cách hình ảnh** | (a) Low-poly cách điệu · (b) Tả thực · (c) Voxel/khối vuông | (a) | (b) tốn công art gấp nhiều lần và nặng máy; (c) nhanh hơn nữa nhưng ít giống thật | P6 |
| D4 | **Phạm vi bản đồ MVP** | (a) Ngoại cảnh + tầng trệt công cộng, tầng văn phòng giản lược · (b) Chỉ ngoại cảnh + Atrium · (c) Đủ 3 tầng chi tiết | (a) | (b) ra nhanh hơn; (c) chậm hơn đáng kể và đụng vấn đề an ninh | P1.1 (chỉnh lại ở P6.2) |
| D5 | **Hạ tầng và tên miền** | (a) 1 VPS + CDN tự trả · (b) VNG Cloud · (c) Khác | (a) cho pilot | (b) cần tài khoản và quy trình của công ty | P7.1 |
| D6 | **Phần thưởng** | (a) Chỉ trong game · (b) Đổi được quà thật | (a) | (b) cần ngân sách, danh tính thật bắt buộc, chống gian lận chặt hơn nhiều | P4 |
| D7 | **Chat** | (a) Chat gần có lọc + emote · (b) **Không chat**, chỉ emote và câu chào soạn sẵn (như Sansa) · (c) Thêm voice | (a), có công tắc chuyển sang (b) | (b) gần như xoá gánh kiểm duyệt; (c) cần hạ tầng voice và chính sách riêng | P2.3 |
| D8 | **Ngôn ngữ** | Tiếng Việt · Việt + Anh | Tiếng Việt, khung i18n sẵn | Thêm tiếng Anh chủ yếu tốn công dịch nội dung | P1.4 |
| D9 | **Tên và nhận diện** | Tên sản phẩm, màu chủ đạo, có dùng logo VNG không | Tên tạm "VNG Campus Online", chưa dùng logo | — | P6 |
| D10 | **Mốc thời gian** | Có dịp nào muốn ra mắt đúng lúc không (tất niên, Tết, sinh nhật công ty)? | Không có hạn cứng | Có hạn cứng thì cắt phạm vi theo mốc M4 hoặc M5 | Càng sớm càng tốt |
| D11 | **Repo công khai hay riêng tư?** | Công khai · Riêng tư | Giả định riêng tư | Công khai thì tuyệt đối không commit ảnh/sơ đồ nội bộ; cần rà soát kỹ hơn về bí mật | Trước khi gửi tư liệu |
| D12 | **Ai vận hành?** | Ai là admin và biên tập viên đầu tiên | Bạn | Quyết định mức độ "dễ dùng" cần đạt của admin CMS | P5 |

## 2. Sổ rủi ro

| # | Rủi ro | Khả năng | Ảnh hưởng | Giảm thiểu |
|---|---|:-:|:-:|---|
| R1 | Thiếu tư liệu mặt bằng nên bản đồ không giống thật | Cao | Trung bình | Greybox chơi được từ dữ liệu công khai; ưu tiên dựng đúng các **điểm mốc** (Atrium, hồ Koi, hồ bơi) thay vì đúng từng mét; danh sách tư liệu cần xin ở [03](03-world-and-assets.md#8-tư-liệu-cần-bạn-cung-cấp) |
| R2 | Hiệu năng kém trên điện thoại và trình duyệt nhúng khi đông người | Trung bình | Cao | Ngân sách cứng, LOD + impostor, mức chất lượng tự động; đo đám đông giả ngay từ P1.4; thử thiết bị thật sớm |
| R3 | Khối lượng art lớn hơn dự kiến | Cao | Trung bình | Phong cách cách điệu, nội thất văn phòng sinh theo quy tắc, bộ asset CC0, AI hỗ trợ đạo cụ; art chạy song song và không chặn gameplay |
| R4 | Thế giới vắng người nên mất vui | Trung bình | Cao | Dồn người vào kênh đông nhất, giờ vàng, objective tập thể, NPC và hoạt cảnh nền, thông báo nhắc; kiểm chứng ngay sau M2 |
| R5 | Colyseus chưa 1.0, chủ yếu một người duy trì | Thấp – TB | Trung bình | Ghim phiên bản, không dùng gói beta, bọc sau lớp trừu tượng, logic game không phụ thuộc framework |
| R6 | Chưa được công ty đồng ý về thương hiệu, an ninh, dữ liệu | Trung bình | Cao | Hỏi sớm; trong lúc chờ giữ ở nhóm nhỏ, dùng tên chung, không dựng khu nhạy cảm (xem [09](09-infra-security.md#9-thương-hiệu-và-an-ninh-nơi-làm-việc)) |
| R7 | Bị xem là công cụ giám sát hoặc gây xao nhãng giờ làm | Trung bình | Trung bình | Không có số liệu theo cá nhân; phiên ngắn 5–10 phút; streak chỉ tính ngày làm việc; giờ vàng đặt vào giờ nghỉ trưa |
| R8 | Admin không tạo nhiệm vụ đều, có ngày trống | Cao | Trung bình | Kho mẫu + tự điền; soạn trước cả tuần trên lịch; cảnh báo trên dashboard |
| R9 | Lạm dụng chat, quấy rối | Thấp (nội bộ) | Cao | Danh tính thật, lọc từ, báo cáo, mute/ban, công tắc tắt chat; phương án không chat (D7b) |
| R10 | Quá tải khi lan truyền | Thấp (nội bộ) · Cao (công khai) | Cao | Trần người mỗi kênh, CDN cho mọi thứ tĩnh, loadtest, lộ trình scale; chế độ bảo trì |
| R11 | Gian lận bảng xếp hạng làm mất hứng | Trung bình | Thấp | Server quyết định, đánh dấu bất thường, thưởng hạng nhỏ |
| R12 | Các phiên bản thư viện mới nhất chưa ăn khớp nhau (TypeScript 7, Vite 8…) | Trung bình | Thấp | Chốt và ghim ở P0; có phương án lùi một bậc |
| R13 | iOS giết trang vì bộ nhớ / mất WebGL context | Trung bình | Trung bình | Ngân sách texture chặt, xử lý mất context, hạ mức chất lượng tự động |
| R14 | Phạm vi phình to | Cao | Cao | MVP đúng bằng P0–P5; ý tưởng mới vào danh sách P8; hai điểm dừng kiểm chứng sau M2 và M4 |

## 3. Giả định đang dùng

| Giả định | Nếu sai thì |
|---|---|
| Footprint OSM đủ tốt để khởi đầu | Vẽ lại footprint từ ảnh vệ tinh/sơ đồ ở P6.2; map-data được thiết kế để sửa dễ |
| Cao độ tầng 5,0 / 4,5 / 4,5 m | Sửa một chỗ trong map-data, greybox tự dựng lại |
| Vị trí các khu trong nhà (đang đánh dấu `placeholder`) | Dời đa giác và POI; nhiệm vụ tham chiếu bằng mã khu nên không phải sửa |
| Giờ cao điểm vài trăm người đồng thời | Ít hơn: giảm số kênh, tăng NPC. Nhiều hơn: lên bậc hạ tầng kế tiếp |
| Người dùng mở link từ app chat trên điện thoại | Nếu chủ yếu desktop thì nâng mức chất lượng mặc định |
| Một nhiệm vụ ngày mất 5–10 phút | Điều chỉnh qua mẫu nhiệm vụ; không ảnh hưởng kiến trúc |
| Đội làm chỉ có bạn + Claude, không có hoạ sĩ 3D | Có hoạ sĩ thì P6 nhanh và đẹp hơn nhiều; pipeline đã sẵn cho Blender |

## 4. Thứ cần bạn cung cấp, theo thời điểm

| Khi nào | Cần gì |
|---|---|
| **Ngay bây giờ** | Không cần gì thêm — P0 và P1 chạy được với dữ liệu hiện có. Nếu tiện: trả lời D1, D4, D10, D11 |
| **Trước P2.3** | D7 (chat hay không chat) |
| **Trước P3.2** | D2: công ty dùng Google Workspace hay Microsoft 365, domain email nào được phép; hoặc xác nhận đi theo hướng mã mời |
| **Trước P4** | D6 (phần thưởng); vài ý tưởng nhiệm vụ bạn muốn có nhất để kiểm tra danh mục objective đã đủ chưa |
| **Trước P6.2** | Tư liệu nhóm A (mặt bằng) và B (ngoại thất) ở [03](03-world-and-assets.md#8-tư-liệu-cần-bạn-cung-cấp); danh sách khu không được dựng |
| **Trước P6.4** | Tư liệu nhóm C, D, E (nội thất, video, tên khu/phòng họp) |
| **Trước P7** | D5 (hạ tầng, tên miền); kết quả xin phép về thương hiệu, an ninh, dữ liệu; danh sách người tham gia pilot |
