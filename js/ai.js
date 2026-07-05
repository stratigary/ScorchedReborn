'use strict';
/* ===== AI opponents =====
 * Four profiles. All aiming uses ballistic simulation sweeps (which naturally
 * handles targets below the horizon — no clamping, no shooting backwards),
 * with per-profile precision, error offsets and wind handling.
 */

const AI_PROFILES = {
  novice: {
    label: 'Novice Bot',
    errAngle: 16, errPower: 16,
    wind: 'none',          // simulates with zero wind
    refine: 0,             // coarse sweep only
    shieldChance: 0,
    weaponPick: 'random',
    shop: 'cheap',
  },
  amateur: {
    label: 'Amateur Bot',
    errAngle: 6, errPower: 7,
    wind: 'power',         // sim without wind, then heuristic power correction
    refine: 0,
    shieldChance: 0.4,
    weaponPick: 'mid',
    shop: 'standard',
  },
  pro: {
    label: 'Professional Bot',
    errAngle: 1.6, errPower: 2,
    wind: 'sim',           // full wind-aware simulation
    refine: 1,
    shieldChance: 0.85,
    weaponPick: 'best',
    shop: 'pro',
  },
  johnwick: {
    label: 'John Wick Bot',
    errAngle: 0.15, errPower: 0.2,
    wind: 'sim',
    refine: 2,             // coarse + fine + extra-fine
    shieldChance: 1,
    weaponPick: 'heavy',
    shop: 'wick',
  },
  behemoth: {
    label: 'Behemoth Boss',
    errAngle: 0.2, errPower: 0.3,
    wind: 'sim',
    refine: 2,
    shieldChance: 0.8,
    weaponPick: 'heavy',
    shop: 'wick',
  },
};

class AIController {
  constructor(tank) {
    this.tank = tank;
    this.profile = AI_PROFILES[tank.type] || AI_PROFILES.novice;
    this.state = 'idle';
    this.timer = 0;
    this.targetAngle = 90;
    this.targetPower = 50;
  }

  beginTurn(game) {
    const t = this.tank;

    // shield decision
    if (!t.shield && t.ammo('shield') > 0 && Math.random() < this.profile.shieldChance) {
      t.activateShield();
    } else if (t.shield && t.shield.hp < 45 && t.ammo('battery') > 0) {
      t.activateShield(); // tops the shield off from a battery
    }
    this._pickWeapon(game);

    // driving decision: novices don't drive tactically
    if (this.tank.type !== 'novice' && t.fuel > 0 && !t.buried && !t.falling) {
      const currentScore = this._evaluatePosition(game, t.x);
      const maxDist = t.fuel / (t.hasUpgrade('engine') ? 0.09 : 0.18);
      let bestOption = { x: t.x, score: currentScore };

      const steps = [40, 80, 120, 160];
      for (const d of steps) {
        if (d > maxDist) break;

        // Evaluate Left
        const lx = Math.max(12, t.x - d);
        const lScore = this._evaluatePosition(game, lx);
        if (lScore > bestOption.score) {
          bestOption = { x: lx, score: lScore };
        }

        // Evaluate Right
        const rx = Math.min(W - 12, t.x + d);
        const rScore = this._evaluatePosition(game, rx);
        if (rScore > bestOption.score) {
          bestOption = { x: rx, score: rScore };
        }
      }

      if (bestOption.x !== t.x && bestOption.score > currentScore + 15) {
        this.driveTargetX = bestOption.x;
        this.state = 'drive';
        return;
      }
    }

    this.state = 'think';
    this.timer = Utils.rand(0.5, 1.0);
    this._plan(game);
  }

