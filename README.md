# Fireboy & Watergirl 1–4 — Native HTML5 Canvas & WebRTC Edition

Phiên bản web thuần **HTML5 Canvas** tái hiện trọn vẹn cả **4 phần đầu tiên** của dòng game **Fireboy & Watergirl** với **155 màn chơi** (mở khóa sẵn toàn bộ), sử dụng trực tiếp 100% tài nguyên đồ họa và âm thanh trích xuất từ file `.swf` gốc mà **không cần Flash Player hay trình giả lập Ruffle**, hỗ trợ thêm **tay cầm điện thoại qua WebRTC**.

---

## 1. Tổng quan nội dung & 4 ngôi đền

| Phần | Tên đền | Số màn chơi | Cơ chế đặc trưng |
| :---: | :--- | :---: | :--- |
| 1 | **Forest Temple** | 32 | Hồ lửa/nước/bùn độc, nút bấm sàn, cần gạt, cầu trượt, cầu xoay, ròng rọc, bệ treo đung đưa, bập bênh (`Roman`), quạt gió, hộp đẩy, bi lăn |
| 2 | **Light Temple** | 41 | Nguồn phát tia sáng (`LightBeamer`), dò tia phản xạ qua gương xoay (`RotMirror`), gương quay liên tục (`InfiniteMirror`), gương trượt (`MirrorSlider`), gương đẩy (`MovingMirror`), cảm biến ánh sáng (`LightPusher`), chế độ bóng tối (`dark`) |
| 3 | **Ice Temple** | 41 | Mặt băng (`i`, `i1`, `i2`) & khối băng (`IceBlock`) tạo khác biệt ma sát cho Fireboy/Watergirl, nút bấm hẹn giờ (`TimedPusher`), kết hợp cơ chế ánh sáng & bóng tối |
| 4 | **Crystal Temple** | 41 | Hệ thống cổng dịch chuyển hai chiều (`PortalPair`) truyền nhân vật, hộp, bóng và tia sáng kèm xoay hướng vận tốc, kết hợp cơ chế ánh sáng & mặt băng |

> Tất cả 155 màn đều được mở khóa mặc định ở trạng thái sẵn sàng chơi (`stat = 0`), đồng thời vẫn tính và lưu xếp hạng (`A / B / C` hoặc `F`) và kỷ lục thời gian (`parTime`) riêng cho từng đền vào `localStorage`.

---

## 2. Ngôn ngữ lập trình

- **JavaScript (ES6 Modules — `type="module"`)**: Toàn bộ engine game phía client (vòng lặp game, vật lý, raycasting ánh sáng, renderer Canvas 2D, âm thanh, nhập liệu, mạng WebRTC), máy chủ HTTP cục bộ Node.js (`server.js`), và script kiểm thử tự động (`tools/verify_engine.mjs`).
- **HTML5**: Giao diện sân khấu game chính (`index.html`) và giao diện tay cầm cảm ứng trên điện thoại (`controller.html`).
- **CSS3**: Bố cục sân khấu tỉ lệ `4:3` căn giữa không thanh công cụ thừa (`css/style.css`) và giao diện tay cầm cảm ứng hỗ trợ kéo/đổi kích thước nút.
- **Python 3**: Bộ công cụ tiền xử lý & trích xuất dữ liệu nhị phân SWF (`DefineShape`, `DefineSprite`, `DefineButton2`, `SymbolClass`), mã ActionScript 3 (`Game.as`, `level.as`) và dữ liệu JSON (`Crystal Temple/binaryData/265_level_JsonData.bin`) sang các module `js/*_gamedata.js` (`tools/extract_forest_temple.py`, `tools/extract_all_temples.py`).
- **ActionScript 3 (tham chiếu gốc)**: Mã nguồn decompiled trong `*/scripts/Game.as`, `level.as`, `ContactListener.as` làm chuẩn tham chiếu chính xác cho vật lý Box2D, tọa độ node bản đồ và âm thanh/hiệu ứng.

