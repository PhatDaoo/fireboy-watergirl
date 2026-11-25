// Main Entry Point — Ruffle Flash Loader for Fireboy & Watergirl 1–4

import { HostNetworkManager } from './network.js';

const TEMPLES = {
    forest:  { title: 'Fireboy & Watergirl 1: Forest Temple',  swf: 'swf/forest-temple.swf' },
    light:   { title: 'Fireboy & Watergirl 2: Light Temple',   swf: 'swf/light-temple.swf' },
    ice:     { title: 'Fireboy & Watergirl 3: Ice Temple',     swf: 'swf/ice-temple.swf' },
    crystal: { title: 'Fireboy & Watergirl 4: Crystal Temple', swf: 'swf/crystal-temple.swf' }
};

let currentTempleId = 'forest';
let rufflePlayer = null;
let network = null;

function getInitialTemple() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('temple');
    if (fromUrl && TEMPLES[fromUrl]) return fromUrl;
    const saved = localStorage.getItem('fbwg_temple');
    if (saved && TEMPLES[saved]) return saved;
    return 'forest';
}

function updateActiveTab(templeId) {
    document.querySelectorAll('.temple-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.temple === templeId);
    });
    document.title = TEMPLES[templeId].title;
}

function focusPlayer() {
    if (!rufflePlayer) return;
    try {
        rufflePlayer.focus({ preventScroll: true });
    } catch (_) {}
}

async function loadTemple(templeId, forceReload = false) {
    if (!TEMPLES[templeId]) return;
    if (templeId === currentTempleId && rufflePlayer && !forceReload) {
        focusPlayer();
        return;
    }

    currentTempleId = templeId;
    localStorage.setItem('fbwg_temple', templeId);
    updateActiveTab(templeId);

    const container = document.getElementById('ruffle-container');
    if (!container) return;

    const ruffle = window.RufflePlayer?.newest();
    if (!ruffle) {
        container.innerHTML = '<p style="color:#ff8a80;padding:20px;text-align:center;">Không tải được trình giả lập Ruffle.</p>';
        return;
    }

    if (network) {
        network.releaseSlotKeys(1);
        network.releaseSlotKeys(2);
    }

    container.innerHTML = '';
    const player = ruffle.createPlayer();
    player.style.width = '100%';
    player.style.height = '100%';
    player.tabIndex = 0;
    container.appendChild(player);
    rufflePlayer = player;

    try {
        await player.load({
            url: TEMPLES[templeId].swf,
            autoplay: 'on',
            unmuteOverlay: 'hidden',
            backgroundColor: '#000000',
            letterbox: 'on',
            quality: 'high',
            splashScreen: false,
            warnOnUnsupportedContent: false
        });
        focusPlayer();
    } catch (err) {
        console.error('Failed to load SWF:', TEMPLES[templeId].swf, err);
    }
}

function setupUI() {
    document.querySelectorAll('.temple-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.blur();
            loadTemple(btn.dataset.temple);
        });
    });

    const reloadBtn = document.getElementById('btn-reload');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            reloadBtn.blur();
            loadTemple(currentTempleId, true);
        });
    }

    const fsBtn = document.getElementById('btn-fullscreen');
    const stageWrapper = document.getElementById('stage-wrapper');
    if (fsBtn && stageWrapper) {
        fsBtn.addEventListener('click', () => {
            fsBtn.blur();
            if (!document.fullscreenElement) {
                stageWrapper.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
            focusPlayer();
        });
    }

    // Lobby toggle
    const toggleBtn = document.getElementById('toggle-btn');
    const closeLobbyBtn = document.getElementById('close-lobby-btn');
    const lobby = document.getElementById('lobby');
    if (toggleBtn && lobby) {
        toggleBtn.addEventListener('click', () => {
            toggleBtn.blur();
            lobby.classList.toggle('minimized');
            focusPlayer();
        });
    }
    if (closeLobbyBtn && lobby) {
        closeLobbyBtn.addEventListener('click', () => {
            closeLobbyBtn.blur();
            lobby.classList.add('minimized');
            focusPlayer();
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setupUI();

    network = new HostNetworkManager({
        getTargetElement: () => rufflePlayer || window,
        onRemoteCommand: (cmd) => {
            if (cmd === 'restart') {
                loadTemple(currentTempleId, true);
            }
        }
    });
    // PeerJS/QRCode are deferred; init after window load
    window.addEventListener('load', () => network.init(), { once: true });

    loadTemple(getInitialTemple());
});
