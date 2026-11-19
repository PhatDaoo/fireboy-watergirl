// Authentic 26Hz Box2D-Equivalent Physics & Puzzle Mechanics Engine for Fireboy & Watergirl: Forest Temple
// Faithfully ports level.as, ContactListener.as, b2PrismaticJoint.as, and b2RevoluteJoint.as

import {
    BOX2D_TIMESTEP,
    BOX2D_GRAVITY,
    TILE_SIZE
} from './forest_gamedata.js';
import { soundManager } from './sound.js';

const CHAR_MASS = 0.794; // Exact sum of Box2D head circle + torso polygon + legs circle mass

export class ForestLevelWorld {
    constructor(levelKey, levelData) {
        this.levelKey = levelKey;
        this.data = levelData;
        this.grid = levelData.grid;
        this.rows = this.grid.length;
        this.cols = this.grid[0].length;

        this.pause = false;
        this.ended = false;
        this.outcome = null; // null | 'win' | 'gameover'
        this.timecount = 0;
        this.elapsedMs = 0;

        // Diamond counters
        this.totalBlue = levelData.bdCount;
        this.totalRed = levelData.rdCount;
        this.totalGreen = levelData.grCount;
        this.blueCount = 0;
        this.redCount = 0;
        this.greenCount = 0;

        // Tutorial overlay state (Adventure Level 1)
        this.hasTutorial = Boolean(levelData.hasTutorial);
        this.tutFrame = 1;
        this.tutAlpha = 1;
        this.tutPlaying = false;

        // Build static terrain collision primitives & diamonds
        this.solids = [];     // { type: 'box'|'tri', ... }
        this.hazards = [];    // { type: 'water'|'fire'|'black', x, y, w, h }
        this.diamonds = [];   // { type: 'bd'|'rd'|'gr', x, y, collected: false }
        this._buildGroundAndDiamonds();

        // Ambient bugs (3..5 random temple bugs on empty 3x3 air tiles, level.as lines 775-795)
        this.bugs = [];
        this._spawnBugs();

        // Characters: pers1 (Fireboy), pers2 (Watergirl)
        this.pers1 = this._createCharacter('pers1', levelData.startFire.x, levelData.startFire.y);
        this.pers2 = this._createCharacter('pers2', levelData.startWater.x, levelData.startWater.y);

        // Exit doors (FinishBoy & FinishGirl, level.as lines 1103-1155)
        this.finish1 = {
            x: levelData.finish.fire.x,
            y: levelData.finish.fire.y + 0.66,
            frame: 1,
            touching: false
        };
        this.finish2 = {
            x: levelData.finish.water.x,
            y: levelData.finish.water.y + 0.66,
            frame: 1,
            touching: false
        };

        // End animations (deadFire or FireBoystairs + WaterGirlStairs)
        this.deathAnim = null;  // { x, y, frame, maxFrame: 32 }
        this.stairsAnim = null; // { fireX, fireY, waterX, waterY, frame, maxFrame: 35 }

        // Dynamic mechanisms (normalized across Forest, Light, Ice, and Crystal Temples)
        this.slidePlatforms = (levelData.slidePlatforms || []).map((sp, idx) => {
            const hw = sp.halfWidth ?? (sp.halfSize ? sp.halfSize.x : 1.5);
            const hh = sp.halfHeight ?? (sp.halfSize ? sp.halfSize.y : 0.3);
            const dir = sp.axis || sp.dir || { x: 1, y: 0 };
            const len = Math.hypot(dir.x, dir.y) || 1;
            const axis = { x: dir.x / len, y: dir.y / len };
            const dist = sp.distance ?? (sp.lower !== undefined ? Math.abs(sp.lower) : 3);
            const lower = sp.lower !== undefined ? sp.lower : -dist;
            const upper = sp.upper !== undefined ? sp.upper : 0;
            return {
                ...sp,
                index: idx,
                halfWidth: hw,
                halfHeight: hh,
                axis,
                lower,
                upper,
                controlledBy: sp.controlledBy || 'pusher',
                startX: sp.pos.x,
                startY: sp.pos.y,
                x: sp.pos.x,
                y: sp.pos.y,
                prevX: sp.pos.x,
                prevY: sp.pos.y,
                vx: 0,
                vy: 0,
                jointTrans: 0,
                motorSpeed: 2,
                lightOn: false
            };
        });

        this.rotPlatforms = (levelData.rotPlatforms || []).map((rp, idx) => {
            const hh = rp.halfHeight ?? (rp.halfSize ? rp.halfSize.y : 0.3);
            const hw = rp.halfWidth ?? (rp.halfSize ? rp.halfSize.x : 1.5);
            const pivotX = rp.pos.x;
            const pivotY = rp.pos.y - hh / 2;
            const initAngle = rp.angle || 0;
            return {
                ...rp,
                index: idx,
                halfWidth: hw,
                halfHeight: hh,
                controlledBy: rp.controlledBy || 'lever',
                pivotX,
                pivotY,
                x: rp.pos.x,
                y: rp.pos.y,
                prevX: rp.pos.x,
                prevY: rp.pos.y,
                angle: initAngle,
                prevAngle: initAngle,
                jointAngle: -initAngle,
                lowerAngle: (rp.lowerAnglePi ?? -0.25) * Math.PI + 0.02,
                upperAngle: (rp.upperAnglePi ?? 0.25) * Math.PI - 0.02,
                motorSpeed: -1,
                lightOn: false
            };
        });

        this.winds = (levelData.winds || []).map((w, idx) => {
            const lower = w.lower && (w.lower.x !== 0 || w.lower.y !== 0)
                ? w.lower
                : { x: w.pos.x - 1.5, y: w.pos.y - (w.upper ? w.upper.y : 6) };
            const upper = w.upper && w.lower && (w.lower.x !== 0 || w.lower.y !== 0)
                ? w.upper
                : { x: w.pos.x + 1.5, y: w.pos.y };
            return {
                ...w,
                index: idx,
                lower,
                upper,
                dir: w.dir ?? (w.vert === false ? 2 : 1),
                on: w.alwaysOn !== undefined ? w.alwaysOn : true,
                bladeFrame: 1
            };
        });

        this.pushers = (levelData.pushers || []).map((p, idx) => ({
            ...p,
            index: idx,
            originX: p.pos.x,
            originY: p.pos.y,
            x: p.pos.x,
            y: p.pos.y,
            prevY: p.pos.y,
            depressed: 0,
            isPressed: false,
            clicker: 1
        }));

        this.timedPushers = (levelData.timedPushers || []).map((tp, idx) => ({
            ...tp,
            index: idx,
            originX: tp.pos.x,
            originY: tp.pos.y,
            x: tp.pos.x,
            y: tp.pos.y,
            prevY: tp.pos.y,
            depressed: 0,
            timer: 0,
            delay: tp.delay || 5.0,
            active: false,
            clicker: 1
        }));

        this.lightPushers = (levelData.lightPushers || []).map((lp, idx) => ({
            ...lp,
            index: idx,
            x: lp.pos.x,
            y: lp.pos.y,
            active: false,
            prevActive: false
        }));

        this.lightBeamers = (levelData.lightBeamers || []).map((lb, idx) => ({
            ...lb,
            index: idx,
            x: lb.pos.x,
            y: lb.pos.y,
            angle: lb.angle || 0,
            color: lb.color || 0xffffff,
            segments: []
        }));

        this.rotMirrors = (levelData.rotMirrors || []).map((rm, idx) => {
            const baseAngle = ((rm.angleDeg || 0) * Math.PI) / 180 + Math.PI / 4;
            return {
                ...rm,
                index: idx,
                x: rm.pos.x,
                y: rm.pos.y,
                halfLen: (rm.halfSize ? rm.halfSize.x : 0.9),
                baseAngle,
                angle: baseAngle,
                targetAngle: baseAngle,
                active: false
            };
        });

        this.infiniteMirrors = (levelData.infiniteMirrors || []).map((im, idx) => ({
            ...im,
            index: idx,
            x: im.pos.x,
            y: im.pos.y,
            halfLen: (im.halfSize ? im.halfSize.x : 0.9),
            angle: ((im.angleDeg || 0) * Math.PI) / 180 + Math.PI / 4,
            active: false
        }));

        this.movingMirrors = (levelData.movingMirrors || []).map((mm, idx) => ({
            id: `mm_${idx}`,
            index: idx,
            x: mm.pos.x,
            y: mm.pos.y,
            prevX: mm.pos.x,
            prevY: mm.pos.y,
            vx: 0,
            vy: 0,
            hx: 0.65,
            hy: 0.65,
            halfLen: 0.9,
            angle: ((mm.angleDeg || 0) * Math.PI) / 180 + Math.PI / 4
        }));

        this.mirrorSliders = (levelData.mirrorSliders || []).map((ms, idx) => {
            const rad = ((ms.angleDeg || 0) * Math.PI) / 180;
            return {
                ...ms,
                index: idx,
                startX: ms.pos.x,
                startY: ms.pos.y,
                x: ms.pos.x,
                y: ms.pos.y,
                rad,
                angle: rad + Math.PI / 4,
                halfLen: 0.9,
                progress: 0,
                active: false
            };
        });

        this.levers = (levelData.levers || []).map((lv, idx) => {
            const onSide = lv.onSide || (lv.onDir === -1 ? 'l' : 'r');
            const startSide = lv.startSide || (lv.beginOn ? onSide : (onSide === 'r' ? 'l' : 'r'));
            const initJointAngle = startSide === 'r' ? 0.2 * Math.PI : -0.2 * Math.PI;
            return {
                ...lv,
                index: idx,
                onSide,
                startSide,
                soundable: lv.soundable !== undefined ? lv.soundable : true,
                pivotX: lv.pos.x,
                pivotY: lv.pos.y + 0.6,
                jointAngle: initJointAngle,
                bodyAngle: -initJointAngle,
                prevBodyAngle: -initJointAngle,
                motorSpeed: initJointAngle > 0 ? 3 : -3,
                clicker: 1,
                lightFrame: 1
            };
        });

        this.movingBoxes = (levelData.movingBoxes || []).map((mb, idx) => ({
            id: `box_${idx}`,
            x: mb.pos.x,
            y: mb.pos.y,
            prevX: mb.pos.x,
            prevY: mb.pos.y,
            vx: 0,
            vy: 0,
            hx: mb.halfSize ? mb.halfSize.x : 0.5,
            hy: mb.halfSize ? mb.halfSize.y : 0.5,
            angle: 0,
            portalCooldown: 0
        }));

        this.movingBoxes2 = (levelData.movingBoxes2 || []).map((mb, idx) => ({
            id: `box2_${idx}`,
            x: mb.pos.x,
            y: mb.pos.y,
            prevX: mb.pos.x,
            prevY: mb.pos.y,
            vx: 0,
            vy: 0,
            hx: mb.halfSize ? mb.halfSize.x : 0.5,
            hy: mb.halfSize ? mb.halfSize.y : 0.5,
            angle: 0,
            portalCooldown: 0
        }));

        this.iceBlocks = (levelData.iceBlocks || []).map((ib, idx) => ({
            id: `ice_${idx}`,
            x: ib.pos.x,
            y: ib.pos.y,
            hx: ib.halfSize ? ib.halfSize.x : 1.0,
            hy: ib.halfSize ? ib.halfSize.y : 0.5,
            angle: ib.angle || 0,
            isIce: true
        }));

        this.balls = (levelData.balls || []).map((b, idx) => {
            const bx = b.x !== undefined ? b.x : b.pos.x;
            const by = b.y !== undefined ? b.y : b.pos.y;
            return {
                id: `ball_${idx}`,
                x: bx,
                y: by,
                prevX: bx,
                prevY: by,
                vx: 0,
                vy: 0,
                radius: b.radius || 0.47,
                angle: 0,
                prevAngle: 0,
                portalCooldown: 0
            };
        });

        this.pulleys = (levelData.pulleys || []).map((pl, idx) => {
            const len1 = pl.pos1.y - pl.anchor1.y;
            const len2 = pl.pos2.y - pl.anchor2.y;
            return {
                ...pl,
                index: idx,
                totalLen: len1 + len2,
                minLen: 2.2,
                len1,
                len2,
                vel: 0,
                p1: {
                    x: pl.pos1.x,
                    y: pl.pos1.y,
                    prevX: pl.pos1.x,
                    prevY: pl.pos1.y,
                    hx: pl.size1.y,
                    hy: pl.size1.x
                },
                p2: {
                    x: pl.pos2.x,
                    y: pl.pos2.y,
                    prevX: pl.pos2.x,
                    prevY: pl.pos2.y,
                    hx: pl.size2.y,
                    hy: pl.size2.x
                }
            };
        });

        this.hangingPlatforms = (levelData.hangingPlatforms || []).map((hp, idx) => {
            const anchor = hp.anchor || hp.pos;
            const length = hp.length ?? hp.ropeLen ?? 4;
            const dir = hp.dir || 'down';
            let px = anchor.x;
            let py = anchor.y;
            if (dir === 'down') py += length;
            else if (dir === 'up') py -= length;
            else if (dir === 'left') px -= length;
            else if (dir === 'right') px += length;
            return {
                ...hp,
                index: idx,
                anchor,
                length,
                dir,
                x: px,
                y: py,
                prevX: px,
                prevY: py,
                hx: hp.halfSize.x,
                hy: hp.halfSize.y,
                theta: 0,
                omega: 0
            };
        });

        this.romans = (levelData.romans || []).map((rm, idx) => {
            const pivotX = rm.pos.x;
            const pivotY = rm.pos.y - rm.height;
            const maxAngle = Math.min(0.38, Math.atan2(rm.height - 0.3, rm.length / 2));
            const startTilt = rm.startTilt || (rm.param2 > 0 ? 'r' : 'l');
            const initAngle = startTilt === 'r' ? maxAngle : -maxAngle;
            return {
                ...rm,
                index: idx,
                startTilt,
                baseX: rm.pos.x,
                baseY: rm.pos.y - 0.5,
                pivotX,
                pivotY,
                halfLen: rm.length / 2,
                halfThick: 0.25,
                angle: initAngle,
                prevAngle: initAngle,
                omega: 0,
                maxAngle
            };
        });

        this.portalPairs = (levelData.portalPairs || []).map((pp, idx) => ({
            ...pp,
            index: idx,
            open: pp.alwaysOn !== false,
            animFrame: 1
        }));
    }

