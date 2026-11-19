// Authentic SWF Sprite, Shape (SVG), Button & Offscreen Terrain Cache Renderer (Multi-Temple)

import * as FOREST_DATA from './forest_gamedata.js';

let activeTempleId = 'forest';
let activeData = FOREST_DATA;
let SPRITES_BY_CID = FOREST_DATA.SPRITES_BY_CID;
let SPRITE_METAS = FOREST_DATA.SPRITE_METAS;
let BUTTON_METAS = FOREST_DATA.BUTTON_METAS;
let SHAPE_METAS = FOREST_DATA.SHAPE_METAS;
const TILE_SIZE = FOREST_DATA.TILE_SIZE;

const imageCache = new Map();
const levelTerrainCache = new Map();

export function setActiveAssets(templeId, data) {
    activeTempleId = templeId || 'forest';
    activeData = data || FOREST_DATA;
    SPRITES_BY_CID = activeData.SPRITES_BY_CID;
    SPRITE_METAS = activeData.SPRITE_METAS;
    BUTTON_METAS = activeData.BUTTON_METAS;
    SHAPE_METAS = activeData.SHAPE_METAS;
}

export function getActiveData() {
    return activeData;
}

export function getSpriteMeta(symbol) {
    return SPRITE_METAS[symbol] || null;
}

export function getImage(src) {
    if (!src) return null;
    const encoded = encodeURI(src);
    let entry = imageCache.get(encoded);
    if (entry) return entry;

    const img = new Image();
    entry = { img, loaded: false, error: false };
    img.onload = () => {
        entry.loaded = true;
    };
    img.onerror = () => {
        entry.error = true;
    };
    img.src = encoded;
    imageCache.set(encoded, entry);
    return entry;
}

/**
 * Draw a sprite frame by its metadata using exact SWF registration point (meta.ox, meta.oy).
 */
export function drawSpriteMeta(ctx, meta, frameNum = 1, x = 0, y = 0, scaleX = 1, scaleY = 1, rotationDeg = 0, alpha = 1) {
    if (!meta || !meta.folder) return false;
    const total = Math.max(1, meta.frames || 1);
    const f = ((Math.floor(frameNum) - 1) % total + total) % total + 1;
    const src = `${meta.folder}/${f}.png`;
    const entry = getImage(src);
    if (!entry || !entry.loaded) return false;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= Math.max(0, alpha);
    ctx.translate(x, y);
    if (rotationDeg !== 0) {
        ctx.rotate((rotationDeg * Math.PI) / 180);
    }
    if (scaleX !== 1 || scaleY !== 1) {
        ctx.scale(scaleX, scaleY);
    }
    ctx.drawImage(entry.img, meta.ox, meta.oy, meta.w, meta.h);
    ctx.restore();
    return true;
}

export function drawSpriteByCid(ctx, cid, frameNum = 1, x = 0, y = 0, scaleX = 1, scaleY = 1, rotationDeg = 0, alpha = 1) {
    const meta = SPRITES_BY_CID[String(cid)];
    return drawSpriteMeta(ctx, meta, frameNum, x, y, scaleX, scaleY, rotationDeg, alpha);
}

export function drawSpriteBySymbol(ctx, symbol, frameNum = 1, x = 0, y = 0, scaleX = 1, scaleY = 1, rotationDeg = 0, alpha = 1) {
    const meta = SPRITE_METAS[symbol];
    return drawSpriteMeta(ctx, meta, frameNum, x, y, scaleX, scaleY, rotationDeg, alpha);
}

export function drawButtonByCid(ctx, cid, frameNum = 1, x = 0, y = 0, scaleX = 1, scaleY = 1, rotationDeg = 0, alpha = 1) {
    const meta = BUTTON_METAS[String(cid)];
    return drawSpriteMeta(ctx, meta, frameNum, x, y, scaleX, scaleY, rotationDeg, alpha);
}

