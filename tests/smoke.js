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

  // basic missiles must damage energy shields: shells detonate ON the dome
  // surface (radius up to 42px), which used to sit outside the missile's
  // splash reach (radius 24 + hull 16 = 40px), making full shields immune
  const gsh = new Game();
  gsh.onShop = () => gsh.nextRound();
  gsh.newMatch({
    players: [{ name: 'ShAtt', type: 'human' }, { name: 'ShDef', type: 'human' }],
    rounds: 3, wrap: false, sound: false,
  });
  const shAtt = gsh.tanks[0], shDef = gsh.tanks[1];
  shDef.shield = { hp: 100, max: 100 };
  const missileDef = ItemCatalog.byId.missile;
  const domeHit = () => gsh.applyExplosion(shDef.x, (shDef.y - 8) - shDef.hitRadius, missileDef, shAtt, { direct: shDef });
  domeHit();
  if (shDef.shield && shDef.shield.hp >= 100) throw new Error('basic missile did no damage to a full shield');
  if (shDef.health < 100) throw new Error('missile leaked through a healthy shield: hp ' + shDef.health);
  let domeHits = 1;
  while (shDef.shield && domeHits < 30) { domeHit(); domeHits++; }
  if (shDef.shield) throw new Error('shield never broke after ' + domeHits + ' direct missile hits');
  console.log('shield vs missile: shield broke after ' + domeHits + ' direct dome hits, hull hp ' + shDef.health);

  // multi-kill banner, near-miss taunts, and mock achievement feats
  const gk = new Game();
  gk.onShop = () => gk.nextRound();
  gk.newMatch({
    players: [{ name: 'Ace', type: 'human' }, { name: 'V1', type: 'human' }, { name: 'V2', type: 'human' }],
    rounds: 3, wrap: false, sound: false,
  });
  for (let x = 0; x < 1600; x++) gk.terrain.h[x] = 700;
  gk.terrain.dirty = true;
  const [ace, v1, v2] = gk.tanks;
  ace.x = 200; v1.x = 800; v2.x = 830;
  ace.y = v1.y = v2.y = 700;
  v1.health = 5; v2.health = 5; v1.shield = v2.shield = null;
  // one tacnuke (radius 60) atomizes both weakened victims -> DOUBLE KILL
  gk.applyExplosion(815, 692, ItemCatalog.byId.tacnuke, ace, {});
  if (v1.alive || v2.alive) throw new Error('multikill setup: victims survived');
  if (!gk.banner || gk.banner.text.indexOf('DOUBLE KILL') < 0) {
    throw new Error('double kill banner missing: ' + JSON.stringify(gk.banner));
  }
  if (!gk.banner.sub) throw new Error('multikill banner has no announcer line');
  // self-damage feat: Ace shells his own position
  gk.applyExplosion(ace.x, ace.y - 8, ItemCatalog.byId.missile, ace, {});
  if (!ace._feats || !ace._feats.selfdamage) throw new Error('self-damage feat not awarded');
  const featBubbles = FX.bubbles.length;
  gk.applyExplosion(ace.x, ace.y - 8, ItemCatalog.byId.missile, ace, {});
  if (FX.bubbles.length !== featBubbles) throw new Error('self-damage feat awarded twice in one round');
  // near-miss taunt: clean miss 90px from a (revived) victim
  v1.alive = true; v1.health = 100;
  const origRandom = Math.random;
  Math.random = () => 0.1; // force the taunt chance + deterministic choice
  gk._missTaunted = false;
  const bubblesBefore = FX.bubbles.length;
  gk.applyExplosion(v1.x + 90, 692, ItemCatalog.byId.missile, ace, {});
  Math.random = origRandom;
  if (v1.health !== 100) throw new Error('near-miss test accidentally hit the tank');
  if (FX.bubbles.length <= bubblesBefore) throw new Error('near-miss taunt bubble missing');
  // void feat: a shot that sails off the edge of the world
  const voider = new Projectile(ItemCatalog.byId.missile, -260, 100, -200, 0, ace, gk);
  voider.update(1 / 60);
  if (!voider.dead) throw new Error('off-map projectile did not die');
  if (!ace._feats.void) throw new Error('void feat not awarded for off-map shot');
  // self-bury feat: dirt-bombing your own head
  gk.applyDirt(ace.x, ace.y - 10, ItemCatalog.byId.megadirt, ace);
  if (!ace.buried) throw new Error('self-bury test: owner not buried');
  if (!ace._feats.selfbury) throw new Error('self-bury feat not awarded');
  console.log('multikill + feats + near-miss taunts OK');

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

  /* ===== new weapons & systems (v1.2.0) ===== */

  function flatGame(players, opts = {}) {
    const g = new Game();
    g.onShop = () => g.nextRound();
    g.newMatch(Object.assign({ players, rounds: 3, wrap: false, sound: false }, opts));
    for (let x = 0; x < 1600; x++) g.terrain.h[x] = 700;
    g.terrain.dirty = true;
    for (const t of g.tanks) t.y = g.terrain.heightAt(t.x);
    g.wind = 0; g.turnIdx = 0; g.phase = 'aim';
    return g;
  }

  // EMP: drains (not deletes-on-contact) shields, disables mag-shield and
  // targeting for one turn, and wears off as that turn ends
  {
    const g = flatGame([{ name: 'E1', type: 'human' }, { name: 'E2', type: 'human' }]);
    const [att, def] = g.tanks;
    def.x = 500; def.y = 700; def.shield = { hp: 100, max: 100 };
    def.upgrades.magshield = true;
    g.applyEmp(def.x, def.y - 8, ItemCatalog.byId.emp, att, def);
    if (!(def.shield && def.shield.hp < 100 && def.shield.hp > 0)) {
      throw new Error('EMP did not partially drain the shield: ' + JSON.stringify(def.shield));
    }
    if (def.emp <= 0) throw new Error('EMP did not fry electronics');
    if (def.magActive()) throw new Error('magshield still active while EMP-fried');
    g.turnIdx = g.tanks.indexOf(def);
    g.nextTurn();
    if (def.emp !== 0) throw new Error('EMP did not wear off after the fried tank turn ended');
    if (!def.magActive()) throw new Error('magshield did not return once EMP wore off');
    console.log('EMP: shield ' + '100->' + Math.round(g.tanks[1].shield.hp) + ', mag disabled then restored OK');
  }

  // Glacier Bomb: freezes the surface (blast-proof + no landslide) and tanks slide on it
  {
    const g = flatGame([{ name: 'G1', type: 'human' }, { name: 'G2', type: 'human' }]);
    g.applyGlacier(500, 700, ItemCatalog.byId.glacier, g.tanks[0]);
    if (!g.terrain.isIce(500)) throw new Error('glacier bomb did not freeze the ground');
    const beforeH = g.terrain.h[500];
    g.terrain.crater(500, 700, 40); // craters must not carve frozen ground
    if (g.terrain.h[500] !== beforeH) throw new Error('frozen terrain was cratered');
    console.log('glacier: terrain frozen and crater-proof OK');
  }

  // Quake Charge: ripples the terrain and knocks nearby tanks off the ground
  {
    const g = flatGame([{ name: 'Q1', type: 'human' }, { name: 'Q2', type: 'human' }]);
    const victim = g.tanks[1];
    victim.x = 560; victim.y = g.terrain.heightAt(560);
    const before = g.terrain.h.slice();
    g.applyQuake(500, 700, ItemCatalog.byId.quake, g.tanks[0]);
    let changed = false;
    for (let x = 400; x < 600; x++) if (Math.abs(g.terrain.h[x] - before[x]) > 0.5) { changed = true; break; }
    if (!changed) throw new Error('quake charge did not deform terrain');
    console.log('quake: terrain rippled OK');
  }

  // Teleporter Round: owner relocates to the shell's impact point
  {
    const g = flatGame([{ name: 'T1', type: 'human' }, { name: 'T2', type: 'human' }]);
    const t1 = g.tanks[0];
    t1.x = 300; t1.y = g.terrain.heightAt(300);
    g.applyTeleport(1200, g.terrain.heightAt(1200), t1);
    if (Math.abs(t1.x - 1200) > 1) throw new Error('teleport did not relocate the tank: x=' + t1.x);
    console.log('teleport: relocated to x=' + Math.round(t1.x) + ' OK');
  }

  // Acid Rain: seeds a drifting hazard that damages tanks it lands on
  {
    const g = flatGame([{ name: 'A1', type: 'human' }, { name: 'A2', type: 'human' }]);
    const victim = g.tanks[1];
    victim.x = 500; victim.y = g.terrain.heightAt(500);
    g.applyAcidRain(500, 400, ItemCatalog.byId.acidrain, g.tanks[0]);
    const before = victim.health;
    for (let i = 0; i < 300; i++) { g.hazards.forEach(h => h.update(dt, g)); g.hazards = g.hazards.filter(h => !h.dead); }
    if (victim.health >= before) throw new Error('acid rain drops never damaged the tank underneath');
    console.log('acid rain: victim hp ' + before + '->' + victim.health + ' OK');
  }

  // Napalm MIRV: splits at apex, and the sub-warheads keep the napalm payload
  {
    const g = flatGame([{ name: 'N1', type: 'human' }, { name: 'N2', type: 'human' }]);
    const shooter = g.tanks[0];
    shooter.inventory.napalmmirv = 3; shooter.selectedWeapon = 'napalmmirv';
    shooter.angle = 70; shooter.power = 75;
    g.fire(shooter);
    let sawNapalmSub = false;
    let guard = 60 * 20;
    while (g.phase !== 'aim' && g.phase !== 'roundend' && guard-- > 0) {
      g.update(dt);
      if (g.projectiles.some(p => p.isSub && p.def.special === 'napalm')) sawNapalmSub = true;
    }
    if (!sawNapalmSub) throw new Error('napalm MIRV sub-warheads did not retain the napalm special');
    console.log('napalm MIRV: sub-warheads carried napalm payload OK');
  }

  // Carpet Bomb: schedules a bomber that drops a stick of sub-bombs
  {
    const g = flatGame([{ name: 'CB1', type: 'human' }, { name: 'CB2', type: 'human' }]);
    g.scheduleCarpet(800, ItemCatalog.byId.carpet, g.tanks[0]);
    const plane = g.hazards.find(h => h.kind === 'carpet');
    if (!plane) throw new Error('carpet bomb did not schedule a bomber');
    let guard = 400;
    while (!plane.dead && guard-- > 0) { plane.update(dt, g); }
    if (plane.dropped < ItemCatalog.byId.carpet.bombs) {
      throw new Error('carpet bomber dropped ' + plane.dropped + ' of ' + ItemCatalog.byId.carpet.bombs + ' bombs');
    }
    console.log('carpet bomb: dropped ' + plane.dropped + '/' + ItemCatalog.byId.carpet.bombs + ' bombs OK');
  }

  // Meteor Shower: spawns the configured meteor count map-wide
  {
    const g = flatGame([{ name: 'MS1', type: 'human' }, { name: 'MS2', type: 'human' }]);
    g.scheduleMeteors(ItemCatalog.byId.meteor, g.tanks[0]);
    const storm = g.hazards.find(h => h.kind === 'meteors');
    if (!storm) throw new Error('meteor shower did not schedule');
    let spawned = 0, guard = 600;
    while (!storm.dead && guard-- > 0) {
      const before = g.projectiles.length;
      storm.update(dt, g);
      spawned += g.projectiles.length - before;
    }
    if (spawned < ItemCatalog.byId.meteor.count) throw new Error('meteor shower only spawned ' + spawned + ' meteors');
    console.log('meteor shower: spawned ' + spawned + ' meteors OK');
  }

  // Decoy Tank: draws enemy homing missiles and pops when a shell bursts on it
  {
    const g = flatGame([{ name: 'D1', type: 'human' }, { name: 'D2', type: 'human' }]);
    const decoyOwner = g.tanks[0], shooter = g.tanks[1];
    decoyOwner.x = 50; // the real target, pushed far from the decoy
    g.spawnDecoy(900, decoyOwner);
    const decoy = g.hazards.find(h => h.kind === 'decoy');
    if (!decoy) throw new Error('decoy did not spawn');
    // enemy homing missile launched near the decoy should steer onto it, not the far real target
    const homing = new Projectile(ItemCatalog.byId.homing, 900, 500, 0, 200, shooter, g);
    for (let i = 0; i < 200 && !homing.dead; i++) homing.update(dt);
    if (!decoy.dead) throw new Error('homing missile ignored the nearby decoy');
    console.log('decoy: homing missile drawn to decoy and popped it OK');
  }

  // Grappling Shot: yanks nearby tanks toward the impact point
  {
    const g = flatGame([{ name: 'GR1', type: 'human' }, { name: 'GR2', type: 'human' }]);
    const victim = g.tanks[1];
    victim.x = 600; victim.y = g.terrain.heightAt(600);
    const before = victim.x;
    g.applyGrapple(500, 700, ItemCatalog.byId.grapple, g.tanks[0], null);
    if (!(victim.x < before)) throw new Error('grapple did not pull the victim toward the impact: ' + before + '->' + victim.x);
    console.log('grapple: victim pulled ' + before + '->' + Math.round(victim.x) + ' OK');
  }

  // The Refund: both halves of the gamble must be reachable
  {
    const g = flatGame([{ name: 'RF1', type: 'human' }, { name: 'RF2', type: 'human' }]);
    const shooter = g.tanks[0];
    shooter.inventory.refund = 2; shooter.selectedWeapon = 'refund';
    shooter.angle = 60; shooter.power = 60;
    const origRandom = Math.random;

    Math.random = () => 0.9; // jackpot branch
    g.phase = 'aim'; g.turnIdx = 0;
    g.fire(g.tanks[0]);
    let guard = 60 * 20;
    while (g.phase !== 'aim' && g.phase !== 'roundend' && guard-- > 0) g.update(dt);
    const jackpotHp = shooter.health;

    shooter.inventory.refund = 1; shooter.health = 100;
    Math.random = () => 0.1; // misfire branch: detonates in the barrel
    g.phase = 'aim'; g.turnIdx = 0;
    g.fire(g.tanks[0]);
    guard = 60 * 20;
    while (g.phase !== 'aim' && g.phase !== 'roundend' && guard-- > 0) g.update(dt);
    Math.random = origRandom;
    if (shooter.health >= 100) throw new Error('refund misfire did not damage the shooter: hp=' + shooter.health);
    console.log('refund: jackpot hp=' + jackpotHp + ', misfire hp=' + shooter.health + ' OK');
  }

  // Shield Battery: tops off an active shield instead of stacking a new one
  {
    const g = flatGame([{ name: 'B1', type: 'human' }]);
    const t = g.tanks[0];
    t.shield = { hp: 40, max: 100 };
    t.inventory.battery = 1;
    if (!t.activateShield()) throw new Error('battery recharge was rejected');
    if (t.shield.hp !== 90) throw new Error('battery should add 50 hp: got ' + t.shield.hp);
    if (t.ammo('battery') !== 0) throw new Error('battery not consumed');
  }

  // Teams mode: alternating assignment, no friendly-fire credit, round ends
  // only when a single team remains
  {
    const g = flatGame(
      [{ name: 'TA1', type: 'human' }, { name: 'TB1', type: 'human' },
       { name: 'TA2', type: 'human' }, { name: 'TB2', type: 'human' }],
      { mode: 'teams' });
    const [a1, b1, a2, b2] = g.tanks;
    if (a1.team !== 0 || a2.team !== 0 || b1.team !== 1 || b2.team !== 1) {
      throw new Error('teams not assigned by alternating slot: ' + g.tanks.map(t => t.team));
    }
    // one teammate down, partner alive: round must continue
    b1.alive = false;
    if (g.checkRoundEnd()) throw new Error('round ended with a surviving teammate on the losing team');
    // friendly fire deals damage but earns no cash/credit
    const cashBefore = a1.cash;
    g.damageTank(a2, 20, a1, true);
    if (a1.cash !== cashBefore) throw new Error('teammate damage paid out cash: ' + cashBefore + '->' + a1.cash);
    // wipe the other team: round should end now
    b2.alive = false;
    if (!g.checkRoundEnd()) throw new Error('round did not end when only one team remained');
    console.log('teams: alternating assignment + no friendly-fire payout + win condition OK');
  }

  // Interest: exactly 5% of cash on hand is added at round end, on top of
  // (and independent from) the survival/winner cash awards
  {
    const g = flatGame([{ name: 'I1', type: 'human' }, { name: 'I2', type: 'human' }]);
    g.tanks[0].cash = 10000; g.tanks[1].alive = false;
    const before = g.tanks[0].cash;
    g.checkRoundEnd();
    // winner gets: 5% interest (500) + survival award (2000) + winner award (2500)
    const expected = before + Math.round(before * 0.05) + 2000 + 2500;
    if (g.tanks[0].cash !== expected) {
      throw new Error('interest math off: expected ' + expected + ', got ' + g.tanks[0].cash);
    }
    console.log('interest: ' + before + ' -> ' + g.tanks[0].cash + ' (exact) OK');
  }

  // Volcanic eruptions: the volcano theme flags ambient lava spouts
  {
    const volcano = THEMES.find(th => th.id === 'volcano');
    if (!volcano || !volcano.eruptions) throw new Error('volcano theme missing the eruptions flag');
  }

  // Boss HP: HUD fraction must use maxHealth (600), not a hardcoded 100
  {
    const g = flatGame([{ name: 'BOSS1', type: 'human' }, { name: 'BOSS2', type: 'behemoth' }]);
    const boss = g.tanks[1];
    boss.health = 300;
    if (boss.maxHealth !== 600) throw new Error('boss maxHealth should be 600, got ' + boss.maxHealth);
    if (Math.abs(boss.health / boss.maxHealth - 0.5) > 0.001) throw new Error('boss HP fraction miscalculated');
  }

  // End-of-match awards ceremony: stats accumulate and surface correctly
  {
    const g = flatGame([{ name: 'AW1', type: 'human' }, { name: 'AW2', type: 'human' }]);
    const t = g.tanks[0];
    g.damageTank(t, 15, t); // self-damage
    t.stats.offMap = 2;
    t.stats.buriedTurns = 3;
    t.stats.bigHit = 77;
    t.stats.earned = 5000;
    const awards = g._computeAwards();
    const titles = awards.map(a => a.title).join('|');
    if (!titles.includes('GLASS CANNON')) throw new Error('self-damage award missing: ' + titles);
    if (!titles.includes('ASTRONOMER')) throw new Error('off-map award missing: ' + titles);
    if (!titles.includes('ONE-HIT WONDER')) throw new Error('big-hit award missing: ' + titles);
    console.log('awards: ' + awards.length + ' honors computed OK');
  }

  // Last-impact marker: fired shots record where they land, for the aim aid
  {
    const g = flatGame([{ name: 'M1', type: 'human' }, { name: 'M2', type: 'human' }]);
    const shooter = g.tanks[0];
    if (shooter.lastImpact) throw new Error('lastImpact should start unset');
    g.applyExplosion(900, 700, ItemCatalog.byId.missile, shooter, {});
    if (!shooter.lastImpact || Math.abs(shooter.lastImpact.x - 900) > 1) {
      throw new Error('lastImpact not recorded on the shooter');
    }
    console.log('last-impact marker recorded OK');
  }

  // Fine aim: adjustAngle/adjustPower accept fractional multipliers (Shift key)
  {
    const g = flatGame([{ name: 'FA1', type: 'human' }, { name: 'FA2', type: 'human' }]);
    const t = g.tanks[0];
    t.angle = 90; t.power = 50;
    g.adjustAngle(0.08, 1); // one simulated fine-aim second
    g.adjustPower(0.08, 1);
    if (Math.abs(t.angle - 90) >= 40 * 1) throw new Error('fine aim multiplier not reducing angle step');
    if (t.angle === 90) throw new Error('fine aim produced no movement at all');
  }

  // Shield-chip payout: draining a shield now earns cash/XP at half rate
  {
    const g = flatGame([{ name: 'SC1', type: 'human' }, { name: 'SC2', type: 'human' }]);
    const att = g.tanks[0], def = g.tanks[1];
    def.shield = { hp: 100, max: 100 };
    const cashBefore = att.cash;
    g.damageTank(def, 40, att, true); // fully absorbed by the shield
    if (att.cash <= cashBefore) throw new Error('shield-chip damage paid out no cash to the attacker');
    console.log('shield-chip payout: cash ' + cashBefore + '->' + att.cash + ' OK');
  }

  console.log('v1.2.0 weapons & systems: all checks passed');

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
