'use strict';
/* ===== Tank entity: movement, falling, shields, inventory, rendering ===== */

const TANK_W = 30;
const TANK_H = 13;
const TANK_RADIUS = 16;       // collision radius for shells
const SAFE_FALL_SPEED = 230;  // landing faster than this hurts
const CHUTE_DEPLOY_SPEED = 190;
const CHUTE_FALL_SPEED = 80;

class Tank {
  constructor(cfg) {
    this.name = cfg.name;
    this.color = cfg.color;
    this.type = cfg.type || 'human';     // 'human' | 'novice' | 'amateur' | 'pro' | 'johnwick' | 'behemoth'
    this.isBot = this.type !== 'human';
    this.isBoss = this.type === 'behemoth';

    // position / physics
    this.x = cfg.x || 100;
    this.y = 0;
    this.vy = 0;
    this.falling = false;
    this.fallStartVy = 0;
    this.chuteActive = false;
    this.buried = false;

    // combat
    this.health = 100;
    this.alive = true;
    this.emp = 0;                        // turns of fried electronics remaining
    this.team = undefined;               // 0 / 1 in teams mode
    this.lastImpact = null;              // {x, y} of this tank's last shell impact
    // match-long bookkeeping for the end-of-match awards ceremony
    this.stats = { selfDmg: 0, offMap: 0, buriedTurns: 0, bigHit: 0, earned: 0 };
    this.angle = cfg.angle !== undefined ? cfg.angle : (this.x < W / 2 ? 60 : 120);
    this.power = 55;
    this.fuel = 100;
    this.maxFuel = 100;
    this.shield = null;                  // { hp, max }
    this.predeployShield = false;

    // economy / progression
    this.cash = cfg.cash !== undefined ? cfg.cash : 10000;
    this.xp = cfg.xp || 0;
    this.level = levelForXP(this.xp);
    this.score = 0;
    this.gatesOff = false; // sandbox mode: ignore level gates (set from game settings)

    // inventory: itemId -> count; upgrades: set of ids; skins: owned list
    this.inventory = { missile: Infinity };
    this.upgrades = {};
    this.ownedSkins = ['default'];
    this.skin = 'default';
    this.selectedWeapon = 'missile';

    // per-round bookkeeping
    this.roundDamage = 0;
    this.roundKills = 0;
  }

  get radius() { return this.isBoss ? 28 : TANK_RADIUS; }

  get maxHealth() { return this.isBoss ? 600 : 100; }

  /** Magnetic deflector works only while the electronics aren't EMP-fried. */
  magActive() { return this.hasUpgrade('magshield') && this.emp <= 0; }

  /** Shell-interception radius: the shield dome when one is up, else the hull. */
  get hitRadius() {
    if (!this.shield) return this.radius;
    const scale = this.isBoss ? 1.6 : 1.0;
    return (26 + 16 * this.shield.hp / this.shield.max) * scale;
  }

  /* ---------- progression ---------- */

  addXP(n) {
    if (n <= 0) return 0;
    const before = this.level;
    this.xp += Math.round(n);
    this.level = levelForXP(this.xp);
    return this.level - before; // levels gained
  }

  xpProgress() {
    if (this.level >= MAX_LEVEL) return 1;
    const cur = LEVEL_XP[this.level - 1], next = LEVEL_XP[this.level];
    return Utils.clamp((this.xp - cur) / (next - cur), 0, 1);
  }

  /* ---------- inventory ---------- */

  ammo(id) {
    const c = this.inventory[id];
    return c === Infinity ? Infinity : (c || 0);
  }

  ownedWeapons() {
    return WEAPONS.filter(w => this.ammo(w.id) > 0);
  }

  cycleWeapon(dir) {
    const owned = this.ownedWeapons();
    if (!owned.length) return;
    let idx = owned.findIndex(w => w.id === this.selectedWeapon);
    if (idx < 0) idx = 0;
    idx = (idx + dir + owned.length) % owned.length;
    this.selectedWeapon = owned[idx].id;
  }

  consumeAmmo(id) {
    if (this.inventory[id] === Infinity) return;
    this.inventory[id] = Math.max(0, (this.inventory[id] || 0) - 1);
    if (this.inventory[id] === 0 && this.selectedWeapon === id) {
      this.selectedWeapon = 'missile';
    }
  }

  hasUpgrade(id) { return !!this.upgrades[id]; }

