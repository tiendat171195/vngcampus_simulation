import './privacy.css';

/**
 * The privacy notice people agree to before their first visit (docs/09 §8). Its version is
 * PRIVACY_NOTICE_VERSION in @campus/shared: change both together, and raising the version asks
 * everyone to agree again.
 */
export default function PrivacyPage() {
  return (
    <main className="privacy">
      <p className="privacy-kicker">VNG Campus Online</p>
      <h1>Thông báo quyền riêng tư</h1>
      <p className="privacy-meta">Phiên bản 1 · ngày 13/11/2026</p>

      <p>
        VNG Campus Online là campus ảo để đồng nghiệp gặp nhau và cùng làm nhiệm vụ. Trang này nói
        rõ chúng tôi giữ dữ liệu gì về bạn, để làm gì và giữ bao lâu.
      </p>

      <h2>Chúng tôi lưu gì</h2>
      <ul>
        <li>Tên hiển thị bạn chọn, hoặc tên lấy từ tài khoản công ty khi bạn đăng nhập bằng nó.</li>
        <li>Email công ty — chỉ khi bạn đăng nhập bằng tài khoản công ty.</li>
        <li>Cấu hình avatar, phòng ban (nếu bạn điền), điểm, cấp độ và tiến độ nhiệm vụ.</li>
        <li>Phiên đăng nhập: thời điểm và loại trình duyệt, để bạn không phải đăng nhập lại.</li>
      </ul>

      <h2>Chúng tôi không lưu gì</h2>
      <ul>
        <li>
          <strong>Nội dung trò chuyện không được lưu.</strong> Tin nhắn chỉ đi tới những người đang
          đứng gần bạn rồi biến mất; nếu có người báo cáo vi phạm, đoạn trò chuyện liên quan mới
          được giữ lại để xử lý.
        </li>
        <li>
          Không có báo cáo theo từng người về việc bạn online lúc nào, bao lâu, đi đâu. Số liệu sử
          dụng chỉ ở dạng tổng hợp.
        </li>
        <li>Vị trí của bạn trong campus chỉ dùng trong lúc chơi để người khác thấy bạn.</li>
      </ul>

      <h2>Để làm gì</h2>
      <p>
        Để bạn vào được campus, người khác nhận ra bạn, và để tính nhiệm vụ, phần thưởng, bảng xếp
        hạng. Dữ liệu không dùng để đánh giá công việc và không chia sẻ cho bên ngoài.
      </p>

      <h2>Giữ bao lâu</h2>
      <ul>
        <li>Hồ sơ và tiến độ: tới khi bạn yêu cầu xoá hoặc tài khoản bị vô hiệu.</li>
        <li>Tài khoản khách không hoạt động: 30 ngày.</li>
        <li>Báo cáo vi phạm kèm đoạn trò chuyện liên quan: 180 ngày.</li>
        <li>Nhật ký hệ thống: 30 ngày.</li>
      </ul>

      <h2>Quyền của bạn</h2>
      <ul>
        <li>Xem và sửa hồ sơ của mình; ẩn mình khỏi danh sách người đang online.</li>
        <li>Yêu cầu xoá tài khoản cùng toàn bộ dữ liệu, bằng cách liên hệ quản trị viên campus.</li>
        <li>Rút lại sự đồng ý bất cứ lúc nào — khi đó bạn sẽ không vào campus được nữa.</li>
      </ul>

      <p className="privacy-meta">
        Khung pháp lý: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.
      </p>
      <p>
        <a href="/">← Về campus</a>
      </p>
    </main>
  );
}
