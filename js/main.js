'use strict';
/* ===== Bootstrap: menus, input, resize, fixed-step loop ===== */

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const game = new Game();
  const shop = new ShopUI();

  const elMenu = document.getElementById('menu');
  const elPause = document.getElementById('pause');
  const elGameOver = document.getElementById('gameover');
  const elSlots = document.getElementById('player-slots');
  const btnStart = document.getElementById('btn-start');
  const btnResume = document.getElementById('btn-resume');

  let paused = false;
  let inMenu = true;

  /* ---------- player setup slots ---------- */

  const TYPE_OPTIONS = [
    ['human', 'Human'],
    ['novice', 'Novice AI'],
    ['amateur', 'Amateur AI'],
    ['pro', 'Professional AI'],
    ['johnwick', 'John Wick AI'],
  ];
  const DEFAULT_SLOTS = [
    { on: true, name: 'Player 1', type: 'human' },
    { on: true, name: 'Sgt. Rust', type: 'amateur' },
    { on: false, name: 'Maj. Payne', type: 'pro' },
    { on: false, name: 'Baba Yaga', type: 'johnwick' },
  ];

  function buildSlots() {
    elSlots.innerHTML = '';
    DEFAULT_SLOTS.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'player-slot';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = slot.on;
      cb.disabled = i < 2; // need at least two combatants
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PLAYER_COLORS[i];
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 14;
      name.value = slot.name;
      const sel = document.createElement('select');
      for (const [val, label] of TYPE_OPTIONS) {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        if (val === slot.type) o.selected = true;
        sel.appendChild(o);
      }
      const sync = () => {
        name.disabled = sel.disabled = !cb.checked;
        row.classList.toggle('slot-off', !cb.checked);
      };
      cb.addEventListener('change', sync);
      sync();
      row.append(cb, dot, name, sel);
      row._get = () => cb.checked ? { name: name.value.trim() || `Player ${i + 1}`, type: sel.value } : null;
      elSlots.appendChild(row);
    });
  }
  buildSlots();

  /* ---------- menu actions ---------- */

  function startMatch() {
    AudioEngine.init();
    AudioEngine.resume();
    const players = Array.from(elSlots.children).map(r => r._get()).filter(Boolean);
    if (players.length < 2) return;
    const sound = document.getElementById('opt-sound').checked;
    AudioEngine.setEnabled(sound);
    const cashOpt = document.getElementById('opt-cash').value;
    game.newMatch({
      players,
      rounds: parseInt(document.getElementById('opt-rounds').value, 10),
      wrap: document.getElementById('opt-wrap').checked,
      noLevels: document.getElementById('opt-nolevels').checked,
      startCash: cashOpt === 'unlimited' ? Infinity : parseInt(cashOpt, 10),
      sound,
    });
    if (sound) AudioEngine.startMusic();
    inMenu = false;
    elMenu.classList.add('hidden');
    elGameOver.classList.add('hidden');
  }

  function resumeMatch() {
    AudioEngine.init();
    AudioEngine.resume();
    const data = SaveSystem.loadMatch();
    if (!data) { btnResume.classList.add('hidden'); return; }
    game.restore(data);
    AudioEngine.setEnabled(game.settings.sound);
    if (game.settings.sound) AudioEngine.startMusic();
    inMenu = false;
    elMenu.classList.add('hidden');
    elGameOver.classList.add('hidden');
  }

  btnStart.addEventListener('click', startMatch);
  btnResume.addEventListener('click', resumeMatch);
  if (SaveSystem.hasSave()) btnResume.classList.remove('hidden');

  /* ---------- game callbacks ---------- */

  game.onShop = () => shop.open(game, () => game.nextRound());

  game.onGameOver = (standings) => {
    AudioEngine.humReset();
    const title = document.getElementById('go-title');
    const list = document.getElementById('go-standings');
    title.textContent = standings.length ? `${standings[0].name} WINS THE WAR` : 'GAME OVER';
    list.innerHTML = standings.map((s, i) =>
      `<div><span class="st-name" style="color:${s.color}">${i + 1}. ${s.name}</span>` +
      `<span class="st-score">◆ ${s.score}</span>` +
      `${game.settings.noLevels ? '' : ' &nbsp; Lv' + s.level}</div>`).join('');
    elGameOver.classList.remove('hidden');
  };

  document.getElementById('btn-go-menu').addEventListener('click', () => {
    elGameOver.classList.add('hidden');
    elMenu.classList.remove('hidden');
    inMenu = true;
    game.phase = 'idle';
    AudioEngine.stopMusic();
    if (SaveSystem.hasSave()) btnResume.classList.remove('hidden');
    else btnResume.classList.add('hidden');
  });

  /* ---------- pause ---------- */

  const sliderMusic = document.getElementById('pause-music');
  const sliderSfx = document.getElementById('pause-sfx');
  const sliderMusicVal = document.getElementById('pause-music-val');
  const sliderSfxVal = document.getElementById('pause-sfx-val');

  function syncVolumeSliders() {
    sliderMusic.value = Math.round(AudioEngine.musicVol * 100);
    sliderSfx.value = Math.round(AudioEngine.sfxVol * 100);
    sliderMusicVal.textContent = sliderMusic.value;
    sliderSfxVal.textContent = sliderSfx.value;
  }

  sliderMusic.addEventListener('input', () => {
    AudioEngine.setMusicVolume(sliderMusic.value / 100);
    sliderMusicVal.textContent = sliderMusic.value;
  });
  sliderSfx.addEventListener('input', () => {
    AudioEngine.setSfxVolume(sliderSfx.value / 100);
    sliderSfxVal.textContent = sliderSfx.value;
  });
  sliderSfx.addEventListener('change', () => AudioEngine.click()); // audible preview

  function setPaused(on) {
    if (inMenu || game.phase === 'over') return;
    paused = on;
    elPause.classList.toggle('hidden', !on);
    if (on) {
      document.getElementById('pause-wrap').checked = game.settings.wrap;
      document.getElementById('pause-sound').checked = game.settings.sound;
      syncVolumeSliders();
    }
  }

  document.getElementById('btn-pause-resume').addEventListener('click', () => setPaused(false));
  document.getElementById('pause-wrap').addEventListener('change', e => {
    game.settings.wrap = e.target.checked;
  });
  document.getElementById('pause-sound').addEventListener('change', e => {
    game.settings.sound = e.target.checked;
    AudioEngine.setEnabled(e.target.checked);
    if (e.target.checked) AudioEngine.startMusic(); else AudioEngine.stopMusic();
  });
  document.getElementById('btn-save-quit').addEventListener('click', () => {
    SaveSystem.saveMatch(game);
    setPaused(false);
    inMenu = true;
    game.phase = 'idle';
    AudioEngine.stopMusic();
    AudioEngine.humReset();
    elMenu.classList.remove('hidden');
    if (SaveSystem.hasSave()) btnResume.classList.remove('hidden');
  });

  /* ---------- keyboard input ---------- */

  const keys = {};
  let charging = false;
  let chargeHeld = 0;

  window.addEventListener('keydown', (e) => {
    AudioEngine.init();
    AudioEngine.resume();
    if (e.code === 'Escape') { setPaused(!paused); e.preventDefault(); return; }
    if (inMenu || paused) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
    if (keys[e.code]) return; // ignore key repeat
    keys[e.code] = true;

    switch (e.code) {
      case 'KeyQ': game.cycleWeapon(-1); break;
      case 'KeyE': case 'Tab': game.cycleWeapon(1); break;
      case 'KeyX': game.tryActivateShield(); break;
      case 'Space':
        if (game.humanCanAct) { charging = true; chargeHeld = 0; }
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space' && charging) {
      charging = false;
      if (!inMenu && !paused) game.tryFire();
    }
  });

  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    charging = false;
  });

  function applyHeldKeys(dt) {
    if (!game.humanCanAct) { charging = false; return; }
    if (keys.ArrowLeft) game.adjustAngle(1, dt);   // left arrow tilts barrel left (toward 180)
    if (keys.ArrowRight) game.adjustAngle(-1, dt);
    if (keys.ArrowUp) game.adjustPower(1, dt);
    if (keys.ArrowDown) game.adjustPower(-1, dt);
    if (keys.KeyA) game.drive(-1, dt);
    if (keys.KeyD) game.drive(1, dt);
    if (charging) {
      // hold SPACE to charge power upward; release to fire
      chargeHeld += dt;
      if (chargeHeld > 0.18) game.adjustPower(1.6, dt);
    }
  }

  /* ---------- resize: scale the fixed 1600x900 stage ---------- */

  function resize() {
    const wrap = document.getElementById('game-wrap');
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    wrap.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------- main loop (fixed timestep) ---------- */

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (paused) return;

    acc += dt;
    while (acc >= STEP) {
      if (!inMenu) {
        applyHeldKeys(STEP);
        game.update(STEP);
      }
      acc -= STEP;
    }

    if (!inMenu && game.terrain) {
      game.render(ctx);
    } else {
      drawMenuBackdrop(ctx, now / 1000);
    }
  }

  /* animated synthwave backdrop behind the menu */
  let menuSeedTheme = THEMES[Utils.randInt(0, THEMES.length - 1)];
  let menuState = null;
  let menuTerrain = null;
  const menuCache = Utils.makeCanvas(W, H);

  function drawMenuBackdrop(c, t) {
    if (!menuTerrain) {
      menuTerrain = new Terrain();
      menuState = makeThemeState(menuSeedTheme, menuTerrain.seed);
      drawTerrainCache(menuCache.getContext('2d'), menuTerrain, menuSeedTheme);
    }
    drawSky(c, menuSeedTheme, menuState, t);
    c.drawImage(menuCache, 0, 0);
  }

  requestAnimationFrame(frame);
})();
