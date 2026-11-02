# Sổ Từ

Extension cho Chrome / Edge. Khi đọc, bạn double-click vào chỗ chưa hiểu. Sổ Từ lưu lại chỗ đó kèm câu chứa nó, không làm gián đoạn việc đọc. Cuối buổi, AI giải thích tất cả một lượt. Sau đó bạn ôn lại ngay trong Sổ Từ hoặc xuất sang Anki.

## Cài đặt

1. Mở `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode**.
3. Bấm **Load unpacked**, chọn thư mục `so-tu`.
4. Ghim icon **Từ** lên thanh công cụ.
5. Nếu bạn đọc file trên máy (`file://`): mở **Details** của extension, bật **Allow access to file URLs**.

Khi bạn sửa code: bấm nút reload của extension trong `chrome://extensions`, rồi tải lại các trang đang mở.

## Lưu khi đọc

| Thao tác | Lưu gì |
|---|---|
| Double-click | Một từ |
| Triple-click | Cả đoạn |
| Bôi đen rồi bấm **+ Sổ Từ** | Cụm từ hoặc câu |
| Bôi đen rồi bấm `Alt+Shift+S` | Như trên, bằng bàn phím |
| Bôi đen, chuột phải, **Lưu “…” vào Sổ Từ** | Như trên, dùng được cả trong trình xem PDF |

- Mỗi mục được lưu kèm câu chứa nó, tiêu đề mục gần nhất và tên trang.
- Lưu lại cùng một chỗ trên cùng một trang thì mục đó tăng bộ đếm (×2, ×3…). Đó là dấu hiệu bạn thật sự chưa nhớ.
- Lưu nhầm thì bấm **Hoàn tác** trên thông báo ở góc phải dưới.
- Muốn tạm tắt thì bấm icon, bỏ chọn **Bật trên các trang**.
- Muốn đổi phím tắt thì vào `chrome://extensions/shortcuts`.

## Cho AI giải thích

Bấm icon, chọn **Mở Sổ Từ**. Nếu không chọn mục nào, các nút áp dụng cho mọi mục đang hiển thị.

**Cách 1: không cần API key.**

1. Bấm **Copy prompt**.
2. Dán vào Claude.ai, ChatGPT, Gemini hoặc AI bạn dùng.
3. Copy khối JSON mà AI trả về.
4. Bấm **Dán kết quả** rồi dán vào.

**Cách 2: cài AI trong Cài đặt**, rồi bấm **Giải thích bằng AI**. Extension gửi mỗi lần 12 mục. Có 2 loại:

- **Claude API**: nhập API key và chọn model. Mặc định là Claude Opus 5.5. Sonnet 5.5 và Haiku 5.5 rẻ hơn. Với Opus và Sonnet, nếu Claude từ chối một yêu cầu, API tự chuyển sang model dự phòng (`fallbacks: "default"`).
- **OpenAI-compatible**: dùng được mọi dịch vụ có endpoint `/chat/completions`.
  1. Chọn dịch vụ: OpenCode Go, OpenAI, OpenRouter, Ollama, hoặc **Tự nhập** Base URL (ví dụ `https://api.groq.com/openai/v1`).
  2. Nhập API key. Với Ollama thì để trống.
  3. Bấm **Tải danh sách**, rồi chọn model.
  4. Bấm **Lưu**. Lần đầu dùng một địa chỉ, Chrome sẽ hỏi quyền truy cập địa chỉ đó.

Với OpenCode Go, extension gửi kèm header `x-opencode-session` như tài liệu của OpenCode yêu cầu. Gói Go được thiết kế cho coding agent và có theo dõi lưu lượng bất thường. Dùng gói này để giải thích từ là ngoài mục đích đó, nên bạn tự cân nhắc điều khoản.

Key chỉ lưu trong trình duyệt này (`chrome.storage.local`, không mã hoá) và chỉ được gửi tới dịch vụ bạn chọn.

Trong **Cài đặt**, bạn cũng chọn được ngôn ngữ giải thích (mặc định Tiếng Việt). Bạn có thể thêm vài dòng giới thiệu bản thân để AI giải thích đúng trình độ.

## Ôn lại

**Tab Ôn tập** (hoặc bấm icon, chọn **Ôn tập**) lập lịch ôn theo kiểu Anki (thuật toán SM-2). Mỗi mục đã giải thích là một thẻ.

1. Đọc mặt trước (từ và câu ngữ cảnh), tự nhớ nghĩa.
2. Bấm **Hiện đáp án** hoặc `Space`.
3. Tự chấm: **Quên** `1`, **Khó** `2`, **Nhớ** `3` (hoặc `Space`), **Dễ** `4`. Trên mỗi nút có ghi bao lâu nữa thẻ quay lại.

- Thẻ mới qua 2 bước học (1 phút, 10 phút), rồi chuyển sang ôn theo ngày: 1 ngày, vài ngày, vài tuần… Chọn **Quên** thì thẻ quay lại học từ đầu.
- Mỗi ngày mở tối đa 20 thẻ mới (đổi trong Cài đặt). Thẻ đến hạn ôn luôn hiện đủ. Ngày mới bắt đầu lúc 4 giờ sáng.
- Chấm nhầm thì bấm **Hoàn tác thẻ vừa chấm**.
- Số trên icon: màu xanh là số thẻ cần ôn, màu xám là số mục chưa giải thích (khi không còn thẻ cần ôn).

Cách khác:

- **Tự kiểm tra**: phần giải thích bị làm mờ. Bạn tự nhớ lại nghĩa trước, rồi bấm để xem.
- **Xuất Anki**: tải về một file `.txt`. Trong Anki, chọn File › Import, chọn file đó, note type **Basic**. Thẻ đã có sẵn HTML và tag (`so-tu`, loại mục, ngôn ngữ).
- **Sao lưu**: vào Cài đặt, chọn **Xuất JSON** / **Nhập JSON**. Dữ liệu chỉ nằm trong trình duyệt này, nên hãy sao lưu trước khi gỡ extension.

## Giới hạn

- Trong trình xem PDF có sẵn của Chrome, double-click không lưu được. Hãy bôi đen rồi dùng chuột phải. Cách này không lấy được câu ngữ cảnh.
- Tab đã mở từ trước khi cài hoặc cập nhật extension: double-click chưa chạy cho tới khi tải lại trang. Chuột phải và phím tắt vẫn chạy, vì extension tự nạp phần bắt từ vào trang lúc đó.
- Extension không chạy trên các trang `chrome://`, Chrome Web Store, và những trang tự vẽ chữ bằng canvas (ví dụ Google Docs).
- Double-click trong ô nhập liệu không lưu, để không cản trở việc gõ chữ.

## Phát triển

```bash
node --test test/
```

Thử giao diện mà không cần cài extension: chạy `python -m http.server 8765` trong thư mục `so-tu`. Sau đó mở:

- `http://localhost:8765/test/capture.html`: thử double-click, triple-click, bôi đen.
- `http://localhost:8765/test/notebook.html?seed`: Sổ Từ với dữ liệu mẫu và Claude API giả lập.

| File | Vai trò |
|---|---|
| `lib.js` | Logic chung: tách câu, lưu trữ, prompt, gọi API, xuất Anki |
| `content.js` | Chạy trong mọi trang, bắt double-click và bôi đen |
| `background.js` | Menu chuột phải, phím tắt, số đếm trên icon |
| `popup.*` | Bảng nhỏ khi bấm icon |
| `review.*` | Trang Sổ Từ |