---

## 3. Công nghệ & Thư viện

| Thành phần | Công nghệ / Thư viện | Vai trò |
| :--- | :--- | :--- |
| **Đồ họa & Kết xuất** | HTML5 Canvas 2D + Offscreen Canvas | Sân khấu `640×480` scale mượt; cache địa hình tĩnh từng màn bằng `MaskBox` + `texture1` + đổ bóng |
| **Kết nối tay cầm** | **WebRTC DataChannel** qua **PeerJS 1.5.1** (`unpkg.com/peerjs`) | Truyền tín hiệu phím P1/P2 và lệnh `pause`/`retry` P2P trực tiếp từ điện thoại về trình duyệt host với độ trễ thấp |
| **Ghép nối nhanh** | **QRCode.js 1.0.0** (`cdnjs.cloudflare.com`) | Sinh mã QR chứa URL `?host=<peerId>` để điện thoại quét và mở ngay `controller.html` |
| **Âm thanh** | HTML5 Audio (`SoundManager` tự viết) | Phát nhạc nền theo chế độ màn chơi (`Menu_Sound`, `Adv_Sound`, `Speed_Sound`), sound pool cho SFX chồng âm và duck âm lượng khi tạm dừng |
| **Lưu trữ tiến độ** | Browser `localStorage` | Lưu tiến độ từng đền (`FBCookie_<temple>Temple_v1`), trạng thái tắt tiếng (`fwg_muted`), và bố cục nút tay cầm trên điện thoại |
| **Local Server** | **Node.js built-in (`http`, `fs`, `path`)** | Static HTTP server không phụ thuộc package npm (`server.js`, cổng mặc định `3000`) |

---

## 4. Kiến trúc UI & Đồ họa (`js/renderer.js`, `js/assets.js`)

- **Không dùng menu ngoài**: `index.html` giữ sạch toàn bộ khung nhìn `4:3` theo đúng phong cách game Flash gốc, chỉ đặt một widget `🎮 Tay cầm Điện thoại (WebRTC)` thu gọn ở góc trên bên trái màn hình.
- **Tích hợp 4 đền ngay trong Canvas**:
  - Màn hình Intro hiển thị thanh chọn 4 đền (`1. Forest`, `2. Light`, `3. Ice`, `4. Crystal`) phía trên cùng (bấm chuột hoặc phím `1–4`), đồng thời hỗ trợ cả các nút chuyển đền có sẵn trên menu SWF của các phần sau.
  - Vùng bấm trên Intro (`INTRO_BUTTONS_BY_TEMPLE`) căn khớp từng tọa độ `IntroMenu.Buttons` của mỗi đền, tự động bù lệch biên ngang cho `IntroMenu` của Light (`-320`) và Crystal (`-423`).
- **Kết xuất tách lớp sạch trên Bản đồ & Màn chơi**:
  - Bản đồ đền (`renderTempleMap`) không vẽ đè ảnh composite gộp `MainMenu/1.png` mà ghép từng lớp nguyên bản từ bảng `TEMPLE_MAP_CONFIG`: nền bản đồ → đường nối `Adjacencies` & `Golden_road` → đế socket → hình vector viên ngọc (`outline + fill`) đổi màu theo hạng → hào quang `Glower` 40 frame khi hover → đom đóm 69 frame (`flies`).
  - Các thành phần HUD và bảng thông báo (`_drawTopWatch`, `_drawBottomPauseTab`, `_drawOverlayPanel` cho `Pause`, `Game Over`, `Recuento`) dùng trực tiếp khung đồng hồ vector sạch (`Watch.children[0]`) và tấm bảng gỗ/đá gốc (`PauseMenu.children[1]`) kèm hiệu ứng nảy lò xo (`spring bounce`).
  - Hiệu ứng chuyển màn / cơ chế: nút sàn `ButtonBox` lún xuống có `clip()`, cổng `PortalPair` dùng 53-frame `PortalSide` + 40-frame `PortalCenter` + `PoartalBase`, chế độ `dark` khoét vùng sáng quanh hai nhân vật và các nguồn sáng.
