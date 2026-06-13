'use strict';
/* ===== localStorage persistence: match save/resume + player XP profiles ===== */

const SaveSystem = {
  SAVE_KEY: 'scorched_reborn_save_v1',
  PROFILE_KEY: 'scorched_reborn_profiles_v1',

  _get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  _set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full / blocked */ }
  },

  hasSave() { return !!this._get(this.SAVE_KEY); },

  saveMatch(game) {
    // no terrain yet during the pre-round-1 shop — nothing worth saving
    if (!game || !game.terrain || game.phase === 'over') return;
    const data = {
      version: 1,
      settings: game.settings,
      round: game.round,
      totalRounds: game.totalRounds,
      turnIdx: game.turnIdx,
      wind: game.wind,
      players: game.tanks.map(t => t.serialize()),
      terrain: game.terrain.serialize(),
      savedAt: Date.now(),
    };
    this._set(this.SAVE_KEY, data);
  },

  loadMatch() { return this._get(this.SAVE_KEY); },

  clearMatch() {
    try { localStorage.removeItem(this.SAVE_KEY); } catch (e) { /* ignore */ }
  },

  /* --- persistent XP profiles (carry levels across matches) --- */

  getProfile(name) {
    const all = this._get(this.PROFILE_KEY) || {};
    return all[name] || null;
  },

  saveProfile(name, xp) {
    const all = this._get(this.PROFILE_KEY) || {};
    all[name] = { xp, level: levelForXP(xp), updated: Date.now() };
    this._set(this.PROFILE_KEY, all);
  },
};
