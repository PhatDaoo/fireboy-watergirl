// Host WebRTC (PeerJS) Manager & QR Lobby for Fireboy & Watergirl Native HTML5

import { inputManager, DEFAULT_CONTROLS } from './input.js';

export class HostNetworkManager {
    constructor(callbacks = {}) {
        this.onSlotsChanged = callbacks.onSlotsChanged || (() => {});
        this.onRemoteCommand = callbacks.onRemoteCommand || (() => {});

        this.peer = null;
        this.hostId = null;
        this.connections = [];
        this.playerMap = {}; // peerId -> 1 (Fireboy) | 2 (Watergirl)
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

        this.peer.on('connection', (conn) => {
            this.handleNewConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.warn('PeerJS Host error:', err);
            if (connectInfoEl) {
                connectInfoEl.innerText = `⚠ Lỗi P2P: ${err.type || 'connection'}`;
            }
        });
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
                    inputManager.clearRemoteSlot(currentSlot);
                    delete this.playerMap[conn.peer];
                }

                this.playerMap[conn.peer] = slotNum;
                conn.send({
                    type: 'requestPlayerResponse',
                    success: true,
                    num: slotNum
                });

                this.broadcastPlayersUpdate();
                this.onSlotsChanged(this.getTakenSlots(), slotNum, true);
            } else if (data.type === 'releasePlayer') {
                const currentSlot = this.playerMap[conn.peer];
                if (currentSlot) {
                    inputManager.clearRemoteSlot(currentSlot);
                    delete this.playerMap[conn.peer];
                    this.broadcastPlayersUpdate();
                    this.onSlotsChanged(this.getTakenSlots(), currentSlot, false);
                }
            } else if (data.type === 'action') {
                const slotNum = this.playerMap[conn.peer];
                if (!slotNum || data.player !== slotNum) return;
                const isPressed = data.state === 'pressed';
                inputManager.setRemoteAction(slotNum, data.action, isPressed);
            } else if (data.type === 'command') {
                this.onRemoteCommand(data.command, this.playerMap[conn.peer]);
            }
        });

        conn.on('close', () => {
            this.cleanupConnection(conn);
        });

        conn.on('error', () => {
            this.cleanupConnection(conn);
        });
    }

    cleanupConnection(conn) {
        const slotNum = this.playerMap[conn.peer];
        if (slotNum) {
            inputManager.clearRemoteSlot(slotNum);
            delete this.playerMap[conn.peer];
            this.broadcastPlayersUpdate();
            this.onSlotsChanged(this.getTakenSlots(), slotNum, false);
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
            const kbLabel = DEFAULT_CONTROLS[i]?.label || '';
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
