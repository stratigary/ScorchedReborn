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
    this.type = cfg.type || 'human';     // 'human' | 'novice' | 'amateur' | 'pro' | 'johnwick'
    this.isBot = this.type !== 'human';

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
    this.angle = cfg.angle !== undefined ? cfg.angle : (this.x < W / 2 ? 60 : 120);
    this.power = 55;
    this.fuel = 100;
    this.maxFuel = 100;
    this.shield = null;                  // { hp, max }
    this.predeployShield = false;

    // economy / progression
    this.cash = cfg.cash !== undefined ? cfg.cash : 1000;
    this.xp = cfg.xp || 0;
    this.level = levelForXP(this.xp);
    this.score = 0;

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
    if (this.shield || this.ammo('shield') <= 0) return false;
    this.inventory.shield--;
    this.shield = { hp: 100, max: 100 };
    AudioEngine.shieldOn();
    return true;
  }

  /* ---------- damage ---------- */

  /** Returns actual damage applied to health (after shield). */
  takeDamage(amount) {
    if (!this.alive) return 0;
    let dmg = amount;
    if (this.buried) dmg *= 0.5; // dirt blanket dampens blasts
    if (this.shield) {
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
    if (!this.alive) return null;
    this.x = Utils.clamp(this.x, 10, W - 10);
    const ground = terrain.heightAt(this.x);

    if (ground > this.y + 1.5) {
      // air below us: fall
      if (!this.falling) { this.falling = true; this.vy = Math.max(0, this.vy); }
      // parachute auto-deploy
      if (!this.chuteActive && this.vy > CHUTE_DEPLOY_SPEED && this.ammo('parachute') > 0) {
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
      // on (or inside) the ground
      this.y = ground;
      this.falling = false;
      this.vy = 0;
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
    const maxClimb = this.hasUpgrade('treads') ? 4.4 : 2.2;       // px height per px moved
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
    const baseY = this.y - TANK_H;
    return {
      x: this.x + dx * 24,
      y: baseY + dy * 24,
      dx, dy,
    };
  }

  /* ---------- rendering ---------- */

  draw(ctx, isActive, t) {
    if (!this.alive) { this._drawWreck(ctx); return; }
    const x = this.x, y = this.y;
    ctx.save();
    if (this.buried) ctx.globalAlpha = 0.45;

    // parachute
    if (this.chuteActive) {
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 52);
      ctx.quadraticCurveTo(x, y - 70, x + 14, y - 52);
      ctx.lineTo(x + 4, y - 16);
      ctx.moveTo(x - 14, y - 52);
      ctx.lineTo(x - 4, y - 16);
      ctx.stroke();
      ctx.fillStyle = '#e35555';
      ctx.beginPath();
      ctx.moveTo(x - 15, y - 52);
      ctx.quadraticCurveTo(x, y - 72, x + 15, y - 52);
      ctx.quadraticCurveTo(x, y - 46, x - 15, y - 52);
      ctx.fill();
    }

    // turret barrel
    const m = this.muzzle();
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

    // hull
    this._drawHull(ctx, x, y);

    // treads
    ctx.fillStyle = '#1a1d24';
    this._roundRect(ctx, x - TANK_W / 2, y - 6, TANK_W, 7, 3.5);
    ctx.fill();
    ctx.fillStyle = '#3a3f4d';
    for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * 6 - 1.5, y - 4.5, 3, 4);

    ctx.restore();

    // shield dome (drawn unfaded even when buried)
    if (this.shield) this._drawShield(ctx, t);
    if (this.hasUpgrade('magshield')) this._drawMagField(ctx, t);

    // name tag + health bar
    ctx.save();
    ctx.font = '11px "Lucida Console", Monaco, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255,255,255,0.75)';
    ctx.fillText(this.name, x, y - 34);
    if (isActive) {
      const bob = Math.sin(t * 5) * 3;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(x, y - 56 + bob);
      ctx.lineTo(x - 5, y - 64 + bob);
      ctx.lineTo(x + 5, y - 64 + bob);
      ctx.closePath();
      ctx.fill();
    }
    const bw = 30;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - bw / 2, y - 30, bw, 4);
    const hpT = this.health / 100;
    ctx.fillStyle = hpT > 0.5 ? '#5cd65c' : hpT > 0.25 ? '#ffd54f' : '#ff5252';
    ctx.fillRect(x - bw / 2, y - 30, bw * hpT, 4);
    if (this.buried) {
      ctx.fillStyle = '#caa472';
      ctx.fillText('BURIED', x, y - 44);
    }
    ctx.restore();
  }

  _drawHull(ctx, x, y) {
    ctx.fillStyle = this.color;
    this._roundRect(ctx, x - TANK_W / 2 + 2, y - TANK_H - 4, TANK_W - 4, 10, 4);
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
    ctx.restore();
    // cupola
    ctx.fillStyle = this.skin === 'neon' ? '#0a2413' : this.color;
    ctx.beginPath();
    ctx.arc(x, y - TANK_H - 3, 6, Math.PI, 0);
    ctx.fill();
  }

  _drawShield(ctx, t) {
    const s = this.shield;
    const hpT = s.hp / s.max;
    const r = 26 + 16 * hpT; // dome shrinks as it degrades
    const pulse = 0.85 + 0.15 * Math.sin(t * 6);
    ctx.save();
    ctx.globalAlpha = (0.18 + 0.3 * hpT) * pulse;
    const g = ctx.createRadialGradient(this.x, this.y - 10, r * 0.4, this.x, this.y - 10, r);
    g.addColorStop(0, 'rgba(80,200,255,0.05)');
    g.addColorStop(0.8, 'rgba(80,200,255,0.5)');
    g.addColorStop(1, 'rgba(140,230,255,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.5 + 0.4 * hpT;
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  _drawMagField(ctx, t) {
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.07 * Math.sin(t * 3);
    ctx.strokeStyle = '#cc88ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10, 58, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  _drawWreck(ctx) {
    ctx.save();
    ctx.fillStyle = '#23262e';
    this._roundRect(ctx, this.x - TANK_W / 2 + 2, this.y - 9, TANK_W - 4, 9, 3);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 8);
    ctx.lineTo(this.x + 8, this.y - 20);
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
      cash: this.cash, xp: this.xp, score: this.score,
      inventory: inv, upgrades: this.upgrades, ownedSkins: this.ownedSkins,
      skin: this.skin, selectedWeapon: this.selectedWeapon,
      shield: this.shield, predeployShield: this.predeployShield,
    };
  }

  static deserialize(d) {
    const t = new Tank({ name: d.name, color: d.color, type: d.type, x: d.x, cash: d.cash, xp: d.xp });
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
    return t;
  }
}
