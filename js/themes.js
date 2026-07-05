'use strict';
/* ===== Environment themes (one per combat round, cycling) =====
 * Each theme customizes sky, celestial bodies, weather particles,
 * the grass/cap line, ground fills and procedural soil textures.
 */

const THEMES = [
  {
    id: 'hills', name: 'Classic Hills',
    sky: ['#6ec1ff', '#cfeeff'],
    sun: { kind: 'sun', x: 0.78, y: 0.16, r: 46, color: '#fffbe8', glow: 'rgba(255,255,255,0.85)' },
    stars: false,
    cap: '#3fa83f', capH: 12, capGlow: null,
    soilTop: '#8a5a33', soilBottom: '#4a2f1c',
    texture: 'clay',
    weather: null, windMax: 6,
    clouds: { n: 6, color: 'rgba(255,255,255,0.85)' },
  },
  {
    id: 'alpine', name: 'Alpine Peaks',
    sky: ['#060a20', '#1c2747'],
    sun: { kind: 'moon', x: 0.72, y: 0.14, r: 36, color: '#e9edff', glow: 'rgba(190,205,255,0.5)' },
    stars: true,
    cap: '#f4f8ff', capH: 14, capGlow: null,
    soilTop: '#5d6672', soilBottom: '#343b48',
    texture: 'slate',
    weather: 'snow', windMax: 8,
  },
  {
    id: 'canyon', name: 'Canyon Sandstone',
    sky: ['#ff8c3a', '#ffd9a0'],
    sun: { kind: 'bigsun', x: 0.5, y: 0.72, r: 95, color: '#ffefc2', glow: 'rgba(255,170,60,0.7)' },
    stars: false,
    cap: '#e8c878', capH: 10, capGlow: null,
    soilTop: '#a14a2a', soilBottom: '#66291a',
    texture: 'strata',
    weather: 'sand', windMax: 12,
    clouds: { n: 4, color: 'rgba(255,225,185,0.65)' },
  },
  {
    id: 'volcano', name: 'Volcanic Wasteland',
    sky: ['#14090b', '#54201a'],
    sun: { kind: 'sun', x: 0.26, y: 0.2, r: 40, color: '#ff4a22', glow: 'rgba(255,60,20,0.55)' },
    stars: false,
    cap: '#ff7b1c', capH: 9, capGlow: 'rgba(255,120,20,0.85)',
    soilTop: '#221e26', soilBottom: '#0d0c10',
    texture: 'lava',
    weather: 'ash', windMax: 9,
    eruptions: true, // ambient lava spouts fling burning droplets
  },
  {
    id: 'matrix', name: 'Cyberpunk Grid',
    sky: ['#000300', '#001a06'],
    sun: null,
    stars: false,
    cap: '#39ff6a', capH: 7, capGlow: 'rgba(57,255,106,0.9)',
    soilTop: '#02180a', soilBottom: '#010a04',
    texture: 'grid',
    weather: 'matrix', windMax: 10,
  },
  {
    id: 'toxic', name: 'Toxic Badlands',
    sky: ['#34164e', '#a6d44d'],
    sun: { kind: 'sun', x: 0.68, y: 0.2, r: 34, color: '#e9f2da', glow: 'rgba(220,240,200,0.45)' },
    stars: false,
    cap: '#65e832', capH: 11, capGlow: 'rgba(101,232,50,0.7)',
    soilTop: '#4a1f63', soilBottom: '#241038',
    texture: 'bubbles',
    weather: 'acid', windMax: 11,
    clouds: { n: 4, color: 'rgba(205,180,235,0.45)' },
  },
];

function themeForRound(round) { return THEMES[(round - 1) % THEMES.length]; }

/* ---------- per-round mutable sky state (stars, matrix streams) ---------- */

