// Host WebRTC (PeerJS) Manager & Synthetic Keyboard Bridge for Ruffle Flash Player

const KEY_MAP = {
    1: {
        label: 'Phím Mũi tên',
        left:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
        right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        up:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 }
    },
    2: {
        label: 'Phím W/A/D',
        left:  { key: 'a', code: 'KeyA', keyCode: 65 },
        right: { key: 'd', code: 'KeyD', keyCode: 68 },
        up:    { key: 'w', code: 'KeyW', keyCode: 87 }
    }
};

export class HostNetworkManager {
    constructor(callbacks = {}) {
        this.getTargetElement = callbacks.getTargetElement || (() => window);
        this.onRemoteCommand = callbacks.onRemoteCommand || (() => {});

        this.peer = null;
        this.hostId = null;
        this.connections = [];
        this.playerMap = {}; // peerId -> 1 (Fireboy) | 2 (Watergirl)
        this.activeKeys = { 1: new Set(), 2: new Set() };
    }

    init() {
        const connectInfoEl = document.getElementById('connect-info');
        if (typeof window.Peer === 'undefined') {
            if (connectInfoEl) {
                connectInfoEl.innerText = '⚠ Chế độ Offline (Không tải được PeerJS)';
            }
            return;
        }

        try {
            this.peer = new window.Peer();
        } catch (err) {
            if (connectInfoEl) {
                connectInfoEl.innerText = '⚠ Không thể khởi tạo WebRTC';
            }
            return;
        }

        this.peer.on('open', (id) => {
            this.hostId = id;
            let baseUrl = window.location.href.split('?')[0];
            baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
            const controllerUrl = `${baseUrl}/controller.html?host=${encodeURIComponent(id)}`;

            if (connectInfoEl) {
                connectInfoEl.innerHTML = `✅ Quét mã QR hoặc <a href="${controllerUrl}" target="_blank" style="color:#4fc3f7;text-decoration:underline;">mở tab tay cầm</a>`;
            }

            const qrContainer = document.getElementById('qr-container');
            const qrCodeEl = document.getElementById('qrcode');
            if (qrContainer && qrCodeEl && typeof window.QRCode !== 'undefined') {
                qrContainer.style.display = 'flex';
                qrCodeEl.innerHTML = '';
                new window.QRCode(qrCodeEl, {
                    text: controllerUrl,
                    width: 90,
                    height: 90,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: window.QRCode.CorrectLevel.L
                });
            }

            this.updateLobbyUI();
        });

        this.peer.on('connection', (conn) => this.handleNewConnection(conn));

        this.peer.on('error', (err) => {
            console.warn('PeerJS Host error:', err);
            if (connectInfoEl) {
                connectInfoEl.innerText = `⚠ Lỗi P2P: ${err.type || 'connection'}`;
            }
        });
    }

    dispatchKey(slotNum, action, isPressed) {
        const spec = KEY_MAP[slotNum]?.[action];
        if (!spec) return;

        const held = this.activeKeys[slotNum];
        if (isPressed) {
            if (held.has(action)) return;
            held.add(action);
        } else {
            if (!held.has(action)) return;
            held.delete(action);
        }

        const target = this.getTargetElement() || window;
        if (typeof target.focus === 'function' && document.activeElement !== target) {
            try { target.focus({ preventScroll: true }); } catch (_) {}
        }

        const evt = new KeyboardEvent(isPressed ? 'keydown' : 'keyup', {
            key: spec.key,
            code: spec.code,
            keyCode: spec.keyCode,
            which: spec.keyCode,
            bubbles: true,
            cancelable: true,
            composed: true
        });
        target.dispatchEvent(evt);
    }

    releaseSlotKeys(slotNum) {
        const held = this.activeKeys[slotNum];
        if (!held) return;
        for (const action of [...held]) {
            this.dispatchKey(slotNum, action, false);
        }
    }

    getTakenSlots() {
        return Object.values(this.playerMap);
    }

    broadcast(data) {
        for (const conn of this.connections) {
            if (conn && conn.open) {
                conn.send(data);
            }
        }
    }

    broadcastPlayersUpdate() {
        this.broadcast({
            type: 'playersUpdate',
            taken: this.getTakenSlots()
        });
        this.updateLobbyUI();
    }

    handleNewConnection(conn) {
        this.connections.push(conn);

        conn.on('open', () => {
            conn.send({
                type: 'playersUpdate',
                taken: this.getTakenSlots()
            });
        });

        conn.on('data', (data) => {
            if (!data || typeof data !== 'object') return;

            if (data.type === 'requestPlayer') {
                const slotNum = Number(data.num);
                if (slotNum !== 1 && slotNum !== 2) return;

                const taken = this.getTakenSlots();
                const currentSlot = this.playerMap[conn.peer];

                if (taken.includes(slotNum) && currentSlot !== slotNum) {
                    conn.send({
                        type: 'requestPlayerResponse',
                        success: false,
                        message: 'Nhân vật này đã có người chơi!'
                    });
                    return;
                }

                if (currentSlot && currentSlot !== slotNum) {
                    this.releaseSlotKeys(currentSlot);
                    delete this.playerMap[conn.peer];
                }

                this.playerMap[conn.peer] = slotNum;
                conn.send({
                    type: 'requestPlayerResponse',
                    success: true,
                    num: slotNum
                });

                this.broadcastPlayersUpdate();
            } else if (data.type === 'releasePlayer') {
                const currentSlot = this.playerMap[conn.peer];
                if (currentSlot) {
                    this.releaseSlotKeys(currentSlot);
                    delete this.playerMap[conn.peer];
                    this.broadcastPlayersUpdate();
                }
            } else if (data.type === 'action') {
                const slotNum = this.playerMap[conn.peer];
                if (!slotNum || data.player !== slotNum) return;
                this.dispatchKey(slotNum, data.action, data.state === 'pressed');
            } else if (data.type === 'command') {
                this.onRemoteCommand(data.command, this.playerMap[conn.peer]);
            }
        });

        conn.on('close', () => this.cleanupConnection(conn));
        conn.on('error', () => this.cleanupConnection(conn));
    }

    cleanupConnection(conn) {
        const slotNum = this.playerMap[conn.peer];
        if (slotNum) {
            this.releaseSlotKeys(slotNum);
            delete this.playerMap[conn.peer];
            this.broadcastPlayersUpdate();
        }
        this.connections = this.connections.filter((c) => c.peer !== conn.peer);
    }

    updateLobbyUI() {
        const takenSlots = this.getTakenSlots();
        const miniText = [];

        for (let i = 1; i <= 2; i++) {
            const el = document.getElementById(`slot-${i}`);
            if (!el) continue;
            const charName = i === 1 ? '🔥 Fireboy' : '💧 Watergirl';
            const kbLabel = KEY_MAP[i]?.label || '';
            if (takenSlots.includes(i)) {
                el.classList.add('connected');
                el.innerHTML = `<div class="dot"></div> P${i} (${charName}) - ĐÃ KẾT NỐI 📱`;
                miniText.push(i === 1 ? '🔥P1' : '💧P2');
            } else {
                el.classList.remove('connected');
                el.innerHTML = `<div class="dot"></div> P${i} (${charName} - ${kbLabel})`;
            }
        }

        const miniStatus = document.getElementById('mini-status');
        if (miniStatus) {
            if (miniText.length > 0) {
                miniStatus.innerHTML = `🎮 Tay cầm: <span style="color:#69f0ae">${miniText.join(', ')}</span>`;
            } else {
                miniStatus.innerHTML = `📱 Quét QR để kết nối tay cầm`;
            }
        }
    }
}
