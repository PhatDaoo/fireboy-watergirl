# Fireboy & Watergirl 1–4 (Ruffle Flash Edition)

Chạy đầy đủ **4 phần Fireboy & Watergirl** bản Flash `.swf` gốc trực tiếp trên trình duyệt thông qua trình giả lập **Ruffle (WebAssembly)** tự host offline, kèm **tay cầm điện thoại WebRTC (PeerJS + QR Code)** và bản vá trực tiếp cho phần 4 (Crystal Temple).

## 4 Phần chơi có sẵn
1. **Forest Temple** (`swf/forest-temple.swf`)
2. **Light Temple** (`swf/light-temple.swf`)
3. **Ice Temple** (`swf/ice-temple.swf`)
4. **Crystal Temple** (`swf/crystal-temple.swf`) — đã vá binary `DoABC` (xem mục bên dưới)

## Công nghệ sử dụng
- **Giả lập Flash**: [Ruffle](https://ruffle.rs/) WebAssembly self-hosted tại `vendor/ruffle/` (chạy 100% offline, giữ nguyên 100% vật lý Box2D, animation, quạt gió, tia sáng, băng trượt, cổng dịch chuyển, âm thanh và lưu tiến trình qua `SharedObject` → `localStorage`).
- **Giao diện Web**: HTML5 / CSS3 / Vanilla ES Modules (`index.html`, `css/style.css`, `js/main.js`) với thanh chuyển nhanh 4 đền, nút tải lại và chế độ toàn màn hình.
- **Tay cầm điện thoại WebRTC**: `controller.html` + `js/network.js` sử dụng PeerJS & QRCode.js, chuyển đổi tín hiệu chạm trên điện thoại thành sự kiện bàn phím (`ArrowLeft/Right/Up` cho P1 Fireboy, `A/D/W` cho P2 Watergirl) gửi trực tiếp vào `<ruffle-player>`.
- **Server nội bộ**: `server.js` (Node.js thuần không cần `node_modules`, hỗ trợ đầy đủ MIME type `.swf`, `.wasm`, `.js`).

## Bản vá phần 4 — Crystal Temple (`tools/patch_crystal_swf.py`)
Bản `.swf` gốc của phần 4 bị lỗi màn hình đen vĩnh viễn khi chạy ngoài domain gốc do:
1. `Game.APISetup()` gọi `SpilGamesServices.connect()` tới `api.configar.org` (đã ngừng hoạt động) mà không đăng ký `IOErrorEvent`/`SecurityErrorEvent`, khiến `CreatePreloader()` không bao giờ được gọi.
2. `Game.ValidateLocation()` kích hoạt độ trễ quảng cáo CPMStar 12 giây khi chạy trên localhost.
3. `Game.CreateTeaser()` phát đoạn intro A10 kéo dài 5 giây trước khi vào menu.

Script Python thuần `tools/patch_crystal_swf.py` giải nén `CWS v11`, sửa trực tiếp AVM2 bytecode trong tag `DoABC`:
- `Game.APISetup()` → khởi tạo `BrandingManager.getInstance()` và gọi thẳng `CreatePreloader(false)`.
- `Game.CreateTeaser()` → gọi thẳng `GameReady()` để vào ngay màn hình tiêu đề.

## Cách chạy
```bash
node server.js
# Mở trình duyệt tại http://localhost:3000
```

## Điều khiển
- **🔥 Fireboy (P1)**: Phím Mũi tên (`←` `↑` `→`) hoặc tay cầm điện thoại P1
- **💧 Watergirl (P2)**: Phím `A` `W` `D` hoặc tay cầm điện thoại P2