export function drawShapeByCid(ctx, cid, x = 0, y = 0, scaleX = 1, scaleY = 1, rotationDeg = 0, alpha = 1) {
    const meta = SHAPE_METAS[String(cid)];
    if (!meta || !meta.file) return false;
    const entry = getImage(meta.file);
    if (!entry || !entry.loaded) return false;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= Math.max(0, alpha);
    ctx.translate(x, y);
    if (rotationDeg !== 0) {
        ctx.rotate((rotationDeg * Math.PI) / 180);
    }
    if (scaleX !== 1 || scaleY !== 1) {
        ctx.scale(scaleX, scaleY);
    }
    ctx.drawImage(entry.img, meta.ox, meta.oy, meta.w, meta.h);
    ctx.restore();
    return true;
}

/**
 * Deterministic hash for tile variation (GroundBox1..4 and random 90-deg rotations)
 * matching CreateGround(LevelArray) in level.as.
 */
function tileHash(row, col, salt = 0) {
    let h = (row * 374761393 + col * 668265263 + salt * 1442695041) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build or retrieve the cached offscreen ground canvas for a level, replicating
 * CreateGround(LevelArray) in level.as lines 2486-2975 (GroundMC + GroundMask + texture1 + Glow/DropShadow).
 */
export function getOrBuildLevelTerrain(levelKey, grid) {
    const cacheKey = `${activeTempleId}:${levelKey}`;
    let cached = levelTerrainCache.get(cacheKey);
    if (cached && cached.ready) return cached.canvas;

    // Ensure required tile sprites and texture1 are loaded before baking
    const reqSyms = [
        'GroundBox1', 'GroundBox2', 'GroundBox3', 'GroundBox4', 'GroundBox5',
        'GroundBoxHalf', 'GroundBoxIce1', 'MaskBox', 'MaskBoxHalf', 'MaskBoxMaskTri',
        'MaskBoxIce', 'MaskBoxMaskTriIce', 'texture1'
    ];
    for (const sym of reqSyms) {
        const m = SPRITE_METAS[sym];
        if (m) {
            const e = getImage(`${m.folder}/1.png`);
            if (!e || !e.loaded) return null;
        }
    }

    const rows = grid.length;
    const cols = grid[0].length;
    const pad = 20;
    const width = cols * TILE_SIZE + pad * 2;
    const height = rows * TILE_SIZE + pad * 2;

    // 1. GroundMC layer
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = width;
    groundCanvas.height = height;
    const gCtx = groundCanvas.getContext('2d');
    gCtx.translate(pad, pad);

    // 2. GroundMask layer
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.translate(pad, pad);

    const groundSyms = ['GroundBox4', 'GroundBox3', 'GroundBox1', 'GroundBox3', 'GroundBox2'];
    const triSym = SPRITE_METAS['MaskBoxMaskTri'] ? 'MaskBoxMaskTri' : 'GroundBox5';
    const maskBoxSym = SPRITE_METAS['MaskBox'] ? 'MaskBox' : 'GroundBox1';
    const halfMaskSym = SPRITE_METAS['MaskBoxHalf'] ? 'MaskBoxHalf' : 'GroundBoxHalf';
    const iceBoxSym = SPRITE_METAS['GroundBoxIce1'] ? 'GroundBoxIce1' : (SPRITE_METAS['MaskBoxIce'] ? 'MaskBoxIce' : 'GroundBox5');
    const iceTriSym = SPRITE_METAS['MaskBoxMaskTriIce'] ? 'MaskBoxMaskTriIce' : triSym;
    const iceMaskSym = SPRITE_METAS['MaskBoxIce'] ? 'MaskBoxIce' : maskBoxSym;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = grid[r][c];
            const px = c * TILE_SIZE;
            const py = r * TILE_SIZE;

            if (cell === 1) {
                const pickIdx = Math.floor(tileHash(r, c, 1) * 5);
                const gSym = groundSyms[pickIdx];
                const rot1 = Math.floor(tileHash(r, c, 2) * 4) * 90;
                const rot2 = Math.floor(tileHash(r, c, 3) * 4) * 90;
                drawSpriteBySymbol(gCtx, gSym, 1, px, py, 1, 1, rot1);
                drawSpriteBySymbol(mCtx, maskBoxSym, 1, px, py, 1, 1, rot2);
            } else if (cell === 'i') {
                const pickIdx = Math.floor(tileHash(r, c, 1) * 5);
                drawSpriteBySymbol(gCtx, groundSyms[pickIdx], 1, px, py, 1, 1, 0);
                drawSpriteBySymbol(gCtx, iceBoxSym, 1, px, py, 1, 1, 0, 0.92);
                drawSpriteBySymbol(mCtx, iceMaskSym, 1, px, py, 1, 1, 0);
            } else if (cell === -1) {
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, py, 1, 1, 0);
                drawSpriteBySymbol(mCtx, triSym, 1, px, py, 1, 1, 0);
            } else if (cell === 'i1') {
                drawSpriteBySymbol(gCtx, iceTriSym, 1, px, py, 1, 1, 0);
                drawSpriteBySymbol(mCtx, iceTriSym, 1, px, py, 1, 1, 0);
            } else if (cell === -2) {
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, py, 1, 1, -90);
                drawSpriteBySymbol(mCtx, triSym, 1, px, py, 1, 1, -90);
            } else if (cell === 'i2') {
                drawSpriteBySymbol(gCtx, iceTriSym, 1, px, py, 1, 1, -90);
                drawSpriteBySymbol(mCtx, iceTriSym, 1, px, py, 1, 1, -90);
            } else if (cell === -3) {
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, py, 1, 1, 180);
                drawSpriteBySymbol(mCtx, triSym, 1, px, py, 1, 1, 180);
            } else if (cell === -4) {
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, py, 1, 1, 90);
                drawSpriteBySymbol(mCtx, triSym, 1, px, py, 1, 1, 90);
            } else if (cell === 5 || cell === 6 || cell === 7) {
                const hy = (r + 0.25) * TILE_SIZE;
                const rot = tileHash(r, c, 4) > 0.4 ? 180 : 0;
                drawSpriteBySymbol(gCtx, 'GroundBoxHalf', 1, px, hy, 1, 1, rot);
                drawSpriteBySymbol(mCtx, halfMaskSym, 1, px, hy, 1, 1, 0);
            } else if (cell === 51 || cell === 61 || cell === 71) {
                const hy = (r + 0.25) * TILE_SIZE;
                const ty = (r - 0.25) * TILE_SIZE;
                drawSpriteBySymbol(gCtx, 'GroundBoxHalf', 1, px, hy, 1, 1, 0);
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, ty, 1, 0.5, 0);
                drawSpriteBySymbol(mCtx, halfMaskSym, 1, px, hy, 1, 1, 0);
            } else if (cell === 52 || cell === 62 || cell === 72) {
                const hy = (r + 0.25) * TILE_SIZE;
                const ty = (r - 0.25) * TILE_SIZE;
                drawSpriteBySymbol(gCtx, 'GroundBoxHalf', 1, px, hy, 1, 1, 0);
                drawSpriteBySymbol(gCtx, 'GroundBox5', 1, px, ty, -1, 0.5, 0);
                drawSpriteBySymbol(mCtx, halfMaskSym, 1, px, hy, 1, 1, 0);
            }
        }
    }

    // 3. Apply texture1 masked by maskCanvas
    const texCanvas = document.createElement('canvas');
    texCanvas.width = width;
    texCanvas.height = height;
    const tCtx = texCanvas.getContext('2d');
    tCtx.drawImage(maskCanvas, 0, 0);
    tCtx.globalCompositeOperation = 'source-in';
    tCtx.save();
    tCtx.translate(pad, pad);
    drawSpriteBySymbol(tCtx, 'texture1', 1, 0, 0, 1, 1, 0);
    tCtx.restore();

    // 4. Composite final terrain canvas with Flash's DropShadowFilter
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = height;
    const fCtx = finalCanvas.getContext('2d');

    fCtx.save();
    fCtx.shadowColor = 'rgba(0, 0, 0, 0.72)';
    fCtx.shadowBlur = 4;
    fCtx.shadowOffsetX = 5.6;
    fCtx.shadowOffsetY = 5.6;
    fCtx.drawImage(groundCanvas, 0, 0);
    fCtx.restore();

    fCtx.drawImage(groundCanvas, 0, 0);
    fCtx.drawImage(texCanvas, 0, 0);

    cached = { canvas: finalCanvas, pad, ready: true };
    levelTerrainCache.set(cacheKey, cached);
    return finalCanvas;
}