- **Tối ưu chuyển đền mượt**: `assets.js` tách `preloadTempleMenuAssets()` (chỉ nạp ảnh nhẹ của màn Intro/Map) và `preloadTempleGameplayAssets()` (chỉ nạp sprite gameplay khi bắt đầu vào màn), có cache `Set` theo từng đền nên chuyển qua lại giữa 4 phần không gây khựng khung hình.
- **Tay cầm điện thoại (`controller.html`)**: Cho phép người chơi quét QR để nhận slot 🔥 Fireboy hoặc 💧 Watergirl, nhấn nút cảm ứng trái/phải/nhảy, gửi `Pause` / `Retry`, và vào chế độ **⚙️ Bố cục** để kéo thả vị trí + kéo thanh chỉnh kích thước từng nút.

---

## 5. Logic Game & Engine Vật lý (`js/physics.js`, `js/main.js`)

- **Game loop Fixed-Timestep + Render Interpolation**:
  - Logic chạy ở nhịp cố định **25 FPS** (`stepIntervalMs = 1000 / 25`), bước tích phân vật lý dùng hằng số Box2D gốc (`BOX2D_TIMESTEP = 1/26`, `BOX2D_GRAVITY = 26`, chia **6 sub-steps/tick**).
  - Kết xuất Canvas sử dụng giá trị nội suy `alpha = accumulator / stepIntervalMs` giữa trạng thái `prev` và hiện tại để đạt chuyển động mượt **60–144 FPS**.
- **Hệ thống va chạm đa hình**:
  - ` _buildGroundAndDiamonds()` gộp các ô đất ngang liên tiếp (`cell === 1` hoặc `'i'`) trên cùng một hàng thành một AABB rộng nhằm triệt tiêu hiện tượng khựng mép gạch khi chạy nhanh.
  - Nhân vật (`pers1`, `pers2`, `CHAR_MASS = 0.794`) va chạm bằng tổ hợp 3 hình tròn (chân, thắt lưng, đầu) giúp leo/xuống dốc tam giác mượt mà kèm `coyoteTicks` và tính tiếp tuyến mặt phẳng dốc.
  - Cầu xoay (`rotPlatforms`) và bập bênh (`romans`) sử dụng va chạm **OBB (Oriented Bounding Box)**; cầu trượt/ròng rọc/bệ treo tự động mang theo nhân vật và hộp khi di chuyển (`_carryOnPlatform`).
- **Xử lý cơ chế riêng của Phase 3**:
  - **Ánh sáng (`_updateMirrorsAndLight`)**: Dò tia tối đa 10 lần phản xạ (ray-AABB, ray-triangle, ray-segment, ray-circle) qua tường, hộp, nhân vật, các loại gương và cổng dịch chuyển để kích hoạt `lightPushers`.
  - **Băng (`onIce`)**: Fireboy trên băng đạt vận tốc tối đa `12`, ma sát hãm thấp (trượt xa), nhảy thấp `vy = -3`; Watergirl trên băng đi chậm bám nền (`maxVx = 2`, `vy = -3`).
  - **Nút hẹn giờ (`timedPushers`)**: Giữ trạng thái kích hoạt trong thời gian `delay` sau khi rời nút.
  - **Cổng dịch chuyển (`_updatePortals`)**: Dịch chuyển nhân vật, hộp, bóng và tia sáng giữa hai đầu cổng kèm xoay vector vận tốc theo góc `ori2 - ori1` và thời gian hồi `portalCooldown = 0.55s`.

---

## 6. Cấu trúc thư mục dự án

