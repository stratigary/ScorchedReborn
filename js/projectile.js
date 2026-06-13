'use strict';
/* ===== Projectiles & lingering hazards =====
 * One Projectile class drives every ballistic weapon via its catalog def.
 * Hazards (napalm droplets, singularity vortices, laser beams, rolling
 * shells are projectiles in "rolling" mode) live in game.hazards.
 */

const POWER_TO_SPEED = 9;       // muzzle speed = power * this
const WIND_ACCEL = 8;           // horizontal accel per wind unit

class Projectile {
  constructor(def, x, y, vx, vy, owner, game) {
    this.def = def;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.game = game;
    this.dead = false;
    this.age = 0;
    this.trail = [];

    // special state
    this.bounces = 0;
    this.hops = def.special === 'leapfrog' ? 3 : 0;
    this.split = false;
    this.rolling = false;
    this.rollV = 0;
    this.restTimer = 0;
    this.isSub = false;
    this.escapedOwner = false; // left the owner's shield dome at least once
  }

  get windImmune() {
    return this.def.special === 'railgun' || this.def.special === 'kinetic_rod';
  }

  update(dt) {
    if (this.dead) return;
    const g = this.game;
    this.age += dt;

    if (this.rolling) { this._updateRolling(dt); return; }

    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil(speed * dt / 3)); // <=3px per substep
    const sdt = dt / steps;

    for (let s = 0; s < steps && !this.dead; s++) {
      const vyStart = this.vy; // captured before forces, for apex detection

      // forces
      if (!this.windImmune) this.vx += g.wind * WIND_ACCEL * sdt;
      this.vy += GRAV * sdt;

      // homing steering
      if (this.def.special === 'homing' && this.age > 0.55) this._steer(sdt);

      // singularity vortices pull shells too
      for (const hz of g.hazards) {
        if (hz.kind !== 'vortex') continue;
        const dx = hz.x - this.x, dy = hz.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < hz.r * 3 && d > 6) {
          const f = hz.pull * 90 / Math.max(30, d);
          this.vx += dx / d * f * sdt;
          this.vy += dy / d * f * sdt;
        }
      }

      // magnetic shields deflect enemy shells (never the owner's own rounds)
      for (const t of g.tanks) {
        if (!t.alive || t === this.owner || !t.hasUpgrade('magshield')) continue;
        const dx = this.x - t.x, dy = this.y - (t.y - 10);
        const d = Math.hypot(dx, dy);
        if (d < 150 && d > 1) {
          // strong inverse-square repulsion so shells visibly swerve away
          const f = 5.5e6 / Math.max(450, d * d);
          this.vx += dx / d * f * sdt;
          this.vy += dy / d * f * sdt;
          if (Math.random() < 0.25) FX.sparkTrail(this.x, this.y, '#cc88ff');
        }
      }

      this.x += this.vx * sdt;
      this.y += this.vy * sdt;

      // MIRV splits at apex: vertical velocity crosses from up (<0) to down (>=0)
      if (this.def.special === 'mirv' && !this.split && vyStart < 0 && this.vy >= 0) {
        this._mirvSplit();
        return;
      }

      // screen edges
      if (g.settings.wrap) {
        if (this.x < 0) this.x += W;
        else if (this.x >= W) this.x -= W;
      } else if (this.x < -250 || this.x > W + 250) {
        this.dead = true;
        return;
      }
      if (this.y > H + 100) { this.dead = true; return; }

      // tank hit?
      const hitTank = this._checkTankHit();
      if (hitTank) {
        this._impact(hitTank);
        return;
      }

