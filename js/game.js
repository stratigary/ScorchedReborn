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
    this._pendingShooter = null;

    // callbacks wired up by main.js
    this.onShop = null;
    this.onGameOver = null;
  }

  /* ================= match / round lifecycle ================= */

  newMatch(config) {
    this.settings.wrap = !!config.wrap;
    this.settings.sound = config.sound !== false;
    this.totalRounds = config.rounds || 6;
    this.round = 1;
    this.tanks = config.players.map((p, i) => {
      const t = new Tank({ name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], type: p.type });
      const prof = SaveSystem.getProfile(t.name);
      if (prof) { t.xp = prof.xp; t.level = levelForXP(t.xp); }
      return t;
    });
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
      for (let dx = -18; dx <= 18; dx++) {
        const xi = Utils.clamp(Math.round(t.x + dx), 0, W - 1);
        this.terrain.h[xi] = Utils.lerp(this.terrain.h[xi], ground, 0.85);
      }
      t.y = this.terrain.heightAt(t.x);
      t.health = 100; t.alive = true;
      t.vy = 0; t.falling = false; t.buried = false; t.chuteActive = false;
      t.angle = t.x < W / 2 ? 60 : 120;
      t.roundDamage = 0; t.roundKills = 0;
      // fuel: one super fuel pack consumed per round
      t.fuel = 100;
      if (t.ammo('superfuel') > 0) { t.consumeAmmo('superfuel'); t.fuel += 100; }
      t.maxFuel = t.fuel;
      // pre-deployed shield
      t.shield = null;
      if (t.predeployShield) {
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
    this.wind = Utils.rand(-1, 1) * this.theme.windMax;
    if (Math.abs(this.wind) < 0.4) this.wind = 0;
  }

  get activeTank() { return this.tanks[this.turnIdx]; }

  startTurn() {
    this.phase = 'aim';
    this.settleTimer = 0;
    const t = this.activeTank;
    if (t.isBot) this.ai.get(t).beginTurn(this);
    SaveSystem.saveMatch(this);
  }

  nextTurn() {
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
    if (alive.length > 1) return false;
    this.phase = 'roundend';
    this.delayTimer = 2.6;
    const winner = alive[0] || null;
    this.banner = {
      text: winner ? `${winner.name} WINS ROUND ${this.round}!` : `ROUND ${this.round}: MUTUAL DESTRUCTION`,
      sub: '', timer: 2.6,
    };
    // round awards
    for (const t of this.tanks) {
      if (t.alive) {
        this._award(t, 50, 200); // survival
        t.score += 100;
      }
      if (t === winner) { this._award(t, 100, 250); t.score += 150; }
      SaveSystem.saveProfile(t.name, t.xp);
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
    for (const t of this.tanks) SaveSystem.saveProfile(t.name, t.xp);
    const standings = [...this.tanks].sort((a, b) => b.score - a.score)
      .map(t => ({ name: t.name, score: t.score, level: t.level, color: t.color, type: t.type }));
    if (this.onGameOver) this.onGameOver(standings);
  }

  /* ================= firing pipeline ================= */

  /** Begin the firing sequence: lock controls, show saying, beat, launch. */
  fire(tank) {
    if (this.phase !== 'aim' || tank !== this.activeTank || !tank.alive) return;
    const def = ItemCatalog.weapon(tank.selectedWeapon);
    if (!def || tank.ammo(def.id) <= 0) { AudioEngine.error(); return; }
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

    if (def.special === 'laser') {
      AudioEngine.laser();
      this.applyLaser(tank, def);
      return;
    }

    AudioEngine.launch();
    const m = tank.muzzle();
    let speed = tank.power * POWER_TO_SPEED;
    if (def.special === 'railgun') speed = Math.max(speed * 2.6, 1600); // hypervelocity
    const p = new Projectile(def, m.x, m.y, m.dx * speed, m.dy * speed, tank, this);
    this.projectiles.push(p);
    FX.addShake(3);
  }

  /* ================= combat resolution ================= */

  applyExplosion(x, y, def, owner, { direct = null, isSub = false } = {}) {
    const r = def.radius || 24;
    this.terrain.crater(x, y, r * 0.92);
    FX.explosion(x, y, r);
    FX.addShake(def.shake || r * 0.12);
    AudioEngine.explosion(Utils.clamp(r / 110, 0.15, 1));
    if (def.flash) { FX.flash(1.4); FX.addShake(30); } // thermonuclear white-out

    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Utils.dist(x, y, t.x, t.y - 8);
      const reach = r + TANK_RADIUS;
      if (d > reach) continue;
      const falloff = 1 - Math.max(0, d - r * 0.3) / (reach - r * 0.3);
      const dmg = (def.dmg || 0) * Utils.clamp(falloff, 0.08, 1);
      const isDirect = (direct === t) || d < r * 0.35;
      if (dmg > 0) this.damageTank(t, dmg, owner, isDirect);
    }
    this._checkDeaths(owner);
  }

  applyDirt(x, y, def) {
    this.terrain.mound(x, def.radius);
    FX.dirtBurst(x, y, def.radius, this.theme.soilTop);
    AudioEngine.explosion(0.25);
    FX.addShake(4);
    for (const t of this.tanks) if (t.alive) t._updateBuried(this.terrain);
  }

  applyFissure(x, y, def, owner) {
    this.terrain.fissure(x, 14);
    FX.dirtBurst(x, y, 30, this.theme.soilTop);
    FX.addShake(10);
    AudioEngine.explosion(0.5);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.abs(t.x - x);
      if (d < 26) this.damageTank(t, def.dmg * (1 - d / 30), owner, d < 8);
    }
    this._checkDeaths(owner);
  }

  applyNapalm(x, y, owner) {
    AudioEngine.explosion(0.45);
    FX.addShake(5);
    for (let i = 0; i < 26; i++) {
      const a = Utils.rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const sp = Utils.rand(40, 230);
      this.hazards.push(new NapalmDrop(x, y - 4, Math.cos(a) * sp, Math.sin(a) * sp, owner));
    }
  }

  spawnVortex(x, y, def, owner) {
    this.hazards.push(new Vortex(x, y, def, owner));
    AudioEngine._tone({ type: 'sine', f0: 320, f1: 36, dur: 2.6, gain: 0.25 });
  }

  scheduleKineticRods(x, def, owner) {
    this.hazards.push(new RodStrike(x, def, owner));
  }

  applyLaser(tank, def) {
    const m = tank.muzzle();
    let x = m.x, y = m.y;
    let budget = 340;            // px of dirt the beam can cut through
    const hitSet = new Set();
    const step = 4;
    let steps = 0;
    while (steps++ < 900 && budget > 0) {
      x += m.dx * step;
      y += m.dy * step;
      if (x < -10 || x > W + 10 || y < -200 || y >= BEDROCK_Y) break;
      // damage tanks near the beam (once each)
      for (const t of this.tanks) {
        if (!t.alive || t === tank || hitSet.has(t)) continue;
        if (Utils.dist(x, y, t.x, t.y - 8) < 17) {
          hitSet.add(t);
          this.damageTank(t, def.dmg, tank, true);
        }
      }
      if (y > 0 && this.terrain.isSolid(x, y)) {
        this.terrain.crater(x, y, 8);
        budget -= step * 2.2;
      }
    }
    this.hazards.push(new LaserBeamFX(m.x, m.y, x, y));
    FX.addShake(6);
    this._checkDeaths(tank);
  }

  /** Central damage entry point: handles shields, XP, cash, kill credit. */
  damageTank(victim, amount, owner, direct = false, silent = false) {
    if (!victim.alive || amount <= 0) return 0;
    const actual = victim.takeDamage(amount);
    if (owner && owner !== victim) {
      victim.lastDamager = owner;
      if (actual > 0) {
        owner.cash += actual * 2;
        owner.score += actual;
        owner.roundDamage += actual;
        this._award(owner, actual + (direct ? 30 : 0), 0);
      }
    }
    if (!silent && actual > 0) FX.sparkTrail(victim.x, victim.y - 12, '#ff7070');
    return actual;
  }

  _award(tank, xp, cash) {
    tank.cash += cash;
    const ups = tank.addXP(xp);
    if (ups > 0) {
      AudioEngine.levelUp();
      FX.addBubble(tank.x, tank.y - 70, `LEVEL UP! Lv ${tank.level}`, 2.2, { color: '#7dff9a' });
      SaveSystem.saveProfile(tank.name, tank.xp);
    }
  }

  _checkDeaths(killer) {
    for (const t of this.tanks) {
      if (!t.alive || t.health > 0) continue;
      t.alive = false;
      if (t.shield) { t.shield = null; AudioEngine.humStop(); }
      FX.explosion(t.x, t.y - 8, 40);
      FX.addShake(10);
      AudioEngine.explosion(0.7);
      this.terrain.crater(t.x, t.y, 20);
      FX.addBubble(t.x, t.y - 52, pickDeathSaying(), 3.8, { color: '#ff9090' });
      const credit = (killer && killer !== t && killer.alive !== undefined) ? killer : t.lastDamager;
      if (credit && credit !== t) {
        credit.roundKills++;
        credit.score += 100;
        this._award(credit, 80, 300);
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
      if (useWind && !windImmune) vx += this.wind * WIND_ACCEL * dt;
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
          if (Utils.dist(x, y, t.x, t.y - 8) <= TANK_RADIUS) {
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
    return this.phase === 'aim' && this.activeTank && !this.activeTank.isBot && this.activeTank.alive;
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
    if (this.phase === 'idle' || this.phase === 'over' || this.phase === 'shop') return;

    // landslides relax continuously
    const terrainMoving = this.terrain.relax(dt);

    // tank physics (falling, parachutes, fall damage)
    let anyFalling = false;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const evt = t.updatePhysics(dt, this.terrain);
      if (t.falling) anyFalling = true;
      if (evt && evt.kind === 'fall' && evt.dmg > 0) {
        this.damageTank(t, evt.dmg, null);
        FX.dirtBurst(t.x, t.y, 14, this.theme.soilTop);
        AudioEngine.explosion(0.2);
      }
    }
    this._checkDeaths(null);

    // weather + particles + hazard vortices
    const vortices = this.hazards.filter(h => h.kind === 'vortex');
    FX.spawnWeather(dt, this.theme, this.wind);
    FX.update(dt, this.terrain, vortices);

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
        for (const hz of this.hazards) hz.update(dt, this);
        this.hazards = this.hazards.filter(h => !h.dead);
        this._checkDeaths(null);

        const action = this.projectiles.length > 0 || this.hazards.length > 0 || anyFalling;
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
    drawSky(ctx, this.theme, this.themeState, t);

    const shake = FX.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // terrain (cached)
    if (this.terrain.dirty) {
      drawTerrainCache(this._terrainCtx, this.terrain, this.theme);
      this.terrain.dirty = false;
    }
    ctx.drawImage(this._terrainCache, 0, 0);

    this.drawWindFlag(ctx, t);

    // trajectory preview for the aiming human
    if (this.humanCanAct) this.drawTrajectory(ctx);

    // hazards under tanks (napalm pools), vortices above
    for (const hz of this.hazards) hz.draw(ctx, t);

    for (const tank of this.tanks) tank.draw(ctx, tank === this.activeTank && this.phase !== 'over', t);
    for (const p of this.projectiles) p.draw(ctx);

    FX.draw(ctx);
    FX.drawBubbles(ctx);
    ctx.restore();

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

  drawTrajectory(ctx) {
    const tank = this.activeTank;
    const hasBasic = tank.hasUpgrade('targetcomp');
    const hasReticle = tank.hasUpgrade('reticle');
    const hasWeather = tank.hasUpgrade('weather');
    if (!hasBasic && !hasReticle && !hasWeather) return;
    const def = ItemCatalog.weapon(tank.selectedWeapon);
    if (def.special === 'laser') return;
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

    // left panel: active player
    const px = 14, py = 12;
    ctx.fillStyle = 'rgba(5,8,14,0.72)';
    ctx.fillRect(px - 4, py - 4, 320, 118);
    ctx.strokeStyle = 'rgba(80,110,160,0.5)';
    ctx.strokeRect(px - 4, py - 4, 320, 118);

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

    bar('HP', px, py + 22, 130, t.health / 100, t.health > 50 ? '#5cd65c' : t.health > 25 ? '#ffd54f' : '#ff5252', `${t.health}`);
    bar('FUEL', px, py + 38, 130, t.fuel / Math.max(1, t.maxFuel), '#e8a33c', `${Math.round(t.fuel)}`);
    bar('PWR', px, py + 54, 130, t.power / 100, '#7fd4ff', `${Math.round(t.power)}`);

    ctx.fillStyle = '#9fb4d8';
    ctx.fillText(`ANGLE ${Math.round(t.angle)}°`, px, py + 84);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(Utils.money(t.cash), px + 110, py + 84);
    ctx.fillStyle = '#7dff9a';
    ctx.fillText(`Lv${t.level}`, px + 220, py + 84);
    // xp mini-bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px + 252, py + 76, 56, 8);
    ctx.fillStyle = '#39ff6a';
    ctx.fillRect(px + 252, py + 76, 56 * t.xpProgress(), 8);

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
    ctx.fillStyle = 'rgba(5,8,14,0.72)';
    ctx.fillRect(rx - 4, ry - 4, 236, 64 + this.tanks.length * 16);
    ctx.strokeStyle = 'rgba(80,110,160,0.5)';
    ctx.strokeRect(rx - 4, ry - 4, 236, 64 + this.tanks.length * 16);

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
      ctx.fillText(`${tk.name.slice(0, 12)} ${tk.alive ? tk.health : '✝'}  ◆${tk.score}`, rx + 14, yy);
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
