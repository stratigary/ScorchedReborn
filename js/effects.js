'use strict';
/* ===== Particles, weather, camera shake, screen flash, speech bubbles ===== */

const FX = {
  particles: [],
  bubbles: [],
  rings: [],
  shakeMag: 0,
  flashAlpha: 0,
  dimAlpha: 0,     // nuclear blast: world darkens so the fireball reads as blinding
  MAX_PARTICLES: 900,

  reset() {
    this.particles.length = 0;
    this.bubbles.length = 0;
    this.rings.length = 0;
    this.shakeMag = 0;
    this.flashAlpha = 0;
    this.dimAlpha = 0;
  },

  /** Dim the world for a nuclear detonation; decays over ~1.5s. */
  nukeDim(intensity) {
    this.dimAlpha = Math.max(this.dimAlpha, Utils.clamp(intensity, 0, 0.85));
  },

  /** Expanding shockwave ring. */
  ring(x, y, maxR, life, color) {
    this.rings.push({ x, y, maxR, life, age: 0, color: color || '#ffd9a0' });
  },

  addShake(m) { this.shakeMag = Math.min(40, this.shakeMag + m); },
  flash(intensity) { this.flashAlpha = Math.min(1, this.flashAlpha + intensity); },

  shakeOffset() {
    if (this.shakeMag <= 0.2) return { x: 0, y: 0 };
    return {
      x: (Math.random() - 0.5) * this.shakeMag * 2,
      y: (Math.random() - 0.5) * this.shakeMag * 2,
    };
  },

  spawn(p) {
    if (this.particles.length >= this.MAX_PARTICLES) this.particles.shift();
    p.age = 0;
    this.particles.push(p);
  },

  /* ---------- explosion & misc visual bursts ---------- */

  explosion(x, y, r) {
    // shockwave rings + hot fireball core
    this.ring(x, y, r * 2.1, 0.45, '#ffd9a0');
    if (r > 45) this.ring(x, y, r * 3, 0.7, 'rgba(255,255,255,0.8)');
    for (let i = 0; i < Math.min(14, 5 + r * 0.12); i++) {
      this.spawn({
        x: x + Utils.rand(-r * 0.2, r * 0.2), y: y + Utils.rand(-r * 0.2, r * 0.2),
        vx: Utils.rand(-30, 30), vy: Utils.rand(-50, -10),
        life: Utils.rand(0.18, 0.45), size: Utils.rand(r * 0.18, r * 0.4),
        color: Utils.choice(['#fff3c0', '#ffc24a', '#ff8a2a']),
        grav: -0.05, kind: 'glow',
      });
    }
    const n = Math.min(70, 16 + r);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = Utils.rand(40, 90 + r * 3);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: Utils.rand(0.4, 1.1), size: Utils.rand(2, 5),
        color: Utils.choice(['#ffb444', '#ff7022', '#ffe9a0', '#b0b0b0', '#666666']),
        grav: 0.55, kind: 'spark',
      });
    }
    // smoke puffs
    for (let i = 0; i < 12; i++) {
      this.spawn({
        x: x + Utils.rand(-r * 0.4, r * 0.4), y: y + Utils.rand(-r * 0.4, r * 0.4),
        vx: Utils.rand(-20, 20), vy: Utils.rand(-60, -15),
        life: Utils.rand(0.9, 2.0), size: Utils.rand(6, 14),
        color: 'rgba(90,90,90,0.5)', grav: -0.06, kind: 'smoke',
      });
    }
  },

  dirtBurst(x, y, r, color) {
    for (let i = 0; i < 40; i++) {
      const a = Utils.rand(-Math.PI, 0);
      const sp = Utils.rand(60, 200);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: Utils.rand(0.5, 1.2), size: Utils.rand(2, 4),
        color: color || '#8a5a33', grav: 1, kind: 'spark',
      });
    }
  },

  sparkTrail(x, y, color) {
    this.spawn({
      x, y, vx: Utils.rand(-12, 12), vy: Utils.rand(-12, 12),
      life: 0.35, size: 2, color: color || '#ffd080', grav: 0, kind: 'spark',
    });
  },

  /* ---------- weather ---------- */

  weatherTimer: 0,

  spawnWeather(dt, theme, wind) {
    if (!theme.weather) return;
    this.weatherTimer += dt;
    const rates = { snow: 0.02, sand: 0.008, ash: 0.03, matrix: 0.02, acid: 0.012 };
    const rate = rates[theme.weather] || 0.03;
    while (this.weatherTimer > rate) {
      this.weatherTimer -= rate;
      const x = Utils.rand(-100, W + 100);
      switch (theme.weather) {
        case 'snow':
          this.spawn({ x, y: -8, vx: wind * 4 + Utils.rand(-10, 10), vy: Utils.rand(35, 70),
            life: 16, size: Utils.rand(1.5, 3), color: '#eef4ff', grav: 0, kind: 'snow', sway: Math.random() * TAU });
          break;
        case 'sand':
          this.spawn({ x: wind >= 0 ? -10 : W + 10, y: Utils.rand(H * 0.15, H * 0.9),
            vx: (wind === 0 ? 1 : Math.sign(wind)) * Utils.rand(220, 420), vy: Utils.rand(-12, 25),
            life: 8, size: Utils.rand(1, 2.5), color: 'rgba(232,200,120,0.7)', grav: 0.02, kind: 'sand' });
          break;
        case 'ash':
          this.spawn({ x, y: -8, vx: wind * 5 + Utils.rand(-16, 16), vy: Utils.rand(20, 45),
            life: 22, size: Utils.rand(1.5, 3.5), color: Utils.choice(['#776f6c', '#9c918c', '#ffb070']),
            grav: 0, kind: 'snow', sway: Math.random() * TAU });
          break;
        case 'matrix':
          this.spawn({ x, y: -8, vx: wind * 2, vy: Utils.rand(180, 330),
            life: 6, size: Utils.rand(1.5, 2.5), color: '#39ff6a', grav: 0, kind: 'streak' });
          break;
        case 'acid':
          this.spawn({ x, y: -8, vx: wind * 7, vy: Utils.rand(240, 380),
            life: 6, size: 2, color: '#a4ff3c', grav: 0, kind: 'streak' });
          break;
      }
    }
  },

  /* ---------- update & draw ---------- */

  update(dt, terrain, vortices) {
    this.shakeMag *= Math.pow(0.04, dt);
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.4);
    this.dimAlpha = Math.max(0, this.dimAlpha - dt * 0.55);

    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      // singularity vortices pull particles in
      if (vortices) {
        for (const v of vortices) {
          const dx = v.x - p.x, dy = v.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < v.r * v.r * 4 && d2 > 25) {
            const d = Math.sqrt(d2);
            const f = v.pull * 3 / Math.max(40, d);
            p.vx += dx / d * f * dt * 60;
            p.vy += dy / d * f * dt * 60;
          }
        }
      }
      p.vy += GRAV * (p.grav || 0) * dt;
      if (p.kind === 'snow') p.vx += Math.sin(p.age * 2 + p.sway) * 8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // weather/sparks die on terrain contact
      if (terrain && p.y > 0 && terrain.isSolid(p.x, p.y)) {
        if (p.kind === 'streak' || p.kind === 'snow' || p.kind === 'sand') { ps.splice(i, 1); continue; }
        // sparks settle briefly then die
        p.vy = -Math.abs(p.vy) * 0.3;
        p.vx *= 0.5;
        p.life = Math.min(p.life, p.age + 0.3);
      }
      if (p.y > H + 30 || (p.x < -150 && p.vx <= 0) || (p.x > W + 150 && p.vx >= 0)) ps.splice(i, 1);
    }

    // shockwave rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }

    // bubbles
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.age += dt;
      if (b.age >= b.ttl) this.bubbles.splice(i, 1);
    }
  },

  draw(ctx) {
    // pass 1: soft/opaque particles (smoke, weather)
    for (const p of this.particles) {
      if (p.kind === 'spark' || p.kind === 'streak' || p.kind === 'glow') continue;
      const lifeT = 1 - p.age / p.life;
      ctx.globalAlpha = Math.min(1, lifeT * 2);
      ctx.fillStyle = p.color;
      if (p.kind === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.age * 0.7), 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }

    // pass 2: hot/emissive particles & rings, additive for a proper glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const lifeT = 1 - p.age / p.life;
      ctx.globalAlpha = Math.min(1, lifeT * 2);
      ctx.fillStyle = p.color;
      if (p.kind === 'streak') {
        ctx.fillRect(p.x, p.y, p.size * 0.7, p.size * 5);
      } else if (p.kind === 'glow') {
        ctx.globalAlpha = Math.min(1, lifeT) * 0.55;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.age * 2), 0, TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    for (const r of this.rings) {
      const t = r.age / r.life;
      const ease = 1 - (1 - t) * (1 - t); // ease-out expansion
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1 + (1 - t) * 5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.maxR * ease), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  /* ---------- retro speech bubbles ---------- */

  addBubble(x, y, text, ttl, opts = {}) {
    this.bubbles.push({ x, y, text, ttl, age: 0, color: opts.color || '#ffffff', follow: opts.follow || null });
  },

  drawBubbles(ctx) {
    ctx.save();
    ctx.font = '13px "Lucida Console", Monaco, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 2;
    for (const b of this.bubbles) {
      let bx = b.x, by = b.y;
      if (b.follow && b.follow.alive !== false) { bx = b.follow.x; by = b.follow.y - 46; }
      const fadeIn = Math.min(1, b.age * 6);
      const fadeOut = Math.min(1, (b.ttl - b.age) * 3);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);

      const w = Math.max(60, ctx.measureText(b.text).width + 22);
      const h = 26;
      let x0 = Utils.clamp(bx - w / 2, 6, W - w - 6);
      let y0 = Math.max(8, by - h - 14);

      // bubble box (blocky retro corners)
      ctx.fillStyle = 'rgba(8,12,20,0.92)';
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.fill();
      ctx.stroke();
      // tail
      ctx.beginPath();
      ctx.moveTo(Utils.clamp(bx - 6, x0 + 8, x0 + w - 20), y0 + h);
      ctx.lineTo(Utils.clamp(bx + 6, x0 + 20, x0 + w - 8), y0 + h);
      ctx.lineTo(Utils.clamp(bx, x0 + 10, x0 + w - 10), y0 + h + 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = b.color;
      ctx.fillText(b.text, x0 + w / 2, y0 + h / 2 + 4.5);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};
