// Unified Keyboard & WebRTC Mobile Controller Input Manager for Fireboy & Watergirl

export const DEFAULT_CONTROLS = {
    1: {
        name: 'Fireboy',
        label: 'Phím Mũi tên (← ↑ →)',
        up: ['ArrowUp'],
        left: ['ArrowLeft'],
        right: ['ArrowRight']
    },
    2: {
        name: 'Watergirl',
        label: 'Phím W / A / D',
        up: ['KeyW'],
        left: ['KeyA'],
        right: ['KeyD']
    }
};

class InputManager {
    constructor() {
        this.keysDown = new Set();
        this.justPressed = new Set();
        this.remoteState = {
            1: { up: false, left: false, right: false },
            2: { up: false, left: false, right: false }
        };
        // Optional solo dual-control mode (allowing 1 keyboard key set to move both characters if toggled)
        this.syncBothChars = false;

        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }
            if (!this.keysDown.has(e.code)) {
                this.justPressed.add(e.code);
            }
            this.keysDown.add(e.code);
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keysDown.delete(e.code);
        });

        window.addEventListener('blur', () => {
            this.keysDown.clear();
            this.justPressed.clear();
        });
    }

    consumeJustPressed(code) {
        if (this.justPressed.has(code)) {
            this.justPressed.delete(code);
            return true;
        }
        return false;
    }

    clearJustPressed() {
        this.justPressed.clear();
    }

    setRemoteAction(slotNum, action, isPressed) {
        const s = this.remoteState[slotNum];
        if (!s || !(action in s)) return;
        s[action] = Boolean(isPressed);
    }

    clearRemoteSlot(slotNum) {
        const s = this.remoteState[slotNum];
        if (!s) return;
        s.up = false;
        s.left = false;
        s.right = false;
    }

    isDown(slotNum, action) {
        if (this.syncBothChars) {
            return this._isSlotDown(1, action) || this._isSlotDown(2, action);
        }
        return this._isSlotDown(slotNum, action);
    }

    _isSlotDown(slotNum, action) {
        const remote = this.remoteState[slotNum];
        if (remote && remote[action]) return true;

        const map = DEFAULT_CONTROLS[slotNum];
        if (!map || !map[action]) return false;
        for (const code of map[action]) {
            if (this.keysDown.has(code)) return true;
        }
        return false;
    }
}

export const inputManager = new InputManager();
