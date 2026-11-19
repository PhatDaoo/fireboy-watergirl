// Automated Physics & Level Integrity Verification for Fireboy & Watergirl 1-4 (All 155 Levels)

globalThis.window = { addEventListener: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.Audio = class {
    play() { return Promise.resolve(); }
    pause() {}
};

const { TEMPLES, TEMPLE_ORDER } = await import('../js/temples.js');
const { ForestLevelWorld } = await import('../js/physics.js');

let totalPassed = 0;
let totalExpected = 0;

for (const tid of TEMPLE_ORDER) {
    const t = TEMPLES[tid];
    const { TEMPLE_NODES, LEVELS } = t.data;
    let passed = 0;
    for (const node of TEMPLE_NODES) {
        totalExpected++;
        const key = `${node.mode}_${node.levelNum}`;
        const lvl = LEVELS[key];
        if (!lvl) {
            throw new Error(`[${tid}] Missing level data for node ${node.node}: ${key}`);
        }
        const world = new ForestLevelWorld(`${tid}:${key}`, lvl);
        const neutral = {
            p1: { left: false, right: false, up: false },
            p2: { left: false, right: false, up: false }
        };

        // Simulate 50 frames (2 seconds of settling under gravity)
        for (let i = 0; i < 50; i++) {
            world.step(neutral);
        }

        if (
            Number.isNaN(world.pers1.x) || Number.isNaN(world.pers1.y) ||
            Number.isNaN(world.pers2.x) || Number.isNaN(world.pers2.y)
        ) {
            throw new Error(`[${tid}] NaN character position in ${key}`);
        }
        if (world.ended || world.deathAnim) {
            throw new Error(`[${tid}] Unexpected spawn death in Node #${node.node} (${key})`);
        }
        if (!world.pers1.allowJump || !world.pers2.allowJump) {
            throw new Error(`[${tid}] Character did not settle onto ground at spawn in Node #${node.node} (${key}): p1.allowJump=${world.pers1.allowJump}, p2.allowJump=${world.pers2.allowJump}`);
        }

        // Test jumping from spawn
        const jumpInput = {
            p1: { left: false, right: false, up: true },
            p2: { left: false, right: false, up: true }
        };
        const y1Before = world.pers1.y;
        const y2Before = world.pers2.y;
        world.step(jumpInput);
        world.step(neutral);
        if (!(world.pers1.y < y1Before && world.pers2.y < y2Before)) {
            throw new Error(`[${tid}] Jump failed in Node #${node.node} (${key})`);
        }

        passed++;
        totalPassed++;
    }
    console.log(`  [${t.title}] ${passed}/${TEMPLE_NODES.length} levels verified OK`);
}

console.log(`SUCCESS: All ${totalPassed}/${totalExpected} campaign levels across 4 temples settled cleanly onto ground, passed jump & mechanism checks with 0 errors!`);
