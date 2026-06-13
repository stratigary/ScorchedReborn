'use strict';
/* ===== Deformable heightmap terrain =====
 * h[x] is the y coordinate of the surface at column x (y grows downward).
 * Smaller h = taller ground. Bedrock at BEDROCK_Y is indestructible.
 */

class Terrain {
  constructor(seed) {
    this.seed = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    this.h = new Float32Array(W);
    this.dirty = true;        // terrain cache needs redraw
    this._relaxAcc = 0;
    this.generate();
  }

  /* Midpoint displacement generation. */
  generate() {
    const rng = Utils.mulberry32(this.seed);
    const size = 2048; // power of two >= W
    const pts = new Float32Array(size + 1);
    const base = H * 0.62;
    pts[0] = base + (rng() - 0.5) * 160;
    pts[size] = base + (rng() - 0.5) * 160;
    let step = size, amp = H * 0.34;
    while (step > 1) {
      for (let i = step / 2; i < size; i += step) {
        const avg = (pts[i - step / 2] + pts[i + step / 2]) / 2;
        pts[i] = avg + (rng() - 0.5) * amp;
      }
      step /= 2;
      amp *= 0.55;
    }
    const minY = H * 0.28, maxY = BEDROCK_Y - 60;
    for (let x = 0; x < W; x++) {
      this.h[x] = Utils.clamp(pts[x], minY, maxY);
    }
    this.dirty = true;
  }

  heightAt(x) {
    const xi = Utils.clamp(Math.round(x), 0, W - 1);
    return this.h[xi];
  }

  /** Average slope (dy/dx, y-down) around column x over +-4 px. */
  slopeAt(x) {
    const a = this.heightAt(x - 4), b = this.heightAt(x + 4);
    return (b - a) / 8;
  }

  /** Surface normal (unit vector pointing out of the ground, i.e. upward). */
  normalAt(x) {
    const s = this.slopeAt(x);
    const len = Math.sqrt(1 + s * s);
    return { x: s / len, y: -1 / len };
  }

  isSolid(x, y) {
    if (y >= BEDROCK_Y) return true;
    if (x < 0 || x >= W) return false;
    return y >= this.h[Math.round(Utils.clamp(x, 0, W - 1))];
  }

  /** Carve a smooth circular crater. Dirt above the hole collapses down. */
  crater(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d = Math.sqrt(Math.max(0, r * r - dx * dx)); // half-thickness of circle at this column
      if (d <= 0) continue;
      const top = cy - d, bot = cy + d;
      const surf = this.h[x];
      if (surf >= bot) continue; // blast circle entirely in the air above this column
      if (surf >= top) {
        // surface intersects the circle: surface drops to the circle bottom
        this.h[x] = Math.min(BEDROCK_Y, bot);
      } else {
        // circle fully underground: dirt above collapses by the removed thickness
        this.h[x] = Math.min(BEDROCK_Y, surf + (bot - top));
      }
    }
    this.dirty = true;
  }

  /** Deposit a smooth hemispherical mound of soil centered at cx. */
  mound(cx, r) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const add = Math.sqrt(Math.max(0, r * r - dx * dx)) * 0.85;
      this.h[x] = Math.max(30, this.h[x] - add);
    }
    this.dirty = true;
  }

  /** Cut a deep vertical split down to the bedrock layer. */
  fissure(cx, halfWidth) {
    const rng = Utils.mulberry32(Math.floor(cx) + this.seed);
    const x0 = Math.max(0, Math.floor(cx - halfWidth));
    const x1 = Math.min(W - 1, Math.ceil(cx + halfWidth));
    for (let x = x0; x <= x1; x++) {
      const edge = Math.abs(x - cx) / halfWidth;          // 0 center, 1 edge
      const depth = BEDROCK_Y - (edge * edge) * 60 - rng() * 8;
      this.h[x] = Math.max(this.h[x], Math.min(BEDROCK_Y, depth));
    }
    this.dirty = true;
  }

  /** Melt away `amount` px of ground at column x (napalm). */
  melt(x, amount) {
    const xi = Math.round(Utils.clamp(x, 0, W - 1));
    this.h[xi] = Math.min(BEDROCK_Y, this.h[xi] + amount);
    this.dirty = true;
  }

  /**
   * Landslide slope relaxation: overly vertical columns shed dirt to their
   * neighbours a little each tick, smoothing cliffs organically over time.
   * Returns true if any column moved (terrain still settling).
   */
  relax(dt) {
    this._relaxAcc += dt;
    if (this._relaxAcc < 0.03) return false;
    this._relaxAcc = 0;

    const MAX_DIFF = 14;   // max stable height difference between neighbours
    const RATE = 0.45;     // fraction of the excess moved per tick
    const EPS = 0.04;      // transfers smaller than this count as settled
    let moved = false;
    const h = this.h;
    for (let pass = 0; pass < 2; pass++) {
      // Alternate sweep direction to avoid directional bias.
      const ltr = (Math.random() < 0.5);
      for (let i = 1; i < W; i++) {
        const x = ltr ? i : W - i;
        const a = x - 1, b = x;
        // h[a] > h[b] means column a's surface is LOWER than b's (y grows down)
        const diff = h[a] - h[b];
        if (diff > MAX_DIFF) {
          // column b towers over a: b sheds dirt into a
          const t = (diff - MAX_DIFF) * RATE * 0.5;
          if (t > EPS) { h[a] -= t; h[b] += t; moved = true; }
        } else if (-diff > MAX_DIFF) {
          const t = (-diff - MAX_DIFF) * RATE * 0.5;
          if (t > EPS) { h[b] -= t; h[a] += t; moved = true; }
        }
      }
    }
    if (moved) this.dirty = true;
    return moved;
  }

  serialize() {
    return { seed: this.seed, h: Array.from(this.h, v => Math.round(v * 10) / 10) };
  }

  static deserialize(data) {
    const t = new Terrain(data.seed);
    for (let x = 0; x < W && x < data.h.length; x++) t.h[x] = data.h[x];
    t.dirty = true;
    return t;
  }
}