    _createCharacter(name, x, y) {
        return {
            name,
            x,
            y,
            prevX: x,
            prevY: y,
            vx: 0,
            vy: 0,
            allowJump: false,
            prohibJump: false,
            coyoteTicks: 0,
            onIce: false,
            portalCooldown: 0,
            groundNormal: { x: 0, y: 0 },
            contacts: [],
            // Input state
            left: false,
            right: false,
            up: false,
            // Animation state (mc_1..mc_5)
            activeMc: 1,
            facing: 1, // +1 right, -1 left
            headRotDeg: 0,
            runFrame: 1,
            headFrame: 1,
            visible: true
        };
    }

    _buildGroundAndDiamonds() {
        for (let r = 0; r < this.rows; r++) {
            // Merge consecutive solid '1' or 'i' tiles on the same row into a single wide AABB to eliminate internal seam snagging
            let runStart = -1;
            let runIsIce = false;
            for (let c = 0; c <= this.cols; c++) {
                const cell = c < this.cols ? this.grid[r][c] : 0;
                const isSolidBox = (cell === 1 || cell === 'i');
                const cellIce = (cell === 'i');
                if (isSolidBox && (runStart === -1 || cellIce === runIsIce)) {
                    if (runStart === -1) {
                        runStart = c;
                        runIsIce = cellIce;
                    }
                } else {
                    if (runStart !== -1) {
                        const runEnd = c - 1;
                        const count = runEnd - runStart + 1;
                        this.solids.push({
                            type: 'box',
                            x: (runStart + runEnd) / 2,
                            y: r,
                            hx: count * 0.5,
                            hy: 0.5,
                            isIce: runIsIce
                        });
                        runStart = -1;
                    }
                    if (isSolidBox) {
                        runStart = c;
                        runIsIce = cellIce;
                    }
                }
            }

            for (let c = 0; c < this.cols; c++) {
                const cell = this.grid[r][c];
                if (cell === 'bd' || cell === 'rd' || cell === 'gr') {
                    this.diamonds.push({
                        type: cell,
                        x: c,
                        y: r,
                        collected: false
                    });
                } else if (cell === -1 || cell === 'i1') {
                    this.solids.push({
                        type: 'tri',
                        r, c,
                        kind: -1,
                        isIce: cell === 'i1',
                        verts: [
                            { x: c - 0.5, y: r + 0.5 },
                            { x: c - 0.5, y: r - 0.5 },
                            { x: c + 0.5, y: r + 0.5 }
                        ]
                    });
                } else if (cell === -2 || cell === 'i2') {
                    this.solids.push({
                        type: 'tri',
                        r, c,
                        kind: -2,
                        isIce: cell === 'i2',
                        verts: [
                            { x: c - 0.5, y: r + 0.5 },
                            { x: c + 0.5, y: r - 0.5 },
                            { x: c + 0.5, y: r + 0.5 }
                        ]
                    });
                } else if (cell === -3) {
                    this.solids.push({
                        type: 'tri',
                        r, c,
                        kind: -3,
                        verts: [
                            { x: c - 0.5, y: r - 0.5 },
                            { x: c + 0.5, y: r - 0.5 },
                            { x: c + 0.5, y: r + 0.5 }
                        ]
                    });
                } else if (cell === -4) {
                    this.solids.push({
                        type: 'tri',
                        r, c,
                        kind: -4,
                        verts: [
                            { x: c - 0.5, y: r - 0.5 },
                            { x: c + 0.5, y: r - 0.5 },
                            { x: c - 0.5, y: r + 0.5 }
                        ]
                    });
                } else if (
                    cell === 5 || cell === 51 || cell === 52 ||
                    cell === 6 || cell === 61 || cell === 62 ||
                    cell === 7 || cell === 71 || cell === 72
                ) {
                    const hazardType = (cell === 5 || cell === 51 || cell === 52)
                        ? 'water'
                        : ((cell === 6 || cell === 61 || cell === 62) ? 'fire' : 'black');

                    // Bottom half solid ground box (y + 0.25, half-height 0.25)
                    this.solids.push({
                        type: 'box',
                        x: c,
                        y: r + 0.25,
                        hx: 0.5,
                        hy: 0.25
                    });

                    // Sloped pool bank lip triangles on 51/61/71 and 52/62/72
                    if (cell === 51 || cell === 61 || cell === 71) {
                        this.solids.push({
                            type: 'tri',
                            r, c,
                            kind: 51,
                            verts: [
                                { x: c - 0.5, y: r },
                                { x: c - 0.5, y: r - 0.5 },
                                { x: c + 0.5, y: r }
                            ]
                        });
                    } else if (cell === 52 || cell === 62 || cell === 72) {
                        this.solids.push({
                            type: 'tri',
                            r, c,
                            kind: 52,
                            verts: [
                                { x: c - 0.5, y: r },
                                { x: c + 0.5, y: r - 0.5 },
                                { x: c + 0.5, y: r }
                            ]
                        });
                    }

                    // Liquid sensor region inside the basin
                    const isLeftEdge = (cell === 51 || cell === 61 || cell === 71);
                    const isRightEdge = (cell === 52 || cell === 62 || cell === 72);
                    const minX = isLeftEdge ? c - 0.1 : c - 0.45;
                    const maxX = isRightEdge ? c + 0.1 : c + 0.45;
                    this.hazards.push({
                        type: hazardType,
                        minX,
                        maxX,
                        minY: r - 0.25,
                        maxY: r + 0.15
                    });
                }
            }
        }
    }

