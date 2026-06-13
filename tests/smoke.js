'use strict';
/* Headless smoke test: stubs canvas/DOM/localStorage, loads the core game
 * modules and runs several full bot-vs-bot rounds, rendering into a stub
 * context. Catches runtime errors across the whole simulation pipeline.
 *
 * Run: node tests/smoke.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- stubs ---------- */

function makeCtxStub() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return { width: 1600, height: 900 };
      if (prop === 'measureText') return () => ({ width: 42 });
      if (typeof prop !== 'string') return undefined;
      if (prop.startsWith('create')) return () => gradient;
      return () => {};
    },
    set(target, prop, val) { target[prop] = val; return true; },
  });
}

const sandbox = {
  console,
  Math,
  Infinity,
  performance: { now: () => Date.now() },
  setInterval: () => 0,
  clearInterval: () => {},
  document: {
    createElement: () => ({ width: 0, height: 0, getContext: () => makeCtxStub() }),
  },
  localStorage: (() => {
    const store = {};
    return {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
  })(),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------- load core modules (DOM-heavy shop.js / main.js excluded) ---------- */

const files = ['utils.js', 'audio.js', 'sayings.js', 'items.js', 'terrain.js',
  'themes.js', 'effects.js', 'tank.js', 'projectile.js', 'ai.js',
  'persistence.js', 'game.js'];

for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

/* ---------- drive a full bot match ---------- */

vm.runInContext(`
  const ctx = ${''}(${makeCtxStub.toString()})();
  const game = new Game();
  let shopOpens = 0, gameOvers = 0;
  game.onShop = () => { shopOpens++; game.nextRound(); };
  game.onGameOver = (standings) => {
    gameOvers++;
    if (!Array.isArray(standings) || standings.length !== 4) throw new Error('bad standings');
  };

  game.newMatch({
    players: [
      { name: 'NoviceBot', type: 'novice' },
      { name: 'AmateurBot', type: 'amateur' },
      { name: 'ProBot', type: 'pro' },
      { name: 'WickBot', type: 'johnwick' },
    ],
    rounds: 3,
    wrap: true,
    sound: false,
  });

  const dt = 1 / 60;
  const maxTicks = 60 * 60 * 30; // 30 simulated minutes hard cap
  let ticks = 0;
  while (game.phase !== 'over' && ticks < maxTicks) {
    game.update(dt);
    if (ticks % 7 === 0) game.render(ctx);
    ticks++;
  }
  if (game.phase !== 'over') throw new Error('match never finished; phase=' + game.phase + ' round=' + game.round);
  if (shopOpens !== 2) throw new Error('expected 2 shop intermissions, got ' + shopOpens);
  if (gameOvers !== 1) throw new Error('expected 1 game over, got ' + gameOvers);

  // exercise save / restore round-trip
  const g2 = new Game();
  g2.newMatch({
    players: [{ name: 'A', type: 'pro' }, { name: 'B', type: 'johnwick' }],
    rounds: 6, wrap: false, sound: false,
  });
  for (let i = 0; i < 600; i++) g2.update(dt);
  SaveSystem.saveMatch(g2);
  const data = SaveSystem.loadMatch();
  if (!data) throw new Error('save missing');
  const g3 = new Game();
  g3.restore(data);
  for (let i = 0; i < 1200; i++) { g3.update(dt); if (i % 9 === 0) g3.render(ctx); }

  // exercise every weapon special directly
  const g4 = new Game();
  g4.newMatch({
    players: [{ name: 'X', type: 'human' }, { name: 'Y', type: 'novice' }],
    rounds: 6, wrap: false, sound: false,
  });
  for (const w of WEAPONS) {
    const shooter = g4.tanks[0];
    if (!g4.tanks[1].alive) g4.tanks[1].alive = true, g4.tanks[1].health = 100;
    shooter.alive = true; shooter.health = 100;
    shooter.inventory[w.id] = 5;
    shooter.selectedWeapon = w.id;
    g4.phase = 'aim';
    g4.turnIdx = 0;
    shooter.angle = 60; shooter.power = 70;
    g4.fire(shooter);
    let guard = 60 * 25;
    while (g4.phase !== 'aim' && g4.phase !== 'roundend' && g4.phase !== 'shop' && g4.phase !== 'over' && guard-- > 0) {
      g4.update(dt);
      if (guard % 11 === 0) g4.render(ctx);
    }
    if (guard <= 0) throw new Error('weapon ' + w.id + ' never settled');
    if (g4.phase !== 'aim') break; // round ended mid-test; fine
  }

  console.log('SMOKE OK — ticks: ' + ticks + ', shops: ' + shopOpens);
`, sandbox, { filename: 'smoke-driver' });
