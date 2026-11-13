# 04 — Client (game trên trình duyệt)

## 1. Mục tiêu thiết kế

1. **Vào nhanh:** đi lại được sau ≤ 8 giây ở lần đầu, ≤ 3 giây ở các lần sau (4G/Wi-Fi văn phòng).
2. **Chạy được trên máy phổ thông:** ≥ 30 FPS trên điện thoại Android tầm trung, 60 FPS trên laptop văn phòng có GPU tích hợp.
3. **Chạy trong trình duyệt nhúng:** link mở từ Zalo/Messenger/Facebook phải vào được ngay.
4. **Dọc trước:** HUD thiết kế cho điện thoại cầm dọc, rồi mới mở rộng cho ngang và desktop.

## 2. Cấu trúc mã nguồn (`apps/web/src`)

```
app/          # vỏ React: route (`/`, `/privacy`, `/debug/map`; đăng nhập OIDC quay về thẳng trang cũ, không cần route callback ở client), provider, error boundary
ui/           # HUD và menu (DOM): MissionTracker, ChatBox, EmoteWheel, Joystick, MiniMap,
              # OnlineList, ProfileCard, AvatarEditor, Settings, Onboarding, Toasts
game/
  core/       # GameRuntime, vòng lặp, đồng hồ, event bus có kiểu, QualityManager
  world/      # nạp manifest, streaming zone, dựng greybox từ map-data, ánh sáng, bầu trời, lưới va chạm
  player/     # người chơi cục bộ: input → motor → animation; camera rig
  avatars/    # AvatarFactory (gộp module), AnimationController, LOD/impostor, thẻ tên, bong bóng chat
  net/        # NetClient (bọc Colyseus SDK), mã hoá message, bộ đệm nội suy, đồng bộ đồng hồ
  entities/   # người chơi khác, NPC, vật tương tác (vật phẩm, kiosk, ghế), sổ đăng ký entity
  missions/   # trình bày nhiệm vụ trong thế giới: điểm đánh dấu, dẫn đường, gửi tương tác
  audio/      # nhạc nền theo khu, hiệu ứng, âm thanh không gian
  debug/      # lớp phủ dev, camera bay, công cụ chọn toạ độ, sinh bot giả
state/        # zustand store: session, ui, mission, chat, settings
services/     # API client (REST), auth, analytics, lưu cục bộ
assets/       # loader GLB/KTX2/Meshopt, cache, ưu tiên tải
```

## 3. Kiến trúc runtime

Ba lớp, ranh giới rõ:

| Lớp | Công nghệ | Tần suất | Chứa gì |
|---|---|---|---|
| Vỏ và HUD | React DOM + zustand | Thấp (sự kiện) | Menu, chat, bảng nhiệm vụ, cài đặt |
| GameRuntime | TypeScript thuần, đối tượng thay đổi trực tiếp | Mỗi frame | Vị trí, vận tốc, bộ đệm nội suy, trạng thái entity |
| Cảnh 3D | React Three Fiber | Mỗi frame qua `useFrame` | Mesh, ánh sáng, camera |

Quy tắc bắt buộc: **không dùng React state cho dữ liệu thay đổi mỗi frame**. Dữ liệu frame nằm trong đối tượng thường và được đọc trong `useFrame` qua ref. Zustand chỉ nhận cập nhật đã tiết lưu (ví dụ tiến độ nhiệm vụ, số người online).

**Thứ tự một frame:**

```
1. Input            đọc bàn phím / cảm ứng / tay cầm → ý định di chuyển
2. LocalPlayer      bước cố định 60 Hz: motor + va chạm → vị trí mới
3. NetSend          10 Hz: gửi vị trí nếu thay đổi
4. NetReceive       áp patch từ server vào bộ đệm của từng entity
5. Interpolation    người chơi khác: nội suy tại (giờ server − độ trễ đệm)
6. Animation        cập nhật mixer theo LOD (so le giữa các avatar)
7. Camera           bám theo, chống xuyên tường
8. Streaming/LOD    quyết định zone và mức chi tiết avatar
9. Render
```