  activateShield() {
    if (this.shield) {
      // [X] with a shield already up: top it off from a battery
      if (this.ammo('battery') > 0 && this.shield.hp < this.shield.max) {
        this.inventory.battery--;
        this.shield.hp = Math.min(this.shield.max, this.shield.hp + 50);
        AudioEngine.shieldOn();
        return true;
      }
      return false;
    }
    if (this.ammo('shield') <= 0) return false;
    this.inventory.shield--;
    this.shield = { hp: 100, max: 100 };
    AudioEngine.shieldOn();
    return true;
  }

  /* ---------- damage ---------- */

  /** Returns actual damage applied to health (after shield, unless pierced). */
  takeDamage(amount, pierceShield = false) {
    if (!this.alive) return 0;
    let dmg = amount;
    if (this.buried) dmg *= 0.5; // dirt blanket dampens blasts
    if (this.shield && !pierceShield) {
      const absorbed = Math.min(this.shield.hp, dmg);
      this.shield.hp -= absorbed;
      dmg -= absorbed;
      if (this.shield.hp <= 0) {
        this.shield = null;
        AudioEngine.humStop();
      }
    }
    dmg = Math.round(dmg);
    if (dmg > 0) this.health = Math.max(0, this.health - dmg);
    return dmg;
  }

  /* ---------- per-frame physics: settle on / fall toward terrain ---------- */

  updatePhysics(dt, terrain) {
    this.x = Utils.clamp(this.x, 10, W - 10);
    const ground = terrain.heightAt(this.x);

    if (ground > this.y + 1.5) {
      // air below us: fall
      if (!this.falling) { this.falling = true; this.vy = Math.max(0, this.vy); }
      // parachute auto-deploy: only for alive tanks
      if (this.alive && !this.chuteActive && this.vy > CHUTE_DEPLOY_SPEED && this.ammo('parachute') > 0) {
        this.chuteActive = true;
      }
      if (this.chuteActive) {
        this.vy = Math.min(this.vy + GRAV * dt, CHUTE_FALL_SPEED);
      } else {
        this.vy += GRAV * dt;
      }
      this.y = Math.min(ground, this.y + this.vy * dt);
      if (this.y >= ground) return this._land(terrain);
    } else {
      // On the ground. If soil piled up ABOVE us (dirt bomb / landslide), stay
      // put — we are buried under the mound, not lifted on top of it.
      if (ground >= this.y - 1.5) this.y = ground;
      this.falling = false;
      this.vy = 0;
      // slick ice: slide downhill, no grip
      if (this.alive && !this.buried && terrain.isIce(this.x)) {
        const s = terrain.slopeAt(this.x);
        if (Math.abs(s) > 0.12) {
          this.x = Utils.clamp(this.x + Math.sign(s) * Math.min(70, 130 * Math.abs(s)) * dt, 10, W - 10);
          this.y = terrain.heightAt(this.x);
        }
      }
    }
    this._updateBuried(terrain);
    return null;
  }

  _land(terrain) {
    const impact = this.vy;
    this.falling = false;
    this.vy = 0;
    this.y = terrain.heightAt(this.x);
    let result = null;
    if (this.chuteActive) {
      this.consumeAmmo('parachute');
      this.chuteActive = false;
      result = { kind: 'chute' };
    } else if (impact > SAFE_FALL_SPEED) {
      const dmg = Math.round((impact - SAFE_FALL_SPEED) * 0.18);
      result = { kind: 'fall', dmg };
    }
    this._updateBuried(terrain);
    return result;
  }

  _updateBuried(terrain) {
    // ground surface above the hull -> buried under soil
    this.buried = terrain.heightAt(this.x) < this.y - 4;
  }

  /* ---------- driving ---------- */

  drive(dir, dt, terrain) {
    if (!this.alive || this.falling || this.buried || this.fuel <= 0) return;
    const speed = 46; // px/s
    const step = dir * speed * dt;
    const newX = Utils.clamp(this.x + step, 12, W - 12);
    const dh = terrain.heightAt(newX) - terrain.heightAt(this.x); // negative = uphill
    let maxClimb = this.hasUpgrade('treads') ? 4.4 : 2.2;         // px height per px moved
    if (terrain.isIce(this.x) || terrain.isIce(newX)) maxClimb = 0.6; // no grip on ice
    if (-dh > Math.abs(step) * maxClimb) return;                  // too steep
    const cost = Math.abs(step) * (this.hasUpgrade('engine') ? 0.09 : 0.18);
    if (this.fuel < cost) return;
    this.fuel -= cost;
    this.x = newX;
    this.y = terrain.heightAt(this.x);
    this._updateBuried(terrain);
  }

