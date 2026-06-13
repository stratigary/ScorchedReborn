'use strict';
/* ===== Intermission shop: tabs, level gates, purchases, pre-deploy shield ===== */

class ShopUI {
  constructor() {
    this.el = document.getElementById('shop');
    this.elPlayer = document.getElementById('shop-player');
    this.elCash = document.getElementById('shop-cash');
    this.elLevel = document.getElementById('shop-level');
    this.elXpFill = document.getElementById('shop-xpfill');
    this.elRound = document.getElementById('shop-round');
    this.elItems = document.getElementById('shop-items');
    this.elStandings = document.getElementById('shop-standings');
    this.btnDone = document.getElementById('btn-shop-done');
    this.tabs = Array.from(this.el.querySelectorAll('.tab'));

    this.game = null;
    this.queue = [];
    this.shopper = null;
    this.activeTab = 'weapons';
    this.onDone = null;

    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.tabs.forEach(t => t.classList.toggle('active', t === tab));
        AudioEngine.click();
        this.renderItems();
      });
    }
    this.btnDone.addEventListener('click', () => this.nextShopper());
  }

  open(game, onDone) {
    this.game = game;
    this.onDone = onDone;
    this.queue = game.tanks.filter(t => !t.isBot);
    if (!this.queue.length) { onDone(); return; }
    this.el.classList.remove('hidden');
    this.shopper = null;
    this.nextShopper();
  }

  nextShopper() {
    if (this.shopper) AudioEngine.click();
    this.shopper = this.queue.shift() || null;
    if (!this.shopper) {
      this.el.classList.add('hidden');
      const done = this.onDone;
      this.onDone = null;
      if (done) done();
      return;
    }
    this.activeTab = 'weapons';
    this.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'weapons'));
    this.renderHeader();
    this.renderItems();
    this.renderStandings();
    this.btnDone.textContent = this.queue.length ? 'DONE — NEXT PLAYER ▸' : 'START ROUND ▸';
  }

  renderHeader() {
    const t = this.shopper;
    this.elPlayer.textContent = `${t.name} — ARMORY`;
    this.elPlayer.style.color = t.color;
    this.elCash.textContent = Utils.money(t.cash);
    this.elLevel.textContent = `Lv ${t.level}${t.level >= MAX_LEVEL ? ' (MAX)' : ''}`;
    this.elXpFill.style.width = `${Math.round(t.xpProgress() * 100)}%`;
    const next = this.game.upcomingRound();
    this.elRound.textContent = `Next: Round ${next} — ${themeForRound(next).name}`;
  }

  renderStandings() {
    const rows = [...this.game.tanks].sort((a, b) => b.score - a.score)
      .map(t => `<div><span class="st-name" style="color:${t.color}">${t.name}</span>` +
        `<span class="st-score">◆ ${t.score}</span> &nbsp; Lv${t.level}</div>`);
    this.elStandings.innerHTML = rows.join('');
  }

  renderItems() {
    const t = this.shopper;
    this.elItems.innerHTML = '';
    let list, kind;
    switch (this.activeTab) {
      case 'weapons':   list = ItemCatalog.weaponsSorted();   kind = 'weapon';  break;
      case 'utilities': list = ItemCatalog.utilitiesSorted(); kind = 'utility'; break;
      case 'upgrades':  list = ItemCatalog.upgradesSorted();  kind = 'upgrade'; break;
      default:          list = ItemCatalog.skinsSorted();     kind = 'skin';    break;
    }

    for (const item of list) {
      const locked = item.level > t.level;
      const row = document.createElement('div');
      row.className = 'shop-item' + (locked ? ' locked' : '');

      const qtyText = (() => {
        if (kind === 'weapon' || (kind === 'utility' && !item.checkbox)) {
          const a = t.ammo(item.id);
          return a === Infinity ? '∞' : (a > 0 ? `x${a}` : '');
        }
        return '';
      })();

      row.innerHTML =
        `<span class="item-name">${item.name}</span>` +
        `<span class="item-desc">${item.desc || ''}</span>` +
        `<span class="item-qty">${qtyText}</span>` +
        (locked ? `<span class="lock-tag">🔒 Lv${item.level}</span>` : '<span class="lock-tag"></span>') +
        `<span class="item-price">${item.price ? Utils.money(item.price) : 'FREE'}</span>`;

      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      this._configureButton(btn, item, kind, t, locked);
      row.appendChild(btn);
      this.elItems.appendChild(row);
    }
  }

  _configureButton(btn, item, kind, t, locked) {
    btn.disabled = locked;

    if (kind === 'weapon') {
      if (item.unlimited) { btn.textContent = 'OWNED'; btn.disabled = true; btn.classList.add('owned'); return; }
      btn.textContent = `BUY ${item.qty}`;
      btn.disabled = locked || t.cash < item.price;
      btn.onclick = () => this._purchase(() => {
        t.cash -= item.price;
        t.inventory[item.id] = (t.inventory[item.id] || 0) + item.qty;
      });
      return;
    }

    if (kind === 'utility') {
      if (item.checkbox) {
        // Pre-deploy shield toggle (buy / refund)
        btn.textContent = t.predeployShield ? '✔ ARMED' : 'ARM';
        if (t.predeployShield) btn.classList.add('owned');
        btn.disabled = locked || (!t.predeployShield && t.cash < item.price);
        btn.onclick = () => this._purchase(() => {
          if (t.predeployShield) { t.predeployShield = false; t.cash += item.price; }
          else { t.predeployShield = true; t.cash -= item.price; }
        });
        return;
      }
      btn.textContent = `BUY ${item.qty}`;
      btn.disabled = locked || t.cash < item.price;
      btn.onclick = () => this._purchase(() => {
        t.cash -= item.price;
        t.inventory[item.id] = (t.inventory[item.id] || 0) + item.qty;
      });
      return;
    }

    if (kind === 'upgrade') {
      if (t.hasUpgrade(item.id)) {
        btn.textContent = 'OWNED'; btn.disabled = true; btn.classList.add('owned');
        return;
      }
      btn.textContent = 'BUY';
      btn.disabled = locked || t.cash < item.price;
      btn.onclick = () => this._purchase(() => {
        t.cash -= item.price;
        t.upgrades[item.id] = true;
      });
      return;
    }

    // skins
    const owned = t.ownedSkins.includes(item.id);
    if (t.skin === item.id) {
      btn.textContent = 'EQUIPPED'; btn.disabled = true; btn.classList.add('owned');
    } else if (owned) {
      btn.textContent = 'EQUIP';
      btn.onclick = () => this._purchase(() => { t.skin = item.id; }, true);
    } else {
      btn.textContent = 'BUY';
      btn.disabled = locked || t.cash < item.price;
      btn.onclick = () => this._purchase(() => {
        t.cash -= item.price;
        t.ownedSkins.push(item.id);
        t.skin = item.id;
      });
    }
  }

  _purchase(apply, quiet) {
    apply();
    if (!quiet) AudioEngine.purchase(); else AudioEngine.click();
    SaveSystem.saveMatch(this.game);
    this.renderHeader();
    this.renderItems();
  }
}
