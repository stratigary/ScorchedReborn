'use strict';
/* ===== Game conductor: rounds, turns, physics, combat resolution, render ===== */

const FIRE_BEAT = 0.42;   // "quick beat" speech-bubble hesitation before launch

class Game {
  constructor() {
    this.settings = { wrap: false, sound: true };
    this.tanks = [];
    this.projectiles = [];
    this.hazards = [];
    this.terrain = null;
    this.theme = THEMES[0];
    this.themeState = null;
    this.round = 1;
    this.totalRounds = 6;
    this.turnIdx = 0;
    this.wind = 0;
    this.phase = 'idle';   // aim | delay | sim | roundend | shop | over
    this.delayTimer = 0;
    this.settleTimer = 0;
    this.terrainWait = 0;
    this.banner = null;
    this.time = 0;
    this.ai = new Map();   // tank -> AIController
    this._terrainCache = Utils.makeCanvas(W, H);
    this._terrainCtx = this._terrainCache.getContext('2d');
    this._vignette = this._buildVignette();
    this._pendingShooter = null;
    this.awaitingConfirm = false;
    this._turnKills = new Map();   // killer -> kills this volley (multi-kill banner)
    this._missTaunted = false;     // one near-miss taunt per volley

    // callbacks wired up by main.js
    this.onShop = null;
    this.onGameOver = null;
    this.onConfirm = null;
  }

