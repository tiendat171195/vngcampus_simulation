# 01 — Sản phẩm

## 1. Tầm nhìn

> "Mở link là tới công ty." Một VNG Campus thu nhỏ trên trình duyệt, nơi mỗi sáng bạn "đi làm" bằng avatar, gặp đồng nghiệp đang online và cùng nhau làm nhiệm vụ của ngày.

Mục tiêu sản phẩm, theo thứ tự ưu tiên:

1. **Cùng có mặt** — cảm giác "mọi người đang ở đây" quan trọng hơn mọi tính năng khác.
2. **Thói quen hằng ngày** — một nhiệm vụ mới mỗi ngày, làm xong trong 5–10 phút.
3. **Nhận ra ngay là VNG Campus** — các điểm mốc quen thuộc (Atrium, hồ Koi, hồ bơi, canteen…), không cần chính xác từng mét.
4. **Vận hành không cần dev** — admin tự tạo nhiệm vụ, thông báo, sự kiện.

## 2. Bài học từ các dự án tham chiếu

Đây là các sản phẩm "chùa online" đang lan truyền cuối tháng 10 – đầu tháng 11/2026.

| Sản phẩm | Điều quan sát được | Rút ra cho dự án này |
|---|---|---|
| **Sansa** (Hàn Quốc) | Do một người không chuyên lập trình dựng bằng công cụ AI; ~600.000 lượt trong 3 ngày; **không có chat**, mọi người chỉ cùng ở trong một không gian; có mặt trên mini-app (Toss); từng quá tải | Vào nhanh và "cùng có mặt" là đủ để lan truyền. Phải có giới hạn người/phòng và chia kênh từ đầu. Mini-app (Zalo) là kênh phân phối đáng tính sau |
| **Niệm Phật Online** (Việt Nam) | Web 3D góc nhìn thứ ba; WASD + kéo chuột, mobile kéo nửa trái để đi, nửa phải để xoay; **nhiệm vụ ngày/tuần, điểm danh, cấp độ, vật phẩm, bảng xếp hạng**; nhiều server, mỗi server một nhân vật; đăng nhập bằng tên + mã khôi phục; có giới hạn tốc độ thao tác; hiệu ứng "Đồng tâm" khi nhiều người cùng lạy; người chơi **tranh nhau chỗ ngồi** và đem ra đùa trên mạng | Bộ điều khiển và vòng lặp nhiệm vụ này đã được người dùng Việt chấp nhận. **Khoảnh khắc tập thể** và **sự khan hiếm vui vẻ** (chỗ ngồi có hạn) tạo ra chuyện để kể. Cần rate limit ngay từ đầu |
| **Cyber Sansa** | Frontend tĩnh + Cloudflare Workers, presence chạy trong worker, mỗi sảnh có **giới hạn mềm** số người | Phòng nhỏ + giới hạn mềm giữ trải nghiệm ổn định khi đông |

Khác biệt chủ đích của VNG Campus Online: địa điểm là **nơi làm việc thật của chính người chơi**, người trong đó là **đồng nghiệp thật**, và nhiệm vụ do **admin biên tập mỗi ngày** chứ không phải bộ nhiệm vụ cố định.