    _spawnBugs() {
        const count = 3 + Math.round(Math.random() * 2);
        for (let i = 0; i < count; i++) {
            for (let tries = 0; tries < 200; tries++) {
                const c = 1 + Math.floor(Math.random() * (this.cols - 2));
                const r = 1 + Math.floor(Math.random() * (this.rows - 2));
                if (
                    this.grid[r][c] === 0 &&
                    this.grid[r + 1][c] === 0 &&
                    this.grid[r - 1][c] === 0 &&
                    this.grid[r][c + 1] === 0 &&
                    this.grid[r][c - 1] === 0
                ) {
                    this.bugs.push({
                        x: c * TILE_SIZE,
                        y: r * TILE_SIZE,
                        rotation: Math.random() * 360,
                        frame: 1 + Math.floor(Math.random() * 169)
                    });
                    break;
                }
            }
        }
    }

    /**
     * Step one 25fps frame (m_timeStep = 1/26).
     */
    step(inputs) {
        // Advance ambient bugs
        for (const b of this.bugs) {
            b.frame = (b.frame % 169) + 1;
        }

        // Advance death or victory stairs animations even when physics is paused at end of level
        if (this.deathAnim) {
            this.deathAnim.frame++;
            if (this.deathAnim.frame >= this.deathAnim.maxFrame && !this.outcome) {
                this.outcome = 'gameover';
            }
            return;
        }
        if (this.stairsAnim) {
            this.stairsAnim.frame++;
            if (this.stairsAnim.frame >= this.stairsAnim.maxFrame && !this.outcome) {
                this.outcome = 'win';
            }
            return;
        }

        if (this.pause || this.ended) return;

        const dt = BOX2D_TIMESTEP;
        this.timecount++;
        this.elapsedMs += 1000 / 25;

        // Snapshot previous transforms for smooth 60/120/144fps render interpolation
        this.pers1.prevX = this.pers1.x;
        this.pers1.prevY = this.pers1.y;
        this.pers2.prevX = this.pers2.x;
        this.pers2.prevY = this.pers2.y;
        for (const mb of this.movingBoxes) { mb.prevX = mb.x; mb.prevY = mb.y; }
        for (const mb2 of this.movingBoxes2) { mb2.prevX = mb2.x; mb2.prevY = mb2.y; }
        for (const mm of this.movingMirrors) { mm.prevX = mm.x; mm.prevY = mm.y; }
        for (const b of this.balls) { b.prevX = b.x; b.prevY = b.y; b.prevAngle = b.angle; }
        for (const p of this.pushers) { p.prevY = p.y; }
        for (const tp of this.timedPushers) { tp.prevY = tp.y; }
        for (const lv of this.levers) { lv.prevBodyAngle = lv.bodyAngle; }
        for (const rp of this.rotPlatforms) { rp.prevX = rp.x; rp.prevY = rp.y; rp.prevAngle = rp.angle; }
        for (const rm of this.romans) { rm.prevAngle = rm.angle; }
        for (const hp of this.hangingPlatforms) { hp.prevX = hp.x; hp.prevY = hp.y; }

        this.pers1.left = Boolean(inputs.p1.left);
        this.pers1.right = Boolean(inputs.p1.right);
        this.pers1.up = Boolean(inputs.p1.up);

        this.pers2.left = Boolean(inputs.p2.left);
        this.pers2.right = Boolean(inputs.p2.right);
        this.pers2.up = Boolean(inputs.p2.up);

        // Tutorial fade logic on Adventure 1
        if (this.hasTutorial) {
            const d1 = Math.hypot(this.pers1.x - this.data.startFire.x, this.pers1.y - this.data.startFire.y);
            const d2 = Math.hypot(this.pers2.x - this.data.startWater.x, this.pers2.y - this.data.startWater.y);
            if (d1 > 3.5 || d2 > 3.5) {
                this.tutPlaying = true;
            }
            if (this.tutPlaying) {
                if (this.tutFrame < 7) this.tutFrame += 0.35;
                this.tutAlpha = Math.max(0, this.tutAlpha - 0.08);
            }
        }

        // 1. Update levers, pushers, timedPushers, lightPushers -> actuate platforms, mirrors, winds, portals
        this._updateActuators(dt);

        // 2. Move dynamic platforms & mirrors, and trace light beams
        this._updatePlatforms(dt);
        this._updateMirrorsAndLight(dt);

        // 3. Apply character input forces & wind forces (level.as lines 1221-1611)
        this._applyCharacterControls(this.pers1, 1, dt);
        this._applyCharacterControls(this.pers2, 2, dt);
        this._applyWindForces(dt);

        // 4. Sub-step physics & collision resolution
        const subSteps = 6;
        const subDt = dt / subSteps;
        this.pers1.contacts = [];
        this.pers2.contacts = [];

        for (let s = 0; s < subSteps; s++) {
            this._integrateAndCollideDynamicObjects(subDt);
            this._integrateAndCollideCharacter(this.pers1, subDt);
            this._integrateAndCollideCharacter(this.pers2, subDt);
        }

        // 5. Finalize ground normal, ice state & character animation states (mc_1..mc_5)
        this._finalizeCharacterState(this.pers1);
        this._finalizeCharacterState(this.pers2);

        // 6. Portals, diamonds, hazards, and exit doors
        this._updatePortals(dt);
        this._checkDiamonds();
        this._checkHazards();
        this._updateFinishDoors();
    }

    _applyActuatorTarget(target, isOn, activeMap) {
        if (!target) return;
        const t = target.type;
        const idx = target.index;
        if (t === 'slidePlatform' || t === 'slide') {
            if (activeMap) activeMap.slide.add(idx);
            const sp = this.slidePlatforms[idx];
            if (sp && !activeMap) { sp.lightOn = isOn; sp.motorSpeed = isOn ? -2 : 2; }
        } else if (t === 'rotPlatform' || t === 'rot') {
            if (activeMap) activeMap.rot.add(idx);
            const rp = this.rotPlatforms[idx];
            if (rp && !activeMap) { rp.lightOn = isOn; rp.motorSpeed = isOn ? -2 : 2; }
        } else if (t === 'wind') {
            if (activeMap && isOn) activeMap.wind.add(idx);
            const w = this.winds[idx];
            if (w && !activeMap) w.on = isOn;
        } else if (t === 'rotMirror') {
            if (activeMap && isOn) activeMap.rotMirror.add(idx);
            const rm = this.rotMirrors[idx];
            if (rm && !activeMap) rm.active = isOn;
        } else if (t === 'infiniteMirror') {
            if (activeMap && isOn) activeMap.infiniteMirror.add(idx);
            const im = this.infiniteMirrors[idx];
            if (im && !activeMap) im.active = isOn;
        } else if (t === 'mirrorSlider') {
            if (activeMap && isOn) activeMap.mirrorSlider.add(idx);
            const ms = this.mirrorSliders[idx];
            if (ms && !activeMap) ms.active = isOn;
        } else if (t === 'portal') {
            if (activeMap && isOn) activeMap.portal.add(idx);
            const pp = this.portalPairs[idx];
            if (pp && !activeMap) pp.open = isOn;
        }
    }