function makeThemeState(theme, seed) {
  const rng = Utils.mulberry32(seed);
  const state = { stars: [], streams: [], clouds: [] };
  if (theme.clouds) {
    for (let i = 0; i < theme.clouds.n; i++) {
      const puffs = [];
      const np = 4 + Math.floor(rng() * 3);
      for (let p = 0; p < np; p++) {
        puffs.push({ dx: (p - np / 2) * 22 + rng() * 14, dy: (rng() - 0.5) * 12, r: 14 + rng() * 16 });
      }
      const startX = rng() * (W + 360) - 180;
      state.clouds.push({
        x: startX, initialX: startX, y: 30 + rng() * H * 0.3,
        speed: 5 + rng() * 9, scale: 0.7 + rng() * 0.7, puffs,
      });
    }
  }
  if (theme.stars) {
    for (let i = 0; i < 130; i++) {
      state.stars.push({ x: rng() * W, y: rng() * H * 0.6, r: rng() * 1.4 + 0.4, tw: rng() * TAU });
    }
  }
  if (theme.id === 'matrix') {
    for (let i = 0; i < 42; i++) {
      state.streams.push({
        x: rng() * W, y: rng() * H, speed: 40 + rng() * 110,
        len: 6 + Math.floor(rng() * 14), chars: [], seed: Math.floor(rng() * 1e9),
      });
    }
  }
  return state;
}

function updateSky(state, dt, wind = 0) {
  if (!state || !state.clouds) return;
  for (const c of state.clouds) {
    c.x += (c.speed + wind * 0.15) * dt;
    const margin = 240 * c.scale;
    if (c.x > W + margin) {
      c.x = -margin;
    } else if (c.x < -margin) {
      c.x = W + margin;
    }
  }
}

/* ---------- sky rendering (per frame) ---------- */

function drawSky(ctx, theme, state, t, wind = 0) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (theme.stars) {
    ctx.save();
    for (const s of state.stars) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.7 + s.tw);
      ctx.globalAlpha = 0.3 + 0.6 * a;
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.restore();
  }

  if (theme.id === 'matrix') {
    ctx.save();
    ctx.font = '10px monospace';
    ctx.fillStyle = '#0f0';
    for (const s of state.streams) {
      const cy = (t * s.speed) % (H + s.len * 14) - s.len * 14;
      ctx.globalAlpha = 0.15;
      for (let j = 0; j < s.len; j++) {
        const charY = cy + j * 14;
        if (charY < 0 || charY > H) continue;
        ctx.globalAlpha = 0.04 + 0.12 * (j / s.len);
        const seedVal = s.seed + j + Math.floor(t * 4);
        const char = String.fromCharCode(33 + (seedVal % 93));
        ctx.fillText(char, s.x, charY);
      }
    }
    ctx.restore();
  }
  if (theme.id === 'cyberpunk') {
    ctx.save();
    const sun = theme.sun;
    if (sun) {
      const sx = sun.x || W / 2, sy = sun.y || H * 0.45;
      const g = ctx.createRadialGradient(sx, sy, sun.r * 0.2, sx, sy, sun.r);
      g.addColorStop(0, sun.color[0]);
      g.addColorStop(1, sun.color[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, sun.r, 0, TAU);
      ctx.fill();
      // neon bands
      if (theme.id === 'cyberpunk') {
        ctx.fillStyle = theme.sky[1];
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(sx - sun.r, sy + sun.r * 0.15 + i * sun.r * 0.2, sun.r * 2, sun.r * 0.07);
        }
      }
    }
    ctx.restore();
  }

  // drifting parallax clouds
  if (theme.clouds && state.clouds.length) {
    ctx.save();
    ctx.fillStyle = theme.clouds.color;
    for (const c of state.clouds) {
      const cx = c.x !== undefined ? c.x : (((c.initialX || 0) + t * (c.speed + wind * 0.15)) % (W + 420)) - 210;
      const stretch = 1.0 + Math.abs(wind) * 0.006;
      ctx.globalAlpha = 0.5 + 0.2 * c.scale;
      ctx.beginPath();
      for (const p of c.puffs) {
        ctx.moveTo(cx + p.dx * c.scale * stretch + p.r * c.scale, c.y + p.dy * c.scale);
        ctx.arc(cx + p.dx * c.scale * stretch, c.y + p.dy * c.scale, p.r * c.scale, 0, TAU);
      }
      ctx.fill();
      // flat base shading for volume
      ctx.globalAlpha *= 0.35;
      ctx.fillRect(cx - 55 * c.scale * stretch, c.y + 9 * c.scale, 110 * c.scale * stretch, 4 * c.scale);
    }
    ctx.restore();
  }
}