const preloadedMenuTemples = new Set();
const preloadedGameplayTemples = new Set();

const MENU_PRELOAD_MAP = {
    forest: {
        images: ['Forest Temple/images/499.png'],
        sprites: [502, 637, 622, 599, 577, 611],
        buttons: [],
        shapes: [602, 603, 604, 605, 606, 582, 583, 584, 585, 586, 614, 615, 616, 617, 618]
    },
    light: {
        images: [],
        sprites: [661, 738, 684, 706, 718],
        buttons: [792],
        shapes: [689, 690, 691, 692, 693, 709, 710, 711, 712, 713, 721, 722, 723, 724, 725, 728, 729, 730, 731, 732]
    },
    ice: {
        images: [],
        sprites: [804, 806, 808, 906, 854, 876, 888],
        buttons: [824],
        shapes: [859, 860, 861, 862, 863, 879, 880, 881, 882, 883, 891, 892, 893, 894, 895, 898, 899, 900, 901, 902]
    },
    crystal: {
        images: [],
        sprites: [784, 786, 791, 799, 801, 804, 816, 820, 1269, 1251, 1234, 1265, 1247, 1230],
        buttons: [],
        shapes: [1272, 1273, 1274, 1275, 1276, 1254, 1255, 1256, 1257, 1258, 1239, 1240, 1241, 1242, 1243]
    }
};