    _updateActuators(dt) {
        // Check if characters, boxes, or balls are pressing pushers (buttons)
        const pressers = [
            { x: this.pers1.x, y: this.pers1.y + 0.8, r: 0.35 },
            { x: this.pers2.x, y: this.pers2.y + 0.8, r: 0.35 },
            ...this.movingBoxes.map((b) => ({ x: b.x, y: b.y + b.hy, r: b.hx })),
            ...this.movingBoxes2.map((b) => ({ x: b.x, y: b.y + b.hy, r: b.hx })),
            ...this.movingMirrors.map((b) => ({ x: b.x, y: b.y + b.hy, r: b.hx })),
            ...this.balls.map((b) => ({ x: b.x, y: b.y + b.radius, r: b.radius }))
        ];

        for (const sp of this.slidePlatforms) sp.lightOn = false;
        for (const rp of this.rotPlatforms) rp.lightOn = false;

        const activeMap = {
            slide: new Set(),
            rot: new Set(),
            wind: new Set(),
            rotMirror: new Set(),
            infiniteMirror: new Set(),
            mirrorSlider: new Set(),
            portal: new Set()
        };

        const applyTargets = (obj, isOn) => {
            if (obj.targets && obj.targets.length > 0) {
                for (const tg of obj.targets) this._applyActuatorTarget(tg, isOn, activeMap);
            } else if (obj.target) {
                this._applyActuatorTarget(obj.target, isOn, activeMap);
            }
        };

        for (const p of this.pushers) {
            let pressed = false;
            for (const pr of pressers) {
                if (Math.abs(pr.x - p.originX) <= 0.72 + pr.r * 0.5 && Math.abs(pr.y - (p.originY + 0.45)) <= 0.65) {
                    pressed = true;
                    break;
                }
            }
            p.isPressed = pressed;
            p.depressed = pressed ? Math.min(0.3, p.depressed + 2.0 * dt) : Math.max(0, p.depressed - 2.0 * dt);
            p.y = p.originY + p.depressed;

            const isActuated = p.depressed > 0.12;
            if (isActuated) {
                if (p.clicker === 1 && p.soundable) soundManager.play('Pusher_Sound', 0.65);
                p.clicker = -1;
                applyTargets(p, true);
            } else {
                p.clicker = 1;
            }
        }

        for (const tp of this.timedPushers) {
            let pressed = false;
            for (const pr of pressers) {
                if (Math.abs(pr.x - tp.originX) <= 0.72 + pr.r * 0.5 && Math.abs(pr.y - (tp.originY + 0.45)) <= 0.65) {
                    pressed = true;
                    break;
                }
            }
            if (pressed) {
                tp.timer = tp.delay;
                tp.depressed = Math.min(0.3, tp.depressed + 2.0 * dt);
            } else {
                tp.timer = Math.max(0, tp.timer - dt);
                tp.depressed = Math.max(0, tp.depressed - 2.0 * dt);
            }
            tp.y = tp.originY + tp.depressed;
            tp.active = tp.timer > 0;
            if (tp.active) {
                if (tp.clicker === 1 && tp.soundable) soundManager.play('Pusher_Sound', 0.65);
                tp.clicker = -1;
                applyTargets(tp, true);
            } else {
                tp.clicker = 1;
            }
        }

        for (const lp of this.lightPushers) {
            if (lp.active) {
                applyTargets(lp, true);
            }
        }

        for (const sp of this.slidePlatforms) {
            if (sp.controlledBy === 'pusher' || activeMap.slide.has(sp.index)) {
                const active = activeMap.slide.has(sp.index);
                sp.lightOn = active;
                sp.motorSpeed = active ? -2 : 2;
            }
        }
        for (const rp of this.rotPlatforms) {
            if (rp.controlledBy === 'pusher' || activeMap.rot.has(rp.index)) {
                const active = activeMap.rot.has(rp.index);
                rp.lightOn = active;
                rp.motorSpeed = active ? 2 : -2;
            }
        }
        for (const rm of this.rotMirrors) rm.active = activeMap.rotMirror.has(rm.index);
        for (const im of this.infiniteMirrors) im.active = activeMap.infiniteMirror.has(im.index);
        for (const ms of this.mirrorSliders) ms.active = activeMap.mirrorSlider.has(ms.index);
        for (const w of this.winds) {
            if (w.alwaysOn === false) w.on = activeMap.wind.has(w.index);
        }
        for (const pp of this.portalPairs) {
            if (pp.alwaysOn === false) pp.open = activeMap.portal.has(pp.index);
        }

        // Levers: check character collision pushing lever handle left or right
        for (const lv of this.levers) {
            for (const ch of [this.pers1, this.pers2]) {
                const dx = ch.x - lv.pos.x;
                const dy = (ch.y + 0.2) - lv.pos.y;
                if (Math.abs(dx) < 0.85 && Math.abs(dy) < 0.95) {
                    // If character is moving left or standing to the right of lever handle while pressing left
                    if (ch.vx < -0.5 || (ch.left && dx > -0.2)) {
                        // Push handle left -> bodyAngle < 0 -> jointAngle > 0
                        lv.jointAngle = Math.min(0.2 * Math.PI, lv.jointAngle + 9 * dt);
                    } else if (ch.vx > 0.5 || (ch.right && dx < 0.2)) {
                        // Push handle right -> bodyAngle > 0 -> jointAngle < 0
                        lv.jointAngle = Math.max(-0.2 * Math.PI, lv.jointAngle - 9 * dt);
                    }
                }
            }

            // Group levers that share the exact same coordinates (1 physical lever controlling multiple targets)
            for (const other of this.levers) {
                if (other !== lv && Math.abs(other.pos.x - lv.pos.x) < 0.05 && Math.abs(other.pos.y - lv.pos.y) < 0.05) {
                    other.jointAngle = lv.jointAngle;
                }
            }

            // Motor snaps lever toward its current side (+0.2*PI or -0.2*PI)
            if (lv.jointAngle >= 0) {
                lv.jointAngle = Math.min(0.2 * Math.PI, lv.jointAngle + 3 * dt);
            } else {
                lv.jointAngle = Math.max(-0.2 * Math.PI, lv.jointAngle - 3 * dt);
            }
            lv.bodyAngle = -lv.jointAngle;

            // Check level.as line 1732 condition:
            // onis == "r" && GetJointAngle() < 0 || onis == "l" && GetJointAngle() > 0
            const isOn = (lv.onSide === 'r' && lv.jointAngle < 0) || (lv.onSide === 'l' && lv.jointAngle > 0);
            lv.lightFrame = isOn ? 2 : 1;

            if (isOn) {
                if (lv.clicker === 1 && lv.soundable) {
                    soundManager.play('Lever_Sound', 0.7);
                }
                lv.clicker = -1;
            } else {
                if (lv.clicker === -1 && lv.soundable) {
                    soundManager.play('Lever_Sound', 0.7);
                }
                lv.clicker = 1;
            }

            if (lv.targets && lv.targets.length > 0) {
                for (const tg of lv.targets) this._applyActuatorTarget(tg, isOn, null);
            } else if (lv.target) {
                this._applyActuatorTarget(lv.target, isOn, null);
            }
        }
    }

    _updateMirrorsAndLight(dt) {
        // 1. Update RotMirrors (smooth 90-degree rotation)
        for (const rm of this.rotMirrors) {
            const delta = rm.inverted ? -Math.PI / 2 : Math.PI / 2;
            rm.targetAngle = rm.active ? rm.baseAngle + delta : rm.baseAngle;
            const diff = rm.targetAngle - rm.angle;
            rm.angle += Math.max(-2.6 * dt, Math.min(2.6 * dt, diff));
        }

        // 2. Update InfiniteMirrors (continuous rotation when active)
        for (const im of this.infiniteMirrors) {
            if (im.active) {
                im.angle += 1.4 * dt;
            }
        }

        // 3. Update MirrorSliders (slide along rail)
        for (const ms of this.mirrorSliders) {
            const targetP = ms.active ? 1 : 0;
            const diff = targetP - ms.progress;
            ms.progress += Math.max(-0.9 * dt, Math.min(0.9 * dt, diff));
            ms.x = ms.startX + Math.cos(ms.rad) * ms.length * ms.progress;
            ms.y = ms.startY + Math.sin(ms.rad) * ms.length * ms.progress;
        }

        // 4. Reset lightPushers before raytracing
        for (const lp of this.lightPushers) {
            lp.prevActive = lp.active;
            lp.active = false;
        }

        if (this.lightBeamers.length === 0) return;

        // Collect all mirror line segments
        const mirrors = [];
        const pushMirror = (x, y, angle, halfLen) => {
            const dx = Math.cos(angle) * halfLen;
            const dy = Math.sin(angle) * halfLen;
            mirrors.push({ x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy, nx: -Math.sin(angle), ny: Math.cos(angle) });
        };
        for (const rm of this.rotMirrors) pushMirror(rm.x, rm.y, rm.angle, rm.halfLen);
        for (const im of this.infiniteMirrors) pushMirror(im.x, im.y, im.angle, im.halfLen);
        for (const mm of this.movingMirrors) pushMirror(mm.x, mm.y, mm.angle, mm.halfLen);
        for (const ms of this.mirrorSliders) pushMirror(ms.x, ms.y, ms.angle, ms.halfLen);

        // Ray-segment intersection helper
        const raySeg = (ox, oy, dx, dy, x1, y1, x2, y2) => {
            const sx = x2 - x1;
            const sy = y2 - y1;
            const denom = dx * sy - dy * sx;
            if (Math.abs(denom) < 1e-6) return null;
            const qpx = x1 - ox;
            const qpy = y1 - oy;
            const t = (qpx * sy - qpy * sx) / denom;
            const u = (qpx * dy - qpy * dx) / denom;
            if (t > 0.04 && u >= 0 && u <= 1) return t;
            return null;
        };

        // Ray-AABB intersection helper
        const rayBox = (ox, oy, dx, dy, bx, by, hx, hy) => {
            const invX = Math.abs(dx) > 1e-6 ? 1 / dx : 1e9;
            const invY = Math.abs(dy) > 1e-6 ? 1 / dy : 1e9;
            const t1 = (bx - hx - ox) * invX;
            const t2 = (bx + hx - ox) * invX;
            const t3 = (by - hy - oy) * invY;
            const t4 = (by + hy - oy) * invY;
            const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
            const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
            if (tmax < 0 || tmin > tmax || tmax < 0.04) return null;
            return tmin > 0.04 ? tmin : tmax;
        };

        // Ray-circle intersection helper
        const rayCircle = (ox, oy, dx, dy, cx, cy, r) => {
            const fx = ox - cx;
            const fy = oy - cy;
            const b = 2 * (fx * dx + fy * dy);
            const c = fx * fx + fy * fy - r * r;
            const disc = b * b - 4 * c;
            if (disc < 0) return null;
            const sq = Math.sqrt(disc);
            const t1 = (-b - sq) * 0.5;
            if (t1 > 0.04) return t1;
            const t2 = (-b + sq) * 0.5;
            return t2 > 0.04 ? t2 : null;
        };

        for (const lb of this.lightBeamers) {
            lb.segments = [];
            let ox = lb.x - 0.3 * Math.cos(lb.angle);
            let oy = lb.y - 0.3 * Math.sin(lb.angle);
            let dx = Math.cos(lb.angle);
            let dy = Math.sin(lb.angle);

            for (let bounce = 0; bounce < 10; bounce++) {
                let bestT = 60.0;
                let hitType = 'max';
                let hitObj = null;

                // Check solid tiles
                for (const s of this.solids) {
                    if (s.type === 'box') {
                        const t = rayBox(ox, oy, dx, dy, s.x, s.y, s.hx, s.hy);
                        if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                    } else if (s.type === 'tri') {
                        for (let i = 0; i < 3; i++) {
                            const v1 = s.verts[i], v2 = s.verts[(i + 1) % 3];
                            const t = raySeg(ox, oy, dx, dy, v1.x, v1.y, v2.x, v2.y);
                            if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                        }
                    }
                }

                // Check dynamic boxes & crates
                for (const mb of this.movingBoxes) {
                    const t = rayBox(ox, oy, dx, dy, mb.x, mb.y, mb.hx, mb.hy);
                    if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                }
                for (const mb2 of this.movingBoxes2) {
                    const t = rayBox(ox, oy, dx, dy, mb2.x, mb2.y, mb2.hx, mb2.hy);
                    if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                }
                for (const sp of this.slidePlatforms) {
                    const t = rayBox(ox, oy, dx, dy, sp.x, sp.y, sp.halfWidth, sp.halfHeight);
                    if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                }

                // Check characters blocking beam
                for (const ch of [this.pers1, this.pers2]) {
                    const t = rayBox(ox, oy, dx, dy, ch.x, ch.y, 0.36, 0.72);
                    if (t !== null && t < bestT) { bestT = t; hitType = 'solid'; }
                }

                // Check mirrors
                for (const m of mirrors) {
                    const t = raySeg(ox, oy, dx, dy, m.x1, m.y1, m.x2, m.y2);
                    if (t !== null && t < bestT) {
                        bestT = t;
                        hitType = 'mirror';
                        hitObj = m;
                    }
                }

                // Check open portals
                for (const pp of this.portalPairs) {
                    if (!pp.open) continue;
                    const t1 = rayCircle(ox, oy, dx, dy, pp.pos1.x, pp.pos1.y, 0.65);
                    if (t1 !== null && t1 < bestT) {
                        bestT = t1;
                        hitType = 'portal';
                        hitObj = { from: pp.pos1, fromOri: pp.ori1, to: pp.pos2, toOri: pp.ori2 };
                    }
                    const t2 = rayCircle(ox, oy, dx, dy, pp.pos2.x, pp.pos2.y, 0.65);
                    if (t2 !== null && t2 < bestT) {
                        bestT = t2;
                        hitType = 'portal';
                        hitObj = { from: pp.pos2, fromOri: pp.ori2, to: pp.pos1, toOri: pp.ori1 };
                    }
                }

                const hx = ox + dx * bestT;
                const hy = oy + dy * bestT;
                lb.segments.push({ x1: ox, y1: oy, x2: hx, y2: hy });

                // Check if segment intersects any lightPusher sensor
                for (const lp of this.lightPushers) {
                    if (lp.color && lb.color && lp.color !== lb.color && lb.color !== 0xffffff && lp.color !== 0xffffff) {
                        continue;
                    }
                    const tSensor = rayCircle(ox, oy, dx, dy, lp.x, lp.y, 0.7);
                    if (tSensor !== null && tSensor <= bestT + 0.15) {
                        lp.active = true;
                    }
                }

                if (hitType === 'mirror' && hitObj) {
                    const dot = dx * hitObj.nx + dy * hitObj.ny;
                    dx = dx - 2 * dot * hitObj.nx;
                    dy = dy - 2 * dot * hitObj.ny;
                    ox = hx + dx * 0.05;
                    oy = hy + dy * 0.05;
                } else if (hitType === 'portal' && hitObj) {
                    const dAng = ((hitObj.toOri - hitObj.fromOri) * Math.PI) / 180;
                    const cosA = Math.cos(dAng), sinA = Math.sin(dAng);
                    const ndx = dx * cosA - dy * sinA;
                    const ndy = dx * sinA + dy * cosA;
                    dx = ndx;
                    dy = ndy;
                    ox = hitObj.to.x + dx * 0.75;
                    oy = hitObj.to.y + dy * 0.75;
                } else {
                    break;
                }
            }
        }
    }