  /** Runs every frame during this bot's aim phase. Calls game.fire() when ready. */
  update(dt, game) {
    const t = this.tank;
    if (this.state === 'drive') {
      const dir = Math.sign(this.driveTargetX - t.x);
      const dist = Math.abs(this.driveTargetX - t.x);
      if (dist > 2 && t.fuel > 0 && !t.buried && !t.falling) {
        const lastX = t.x;
        t.drive(dir, dt, game.terrain);
        if (Math.abs(t.x - lastX) < 0.05) {
          // Blocked by slope/climb limits
          this.state = 'think';
          this.timer = Utils.rand(0.4, 0.8);
          this._plan(game);
        }
      } else {
        // Reached target or out of fuel
        this.state = 'think';
        this.timer = Utils.rand(0.4, 0.8);
        this._plan(game);
      }
      return;
    }

    if (this.state === 'think') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'aim';
      return;
    }
    if (this.state === 'aim') {
      // barrels rotate and power charges visually over time
      const aSpeed = 70 * dt, pSpeed = 55 * dt;
      const da = this.targetAngle - t.angle;
      const dp = this.targetPower - t.power;
      t.angle += Utils.clamp(da, -aSpeed, aSpeed);
      t.power += Utils.clamp(dp, -pSpeed, pSpeed);
      if (Math.abs(da) < 0.4 && Math.abs(dp) < 0.6) {
        t.angle = this.targetAngle;
        t.power = this.targetPower;
        this.state = 'done';
        game.fire(t);
      }
    }
  }

  _evaluatePosition(game, x) {
    const terrain = game.terrain;
    const y = terrain.heightAt(x);
    if (x < 50 || x > W - 50) return -1000;
    
    // Elevation score (higher altitude is generally better, e.g. Y is smaller)
    let score = (H - y) * 0.45;
    
    // Slope steepness at x
    const yLeft = terrain.heightAt(Math.max(0, x - 12));
    const yRight = terrain.heightAt(Math.min(W, x + 12));
    const slope = Math.abs(yLeft - yRight);
    score -= slope * 3.5;
    
    // Proximity to hazards (Vortex, Napalm)
    for (const h of game.hazards) {
      if (h.dead) continue;
      const d = Math.hypot(x - h.x, y - h.y);
      if (d < 120) {
        score -= (120 - d) * 4.5;
      }
    }
    
    // Proximity to other tanks (avoid clustering)
    for (const t of game.tanks) {
      if (t === this.tank || !t.alive) continue;
      const d = Math.abs(x - t.x);
      if (d < 90) {
        score -= (90 - d) * 2.5;
      }
    }
    
    return score;
  }

  /* ---------- weapon selection ---------- */

  _pickWeapon(game) {
    const t = this.tank;
    let owned = t.ownedWeapons();

    // If buried, do not use dirt weapons (so we don't bury ourselves more)
    // and prefer direct/clean weapons if available to clear the dirt.
    if (t.buried) {
      owned = owned.filter(w => w.id !== 'dirt' && w.id !== 'megadirt');
      const safe = owned.filter(w => w.id === 'missile' || w.id === 'railgun' || w.id === 'laser');
      if (safe.length > 0) {
        t.selectedWeapon = safe[0].id;
        return;
      }
    }

    const pick = this.profile.weaponPick;
    let chosen = owned[0];
    const score = w => (w.dmg || 0) * (1 + (w.radius || 0) / 60);

    if (pick === 'random') {
      chosen = Utils.choice(owned);
    } else if (pick === 'mid') {
      const real = owned.filter(w => (w.dmg || 0) > 0);
      real.sort((a, b) => score(b) - score(a));
      chosen = real[Math.min(real.length - 1, Utils.randInt(0, 1))] || owned[0];
    } else if (pick === 'best' || pick === 'heavy') {
      // prefer reliably-simulated ballistic heavy hitters
      const pref = pick === 'heavy'
        ? ['neutron', 'thermo', 'meteor', 'singularity', 'carpet', 'kinetic', 'tacnuke', 'napalmmirv', 'railgun', 'mirv', 'babynuke', 'homing', 'laser']
        : ['tacnuke', 'railgun', 'mirv', 'napalmmirv', 'homing', 'babynuke', 'laser', 'thermo', 'singularity'];
      chosen = null;
      for (const id of pref) {
        const w = owned.find(o => o.id === id);
        if (w) { chosen = w; break; }
      }
      if (!chosen) {
        const real = owned.filter(w => (w.dmg || 0) > 0).sort((a, b) => score(b) - score(a));
        chosen = real[0] || owned[0];
      }
    }
    t.selectedWeapon = (chosen || owned[0]).id;
  }

  /* ---------- ballistic planning ---------- */

  _plan(game) {
    const t = this.tank;
    const enemies = game.tanks.filter(o => o.alive && o !== t && !areAllies(o, t));
    if (!enemies.length) { this.targetAngle = 90; this.targetPower = 50; return; }
    // enemy decoys read as real contacts on the targeting scope
    const contacts = enemies.concat(
      game.hazards.filter(h => h.kind === 'decoy' && !h.dead && h.owner !== t && !areAllies(h.owner, t)));
    // nearest contact (novice picks a random one)
    let target;
    if (this.tank.type === 'novice') target = Utils.choice(contacts);
    else {
      contacts.sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x));
      target = contacts[0];
    }

    const p = this.profile;
    const useWind = p.wind === 'sim';
    const def = ItemCatalog.weapon(t.selectedWeapon);
    // (the MASER shell is ballistic like everything else, so the sweep below
    // covers it — the orbital strike lands wherever the marker shell does)

    // --- coarse grid sweep ---
    let best = { err: 1e9, angle: 60, power: 60 };
    const evaluate = (angle, power) => {
      angle = Utils.clamp(angle, 3, 177);
      power = Utils.clamp(power, 12, 100);
      const hit = game.simulateShot(t, angle, power, useWind, def);
      if (!hit) return;
      // ignore solutions that land on our own head
      if (Utils.dist(hit.x, hit.y, t.x, t.y) < 55) return;
      const err = Utils.dist(hit.x, hit.y, target.x, target.y - 8);
      if (err < best.err) best = { err, angle, power };
    };

    for (let a = 12; a <= 168; a += 6) {
      for (let pw = 22; pw <= 100; pw += 12) evaluate(a, pw);
    }
    // --- fine sweeps ---
    if (p.refine >= 1) {
      const b1 = { ...best };
      for (let a = b1.angle - 6; a <= b1.angle + 6; a += 1.5) {
        for (let pw = b1.power - 10; pw <= b1.power + 10; pw += 2.5) evaluate(a, pw);
      }
    }
    if (p.refine >= 2) {
      const b2 = { ...best };
      for (let a = b2.angle - 1.5; a <= b2.angle + 1.5; a += 0.35) {
        for (let pw = b2.power - 2.5; pw <= b2.power + 2.5; pw += 0.7) evaluate(a, pw);
      }
    }

    let angle = best.angle, power = best.power;

    // amateur: heuristic power correction for wind drift
    if (p.wind === 'power') {
      const downwind = Math.sign(target.x - t.x) === Math.sign(game.wind);
      const mag = Math.abs(game.wind) * 0.9;
      power += downwind ? -mag : mag;
    }

    // fried fire-control: EMP'd bots aim like novices this turn
    const empErr = t.emp > 0 ? 8 : 0;
    angle += Utils.rand(-p.errAngle - empErr, p.errAngle + empErr);
    power += Utils.rand(-p.errPower - empErr, p.errPower + empErr);
    this.targetAngle = Utils.clamp(angle, 2, 178);
    this.targetPower = Utils.clamp(power, 10, 100);
  }
}