Nguồn: [Tuổi Trẻ](https://tuoitre.vn/chua-ao-han-gay-sot-game-di-chua-viet-co-gi-khac-biet-100261101161851074.htm), [Sforum](https://cellphones.com.vn/sforum/niem-phat-online), [CafeF](https://cafef.vn/chan-dung-chang-trai-26-tuoi-khien-hang-nghin-nguoi-ru-nhau-di-chua-online-dan-ngoai-ngu-that-nghiep-khong-theo-dao-phat-188261101101751833.chn), [VnExpress International](https://e.vnexpress.net/news/tech/personalities/south-korean-job-seeker-with-no-coding-experience-creates-viral-ai-powered-temple-in-30-minutes-5140119.html), [Korea JoongAng Daily](https://www.koreajoongangdaily.com/korea/no-travel-no-talking-young-koreans-find-peace-in-virtual-temple-and-more/12959647), [DEV – Cyber Sansa](https://dev.to/sansatemple_live/cyber-sansa-sansatemplelive-a-browser-3d-temple-with-multiplayer-halls-50nk).

## 3. Vai trò người dùng

| Vai trò | Mô tả | Quyền chính |
|---|---|---|
| **Người chơi** (nhân viên) | Đăng nhập, đi lại, giao lưu, làm nhiệm vụ | Mọi tính năng trong game |
| **Khách** (tuỳ chọn) | Vào bằng tên hiển thị, chưa liên kết tài khoản | Đi lại, emote; chat và BXH tuỳ cấu hình |
| **Biên tập viên** | Người soạn nhiệm vụ, thông báo (HR, truyền thông nội bộ) | Admin CMS: nhiệm vụ, quiz, thông báo |
| **Kiểm duyệt viên** | Xử lý báo cáo vi phạm | Admin CMS: báo cáo, mute/ban |
| **Quản trị** | Toàn quyền, cấu hình hệ thống | Mọi thứ, kể cả phân quyền |

## 4. Trải nghiệm cốt lõi

### 4.1 Lần đầu tiên (≤ 60 giây tới lúc đi được)

1. Mở link → màn hình chào với ảnh campus; asset bắt đầu tải ngầm.
2. Đăng nhập (SSO một chạm) hoặc nhập tên hiển thị.
3. Chọn nhanh ngoại hình (3–4 lựa chọn mỗi mục: tóc, áo, màu da) — đổi lại sau được.
4. Xuất hiện ở **cổng chính**. Hướng dẫn 3 bước: đi, xoay camera, vẫy tay.
5. Biểu ngữ "Nhiệm vụ hôm nay" hiện ra, có mũi tên dẫn đường tới mục tiêu đầu tiên.

### 4.2 Vòng lặp hằng ngày (5–10 phút)

```
Mở link → vào ở cổng ("đi làm") → điểm danh
        → xem nhiệm vụ hôm nay → đi theo chỉ dẫn trong map
        → tương tác: ghé điểm / nhặt đồ / trả lời quiz / chào đồng nghiệp
        → hoàn thành → nhận điểm, giữ streak, lên BXH
        → nán lại: ngồi cà phê, tám chuyện, xem ai đang online → rời đi
```

Chi tiết tạo cảm giác "đi làm": lần vào đầu tiên trong ngày luôn xuất hiện ở cổng và đi qua cửa kiểm soát (điểm danh). Các lần sau trong ngày xuất hiện lại ở chỗ vừa rời đi.

### 4.3 Thiết kế giao lưu

- **Áp lực thấp:** không ai buộc phải chat. Emote (vẫy tay, vỗ tay, cúi chào, nhảy, ngồi) là cách giao tiếp chính.
- **Khoảnh khắc tập thể:** nhiệm vụ "tụ tập ≥ N người ở Atrium lúc 15:00", hiệu ứng đặc biệt khi nhiều người cùng làm một emote, mục tiêu cộng đồng ("toàn công ty đạt 500 lượt hoàn thành").
- **Khan hiếm vui vẻ:** ghế cạnh hồ Koi, ghế bar cà phê có số lượng thật, ai tới trước ngồi trước.
- **Giờ vàng:** admin có thể đặt khung giờ thưởng thêm (ví dụ 12:00–13:30) để mọi người vào cùng lúc; thế giới đông thì mới vui.
- **Tìm đồng nghiệp:** danh sách ai đang online, ở kênh nào, khu nào; bấm để chuyển sang kênh đó.

## 5. Phạm vi tính năng theo đợt phát hành

| Nhóm | MVP (P0–P5) | V1 (P6–P7) | V2+ (P8) |
|---|---|---|---|
| **Thế giới** | Ngoại cảnh toàn khu dạng greybox có tô màu; tầng trệt khu công cộng; cổng, sảnh, Atrium, canteen, hồ bơi | Art hoàn chỉnh, nội thất chính, ánh sáng bake, âm thanh môi trường, sáng/trưa/chiều/tối theo giờ thật | Trang trí theo mùa (Tết, sinh nhật công ty), thời tiết theo thực tế |
| **Avatar** | Nhân vật low-poly, chọn tóc/áo/màu da, thẻ tên | Tủ đồ mở rộng, phụ kiện, thẻ nhân viên, huy hiệu trên thẻ tên | Thú cưng, trang phục sự kiện |
| **Di chuyển** | Đi, chạy, nhảy; WASD + chuột; joystick cảm ứng | Chạm-để-đi (tìm đường), chế độ chụp ảnh | Góc nhìn thứ nhất, tay cầm, xe điện/xe đạp trong khuôn viên |
| **Giao lưu** | Thấy nhau realtime, emote, ngồi ghế, chat gần + bong bóng chat, danh sách online + tìm đồng nghiệp, chuyển kênh, thẻ hồ sơ, trạng thái AFK | High-five hai người, chat cả kênh | Voice theo khoảng cách, nhắn riêng, nhóm bạn |
| **Nhiệm vụ** | 1 nhiệm vụ ngày; 4 loại objective: ghé điểm, thu thập, quiz, chào hỏi; mục tiêu cộng đồng | Thêm 6 loại: tụ tập, emote tại chỗ, chụp ảnh, giao hàng, chạy checkpoint tính giờ, tìm linh vật; nhiệm vụ tuần/sự kiện chạy song song | Minigame (bóng rổ, đua bơi, quiz show trực tiếp), thi đua giữa phòng ban |
| **Phần thưởng** | Điểm, cấp độ, streak, BXH ngày/tuần | Huy hiệu, cửa hàng cosmetic đổi bằng điểm, BXH phòng ban | Bộ sưu tập theo mùa |
| **Admin** | Soạn + lên lịch nhiệm vụ (chọn vị trí trên bản đồ, xem thử trong game), ngân hàng quiz, mẫu + tự điền ngày trống, thông báo, người dùng, kiểm duyệt, dashboard | Quản lý cosmetic và huy hiệu | Sự kiện trực tiếp ở Atrium (sân khấu, chiếu màn hình) |
| **Nền tảng** | Web responsive, đăng nhập khách + OIDC | PWA (cài lên màn hình chính, cache asset), ảnh chia sẻ thành tích | Zalo Mini App, thông báo nhắc nhiệm vụ, NPC hướng dẫn viên dùng LLM (Claude API) |

## 6. Ví dụ một tuần nhiệm vụ

| Ngày | Tên | Nội dung | Loại objective |
|---|---|---|---|
| Thứ 2 | Chào tuần mới | Điểm danh ở cổng → vẫy tay chào 5 đồng nghiệp khác nhau → ghé Atrium | visit, social |
| Thứ 3 | Săn cà phê | Tìm 6 ly cà phê rải quanh campus (mỗi người một bộ vị trí riêng) | collect |
| Thứ 4 | Hiểu về VNG | Tìm 3 kiosk, mỗi kiosk trả lời đúng ≥ 2/3 câu hỏi | quiz, visit |
| Thứ 5 | Giờ thể thao | Chạy một vòng qua 6 checkpoint trong 3 phút; ghé phòng gym | race, visit |
| Thứ 6 | Ảnh tập thể | ≥ 20 người cùng đứng ở Atrium trong khung 15:00–15:10, cùng nhảy | gather, emote_at |
| Cuối tuần | Thư giãn | Ngồi cạnh hồ Koi 60 giây; tìm linh vật đang trốn | emote_at, collect |

Định nghĩa đầy đủ và cách engine xử lý từng loại ở [06-missions.md](06-missions.md).

## 7. Không làm

- Không phải bản sao số chính xác (digital twin/BIM) của toà nhà.
- Không ưu tiên kính VR.
- Không có kinh tế tiền thật, không quảng cáo.
- Không thay thế công cụ chat/họp của công ty.
- Không có chiến đấu, không PvP.
- Không dựng các khu vực nhạy cảm về an ninh (xem [09-infra-security.md](09-infra-security.md)).
- Không biến thành công cụ chấm công: dữ liệu online của từng cá nhân không được cung cấp cho quản lý.

## 8. Chỉ số theo dõi (mục tiêu gợi ý, chỉnh sau pilot)

| Chỉ số | Cách đo | Mục tiêu gợi ý |
|---|---|---|
| Thời gian tới lúc đi được (lần đầu / lần sau) | Client đo `world_loaded` | ≤ 8 s / ≤ 3 s trên 4G |
| FPS trung vị trên mobile tầm trung | Mẫu từ client | ≥ 30 |
| Tỉ lệ tham gia nhiệm vụ ngày | Người bắt đầu nhiệm vụ / DAU | ≥ 60% |
| Tỉ lệ hoàn thành | Người hoàn thành / người bắt đầu | ≥ 70% |
| Quay lại ngày hôm sau (D1) / sau 7 ngày (D7) | Cohort | ≥ 40% / ≥ 20% |
| Thời lượng phiên trung vị | Phiên realtime | 6–12 phút |
| Tương tác xã hội mỗi phiên | Emote hướng tới người khác + tin chat | ≥ 3 |
| Số người đồng thời cao nhất | Realtime | Theo dõi để lập kế hoạch dung lượng |
