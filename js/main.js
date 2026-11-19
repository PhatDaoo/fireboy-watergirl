// Main Game Controller for Fireboy & Watergirl 1-4 (Native HTML5 Canvas & WebRTC Edition)

import { STAGE_WIDTH, STAGE_HEIGHT, FPS } from './forest_gamedata.js';
import { TEMPLES, TEMPLE_ORDER } from './temples.js';
import { setActiveAssets, getActiveData, preloadTempleMenuAssets, preloadTempleGameplayAssets } from './assets.js';
import { soundManager, setSoundFiles } from './sound.js';
import { inputManager } from './input.js';
import { HostNetworkManager } from './network.js';
import { ForestLevelWorld } from './physics.js';
import { ForestRenderer } from './renderer.js';

const INTRO_BUTTONS_BY_TEMPLE = {
    forest: [
        { id: 'play', label: 'PLAY', x: 320, y: 249, w: 145, h: 42 },
        { id: 'instructions', label: 'INSTRUCTIONS', x: 320, y: 320, w: 270, h: 34 },
        { id: 'more', label: 'MORE GAMES', x: 320, y: 362, w: 235, h: 30 },
        { id: 'hiscore', label: 'SUBMIT HISCORE', x: 320, y: 403, w: 280, h: 30 },
        { id: 'credits', label: 'CREDITS', x: 320, y: 445, w: 180, h: 34 }
    ],
    light: [
        { id: 'play', label: 'PLAY', x: 320, y: 259, w: 145, h: 42 },
        { id: 'instructions', label: 'INSTRUCTIONS', x: 320, y: 326, w: 270, h: 34 },
        { id: 'hiscore', label: 'SUBMIT HISCORE', x: 320, y: 361, w: 280, h: 30 },
        { id: 'more', label: 'MORE GAMES', x: 315, y: 393, w: 235, h: 30 },
        { id: 'credits', label: 'CREDITS', x: 320, y: 423, w: 180, h: 30 },
        { id: 'switch_forest', label: 'FOREST TEMPLE', x: 320, y: 458, w: 250, h: 28 }
    ],
    ice: [
        { id: 'play', label: 'PLAY', x: 317, y: 268, w: 145, h: 42 },
        { id: 'more', label: 'PLAY MORE GAMES', x: 304, y: 342, w: 235, h: 30 },
        { id: 'hiscore', label: 'HIGHSORES', x: 316, y: 377, w: 250, h: 30 },
        { id: 'switch_forest', label: 'FOREST TEMPLE', x: 315, y: 423, w: 240, h: 28 },
        { id: 'switch_light', label: 'LIGHT TEMPLE', x: 317, y: 457, w: 240, h: 28 },
        { id: 'credits', label: 'CREDITS', x: 45, y: 468, w: 95, h: 24 }
    ],
    crystal: [
        { id: 'play', label: 'PLAY', x: 315, y: 274, w: 150, h: 42 },
        { id: 'more', label: 'PLAY MORE GAMES', x: 315, y: 330, w: 250, h: 30 },
        { id: 'instructions', label: 'WALKTHROUGH', x: 316, y: 369, w: 220, h: 30 },
        { id: 'switch_ice', label: 'ICE TEMPLE', x: 314, y: 409, w: 220, h: 26 },
        { id: 'switch_light', label: 'LIGHT TEMPLE', x: 316, y: 437, w: 220, h: 26 },
        { id: 'switch_forest', label: 'FOREST TEMPLE', x: 312, y: 466, w: 230, h: 26 },
        { id: 'credits', label: 'CREDITS', x: 38, y: 467, w: 90, h: 24 }
    ]
};

class ForestTempleApp {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.renderer = new ForestRenderer(this.canvas);

        this.activeTemple = 'forest';
        this.screen = 'intro'; // 'intro' | 'map' | 'level'
        this.modal = null;     // null | 'instructions' | 'credits'
        this.overlay = null;   // null | 'pause' | 'gameover' | 'recuento'
        this.overlayOffsetY = 0;
        this.overlayVel = 0;
        this.fadeAlpha = 0;

        this.hoveredIntroBtn = null;
        this.hoveredTempleTab = null;
        this.hoveredNode = null;

