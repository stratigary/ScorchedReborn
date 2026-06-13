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
  const maxTicks = 60 * 60 * 60; // 60 simulated minutes hard cap
  let ticks = 0;
  while (game.phase !== 'over' && ticks < maxTicks) {
    game.update(dt);
    if (ticks % 7 === 0) game.render(ctx);
    ticks++;
  }
  if (game.phase !== 'over') throw new Error('match never finished; phase=' + game.phase + ' round=' + game.round);
  // pre-round-1 shop + 2 intermissions for a 3-round match
  if (shopOpens !== 3) throw new Error('expected 3 shop intermissions, got ' + shopOpens);
  if (gameOvers !== 1) throw new Error('expected 1 game over, got ' + gameOvers);

  // exercise a 6-player match setup
  const g6p = new Game();
  g6p.onShop = () => g6p.nextRound();
  g6p.newMatch({
    players: [
      { name: 'P1', type: 'human' },
      { name: 'P2', type: 'amateur' },
      { name: 'P3', type: 'pro' },
      { name: 'P4', type: 'johnwick' },
      { name: 'P5', type: 'novice' },
      { name: 'P6', type: 'pro' },
    ],
    rounds: 2, wrap: false, sound: false,
  });
  if (g6p.tanks.length !== 6) throw new Error('expected 6 players, got ' + g6p.tanks.length);
  const distinctColors = new Set(g6p.tanks.map(t => t.color));
  if (distinctColors.size !== 6) throw new Error('expected 6 distinct colors, got ' + distinctColors.size);

  // exercise save / restore round-trip
  const g2 = new Game();
  g2.onShop = () => g2.nextRound();
  g2.newMatch({
    players: [{ name: 'A', type: 'pro' }, { name: 'B', type: 'johnwick' }],
    rounds: 6, wrap: false, sound: false, startCash: Infinity,
  });
  if (g2.tanks[0].cash !== Infinity) throw new Error('unlimited start cash not applied');
  for (let i = 0; i < 600; i++) g2.update(dt);
  g2.terrain.soot[500] = 0.75;
  SaveSystem.saveMatch(g2);
  const data = SaveSystem.loadMatch();
  if (!data) throw new Error('save missing');
  const g3 = new Game();
  g3.restore(data);
  if (g3.tanks[0].cash !== Infinity) throw new Error('unlimited cash lost in save/restore');
  if (g3.terrain.soot[500] !== 0.75) throw new Error('soot array lost in save/restore');
  for (let i = 0; i < 1200; i++) { g3.update(dt); if (i % 9 === 0) g3.render(ctx); }

  // exercise every weapon special directly
  const g4 = new Game();
  g4.onShop = () => g4.nextRound();
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

  // dirt bombs must bury tanks under the mound, not lift them on top of it
  const g5 = new Game();
  g5.onShop = () => g5.nextRound();
  g5.newMatch({
    players: [{ name: 'D1', type: 'human' }, { name: 'D2', type: 'novice' }],
    rounds: 3, wrap: false, sound: false,
  });
  const victim = g5.tanks[1];
  const yBefore = victim.y;
  g5.applyDirt(victim.x, victim.y - 10, ItemCatalog.byId.megadirt);
  for (let i = 0; i < 30; i++) g5.update(dt);
  if (victim.y < yBefore - 2) throw new Error('dirt bomb lifted the tank: y ' + yBefore + ' -> ' + victim.y);
  if (!victim.buried) throw new Error('tank not flagged buried under mega dirt mound');

  // nuclear detonations dim the world
  FX.dimAlpha = 0;
  g5.applyExplosion(800, 400, ItemCatalog.byId.tacnuke, null, {});
  if (!(FX.dimAlpha > 0.4)) throw new Error('tactical nuke did not dim the scene');
  for (let i = 0; i < 200; i++) g5.update(dt);
  if (FX.dimAlpha > 0.01) throw new Error('nuke dim never decayed');

  // sandbox mode: level gates off, no XP awards, bots can buy top-tier gear at Lv1
  const g6 = new Game();
  g6.onShop = () => g6.nextRound();
  g6.newMatch({
    players: [{ name: 'S1', type: 'johnwick' }, { name: 'S2', type: 'novice' }],
    rounds: 3, wrap: false, sound: false, noLevels: true, startCash: 99999,
  });
  const wick = g6.tanks[0];
  if (!wick.gatesOff) throw new Error('gatesOff not set in sandbox mode');
  botShop(wick, g6);
  if (wick.ammo('thermo') <= 0) throw new Error('sandbox bot could not buy level-5 thermo at Lv1');
  const xpBefore = wick.xp;
  g6.damageTank(g6.tanks[1], 30, wick, true);
  if (wick.xp !== xpBefore) throw new Error('XP awarded despite no-level mode');

  // magnetic shield: deflects incoming enemy rounds, ignores the owner's own
  function magTest(defenderHasMag, attackerHasMag) {
    const g = new Game();
    g.onShop = () => g.nextRound();
    g.newMatch({
      players: [{ name: 'Att', type: 'human' }, { name: 'Def', type: 'human' }],
      rounds: 3, wrap: false, sound: false,
    });
    for (let x = 0; x < 1600; x++) g.terrain.h[x] = 600;
    g.terrain.dirty = true;
    const att = g.tanks[0], def = g.tanks[1];
    att.x = 500; def.x = 900;
    att.y = def.y = 600;
    att.health = def.health = 100;
    att.shield = def.shield = null;
    if (defenderHasMag) def.upgrades.magshield = true;
    if (attackerHasMag) att.upgrades.magshield = true;
    g.wind = 0;
    g.turnIdx = 0;
    g.phase = 'aim';
    // solve for a direct hit on the defender
    let best = { err: 1e9, a: 45, p: 60 };
    for (let a = 15; a <= 80; a += 0.5) {
      for (let p = 25; p <= 100; p += 1) {
        const hit = g.simulateShot(att, a, p, true);
        if (!hit) continue;
        // a tank-collision impact registers at the collision radius edge,
        // so score actual defender hits as perfect
        const err = hit.tank === def ? 0 : Math.hypot(hit.x - def.x, hit.y - (def.y - 8));
        if (err < best.err) best = { err, a, p };
        if (err === 0) break;
      }
      if (best.err === 0) break;
    }
    if (best.err > 6) throw new Error('magTest: no direct-hit solution found (err=' + best.err + ')');
    att.angle = best.a; att.power = best.p;
    g.fire(att);
    let guard = 60 * 20;
    while (g.phase !== 'aim' && g.phase !== 'roundend' && guard-- > 0) g.update(dt);
    return def.health;
  }
  const hpBaseline = magTest(false, false);
  const hpDeflected = magTest(true, false);
  const hpOwnRounds = magTest(false, true);
  if (hpBaseline > 80) throw new Error('baseline direct hit too weak: hp ' + hpBaseline);
  if (hpDeflected < hpBaseline + 15) {
    throw new Error('mag shield barely deflected: baseline hp ' + hpBaseline + ' vs shielded hp ' + hpDeflected);
  }
  if (hpOwnRounds > 80) {
    throw new Error("attacker's own mag shield interfered with outgoing shot: hp " + hpOwnRounds);
  }
  console.log('magshield: baseline=' + hpBaseline + ' deflected=' + hpDeflected + ' ownRounds=' + hpOwnRounds);

  // MIRV must split at apex into the configured number of warheads
  const gm = new Game();
  gm.onShop = () => gm.nextRound();
  gm.newMatch({
    players: [{ name: 'M1', type: 'human' }, { name: 'M2', type: 'human' }],
    rounds: 3, wrap: false, sound: false,
  });
  for (let x = 0; x < 1600; x++) gm.terrain.h[x] = 700;
  gm.terrain.dirty = true;
  const ms = gm.tanks[0];
  ms.x = 400; ms.y = 700; gm.tanks[1].x = 1100; gm.tanks[1].y = 700;
  ms.inventory.mirv = 5; ms.selectedWeapon = 'mirv';
  gm.wind = 0; gm.turnIdx = 0; gm.phase = 'aim';
  ms.angle = 70; ms.power = 75;
  gm.fire(ms);
  let sawSplit = 0;
  let guard = 60 * 20;
  while (gm.phase !== 'aim' && gm.phase !== 'roundend' && guard-- > 0) {
    gm.update(dt);
    // after the parent splits, several sub-projectiles coexist
    sawSplit = Math.max(sawSplit, gm.projectiles.filter(p => p.isSub).length);
  }
  const expectSplit = ItemCatalog.byId.mirv.splitCount;
  if (sawSplit < expectSplit) {
    throw new Error('MIRV did not split into ' + expectSplit + ' (peak sub-projectiles: ' + sawSplit + ')');
  }
  console.log('mirv split peak sub-projectiles: ' + sawSplit);

  // Neutron Bomb: map-wide radiation that pierces energy shields
  const gn = new Game();
  gn.onShop = () => gn.nextRound();
  gn.newMatch({
    players: [{ name: 'Boom', type: 'human' }, { name: 'Far', type: 'human' }, { name: 'Near', type: 'human' }],
    rounds: 3, wrap: false, sound: false,
  });
  const shooter = gn.tanks[0], far = gn.tanks[1], near = gn.tanks[2];
  far.x = 1550; far.y = gn.terrain.heightAt(1550);
  far.shield = { hp: 100, max: 100 }; // shielded but radiation should pierce
  near.x = 120; near.y = gn.terrain.heightAt(120);
  const farBefore = far.health, nearBefore = near.health;
  gn.applyNeutron(60, gn.terrain.heightAt(60) - 6, ItemCatalog.byId.neutron, shooter);
  if (far.health >= farBefore) throw new Error('neutron radiation did not pierce a shielded far tank');
  // radiation bypasses the shield entirely, so the shield should be untouched
  if (!far.shield || far.shield.hp !== 100) throw new Error('radiation drained the shield instead of bypassing it');
  if (near.health >= nearBefore - 30) throw new Error('neutron near tank took too little damage');
  console.log('neutron: far(shielded) ' + farBefore + '->' + far.health + ', near ' + nearBefore + '->' + near.health);
  // the granddaddy must out-class the thermonuclear in raw blast
  const nuke = ItemCatalog.byId.neutron, thermo = ItemCatalog.byId.thermo;
  if (nuke.radius <= thermo.radius) throw new Error('neutron blast radius must exceed thermonuclear');
  if (nuke.dmg <= thermo.dmg) throw new Error('neutron blast damage must exceed thermonuclear');

  // confirmation flow: a confirm weapon must not fire until proceed() is called
  const gc = new Game();
  gc.onShop = () => gc.nextRound();
  let confirmShown = 0, confirmMsg = '';
  let proceedFn = null;
  gc.onConfirm = (msg, def, proceed, cancel) => { confirmShown++; confirmMsg = msg; proceedFn = proceed; };
  gc.newMatch({
    players: [{ name: 'C1', type: 'human' }, { name: 'C2', type: 'human' }],
    rounds: 3, wrap: false, sound: false,
  });
  const cs = gc.tanks[0];
  cs.inventory.neutron = 1; cs.selectedWeapon = 'neutron';
  gc.turnIdx = 0; gc.phase = 'aim';
  gc.fire(cs);
  if (confirmShown !== 1) throw new Error('neutron fire did not trigger confirmation');
  if (!confirmMsg || confirmMsg.length < 4) throw new Error('confirmation message empty');
  if (gc.phase !== 'aim') throw new Error('weapon launched before confirmation');
  if (!gc.awaitingConfirm) throw new Error('game not flagged awaiting confirmation');
  if (gc.humanCanAct) throw new Error('controls not locked during confirmation');
  proceedFn();
  if (gc.awaitingConfirm) throw new Error('still awaiting confirm after proceed');
  if (gc.phase !== 'delay') throw new Error('weapon did not begin firing after confirmation');

  // exercise weather configurations: calm, windy, wtf
  const gw = new Game();
  gw.onShop = () => gw.nextRound();
  gw.newMatch({
    players: [{ name: 'W1', type: 'human' }, { name: 'W2', type: 'human' }],
    rounds: 2, wrap: false, sound: false, weather: 'wtf'
  });
  if (gw.settings.weather !== 'wtf') throw new Error('wtf weather not set in game settings');
  gw.update(dt);
  const wPath = gw.simulatePath(gw.tanks[0], 45, 50, true, null, 100);
  if (!wPath.points || wPath.points.length === 0) throw new Error('wtf simulatePath failed');
  
  const gwc = new Game();
  gwc.onShop = () => gwc.nextRound();
  gwc.newMatch({
    players: [{ name: 'W1', type: 'human' }, { name: 'W2', type: 'human' }],
    rounds: 2, wrap: false, sound: false, weather: 'calm'
  });
  if (gwc.wind !== 0) throw new Error('calm weather did not force wind to 0');

  console.log('SMOKE OK — ticks: ' + ticks + ', shops: ' + shopOpens);
`, sandbox, { filename: 'smoke-driver' });
