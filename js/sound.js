// Authentic Fireboy & Watergirl: Forest Temple Audio Manager (Original MP3/WAV Assets)

import { SOUND_FILES as DEFAULT_SOUND_FILES } from './forest_gamedata.js';

let activeSoundFiles = DEFAULT_SOUND_FILES;

export function setSoundFiles(soundFiles) {
    activeSoundFiles = soundFiles || DEFAULT_SOUND_FILES;
}

class SoundManager {
    constructor() {
        this.muted = localStorage.getItem('fwg_muted') === 'true';
        this.currentMusic = null;
        this.currentMusicName = null;
        this.musicDuckFactor = 1.0;
        this.baseMusicVolume = 0.45;
        this.audioPool = new Map();
        this.activeLoops = new Map();
        this.unlocked = false;

        const unlock = () => {
            this.unlocked = true;
            if (!this.muted && this.currentMusic && this.currentMusic.paused) {
                this.currentMusic.play().catch(() => {});
            }
        };
        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('keydown', unlock, { passive: true });
    }

    isMuted() {
        return this.muted;
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    setMuted(val) {
        this.muted = Boolean(val);
        localStorage.setItem('fwg_muted', String(this.muted));
        if (this.currentMusic) {
            this.currentMusic.muted = this.muted;
            if (!this.muted && this.currentMusic.paused) {
                this.currentMusic.play().catch(() => {});
            }
        }
        for (const loopAudio of this.activeLoops.values()) {
            loopAudio.muted = this.muted;
        }
    }

    setPauseDuck(isPaused) {
        this.musicDuckFactor = isPaused ? 0.2 : 1.0;
        if (this.currentMusic) {
            this.currentMusic.volume = this.baseMusicVolume * this.musicDuckFactor;
        }
        for (const loopAudio of this.activeLoops.values()) {
            loopAudio.volume = 0.35 * this.musicDuckFactor;
        }
    }

    resolvePath(logicalName) {
        if (!logicalName) return null;
        if (activeSoundFiles[logicalName]) return encodeURI(activeSoundFiles[logicalName]);
        for (const [k, v] of Object.entries(activeSoundFiles)) {
            if (k.toLowerCase().includes(logicalName.toLowerCase())) {
                return encodeURI(v);
            }
        }
        return null;
    }

    play(logicalName, volume = 0.65) {
        if (this.muted) return;
        const src = this.resolvePath(logicalName);
        if (!src) return;

        try {
            let pool = this.audioPool.get(src);
            if (!pool) {
                pool = [];
                this.audioPool.set(src, pool);
            }
            let audio = pool.find((a) => a.paused || a.ended);
            if (!audio) {
                if (pool.length < 6) {
                    audio = new Audio(src);
                    pool.push(audio);
                } else {
                    audio = pool[0];
                }
            }
            audio.muted = this.muted;
            audio.volume = Math.max(0, Math.min(1, volume));
            audio.currentTime = 0;
            audio.play().catch(() => {});
        } catch (e) {}
    }

    playMusic(trackName) {
        this.currentMusicName = trackName;
        const src = this.resolvePath(trackName);
        if (!src) return;

        if (this.currentMusic && this.currentMusic.dataset.track === trackName && this.currentMusic.dataset.src === src) {
            this.currentMusic.muted = this.muted;
            this.currentMusic.volume = this.baseMusicVolume * this.musicDuckFactor;
            if (!this.muted && this.currentMusic.paused) {
                this.currentMusic.play().catch(() => {});
            }
            return;
        }

        this.stopMusic();
        try {
            const audio = new Audio(src);
            audio.dataset.track = trackName;
            audio.dataset.src = src;
            audio.loop = true;
            audio.muted = this.muted;
            audio.volume = this.baseMusicVolume * this.musicDuckFactor;
            this.currentMusic = audio;
            if (!this.muted) {
                audio.play().catch(() => {});
            }
        } catch (e) {}
    }

    stopMusic() {
        if (this.currentMusic) {
            try {
                this.currentMusic.pause();
                this.currentMusic.currentTime = 0;
            } catch (e) {}
            this.currentMusic = null;
        }
    }

    startLoop(loopKey, logicalName, volume = 0.35) {
        if (this.activeLoops.has(loopKey)) return;
        const src = this.resolvePath(logicalName);
        if (!src) return;
        try {
            const audio = new Audio(src);
            audio.loop = true;
            audio.muted = this.muted;
            audio.volume = volume * this.musicDuckFactor;
            this.activeLoops.set(loopKey, audio);
            if (!this.muted) {
                audio.play().catch(() => {});
            }
        } catch (e) {}
    }

    stopLoop(loopKey) {
        const audio = this.activeLoops.get(loopKey);
        if (audio) {
            try {
                audio.pause();
                audio.currentTime = 0;
            } catch (e) {}
            this.activeLoops.delete(loopKey);
        }
    }

    stopAllLoops() {
        for (const k of Array.from(this.activeLoops.keys())) {
            this.stopLoop(k);
        }
    }
}

export const soundManager = new SoundManager();
