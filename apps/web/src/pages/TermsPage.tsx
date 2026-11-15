import './privacy.css';

/** House rules for the campus (docs/09 §7.2): short, in plain words, linked from the splash. */
export default function TermsPage() {
  return (
    <main className="privacy">
      <p className="privacy-kicker">VNG Campus Online</p>
      <h1>Điều khoản sử dụng</h1>
      <p className="privacy-meta">Phiên bản 1 · ngày 14/11/2026</p>

      <p>
        VNG Campus Online là không gian ảo để đồng nghiệp gặp nhau và cùng làm nhiệm vụ. Khi vào
        campus, bạn đồng ý với vài điều dưới đây.
      </p>

      <h2>Cư xử</h2>
      <ul>
        <li>Tôn trọng đồng nghiệp như ở văn phòng thật: không xúc phạm, quấy rối, phân biệt.</li>
        <li>
          Không spam, quảng cáo, chia sẻ thông tin nội bộ nhạy cảm hay dữ liệu cá nhân của người
          khác.
        </li>
        <li>
          Không mạo danh người khác; tên hiển thị của tài khoản công ty lấy từ hệ thống đăng nhập.
        </li>
        <li>Không gian lận nhiệm vụ, không dùng công cụ tự động, không cố phá hệ thống.</li>
      </ul>

      <h2>Kiểm duyệt</h2>
      <ul>
        <li>
          Ai cũng có thể bấm <b>Báo cáo</b> trên thẻ hồ sơ hoặc dòng chat; kèm theo là vài dòng chat
          người báo cáo đã thấy.
        </li>
        <li>
          Kiểm duyệt viên có thể nhắc nhở, cấm chat có thời hạn hoặc khoá tài khoản. Bạn thấy lý do
          và thời hạn trong game. Mọi quyết định đều được ghi lại.
        </li>
        <li>Trong lúc có sự cố, quản trị viên có thể tạm tắt chat hoặc bật chế độ bảo trì.</li>
      </ul>

      <h2>Điểm và phần thưởng</h2>
      <ul>
        <li>
          Điểm, cấp và huy hiệu chỉ có giá trị trong campus, không quy đổi thành tiền hay quyền lợi
          công việc, và không dùng để đánh giá nhân sự.
        </li>
        <li>Điểm có được do lỗi hoặc gian lận có thể bị thu hồi.</li>
      </ul>

      <h2>Dịch vụ</h2>
      <ul>
        <li>
          Đây là sản phẩm nội bộ đang thử nghiệm: có thể gián đoạn, thay đổi hoặc dừng mà không báo
          trước.
        </li>
        <li>
          Dữ liệu của bạn được xử lý theo <a href="/privacy">thông báo quyền riêng tư</a>. Bạn tự
          xoá được tài khoản trong Hồ sơ.
        </li>
      </ul>

      <p>
        <a href="/">← Về campus</a>
      </p>
    </main>
  );
}