/* ===== Bot shopping (respects level gates & funds) ===== */

function botShop(tank, game) {
  const lvl = tank.level;
  const affordable = it => it.price <= tank.cash && (tank.gatesOff || it.level <= lvl) && (it.maxQty === undefined || tank.ammo(it.id) < it.maxQty);
  const buyW = it => { tank.cash -= it.price; tank.inventory[it.id] = (tank.inventory[it.id] || 0) + it.qty; };
  const buyU = it => { tank.cash -= it.price; tank.upgrades[it.id] = true; };

  const profile = (AI_PROFILES[tank.type] || AI_PROFILES.novice).shop;

  if (profile === 'cheap') {
    // novice: a few random cheap armaments
    for (let i = 0; i < 3; i++) {
      const opts = WEAPONS.filter(w => w.price > 0 && w.price <= 3000 && affordable(w));
      if (!opts.length) break;
      buyW(Utils.choice(opts));
    }
    return;
  }

  if (profile === 'standard') {
    // amateur: a shield, then standard mid-range weapons
    const sh = ItemCatalog.byId.shield;
    if (tank.ammo('shield') < 1 && affordable(sh)) buyW(sh);
    for (let i = 0; i < 3; i++) {
      const opts = WEAPONS.filter(w => w.price >= 1500 && w.price <= 5000 && (w.dmg || 0) > 0 && affordable(w));
      if (!opts.length) break;
      buyW(Utils.choice(opts));
    }
    const pc = ItemCatalog.byId.parachute;
    if (tank.ammo('parachute') < 1 && affordable(pc)) buyW(pc);
    return;
  }

  if (profile === 'pro') {
    // professional: rangefinders/target computers first, then high tier weapons
    for (const id of ['targetcomp', 'reticle', 'weather']) {
      const up = ItemCatalog.byId[id];
      if (!tank.hasUpgrade(id) && affordable(up)) buyU(up);
    }
    const sh = ItemCatalog.byId.shield;
    if (tank.ammo('shield') < 1 && affordable(sh)) buyW(sh);
    if ((tank.gatesOff || lvl >= 2) && !tank.predeployShield && tank.cash >= 5500 && Math.random() < 0.5) {
      tank.cash -= ItemCatalog.byId.predeploy.price;
      tank.predeployShield = true;
    }
    const tiers = [...WEAPONS].filter(w => (w.dmg || 0) > 0 && w.price > 0).sort((a, b) => b.price - a.price);
    for (const w of tiers) {
      if (affordable(w) && tank.cash - w.price >= 2000) { buyW(w); if (Math.random() < 0.5) break; }
    }
    const pc = ItemCatalog.byId.parachute;
    if (tank.ammo('parachute') < 1 && affordable(pc)) buyW(pc);
    return;
  }

  // John Wick: max passive upgrades, shield reserves, heavy armaments
  for (const up of ItemCatalog.upgradesSorted()) {
    if (!tank.hasUpgrade(up.id) && affordable(up)) buyU(up);
  }
  const sh = ItemCatalog.byId.shield;
  while (tank.ammo('shield') < 2 && affordable(sh)) buyW(sh);
  const bat = ItemCatalog.byId.battery;
  if (tank.ammo('battery') < 1 && affordable(bat)) buyW(bat);
  if ((tank.gatesOff || lvl >= 2) && !tank.predeployShield && tank.cash >= ItemCatalog.byId.predeploy.price) {
    tank.cash -= ItemCatalog.byId.predeploy.price;
    tank.predeployShield = true;
  }
  const pc = ItemCatalog.byId.parachute;
  while (tank.ammo('parachute') < 2 && affordable(pc)) buyW(pc);
  // heavy weapons: nuclear, singularity, orbital
  const heavy = ['neutron', 'thermo', 'meteor', 'singularity', 'carpet', 'kinetic', 'emp', 'laser', 'railgun', 'napalmmirv', 'mirv', 'tacnuke', 'napalm', 'babynuke'];
  let spent = true;
  while (spent) {
    spent = false;
    for (const id of heavy) {
      const w = ItemCatalog.byId[id];
      if (affordable(w) && tank.ammo(id) < 2) { buyW(w); spent = true; }
    }
  }
}
