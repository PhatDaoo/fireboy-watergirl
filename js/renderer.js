// Authentic 100% Original-Asset HTML5 Canvas Renderer (Multi-Temple: Forest, Light, Ice, Crystal)

import {
    STAGE_WIDTH,
    STAGE_HEIGHT,
    LEVEL_SCALE,
    LEVEL_OFFSET_X,
    LEVEL_OFFSET_Y,
    TILE_SIZE
} from './forest_gamedata.js';
import {
    getImage,
    getActiveData,
    getSpriteMeta,
    drawSpriteByCid,
    drawSpriteBySymbol,
    drawButtonByCid,
    drawShapeByCid,
    getOrBuildLevelTerrain
} from './assets.js';
import { TEMPLES, TEMPLE_ORDER } from './temples.js';

const TEMPLE_MAP_CONFIG = {
    forest: {
        bgImage: 'Forest Temple/images/499.png',
        carvedPathsCid: 502,
        carvedPathsPos: { x: 313.5, y: 243.45 },
        useBitmapGold: true,
        props: [{ cid: 637, x: 72.95, y: 448.65, fg: true }],
        fliesCid: 622,
        fliesFrames: 69,
        gems: {
            1: { outline: 602, fillBase: 603, glower: 599 },
            2: { outline: 582, fillBase: 583, glower: 577 },
            3: { outline: 614, fillBase: 615, glower: 611 }
        },
        nowCid: 581
    },
    light: {
        bgSprite: { cid: 661, x: 327.0, y: 245.95 },
        roadStyle: { outerColor: 'rgba(80, 56, 22, 0.36)', outerWidth: 11, innerColor: '#c99443', innerWidth: 8, goldColor: '#ffcc00', goldWidth: 6 },
        useSocketGoldCid: true,
        backBtn: { kind: 'button', cid: 792, x: 163.4, y: 442.15 },
        fliesCid: 738,
        fliesFrames: 69,
        gems: {
            1: { outline: 709, fillBase: 710, glower: 706 },
            2: { outline: 689, fillBase: 690, glower: 684 },
            3: { outline: 721, fillBase: 722, glower: 718 },
            4: { outline: 728, fillBase: 729, glower: 706 }
        },
        nowCid: 688
    },
    ice: {
        bgSprite: { cid: 804, x: 327.0, y: 245.95 },
        props: [
            { cid: 806, x: 46.05, y: 202.9 },
            { cid: 808, x: -47.0, y: 415.8 }
        ],
        roadStyle: { outerColor: 'rgba(51, 51, 51, 0.36)', outerWidth: 11, innerColor: '#535666', innerWidth: 8, goldColor: '#ffcc00', goldWidth: 6 },
        useSocketGoldCid: true,
        backBtn: { kind: 'button', cid: 824, x: 161.3, y: 461.25 },
        fliesCid: 906,
        fliesFrames: 69,
        gems: {
            1: { outline: 879, fillBase: 880, glower: 876 },
            2: { outline: 859, fillBase: 860, glower: 854 },
            3: { outline: 891, fillBase: 892, glower: 888 },
            4: { outline: 898, fillBase: 899, glower: 876 }
        },
        nowCid: 858
    },
    crystal: {
        bgSprite: { cid: 784, x: 327.0, y: 245.95 },
        props: [
            { cid: 786, x: -47.0, y: 415.8 },
            { cid: 791, x: 42.05, y: 375.3 },
            { cid: 799, x: 615.8, y: 113.0 },
            { cid: 801, x: 424.45, y: 412.9 },
            { cid: 816, x: 476.2, y: 458.4 }
        ],
        roadStyle: { outerColor: 'rgba(51, 51, 51, 0.36)', outerWidth: 11, innerColor: '#444444', innerWidth: 8, goldColor: '#ffcc00', goldWidth: 6 },
        flatSockets: { 1: 'DiamondAdventureFlat', 2: 'DiamondPuzzleFlat', 3: 'DiamondSpeedFlat' },
        backBtn: { kind: 'sprite', cid: 804, x: 118.85, y: 462.65 },
        fliesCid: 820,
        fliesFrames: 69,
        gems: {
            1: { outline: 1272, fillBase: 1273, glower: 1269 },
            2: { outline: 1254, fillBase: 1255, glower: 1251 },
            3: { outline: 1239, fillBase: 1240, glower: 1234 }
        },
        nowCid: 1238
    }
};

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function uintToHex(c, fallback = '#fff59d') {
    if (typeof c === 'number' && c > 0xffffff) return fallback;
    if (typeof c === 'number' && c >= 0) {
        return '#' + c.toString(16).padStart(6, '0');
    }
    return fallback;
}

const CRYSTAL_COLORS_HEX = ['#be00fd', '#00e800', '#ffffff', '#ff6600', '#b0eff9', '#f0f000', '#207aff'];