    _updatePortals(dt) {
        for (const pp of this.portalPairs) {
            if (pp.open) pp.animFrame = (pp.animFrame % 20) + 1;
        }
        const travelers = [
            ...([this.pers1, this.pers2]),
            ...this.movingBoxes,
            ...this.movingBoxes2,
            ...this.movingMirrors,
            ...this.balls
        ];
        for (const obj of travelers) {
            if (obj.portalCooldown > 0) {
                obj.portalCooldown = Math.max(0, obj.portalCooldown - dt);
                continue;
            }
            for (const pp of this.portalPairs) {
                if (!pp.open) continue;
                const d1 = Math.hypot(obj.x - pp.pos1.x, obj.y - pp.pos1.y);
                const d2 = Math.hypot(obj.x - pp.pos2.x, obj.y - pp.pos2.y);
                if (d1 < 0.75) {
                    const dAng = ((pp.ori2 - pp.ori1) * Math.PI) / 180;
                    const cosA = Math.cos(dAng), sinA = Math.sin(dAng);
                    const nvx = obj.vx * cosA - obj.vy * sinA;
                    const nvy = obj.vx * sinA + obj.vy * cosA;
                    obj.vx = nvx;
                    obj.vy = nvy;
                    obj.x = pp.pos2.x + Math.cos((pp.ori2 * Math.PI) / 180) * 0.85;
                    obj.y = pp.pos2.y + Math.sin((pp.ori2 * Math.PI) / 180) * 0.85;
                    obj.prevX = obj.x;
                    obj.prevY = obj.y;
                    obj.portalCooldown = 0.55;
                    soundManager.play('PortalTransport_Sound', 0.6);
                    break;
                } else if (d2 < 0.75) {
                    const dAng = ((pp.ori1 - pp.ori2) * Math.PI) / 180;
                    const cosA = Math.cos(dAng), sinA = Math.sin(dAng);
                    const nvx = obj.vx * cosA - obj.vy * sinA;
                    const nvy = obj.vx * sinA + obj.vy * cosA;
                    obj.vx = nvx;
                    obj.vy = nvy;
                    obj.x = pp.pos1.x + Math.cos((pp.ori1 * Math.PI) / 180) * 0.85;
                    obj.y = pp.pos1.y + Math.sin((pp.ori1 * Math.PI) / 180) * 0.85;
                    obj.prevX = obj.x;
                    obj.prevY = obj.y;
                    obj.portalCooldown = 0.55;
                    soundManager.play('PortalTransport_Sound', 0.6);
                    break;
                }
            }
        }
    }

    _updatePlatforms(dt) {
        // 1. Sliding platforms
        for (const sp of this.slidePlatforms) {
            sp.prevX = sp.x;
            sp.prevY = sp.y;

            const prevTrans = sp.jointTrans;
            let nextTrans = Math.max(sp.lower, Math.min(sp.upper, prevTrans + sp.motorSpeed * dt));

            // Remember from b2PrismaticJoint.as: jointTrans = axis . (startPos - pos) => pos = startPos - axis * jointTrans
            const nextX = sp.startX - sp.axis.x * nextTrans;
            const nextY = sp.startY - sp.axis.y * nextTrans;

            // Check if a movingBox or ball is blocking the platform from closing
            let blocked = false;
            for (const mb of this.movingBoxes) {
                if (
                    Math.abs(mb.x - nextX) < sp.halfWidth + mb.hx - 0.08 &&
                    Math.abs(mb.y - nextY) < sp.halfHeight + mb.hy - 0.08
                ) {
                    // If moving downward onto a box on floor, or horizontally into a box against wall
                    if (nextY > sp.y && mb.y > sp.y) blocked = true;
                }
            }

            if (!blocked) {
                sp.jointTrans = nextTrans;
                sp.x = nextX;
                sp.y = nextY;
            }
            sp.vx = (sp.x - sp.prevX) / dt;
            sp.vy = (sp.y - sp.prevY) / dt;

            // Carry characters & boxes standing on top of this slidePlatform
            const dx = sp.x - sp.prevX;
            const dy = sp.y - sp.prevY;
            if (dx !== 0 || dy !== 0) {
                this._carryOnPlatform(sp.prevX, sp.prevY, sp.halfWidth, sp.halfHeight, dx, dy);
            }
        }

        // 2. Rotating platforms
        for (const rp of this.rotPlatforms) {
            rp.jointAngle = Math.max(rp.lowerAngle, Math.min(rp.upperAngle, rp.jointAngle + rp.motorSpeed * dt));
            rp.angle = -rp.jointAngle;
            // Center of platform rotates around pivot (pivotX, pivotY) at local offset (0, +halfHeight/2)
            const r = rp.halfHeight / 2;
            rp.x = rp.pivotX - r * Math.sin(rp.angle);
            rp.y = rp.pivotY + r * Math.cos(rp.angle);
        }

        // 3. Pulleys (coupled platforms where len1 + len2 = totalLen)
        for (const pl of this.pulleys) {
            pl.p1.prevX = pl.p1.x;
            pl.p1.prevY = pl.p1.y;
            pl.p2.prevX = pl.p2.x;
            pl.p2.prevY = pl.p2.y;

            let mass1 = 0;
            let mass2 = 0;
            const checkLoad = (plat, objX, objBottomY, objMass) => {
                if (
                    Math.abs(objX - plat.x) <= plat.hx + 0.35 &&
                    Math.abs(objBottomY - (plat.y - plat.hy)) <= 0.35
                ) {
                    return objMass;
                }
                return 0;
            };

            for (const ch of [this.pers1, this.pers2]) {
                mass1 += checkLoad(pl.p1, ch.x, ch.y + 0.8, 1.0);
                mass2 += checkLoad(pl.p2, ch.x, ch.y + 0.8, 1.0);
            }
            for (const mb of this.movingBoxes) {
                mass1 += checkLoad(pl.p1, mb.x, mb.y + mb.hy, 1.2);
                mass2 += checkLoad(pl.p2, mb.x, mb.y + mb.hy, 1.2);
            }
            for (const b of this.balls) {
                mass1 += checkLoad(pl.p1, b.x, b.y + b.radius, 1.1);
                mass2 += checkLoad(pl.p2, b.x, b.y + b.radius, 1.1);
            }

            const diff = mass1 - mass2;
            pl.vel += diff * 8.5 * dt;
            pl.vel *= 0.9;

            const maxLen = pl.totalLen - pl.minLen;
            pl.len1 = Math.max(pl.minLen, Math.min(maxLen, pl.len1 + pl.vel * dt));
            if (pl.len1 <= pl.minLen || pl.len1 >= maxLen) {
                pl.vel = 0;
            }
            pl.len2 = pl.totalLen - pl.len1;

            pl.p1.y = pl.anchor1.y + pl.len1;
            pl.p2.y = pl.anchor2.y + pl.len2;

            this._carryOnPlatform(pl.p1.prevX, pl.p1.prevY, pl.p1.hx, pl.p1.hy, 0, pl.p1.y - pl.p1.prevY);
            this._carryOnPlatform(pl.p2.prevX, pl.p2.prevY, pl.p2.hx, pl.p2.hy, 0, pl.p2.y - pl.p2.prevY);
        }

        // 4. Hanging platforms (gentle pendulum sway when stood upon or pushed)
        for (const hp of this.hangingPlatforms) {
            if (hp.dir === 'down') {
                let pushTorque = 0;
                const topY = hp.y - hp.hy;
                for (const ch of [this.pers1, this.pers2]) {
                    if (Math.abs(ch.x - hp.x) <= hp.hx + 0.35 && Math.abs((ch.y + 0.8) - topY) <= 0.3) {
                        pushTorque += (ch.vx * 0.28 + (ch.x - hp.x) * 0.12);
                    }
                }
                hp.omega += (-16.0 * Math.sin(hp.theta) + pushTorque) * dt;
                hp.omega *= 0.94;
                hp.theta = Math.max(-0.28, Math.min(0.28, hp.theta + hp.omega * dt));

                const nextX = hp.anchor.x + hp.length * Math.sin(hp.theta);
                const nextY = hp.anchor.y + hp.length * Math.cos(hp.theta);
                const dx = nextX - hp.x;
                const dy = nextY - hp.y;
                hp.x = nextX;
                hp.y = nextY;
                if (dx !== 0 || dy !== 0) {
                    this._carryOnPlatform(hp.x - dx, hp.y - dy, hp.hx, hp.hy, dx, dy);
                }
            }
        }

        // 5. Romans (seesaws)
        for (const rm of this.romans) {
            let torque = 0;
            for (const ch of [this.pers1, this.pers2]) {
                const dx = ch.x - rm.pivotX;
                const beamY = rm.pivotY + dx * Math.tan(rm.angle);
                if (Math.abs(dx) <= rm.halfLen + 0.4 && Math.abs((ch.y + 0.8) - beamY) <= 0.65) {
                    torque += dx * 1.8;
                }
            }
            for (const b of this.balls) {
                const dx = b.x - rm.pivotX;
                const beamY = rm.pivotY + dx * Math.tan(rm.angle);
                if (Math.abs(dx) <= rm.halfLen + 0.4 && Math.abs((b.y + b.radius) - beamY) <= 0.65) {
                    torque += dx * 2.2;
                }
            }
            rm.omega += torque * dt;
            rm.omega *= 0.88;
            rm.angle = Math.max(-rm.maxAngle, Math.min(rm.maxAngle, rm.angle + rm.omega * dt));
            if (Math.abs(rm.angle) >= rm.maxAngle) rm.omega = 0;
        }
    }