/* ---------- terrain rendering into the cache canvas ---------- */

function drawTerrainCache(g, terrain, theme) {
  g.clearRect(0, 0, W, H);
  const h = terrain.h;
  const rng = Utils.mulberry32(terrain.seed + 7);

  // ground silhouette path
  const groundPath = () => {
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, h[0]);
    for (let x = 1; x < W; x++) g.lineTo(x, h[x]);
    g.lineTo(W - 1, H);
    g.closePath();
  };

  // base soil gradient
  const grad = g.createLinearGradient(0, H * 0.25, 0, H);
  grad.addColorStop(0, theme.soilTop);
  grad.addColorStop(1, theme.soilBottom);
  groundPath();
  g.fillStyle = grad;
  g.fill();

  // procedural texture, clipped to the ground
  g.save();
  groundPath();
  g.clip();
  switch (theme.texture) {
    case 'clay': {     // subtle speckles
      g.fillStyle = 'rgba(60,38,20,0.35)';
      for (let i = 0; i < 900; i++) {
        const x = rng() * W, y = H * 0.3 + rng() * H * 0.7;
        g.fillRect(x, y, 2 + rng() * 2, 1 + rng() * 2);
      }
      break;
    }
    case 'slate': {    // grey mountain layering
      for (let i = 0; i < 26; i++) {
        const y = H * 0.25 + i * 26 + rng() * 8;
        g.strokeStyle = `rgba(${30 + rng() * 40},${36 + rng() * 40},${48 + rng() * 40},0.4)`;
        g.lineWidth = 3 + rng() * 5;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 64) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 9);
        g.stroke();
      }
      break;
    }
    case 'strata': {   // layered horizontal sandstone stratification
      const cols = ['rgba(140,60,30,0.5)', 'rgba(190,95,45,0.42)', 'rgba(110,42,24,0.5)', 'rgba(210,130,70,0.32)'];
      let y = H * 0.22;
      let i = 0;
      while (y < H) {
        const th = 8 + rng() * 16;
        g.fillStyle = cols[i % cols.length];
        g.fillRect(0, y, W, th * 0.55);
        y += th;
        i++;
      }
      break;
    }
    case 'lava': {     // branching glowing lava veins in obsidian
      g.save();
      g.strokeStyle = '#ff7a1a';
      g.shadowColor = '#ff5400';
      g.shadowBlur = 9;
      g.lineCap = 'round';
      const drawVein = (x, y, angle, len, width, depth) => {
        if (depth > 3 || width < 0.7) return;
        g.lineWidth = width;
        g.globalAlpha = 0.5 + rng() * 0.4;
        g.beginPath();
        g.moveTo(x, y);
        let cx = x, cy = y, a = angle;
        const segs = 4 + Math.floor(rng() * 4);
        for (let i = 0; i < segs; i++) {
          a += (rng() - 0.5) * 1.1;
          const sl = len / segs;
          cx += Math.cos(a) * sl; cy += Math.sin(a) * sl;
          g.lineTo(cx, cy);
          if (rng() < 0.4) drawVein(cx, cy, a + (rng() < 0.5 ? 0.9 : -0.9), len * 0.55, width * 0.6, depth + 1);
        }
        g.stroke();
      };
      for (let i = 0; i < 14; i++) {
        const x = rng() * W;
        const y = terrain.heightAt(x) + 30 + rng() * (H - terrain.heightAt(x) - 60);
        drawVein(x, y, rng() * TAU, 80 + rng() * 130, 2.6, 0);
      }
      g.restore();
      break;
    }
    case 'grid': {     // perspective converging gridlines + scanlines
      const horizonY = H * 0.3;
      const vpx = W / 2;
      g.strokeStyle = 'rgba(57,255,106,0.30)';
      g.lineWidth = 1.2;
      for (let i = -24; i <= 24; i++) {
        g.beginPath();
        g.moveTo(vpx, horizonY);
        g.lineTo(vpx + i * 110, H + 60);
        g.stroke();
      }
      // horizontal lines spaced wider toward the viewer
      g.strokeStyle = 'rgba(57,255,106,0.22)';
      let y = horizonY + 6, gap = 5;
      while (y < H) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        y += gap; gap *= 1.16;
      }
      // fine digital scanlines
      g.fillStyle = 'rgba(0,40,12,0.45)';
      for (let sy = 0; sy < H; sy += 4) g.fillRect(0, sy, W, 1);
      break;
    }
    case 'bubbles': {  // bubbling circular purple sludge pockets
      for (let i = 0; i < 70; i++) {
        const x = rng() * W;
        const top = terrain.heightAt(x);
        const y = top + 20 + rng() * Math.max(10, H - top - 50);
        const r = 4 + rng() * 15;
        g.fillStyle = `rgba(${120 + rng() * 60},${50 + rng() * 30},${170 + rng() * 60},0.4)`;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(220,170,255,0.35)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, r, -2.4, -0.9); g.stroke(); // highlight arc
      }
      break;
    }
  }
  g.restore();

  // bedrock layer
  g.fillStyle = '#14161c';
  g.fillRect(0, BEDROCK_Y, W, H - BEDROCK_Y);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = 0; x < W; x += 26) g.fillRect(x, BEDROCK_Y + 4, 13, 3);

  // ambient-occlusion shadow just beneath the surface for depth
  g.save();
  groundPath();
  g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = theme.capH * 2.2;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, h[0] + theme.capH * 1.6);
  for (let x = 1; x < W; x++) g.lineTo(x, h[x] + theme.capH * 1.6);
  g.stroke();
  g.restore();

  // soot charred overlay
  // Draw indestructible concrete/stone structures
  if (terrain.indestructible) {
    g.save();
    groundPath();
    g.clip();

    g.fillStyle = '#4b5263';
    g.strokeStyle = '#292d37';
    g.lineWidth = 1;
    for (let x = 0; x < W; x++) {
      const limitY = terrain.indestructible[x];
      if (limitY < BEDROCK_Y) {
        g.fillRect(x, limitY, 1, BEDROCK_Y - limitY);
        // vertical grid panel lines
        if (x % 36 === 0) {
          g.beginPath();
          g.moveTo(x, limitY);
          g.lineTo(x, BEDROCK_Y);
          g.stroke();
        }
      }
    }
    // horizontal brick layers
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let y = 300; y < BEDROCK_Y; y += 22) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    // top highlight for stone structure
    g.strokeStyle = '#8c95a8';
    g.lineWidth = 3;
    g.beginPath();
    let drawing = false;
    for (let x = 0; x < W; x++) {
      const limitY = terrain.indestructible[x];
      if (limitY < BEDROCK_Y) {
        if (!drawing) {
          g.moveTo(x, limitY + 1);
          drawing = true;
        } else {
          g.lineTo(x, limitY + 1);
        }
      } else {
        if (drawing) {
          g.stroke();
          drawing = false;
        }
      }
    }
    if (drawing) g.stroke();
    g.restore();
  }

  g.save();
  groundPath();
  g.clip();
  g.strokeStyle = '#040406';
  g.lineWidth = 1.2;
  for (let x = 0; x < W; x++) {
    if (terrain.soot && terrain.soot[x] > 0.01) {
      g.globalAlpha = terrain.soot[x] * 0.88;
      g.beginPath();
      g.moveTo(x, h[x] - 1);
      g.lineTo(x, h[x] + 15);
      g.stroke();
    }
  }
  g.restore();

  // grass / cap line along the surface
  g.save();
  if (theme.capGlow) { g.shadowColor = theme.capGlow; g.shadowBlur = 12; }
  g.strokeStyle = theme.cap;
  g.lineWidth = theme.capH;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, h[0]);
  for (let x = 1; x < W; x++) g.lineTo(x, h[x]);
  g.stroke();
  g.restore();

  // thin sunlit highlight on top of the cap
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, h[0] - theme.capH * 0.42);
  for (let x = 1; x < W; x++) g.lineTo(x, h[x] - theme.capH * 0.42);
  g.stroke();
  g.restore();
}