        // Fireflies on Temple Map
        this.flies = {
            x: 310,
            y: 452,
            vx: 0,
            vy: 0,
            targetX: 310,
            targetY: 452
        };

        this.currentNode = 1;
        this.currentWorld = null;
        this.lastResult = null;
        this.setActiveTemple('forest', false);

        this.network = new HostNetworkManager({
            onSlotsChanged: () => {},
            onRemoteCommand: (cmd) => {
                if (cmd === 'pause') this.togglePause();
                else if (cmd === 'retry') this.retryCurrentLevel();
            }
        });

        this._initUI();
        this._initCanvasEvents();
        this.network.init();

        // Start 25 FPS authentic Flash game loop via requestAnimationFrame accumulator
        this.lastFrameTime = performance.now();
        this.accumulator = 0;
        this.stepIntervalMs = 1000 / FPS; // 40ms (25 FPS)

        requestAnimationFrame((ts) => this._loop(ts));
    }

    _getStorageKey() {
        return `FBCookie_${this.activeTemple}Temple_v1`;
    }

    setActiveTemple(templeId, playSfx = true) {
        if (!TEMPLES[templeId]) return;
        this.activeTemple = templeId;
        const t = TEMPLES[templeId];
        setActiveAssets(templeId, t.data);
        setSoundFiles(t.data.SOUND_FILES);
        preloadTempleMenuAssets(templeId, t.data, t.folder);
        this.progress = this._loadProgress();
        this.hoveredNode = null;
        if (playSfx) {
            soundManager.play('Over_Sound', 0.6);
            soundManager.playMusic('Menu_Sound');
        }
    }

    _loadProgress() {
        const count = (getActiveData().TEMPLE_NODES || []).length || 32;
        try {
            const raw = localStorage.getItem(this._getStorageKey());
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.stats) && parsed.stats.length === count) {
                    for (let i = 0; i < count; i++) {
                        if (parsed.stats[i] < 0) parsed.stats[i] = 0;
                    }
                    return parsed;
                }
            }
        } catch (e) {}

        const stats = new Array(count).fill(0);
        const times = new Array(count).fill(0);
        const timesString = new Array(count).fill('');
        const isNew = new Array(count).fill(false);
        return { stats, times, timesString, isNew };
    }

    _saveProgress() {
        try {
            localStorage.setItem(this._getStorageKey(), JSON.stringify(this.progress));
        } catch (e) {}
    }

    unlockAllLevels() {
        const count = this.progress.stats.length;
        for (let i = 0; i < count; i++) {
            if (this.progress.stats[i] < 0) {
                this.progress.stats[i] = 0;
                this.progress.isNew[i] = true;
            }
        }
        this._saveProgress();
        soundManager.play('Diamond_Sound', 0.75);
    }

    resetProgress() {
        localStorage.removeItem(this._getStorageKey());
        this.progress = this._loadProgress();
        this._saveProgress();
        if (this.screen === 'level') {
            this.goToMap();
        }
    }

    _initUI() {
        const selectEl = document.getElementById('level-select');
        if (selectEl) {
            selectEl.innerHTML = '';
            const optIntro = document.createElement('option');
            optIntro.value = 'intro';
            optIntro.textContent = '🏛️ Màn hình Chính (Intro)';
            selectEl.appendChild(optIntro);

            const optMap = document.createElement('option');
            optMap.value = 'map';
            optMap.textContent = '🗺️ Bản đồ Đền';
            selectEl.appendChild(optMap);

            for (const node of (getActiveData().TEMPLE_NODES || [])) {
                const opt = document.createElement('option');
                opt.value = String(node.node);
                const badge = node.mode === 'adventure' ? '🔷' : (node.mode === 'puzzle' ? '💚' : '⚡');
                opt.textContent = `${badge} Màn #${node.node} (${node.code} - ${node.mode.toUpperCase()})`;
                selectEl.appendChild(opt);
            }

            selectEl.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'intro') {
                    this.goToIntro();
                } else if (val === 'map') {
                    this.goToMap();
                } else {
                    const nodeNum = Number(val);
                    if (nodeNum >= 1) {
                        this.startLevelByNode(nodeNum);
                    }
                }
                selectEl.blur();
            });
        }

        const btnMap = document.getElementById('btn-goto-map');
        if (btnMap) {
            btnMap.addEventListener('click', () => this.goToMap());
        }

        const btnRetry = document.getElementById('btn-retry');
        if (btnRetry) {
            btnRetry.addEventListener('click', () => {
                if (this.screen === 'level') this.retryCurrentLevel();
            });
        }

        const btnPause = document.getElementById('btn-pause');
        if (btnPause) {
            btnPause.addEventListener('click', () => {
                if (this.screen === 'level') this.togglePause();
            });
        }

        const btnUnlockAll = document.getElementById('btn-unlock-all');
        if (btnUnlockAll) {
            btnUnlockAll.addEventListener('click', () => {
                this.unlockAllLevels();
                if (this.screen === 'intro') this.goToMap();
            });
        }

        const chkSolo = document.getElementById('chk-solo-sync');
        if (chkSolo) {
            chkSolo.addEventListener('change', (e) => {
                inputManager.syncBothChars = Boolean(e.target.checked);
                chkSolo.blur();
            });
        }
    }

    _syncDropdown() {
        const selectEl = document.getElementById('level-select');
        if (!selectEl) return;
        if (this.screen === 'intro') selectEl.value = 'intro';
        else if (this.screen === 'map') selectEl.value = 'map';
        else if (this.screen === 'level') selectEl.value = String(this.currentNode);
    }

    goToIntro() {
        soundManager.stopAllLoops();
        soundManager.setPauseDuck(false);
        soundManager.playMusic('Menu_Sound');
        this.screen = 'intro';
        this.modal = null;
        this.overlay = null;
        this.currentWorld = null;
        this._syncDropdown();
    }

    goToMap() {
        soundManager.stopAllLoops();
        soundManager.setPauseDuck(false);
        soundManager.playMusic('Menu_Sound');
        this.screen = 'map';
        this.modal = null;
        this.overlay = null;
        this.currentWorld = null;
        this._syncDropdown();
    }

    startLevelByNode(nodeNum) {
        const data = getActiveData();
        preloadTempleGameplayAssets(this.activeTemple, data);
        const node = (data.TEMPLE_NODES || []).find((n) => n.node === nodeNum);
        if (!node) return;
        const levelKey = `${node.mode}_${node.levelNum}`;
        const levelData = (data.LEVELS || {})[levelKey];
        if (!levelData) return;

        this.currentNode = nodeNum;
        if (this.progress.stats[nodeNum - 1] < 0) {
            this.progress.stats[nodeNum - 1] = 0;
        }
        this.progress.isNew[nodeNum - 1] = false;
        this._saveProgress();

        soundManager.stopAllLoops();
        soundManager.setPauseDuck(false);
        soundManager.play('Pusher_Sound', 0.65);

        // Music selection from Game.as lines 958-965
        if (node.typeId === 3) {
            soundManager.playMusic('Speed_Sound');
        } else {
            soundManager.playMusic('Adv_Sound');
        }

        this.currentWorld = new ForestLevelWorld(levelKey, levelData);
        this.screen = 'level';
        this.overlay = null;
        this.overlayOffsetY = 0;
        this.overlayVel = 0;
        this.fadeAlpha = 0.85;
        this.lastResult = null;
        this._syncDropdown();
    }

    retryCurrentLevel() {
        if (!this.currentNode) return;
        this.startLevelByNode(this.currentNode);
    }

    togglePause() {
        if (this.screen !== 'level' || !this.currentWorld || this.currentWorld.ended) return;
        if (this.overlay === 'pause') {
            this.overlay = null;
            this.currentWorld.pause = false;
            soundManager.setPauseDuck(false);
        } else if (!this.overlay) {
            this.overlay = 'pause';
            this.overlayOffsetY = -360;
            this.overlayVel = 0;
            this.currentWorld.pause = true;
            soundManager.setPauseDuck(true);
        }
    }

    _onLevelWin() {
        const data = getActiveData();
        const node = (data.TEMPLE_NODES || []).find((n) => n.node === this.currentNode);
        if (!node || !this.currentWorld) return;

        soundManager.stopMusic();
        soundManager.stopAllLoops();
        soundManager.play(node.typeId === 3 ? 'Finish2' : 'Finish1', 0.8);

        const totalSec = Math.floor(this.currentWorld.elapsedMs / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        const timeDisplay = `${mins} : ${secs}`;
        const timeCompact = `${mins}:${secs}`;

        // Rank & Save calculation from Game.as lines 803-863
        let rank = 'C';
        const idx = node.node - 1;

        if (node.typeId === 2) {
            // Puzzle mode: must collect the green diamond for Rank A (stat=3), otherwise F
            if (this.currentWorld.greenCount >= 1) {
                rank = 'A';
                if (this.progress.stats[idx] < 3 || this.progress.times[idx] === 0 || this.progress.times[idx] > totalSec) {
                    this.progress.times[idx] = totalSec;
                    this.progress.timesString[idx] = timeCompact;
                }
                this.progress.stats[idx] = 3;
            } else {
                rank = 'F';
            }
        } else {
            let points = 0;
            if (totalSec <= node.parTime) points += 1;
            if (
                this.currentWorld.blueCount === this.currentWorld.totalBlue &&
                this.currentWorld.redCount === this.currentWorld.totalRed
            ) {
                points += 1;
            }
            const newStat = 1 + points; // 1 = C, 2 = B, 3 = A
            rank = points === 2 ? 'A' : (points === 1 ? 'B' : 'C');

            if (this.progress.stats[idx] <= newStat) {
                if (this.progress.stats[idx] < newStat || this.progress.times[idx] === 0 || this.progress.times[idx] > totalSec) {
                    this.progress.times[idx] = totalSec;
                    this.progress.timesString[idx] = timeCompact;
                }
                this.progress.stats[idx] = newStat;
            }
        }

        // Unlock adjacent nodes in the DAG
        for (const neighborNum of (node.neighbors || node.nextNodes || [])) {
            const nIdx = neighborNum - 1;
            if (this.progress.stats[nIdx] === -1) {
                this.progress.stats[nIdx] = 0;
                this.progress.isNew[nIdx] = true;
            }
        }
        this._saveProgress();

        const parSec = node.parTime || 0;
        const parStr = `${String(Math.floor(parSec / 60)).padStart(2, '0')}:${String(parSec % 60).padStart(2, '0')}`;
        this.lastResult = {
            typeId: node.typeId,
            timeDisplay,
            timeStr: timeCompact,
            parStr,
            blueCount: this.currentWorld.blueCount,
            totalBlue: this.currentWorld.totalBlue,
            redCount: this.currentWorld.redCount,
            totalRed: this.currentWorld.totalRed,
            greenCount: this.currentWorld.greenCount,
            rank
        };
        this.overlay = 'recuento';
        this.overlayOffsetY = -380;
        this.overlayVel = 0;
    }

    _onLevelGameOver() {
        soundManager.stopMusic();
        soundManager.stopAllLoops();
        this.overlay = 'gameover';
        this.overlayOffsetY = -380;
        this.overlayVel = 0;
    }

    _getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: ((clientX - rect.left) / rect.width) * STAGE_WIDTH,
            y: ((clientY - rect.top) / rect.height) * STAGE_HEIGHT
        };
    }

    _initCanvasEvents() {
        this.canvas.addEventListener('mousemove', (e) => {
            const pt = this._getCanvasCoords(e);
            this._handlePointerMove(pt.x, pt.y);
        });

        this.canvas.addEventListener('mousedown', (e) => {
            const pt = this._getCanvasCoords(e);
            this._handlePointerDown(pt.x, pt.y);
        });

        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                const pt = this._getCanvasCoords(e);
                this._handlePointerMove(pt.x, pt.y);
                this._handlePointerDown(pt.x, pt.y);
            }
        }, { passive: true });
    }

    _handlePointerMove(x, y) {
        let pointerCursor = false;

        // Top-right Muter icon
        if (x >= 602 && x <= 638 && y >= 4 && y <= 36) {
            pointerCursor = true;
        }

        if (this.screen === 'intro') {
            this.hoveredTempleTab = null;
            if (this.modal) {
                pointerCursor = true;
                this.hoveredIntroBtn = null;
            } else {
                // Check top 4-Temple selector bar (x: 110..530, y: 10..44)
                if (x >= 110 && x <= 530 && y >= 10 && y <= 44) {
                    const idx = Math.floor((x - 110) / (420 / TEMPLE_ORDER.length));
                    if (idx >= 0 && idx < TEMPLE_ORDER.length) {
                        this.hoveredTempleTab = TEMPLE_ORDER[idx];
                        pointerCursor = true;
                    }
                }
                let found = null;
                const btns = INTRO_BUTTONS_BY_TEMPLE[this.activeTemple] || INTRO_BUTTONS_BY_TEMPLE.forest;
                for (const b of btns) {
                    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2) {
                        found = b;
                        break;
                    }
                }
                if (found && found !== this.hoveredIntroBtn) {
                    soundManager.play('Over_Sound', 0.45);
                }
                this.hoveredIntroBtn = found;
                if (found) pointerCursor = true;
            }
        } else if (this.screen === 'map') {
            const nodes = getActiveData().TEMPLE_NODES || [];
            let foundNode = null;
            for (const node of nodes) {
                if (this.progress.stats[node.node - 1] < 0) continue;
                const nx = node.nodeX ?? node.x;
                const ny = node.nodeY ?? node.y;
                if (nx === undefined || ny === undefined || nx < 0 || nx > 640 || ny < 0 || ny > 480) continue;
                const d = Math.hypot(x - nx, y - ny);
                if (d <= 22) {
                    foundNode = node;
                    break;
                }
            }
            if (foundNode) {
                pointerCursor = true;
                if (this.hoveredNode !== foundNode.node) {
                    this.hoveredNode = foundNode.node;
                    this.flies.targetX = foundNode.nodeX ?? foundNode.x;
                    this.flies.targetY = foundNode.nodeY ?? foundNode.y;
                    soundManager.play('Navis_Sound', 0.45);
                }
            } else {
                this.hoveredNode = null;
            }

            // Bottom-left "MAIN MENU" or Top-left "← TEMPLES" button
            if ((x >= 15 && x <= 190 && y >= 425 && y <= 475) || (x >= 12 && x <= 98 && y >= 12 && y <= 38)) {
                pointerCursor = true;
            }
        } else if (this.screen === 'level') {
            if (!this.overlay && x >= 265 && x <= 375 && y >= 452 && y <= 480) {
                pointerCursor = true;
            } else if (this.overlay) {
                pointerCursor = true;
            }
        }

        this.canvas.style.cursor = pointerCursor ? 'pointer' : 'default';
    }

    _handlePointerDown(x, y) {
        // 1. Check Muter button (top-right: 620, 20)
        if (x >= 602 && x <= 638 && y >= 4 && y <= 36) {
            soundManager.toggleMute();
            return;
        }

        // 2. Intro Screen
        if (this.screen === 'intro') {
            if (this.modal) {
                soundManager.play('Over_Sound', 0.5);
                this.modal = null;
                return;
            }
            if (x >= 110 && x <= 530 && y >= 10 && y <= 44) {
                const idx = Math.floor((x - 110) / (420 / TEMPLE_ORDER.length));
                if (idx >= 0 && idx < TEMPLE_ORDER.length) {
                    this.setActiveTemple(TEMPLE_ORDER[idx]);
                    return;
                }
            }
            const btns = INTRO_BUTTONS_BY_TEMPLE[this.activeTemple] || INTRO_BUTTONS_BY_TEMPLE.forest;
            for (const b of btns) {
                if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2) {
                    soundManager.play('Over_Sound', 0.6);
                    if (b.id === 'play') {
                        this.goToMap();
                    } else if (b.id === 'instructions') {
                        this.modal = 'instructions';
                    } else if (b.id === 'credits') {
                        this.modal = 'credits';
                    } else if (b.id === 'switch_forest') {
                        this.setActiveTemple('forest');
                    } else if (b.id === 'switch_light') {
                        this.setActiveTemple('light');
                    } else if (b.id === 'switch_ice') {
                        this.setActiveTemple('ice');
                    } else if (b.id === 'more' || b.id === 'hiscore') {
                        this.goToMap();
                    }
                    return;
                }
            }
            return;
        }

        // 3. Temple Map Screen
        if (this.screen === 'map') {
            // Check "MAIN MENU" (bottom-left) or "← TEMPLES" (top-left)
            if ((x >= 15 && x <= 190 && y >= 425 && y <= 475) || (x >= 12 && x <= 98 && y >= 12 && y <= 38)) {
                soundManager.play('Over_Sound', 0.6);
                this.goToIntro();
                return;
            }

            const nodes = getActiveData().TEMPLE_NODES || [];
            for (const node of nodes) {
                if (this.progress.stats[node.node - 1] < 0) continue;
                const nx = node.nodeX ?? node.x;
                const ny = node.nodeY ?? node.y;
                if (nx === undefined || ny === undefined || nx < 0 || nx > 640 || ny < 0 || ny > 480) continue;
                const d = Math.hypot(x - nx, y - ny);
                if (d <= 23) {
                    this.startLevelByNode(node.node);
                    return;
                }
            }
            return;
        }

        // 4. Active Level Screen
        if (this.screen === 'level') {
            if (!this.overlay) {
                // Bottom-center PAUSE stone tab
                if (x >= 265 && x <= 375 && y >= 450 && y <= 480) {
                    this.togglePause();
                }
                return;
            }

            if (this.overlay === 'pause') {
                // RETRY LEVEL (around y = 160..200)
                if (Math.abs(x - 320) <= 125 && y >= 158 && y <= 202) {
                    soundManager.play('Over_Sound', 0.6);
                    this.retryCurrentLevel();
                    return;
                }
                // MAIN MENU (around y = 300..338)
                if (Math.abs(x - 320) <= 125 && y >= 298 && y <= 340) {
                    soundManager.play('Over_Sound', 0.6);
                    this.goToMap();
                    return;
                }
                // RESUME GAME (around y = 342..385 or top green gem tab)
                if (Math.abs(x - 320) <= 135 && ((y >= 342 && y <= 385) || (y >= 70 && y <= 125))) {
                    soundManager.play('Over_Sound', 0.6);
                    this.togglePause();
                    return;
                }
            } else if (this.overlay === 'gameover') {
                // RETRY LEVEL is around y = 215..255
                if (Math.abs(x - 320) <= 135 && y >= 210 && y <= 256) {
                    soundManager.play('Over_Sound', 0.6);
                    this.retryCurrentLevel();
                    return;
                }
                // SKIP LEVEL is around y = 258..298
                if (Math.abs(x - 320) <= 135 && y >= 258 && y <= 298) {
                    soundManager.play('Over_Sound', 0.6);
                    const nodes = getActiveData().TEMPLE_NODES || [];
                    const nextNode = this.currentNode < nodes.length ? this.currentNode + 1 : 1;
                    this.startLevelByNode(nextNode);
                    return;
                }
                // MAIN MENU is around y = 300..355
                if (Math.abs(x - 320) <= 135 && y >= 300 && y <= 355) {
                    soundManager.play('Over_Sound', 0.6);
                    this.goToMap();
                    return;
                }
            } else if (this.overlay === 'recuento') {
                // CONTINUE button on RBoard (around y = 315..375)
                if (Math.abs(x - 326) <= 140 && y >= 310 && y <= 380) {
                    soundManager.play('Over_Sound', 0.6);
                    this.goToMap();
                    return;
                }
            }
        }
    }

    _stepFixed() {
        this.renderer.tick();
        if (this.fadeAlpha > 0) {
            this.fadeAlpha = Math.max(0, this.fadeAlpha - 0.12);
        }
        if (this.overlay && Math.abs(this.overlayOffsetY) > 0.2) {
            const acc = -this.overlayOffsetY / (Math.abs(this.overlayOffsetY) > 100 ? 18 : 9);
            this.overlayVel = (this.overlayVel + acc) * (Math.abs(this.overlayOffsetY) > 100 ? 0.78 : 0.6);
            this.overlayOffsetY += this.overlayVel;
            if (Math.abs(this.overlayOffsetY) < 0.5 && Math.abs(this.overlayVel) < 0.5) {
                this.overlayOffsetY = 0;
                this.overlayVel = 0;
            }
        }

        // Keyboard shortcuts: P / Escape -> Pause, R -> Quick Retry, 1-4 -> Switch Temple on Intro
        if (this.screen === 'intro' && !this.modal) {
            for (let i = 0; i < TEMPLE_ORDER.length; i++) {
                if (inputManager.consumeJustPressed(`Digit${i + 1}`)) {
                    this.setActiveTemple(TEMPLE_ORDER[i]);
                }
            }
        }
        if (inputManager.consumeJustPressed('KeyP') || inputManager.consumeJustPressed('Escape')) {
            if (this.screen === 'level') {
                this.togglePause();
            } else if (this.screen === 'map') {
                this.goToIntro();
            } else if (this.screen === 'intro' && this.modal) {
                this.modal = null;
            }
        }
        if (inputManager.consumeJustPressed('KeyR')) {
            if (this.screen === 'level') {
                this.retryCurrentLevel();
            }
        }
        if (inputManager.consumeJustPressed('Enter') || inputManager.consumeJustPressed('Space')) {
            if (this.screen === 'level') {
                if (this.overlay === 'recuento') {
                    this.goToMap();
                } else if (this.overlay === 'gameover') {
                    this.retryCurrentLevel();
                }
            }
        }
        inputManager.clearJustPressed();

        if (this.screen === 'map') {
            // Update fireflies physics (FliesMove in Game.as lines 1073-1081)
            this.flies.vx += (this.flies.targetX - this.flies.x) / 5;
            this.flies.vy += (this.flies.targetY - this.flies.y) / 5;
            this.flies.vx *= 0.7;
            this.flies.vy *= 0.7;
            this.flies.x += this.flies.vx;
            this.flies.y += this.flies.vy;
        } else if (this.screen === 'level' && this.currentWorld) {
            const inputs = {
                p1: {
                    left: inputManager.isDown(1, 'left'),
                    right: inputManager.isDown(1, 'right'),
                    up: inputManager.isDown(1, 'up')
                },
                p2: {
                    left: inputManager.isDown(2, 'left'),
                    right: inputManager.isDown(2, 'right'),
                    up: inputManager.isDown(2, 'up')
                }
            };

            const prevOutcome = this.currentWorld.outcome;
            this.currentWorld.step(inputs);

            if (!prevOutcome && this.currentWorld.outcome) {
                if (this.currentWorld.outcome === 'win') {
                    this._onLevelWin();
                } else if (this.currentWorld.outcome === 'gameover') {
                    this._onLevelGameOver();
                }
            }
        }
    }

    _render(alpha = 1) {
        const muted = soundManager.isMuted();

        if (this.screen === 'intro') {
            this.renderer.renderIntroMenu({
                activeTemple: this.activeTemple,
                hoveredTempleTab: this.hoveredTempleTab,
                hoveredIntroBtn: this.hoveredIntroBtn,
                modal: this.modal,
                muted
            });
        } else if (this.screen === 'map') {
            this.renderer.renderTempleMap({
                progress: this.progress,
                hoveredNode: this.hoveredNode,
                flies: this.flies,
                muted
            });
        } else if (this.screen === 'level' && this.currentWorld) {
            this.renderer.renderLevel(this.currentWorld, {
                overlay: this.overlay,
                overlayOffsetY: this.overlayOffsetY,
                fadeAlpha: this.fadeAlpha,
                lastResult: this.lastResult,
                muted
            }, alpha);
        }
    }

    _loop(timestamp) {
        const delta = Math.min(200, timestamp - this.lastFrameTime);
        this.lastFrameTime = timestamp;
        this.accumulator += delta;

        while (this.accumulator >= this.stepIntervalMs) {
            this._stepFixed();
            this.accumulator -= this.stepIntervalMs;
        }

        const alpha = this.accumulator / this.stepIntervalMs;
        this._render(alpha);
        requestAnimationFrame((ts) => this._loop(ts));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.forestApp = new ForestTempleApp();
});