    _carryOnPlatform(platX, platY, hx, hy, dx, dy) {
        const topY = platY - hy;
        for (const ch of [this.pers1, this.pers2]) {
            if (Math.abs(ch.x - platX) <= hx + 0.3 && Math.abs((ch.y + 0.8) - topY) <= 0.28) {
                ch.x += dx;
                ch.y += dy;
            }
        }
        for (const mb of [...this.movingBoxes, ...this.movingBoxes2, ...this.movingMirrors]) {
            if (Math.abs(mb.x - platX) <= hx + mb.hx * 0.8 && Math.abs((mb.y + mb.hy) - topY) <= 0.25) {
                mb.x += dx;
                mb.y += dy;
            }
        }
    }

    _applyCharacterControls(ch, playerNum, dt) {
        // Find steepest upward normal from previous step contacts (level.as lines 1222-1235)
        let bestNormal = { x: 0, y: 0 };
        let onIce = false;
        for (const c of ch.contacts) {
            if (c.y < bestNormal.y) {
                bestNormal = { x: c.x, y: c.y };
            }
            if (c.y < -0.2 && c.isIce) {
                onIce = true;
            }
        }
        ch.groundNormal = bestNormal;
        ch.onIce = onIce;
        ch.allowJump = bestNormal.y < -0.2;

        // Horizontal movement force along slope tangent
        let n = (bestNormal.x === 0 && bestNormal.y === 0) ? { x: 0, y: -1 } : { x: bestNormal.x, y: bestNormal.y };
        const maxVx = onIce ? (playerNum === 1 ? 12 : 2) : 7;
        const accelScale = onIce ? (playerNum === 1 ? 25 : 10) : 17;

        if (ch.right && ch.vx < maxVx) {
            let fx = -n.y * accelScale;
            let fy = n.x * accelScale;
            if (bestNormal.x !== 0 || bestNormal.y !== 0) {
                if (fy < 0 && fy > -14) fx += 12;
                if (fy < -14) fy = 0;
            }
            if (!onIce && ch.vx < 0) fx *= 3;
            ch.vx += (fx / CHAR_MASS) * dt;
            ch.vy += (fy / CHAR_MASS) * dt;
        } else if (ch.left && ch.vx > -maxVx) {
            let fx = n.y * accelScale;
            let fy = -n.x * accelScale;
            if (bestNormal.x !== 0 || bestNormal.y !== 0) {
                if (fy < 0 && fy > -14) fx -= 12;
                if (fy < -14) fy = 0;
            }
            if (!onIce && ch.vx > 0) fx *= 3;
            ch.vx += (fx / CHAR_MASS) * dt;
            ch.vy += (fy / CHAR_MASS) * dt;
        }
        if (onIce && playerNum === 2) {
            if (ch.vx > 2) ch.vx = 2;
            if (ch.vx < -2) ch.vx = -2;
        }

        if (!ch.right && !ch.left && ch.vx !== 0) {
            const brakeFactor = (onIce && playerNum === 1) ? 1 : 7;
            const brakeFx = -ch.vx * brakeFactor;
            ch.vx += (brakeFx / CHAR_MASS) * dt;
            if (Math.abs(ch.vx) < 0.15) ch.vx = 0;
        }

        // Jump (level.as lines 1359-1369)
        if (!ch.prohibJump && ch.allowJump && ch.up) {
            if (!onIce) {
                soundManager.play(playerNum === 1 ? 'Jump1_Sound' : 'Jump2_Sound', 0.6);
                ch.vy = -13.5;
            } else {
                ch.vy = -3.0;
            }
            ch.prohibJump = true;
            ch.allowJump = false;
        }
        if (!ch.up) {
            ch.prohibJump = false;
        }
    }

    _applyWindForces(dt) {
        let anyWindSound = false;
        for (const w of this.winds) {
            if (!w.on) continue;
            w.bladeFrame = (w.bladeFrame % 3) + 1;
            if (w.soundable) anyWindSound = true;

            for (const ch of [this.pers1, this.pers2]) {
                // Check AABB [lower, upper]
                if (
                    ch.x + 0.4 >= w.lower.x && ch.x - 0.4 <= w.upper.x &&
                    ch.y + 0.8 >= w.lower.y && ch.y - 0.8 <= w.upper.y
                ) {
                    let fx = 0;
                    let fy = 0;
                    if (w.dir === 1) {
                        fy = -Math.min(1 / Math.max(0.1, Math.abs(ch.y - w.upper.y)), 0.4);
                    } else if (w.dir === 2) {
                        fx = Math.min(1 / Math.max(0.1, Math.abs(ch.x - w.lower.x)), 0.4);
                    } else if (w.dir === 3) {
                        fy = Math.min(1 / Math.max(0.1, Math.abs(ch.y - w.upper.y)), 0.4);
                    } else if (w.dir === 4) {
                        fx = -Math.min(1 / Math.max(0.1, Math.abs(ch.x - w.upper.x)), 0.4);
                    }
                    const multX = Math.abs(w.upper.x - w.lower.x) * 13 + 20 * (Math.sin(this.timecount / 10) + 1);
                    const multY = Math.abs(w.upper.y - w.lower.y) * 13 + 20 * (Math.sin(this.timecount / 10) + 1);
                    fx *= multX;
                    fy *= multY;

                    ch.vx = (ch.vx + (fx / CHAR_MASS) * dt) * 0.95;
                    ch.vy = (ch.vy + (fy / CHAR_MASS) * dt) * 0.95;
                }
            }
        }

        if (anyWindSound) {
            soundManager.startLoop('wind_loop', 'Wind_Sound', 0.28);
        } else {
            soundManager.stopLoop('wind_loop');
        }
    }

    _getAllDynamicBoxes() {
        const list = [];
        for (const sp of this.slidePlatforms) {
            list.push({ x: sp.x, y: sp.y, hx: sp.halfWidth, hy: sp.halfHeight, vx: sp.vx, vy: sp.vy });
        }
        for (const pl of this.pulleys) {
            list.push({ x: pl.p1.x, y: pl.p1.y, hx: pl.p1.hx, hy: pl.p1.hy, vx: 0, vy: 0 });
            list.push({ x: pl.p2.x, y: pl.p2.y, hx: pl.p2.hx, hy: pl.p2.hy, vx: 0, vy: 0 });
        }
        for (const hp of this.hangingPlatforms) {
            list.push({ x: hp.x, y: hp.y, hx: hp.hx, hy: hp.hy, vx: 0, vy: 0 });
        }
        for (const ib of this.iceBlocks) {
            list.push({ x: ib.x, y: ib.y, hx: ib.hx, hy: ib.hy, vx: 0, vy: 0, isIce: true });
        }
        return list;
    }

