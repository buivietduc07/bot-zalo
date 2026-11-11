# Zalo Personal Bot (Node.js)

Bot dùng thư viện **zca-js không chính thức**. Tài khoản có thể bị hạn chế. Chỉ dùng tài khoản và nhóm bạn được phép quản lý. Không đăng cookie, QR hay dữ liệu phiên lên GitHub.

## Windows 11
1. Cài Node.js 22 LTS (hoặc Node.js 20+).
2. Giải nén, mở CMD trong thư mục `zalo-personal-bot`.
3. `copy .env.example .env`
4. `npm install`
5. `npm run check`
6. `npm start`
7. Quét mã QR bằng ứng dụng Zalo của chính bạn. Nếu phiên bản thư viện không hiện QR trong terminal, xem hướng dẫn loginQR tại https://zca-js.tdung.com/vi/.

## Cấu hình
- `ADMIN_IDS`: ID người dùng được phép `/warn`, `/kick`, cách nhau bằng dấu phẩy. Dùng `/id` để xem ID trong nhóm.
- `ALLOWED_GROUP_IDS`: để trống cho tất cả nhóm, hoặc nhập danh sách ID nhóm.
- `ENABLE_KICK=false`: mặc định không xóa người khỏi nhóm.
- `AUTO_REPLY`, `WELCOME`: bật/tắt tự động trả lời và chào mừng.
- `COOLDOWN_MS`: giới hạn trả lời liên tiếp, mặc định 1500ms.

## Lệnh
`/help`, `/menu`, `/ping`, `/id`, `/info`, `/admins`, `/warn <ID>`, `/kick <ID>`, `/image <tên ảnh>`, `/file <tên file>`.

Đặt file ảnh và tài liệu trong thư mục `media/` (tối đa 15 MB theo cấu hình ví dụ). `/warn` lưu bộ đếm trong RAM, reset khi khởi động lại.

## Lưu ý tương thích
Đây là source khởi đầu, chưa kiểm thử với tài khoản Zalo thật. `zca-js` là API không chính thức; chữ ký `removeUserFromGroup`, `sendMessage` attachments và định dạng group event có thể thay đổi theo phiên bản. Nếu lệnh `/kick`, `/image`, `/file` lỗi, xem thông báo CMD và đối chiếu tài liệu phiên bản đã cài. `npm install` tạo lockfile để cố định phiên bản về sau.

Không mở Zalo Web đồng thời với bot vì có thể khiến listener bị ngắt. Tắt bot bằng Ctrl+C. Bot chạy trên máy nên tắt PC sẽ dừng.
