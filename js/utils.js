'use strict';
/* ===== Global constants & helpers ===== */

const W = 1600;            // world / canvas width
const H = 900;             // world / canvas height
const BEDROCK_Y = H - 36;  // indestructible bedrock line
const GRAV = 400;          // px / s^2
const TAU = Math.PI * 2;

const Utils = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a = 0, b = 1) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(this.rand(a, b + 1)); },
  choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); },
  deg2rad(d) { return d * Math.PI / 180; },
  rad2deg(r) { return r * 180 / Math.PI; },
  smoothstep(t) { return t * t * (3 - 2 * t); },
  wrapX(x) { return ((x % W) + W) % W; },
  money(n) { return isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '$∞'; },

  // Deterministic PRNG for stable per-round procedural textures.
  mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  },
};

// XP needed to reach level (index 0 => level 1). Max level 5.
const LEVEL_XP = [0, 200, 500, 1000, 1800];
const MAX_LEVEL = 5;

function levelForXP(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return Math.min(lvl, MAX_LEVEL);
}

const PLAYER_COLORS = ['#ff5252', '#42a5f5', '#ffd54f', '#9ccc65'];