export function preloadTempleMenuAssets(templeId = activeTempleId, data = activeData, folder = null) {
    if (preloadedMenuTemples.has(templeId)) return;
    preloadedMenuTemples.add(templeId);

    const tf = folder || data.TEMPLE_FOLDER || 'Forest Temple';
    if (templeId !== 'crystal') {
        getImage(`${tf}/frames/3.png`);
    }

    const menuSyms = ['BackGround', 'IntroMenu', 'Muter', 'Instructions', 'Credits'];
    for (const sym of menuSyms) {
        const m = data.SPRITE_METAS?.[sym];
        if (m && m.folder) getImage(`${m.folder}/1.png`);
    }

    // Preload clean Watch shape & ornament + PauseMenu board sprite
    const wm = data.SPRITE_METAS?.Watch;
    if (wm?.children?.length) {
        const w0 = wm.children[0];
        const wLast = wm.children[wm.children.length - 1];
        for (const wc of [w0, wLast]) {
            if (!wc) continue;
            const sm = data.SHAPE_METAS?.[String(wc.cid)];
            if (sm?.file) getImage(sm.file);
            const spm = data.SPRITES_BY_CID?.[String(wc.cid)];
            if (spm?.folder) getImage(`${spm.folder}/1.png`);
        }
    }
    const pm = data.SPRITE_METAS?.PauseMenu;
    const boardCid = pm?.children?.[1]?.cid;
    if (boardCid) {
        const bm = data.SPRITES_BY_CID?.[String(boardCid)];
        if (bm?.folder) getImage(`${bm.folder}/1.png`);
    }

    // Preload clean per-temple map layers, shapes & glowers
    const cfg = MENU_PRELOAD_MAP[templeId];
    if (cfg) {
        for (const imgPath of cfg.images) getImage(imgPath);
        for (const cid of cfg.sprites) {
            const m = data.SPRITES_BY_CID?.[String(cid)];
            if (m?.folder) getImage(`${m.folder}/1.png`);
        }
        for (const cid of cfg.buttons) {
            const m = data.BUTTON_METAS?.[String(cid)];
            if (m?.folder) getImage(`${m.folder}/1.png`);
        }
        for (const cid of cfg.shapes) {
            const sm = data.SHAPE_METAS?.[String(cid)];
            if (sm?.file) getImage(sm.file);
        }
    }

    for (const rootSym of ['FireBoy', 'WaterGirl']) {
        const rm = data.SPRITE_METAS?.[rootSym];
        const mc1 = rm?.children?.find((c) => c.name === 'mc_1');
        const m = mc1 ? data.SPRITES_BY_CID?.[String(mc1.cid)] : null;
        if (m && m.folder) getImage(`${m.folder}/1.png`);
    }
}