  /** Muzzle tip position & direction. */
  muzzle() {
    const rad = Utils.deg2rad(this.angle);
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const s = this.isBoss ? 1.6 : 1.0;
    const baseY = this.y - TANK_H * s;
    return {
      x: this.x + dx * 24 * s,
      y: baseY + dy * 24 * s,
      dx, dy,
    };
  }

  /* ---------- rendering ---------- */

  draw(ctx, isActive, t) {
    if (!this.alive) { this._drawWreck(ctx); return; }
    const x = this.x, y = this.y;
    const s = this.isBoss ? 1.6 : 1.0;
    ctx.save();
    if (this.buried) ctx.globalAlpha = 0.45;

    // soft contact shadow grounding the tank
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, TANK_W * 0.58 * s, 3.5 * s, 0, 0, TAU);
    ctx.fill();

    // parachute
    if (this.chuteActive) {
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(x - 14 * s, y - 52 * s);
      ctx.quadraticCurveTo(x, y - 70 * s, x + 14 * s, y - 52 * s);
      ctx.lineTo(x + 4 * s, y - 16 * s);
      ctx.moveTo(x - 14 * s, y - 52 * s);
      ctx.lineTo(x - 4 * s, y - 16 * s);
      ctx.stroke();
      ctx.fillStyle = '#e35555';
      ctx.beginPath();
      ctx.moveTo(x - 15 * s, y - 52 * s);
      ctx.quadraticCurveTo(x, y - 72 * s, x + 15 * s, y - 52 * s);
      ctx.quadraticCurveTo(x, y - 46 * s, x - 15 * s, y - 52 * s);
      ctx.fill();
    }