Các "system" giao tiếp qua event bus có kiểu (`player.areaChanged`, `net.disconnected`, `mission.progress`…), không gọi chéo nhau.

## 4. Render và mức chất lượng

`WebGLRenderer` (WebGL2), màu sRGB. Greybox dùng 1 đèn hướng + 1 hemisphere + 1 ambient, flat shading, **không tone mapping** (màu ra đúng như bảng màu); sau art pass chuyển sang lightmap bake và đánh giá lại tone mapping.

| Thiết lập | Low | Medium | High |
|---|---|---|---|
| Tỉ lệ điểm ảnh tối đa (DPR) | 1,0 | 1,5 | 2,0 |
| Bóng đổ | Bóng tròn dưới chân | Bóng tròn + bóng bake | Shadow map cho nắng |
| Tầm nhìn (có sương che đường cắt) | 140 m | 220 m | 400 m |
| Avatar chi tiết (LOD0 / LOD1) | 12 / 20 | 25 / 40 | 50 / 80 |
| Mật độ cây và đạo cụ | Thưa | Vừa | Dày |
| Nước | Mặt phẳng màu | Sóng nhẹ | Sóng + phản xạ giả |
| Hậu kỳ | Không | Không | Khử răng cưa, bloom nhẹ |

- **Chọn mức tự động** (`game/core/quality.ts`): một "thang" 8 nấc mức × DPR, từ Thấp@0,75 tới Cao@2. Lần đầu đoán nấc theo GPU (render phần mềm → thấp nhất; cảm ứng → Trung bình; desktop → Cao@1,5). Khi chạy: dưới 28 FPS trong 2 giây thì xuống một nấc, trên 55 FPS trong 5 giây thì lên một nấc; nấc vừa phải rời không được thử lại trong 60 giây để khỏi dao động. Người dùng chọn cố định trong Cài đặt hoặc `?quality=`.
- **Kỹ thuật bắt buộc:** instancing cho mọi vật lặp lại (cây, ghế, bàn, kệ cây); gộp mesh tĩnh theo material trong từng zone; atlas texture; nén KTX2; cắt theo tầng (chỉ vẽ tầng đang đứng); tránh vật trong suốt chồng lớp; không cấp phát bộ nhớ trong vòng lặp frame.
- **Dev có lớp phủ ngân sách:** số draw call, tam giác, bộ nhớ texture — vượt ngưỡng ở [03](03-world-and-assets.md#6-ngân-sách-asset-và-hiệu-năng) thì cảnh báo.

## 5. Điều khiển

| Hành động | Desktop | Mobile |
|---|---|---|
| Di chuyển | WASD / phím mũi tên (theo hướng camera) | Joystick ảo: chạm nửa trái màn hình, joystick hiện tại chỗ chạm |
| Chạy | Giữ Shift | Đẩy joystick hết cỡ |
| Xoay camera | Kéo chuột | Kéo ở nửa phải màn hình |
| Zoom | Con lăn | Chụm hai ngón |
| Nhảy | Space | Nút nhảy |
| Tương tác | E | Nút ngữ cảnh hiện khi tới gần vật tương tác |
| Emote | Phím 1–8 hoặc bánh xe emote (giữ Q) | Nút emote → bánh xe |
| Chat | Enter | Nút chat |
| Bản đồ / danh sách online | M / Tab | Nút trên HUD |

Bộ điều khiển mobile giống cách Niệm Phật Online đang dùng, người chơi Việt đã quen. Chạm-để-đi và tay cầm thêm ở V1/V2.

## 6. Nhân vật và camera

**Motor của người chơi cục bộ** (giao diện `CharacterMotor`, để sau này đổi cài đặt mà không đụng phần còn lại):

| Thông số | Giá trị khởi điểm |
|---|---|
| Hình va chạm | Capsule bán kính 0,3 m, cao 1,7 m |
| Tốc độ đi / chạy | 2,5 / 5,5 m/s |
| Trọng lực, độ cao nhảy | −20 m/s², ~0,9 m |
| Dốc tối đa | 45° |
| Bước mô phỏng | Cố định 60 Hz, tối đa 5 bước con mỗi frame |

- Va chạm: capsule so với lưới va chạm tĩnh qua three-mesh-bvh. **Cầu thang là mặt dốc trong lưới va chạm** (phần nhìn thấy vẫn là bậc thang) để đi mượt.
- An toàn: rơi khỏi thế giới (y < −10) thì đưa về vị trí an toàn gần nhất.
- Các giá trị tốc độ là hằng số dùng chung trong `packages/shared` vì server dùng chúng để kiểm tra.

**Camera góc nhìn thứ ba:** bám sau lưng, khoảng cách 2–8 m (mặc định 5), góc ngẩng −10°…70°, trường nhìn 60° (cầm dọc: 70°). Có "tay đòn lò xo": bắn tia từ đầu nhân vật về camera, vướng tường thì kéo camera lại gần. Chuyển động có giảm chấn.

**Máy trạng thái animation:** `idle ↔ walk ↔ run`, `jump (bắt đầu → trên không → tiếp đất)`, `sit (ngồi xuống → giữ → đứng dậy)`, `emote` (ngắt khi di chuyển). Chuyển cảnh crossfade 0,15–0,25 s. Người chơi khác dùng cùng máy trạng thái, điều khiển bởi trường `anim` từ server.

## 7. Hệ tương tác

- Mọi thứ tương tác được (vật phẩm, kiosk quiz, NPC, ghế, điểm chụp ảnh) đăng ký một `Interactable { id, vị trí, bán kính, nhãn gợi ý, độ ưu tiên }`.
- 10 lần mỗi giây, client chọn ứng viên tốt nhất trong bán kính và trong hướng nhìn, hiện gợi ý ("Nhấn E để nhặt" / nút bấm trên mobile).
- Khi kích hoạt: client phát hiệu ứng tức thì và gửi `interact` lên server. **Server là bên xác nhận**; nếu bị từ chối thì client hoàn tác hiệu ứng.

## 8. Danh mục HUD và màn hình

| Màn hình / thành phần | Nội dung |
|---|---|
| Chào + đăng nhập | Ảnh nền campus, nút đăng nhập, nhập tên khách; tải asset ngầm |
| Tạo/sửa avatar | Xem trước 3D, chọn module và màu |
| HUD chính | Bảng nhiệm vụ thu gọn, minimap, số người online, nút chat/emote/menu, joystick (mobile) |
| Biểu ngữ nhiệm vụ | Hiện khi vào game và khi có nhiệm vụ mới; đếm ngược tới lúc hết hạn |
| Chỉ dẫn mục tiêu | Mũi tên/la bàn ở mép màn hình, cột sáng tại đích, khoảng cách còn lại |
| Hộp chat | Kênh "gần đây", lịch sử ngắn, nút báo cáo |
| Bánh xe emote | 8 emote thường dùng |
| Danh sách online | Tìm theo tên, xem kênh/khu, nút "tới kênh này" |
| Thẻ hồ sơ | Tên, phòng ban, cấp, huy hiệu, streak; nút vẫy chào, báo cáo |
| Bảng xếp hạng | Ngày / tuần / mọi thời điểm; cá nhân và phòng ban |
| Chúc mừng hoàn thành | Phần thưởng, streak, thứ hạng, nút chia sẻ |
| Chọn kênh | Danh sách kênh và số người |
| Cài đặt | Chất lượng, âm lượng, độ nhạy camera, ngôn ngữ, giảm chuyển động |
| Lớp phủ trạng thái | Đang kết nối lại, đã đăng nhập ở nơi khác, bảo trì |

## 9. Tải và cache

```
Bước 0  HTML + CSS tối thiểu + logo                           (tức thì)
Bước 1  JS của app; song song: kiểm tra phiên đăng nhập,
        gọi bootstrap, mở kết nối realtime
Bước 2  Ngoại cảnh mức thấp + avatar của mình  → VÀO ĐƯỢC THẾ GIỚI
Bước 3  Tải ngầm theo khoảng cách: zone gần, phần avatar người khác,
        texture nét hơn, âm thanh
```

- Màn hình đăng nhập và chọn avatar chính là thời gian tải: asset bước 2 bắt đầu tải ngay từ bước 0.
- Mọi asset có hash trong tên file → cache vĩnh viễn ở CDN và trình duyệt.
- V1: Service Worker (cache-first cho asset có hash) để lần vào hằng ngày gần như tức thì; PWA cài lên màn hình chính.
- Greybox của zone hiển thị ngay, GLB đẹp thay vào khi tải xong.

## 10. Thiết bị hỗ trợ

| Nền tảng | Tối thiểu | Ghi chú |
|---|---|---|
| iOS Safari / webview trên iOS | iOS 16.4+ | Giữ ngân sách texture chặt; xử lý mất WebGL context |
| Android Chrome / webview | Chrome 110+, máy ~2021 trở lên | Mặc định mức Low/Medium |
| Desktop | Chrome, Edge, Firefox, Safari bản gần đây | Mặc định Medium/High |
| Trình duyệt nhúng (Zalo, Messenger, Facebook) | Kiểm thử riêng | Cần WebGL2 + WebSocket; âm thanh chỉ bật sau thao tác chạm đầu tiên; có nút "Mở bằng trình duyệt" dự phòng |

## 11. Khả năng tự phục hồi

| Tình huống | Cách xử lý |
|---|---|
| Mất kết nối realtime | Lớp phủ "đang kết nối lại", tự thử lại với độ trễ tăng dần; làm mới token trước khi vào lại; thế giới vẫn hiển thị |
| Mất WebGL context | Bắt sự kiện, dựng lại renderer và tài nguyên; quá 2 lần thì hạ mức chất lượng |
| Tab bị ẩn | Dừng render, báo server trạng thái AFK, giữ kết nối |
| Đăng nhập ở tab/thiết bị khác | Server đóng phiên cũ kèm mã lỗi; hiện thông báo và nút "vào lại ở đây" |
| Lỗi JS không lường trước | Error boundary: báo lỗi về Sentry, nút tải lại |
| Asset tải lỗi | Thử lại; nếu vẫn lỗi thì giữ greybox của zone đó |

## 12. Trợ năng và cài đặt

- Cỡ chữ HUD chỉnh được; mọi chỉ dẫn mục tiêu dùng cả màu lẫn hình dạng/biểu tượng.
- Tuỳ chọn giảm chuyển động (tắt rung camera, giảm hiệu ứng).
- Toàn bộ thao tác chính làm được bằng bàn phím trên desktop.
- Tắt riêng nhạc nền, hiệu ứng, bong bóng chat.

## 13. Công cụ dev (chỉ có ở bản dev)

- Lớp phủ: FPS, draw call, tam giác, bộ nhớ, ping, băng thông.
- Camera bay tự do; hiện đa giác khu vực và POI; bấm để lấy toạ độ; xuất POI ra JSON.
- **Sinh bot giả ngay trên client** (50–200 avatar đi lang thang) để đo hiệu năng đám đông mà không cần server.
- Giả lập mạng chậm/mất gói cho phần nội suy.
- Tham số URL: `?quality=low|medium|high|auto`, `?spawn=poi.id`, `?bots=50` (avatar giả đi lang thang), `?enter` (bỏ qua nút "Vào campus"). Bảng Debug mở bằng nút ở góc phải.