    _integrateAndCollideDynamicObjects(subDt) {
        const dynBoxes = this._getAllDynamicBoxes();

        // 1. MovingBoxes (crates), MovingBoxes2, MovingMirrors
        for (const mb of [...this.movingBoxes, ...this.movingBoxes2, ...this.movingMirrors]) {
            mb.vy += BOX2D_GRAVITY * subDt;
            mb.vx *= Math.pow(0.15, subDt); // linearDamping = 2 + friction
            mb.x += mb.vx * subDt;
            mb.y += mb.vy * subDt;

            // Collide box as 4 corner circles of radius 0.35 + center so it slides smoothly over slopes
            const r = Math.min(mb.hx, mb.hy);
            const res = this._resolveCircleWorldCollision(mb.x, mb.y, r, dynBoxes, false);
            mb.x = res.x;
            mb.y = res.y;
            for (const n of res.normals) {
                const vn = mb.vx * n.x + mb.vy * n.y;
                if (vn < 0) {
                    mb.vx -= vn * n.x;
                    mb.vy -= vn * n.y;
                }
            }
        }

        // 2. Balls
        for (const b of this.balls) {
            b.vy += BOX2D_GRAVITY * subDt;
            b.vx *= Math.pow(0.82, subDt);
            b.x += b.vx * subDt;
            b.y += b.vy * subDt;

            const res = this._resolveCircleWorldCollision(b.x, b.y, b.radius, dynBoxes, true);
            b.x = res.x;
            b.y = res.y;
            for (const n of res.normals) {
                const vn = b.vx * n.x + b.vy * n.y;
                if (vn < 0) {
                    b.vx -= (1 + 0.1) * vn * n.x;
                    b.vy -= (1 + 0.1) * vn * n.y;
                }
                // Roll down slopes
                if (n.y < -0.2 && Math.abs(n.x) > 0.2) {
                    b.vx += n.x * 14 * subDt;
                }
            }
            b.angle += (b.vx * subDt) / b.radius;
        }
    }

    _integrateAndCollideCharacter(ch, subDt) {
        ch.vy += BOX2D_GRAVITY * subDt;
        ch.x += ch.vx * subDt;
        ch.y += ch.vy * subDt;

        const dynBoxes = this._getAllDynamicBoxes();

        // Push / collide with MovingBoxes, MovingBoxes2, MovingMirrors
        for (const mb of [...this.movingBoxes, ...this.movingBoxes2, ...this.movingMirrors]) {
            const dx = ch.x - mb.x;
            const dy = ch.y - mb.y;
            const overlapX = (0.42 + mb.hx) - Math.abs(dx);
            const overlapY = (0.78 + mb.hy) - Math.abs(dy);
            if (overlapX > 0 && overlapY > 0) {
                if (overlapX < overlapY) {
                    const sign = dx >= 0 ? 1 : -1;
                    // Character pushes the box horizontally
                    ch.x += sign * overlapX * 0.55;
                    mb.x -= sign * overlapX * 0.45;
                    mb.vx = ch.vx * 0.75;
                    ch.contacts.push({ x: sign, y: 0 });
                } else {
                    const sign = dy >= 0 ? 1 : -1;
                    ch.y += sign * overlapY;
                    if (sign < 0 && ch.vy > 0) {
                        ch.vy = 0;
                        ch.contacts.push({ x: 0, y: -1 });
                    } else if (sign > 0 && ch.vy < 0) {
                        ch.vy = 0;
                    }
                }
            }
        }

        // Push / collide with Balls
        for (const b of this.balls) {
            // Check against character legs (y + 0.5, r=0.3) and head (y - 0.3, r=0.5)
            for (const part of [{ oy: 0.5, r: 0.3, isLegs: true }, { oy: -0.3, r: 0.48, isLegs: false }]) {
                const dx = ch.x - b.x;
                const dy = (ch.y + part.oy) - b.y;
                const dist = Math.hypot(dx, dy);
                const minDist = part.r + b.radius;
                if (dist > 0.0001 && dist < minDist) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const pen = minDist - dist;
                    ch.x += nx * pen * 0.45;
                    ch.y += ny * pen * 0.45;
                    b.x -= nx * pen * 0.55;
                    b.y -= ny * pen * 0.55;
                    b.vx += -nx * 3.5;
                    const vn = ch.vx * nx + ch.vy * ny;
                    if (vn < 0) {
                        ch.vx -= vn * nx * 0.5;
                        ch.vy -= vn * ny * 0.5;
                    }
                    if (part.isLegs) {
                        ch.contacts.push({ x: nx, y: ny });
                    }
                }
            }
        }

        // Collide character compound shape (head circle at y-0.3 r=0.46, middle circle at y+0.1 r=0.38, legs circle at y+0.5 r=0.3)
        // 1) Legs circle (y + 0.5, r = 0.3) -> records ground contacts!
        const legsRes = this._resolveCircleWorldCollision(ch.x, ch.y + 0.5, 0.3, dynBoxes, true);
        ch.x = legsRes.x;
        ch.y = legsRes.y - 0.5;
        for (const n of legsRes.normals) {
            ch.contacts.push(n);
            const vn = ch.vx * n.x + ch.vy * n.y;
            if (vn < 0) {
                ch.vx -= vn * n.x;
                ch.vy -= vn * n.y;
            }
        }

        // 2) Waist circle (y + 0.1, r = 0.38)
        const waistRes = this._resolveCircleWorldCollision(ch.x, ch.y + 0.1, 0.38, dynBoxes, true);
        ch.x = waistRes.x;
        ch.y = waistRes.y - 0.1;
        for (const n of waistRes.normals) {
            const vn = ch.vx * n.x + ch.vy * n.y;
            if (vn < 0) {
                ch.vx -= vn * n.x;
                ch.vy -= vn * n.y;
            }
        }