export class ForestRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.frameTick = 0;
    }

    tick() {
        this.frameTick++;
    }

    _drawColorSym(ctx, prefix, colorId, frame = 1, x = 0, y = 0, sx = 1, sy = 1, rot = 0, alpha = 1) {
        const c = colorId || 1;
        if (getSpriteMeta(`${prefix}${c}`)) {
            return drawSpriteBySymbol(ctx, `${prefix}${c}`, frame, x, y, sx, sy, rot, alpha);
        }
        return drawSpriteBySymbol(ctx, `${prefix}3`, frame, x, y, sx, sy, rot, alpha);
    }

    drawStageBackground() {
        const ctx = this.ctx;
        ctx.fillStyle = '#0e100a';
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

        const data = getActiveData();
        const tf = data.TEMPLE_FOLDER || 'Forest Temple';
        if (data.TEMPLE_ID !== 'crystal') {
            const bg = getImage(`${tf}/frames/3.png`);
            if (bg && bg.loaded) {
                ctx.drawImage(bg.img, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
                return;
            }
        }
        const bgSym = getSpriteMeta('BackGround');
        if (bgSym) {
            drawSpriteBySymbol(ctx, 'BackGround', 1, 0, 0);
        }
    }

    /**
     * Screen 1: Intro Menu + In-Canvas 4-Temple Switcher
     */
    renderIntroMenu(state) {
        const ctx = this.ctx;
        this.drawStageBackground();

        // Draw full IntroMenu composite (compensate for offscreen left children in Light/Crystal SWFs if not in ox)
        const introMeta = getSpriteMeta('IntroMenu');
        let introX = 0;
        if (introMeta && Math.abs(introMeta.ox) <= 100) {
            if (introMeta.w > 1200) introX = -423;
            else if (introMeta.w > 800) introX = -320;
        }
        drawSpriteBySymbol(ctx, 'IntroMenu', 1, introX, 0);

        // Animate Fireboy (right corner) & Watergirl (left corner) on Forest Intro (Light/Ice/Crystal already bake them in IntroMenu)
        if (state.activeTemple === 'forest') {
            this._drawCharacterRig(ctx, 'pers1', 546.8, 434.0, 0.125, 1, 1, 0, 1, (this.frameTick % 10) + 1);
            this._drawCharacterRig(ctx, 'pers2', 80.65, 435.0, 0.125, 1, 1, 0, 1, (this.frameTick % 10) + 1);
        }

        // Hover glow indicator on menu buttons
        if (state.hoveredIntroBtn && !state.modal) {
            ctx.save();
            const b = state.hoveredIntroBtn;
            const grad = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.w * 0.55);
            grad.addColorStop(0, 'rgba(255, 220, 90, 0.28)');
            grad.addColorStop(1, 'rgba(255, 220, 90, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(b.x - b.w * 0.6, b.y - b.h * 0.7, b.w * 1.2, b.h * 1.4);
            ctx.restore();
        }

        // In-canvas 4-Temple selector bar (top-center, styled in authentic stone/gold)
        if (!state.modal) {
            this._drawTempleSelectorBar(state);
        }

        // Modal overlays (Instructions, Credits)
        if (state.modal === 'instructions') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            drawSpriteBySymbol(ctx, 'Instructions', 1, 0, 0);
        } else if (state.modal === 'credits') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            drawSpriteBySymbol(ctx, 'Credits', 1, 0, 0);
        }

        this._drawMuterIcon(state.muted);
    }

    _drawTempleSelectorBar(state) {
        const ctx = this.ctx;
        const barW = 420;
        const barH = 34;
        const startX = (STAGE_WIDTH - barW) / 2;
        const y = 10;
        const slotW = barW / TEMPLE_ORDER.length;

        ctx.save();
        ctx.fillStyle = 'rgba(14, 16, 10, 0.78)';
        ctx.strokeStyle = 'rgba(232, 198, 105, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(startX, y, barW, barH, 8);
        ctx.fill();
        ctx.stroke();

        TEMPLE_ORDER.forEach((tid, i) => {
            const t = TEMPLES[tid];
            const active = state.activeTemple === tid;
            const hovered = state.hoveredTempleTab === tid;
            const bx = startX + i * slotW + 4;
            const bw = slotW - 8;
            if (active || hovered) {
                ctx.fillStyle = active ? 'rgba(255, 210, 80, 0.22)' : 'rgba(255, 255, 255, 0.08)';
                ctx.strokeStyle = active ? t.accent : 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = active ? 1.6 : 1;
                ctx.beginPath();
                ctx.roundRect(bx, y + 4, bw, barH - 8, 5);
                ctx.fill();
                ctx.stroke();
            }
            ctx.font = active ? 'bold 12px Georgia, serif' : '12px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = active ? t.accent : '#d8d2bc';
            ctx.fillText(`${i + 1}. ${t.shortTitle}`, bx + bw / 2, y + barH / 2 + 1);
        });
        ctx.restore();
    }

    /**
     * Screen 2: Temple Map rendered cleanly layer-by-layer (zero baked MainMenu/nodeCid double-drawing)
     */
    renderTempleMap(state) {
        const ctx = this.ctx;
        const data = getActiveData();
        const tid = data.TEMPLE_ID || 'forest';
        const cfg = TEMPLE_MAP_CONFIG[tid] || TEMPLE_MAP_CONFIG.forest;
        const nodes = data.TEMPLE_NODES || [];

        ctx.fillStyle = '#0e100a';
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

        // 1. Clean temple map background
        if (cfg.bgImage) {
            const mapBg = getImage(cfg.bgImage);
            if (mapBg && mapBg.loaded) {
                ctx.drawImage(mapBg.img, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            } else {
                this.drawStageBackground();
            }
        } else if (cfg.bgSprite) {
            if (!drawSpriteByCid(ctx, cfg.bgSprite.cid, 1, cfg.bgSprite.x, cfg.bgSprite.y)) {
                this.drawStageBackground();
            }
        } else {
            this.drawStageBackground();
        }

        // Background props (behind roads/gems)
        for (const p of cfg.props || []) {
            if (!p.fg) drawSpriteByCid(ctx, p.cid, 1, p.x, p.y);
        }

        // Filter on-screen nodes
        const onScreenNodes = nodes.filter((n) => {
            const nx = n.nodeX ?? n.x;
            const ny = n.nodeY ?? n.y;
            return nx !== undefined && ny !== undefined && nx >= 0 && nx <= 640 && ny >= 0 && ny <= 480;
        });

        // 2. Carved paths, edges & Golden_road
        if (cfg.carvedPathsCid) {
            drawSpriteByCid(ctx, cfg.carvedPathsCid, 1, cfg.carvedPathsPos.x, cfg.carvedPathsPos.y);
        }
        if (cfg.useBitmapGold) {
            for (const node of onScreenNodes) {
                const stat = state.progress.stats[node.node - 1];
                if (stat >= 0 && node.goldCid) {
                    drawSpriteByCid(ctx, node.goldCid, 1, node.goldX, node.goldY);
                }
            }
        } else if (cfg.roadStyle) {
            const byNum = new Map(onScreenNodes.map((n) => [n.node, n]));
            const edges = [];
            for (const n of onScreenNodes) {
                for (const nb of n.nextNodes || []) {
                    if (n.node < nb && byNum.has(nb)) {
                        edges.push([n, byNum.get(nb)]);
                    }
                }
            }

            const rs = cfg.roadStyle;
            const strokeEdges = (filterFn, width, color, shadowColor = null, alpha = 1) => {
                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = width;
                ctx.strokeStyle = color;
                ctx.globalAlpha = alpha;
                if (shadowColor) {
                    ctx.shadowColor = shadowColor;
                    ctx.shadowBlur = 6;
                }
                ctx.beginPath();
                for (const [a, b] of edges) {
                    if (!filterFn(a, b)) continue;
                    const ax = a.nodeX ?? a.x;
                    const ay = a.nodeY ?? a.y;
                    const bx = b.nodeX ?? b.x;
                    const by = b.nodeY ?? b.y;
                    ctx.moveTo(ax, ay);
                    ctx.lineTo(bx, by);
                }
                ctx.stroke();
                ctx.restore();
            };

            // Pass 1 (camins2) & Pass 2 (camins1)
            strokeEdges(() => true, rs.outerWidth, rs.outerColor);
            strokeEdges(() => true, rs.innerWidth, rs.innerColor);

            // Pass 3 (Golden_road): unlocked edges glow subtly, beaten edges glow bright gold
            strokeEdges(
                (a, b) => state.progress.stats[a.node - 1] >= 0 && state.progress.stats[b.node - 1] >= 0,
                rs.goldWidth,
                '#d4af37',
                null,
                0.65
            );
            strokeEdges(
                (a, b) => state.progress.stats[a.node - 1] > 0 || state.progress.stats[b.node - 1] > 0,
                rs.goldWidth,
                rs.goldColor,
                '#ff9800',
                1
            );
        }

        // 3. Recessed sockets behind unlocked nodes (Light/Ice goldCid or Crystal Flat sockets)
        if (cfg.useSocketGoldCid) {
            for (const node of onScreenNodes) {
                const stat = state.progress.stats[node.node - 1];
                if (stat >= 0 && node.goldCid) {
                    drawSpriteByCid(ctx, node.goldCid, 1, node.goldX, node.goldY);
                }
            }
        } else if (cfg.flatSockets) {
            for (const node of onScreenNodes) {
                const stat = state.progress.stats[node.node - 1];
                const nx = node.nodeX ?? node.x;
                const ny = node.nodeY ?? node.y;
                const gemType = node.gemTypeId || node.typeId || 1;
                const flatSym = cfg.flatSockets[gemType] || cfg.flatSockets[1];
                drawSpriteBySymbol(ctx, flatSym, stat >= 0 ? 1 : 2, nx, ny);
            }
        }

        // 4. Unlocked gem nodes (clean vector outline + fill + 40-frame Glower on hover + NEW badge)
        let hoveredNodeObj = null;
        for (const node of onScreenNodes) {
            const stat = state.progress.stats[node.node - 1];
            if (stat < 0) continue;

            const isHovered = state.hoveredNode === node.node;
            if (isHovered) hoveredNodeObj = node;

            const nx = node.nodeX ?? node.x;
            const ny = node.nodeY ?? node.y;
            const gemType = node.gemTypeId || node.typeId || 1;
            const gemCfg = cfg.gems[gemType] || cfg.gems[1];

            if (isHovered && gemCfg.glower) {
                const gFrame = (this.frameTick % 40) + 1;
                drawSpriteByCid(ctx, gemCfg.glower, gFrame, nx, ny);
            }

            const rankIdx = Math.max(0, Math.min(3, stat));
            drawShapeByCid(ctx, gemCfg.outline, nx, ny);
            drawShapeByCid(ctx, gemCfg.fillBase + rankIdx, nx, ny);

            if (cfg.nowCid && state.progress.isNew[node.node - 1] && stat === 0) {
                drawSpriteByCid(ctx, cfg.nowCid, 1, nx - 0.75, ny + 23.75);
            }
        }

        // 5. Foreground props (Forest vines) & MainMenu back button
        for (const p of cfg.props || []) {
            if (p.fg) drawSpriteByCid(ctx, p.cid, 1, p.x, p.y);
        }
        if (cfg.backBtn) {
            if (cfg.backBtn.kind === 'button') {
                drawButtonByCid(ctx, cfg.backBtn.cid, 1, cfg.backBtn.x, cfg.backBtn.y);
            } else {
                drawSpriteByCid(ctx, cfg.backBtn.cid, 1, cfg.backBtn.x, cfg.backBtn.y);
            }
        }

        // Top-left Back-to-Temples pill
        ctx.save();
        ctx.fillStyle = 'rgba(14, 16, 10, 0.72)';
        ctx.strokeStyle = 'rgba(232, 198, 105, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(12, 12, 86, 26, 6);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 11px Georgia, serif';
        ctx.fillStyle = '#ffe57f';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('← TEMPLES', 55, 25);
        ctx.restore();

        // 6. Animated 69-frame fireflies
        if (cfg.fliesCid) {
            drawSpriteByCid(ctx, cfg.fliesCid, (this.frameTick % cfg.fliesFrames) + 1, state.flies.x, state.flies.y);
        }

        // Hovered node level label & best time tooltip
        if (hoveredNodeObj) {
            const idx = hoveredNodeObj.node - 1;
            const nx = hoveredNodeObj.nodeX ?? hoveredNodeObj.x;
            const ny = hoveredNodeObj.nodeY ?? hoveredNodeObj.y;
            const bestStr = state.progress.timesString[idx];
            if (nx !== undefined && ny !== undefined) {
                ctx.save();
                ctx.font = 'bold 13px Georgia, serif';
                ctx.fillStyle = '#ffcc00';
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 4;
                ctx.textAlign = 'center';
                const label = bestStr ? `#${hoveredNodeObj.node} • ${bestStr}` : `Level ${hoveredNodeObj.node}`;
                ctx.fillText(label, nx, ny - 22);
                ctx.restore();
            }
        }

        this._drawMuterIcon(state.muted);
    }

    /**
     * Screen 3: Active Gameplay Level
     */
    renderLevel(world, uiState, alpha = 1) {
        const ctx = this.ctx;
        const t = (world.pause || world.ended) ? 1 : Math.max(0, Math.min(1, alpha));
        this.drawStageBackground();

        ctx.save();
        ctx.translate(LEVEL_OFFSET_X, LEVEL_OFFSET_Y);
        ctx.scale(LEVEL_SCALE, LEVEL_SCALE);

        // --- LAYER 1: SlidersAndRots (Exit doors, portals, platforms, seesaws) ---
        drawSpriteBySymbol(ctx, 'FinishBoy', world.finish1.frame, world.finish1.x * TILE_SIZE, world.finish1.y * TILE_SIZE);
        drawSpriteBySymbol(ctx, 'FinishGirl', world.finish2.frame, world.finish2.x * TILE_SIZE, world.finish2.y * TILE_SIZE);

        for (const pp of world.portalPairs) {
            this._drawPortalPair(ctx, pp);
        }

        for (const sp of world.slidePlatforms) {
            const sx = lerp(sp.prevX, sp.x, t);
            const sy = lerp(sp.prevY, sp.y, t);
            this._drawPlatformBar(
                ctx,
                sx * TILE_SIZE,
                sy * TILE_SIZE,
                sp.halfWidth,
                sp.halfHeight,
                0,
                sp.colorId ?? sp.color,
                sp.lightOn,
                true
            );
        }

        for (const rp of world.rotPlatforms) {
            const rx = lerp(rp.prevX, rp.x, t);
            const ry = lerp(rp.prevY, rp.y, t);
            const rAng = lerp(rp.prevAngle, rp.angle, t);
            this._drawPlatformBar(
                ctx,
                rx * TILE_SIZE,
                ry * TILE_SIZE,
                rp.halfWidth,
                rp.halfHeight,
                (rAng * 180) / Math.PI,
                rp.colorId ?? rp.color,
                rp.lightOn,
                false
            );
        }

        for (const rm of world.romans) {
            const rAng = lerp(rm.prevAngle, rm.angle, t);
            const baseScaleY = ((rm.height - 0.5) * TILE_SIZE) / 35;
            drawSpriteBySymbol(ctx, 'RomanBase', 1, rm.baseX * TILE_SIZE, rm.baseY * TILE_SIZE, 1, baseScaleY, 0);
            const stickScaleX = (rm.length * TILE_SIZE) / 410;
            drawSpriteBySymbol(ctx, 'Roman', 1, rm.pivotX * TILE_SIZE, rm.pivotY * TILE_SIZE, stickScaleX, 1, (rAng * 180) / Math.PI);
        }

        // --- LAYER 2: Cached Ground & Texture ---
        const terrainCanvas = getOrBuildLevelTerrain(world.levelKey, world.grid);
        if (terrainCanvas) {
            ctx.drawImage(terrainCanvas, -20, -20);
        }

        // IceBlocks
        for (const ib of world.iceBlocks) {
            ctx.save();
            ctx.translate(ib.x * TILE_SIZE, ib.y * TILE_SIZE);
            ctx.rotate(ib.angle);
            ctx.fillStyle = 'rgba(155, 228, 255, 0.72)';
            ctx.strokeStyle = '#d8f4ff';
            ctx.lineWidth = 2;
            const w = ib.hx * 2 * TILE_SIZE;
            const h = ib.hy * 2 * TILE_SIZE;
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.restore();
        }

        // --- LAYER 3: Pulleys, Hanging, Levers, Winds, Mirrors, LightPushers, Diamonds ---
        for (const pl of world.pulleys) {
            this._drawPulleySystem(ctx, pl, t);
        }

        for (const hp of world.hangingPlatforms) {
            this._drawHangingPlatform(ctx, hp, t);
        }

        for (const lv of world.levers) {
            this._drawLever(ctx, lv, t);
        }

        for (const w of world.winds) {
            this._drawWindFan(ctx, w);
        }

        for (const rm of world.rotMirrors) {
            this._drawMirror(ctx, rm.x * TILE_SIZE, rm.y * TILE_SIZE, rm.angle, rm.halfLen * TILE_SIZE, rm.color, 'RotMirror');
        }
        for (const im of world.infiniteMirrors) {
            this._drawMirror(ctx, im.x * TILE_SIZE, im.y * TILE_SIZE, im.angle, im.halfLen * TILE_SIZE, im.color, 'RotMirrorInfinite');
        }
        for (const ms of world.mirrorSliders) {
            this._drawMirrorSlider(ctx, ms);
        }

        for (const lp of world.lightPushers) {
            this._drawLightPusher(ctx, lp);
        }

        for (const lb of world.lightBeamers) {
            this._drawLightBeamer(ctx, lb);
        }

        const diamondFrame = (this.frameTick % 40) + 1;
        for (const d of world.diamonds) {
            if (d.collected) continue;
            const sym = d.type === 'bd' ? 'BlueDiamond' : (d.type === 'rd' ? 'RedDiamond' : 'SilverDiamond');
            drawSpriteBySymbol(ctx, sym, diamondFrame, d.x * TILE_SIZE, d.y * TILE_SIZE);
        }

        // --- LAYER 4: Pushers, TimedPushers, Boxes, Balls, Bugs ---
        for (const p of world.pushers) {
            this._drawPusher(ctx, p, t);
        }
        for (const tp of world.timedPushers) {
            this._drawTimedPusher(ctx, tp, t);
        }

        for (const mb of world.movingBoxes) {
            const bx = lerp(mb.prevX, mb.x, t);
            const by = lerp(mb.prevY, mb.y, t);
            drawSpriteBySymbol(ctx, 'MovingBox', 1, bx * TILE_SIZE, by * TILE_SIZE);
        }
        for (const mb2 of world.movingBoxes2) {
            const bx = lerp(mb2.prevX, mb2.x, t);
            const by = lerp(mb2.prevY, mb2.y, t);
            if (!drawSpriteBySymbol(ctx, 'MovingBox2', 1, bx * TILE_SIZE, by * TILE_SIZE)) {
                drawSpriteBySymbol(ctx, 'MovingBox', 1, bx * TILE_SIZE, by * TILE_SIZE);
            }
        }
        for (const mm of world.movingMirrors) {
            const bx = lerp(mm.prevX, mm.x, t);
            const by = lerp(mm.prevY, mm.y, t);
            if (!drawSpriteBySymbol(ctx, 'MovingMirror', 1, bx * TILE_SIZE, by * TILE_SIZE, 1, 1, ((mm.angle - Math.PI / 4) * 180) / Math.PI)) {
                this._drawMirror(ctx, bx * TILE_SIZE, by * TILE_SIZE, mm.angle, mm.halfLen * TILE_SIZE, 1, null);
            }
        }

        for (const b of world.balls) {
            const bx = lerp(b.prevX, b.x, t);
            const by = lerp(b.prevY, b.y, t);
            const bAng = lerp(b.prevAngle, b.angle, t);
            drawSpriteBySymbol(ctx, 'Ball', 1, bx * TILE_SIZE, by * TILE_SIZE, 1, 1, (bAng * 180) / Math.PI);
        }

        for (const bg of world.bugs) {
            drawSpriteBySymbol(ctx, 'bug', bg.frame, bg.x, bg.y, 1, 1, bg.rotation);
        }

        // --- LAYER 5: CharsLayer ---
        if (world.hasTutorial && world.tutAlpha > 0.01) {
            drawSpriteBySymbol(ctx, 'TutLayer', Math.floor(world.tutFrame), 0, 0, 1, 1, 0, world.tutAlpha);
        }

        if (world.pers1.visible) {
            const p1x = lerp(world.pers1.prevX, world.pers1.x, t);
            const p1y = lerp(world.pers1.prevY, world.pers1.y, t);
            this._drawCharacterRig(
                ctx, 'pers1', p1x * TILE_SIZE, p1y * TILE_SIZE, 0.135,
                world.pers1.activeMc, world.pers1.facing, world.pers1.headRotDeg, world.pers1.runFrame, world.pers1.headFrame
            );
        }

        if (world.pers2.visible) {
            const p2x = lerp(world.pers2.prevX, world.pers2.x, t);
            const p2y = lerp(world.pers2.prevY, world.pers2.y, t);
            this._drawCharacterRig(
                ctx, 'pers2', p2x * TILE_SIZE, p2y * TILE_SIZE, 0.135,
                world.pers2.activeMc, world.pers2.facing, world.pers2.headRotDeg, world.pers2.runFrame, world.pers2.headFrame
            );
        }

        if (world.stairsAnim) {
            const sf = Math.min(25, world.stairsAnim.frame);
            const wf = Math.min(25, world.stairsAnim.frame);
            drawSpriteBySymbol(ctx, 'FireBoystairs', sf, world.stairsAnim.fireX, world.stairsAnim.fireY);
            drawSpriteBySymbol(ctx, 'WaterGirlStairs', wf, world.stairsAnim.waterX, world.stairsAnim.waterY);
        }

        if (world.deathAnim) {
            drawSpriteBySymbol(ctx, 'deadFire', world.deathAnim.frame, world.deathAnim.x, world.deathAnim.y);
        }

        // --- LAYER 6: FiresandWaters ---
        this._drawLiquidPools(ctx, world.grid);

        // --- LAYER 7: Dark Mode Mask ---
        if (world.data.mode === 'dark') {
            this._drawDarkOverlay(ctx, world, t);
        }

        ctx.restore();

        // --- STAGE HUD & OVERLAYS ---
        this._drawTopWatch(world.elapsedMs);
        this._drawMuterIcon(uiState.muted);
        this._drawBottomPauseTab(world, uiState);

        const oy = uiState.overlayOffsetY || 0;
        if (uiState.overlay === 'pause') {
            this._drawPauseOverlay(world, oy);
        } else if (uiState.overlay === 'gameover') {
            this._drawGameOverOverlay(oy);
        } else if (uiState.overlay === 'recuento') {
            this._drawRecuentoOverlay(world, uiState.lastResult, oy);
        }

        if (uiState.fadeAlpha > 0.01) {
            ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, uiState.fadeAlpha)})`;
            ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        }
    }

    _drawDarkOverlay(ctx, world, t) {
        const p1x = lerp(world.pers1.prevX, world.pers1.x, t) * TILE_SIZE;
        const p1y = lerp(world.pers1.prevY, world.pers1.y, t) * TILE_SIZE;
        const p2x = lerp(world.pers2.prevX, world.pers2.x, t) * TILE_SIZE;
        const p2y = lerp(world.pers2.prevY, world.pers2.y, t) * TILE_SIZE;

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.beginPath();
        ctx.rect(-30, -30, world.cols * TILE_SIZE + 60, world.rows * TILE_SIZE + 60);
        // Cut out character vision circles using evenodd winding
        ctx.moveTo(p1x + 125, p1y);
        ctx.arc(p1x, p1y, 125, 0, Math.PI * 2, true);
        ctx.moveTo(p2x + 125, p2y);
        ctx.arc(p2x, p2y, 125, 0, Math.PI * 2, true);
        for (const lb of world.lightBeamers) {
            const lx = lb.x * TILE_SIZE;
            const ly = lb.y * TILE_SIZE;
            ctx.moveTo(lx + 75, ly);
            ctx.arc(lx, ly, 75, 0, Math.PI * 2, true);
        }
        ctx.fill('evenodd');
        ctx.restore();
    }

    _drawLightBeamer(ctx, lb) {
        // Draw glowing light beam segments
        if (lb.segments && lb.segments.length > 0) {
            const colHex = uintToHex(lb.color, '#fff59d');
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowColor = colHex;
            ctx.shadowBlur = 14;
            ctx.strokeStyle = colHex;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 10;
            ctx.beginPath();
            for (const seg of lb.segments) {
                ctx.moveTo(seg.x1 * TILE_SIZE, seg.y1 * TILE_SIZE);
                ctx.lineTo(seg.x2 * TILE_SIZE, seg.y2 * TILE_SIZE);
            }
            ctx.stroke();

            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 3.5;
            ctx.stroke();
            ctx.restore();
        }
        drawSpriteBySymbol(ctx, 'LightBeamer', 1, lb.x * TILE_SIZE, lb.y * TILE_SIZE, 1, 1, (lb.angle * 180) / Math.PI);
    }

    _drawLightPusher(ctx, lp) {
        const px = lp.x * TILE_SIZE;
        const py = lp.y * TILE_SIZE;
        if (!drawSpriteBySymbol(ctx, 'LightPusher', 1, px, py, 1, 1, lp.param2 || 0)) {
            ctx.save();
            ctx.fillStyle = '#444';
            ctx.fillRect(px - 10, py - 10, 20, 20);
            ctx.restore();
        }
        const colHex = uintToHex(lp.color, '#fff59d');
        ctx.save();
        ctx.fillStyle = colHex;
        ctx.globalAlpha = lp.active ? 0.95 : 0.35;
        ctx.shadowColor = colHex;
        ctx.shadowBlur = lp.active ? 14 : 0;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawMirror(ctx, px, py, angleRad, halfLenPx, colorId, sym) {
        if (sym && drawSpriteBySymbol(ctx, sym, 1, px, py, 1, 1, ((angleRad - Math.PI / 4) * 180) / Math.PI)) {
            return;
        }
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angleRad);
        ctx.strokeStyle = '#b3e5fc';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-halfLenPx, 0);
        ctx.lineTo(halfLenPx, 0);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    _drawMirrorSlider(ctx, ms) {
        const sx = ms.startX * TILE_SIZE;
        const sy = ms.startY * TILE_SIZE;
        const ex = sx + Math.cos(ms.rad) * ms.length * TILE_SIZE;
        const ey = sy + Math.sin(ms.rad) * ms.length * TILE_SIZE;
        ctx.save();
        ctx.strokeStyle = 'rgba(200, 200, 220, 0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.restore();
        this._drawMirror(ctx, ms.x * TILE_SIZE, ms.y * TILE_SIZE, ms.angle, ms.halfLen * TILE_SIZE, ms.color, 'RotMirror');
    }

    _drawPortalPair(ctx, pp) {
        const col = CRYSTAL_COLORS_HEX[pp.color] || '#7ce8ff';
        const portalMeta = getSpriteMeta('Portal');
        const centerCid = portalMeta?.children?.[0]?.cid || 969;

        const endpoints = [
            [pp.pos1, pp.ori1, true],
            [pp.pos2, pp.ori2, false]
        ];
        for (const [pos, ori, isFirst] of endpoints) {
            const px = pos.x * TILE_SIZE;
            const py = pos.y * TILE_SIZE;
            ctx.save();
            ctx.translate(px, py);
            if (ori !== 0) ctx.rotate((ori * Math.PI) / 180);
            if (!pp.inverted && !isFirst) {
                ctx.scale(-1, 1);
            }
            if (pp.open) {
                const fSide1 = ((this.frameTick + (pp.id || 0) * 11) % 53) + 1;
                const fSide2 = ((this.frameTick + (pp.id || 0) * 11 + 26) % 53) + 1;
                drawSpriteBySymbol(ctx, 'PortalSide', fSide1, 0, 0, 1, 1, 0, 0.85);
                drawSpriteBySymbol(ctx, 'PortalSide', fSide2, 0, 0, 1, 1, 180, 0.85);
                drawSpriteByCid(ctx, centerCid, (this.frameTick % 40) + 1, 0, 0, 1, 1, 0, 0.92);
            }
            if (!drawSpriteBySymbol(ctx, 'PoartalBase', 1, 0, 0, 1, 1, 0, pp.open ? 1 : 0.45)) {
                drawSpriteBySymbol(ctx, 'Portal', 1, 0, 0, 1, 1, 0, pp.open ? 1 : 0.45);
            }
            // Top & bottom color indicator lights matching Light1/Light2 on PoartalBase caps
            ctx.fillStyle = col;
            ctx.shadowColor = col;
            ctx.shadowBlur = pp.open ? 8 : 0;
            ctx.globalAlpha = pp.open ? 0.95 : 0.45;
            for (const capY of [-34, 34]) {
                ctx.beginPath();
                ctx.arc(0, capY, 3.6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    _drawCharacterRig(ctx, charName, px, py, baseScale, activeMc, facing, headRotDeg, runFrame, headFrame) {
        const isFire = charName === 'pers1';
        const rootSym = isFire ? 'FireBoy' : 'WaterGirl';
        const rootMeta = getSpriteMeta(rootSym);
        const childName = `mc_${activeMc}`;
        const child = rootMeta?.children?.find((c) => c.name === childName) || rootMeta?.children?.[0];

        ctx.save();
        ctx.translate(px, py);
        ctx.shadowColor = isFire ? '#ff6600' : '#8addff';
        ctx.shadowBlur = 14;

        if (child) {
            const dir = activeMc === 1 ? 1 : facing;
            ctx.translate((child.tx || 0) * dir, child.ty || 0);
            ctx.scale(dir * Math.abs(child.sx || baseScale), Math.abs(child.sy || baseScale));
            const frame = activeMc === 5 ? Math.max(1, Math.floor(runFrame)) : Math.max(1, Math.floor(headFrame));
            drawSpriteByCid(ctx, child.cid, frame, 0, 0);
        } else {
            ctx.fillStyle = isFire ? '#ff5722' : '#29b6f6';
            ctx.beginPath();
            ctx.arc(0, 0, 11, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    _drawPlatformBar(ctx, px, py, halfW, halfH, rotDeg, colorId, lightOn, isSlide) {
        ctx.save();
        ctx.translate(px, py);
        if (rotDeg !== 0) ctx.rotate((rotDeg * Math.PI) / 180);

        let barRot = 0;
        let sx = 1;
        let sy = 1;
        if (isSlide) {
            if (halfH > halfW) {
                barRot = 90;
                sx = (halfW * 40) / 20;
                sy = (halfH * 40) / 80;
            } else {
                sx = (halfH * 40) / 20;
                sy = (halfW * 40) / 80;
            }
        } else {
            if (halfW > halfH) {
                barRot = 90;
                sx = (halfH * 40) / 20;
                sy = (halfW * 40) / 80;
            } else {
                sx = (halfW * 40) / 20;
                sy = (halfH * 40) / 80;
            }
        }

        if (barRot !== 0) ctx.rotate((barRot * Math.PI) / 180);
        ctx.scale(sx, sy);
        drawSpriteBySymbol(ctx, 'Platform1', 1, 0, 0);
        this._drawColorSym(ctx, lightOn ? 'light_on_' : 'light_off_', colorId, 1, 0, 0);
        ctx.restore();
    }

    _drawLever(ctx, lv, t = 1) {
        const px = lv.pos.x * TILE_SIZE;
        const py = lv.pos.y * TILE_SIZE;
        const pivX = lv.pivotX * TILE_SIZE;
        const pivY = lv.pivotY * TILE_SIZE;
        const bodyAngle = lerp(lv.prevBodyAngle, lv.bodyAngle, t);

        ctx.save();
        ctx.translate(pivX, pivY);
        ctx.rotate(bodyAngle);
        ctx.translate(0, -0.6 * TILE_SIZE);
        drawSpriteBySymbol(ctx, 'LeverMc', 1, 0, 0);
        this._drawColorSym(ctx, 'lever_light_', lv.colorId ?? lv.color, lv.lightFrame, 0, 0);
        ctx.restore();

        drawSpriteBySymbol(ctx, 'LeverBase', 1, px, py);
        this._drawColorSym(ctx, 'lever_base_light_', lv.colorId ?? lv.color, 1, px + 2, py + 13);
    }

    _drawPusher(ctx, p, t = 1) {
        const origX = p.originX * TILE_SIZE;
        const origY = p.originY * TILE_SIZE;
        const py = lerp(p.prevY, p.y, t) * TILE_SIZE;

        ctx.save();
        ctx.beginPath();
        ctx.rect(origX - 30, origY - 24, 60, 38);
        ctx.clip();
        drawSpriteBySymbol(ctx, 'ButtonBox', 1, origX, py);
        this._drawColorSym(ctx, 'lightpoint_', p.colorId ?? p.color, 1, origX, py);
        ctx.restore();

        drawSpriteBySymbol(ctx, 'ButtonPlants', 1, origX, origY);
    }

    _drawTimedPusher(ctx, tp, t = 1) {
        const origX = tp.originX * TILE_SIZE;
        const origY = tp.originY * TILE_SIZE;
        const py = lerp(tp.prevY, tp.y, t) * TILE_SIZE;

        ctx.save();
        ctx.beginPath();
        ctx.rect(origX - 30, origY - 24, 60, 38);
        ctx.clip();
        if (!drawSpriteBySymbol(ctx, 'TimedButtonBox', 1, origX, py)) {
            drawSpriteBySymbol(ctx, 'ButtonBox', 1, origX, py);
        }
        this._drawColorSym(ctx, 'lightpoint_', tp.color, 1, origX, py);
        ctx.restore();

        drawSpriteBySymbol(ctx, 'TimedBase', 1, origX, origY + 10);
        if (tp.timer > 0) {
            const ratio = Math.max(0, Math.min(1, tp.timer / tp.delay));
            ctx.save();
            ctx.fillStyle = '#00e5ff';
            ctx.fillRect(origX - 14, origY + 10, 28 * ratio, 4);
            ctx.restore();
        }
    }

    _drawWindFan(ctx, w) {
        if (w.on) {
            const cx = (w.lower.x + (w.upper.x - w.lower.x) / 2) * TILE_SIZE;
            const cy = (w.lower.y + (w.upper.y - w.lower.y) / 2) * TILE_SIZE;
            let ww = (w.upper.x - w.lower.x) * TILE_SIZE;
            let wh = (w.upper.y - w.lower.y) * TILE_SIZE;
            let rot = 0;
            if (w.dir === 1) { ww += 30; rot = 0; }
            else if (w.dir === 2) { wh += 30; rot = 90; }
            else if (w.dir === 3) { ww += 30; rot = 180; }
            else if (w.dir === 4) { wh += 30; rot = 270; }
            const wf = (this.frameTick % 6) + 1;
            const sx = (rot === 90 || rot === 270) ? wh / 400 : ww / 394;
            const sy = (rot === 90 || rot === 270) ? ww / 394 : wh / 400;
            drawSpriteBySymbol(ctx, 'Wind', wf, cx, cy, sx, sy, rot, 0.85);
        }

        let mx = 0, my = 0, mrot = 0;
        if (w.dir === 1) { mx = (w.lower.x + (w.upper.x - w.lower.x) / 2) * TILE_SIZE; my = w.upper.y * TILE_SIZE; mrot = 0; }
        else if (w.dir === 2) { mx = w.lower.x * TILE_SIZE; my = (w.lower.y + (w.upper.y - w.lower.y) / 2) * TILE_SIZE; mrot = 90; }
        else if (w.dir === 3) { mx = (w.lower.x + (w.upper.x - w.lower.x) / 2) * TILE_SIZE; my = w.lower.y * TILE_SIZE; mrot = 180; }
        else if (w.dir === 4) { mx = w.upper.x * TILE_SIZE; my = (w.lower.y + (w.upper.y - w.lower.y) / 2) * TILE_SIZE; mrot = 270; }

        ctx.save();
        ctx.translate(mx, my);
        if (mrot !== 0) ctx.rotate((mrot * Math.PI) / 180);
        drawSpriteBySymbol(ctx, 'WindMaker', 1, 0, 0);
        this._drawColorSym(ctx, w.on ? 'light_on_' : 'light_off_', w.colorId ?? w.color, 1, -1, 4.5, 4.5 / 8, 50 / 80, 90);
        ctx.restore();
    }

    _drawPulleySystem(ctx, pl, t = 1) {
        const a1x = pl.anchor1.x * TILE_SIZE;
        const a1y = pl.anchor1.y * TILE_SIZE;
        const a2x = pl.anchor2.x * TILE_SIZE;
        const a2y = pl.anchor2.y * TILE_SIZE;
        const p1x = lerp(pl.p1.prevX, pl.p1.x, t) * TILE_SIZE;
        const p1y = lerp(pl.p1.prevY, pl.p1.y, t) * TILE_SIZE;
        const p2x = lerp(pl.p2.prevX, pl.p2.x, t) * TILE_SIZE;
        const p2y = lerp(pl.p2.prevY, pl.p2.y, t) * TILE_SIZE;

        ctx.save();
        ctx.strokeStyle = '#9e9b8e';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(a1x, a1y - 8);
        ctx.lineTo(a2x, a2y - 8);
        ctx.moveTo(a1x, a1y);
        ctx.lineTo(p1x, p1y - 25);
        ctx.moveTo(a2x, a2y);
        ctx.lineTo(p2x, p2y - 25);
        ctx.stroke();
        ctx.restore();

        const wheelRot = -(p1y - a1y) * 4;
        drawSpriteBySymbol(ctx, 'PulleyAnchor', 1, a1x + 5, a1y - 5, 1, 1, wheelRot);
        drawSpriteBySymbol(ctx, 'PulleyAnchor2', 1, a2x - 5, a2y - 5, 1, 1, wheelRot);

        const sx1 = (pl.p1.hx * 40) / 111;
        const sx2 = (pl.p2.hx * 40) / 111;
        drawSpriteBySymbol(ctx, 'PlatformPulleyBox', 1, p1x, p1y, sx1, 1, 0);
        drawSpriteBySymbol(ctx, 'PlatformPulleyBox', 1, p2x, p2y, sx2, 1, 0);
    }

    _drawHangingPlatform(ctx, hp, t = 1) {
        const ax = hp.anchor.x * TILE_SIZE;
        const ay = hp.anchor.y * TILE_SIZE;
        const px = lerp(hp.prevX, hp.x, t) * TILE_SIZE;
        const py = lerp(hp.prevY, hp.y, t) * TILE_SIZE;

        ctx.save();
        ctx.strokeStyle = '#8d6e4c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();

        const sx = (hp.hx * 40) / 111;
        const sy = (hp.hy * 40) / 26;
        drawSpriteBySymbol(ctx, 'PlatformBox', 1, px, py, sx, sy, 0);
    }

    _drawLiquidPools(ctx, grid) {
        const rows = grid.length;
        const cols = grid[0].length;
        const f10 = (this.frameTick % 10) + 1;
        const f15 = (this.frameTick % 15) + 1;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = grid[r][c];
                const px = c * TILE_SIZE;
                const py = (r - 0.25) * TILE_SIZE;

                if (cell === 5) drawSpriteBySymbol(ctx, 'WaterBox', f10, px, py);
                else if (cell === 51) drawSpriteBySymbol(ctx, 'WaterBoxTri', f15, px, py, 1, 0.5);
                else if (cell === 52) drawSpriteBySymbol(ctx, 'WaterBoxTri', f15, px, py, -1, 0.5);
                else if (cell === 6) drawSpriteBySymbol(ctx, 'FireBox', f15, px, py);
                else if (cell === 61) drawSpriteBySymbol(ctx, 'FireBoxTri', f15, px, py, 1, 0.5);
                else if (cell === 62) drawSpriteBySymbol(ctx, 'FireBoxTri', f15, px, py, -1, 0.5);
                else if (cell === 7) drawSpriteBySymbol(ctx, 'BlackBox', f15, px, py);
                else if (cell === 71) drawSpriteBySymbol(ctx, 'BlackBoxTri', f15, px, py, 1, 0.5);
                else if (cell === 72) drawSpriteBySymbol(ctx, 'BlackBoxTri', f15, px, py, -1, 0.5);
            }
        }
    }

    _drawTopWatch(elapsedMs) {
        const ctx = this.ctx;
        const data = getActiveData();
        const wm = getSpriteMeta('Watch');
        const c0 = wm?.children?.[0];
        const cLast = wm?.children?.length > 1 ? wm.children[wm.children.length - 1] : null;
        let drewClean = false;
        if (c0 && drawShapeByCid(ctx, c0.cid, 320 + (c0.tx || 0), 20 + (c0.ty || 0))) {
            drewClean = true;
            if (cLast) {
                if (data.SHAPE_METAS?.[String(cLast.cid)]) {
                    drawShapeByCid(ctx, cLast.cid, 320 + (cLast.tx || 0), 20 + (cLast.ty || 0));
                } else {
                    drawSpriteByCid(ctx, cLast.cid, 1, 320 + (cLast.tx || 0), 20 + (cLast.ty || 0));
                }
            }
        }
        if (!drewClean) {
            drawSpriteBySymbol(ctx, 'Watch', 1, 320, 20);
        }

        const totalSec = Math.floor(elapsedMs / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');

        ctx.save();
        ctx.font = 'bold 17px Georgia, "Times New Roman", serif';
        ctx.fillStyle = '#ffe57f';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 3;
        ctx.textAlign = 'center';
        ctx.fillText(`${mins} : ${secs}`, 320, 19);
        ctx.restore();
    }

    _drawMuterIcon(isMuted) {
        const ctx = this.ctx;
        drawSpriteBySymbol(ctx, 'Muter', 1, 620, 20);
        if (isMuted) {
            ctx.save();
            ctx.strokeStyle = '#ff3d00';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(610, 12);
            ctx.lineTo(626, 28);
            ctx.stroke();
            ctx.restore();
        }
    }

    _drawBottomPauseTab(world, uiState) {
        if (uiState.overlay) return;
        const ctx = this.ctx;
        const pm = getSpriteMeta('PauseMenu');
        const boardCid = pm?.children?.[1]?.cid;
        const drewBoard = boardCid && drawSpriteByCid(ctx, boardCid, 1, 320, 480 + 150.9);
        if (!drewBoard) {
            ctx.save();
            ctx.fillStyle = 'rgba(22, 18, 10, 0.85)';
            ctx.strokeStyle = '#c8a951';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(276, 458, 88, 22, 6);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
        ctx.save();
        ctx.font = 'bold 11px Georgia, serif';
        ctx.fillStyle = drewBoard ? '#2b1d03' : '#ffe57f';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSE', 320, drewBoard ? 476 : 473);
        ctx.restore();
    }

    _drawOverlayPanel(oy) {
        const ctx = this.ctx;
        const pm = getSpriteMeta('PauseMenu');
        const boardCid = pm?.children?.[1]?.cid;
        if (boardCid && drawSpriteByCid(ctx, boardCid, 1, 320, 90 + oy + 150.9)) {
            return;
        }
        ctx.save();
        ctx.fillStyle = 'rgba(26, 22, 12, 0.94)';
        ctx.strokeStyle = '#c8a951';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(140, 88 + oy, 360, 304, 14);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    _drawPauseOverlay(world, oy = 0) {
        const ctx = this.ctx;
        const alpha = Math.max(0, Math.min(1, 1 + oy / 380));
        ctx.fillStyle = `rgba(0, 0, 0, ${0.58 * alpha})`;
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

        this._drawOverlayPanel(oy);
        ctx.save();
        ctx.translate(0, oy);
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;

        ctx.font = 'bold 22px Georgia, serif';
        ctx.fillStyle = '#ffcc00';
        ctx.fillText('PAUSED', 320, 145);

        ctx.font = 'bold 20px Georgia, serif';
        ctx.fillStyle = '#e6c875';
        ctx.fillText('RETRY LEVEL', 320, 185);

        const fFrame = (this.frameTick % 40) + 1;
        drawSpriteBySymbol(ctx, 'BlueDiamond', fFrame, 288, 228, 1.1, 1.1);
        drawSpriteBySymbol(ctx, 'RedDiamond', fFrame, 288, 264, 1.1, 1.1);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffe57f';
        ctx.font = 'bold 19px Georgia, serif';
        ctx.fillText(`x  ${world.blueCount} / ${world.totalBlue}`, 310, 234);
        ctx.fillText(`x  ${world.redCount} / ${world.totalRed}`, 310, 270);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#e6c875';
        ctx.font = 'bold 20px Georgia, serif';
        ctx.fillText('MAIN MENU', 320, 325);
        ctx.fillStyle = '#a5d6a7';
        ctx.font = 'bold 16px Georgia, serif';
        ctx.fillText('▶ RESUME GAME', 320, 362);
        ctx.restore();
    }

    _drawGameOverOverlay(oy = 0) {
        const ctx = this.ctx;
        const alpha = Math.max(0, Math.min(1, 1 + oy / 380));
        ctx.fillStyle = `rgba(0, 0, 0, ${0.62 * alpha})`;
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

        this._drawOverlayPanel(oy);
        ctx.save();
        ctx.translate(0, oy);
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 5;

        ctx.font = 'bold 34px Georgia, serif';
        ctx.fillStyle = '#ff6b4a';
        ctx.fillText('GAME OVER', 320, 165);

        ctx.font = 'bold 21px Georgia, serif';
        ctx.fillStyle = '#ffe57f';
        ctx.fillText('RETRY LEVEL', 320, 235);
        ctx.fillText('SKIP LEVEL', 320, 278);
        ctx.fillText('MAIN MENU', 320, 322);
        ctx.restore();
    }

    _drawRecuentoOverlay(world, result, oy = 0) {
        const ctx = this.ctx;
        const alpha = Math.max(0, Math.min(1, 1 + oy / 380));
        ctx.fillStyle = `rgba(0, 0, 0, ${0.62 * alpha})`;
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

        this._drawOverlayPanel(oy);
        ctx.save();
        ctx.translate(0, oy);
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;

        ctx.font = 'bold 26px Georgia, serif';
        ctx.fillStyle = '#ffd54f';
        ctx.fillText('LEVEL COMPLETE!', 320, 134);

        const rankColors = { A: '#66bb6a', B: '#ffa726', C: '#ba68c8' };
        ctx.font = 'bold 42px Georgia, serif';
        ctx.fillStyle = rankColors[result?.rank] || '#ffd54f';
        ctx.fillText(result?.rank || 'A', 442, 235);

        const fFrame = (this.frameTick % 40) + 1;
        drawSpriteBySymbol(ctx, 'BlueDiamond', fFrame, 212, 188);
        drawSpriteBySymbol(ctx, 'RedDiamond', fFrame, 212, 224);

        ctx.textAlign = 'left';
        ctx.font = 'bold 18px Georgia, serif';
        ctx.fillStyle = '#ffe57f';
        ctx.fillText(`${world.blueCount} / ${world.totalBlue}`, 235, 194);
        ctx.fillText(`${world.redCount} / ${world.totalRed}`, 235, 230);
        ctx.fillText(`Time: ${result?.timeStr || '00:00'}  (Par ${result?.parStr || '00:00'})`, 202, 268);

        ctx.textAlign = 'center';
        ctx.font = 'bold 21px Georgia, serif';
        ctx.fillStyle = '#a5d6a7';
        ctx.fillText('CONTINUE ▶', 320, 344);
        ctx.restore();
    }
}