export function preloadTempleGameplayAssets(templeId = activeTempleId, data = activeData) {
    if (preloadedGameplayTemples.has(templeId)) return;
    preloadedGameplayTemples.add(templeId);

    const coreSyms = [
        'GroundBox1', 'GroundBox2', 'GroundBox3', 'GroundBox4', 'GroundBox5',
        'GroundBoxHalf', 'GroundBoxIce1', 'MaskBox', 'MaskBoxHalf', 'MaskBoxMaskTri',
        'MaskBoxIce', 'MaskBoxMaskTriIce', 'texture1',
        'FinishBoy', 'FinishGirl', 'ButtonBox', 'ButtonPlants', 'TimedButtonBox', 'TimedBase',
        'LeverBase', 'LeverMc', 'Platform1', 'PlatformBox', 'PlatformPulleyBox',
        'PulleyAnchor', 'PulleyAnchor2', 'Roman', 'RomanBase', 'MovingBox', 'MovingBox2',
        'Ball', 'WindMaker', 'LightBeamer', 'LightPusher', 'RotMirror', 'RotMirrorInfinite',
        'MovingMirror', 'Portal', 'PoartalBase', 'PortalSide', 'BlueDiamond', 'RedDiamond', 'SilverDiamond',
        'WaterBox', 'FireBox', 'BlackBox', 'FireBoystairs', 'WaterGirlStairs', 'deadFire'
    ];
    for (const sym of coreSyms) {
        const m = data.SPRITE_METAS?.[sym];
        if (m && m.folder) {
            const maxF = Math.min(m.frames || 1, 15);
            for (let f = 1; f <= maxF; f++) {
                getImage(`${m.folder}/${f}.png`);
            }
        }
    }
    if (templeId === 'crystal') {
        const portalBase = data.SPRITES_BY_CID?.['888'];
        if (portalBase?.folder) getImage(`${portalBase.folder}/1.png`);
        for (const cid of [969, 873]) {
            const m = data.SPRITES_BY_CID?.[String(cid)];
            if (m?.folder) {
                for (let f = 1; f <= Math.min(m.frames || 1, 15); f++) {
                    getImage(`${m.folder}/${f}.png`);
                }
            }
        }
    }
    for (const rootSym of ['FireBoy', 'WaterGirl']) {
        const rm = data.SPRITE_METAS?.[rootSym];
        for (const ch of rm?.children || []) {
            const m = data.SPRITES_BY_CID?.[String(ch.cid)];
            if (m && m.folder) {
                for (let f = 1; f <= Math.min(m.frames || 1, 12); f++) {
                    getImage(`${m.folder}/${f}.png`);
                }
            }
        }
    }
}

export function preloadTempleAssets(data = activeData, folder = null) {
    preloadTempleMenuAssets(activeTempleId, data, folder);
}

export function preloadForestAssets() {
    preloadTempleMenuAssets('forest', FOREST_DATA, 'Forest Temple');
}