```text
fireboy-watergirl/
├── index.html                  # Trang chính chứa Canvas 640x480 & WebRTC QR Lobby
├── controller.html             # Giao diện tay cầm cảm ứng cho điện thoại
├── package.json                # Cấu hình scripts (`npm start`, `npm run extract`)
├── server.js                   # Static HTTP server Node.js không phụ thuộc ngoài
├── css/
│   └── style.css               # Bố cục toàn màn hình 4:3 & widget QR Lobby
├── js/
│   ├── main.js                 # Game controller, state machine (intro/map/level), input & loop
│   ├── temples.js              # Registry tổng hợp 4 đền (forest, light, ice, crystal)
│   ├── assets.js               # Nạp ảnh, render sprite/SVG theo CID & symbol, cache địa hình
│   ├── sound.js                # SoundManager phát nhạc nền & hiệu ứng âm thanh đa đền
│   ├── input.js                # Hợp nhất input bàn phím & tay cầm WebRTC
│   ├── network.js              # HostNetworkManager (PeerJS host + QR code generator)
│   ├── physics.js              # ForestLevelWorld: vật lý, va chạm, cơ chế 4 đền
│   ├── renderer.js             # ForestRenderer: vẽ Intro, Map 4 đền, Level, Dark mode, UI
│   ├── forest_gamedata.js      # Dữ liệu trích xuất Forest Temple (32 màn)
│   ├── light_gamedata.js       # Dữ liệu trích xuất Light Temple (41 màn)
│   ├── ice_gamedata.js         # Dữ liệu trích xuất Ice Temple (41 màn)
│   └── crystal_gamedata.js     # Dữ liệu trích xuất Crystal Temple (41 màn)
├── tools/
│   ├── extract_forest_temple.py # Script trích xuất SWF cho Forest Temple
│   ├── extract_all_temples.py   # Script trích xuất SWF + JSON cho Light, Ice, Crystal
│   └── verify_engine.mjs        # Script kiểm thử tự động toàn bộ 155 màn chơi
├── Forest Temple/              # Tài nguyên SWF gốc trích xuất phần 1 (sprites, shapes, sounds...)
├── Light Temple/               # Tài nguyên SWF gốc trích xuất phần 2
├── Ice Temple/                 # Tài nguyên SWF gốc trích xuất phần 3
└── Crystal Temple/             # Tài nguyên SWF gốc trích xuất phần 4 (kèm level JSON)
```

---

## 7. Hướng dẫn chạy & Điều khiển

### Chạy cục bộ
Yêu cầu cài đặt **Node.js** (không cần `npm install` thêm thư viện):

```bash
cd "a:\Game Project\fireboy-watergirl"
npm start
# hoặc: node server.js
```

Mở trình duyệt tại `http://localhost:3000`. Nếu muốn dùng điện thoại làm tay cầm, bấm **➕ Hiện mã QR** ở góc trên bên trái (hoặc mở liên kết tay cầm từ cùng mạng LAN / server public).

### Phím điều khiển mặc định
- **Fireboy (P1)**: Phím mũi tên `←` `↑` `→`
- **Watergirl (P2)**: `A` `W` `D`
- **Màn hình Intro**: Phím `1` `2` `3` `4` để chuyển nhanh giữa Forest / Light / Ice / Crystal Temple
- **Trong màn chơi**: `P` hoặc `Esc` để Tạm dừng, `R` để Chơi lại nhanh, `Enter`/`Space` để Tiếp tục ở bảng tổng kết / Game Over

### Kiểm thử & Trích xuất lại dữ liệu (tuỳ chọn)
- Kiểm tra toàn bộ 155 màn chơi bằng engine vật lý:
  ```bash
  node tools/verify_engine.mjs
  ```
- Trích xuất lại file `*_gamedata.js` (yêu cầu Python 3):
  ```bash
  python tools/extract_forest_temple.py
  python tools/extract_all_temples.py
  ```