        // 3) Head circle (y - 0.3, r = 0.46)
        const headRes = this._resolveCircleWorldCollision(ch.x, ch.y - 0.3, 0.46, dynBoxes, true);
        ch.x = headRes.x;
        ch.y = headRes.y + 0.3;
        for (const n of headRes.normals) {
            const vn = ch.vx * n.x + ch.vy * n.y;
            if (vn < 0) {
                ch.vx -= vn * n.x;
                ch.vy -= vn * n.y;
            }
        }
    }

    /**
     * Resolve a circle (cx, cy, r) against all nearby static tiles, dynamic platforms, rotPlatforms, and romans.
     */
    _resolveCircleWorldCollision(cx, cy, r, dynBoxes, includeRotated) {
        let x = cx;
        let y = cy;
        const normals = [];

        // 1. Check static grid solids within 2 tiles of (x, y)
        for (const s of this.solids) {
            if (s.type === 'box') {
                if (Math.abs(x - s.x) > s.hx + r + 0.1 || Math.abs(y - s.y) > s.hy + r + 0.1) continue;
                const hit = this._collideCircleAABB(x, y, r, s.x, s.y, s.hx, s.hy);
                if (hit) {
                    x += hit.nx * hit.pen;
                    y += hit.ny * hit.pen;
                    normals.push({ x: hit.nx, y: hit.ny, isIce: Boolean(s.isIce) });
                }
            } else if (s.type === 'tri') {
                if (Math.abs(x - s.c) > 0.6 + r || Math.abs(y - s.r) > 0.6 + r) continue;
                const hit = this._collideCircleTriangle(x, y, r, s.verts);
                if (hit) {
                    x += hit.nx * hit.pen;
                    y += hit.ny * hit.pen;
                    normals.push({ x: hit.nx, y: hit.ny, isIce: Boolean(s.isIce) });
                }
            }
        }

        // 2. Check axis-aligned dynamic boxes (slidePlatforms, pulleys, hangingPlatforms, iceBlocks)
        for (const b of dynBoxes) {
            if (Math.abs(x - b.x) > b.hx + r + 0.1 || Math.abs(y - b.y) > b.hy + r + 0.1) continue;
            const hit = this._collideCircleAABB(x, y, r, b.x, b.y, b.hx, b.hy);
            if (hit) {
                x += hit.nx * hit.pen;
                y += hit.ny * hit.pen;
                normals.push({ x: hit.nx, y: hit.ny, isIce: Boolean(b.isIce) });
            }
        }

        if (includeRotated) {
            // 3. Check rotating platforms (rotPlatforms) as oriented boxes
            for (const rp of this.rotPlatforms) {
                const hit = this._collideCircleOBB(x, y, r, rp.x, rp.y, rp.halfWidth, rp.halfHeight, rp.angle);
                if (hit) {
                    x += hit.nx * hit.pen;
                    y += hit.ny * hit.pen;
                    normals.push({ x: hit.nx, y: hit.ny });
                }
            }

            // 4. Check romans (seesaws) as oriented boxes
            for (const rm of this.romans) {
                const hit = this._collideCircleOBB(x, y, r, rm.pivotX, rm.pivotY, rm.halfLen, rm.halfThick, rm.angle);
                if (hit) {
                    x += hit.nx * hit.pen;
                    y += hit.ny * hit.pen;
                    normals.push({ x: hit.nx, y: hit.ny });
                }
            }
        }

        return { x, y, normals };
    }

    _collideCircleAABB(cx, cy, r, bx, by, hx, hy) {
        const minX = bx - hx;
        const maxX = bx + hx;
        const minY = by - hy;
        const maxY = by + hy;

        const closestX = Math.max(minX, Math.min(maxX, cx));
        const closestY = Math.max(minY, Math.min(maxY, cy));
        const dx = cx - closestX;
        const dy = cy - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq >= r * r) return null;

        if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            return { nx: dx / dist, ny: dy / dist, pen: r - dist };
        }

        // Center is inside AABB
        const dLeft = cx - minX;
        const dRight = maxX - cx;
        const dTop = cy - minY;
        const dBot = maxY - cy;
        const minD = Math.min(dLeft, dRight, dTop, dBot);
        if (minD === dTop) return { nx: 0, ny: -1, pen: r + dTop };
        if (minD === dBot) return { nx: 0, ny: 1, pen: r + dBot };
        if (minD === dLeft) return { nx: -1, ny: 0, pen: r + dLeft };
        return { nx: 1, ny: 0, pen: r + dRight };
    }

    _collideCircleOBB(cx, cy, r, ox, oy, hx, hy, angle) {
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const dx = cx - ox;
        const dy = cy - oy;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const hit = this._collideCircleAABB(lx, ly, r, 0, 0, hx, hy);
        if (!hit) return null;

        const wCos = Math.cos(angle);
        const wSin = Math.sin(angle);
        return {
            nx: hit.nx * wCos - hit.ny * wSin,
            ny: hit.nx * wSin + hit.ny * wCos,
            pen: hit.pen
        };
    }

    _collideCircleTriangle(cx, cy, r, verts) {
        // Find closest point on triangle (v0, v1, v2) to (cx, cy)
        const v0 = verts[0];
        const v1 = verts[1];
        const v2 = verts[2];

        const inside = this._pointInTriangle(cx, cy, v0, v1, v2);
        let bestDistSq = Infinity;
        let bestPt = { x: cx, y: cy };

        const edges = [[v0, v1], [v1, v2], [v2, v0]];
        for (const [a, b] of edges) {
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const lenSq = abx * abx + aby * aby;
            let t = lenSq > 0 ? ((cx - a.x) * abx + (cy - a.y) * aby) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const px = a.x + t * abx;
            const py = a.y + t * aby;
            const dSq = (cx - px) * (cx - px) + (cy - py) * (cy - py);
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestPt = { x: px, y: py };
            }
        }

        if (!inside && bestDistSq >= r * r) return null;

        const dist = Math.sqrt(bestDistSq);
        if (inside) {
            if (dist > 1e-6) {
                return { nx: (bestPt.x - cx) / dist, ny: (bestPt.y - cy) / dist, pen: r + dist };
            }
            return { nx: 0, ny: -1, pen: r };
        }
        if (dist < 1e-6) return null;
        return {
            nx: (cx - bestPt.x) / dist,
            ny: (cy - bestPt.y) / dist,
            pen: r - dist
        };
    }

    _pointInTriangle(px, py, v0, v1, v2) {
        const d1 = (px - v1.x) * (v0.y - v1.y) - (v0.x - v1.x) * (py - v1.y);
        const d2 = (px - v2.x) * (v1.y - v2.y) - (v1.x - v2.x) * (py - v2.y);
        const d3 = (px - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (py - v0.y);
        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        return !(hasNeg && hasPos);
    }

    /**
     * Exact port of character animation state selection (mc_1..mc_5, facing, head.rotation)
     * from level.as lines 1236-1299 and 1385-1445.
     */
    _finalizeCharacterState(ch) {
        let bestNormal = { x: 0, y: 0 };
        for (const c of ch.contacts) {
            if (c.y < bestNormal.y) {
                bestNormal = { x: c.x, y: c.y };
            }
        }
        ch.groundNormal = bestNormal;
        if (bestNormal.y < -0.2) {
            ch.allowJump = true;
            ch.coyoteTicks = 2;
        } else {
            ch.allowJump = false;
            ch.coyoteTicks = Math.max(0, ch.coyoteTicks - 1);
        }

        // Advance head and running animation frames
        const maxHeadFrames = ch.name === 'pers1' ? 5 : 11;
        ch.headFrame = (ch.headFrame % maxHeadFrames) + 1;
        if (ch.left || ch.right) {
            ch.runFrame = (ch.runFrame % 8) + 1;
        } else {
            ch.runFrame = 1;
        }

        ch.headRotDeg = 0;

        const isGroundedAnim = ch.allowJump || (ch.coyoteTicks > 0 && ch.vy >= -0.5);
        if (!isGroundedAnim) {
            if (ch.vx < -2) {
                ch.activeMc = 4;
                ch.facing = -1;
                ch.headRotDeg = (-Math.atan2(ch.vy, ch.vx) / Math.PI) * 180 - 180;
            } else if (ch.vx > 2) {
                ch.activeMc = 4;
                ch.facing = 1;
                ch.headRotDeg = (Math.atan2(ch.vy, ch.vx) / Math.PI) * 180;
            } else if (ch.vy < -3) {
                ch.activeMc = 3;
                ch.facing = 1;
            } else if (ch.vy > 3) {
                ch.activeMc = 2;
                ch.facing = 1;
            } else if (!ch.right && !ch.left) {
                ch.activeMc = 1;
                ch.facing = 1;
            } else if (ch.right) {
                ch.activeMc = 5;
                ch.facing = 1;
            } else if (ch.left) {
                ch.activeMc = 5;
                ch.facing = -1;
            } else {
                ch.activeMc = 1;
                ch.facing = 1;
            }
        } else if (ch.right || ch.left) {
            ch.activeMc = 5;
            if (ch.right) {
                ch.facing = 1;
                ch.headRotDeg = (-Math.atan2(-bestNormal.y, bestNormal.x) / Math.PI) * 180 + 90;
            } else {
                ch.facing = -1;
                ch.headRotDeg = (Math.atan2(-bestNormal.y, bestNormal.x) / Math.PI) * 180 - 90;
            }
        } else {
            ch.activeMc = 1;
            ch.facing = 1;
        }
    }

    _checkDiamonds() {
        for (const d of this.diamonds) {
            if (d.collected) continue;
            if (d.type === 'rd') {
                if (Math.abs(this.pers1.x - d.x) < 0.85 && Math.abs(this.pers1.y - d.y) < 1.05) {
                    d.collected = true;
                    this.redCount++;
                    soundManager.play('Diamond_Sound', 0.7);
                }
            } else if (d.type === 'bd') {
                if (Math.abs(this.pers2.x - d.x) < 0.85 && Math.abs(this.pers2.y - d.y) < 1.05) {
                    d.collected = true;
                    this.blueCount++;
                    soundManager.play('Diamond_Sound', 0.7);
                }
            } else if (d.type === 'gr') {
                const hit1 = Math.abs(this.pers1.x - d.x) < 0.9 && Math.abs(this.pers1.y - d.y) < 1.1;
                const hit2 = Math.abs(this.pers2.x - d.x) < 0.9 && Math.abs(this.pers2.y - d.y) < 1.1;
                if (hit1 || hit2) {
                    d.collected = true;
                    this.greenCount++;
                    soundManager.play('Diamond_Sound', 0.8);
                }
            }
        }
    }

    _checkHazards() {
        if (this.ended) return;
        const legs1X = this.pers1.x;
        const legs1Y = this.pers1.y + 0.5;
        const legs2X = this.pers2.x;
        const legs2Y = this.pers2.y + 0.5;

        for (const h of this.hazards) {
            // Check Fireboy (pers1) in water or black
            if (h.type === 'water' || h.type === 'black') {
                if (
                    legs1X + 0.22 >= h.minX && legs1X - 0.22 <= h.maxX &&
                    legs1Y + 0.28 >= h.minY && legs1Y - 0.22 <= h.maxY
                ) {
                    this._triggerDeath(this.pers1);
                    return;
                }
            }
            // Check Watergirl (pers2) in fire or black
            if (h.type === 'fire' || h.type === 'black') {
                if (
                    legs2X + 0.22 >= h.minX && legs2X - 0.22 <= h.maxX &&
                    legs2Y + 0.28 >= h.minY && legs2Y - 0.22 <= h.maxY
                ) {
                    this._triggerDeath(this.pers2);
                    return;
                }
            }
        }
    }

    _triggerDeath(victim) {
        this.pause = true;
        this.ended = true;
        victim.visible = false;
        soundManager.stopAllLoops();
        soundManager.play('Smash', 0.8);
        this.deathAnim = {
            x: victim.x * TILE_SIZE,
            y: victim.y * TILE_SIZE,
            frame: 1,
            maxFrame: 32
        };
    }

    _updateFinishDoors() {
        if (this.ended) return;

        // FinishBoy sensor check against firelegs (level.as line 1118)
        const f1Touch = (
            Math.abs(this.pers1.x - this.finish1.x) <= 1.0 &&
            Math.abs((this.pers1.y + 0.5) - (this.finish1.y + 0.3)) <= 0.75
        );
        // FinishGirl sensor check against waterlegs (level.as line 1141)
        const f2Touch = (
            Math.abs(this.pers2.x - this.finish2.x) <= 1.0 &&
            Math.abs((this.pers2.y + 0.5) - (this.finish2.y + 0.3)) <= 0.75
        );

        this.finish1.touching = f1Touch;
        this.finish2.touching = f2Touch;

        if (f1Touch) {
            if (this.finish1.frame === 1) soundManager.play('Door_Sound', 0.6);
            if (this.finish1.frame < 22) this.finish1.frame++;
        } else if (this.finish1.frame > 1) {
            if (this.finish1.frame === 22) soundManager.play('Door_Sound', 0.5);
            this.finish1.frame--;
        }

        if (f2Touch) {
            if (this.finish2.frame === 1) soundManager.play('Door_Sound', 0.6);
            if (this.finish2.frame < 22) this.finish2.frame++;
        } else if (this.finish2.frame > 1) {
            if (this.finish2.frame === 22) soundManager.play('Door_Sound', 0.5);
            this.finish2.frame--;
        }

        // Both doors fully open (frame 22) -> trigger stairs ascension (level.as lines 1632-1645)
        if (this.finish1.frame === 22 && this.finish2.frame === 22) {
            this.pause = true;
            this.ended = true;
            this.pers1.visible = false;
            this.pers2.visible = false;
            soundManager.stopAllLoops();
            this.stairsAnim = {
                fireX: this.finish1.x * TILE_SIZE,
                fireY: this.finish1.y * TILE_SIZE,
                waterX: this.finish2.x * TILE_SIZE,
                waterY: this.finish2.y * TILE_SIZE,
                frame: 1,
                maxFrame: 35
            };
        }
    }
}