    // turret barrel(s)
    const m = this.muzzle();
    if (this.isBoss) {
      // Draw three barrels!
      const angles = [-0.09, 0, 0.09];
      const baseY = y - TANK_H * s;
      for (const a of angles) {
        const rad = Utils.deg2rad(this.angle) + a;
        const dx = Math.cos(rad), dy = -Math.sin(rad);
        const mx = x + dx * 38 * s;
        const my = baseY + dy * 38 * s;

        ctx.strokeStyle = '#222';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(mx, my); ctx.stroke();

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(mx, my); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y - TANK_H);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - TANK_H);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    }

    // hull
    this._drawHull(ctx, x, y);

    // treads: dark track band with road wheels
    ctx.fillStyle = '#1a1d24';
    this._roundRect(ctx, x - TANK_W / 2 * s, y - 6 * s, TANK_W * s, 7 * s, 3.5 * s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1 * s;
    this._roundRect(ctx, x - TANK_W / 2 * s, y - 6 * s, TANK_W * s, 7 * s, 3.5 * s);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = '#3a3f4d';
      ctx.beginPath();
      ctx.arc(x + i * 6 * s, y - 2.5 * s, 2.2 * s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#586075';
      ctx.beginPath();
      ctx.arc(x + i * 6 * s - 0.6 * s, y - 3.1 * s, 0.9 * s, 0, TAU);
      ctx.fill();
    }

    ctx.restore();

    // shield dome (drawn unfaded even when buried)
    if (this.shield) this._drawShield(ctx, t);
    if (this.magActive()) this._drawMagField(ctx, t); // hidden while EMP-fried
    if (this.emp > 0) this._drawEmpFizzle(ctx, t);

    // name tag + health bar
    ctx.save();
    ctx.font = this.isBoss ? 'bold 12px "Lucida Console", Monaco, monospace' : '11px "Lucida Console", Monaco, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255,255,255,0.75)';
    ctx.fillText(this.isBoss ? '★ THE BEHEMOTH ★' : this.name, x, y - 34 * s);
    if (isActive) {
      const bob = Math.sin(t * 5) * 3;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(x, y - (56 + bob) * s);
      ctx.lineTo(x - 5 * s, y - (64 + bob) * s);
      ctx.lineTo(x + 5 * s, y - (64 + bob) * s);
      ctx.closePath();
      ctx.fill();
    }
    const bw = 30 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - bw / 2, y - 30 * s, bw, 4 * s);
    const maxHp = this.isBoss ? 600 : 100;
    const hpT = this.health / maxHp;
    ctx.fillStyle = hpT > 0.5 ? '#5cd65c' : hpT > 0.25 ? '#ffd54f' : '#ff5252';
    ctx.fillRect(x - bw / 2, y - 30 * s, bw * hpT, 4 * s);
    if (this.buried) {
      ctx.fillStyle = '#caa472';
      ctx.fillText('BURIED', x, y - 44 * s);
    }
    if (this.emp > 0) {
      ctx.fillStyle = '#7fd4ff';
      ctx.fillText('⚡EMP', x, y - (this.buried ? 54 : 44) * s);
    }
    if (this.team !== undefined) {
      ctx.fillStyle = this.team === 0 ? '#7fd4ff' : '#ffb26b';
      ctx.fillText(this.team === 0 ? '▲' : '▼', x + 30 * s, y - 34 * s);
    }
    ctx.restore();
  }

  /** Crackling arcs while electronics are EMP-fried. */
  _drawEmpFizzle(ctx, t) {
    const s = this.isBoss ? 1.6 : 1.0;
    ctx.save();
    ctx.strokeStyle = 'rgba(150,220,255,0.8)';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.4 + 0.4 * Math.abs(Math.sin(t * 17));
    for (let i = 0; i < 3; i++) {
      const a0 = t * 4 + i * 2.1;
      let px = this.x + Math.cos(a0) * 18 * s;
      let py = this.y - 10 * s + Math.sin(a0) * 12 * s;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let k = 0; k < 3; k++) {
        px += Utils.rand(-7, 7); py += Utils.rand(-6, 6);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHull(ctx, x, y) {
    const s = this.isBoss ? 1.6 : 1.0;
    ctx.fillStyle = this.color;
    this._roundRect(ctx, x - (TANK_W / 2 - 2) * s, y - (TANK_H + 4) * s, (TANK_W - 4) * s, 10 * s, 4 * s);
    ctx.fill();
    // skin overlays
    ctx.save();
    this._roundRect(ctx, x - TANK_W / 2 + 2, y - TANK_H - 4, TANK_W - 4, 10, 4);
    ctx.clip();
    switch (this.skin) {
      case 'neon': {
        ctx.fillStyle = '#06130a';
        ctx.fillRect(x - TANK_W / 2, y - TANK_H - 5, TANK_W, 12);
        ctx.strokeStyle = '#39ff6a';
        ctx.lineWidth = 1;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(x + i * 5, y - TANK_H - 5); ctx.lineTo(x + i * 5, y - 2); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(x - TANK_W / 2, y - TANK_H + 1); ctx.lineTo(x + TANK_W / 2, y - TANK_H + 1); ctx.stroke();
        break;
      }
      case 'chroma': {
        const g = ctx.createLinearGradient(x - TANK_W / 2, y - TANK_H - 4, x + TANK_W / 2, y);
        g.addColorStop(0, '#ff66cc'); g.addColorStop(0.35, '#66ddff');
        g.addColorStop(0.7, '#aaffaa'); g.addColorStop(1, '#ffcc66');
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = g;
        ctx.fillRect(x - TANK_W / 2, y - TANK_H - 5, TANK_W, 12);
        break;
      }
      case 'carbon': {
        ctx.fillStyle = '#15171c';
        ctx.fillRect(x - TANK_W / 2, y - TANK_H - 5, TANK_W, 12);
        ctx.strokeStyle = 'rgba(150,160,180,0.5)';
        ctx.lineWidth = 1;
        for (let i = -8; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 4, y - TANK_H - 5);
          ctx.lineTo(x + i * 4 + 8, y + 4);
          ctx.stroke();
        }
        break;
      }
    }
    // hull shading: top sheen falling into lower shadow (works over any skin)
    const sheen = ctx.createLinearGradient(0, y - TANK_H - 5, 0, y - 2);
    sheen.addColorStop(0, 'rgba(255,255,255,0.32)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.04)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x - TANK_W / 2, y - TANK_H - 5, TANK_W, 13);
    ctx.restore();

    // hull outline
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, x - TANK_W / 2 + 2, y - TANK_H - 4, TANK_W - 4, 10, 4);
    ctx.stroke();

    // cupola with highlight
    ctx.fillStyle = this.skin === 'neon' ? '#0a2413' : this.color;
    ctx.beginPath();
    ctx.arc(x, y - TANK_H - 3, 6, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y - TANK_H - 3, 5, Math.PI * 1.15, Math.PI * 1.7);
    ctx.stroke();
  }

  _drawShield(ctx, t) {
    const s = this.shield;
    const hpT = s.hp / s.max;
    const scale = this.isBoss ? 1.6 : 1.0;
    const r = (26 + 16 * hpT) * scale;
    const pulse = 0.85 + 0.15 * Math.sin(t * 6);
    ctx.save();
    ctx.globalAlpha = (0.18 + 0.3 * hpT) * pulse;
    const g = ctx.createRadialGradient(this.x, this.y - 10 * scale, r * 0.4, this.x, this.y - 10 * scale, r);
    g.addColorStop(0, 'rgba(80,200,255,0.05)');
    g.addColorStop(0.8, 'rgba(80,200,255,0.5)');
    g.addColorStop(1, 'rgba(140,230,255,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10 * scale, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.5 + 0.4 * hpT;
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
    ctx.restore();
  }

  _drawMagField(ctx, t) {
    ctx.save();
    const scale = this.isBoss ? 1.6 : 1.0;
    // faint filled deflector field at its true influence radius
    const g = ctx.createRadialGradient(this.x, this.y - 10 * scale, 30 * scale, this.x, this.y - 10 * scale, 120 * scale);
    g.addColorStop(0, 'rgba(160,90,255,0)');
    g.addColorStop(0.82, 'rgba(170,110,255,0.04)');
    g.addColorStop(1, 'rgba(190,130,255,0.14)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10 * scale, 120 * scale, 0, TAU);
    ctx.fill();
    // two rotating dashed boundary rings
    ctx.globalAlpha = 0.22 + 0.08 * Math.sin(t * 3);
    ctx.strokeStyle = '#cc88ff';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10 * scale, 118 * scale, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([4, 11]);
    ctx.lineDashOffset = t * 22;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10 * scale, 96 * scale, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  _drawWreck(ctx) {
    const s = this.isBoss ? 1.6 : 1.0;
    ctx.save();
    ctx.fillStyle = '#23262e';
    this._roundRect(ctx, this.x - TANK_W / 2 * s + 2 * s, this.y - 9 * s, (TANK_W - 4) * s, 9 * s, 3 * s);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 8 * s);
    ctx.lineTo(this.x + 8 * s, this.y - 20 * s);
    ctx.stroke();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- persistence ---------- */

  serialize() {
    const inv = {};
    for (const k of Object.keys(this.inventory)) {
      inv[k] = this.inventory[k] === Infinity ? 'inf' : this.inventory[k];
    }
    return {
      name: this.name, color: this.color, type: this.type,
      x: Math.round(this.x), health: this.health, alive: this.alive,
      angle: Math.round(this.angle * 10) / 10, power: Math.round(this.power),
      fuel: Math.round(this.fuel), maxFuel: this.maxFuel,
      cash: this.cash === Infinity ? 'inf' : this.cash,
      xp: this.xp, score: this.score,
      inventory: inv, upgrades: this.upgrades, ownedSkins: this.ownedSkins,
      skin: this.skin, selectedWeapon: this.selectedWeapon,
      shield: this.shield, predeployShield: this.predeployShield,
      emp: this.emp, team: this.team, stats: this.stats,
    };
  }

  static deserialize(d) {
    const cash = d.cash === 'inf' ? Infinity : d.cash;
    const t = new Tank({ name: d.name, color: d.color, type: d.type, x: d.x, cash, xp: d.xp });
    t.health = d.health; t.alive = d.alive;
    t.angle = d.angle; t.power = d.power;
    t.fuel = d.fuel; t.maxFuel = d.maxFuel || 100;
    t.score = d.score || 0;
    t.inventory = {};
    for (const k of Object.keys(d.inventory || {})) {
      t.inventory[k] = d.inventory[k] === 'inf' ? Infinity : d.inventory[k];
    }
    if (t.inventory.missile === undefined) t.inventory.missile = Infinity;
    t.upgrades = d.upgrades || {};
    t.ownedSkins = d.ownedSkins || ['default'];
    t.skin = d.skin || 'default';
    t.selectedWeapon = d.selectedWeapon || 'missile';
    t.shield = d.shield || null;
    t.predeployShield = !!d.predeployShield;
    t.emp = d.emp || 0;
    t.team = d.team;
    if (d.stats) t.stats = Object.assign(t.stats, d.stats);
    return t;
  }
}