      // terrain hit?
      if (this.y > 0 && g.terrain.isSolid(this.x, this.y)) {
        this._impact(null);
        return;
      }
    }

    // smoke / glow trail
    if (this.trail.length === 0 || Utils.dist(this.x, this.y, this.trail[this.trail.length - 1].x, this.trail[this.trail.length - 1].y) > 8) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 26) this.trail.shift();
    }
  }

  _steer(sdt) {
    const g = this.game;
    let best = null, bd = 1e9;
    for (const t of g.tanks) {
      if (!t.alive || t === this.owner) continue;
      const d = Utils.dist(this.x, this.y, t.x, t.y);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const cur = Math.atan2(this.vy, this.vx);
    const want = Math.atan2((best.y - 8) - this.y, best.x - this.x);
    let diff = want - cur;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    const maxTurn = 2.6 * sdt;
    const turn = Utils.clamp(diff, -maxTurn, maxTurn);
    const na = cur + turn;
    this.vx = Math.cos(na) * speed;
    this.vy = Math.sin(na) * speed;
    if (Math.random() < 0.5) FX.sparkTrail(this.x, this.y, '#7fd4ff');
  }

  _checkTankHit() {
    for (const t of this.game.tanks) {
      if (!t.alive) continue;
      // shield dome intercepts at its radius
      const r = t.shield ? (26 + 16 * t.shield.hp / t.shield.max) : TANK_RADIUS;
      const d = Utils.dist(this.x, this.y, t.x, t.y - 8);
      if (t === this.owner && !this.escapedOwner) {
        // shells spawn inside the owner's dome — wait until they leave it
        if (d > r + 8) this.escapedOwner = true;
        continue;
      }
      if (d <= r) return t;
    }
    return null;
  }

  _mirvSplit() {
    const g = this.game;
    this.split = true;
    AudioEngine.click();
    FX.ring(this.x, this.y, 28, 0.3, '#ffe9a0');
    const n = this.def.splitCount || 3;
    const subDef = Object.assign({}, this.def, { special: null });
    const half = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const off = i - half; // symmetric spread around the flight path
      const p = new Projectile(subDef, this.x, this.y,
        this.vx + off * 72, this.vy - Math.abs(off) * 28, this.owner, g);
      p.isSub = true;
      g.projectiles.push(p);
    }
    this.dead = true;
  }

  _impact(hitTank) {
    const g = this.game;
    const sp = this.def.special;

    if (sp === 'bouncer' && !hitTank && this.bounces < 3) {
      this._bounce();
      return;
    }
    if (sp === 'roller' && !hitTank) {
      this._startRolling();
      return;
    }
    if (sp === 'leapfrog') {
      g.applyExplosion(this.x, this.y, this.def, this.owner, { direct: hitTank });
      this.hops--;
      if (this.hops > 0 && !hitTank) {
        const dir = Math.sign(this.vx) || 1;
        const hop = new Projectile(this.def, this.x, this.y - 6, dir * Math.max(90, Math.abs(this.vx) * 0.7), -330, this.owner, g);
        hop.hops = this.hops;
        g.projectiles.push(hop);
      }
      this.dead = true;
      return;
    }

    switch (sp) {
      case 'dirt':
        g.applyDirt(this.x, this.y, this.def);
        break;
      case 'fissure':
        g.applyFissure(this.x, this.y, this.def, this.owner);
        break;
      case 'napalm':
        g.applyNapalm(this.x, this.y, this.owner);
        break;
      case 'maser':
        // shell only marks the spot — the orbital MASER does the killing
        g.scheduleMaser(this.x, this.y, this.def, this.owner);
        FX.ring(this.x, this.y, 24, 0.3, '#9fdcff');
        AudioEngine.click();
        break;
      case 'singularity':
        g.spawnVortex(this.x, this.y - 18, this.def, this.owner);
        break;
      case 'neutron':
        g.applyNeutron(this.x, this.y, this.def, this.owner);
        break;
      case 'kinetic':
        g.scheduleKineticRods(this.x, this.def, this.owner);
        g.applyExplosion(this.x, this.y, { dmg: 12, radius: 14 }, this.owner, {});
        break;
      default:
        g.applyExplosion(this.x, this.y, this.def, this.owner, { direct: hitTank, isSub: this.isSub });
    }
    this.dead = true;
  }

  _bounce() {
    const g = this.game;
    this.bounces++;
    AudioEngine.bounce();
    // back out of the ground
    let guard = 40;
    while (guard-- && g.terrain.isSolid(this.x, this.y)) {
      this.x -= this.vx * 0.002;
      this.y -= this.vy * 0.002;
    }
    const n = g.terrain.normalAt(this.x);
    const dot = this.vx * n.x + this.vy * n.y;
    this.vx = (this.vx - 2 * dot * n.x) * 0.6;
    this.vy = (this.vy - 2 * dot * n.y) * 0.6;
    this.y -= 1.5;
  }

  _startRolling() {
    const g = this.game;
    this.rolling = true;
    this.y = g.terrain.heightAt(this.x) - 4;
    this.rollV = Utils.clamp(this.vx * 0.45, -160, 160);
    this.restTimer = 0;
  }

  _updateRolling(dt) {
    const g = this.game;
    const slope = g.terrain.slopeAt(this.x); // dy/dx: positive = downhill to the right
    this.rollV += slope * 540 * dt;
    this.rollV *= (1 - 0.55 * dt);           // rolling friction
    // magnetic shields shove rolling shells back too
    for (const t of g.tanks) {
      if (!t.alive || t === this.owner || !t.hasUpgrade('magshield')) continue;
      const dx = this.x - t.x;
      const d = Math.abs(dx);
      if (d < 100) this.rollV += Math.sign(dx || 1) * 420 * (1 - d / 100) * dt;
    }
    this.x += this.rollV * dt;
    if (g.settings.wrap) this.x = Utils.wrapX(this.x);
    else if (this.x < 4 || this.x > W - 4) { this._detonateRoll(); return; }
    this.y = g.terrain.heightAt(this.x) - 4;
    this.age += dt;

    // detonate on tank contact
    for (const t of g.tanks) {
      if (!t.alive || t === this.owner) continue;
      if (Utils.dist(this.x, this.y, t.x, t.y - 8) < TANK_RADIUS + 6) { this._detonateRoll(); return; }
    }
    // detonate when static
    if (Math.abs(this.rollV) < 7) {
      this.restTimer += dt;
      if (this.restTimer > 0.5) { this._detonateRoll(); return; }
    } else this.restTimer = 0;
    if (this.age > 10) this._detonateRoll();
    if (Math.random() < 0.3) FX.sparkTrail(this.x, this.y, '#ffd080');
  }

  _detonateRoll() {
    this.game.applyExplosion(this.x, this.y, this.def, this.owner, {});
    this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // glowing trail, fading toward the tail
    if (this.trail.length > 1) {
      const trailColor = this.def.special === 'neutron' ? '125,255,90'
        : this.def.special === 'homing' ? '127,212,255' : '255,220,160';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        if (Math.abs(b.x - a.x) > W / 2) continue; // wrap seam
        const f = i / this.trail.length;
        ctx.strokeStyle = `rgba(${trailColor},${0.34 * f})`;
        ctx.lineWidth = 0.6 + 1.8 * f;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    const neutron = this.def.special === 'neutron';
    const big = neutron || (this.def.radius || 20) > 55;
    // soft glow halo around the shell
    const glowR = neutron ? 16 : (big ? 13 : 8);
    const glow = ctx.createRadialGradient(this.x, this.y, 0.5, this.x, this.y, glowR);
    if (neutron) {
      glow.addColorStop(0, 'rgba(190,255,150,0.95)');
      glow.addColorStop(1, 'rgba(80,220,90,0)');
    } else {
      glow.addColorStop(0, big ? 'rgba(255,236,153,0.9)' : 'rgba(255,255,255,0.65)');
      glow.addColorStop(1, 'rgba(255,200,80,0)');
    }
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = neutron ? '#d6ffb0' : (this.def.special === 'dirt' ? '#a87b46' : (big ? '#ffec99' : '#f8f8f8'));
    ctx.beginPath();
    ctx.arc(this.x, this.y, neutron ? 5.5 : (big ? 5 : 3.4), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* ===== Hazards ===== */

class NapalmDrop {
  constructor(x, y, vx, vy, owner) {
    this.kind = 'napalm';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.life = Utils.rand(2.6, 4.2);
    this.grounded = false;
    this.dead = false;
    this._dmgAcc = 0; // burn damage accumulates so rounding can't zero it out
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const ter = game.terrain;
    if (!this.grounded) {
      this.vy += GRAV * dt;
      this.vx += game.wind * 3 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.x < 0 || this.x >= W) { this.dead = true; return; }
      if (ter.isSolid(this.x, this.y)) {
        this.grounded = true;
        this.y = ter.heightAt(this.x);
        this.vx = Utils.clamp(this.vx * 0.3, -60, 60);
      }
    } else {
      // roll downhill along the surface, melting terrain
      const slope = ter.slopeAt(this.x);
      this.vx += slope * 320 * dt;
      this.vx *= (1 - 0.8 * dt);
      this.x += this.vx * dt;
      if (this.x < 0 || this.x >= W) { this.dead = true; return; }
      this.y = ter.heightAt(this.x);
      ter.melt(this.x, 7 * dt);
    }
    // burn nearby tanks (accumulate fractional damage, apply in chunks)
    for (const t of game.tanks) {
      if (!t.alive) continue;
      if (Utils.dist(this.x, this.y, t.x, t.y - 6) < 18) {
        this._dmgAcc += 13 * dt;
        if (this._dmgAcc >= 2) {
          game.damageTank(t, this._dmgAcc, this.owner, false, true);
          this._dmgAcc = 0;
        }
        break; // one drop burns one tank at a time
      }
    }
    if (Math.random() < 0.35) {
      FX.spawn({
        x: this.x, y: this.y - 2, vx: Utils.rand(-8, 8), vy: Utils.rand(-45, -15),
        life: 0.4, size: Utils.rand(1.5, 3), color: Utils.choice(['#ff9a2a', '#ffd040', '#ff5a1a']),
        grav: -0.1, kind: 'spark',
      });
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#ff8a20';
    ctx.beginPath();
    ctx.arc(this.x, this.y - 1.5, 2.6, 0, TAU);
    ctx.fill();
  }
}

class Vortex {
  constructor(x, y, def, owner) {
    this.kind = 'vortex';
    this.x = x; this.y = y;
    this.def = def;
    this.owner = owner;
    this.r = 120;
    this.pull = 95;
    this.life = 2.8;
    this.age = 0;
    this.dead = false;
  }

  update(dt, game) {
    this.age += dt;
    this.life -= dt;
    // drag tanks toward the singularity
    for (const t of game.tanks) {
      if (!t.alive) continue;
      const dx = this.x - t.x;
      const d = Math.abs(dx);
      if (d < this.r * 1.6 && d > 4) {
        t.x += Math.sign(dx) * Math.min(60 * dt * (this.r / Math.max(50, d)), d);
        t.x = Utils.clamp(t.x, 10, W - 10);
        const ground = game.terrain.heightAt(t.x);
        if (ground > t.y) t.falling = true;
        else if (ground >= t.y - 1.5) t.y = ground; // don't pop buried tanks up
        t._updateBuried(game.terrain);
      }
    }
    // swirl particles
    if (Math.random() < 0.7) {
      const a = Math.random() * TAU;
      const rr = Utils.rand(this.r * 0.5, this.r * 1.3);
      FX.spawn({
        x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr,
        vx: -Math.sin(a) * 120, vy: Math.cos(a) * 120,
        life: 0.6, size: 2, color: Utils.choice(['#bf7fff', '#7f9fff', '#ffffff']),
        grav: 0, kind: 'spark',
      });
    }
    if (this.life <= 0) {
      this.dead = true;
      game.applyExplosion(this.x, this.y, this.def, this.owner, {});
      FX.addShake(14);
    }
  }

  draw(ctx, t) {
    ctx.save();
    const wob = 1 + 0.06 * Math.sin(t * 9);
    const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 46 * wob);
    g.addColorStop(0, 'rgba(0,0,0,0.96)');
    g.addColorStop(0.55, 'rgba(60,20,110,0.8)');
    g.addColorStop(1, 'rgba(120,60,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 46 * wob, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,140,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 52 * wob, 14 * wob, t * 2.2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

class MaserStrike {
  /**
   * Orbital MASER: a wide, faint blue targeting beam converges from space
   * onto the marked impact point, then the maser fires straight down.
   */
  constructor(x, y, def, owner) {
    this.kind = 'maser';
    this.x = Utils.clamp(x, 8, W - 8);
    this.y = y;
    this.def = def;
    this.owner = owner;
    this.CONVERGE = 1.05;
    this.FIRE = 0.5;
    this.t = 0;
    this.fired = false;
    this.dead = false;
  }

  update(dt, game) {
    this.t += dt;
    if (!this.fired && this.t >= this.CONVERGE) {
      this.fired = true;
      AudioEngine.laser();
      AudioEngine.explosion(0.5);
      game.applyExplosion(this.x, this.y, this.def, this.owner, {});
      game.terrain.crater(this.x, this.y + 14, 11); // the beam bores deeper
      FX.ring(this.x, this.y, 70, 0.4, '#9fdcff');
      FX.addShake(7);
      for (let i = 0; i < 16; i++) {
        FX.spawn({
          x: this.x + Utils.rand(-5, 5), y: Utils.rand(this.y * 0.15, this.y),
          vx: Utils.rand(-70, 70), vy: Utils.rand(-40, 30),
          life: Utils.rand(0.2, 0.5), size: 2, color: '#bfe8ff', grav: 0, kind: 'spark',
        });
      }
    }
    if (this.t >= this.CONVERGE + this.FIRE) this.dead = true;
  }

  draw(ctx, t) {
    const ty = this.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (!this.fired) {
      // wide faint targeting cone narrowing onto the marked point
      const cv = Utils.smoothstep(Math.min(1, this.t / this.CONVERGE));
      const topW = Utils.lerp(180, 16, cv);
      const botW = Utils.lerp(64, 5, cv);
      const pulse = 0.75 + 0.25 * Math.sin(t * 18);
      const grad = ctx.createLinearGradient(0, 0, 0, ty);
      grad.addColorStop(0, 'rgba(120,190,255,0.20)');
      grad.addColorStop(1, 'rgba(170,225,255,0.85)');
      ctx.globalAlpha = (0.08 + 0.17 * cv) * pulse;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(this.x - topW / 2, -10);
      ctx.lineTo(this.x + topW / 2, -10);
      ctx.lineTo(this.x + botW / 2, ty);
      ctx.lineTo(this.x - botW / 2, ty);
      ctx.closePath();
      ctx.fill();
      // shrinking lock-on reticle
      ctx.globalAlpha = 0.4 + 0.45 * Math.sin(t * 12) * Math.sin(t * 12);
      ctx.strokeStyle = '#9fdcff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(this.x, ty, Utils.lerp(36, 8, cv), 0, TAU);
      ctx.stroke();
    } else {
      // the strike itself: blue sheath, white-hot core, impact bloom
      const ft = (this.t - this.CONVERGE) / this.FIRE;
      const fade = ft < 0.7 ? 1 : 1 - (ft - 0.7) / 0.3;
      const wob = 1 + 0.22 * Math.sin(t * 55);
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = '#7fc4ff';
      ctx.fillRect(this.x - 9 * wob, -10, 18 * wob, ty + 10);
      ctx.globalAlpha = 0.95 * fade;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(this.x - 3, -10, 6, ty + 10);
      const g = ctx.createRadialGradient(this.x, ty, 2, this.x, ty, 48);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(127,196,255,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, ty, 48, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

class RodStrike {
  /** Schedules kinetic rods dropping from orbit after a marking delay. */
  constructor(x, def, owner) {
    this.kind = 'rods';
    this.x = x;
    this.def = def;
    this.owner = owner;
    this.timer = 0.5;
    this.spawned = 0;
    this.dead = false;
  }
  update(dt, game) {
    this.timer -= dt;
    if (this.timer <= 0 && this.spawned < 3) {
      const off = (this.spawned - 1) * 38;
      const rodDef = Object.assign({}, this.def, { special: 'kinetic_rod' });
      const p = new Projectile(rodDef, Utils.clamp(this.x + off, 5, W - 5), -30, 0, 1250, this.owner, game);
      p.isSub = true;
      game.projectiles.push(p);
      AudioEngine.launch();
      this.spawned++;
      this.timer = 0.18;
    }
    if (this.spawned >= 3) this.dead = true;
  }
  draw(ctx, t) {
    // target marker
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, 0); ctx.lineTo(this.x, 40);
    ctx.stroke();
    ctx.restore();
  }
}

class NeutronPulse {
  /**
   * The Neutron Bomb's signature: concentric green radiation rings sweeping
   * across the whole battlefield, a sickly haze, and drifting fallout motes.
   * Purely cosmetic — damage is applied once at detonation in applyNeutron.
   */
  constructor(x, y, game) {
    this.kind = 'neutron';
    this.x = x; this.y = y;
    this.life = 2.4;
    this.age = 0;
    this.dead = false;
    this._motes = 0;
    AudioEngine._tone({ type: 'sine', f0: 60, f1: 22, dur: 2.2, gain: 0.3 });
    AudioEngine._noise({ dur: 2.0, type: 'bandpass', freq: 2600, q: 3, gain: 0.16, f1: 900 });
  }

  update(dt, game) {
    this.age += dt;
    // radioactive fallout drifting down across the map
    this._motes += dt;
    while (this._motes > 0.015 && this.age < 1.6) {
      this._motes -= 0.015;
      FX.spawn({
        x: Utils.rand(0, W), y: Utils.rand(-10, this.y),
        vx: Utils.rand(-12, 12), vy: Utils.rand(18, 60),
        life: Utils.rand(0.8, 1.8), size: Utils.rand(1.5, 3),
        color: Utils.choice(['#7dff5a', '#aaff7a', '#def0a0']),
        grav: 0.04, kind: 'spark',
      });
    }
    if (this.age >= this.life) this.dead = true;
  }

  draw(ctx, t) {
    const prog = this.age / this.life;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // expanding shockwave-style radiation rings (several, staggered)
    const maxR = Math.hypot(W, H) * 0.8;
    for (let i = 0; i < 4; i++) {
      const rt = Utils.clamp(prog * 1.3 - i * 0.16, 0, 1);
      if (rt <= 0 || rt >= 1) continue;
      const ease = 1 - (1 - rt) * (1 - rt);
      ctx.globalAlpha = (1 - rt) * 0.5;
      ctx.strokeStyle = i % 2 ? '#aaff7a' : '#39ff6a';
      ctx.lineWidth = 2 + (1 - rt) * 7;
      ctx.beginPath();
      ctx.arc(this.x, this.y, maxR * ease, 0, TAU);
      ctx.stroke();
    }
    // hot core that flares then fades
    const coreA = Math.max(0, 1 - prog * 2.2);
    if (coreA > 0) {
      const g = ctx.createRadialGradient(this.x, this.y, 4, this.x, this.y, 130);
      g.addColorStop(0, `rgba(220,255,200,${0.9 * coreA})`);
      g.addColorStop(0.5, `rgba(90,255,110,${0.5 * coreA})`);
      g.addColorStop(1, 'rgba(40,180,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 130, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // sickly green wash over the whole field, peaking early
    const wash = Math.max(0, 0.32 * (1 - prog * 1.4));
    if (wash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(40,200,70,${wash})`;
      ctx.fillRect(-60, -60, W + 120, H + 120);
      ctx.restore();
    }
  }
}