  _buildVignette() {
    const c = Utils.makeCanvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.48, W / 2, H / 2, H * 1.02);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.34)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    return c;
  }

  /* ================= match / round lifecycle ================= */

  newMatch(config) {
    this.settings.wrap = !!config.wrap;
    this.settings.sound = config.sound !== false;
    this.settings.noLevels = !!config.noLevels;
    this.settings.weather = config.weather || 'random';
    this.settings.mode = config.mode || 'standard';
    if (this.settings.mode === 'windstorm') {
      this.settings.weather = 'wtf';
    }
    this.totalRounds = config.rounds || 6;
    this.round = 1;
    this.tanks = config.players.map((p, i) => {
      const t = new Tank({
        name: p.name,
        color: p.type === 'behemoth' ? '#ff1100' : PLAYER_COLORS[i % PLAYER_COLORS.length],
        type: p.type,
        cash: config.startCash !== undefined ? config.startCash : 10000,
      });
      t.gatesOff = this.settings.noLevels;
      // sandbox matches leave persistent XP profiles untouched
      if (!this.settings.noLevels) {
        const prof = SaveSystem.getProfile(t.name);
        if (prof) { t.xp = prof.xp; t.level = levelForXP(t.xp); }
      }
      return t;
    });
    // teams mode: alternate slots between Alpha (0) and Bravo (1)
    if (this.settings.mode === 'teams') {
      this.tanks.forEach((t, i) => { t.team = i % 2; });
    }
    this.ai.clear();
    for (const t of this.tanks) if (t.isBot) this.ai.set(t, new AIController(t));
    FX.reset();
    // pre-round armory visit: everyone shops before the first shell flies
    this._matchStarted = false;
    this.phase = 'shop';
    for (const t of this.tanks) if (t.isBot) botShop(t, this);
    if (this.onShop) this.onShop(); else this.nextRound();
  }

  /** Called by the shop UI when every human is done (also starts round 1). */
  nextRound() {
    if (this._matchStarted) this.round++;
    else this._matchStarted = true;
    this.startRound();
  }

  /** The round the next shop intermission is buying for. */
  upcomingRound() {
    return this._matchStarted ? this.round + 1 : this.round;
  }

  startRound() {
    this.theme = themeForRound(this.round);
    this.terrain = new Terrain();
    if (this.settings.mode === 'windstorm') {
      this.settings.weather = 'wtf';
      this.terrain.generateStructures('windstorm');
    }
    this.themeState = makeThemeState(this.theme, this.terrain.seed);
    this.projectiles = [];
    this.hazards = [];
    FX.reset();
    AudioEngine.humReset();

    // place tanks: evenly spaced slots, shuffled, with jitter
    const n = this.tanks.length;
    const slots = [];
    for (let i = 0; i < n; i++) slots.push((i + 0.5) * (W / n) + Utils.rand(-60, 60));
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Utils.randInt(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.tanks.forEach((t, i) => {
      t.x = Utils.clamp(slots[i], 40, W - 40);
      // flatten a small pad under the tank
      const ground = this.terrain.heightAt(t.x);
      const pad = t.isBoss ? 28 : 18;
      for (let dx = -pad; dx <= pad; dx++) {
        const xi = Utils.clamp(Math.round(t.x + dx), 0, W - 1);
        this.terrain.h[xi] = Utils.lerp(this.terrain.h[xi], ground, 0.85);
      }
      t.y = this.terrain.heightAt(t.x);
      t.health = t.isBoss ? 600 : 100; t.alive = true;
      t.vy = 0; t.falling = false; t.buried = false; t.chuteActive = false;
      t.angle = t.x < W / 2 ? 60 : 120;
      t.roundDamage = 0; t.roundKills = 0;
      t._feats = {}; // mock achievements re-earnable each round
      t.lastImpact = null;
      t.emp = 0;
      // fuel: one super fuel pack consumed per round
      t.fuel = 100;
      if (t.ammo('superfuel') > 0) { t.consumeAmmo('superfuel'); t.fuel += 100; }
      t.maxFuel = t.fuel;
      // pre-deployed shield
      t.shield = null;
      if (t.isBoss) {
        t.shield = { hp: 300, max: 300 };
        AudioEngine.humStart();
      } else if (t.predeployShield) {
        t.shield = { hp: 100, max: 100 };
        t.predeployShield = false;
        AudioEngine.humStart();
      }
    });
    this.terrain.dirty = true;

    this.turnIdx = Utils.randInt(0, n - 1);
    this.banner = { text: `ROUND ${this.round} / ${this.totalRounds}`, sub: this.theme.name, timer: 2.4 };
    this.randomizeWind();
    this.startTurn();
  }

  randomizeWind() {
    const wMode = this.settings.weather || 'random';
    if (wMode === 'calm') {
      this.wind = 0;
      return;
    }
    if (wMode === 'windy') {
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.wind = sign * Utils.rand(0.6, 1.0) * this.theme.windMax;
      return;
    }
    if (wMode === 'wtf') {
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.wind = sign * Utils.rand(0.5, 3.0) * this.theme.windMax;
      return;
    }
    this.wind = Utils.rand(-1, 1) * this.theme.windMax;
    if (Math.abs(this.wind) < 0.4) this.wind = 0;
  }

  getWindAt(x, y, t) {
    if (this.settings.weather !== 'wtf') {
      return this.wind;
    }
    const wave = Math.sin(x * 0.004 + t * 3.5) * 11;
    return this.wind + wave;
  }

  get activeTank() { return this.tanks[this.turnIdx]; }

  startTurn() {
    this.phase = 'aim';
    this.settleTimer = 0;
    const t = this.activeTank;
    if (t.buried) t.stats.buriedTurns++;
    if (t.isBoss && t.alive) {
      if (!t.shield) {
        t.shield = { hp: 50, max: 300 };
      } else {
        t.shield.max = 300;
        t.shield.hp = Math.min(300, t.shield.hp + 50);
      }
      AudioEngine.shieldOn();
    }
    if (t.isBot) this.ai.get(t).beginTurn(this);
    SaveSystem.saveMatch(this);
  }

  nextTurn() {
    // EMP wears off as the fried tank's turn ends
    if (this.activeTank && this.activeTank.emp > 0) this.activeTank.emp--;
    if (this.checkRoundEnd()) return;
    this.randomizeWind();
    for (let i = 1; i <= this.tanks.length; i++) {
      const idx = (this.turnIdx + i) % this.tanks.length;
      if (this.tanks[idx].alive) { this.turnIdx = idx; break; }
    }
    this.startTurn();
  }

  checkRoundEnd() {
    const alive = this.tanks.filter(t => t.alive);
    const teams = this.settings.mode === 'teams';
    if (teams) {
      if (new Set(alive.map(t => t.team)).size > 1) return false;
    } else if (alive.length > 1) return false;
    this.phase = 'roundend';
    this.delayTimer = 2.6;
    let winners, text;
    if (teams && alive.length) {
      winners = alive;
      text = `TEAM ${alive[0].team === 0 ? 'ALPHA' : 'BRAVO'} WINS ROUND ${this.round}!`;
    } else {
      winners = alive.slice(0, 1);
      text = alive[0] ? `${alive[0].name} WINS ROUND ${this.round}!` : `ROUND ${this.round}: MUTUAL DESTRUCTION`;
    }
    this.banner = { text, sub: '', timer: 2.6 };
    // round awards + 5% interest on the war chest
    for (const t of this.tanks) {
      if (isFinite(t.cash) && t.cash > 0) {
        const interest = Math.round(t.cash * 0.05);
        t.cash += interest;
        t.stats.earned += interest;
      }
      if (t.alive) {
        this._award(t, 50, 2000); // survival
        t.score += 100;
      }
      if (winners.includes(t)) { this._award(t, 100, 2500); t.score += 150; }
      if (!this.settings.noLevels) SaveSystem.saveProfile(t.name, t.xp);
    }
    return true;
  }

  _afterRoundEnd() {
    if (this.round >= this.totalRounds) { this.endMatch(); return; }
    this.phase = 'shop';
    // bots shop immediately; humans get the UI
    for (const t of this.tanks) if (t.isBot) botShop(t, this);
    SaveSystem.saveMatch(this);
    if (this.onShop) this.onShop();
  }

  endMatch() {
    this.phase = 'over';
    SaveSystem.clearMatch();
    if (!this.settings.noLevels) for (const t of this.tanks) SaveSystem.saveProfile(t.name, t.xp);
    const standings = [...this.tanks].sort((a, b) => b.score - a.score)
      .map(t => ({ name: t.name, score: t.score, level: t.level, color: t.color, type: t.type, team: t.team }));
    if (this.onGameOver) this.onGameOver(standings, this._computeAwards());
  }

  /** Dubious-honors ceremony for the game-over screen. */
  _computeAwards() {
    const top = (stat, fmt) => {
      let best = null;
      for (const t of this.tanks) if (t.stats[stat] > 0 && (!best || t.stats[stat] > best.stats[stat])) best = t;
      return best ? { name: best.name, color: best.color, value: fmt(best.stats[stat]) } : null;
    };
    const defs = [
      ['🏆 GLASS CANNON — most self-damage', top('selfDmg', v => Math.round(v) + ' dmg')],
      ['🔭 ASTRONOMER — most shots off the map', top('offMap', v => v + (v === 1 ? ' shot' : ' shots'))],
      ['🪱 DIRT CONNOISSEUR — most turns spent buried', top('buriedTurns', v => v + (v === 1 ? ' turn' : ' turns'))],
      ['💥 ONE-HIT WONDER — biggest single hit', top('bigHit', v => v + ' dmg')],
      ['🤑 WAR PROFITEER — most cash earned', top('earned', v => Utils.money(v))],
    ];
    return defs.filter(([, w]) => w).map(([title, w]) => ({ title, ...w }));
  }

  /* ================= firing pipeline ================= */

  /** Begin the firing sequence: lock controls, show saying, beat, launch. */
  fire(tank) {
    if (this.phase !== 'aim' || tank !== this.activeTank || !tank.alive || this.awaitingConfirm) return;
    const def = ItemCatalog.weapon(tank.selectedWeapon);
    if (!def || tank.ammo(def.id) <= 0) { AudioEngine.error(); return; }
    // some weapons demand a human confirmation before they'll launch
    if (def.confirm && !tank.isBot && this.onConfirm) {
      this.awaitingConfirm = true;
      this.onConfirm(pickConfirmMessage(), def,
        () => { this.awaitingConfirm = false; this._beginFire(tank, def); },
        () => { this.awaitingConfirm = false; AudioEngine.click(); });
      return;
    }
    this._beginFire(tank, def);
  }

  _beginFire(tank, def) {
    if (this.phase !== 'aim' || tank !== this.activeTank || !tank.alive) return;
    this.phase = 'delay';
    this.delayTimer = FIRE_BEAT;
    this._pendingShooter = tank;
    FX.addBubble(tank.x, tank.y - 46, pickFireSaying(def.bubble), FIRE_BEAT + 1.1, { follow: tank });
  }

  _spawnShot() {
    const tank = this._pendingShooter;
    this._pendingShooter = null;
    if (!tank || !tank.alive) { this.phase = 'sim'; return; }
    const def = ItemCatalog.weapon(tank.selectedWeapon);
    tank.consumeAmmo(def.id);

    // a buried tank blasts itself free first
    if (tank.buried) {
      this.terrain.crater(tank.x, tank.y - 10, 22);
      FX.dirtBurst(tank.x, tank.y - 10, 22, this.theme.soilTop);
      tank._updateBuried(this.terrain);
    }

    this.phase = 'sim';
    this.settleTimer = 0;
    this.terrainWait = 0;
    this._turnKills = new Map();
    this._missTaunted = false;

    AudioEngine.launch(tank.x);
    const m = tank.muzzle();
    // muzzle flash
    FX.ring(m.x, m.y, 22, 0.22, '#ffe9a0');
    for (let i = 0; i < 7; i++) {
      FX.spawn({
        x: m.x, y: m.y,
        vx: m.dx * Utils.rand(60, 220) + Utils.rand(-40, 40),
        vy: m.dy * Utils.rand(60, 220) + Utils.rand(-40, 40),
        life: Utils.rand(0.12, 0.3), size: Utils.rand(1.5, 3.5),
        color: Utils.choice(['#fff3c0', '#ffc24a', '#ffffff']),
        grav: 0, kind: 'spark',
      });
    }
    // The Refund: coin flip between a jackpot round and a breech explosion
    let firedDef = def;
    if (def.gamble) {
      if (Math.random() < 0.5) {
        FX.addBubble(tank.x, tank.y - 46, 'Refund DENIED.', 2.2, { color: '#ff9090', follow: tank });
        this.applyExplosion(m.x, m.y, { dmg: def.selfDmg || 45, radius: def.radius }, tank, { direct: tank });
        return;
      }
      firedDef = Object.assign({}, def, { dmg: def.jackpotDmg || 90 });
      FX.addBubble(tank.x, tank.y - 46, 'JACKPOT ROUND!', 2.2, { color: '#7dff9a', follow: tank });
    }

    let speed = tank.power * POWER_TO_SPEED;
    if (def.special === 'railgun') speed = Math.max(speed * 2.6, 1600); // hypervelocity
    if (tank.isBoss) {
      const angles = [-0.0872665, 0, 0.0872665];
      const s = 1.6;
      const baseY = tank.y - TANK_H * s;
      for (const a of angles) {
        const rad = Utils.deg2rad(tank.angle) + a;
        const rdx = Math.cos(rad), rdy = -Math.sin(rad);
        const mx = tank.x + rdx * 38 * s;
        const my = baseY + rdy * 38 * s;
        const p = new Projectile(firedDef, mx, my, rdx * speed, rdy * speed, tank, this);
        this.projectiles.push(p);
      }
    } else {
      const p = new Projectile(firedDef, m.x, m.y, m.dx * speed, m.dy * speed, tank, this);
      this.projectiles.push(p);
    }
    FX.addShake(3);
  }

  /* ================= combat resolution ================= */

  applyExplosion(x, y, def, owner, { direct = null, isSub = false } = {}) {
    const r = def.radius || 24;
    this.terrain.crater(x, y, r * 0.92);
    FX.explosion(x, y, r, this.theme.soilTop);
    FX.addShake(def.shake || r * 0.12);
    AudioEngine.explosion(x, Utils.clamp(r / 110, 0.15, 1));
    if (def.flash) { FX.flash(1.4); FX.addShake(30); } // thermonuclear white-out
    // nuclear blasts darken the world so the fireball looks blinding
    if (def.nuclear) {
      FX.nukeDim(r >= 100 ? 0.8 : r >= 55 ? 0.68 : 0.55);
      FX.ring(x, y, r * 3.4, 0.9, 'rgba(255,240,200,0.9)');
      // rising incandescent plume that lingers through the dim
      for (let i = 0; i < 10; i++) {
        FX.spawn({
          x: x + Utils.rand(-r * 0.3, r * 0.3), y: y - Utils.rand(0, r * 0.4),
          vx: Utils.rand(-16, 16), vy: Utils.rand(-95, -30),
          life: Utils.rand(0.8, 1.7), size: Utils.rand(r * 0.18, r * 0.42),
          color: Utils.choice(['#ffdf90', '#ff9a40', '#fff6d0']),
          grav: -0.12, kind: 'glow',
        });
      }
    }

    let anyHit = false;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      // Shells detonate on the shield dome surface, which sits further out
      // than the hull. Measure the blast to the dome as if it were the hull,
      // or small weapons (missile reach 40 < full dome radius 42) could
      // never scratch a shield.
      const domePad = t.hitRadius - t.radius;
      const d = Math.max(0, Utils.dist(x, y, t.x, t.y - 8) - domePad);
      const reach = r + t.radius;
      if (d > reach) continue;
      anyHit = true;
      const falloff = 1 - Math.max(0, d - r * 0.3) / (reach - r * 0.3);
      const dmg = (def.dmg || 0) * Utils.clamp(falloff, 0.08, 1);
      const isDirect = (direct === t) || d < r * 0.35;
      if (dmg > 0) this.damageTank(t, dmg, owner, isDirect);
    }
    // decoys are physical: blasts pop them
    for (const hz of this.hazards) {
      if (hz.kind !== 'decoy' || hz.dead) continue;
      const d = Utils.dist(x, y, hz.x, hz.y - 8);
      if (d < r + 16) hz.hit((def.dmg || 0) * Utils.clamp(1 - d / (r + 16), 0.2, 1));
    }

    this._markImpact(owner, x, y);

    // a clean miss that lands near somebody earns the shooter some lip
    if (!anyHit && owner && (def.dmg || 0) > 0 && !this._missTaunted) {
      let closest = null, cd = 1e9;
      for (const t of this.tanks) {
        if (!t.alive || t === owner || areAllies(t, owner)) continue;
        const d = Utils.dist(x, y, t.x, t.y - 8);
        if (d < cd) { cd = d; closest = t; }
      }
      if (closest && cd < r + 110 && Math.random() < 0.55) {
        this._missTaunted = true;
        FX.addBubble(closest.x, closest.y - 46, pickNearMissSaying(), 2.6, { follow: closest });
      }
    }
    this._checkDeaths(owner);
  }

  /**
   * Neutron Bomb — the granddaddy. A big central blast (shield-absorbed,
   * with falloff) plus a battlefield-wide radiation pulse that PIERCES energy
   * shields and reaches every other tank on the map, scaled by distance.
   */
  applyNeutron(x, y, def, owner) {
    const r = def.radius || 195;
    // colossal central blast carves a huge crater
    this.terrain.crater(x, y, r * 0.92);
    // layered fireball bursts for a bigger, denser detonation core
    FX.explosion(x, y, r, this.theme.soilTop);
    FX.explosion(x, y, r * 0.6, this.theme.soilTop);
    FX.addShake(def.shake || 64);
    FX.flash(2.4);             // brighter initial white-out
    FX.nukeDim(0.9);
    FX.ring(x, y, r * 3.2, 1.1, 'rgba(255,255,255,0.95)');
    FX.ring(x, y, r * 4.4, 1.6, 'rgba(190,255,170,0.8)');
    AudioEngine.explosion(x, 1);
    // lingering radiation wash, expanding pulse rings, sustained secondary
    // fireballs and a slow rolling shockwave (visual + ambience)
    this.hazards.push(new NeutronPulse(x, y, this));

    const mapDiag = Math.hypot(W, H);
    const radNear = def.radNear || 90, radFar = def.radFar || 40;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const rawD = Utils.dist(x, y, t.x, t.y - 8);
      // blast (shield-absorbable) for anyone caught in the fireball;
      // measured to the shield dome surface, same as applyExplosion
      const d = Math.max(0, rawD - (t.hitRadius - t.radius));
      const reach = r + t.radius;
      if (d <= reach) {
        const falloff = 1 - Math.max(0, d - r * 0.3) / (reach - r * 0.3);
        const blast = (def.dmg || 0) * Utils.clamp(falloff, 0.1, 1);
        if (blast > 0) this.damageTank(t, blast, owner, d < r * 0.35);
      }
      // radiation reaches the whole map and ignores energy shields entirely.
      // The owner is shielded inside their own (sealed) firing tank.
      if (t === owner) continue;
      const radFrac = Utils.clamp(1 - rawD / mapDiag, 0, 1);
      const rad = Utils.lerp(radFar, radNear, radFrac);
      if (rad > 0) this.damageTank(t, rad, owner, false, false, true /* pierceShield */);
    }
    this._checkDeaths(owner);
  }

  /** Remember where this tank's last shell landed (for the aim marker). */
  _markImpact(owner, x, y) {
    if (owner) owner.lastImpact = { x, y };
  }

  applyDirt(x, y, def, owner = null) {
    const wasBuried = owner ? owner.buried : true;
    this._markImpact(owner, x, y);
    this.terrain.mound(x, def.radius);
    FX.dirtBurst(x, y, def.radius, this.theme.soilTop);
    AudioEngine.explosion(x, 0.25);
    FX.addShake(4);
    for (const t of this.tanks) if (t.alive) t._updateBuried(this.terrain);
    if (owner && owner.alive && owner.buried && !wasBuried) this._feat(owner, 'selfbury');
  }

  applyFissure(x, y, def, owner) {
    this.terrain.fissure(x, 14);
    FX.dirtBurst(x, y, 30, this.theme.soilTop);
    FX.addShake(10);
    AudioEngine.explosion(x, 0.5);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.abs(t.x - x);
      if (d < 26) this.damageTank(t, def.dmg * (1 - d / 30), owner, d < 8);
    }
    this._checkDeaths(owner);
  }

  applyNapalm(x, y, owner, count = 26) {
    AudioEngine.explosion(x, 0.45);
    FX.addShake(5);
    this._markImpact(owner, x, y);
    for (let i = 0; i < count; i++) {
      const a = Utils.rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const sp = Utils.rand(40, 230);
      this.hazards.push(new NapalmDrop(x, y - 4, Math.cos(a) * sp, Math.sin(a) * sp, owner));
    }
  }

  applyGlacier(x, y, def, owner) {
    // small blast first, then the freeze locks whatever shape is left
    this.applyExplosion(x, y, { dmg: def.dmg, radius: def.radius }, owner, {});
    this.terrain.freeze(x, def.freezeHalf || 110);
    FX.ring(x, y, (def.freezeHalf || 110) * 0.9, 0.6, '#bfe8ff');
    AudioEngine.shieldOn();
    for (let i = 0; i < 14; i++) {
      FX.spawn({
        x: x + Utils.rand(-def.freezeHalf, def.freezeHalf), y: this.terrain.heightAt(x) - Utils.rand(0, 10),
        vx: Utils.rand(-30, 30), vy: Utils.rand(-80, -20),
        life: Utils.rand(0.4, 0.9), size: Utils.rand(1.5, 3), color: '#dff4ff', grav: 0.3, kind: 'spark',
      });
    }
  }

  applyQuake(x, y, def, owner) {
    this.applyExplosion(x, y, { dmg: def.dmg, radius: def.radius }, owner, {});
    const range = def.quakeRange || 260;
    const ter = this.terrain;
    for (let dx = -range; dx <= range; dx++) {
      const xi = Math.round(x + dx);
      if (xi < 0 || xi >= W) continue;
      const fall = 1 - Math.abs(dx) / range;
      const wave = Math.sin(Math.abs(dx) * 0.055) * 22 * fall;
      const limitY = ter.indestructible[xi];
      ter.h[xi] = Utils.clamp(ter.h[xi] + wave, 30, limitY);
    }
    ter.dirty = true;
    FX.addShake(26);
    AudioEngine.explosion(x, 0.8);
    // rattle everyone standing in the wave zone
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (Math.abs(t.x - x) < range) {
        const ground = ter.heightAt(t.x);
        if (ground > t.y + 1.5) t.falling = true; // floor dropped: fall (chutes/fall damage apply)
        t._updateBuried(ter);
      }
    }
  }

  applyTeleport(x, y, owner) {
    if (!owner || !owner.alive) return;
    FX.ring(owner.x, owner.y - 10, 30, 0.4, '#bf8fff');
    const nx = Utils.clamp(x, 12, W - 12);
    owner.x = nx;
    owner.y = Math.min(this.terrain.heightAt(nx), y);
    owner.falling = this.terrain.heightAt(nx) > owner.y + 1.5;
    owner.vy = 0;
    owner._updateBuried(this.terrain);
    this._markImpact(owner, nx, owner.y);
    FX.ring(nx, owner.y - 10, 34, 0.5, '#bf8fff');
    for (let i = 0; i < 12; i++) {
      FX.spawn({
        x: nx + Utils.rand(-14, 14), y: owner.y - Utils.rand(0, 24),
        vx: Utils.rand(-40, 40), vy: Utils.rand(-60, 10),
        life: Utils.rand(0.3, 0.6), size: 2, color: '#d9b8ff', grav: -0.1, kind: 'spark',
      });
    }
    AudioEngine.click();
  }

  applyAcidRain(x, y, def, owner) {
    this.applyExplosion(x, y, { dmg: def.dmg, radius: def.radius }, owner, {});
    this.hazards.push(new AcidStorm(x, def, owner, this));
  }

  /**
   * EMP: modest blast, drains (not deletes) energy shields, and fries
   * electronics — mag-shield, targeting aids, bot fire-control — for one
   * of the victim's turns. Deliberately not a killer: it opens a window.
   */
  applyEmp(x, y, def, owner, direct) {
    this.applyExplosion(x, y, { dmg: def.dmg, radius: def.radius }, owner, { direct });
    const R = def.empRadius || 140;
    FX.ring(x, y, R, 0.5, '#7fd4ff');
    FX.ring(x, y, R * 0.6, 0.35, '#ffffff');
    AudioEngine.laser(x);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (Utils.dist(x, y, t.x, t.y - 8) > R) continue;
      t.emp = 1; // electronics down for their next turn (cleared as it ends)
      if (t.shield) {
        t.shield.hp -= def.empDrain || 60;
        FX.ring(t.x, t.y - 10, t.hitRadius + 4, 0.3, '#9fe8ff');
        if (t.shield.hp <= 0) {
          t.shield = null;
          AudioEngine.humStop();
        }
      }
      FX.sparkTrail(t.x, t.y - 16, '#7fd4ff');
    }
  }

  applyGrapple(x, y, def, owner, direct) {
    this.applyExplosion(x, y, { dmg: def.dmg, radius: def.radius }, owner, { direct });
    const R = def.pullRadius || 150;
    for (const t of this.tanks) {
      if (!t.alive || t === owner) continue;
      const dx = t.x - x;
      const d = Math.abs(dx);
      if (d > R || d < 2) continue;
      const pull = (1 - d / R) * 100;
      FX.sparkTrail(t.x, t.y - 10, '#ffd54f');
      t.x = Utils.clamp(t.x - Math.sign(dx) * Math.min(pull, d - 6), 10, W - 10);
      const ground = this.terrain.heightAt(t.x);
      if (ground > t.y) t.falling = true;
      else if (ground >= t.y - 1.5) t.y = ground;
      t._updateBuried(this.terrain);
    }
    FX.ring(x, y, R * 0.8, 0.4, '#ffd54f');
    AudioEngine.bounce(x);
  }

  scheduleCarpet(x, def, owner) {
    this.hazards.push(new CarpetPlane(x, def, owner, this));
  }

  scheduleMeteors(def, owner) {
    this.hazards.push(new MeteorStorm(def, owner, this));
    FX.addShake(4);
  }

  spawnDecoy(x, owner) {
    this.hazards.push(new Decoy(x, owner, this));
    AudioEngine.click();
    FX.ring(x, this.terrain.heightAt(x) - 10, 24, 0.4, '#e8d9a0');
  }

  spawnVortex(x, y, def, owner) {
    this.hazards.push(new Vortex(x, y, def, owner));
    AudioEngine._tone({ type: 'sine', f0: 320, f1: 36, dur: 2.6, gain: 0.25, pan: AudioEngine._panValue(x) });
  }

  scheduleKineticRods(x, def, owner) {
    this.hazards.push(new RodStrike(x, def, owner));
  }

  scheduleMaser(x, y, def, owner) {
    this.hazards.push(new MaserStrike(x, y, def, owner));
    AudioEngine.maserCharge(x);
  }

  /** Central damage entry point: handles shields, XP, cash, kill credit. */
  damageTank(victim, amount, owner, direct = false, silent = false, pierceShield = false) {
    if (!victim.alive || amount <= 0) return 0;
    const shieldBefore = victim.shield ? victim.shield.hp : 0;
    const actual = victim.takeDamage(amount, pierceShield);
    const absorbed = shieldBefore - (victim.shield ? victim.shield.hp : 0);
    if (!silent && absorbed > 0) {
      // cyan shimmer so shield hits read as "absorbed", not "missed"
      FX.ring(victim.x, victim.y - 10, victim.hitRadius + 6, 0.3, '#9fe8ff');
      FX.sparkTrail(victim.x, victim.y - 12, '#7fd4ff');
    }
    if (owner === victim && (actual > 0 || absorbed > 0)) {
      victim.stats.selfDmg += actual + absorbed;
      this._feat(victim, 'selfdamage');
    }
    if (owner && owner !== victim && !areAllies(owner, victim)) {
      victim.lastDamager = owner;
      if (actual > 0) {
        owner.cash += actual * 20;
        owner.stats.earned += actual * 20;
        owner.stats.bigHit = Math.max(owner.stats.bigHit, Math.round(actual));
        owner.score += actual;
        owner.roundDamage += actual;
        this._award(owner, actual + (direct ? 30 : 0), 0);
      }
      // chipping a shield pays too, at half rate — sieges shouldn't be free
      if (absorbed > 0) {
        owner.cash += Math.round(absorbed * 10);
        owner.stats.earned += Math.round(absorbed * 10);
        owner.score += Math.round(absorbed * 0.5);
        this._award(owner, Math.round(absorbed * 0.5), 0);
      }
    }
    if (!silent && actual > 0) FX.sparkTrail(victim.x, victim.y - 12, '#ff7070');
    return actual;
  }

  /** Announcer banner when one volley claims several tanks. */
  _announceMultiKill(killer, n) {
    const label = n === 2 ? 'DOUBLE KILL!' : n === 3 ? 'TRIPLE KILL!'
      : n === 4 ? 'QUAD KILL!' : 'TOTAL ANNIHILATION!';
    this.banner = { text: `${killer.name}: ${label}`, sub: pickMultiKillLine(), timer: 2.2 };
    AudioEngine.levelUp();
  }

  /** Mock achievement toast for a dubious feat, once per feat kind per round. */
  _feat(tank, kind) {
    if (!tank) return;
    if (!tank._feats) tank._feats = {};
    if (tank._feats[kind]) return;
    tank._feats[kind] = true;
    FX.addBubble(tank.x, tank.y - 60, pickFeatSaying(kind), 3.4,
      { color: '#ffd54f', follow: tank.alive ? tank : null });
    AudioEngine.click();
  }

  _award(tank, xp, cash) {
    tank.cash += cash;
    tank.stats.earned += cash;
    if (this.settings.noLevels) return; // sandbox mode: no XP, no level-ups
    const ups = tank.addXP(xp);
    if (ups > 0) {
      AudioEngine.levelUp();
      FX.addBubble(tank.x, tank.y - 70, `LEVEL UP! Lv ${tank.level}`, 2.2, { color: '#7dff9a' });
      SaveSystem.saveProfile(tank.name, tank.xp);
    }
  }

  _checkDeaths(killer) {
    let taunted = false; // one gloat per volley, even on a multi-kill
    for (const t of this.tanks) {
      if (!t.alive || t.health > 0) continue;
      t.alive = false;
      if (t.shield) { t.shield = null; AudioEngine.humStop(); }
      FX.explosion(t.x, t.y - 8, 40, this.theme.soilTop);
      FX.addShake(10);
      AudioEngine.explosion(t.x, 0.7);
      this.terrain.crater(t.x, t.y, 20);
      t.y = this.terrain.heightAt(t.x);
      t.falling = true;
      FX.addBubble(t.x, t.y - 52, pickDeathSaying(), 3.8, { color: '#ff9090' });
      const credit = (killer && killer !== t && killer.alive !== undefined) ? killer : t.lastDamager;
      if (credit && credit !== t && !areAllies(credit, t)) {
        credit.roundKills++;
        credit.score += 100;
        this._award(credit, 80, 3000);
        if (credit.alive && !taunted) {
          taunted = true;
          FX.addBubble(credit.x, credit.y - 46, pickKillSaying(), 3.4, { follow: credit });
        }
        const streak = (this._turnKills.get(credit) || 0) + 1;
        this._turnKills.set(credit, streak);
        if (streak >= 2) this._announceMultiKill(credit, streak);
      }
    }
  }

  /* ================= simulation helpers (AI + trajectory preview) ================= */

  /**
   * Pure ballistic integration matching Projectile physics (sans specials).
   * Returns impact {x, y} or null if the shot left the world.
   */
  simulateShot(tank, angleDeg, power, useWind, def = null) {
    const path = this.simulatePath(tank, angleDeg, power, useWind, def, 1400);
    return path.impact;
  }

  simulatePath(tank, angleDeg, power, useWind, def = null, maxSteps = 900) {
    const rad = Utils.deg2rad(angleDeg);
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const baseY = tank.y - TANK_H;
    let x = tank.x + dx * 24, y = baseY + dy * 24;
    let speed = power * POWER_TO_SPEED;
    if (def && def.special === 'railgun') speed = Math.max(speed * 2.6, 1600);
    let vx = dx * speed, vy = dy * speed;
    const windImmune = def && def.special === 'railgun';
    const dt = 1 / 90;
    const points = [];
    let impact = null;

    for (let i = 0; i < maxSteps; i++) {
      if (useWind && !windImmune) {
        const curWind = this.settings.weather === 'wtf' ? this.getWindAt(x, y, this.time) : this.wind;
        vx += curWind * WIND_ACCEL * dt;
      }
      vy += GRAV * dt;
      const sp = Math.hypot(vx, vy);
      const sub = Math.max(1, Math.ceil(sp * dt / 3));
      const sdt = dt / sub;
      let done = false;
      for (let s = 0; s < sub; s++) {
        x += vx * sdt;
        y += vy * sdt;
        if (this.settings.wrap) {
          if (x < 0) x += W; else if (x >= W) x -= W;
        } else if (x < -200 || x > W + 200) { done = true; break; }
        if (y > H + 60) { done = true; break; }
        // tank collision
        for (const t of this.tanks) {
          if (!t.alive || t === tank) continue;
          if (Utils.dist(x, y, t.x, t.y - 8) <= t.radius) {
            impact = { x, y, tank: t };
            done = true; break;
          }
        }
        if (done) break;
        if (y > 0 && this.terrain.isSolid(x, y)) {
          impact = { x, y };
          done = true; break;
        }
      }
      if (i % 3 === 0) points.push({ x, y });
      if (done) break;
    }
    return { points, impact };
  }

  /* ================= input API (humans) ================= */

  get humanCanAct() {
    return this.phase === 'aim' && !this.awaitingConfirm &&
      this.activeTank && !this.activeTank.isBot && this.activeTank.alive;
  }

  adjustAngle(dir, dt) {
    if (!this.humanCanAct) return;
    const t = this.activeTank;
    t.angle = Utils.clamp(t.angle + dir * 40 * dt, 0, 180);
  }

  adjustPower(dir, dt) {
    if (!this.humanCanAct) return;
    const t = this.activeTank;
    t.power = Utils.clamp(t.power + dir * 34 * dt, 1, 100);
  }

  drive(dir, dt) {
    if (!this.humanCanAct) return;
    this.activeTank.drive(dir, dt, this.terrain);
  }

  cycleWeapon(dir) {
    if (!this.humanCanAct) return;
    this.activeTank.cycleWeapon(dir);
    AudioEngine.click();
  }

  tryActivateShield() {
    if (!this.humanCanAct) return;
    if (!this.activeTank.activateShield()) AudioEngine.error();
  }

  tryFire() {
    if (!this.humanCanAct) return;
    this.fire(this.activeTank);
  }

  /* ================= main update ================= */

  update(dt) {
    this.time += dt;
    if (this.phase === 'idle' || this.phase === 'over' || this.phase === 'shop') {
      if (typeof AudioEngine !== 'undefined') AudioEngine.setIntensity(0);
      return;
    }

    // Calculate real-time intensity based on min health of alive human players and wind speed
    const humans = this.tanks.filter(t => t.alive && t.type === 'human');
    const targetTanks = humans.length > 0 ? humans : this.tanks.filter(t => t.alive);
    const minHp = targetTanks.length > 0 ? targetTanks.reduce((min, t) => Math.min(min, t.health), 100) : 100;
    const hpIntensity = (100 - minHp) / 100;
    const maxWind = (this.theme && this.theme.windMax) ? this.theme.windMax : 100;
    const windIntensity = Math.abs(this.wind) / maxWind;
    const windScale = this.settings.weather === 'wtf' ? 0.4 : 0.2;
    const intensity = Math.max(hpIntensity, Math.min(1.0, windIntensity * windScale));
    if (typeof AudioEngine !== 'undefined') {
      AudioEngine.setIntensity(intensity);
    }

    // update sky clouds dynamically
    if (typeof updateSky !== 'undefined') {
      updateSky(this.themeState, dt, this.wind);
    }

    // landslides relax continuously
    const terrainMoving = this.terrain.relax(dt);

    // tank physics (falling, parachutes, fall damage)
    let anyFalling = false;
    for (const t of this.tanks) {
      const evt = t.updatePhysics(dt, this.terrain);
      if (t.falling) anyFalling = true;
      if (evt && evt.kind === 'fall' && evt.dmg > 0) {
        if (t.alive) {
          this.damageTank(t, evt.dmg, null);
        }
        FX.dirtBurst(t.x, t.y, 14, this.theme.soilTop);
        AudioEngine.explosion(t.x, 0.2);
      }
    }
    this._checkDeaths(null);

    // weather + particles + hazard vortices
    const vortices = this.hazards.filter(h => h.kind === 'vortex');
    FX.spawnWeather(dt, this.theme, this.wind, this.settings.weather);
    FX.update(dt, this.terrain, vortices, this.wind);

    // volcanic themes erupt now and then: a spray of lava droplets
    if (this.theme.eruptions && Math.random() < dt / 14) {
      const ex = Utils.rand(60, W - 60);
      const ey = this.terrain.heightAt(ex);
      FX.explosion(ex, ey, 22, this.theme.soilTop);
      AudioEngine.explosion(ex, 0.25);
      FX.addShake(4);
      const n = Utils.randInt(3, 5);
      for (let i = 0; i < n; i++) {
        this.hazards.push(new NapalmDrop(ex, ey - 6, Utils.rand(-90, 90), Utils.rand(-380, -200), null));
      }
    }

    // hazards tick in every active phase — eruption droplets fall during
    // aim, decoys settle onto craters, napalm keeps burning between turns
    for (const hz of this.hazards) hz.update(dt, this);
    this.hazards = this.hazards.filter(h => !h.dead);

    switch (this.phase) {
      case 'aim': {
        const t = this.activeTank;
        if (!t.alive) { this.nextTurn(); break; }
        if (t.isBot) this.ai.get(t).update(dt, this);
        break;
      }
      case 'delay': {
        this.delayTimer -= dt;
        if (this.delayTimer <= 0) this._spawnShot();
        break;
      }
      case 'sim': {
        for (const p of this.projectiles) p.update(dt);
        this.projectiles = this.projectiles.filter(p => !p.dead && p.age < 25);
        this._checkDeaths(null);

        // decoys persist between turns — they must not stall the settle timer
        const liveHazards = this.hazards.some(h => h.kind !== 'decoy');
        const action = this.projectiles.length > 0 || liveHazards || anyFalling;
        if (action) {
          this.settleTimer = 0;
          this.terrainWait = 0;
        } else if (terrainMoving && (this.terrainWait += dt) < 3.5) {
          // give landslides a moment, but slow oozing slides shouldn't hold the turn hostage
          this.settleTimer = 0;
        } else {
          this.settleTimer += dt;
          if (this.settleTimer > 0.55) this.nextTurn();
        }
        break;
      }
      case 'roundend': {
        this.delayTimer -= dt;
        if (this.delayTimer <= 0) this._afterRoundEnd();
        break;
      }
    }

    if (this.banner) {
      this.banner.timer -= dt;
      if (this.banner.timer <= 0) this.banner = null;
    }
  }

  /* ================= rendering ================= */

  render(ctx) {
    const t = this.time;
    drawSky(ctx, this.theme, this.themeState, t, this.wind);

    const shake = FX.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // terrain (cached)
    if (this.terrain.dirty) {
      drawTerrainCache(this._terrainCtx, this.terrain, this.theme);
      this.terrain.dirty = false;
    }
    ctx.drawImage(this._terrainCache, 0, 0);
    this.drawIceOverlay(ctx, t);

    this.drawWindFlag(ctx, t);

    // aim aids for the aiming human: last-shot marker + trajectory preview
    if (this.humanCanAct) {
      this.drawImpactMarker(ctx, t);
      this.drawTrajectory(ctx);
    }

    // hazards under tanks (napalm pools), vortices above
    for (const hz of this.hazards) hz.draw(ctx, t);

    for (const tank of this.tanks) tank.draw(ctx, tank === this.activeTank && this.phase !== 'over', t);
    for (const p of this.projectiles) p.draw(ctx);

    // nuclear dimming: darken the scene, then draw the (additive) blast on
    // top so the fireball stays blinding against the darkness
    if (FX.dimAlpha > 0.01) {
      ctx.fillStyle = `rgba(3,3,14,${Utils.clamp(FX.dimAlpha, 0, 0.85)})`;
      ctx.fillRect(-60, -60, W + 120, H + 120);
    }

    FX.draw(ctx);
    FX.drawBubbles(ctx);
    ctx.restore();

    ctx.drawImage(this._vignette, 0, 0);

    this.drawHUD(ctx);

    // thermonuclear white-out
    if (FX.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Utils.clamp(FX.flashAlpha, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.banner) this.drawBanner(ctx);
  }

  /* --- central wind indicator: flagpole with fluttering vane flag --- */

  drawWindFlag(ctx, t) {
    const x = W / 2;
    const baseY = this.terrain.heightAt(x);
    const topY = baseY - 78;
    ctx.save();
    // pole
    ctx.strokeStyle = '#d8d8e0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, topY);
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(x, topY - 3, 3.5, 0, TAU);
    ctx.fill();

    // flag color by wind strength
    const ratio = Math.abs(this.wind) / Math.max(1, this.theme.windMax);
    const color = ratio < 0.34 ? '#46d846' : ratio < 0.67 ? '#ffd54f' : '#ff5252';
    const dir = this.wind === 0 ? (Math.sin(t * 0.7) > 0 ? 1 : -1) * 0.15 : Math.sign(this.wind);
    const len = 26 + 36 * Math.min(1, ratio + 0.15);
    const segs = 9;

    // fluttering vane flag pointing downwind
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const y0 = topY + 2;
    ctx.moveTo(x, y0);
    const amp = 2 + 4 * ratio;
    for (let i = 1; i <= segs; i++) {
      const fx = x + dir * (len * i / segs);
      const fy = y0 + Math.sin(t * (6 + 6 * ratio) - i * 0.8) * amp * (i / segs);
      ctx.lineTo(fx, fy);
    }
    for (let i = segs; i >= 1; i--) {
      const fx = x + dir * (len * i / segs);
      const fy = y0 + 13 + Math.sin(t * (6 + 6 * ratio) - i * 0.8 + 0.5) * amp * (i / segs);
      ctx.lineTo(fx, fy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Sheen along frozen surface columns. */
  drawIceOverlay(ctx, t) {
    if (!this.terrain.ice.some(v => v)) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(190,232,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    let open = false;
    for (let x = 0; x < W; x += 2) {
      if (this.terrain.ice[x]) {
        const y = this.terrain.h[x] + 1;
        if (!open) { ctx.moveTo(x, y); open = true; }
        else ctx.lineTo(x, y);
      } else open = false;
    }
    ctx.stroke();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 2.4);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** Fading X where the active player's previous shell landed. */
  drawImpactMarker(ctx, t) {
    const mark = this.activeTank.lastImpact;
    if (!mark) return;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 4);
    ctx.strokeStyle = this.activeTank.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mark.x - 7, mark.y - 7); ctx.lineTo(mark.x + 7, mark.y + 7);
    ctx.moveTo(mark.x - 7, mark.y + 7); ctx.lineTo(mark.x + 7, mark.y - 7);
    ctx.stroke();
    ctx.globalAlpha *= 0.5;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, 12, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawTrajectory(ctx) {
    const tank = this.activeTank;
    if (tank.emp > 0) return; // targeting electronics are fried
    const hasBasic = tank.hasUpgrade('targetcomp');
    const hasReticle = tank.hasUpgrade('reticle');
    const hasWeather = tank.hasUpgrade('weather');
    if (!hasBasic && !hasReticle && !hasWeather) return;
    const def = ItemCatalog.weapon(tank.selectedWeapon);
    const path = this.simulatePath(tank, tank.angle, tank.power, hasWeather, def, hasBasic ? 420 : 300);

    ctx.save();
    ctx.fillStyle = hasWeather ? 'rgba(125,255,154,0.8)' : 'rgba(255,255,255,0.65)';
    for (let i = 0; i < path.points.length; i += 2) {
      const p = path.points[i];
      ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
    }
    if (hasReticle && path.impact) {
      const { x, y } = path.impact;
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 16, y); ctx.lineTo(x - 5, y);
      ctx.moveTo(x + 5, y); ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 5);
      ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* --- HUD --- */

  drawHUD(ctx) {
    const t = this.activeTank;
    if (!t) return;
    ctx.save();
    ctx.font = '13px "Lucida Console", Monaco, monospace';
    ctx.textAlign = 'left';

    // rounded gradient panel with a subtle top sheen
    const panel = (x, y, w, h) => {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, 'rgba(18,26,44,0.86)');
      grad.addColorStop(1, 'rgba(4,7,13,0.86)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 9); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,150,210,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 1.5);
      ctx.lineTo(x + w - 8, y + 1.5);
      ctx.stroke();
    };

    // left panel: active player
    const px = 14, py = 12;
    panel(px - 4, py - 4, 320, 118);

    ctx.fillStyle = t.color;
    ctx.fillRect(px, py + 2, 10, 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${t.name}${t.isBot ? ' [' + (AI_PROFILES[t.type] || {}).label + ']' : ''}`, px + 18, py + 11);

    const bar = (label, x, y, w, frac, color, text) => {
      ctx.fillStyle = '#9fb4d8';
      ctx.fillText(label, x, y + 9);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 58, y, w, 11);
      ctx.fillStyle = color;
      ctx.fillRect(x + 58, y, w * Utils.clamp(frac, 0, 1), 11);
      ctx.strokeStyle = 'rgba(120,140,180,0.4)';
      ctx.strokeRect(x + 58, y, w, 11);
      if (text) {
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x + 58 + w + 8, y + 10);
      }
    };

    const hpFrac = t.health / t.maxHealth;
    bar('HP', px, py + 22, 130, hpFrac, hpFrac > 0.5 ? '#5cd65c' : hpFrac > 0.25 ? '#ffd54f' : '#ff5252', `${t.health}`);
    bar('FUEL', px, py + 38, 130, t.fuel / Math.max(1, t.maxFuel), '#e8a33c', `${Math.round(t.fuel)}`);
    bar('PWR', px, py + 54, 130, t.power / 100, '#7fd4ff', `${Math.round(t.power)}`);

    ctx.fillStyle = '#9fb4d8';
    ctx.fillText(`ANGLE ${Math.round(t.angle)}°`, px, py + 84);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(Utils.money(t.cash), px + 110, py + 84);
    if (!this.settings.noLevels) {
      ctx.fillStyle = '#7dff9a';
      ctx.fillText(`Lv${t.level}`, px + 220, py + 84);
      // xp mini-bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px + 252, py + 76, 56, 8);
      ctx.fillStyle = '#39ff6a';
      ctx.fillRect(px + 252, py + 76, 56 * t.xpProgress(), 8);
    }

    // weapon line
    const def = ItemCatalog.weapon(t.selectedWeapon);
    const ammo = t.ammo(def.id);
    ctx.fillStyle = '#fff';
    ctx.fillText(`◈ ${def.name}  ${ammo === Infinity ? '∞' : 'x' + ammo}`, px, py + 104);
    if (t.shield) {
      ctx.fillStyle = '#9fe8ff';
      ctx.fillText(`SHIELD ${Math.round(t.shield.hp)}`, px + 210, py + 104);
    }

    // right panel: round, wind, roster
    const rx = W - 244, ry = 12;
    panel(rx - 4, ry - 4, 236, 64 + this.tanks.length * 16);

    ctx.fillStyle = '#fff';
    ctx.fillText(`ROUND ${this.round}/${this.totalRounds}`, rx, ry + 11);
    ctx.fillStyle = '#9fb4d8';
    ctx.fillText(this.theme.name, rx + 110, ry + 11);

    const ratio = Math.abs(this.wind) / Math.max(1, this.theme.windMax);
    const wcol = ratio < 0.34 ? '#46d846' : ratio < 0.67 ? '#ffd54f' : '#ff5252';
    ctx.fillStyle = wcol;
    const arrows = this.wind === 0 ? '·' : (this.wind < 0 ? '◀' : '▶').repeat(1 + Math.floor(ratio * 2.99));
    ctx.fillText(`WIND ${arrows} ${Math.abs(this.wind).toFixed(1)}`, rx, ry + 30);
    if (this.settings.wrap) {
      ctx.fillStyle = '#7fd4ff';
      ctx.fillText('WRAP', rx + 170, ry + 30);
    }

    this.tanks.forEach((tk, i) => {
      const yy = ry + 50 + i * 16;
      ctx.fillStyle = tk.color;
      ctx.fillRect(rx, yy - 8, 8, 8);
      ctx.fillStyle = tk.alive ? '#dfe8ff' : '#5a6678';
      const teamTag = tk.team !== undefined ? (tk.team === 0 ? 'ᴬ ' : 'ᴮ ') : '';
      ctx.fillText(`${teamTag}${tk.name.slice(0, 12)} ${tk.alive ? tk.health : '✝'}  ◆${tk.score}`, rx + 14, yy);
    });

    // bot thinking indicator
    if (t.isBot && (this.phase === 'aim')) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${t.name} is aiming${'.'.repeat(1 + Math.floor(this.time * 2) % 3)}`, W / 2, 30);
    }

    ctx.restore();
  }

  drawBanner(ctx) {
    const a = Utils.clamp(this.banner.timer / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(4,6,12,0.55)';
    ctx.fillRect(0, H / 2 - 64, W, 116);
    ctx.font = '38px "Lucida Console", Monaco, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#39ff6a';
    ctx.shadowBlur = 18;
    ctx.fillText(this.banner.text, W / 2, H / 2 - 10);
    if (this.banner.sub) {
      ctx.font = '19px "Lucida Console", Monaco, monospace';
      ctx.fillStyle = '#9fe8ff';
      ctx.fillText(this.banner.sub, W / 2, H / 2 + 28);
    }
    ctx.restore();
  }

  /* ================= save / restore ================= */

  restore(data) {
    this._matchStarted = true;
    this.settings = Object.assign({ wrap: false, sound: true }, data.settings);
    this.round = data.round;
    this.totalRounds = data.totalRounds;
    this.wind = data.wind || 0;
    this.theme = themeForRound(this.round);
    this.terrain = Terrain.deserialize(data.terrain);
    this.themeState = makeThemeState(this.theme, this.terrain.seed);
    this.tanks = data.players.map(d => Tank.deserialize(d));
    for (const t of this.tanks) {
      t.gatesOff = !!this.settings.noLevels;
      t.y = this.terrain.heightAt(t.x);
      t._updateBuried(this.terrain);
    }
    this.ai.clear();
    for (const t of this.tanks) if (t.isBot) this.ai.set(t, new AIController(t));
    this.projectiles = [];
    this.hazards = [];
    FX.reset();
    AudioEngine.humReset();
    for (const t of this.tanks) if (t.shield && t.alive) AudioEngine.humStart();
    this.turnIdx = Utils.clamp(data.turnIdx || 0, 0, this.tanks.length - 1);
    this.banner = { text: `ROUND ${this.round} / ${this.totalRounds}`, sub: this.theme.name + ' — resumed', timer: 2.2 };

    // saved during round-end/shop: skip straight to the intermission
    // (awards were already granted before the save)
    const alive = this.tanks.filter(t => t.alive);
    if (alive.length <= 1) {
      this.phase = 'roundend';
      this.delayTimer = 0.8;
      return;
    }
    if (!this.activeTank.alive) {
      for (let i = 0; i < this.tanks.length; i++) {
        if (this.tanks[i].alive) { this.turnIdx = i; break; }
      }
    }
    this.startTurn();
  }
}
