// =======================================================================
// Gun Arena ブラウザ版 - HUD
//
// 使い方:
//   const hud = new Hud(document.getElementById('hud'));
//   毎フレーム hud.update(state) を呼ぶだけ。
//
// 方針:
//   ・DOM の組み立てはすべてコンストラクタの中で行います。
//     読み込み（import）した時点では document には一切触りません。
//   ・update() は 1 秒に 60 回走るので、値が変わったときだけ DOM に書きます。
//     そのために前回の値を this._p に取っておきます。
//   ・時間で動くもの（ヒットマーカー・キルフィード・ダメージ数字など）は
//     CSS のアニメーションと setTimeout に任せ、update() では扱いません。
// =======================================================================

import { LOADOUT_CHOICES, WEAPONS, COLORS } from './config.js';

// -----------------------------------------------------------------------
// 小さな道具
// -----------------------------------------------------------------------

/** 要素を作って親にぶら下げる */
function mk(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 数値かどうか怪しい値を安全に数値にする */
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** '#rrggbb' を 2 つ混ぜる。t=0 で a、t=1 で b */
function mixHex(a, b, t) {
  const k = clamp(t, 0, 1);
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const r = Math.round(((ai >> 16) & 255) + (((bi >> 16) & 255) - ((ai >> 16) & 255)) * k);
  const g = Math.round(((ai >> 8) & 255) + (((bi >> 8) & 255) - ((ai >> 8) & 255)) * k);
  const bl = Math.round((ai & 255) + ((bi & 255) - (ai & 255)) * k);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** チーム名から色を引く */
function teamColor(team) {
  if (team === 'red') return COLORS.red;
  if (team === 'blue') return COLORS.blue;
  return '#8a909c';
}

// 投げ物の表示名とキー。config の GRENADES と同じ内容を表示用に持っています。
const NADE_INFO = {
  Frag: { key: 'G', label: 'グレネード' },
  Flash: { key: 'F', label: 'フラッシュ' },
};

// 装備選択パネルの列見出し
const CATEGORY_LABEL = {
  primary: 'プライマリ',
  secondary: 'セカンダリ',
  melee: '近接',
};

const HINT_TEXT =
  '左クリック:射撃  右クリック:構える  R:リロード  Shift:走る  Ctrl:スライド  ' +
  '1/2/3:武器  G:グレネード  F:フラッシュ  L:装備  O:設定  Tab:スコア';

// 武器 1 つぶんの説明文を作る
function weaponStatLine(key) {
  const w = WEAPONS[key];
  if (!w) return '';
  const rate = num(w.rate, 0);
  if (w.melee) {
    return 'ダメージ ' + num(w.damage, 0) + ' / 連射 ' + rate.toFixed(1) + ' / 射程 ' + num(w.range, 0);
  }
  return 'ダメージ ' + num(w.damage, 0) + ' / 連射 ' + rate.toFixed(1) + ' / 装弾 ' + num(w.mag, 0);
}

// =======================================================================
// 本体
// =======================================================================

export class Hud {
  /** @param {HTMLElement} root 空の <div id="hud"> */
  constructor(root) {
    this.root = root;
    this.root.classList.add('hud-root');

    // ホスト側が差し込むコールバック
    this.onLoadoutPick = null;
    this.onSensitivity = null;
    this.onFov = null;

    // 前回の値。update() で「変わったときだけ書く」ために使います。
    this._p = {};

    // クロスヘアの開き具合。目標値へ毎フレーム 0.25 ずつ近づけます。
    this._gap = 6;
    this._gapWritten = -1;

    // タイマーの控え
    this._hitT = 0;
    this._flashT = 0;
    this._announceT = 0;

    // パネルの開閉状態
    this._boardOpen = false;
    this._loadoutOpen = false;
    this._settingsOpen = false;

    // いま選んでいる武器（装備選択パネルの見た目用）
    this._picked = {
      primary: (LOADOUT_CHOICES.primary || [])[0] || null,
      secondary: (LOADOUT_CHOICES.secondary || [])[0] || null,
      melee: (LOADOUT_CHOICES.melee || [])[0] || null,
    };

    this._buildOverlays();
    this._buildCrosshair();
    this._buildCenterEffects();
    this._buildHealthCluster();
    this._buildAmmoCluster();
    this._buildTopCenter();
    this._buildTopRight();
    this._buildScoreboard();
    this._buildLoadout();
    this._buildSettings();
    this._buildHint();

    // フラッシュバンは一番手前に置きたいので最後に作ります。
    this.flashEl = mk('div', 'h-flash', this.root);
  }

  // ---------------------------------------------------------------------
  // 組み立て
  // ---------------------------------------------------------------------

  /** 視界のふち・低体力の赤み・スコープ */
  _buildOverlays() {
    this.vignette = mk('div', 'h-vignette', this.root);
    this.danger = mk('div', 'h-danger', this.root);

    // スナイパースコープ。穴あきマスクは CSS の radial-gradient 1 枚。
    this.scope = mk('div', 'h-scope', this.root);
    mk('div', 'h-scope-mask', this.scope);

    // 十字の線。中心には隙間をあけたいので上下左右で 4 本に分けます。
    const gap = 14;   // 中心の空き（px）
    const R = '43vmin';
    const mkLine = (style) => {
      const e = mk('div', 'h-scope-line', this.scope);
      Object.assign(e.style, style);
      return e;
    };
    // 縦（上・下）
    mkLine({ left: '50%', marginLeft: '-0.5px', width: '1px', top: 'calc(50% - ' + R + ')', height: 'calc(' + R + ' - ' + gap + 'px)' });
    mkLine({ left: '50%', marginLeft: '-0.5px', width: '1px', top: 'calc(50% + ' + gap + 'px)', height: 'calc(' + R + ' - ' + gap + 'px)' });
    // 横（左・右）
    mkLine({ top: '50%', marginTop: '-0.5px', height: '1px', left: 'calc(50% - ' + R + ')', width: 'calc(' + R + ' - ' + gap + 'px)' });
    mkLine({ top: '50%', marginTop: '-0.5px', height: '1px', left: 'calc(50% + ' + gap + 'px)', width: 'calc(' + R + ' - ' + gap + 'px)' });

    // ミルドット。半径の 0.3 / 0.5 / 0.7 の位置に短い目盛りを置きます。
    for (const f of [0.3, 0.5, 0.7]) {
      const d = (43 * f).toFixed(2) + 'vmin';
      // 縦線の上下
      for (const sign of ['-', '+']) {
        const e = mk('div', 'h-scope-tick', this.scope);
        Object.assign(e.style, {
          left: '50%', marginLeft: '-3px', width: '7px', height: '2px',
          top: 'calc(50% ' + sign + ' ' + d + ')',
        });
      }
      // 横線の左右
      for (const sign of ['-', '+']) {
        const e = mk('div', 'h-scope-tick', this.scope);
        Object.assign(e.style, {
          top: '50%', marginTop: '-3px', height: '7px', width: '2px',
          left: 'calc(50% ' + sign + ' ' + d + ')',
        });
      }
    }
    mk('div', 'h-scope-dot', this.scope);
  }

  /** クロスヘア（中心の点と 4 本のヒゲ） */
  _buildCrosshair() {
    this.cross = mk('div', 'h-cross', this.root);
    mk('div', 'h-cross-dot', this.cross);
    this.tickUp = mk('div', 'h-cross-tick v', this.cross);
    this.tickDown = mk('div', 'h-cross-tick v', this.cross);
    this.tickLeft = mk('div', 'h-cross-tick h', this.cross);
    this.tickRight = mk('div', 'h-cross-tick h', this.cross);
    this._writeGap(this._gap);
  }

  /** ヒットマーカーとダメージ数字の置き場 */
  _buildCenterEffects() {
    this.hit = mk('div', 'h-hit', this.root);
    // 4 本の棒を 45 度きざみに、中心から 12px（キル時は 16px）離して置く
    for (const deg of [45, 135, 225, 315]) {
      const bar = mk('div', 'h-hit-bar', this.hit);
      bar.style.transform = 'rotate(' + deg + 'deg) translateX(var(--r))';
    }
    this.dmgLayer = mk('div', 'h-layer', this.root);
  }

  /** 左下：体力・スライド・投げ物 */
  _buildHealthCluster() {
    const box = mk('div', 'h-left', this.root);
    this.hpNum = mk('div', 'h-hp-num', box, '0');
    const hpBar = mk('div', 'h-hp-bar', box);
    this.hpFill = mk('div', 'h-hp-fill', hpBar);
    mk('div', 'h-slide-label', box, 'SLIDE');
    const slBar = mk('div', 'h-slide-bar', box);
    this.slideFill = mk('div', 'h-slide-fill', slBar);
    this.nades = mk('div', 'h-nades', box);
    // 中身（各投げ物の行）は最初に見た顔ぶれで作り、以後は文字だけ更新します。
    this._nadeEls = null;
  }

  /** 右下：武器名・残弾・スロット */
  _buildAmmoCluster() {
    const box = mk('div', 'h-right', this.root);
    this.wName = mk('div', 'h-wname', box, '');
    this.ammoEl = mk('div', 'h-ammo', box, '0 / 0');
    this.reloadEl = mk('div', 'h-reload', box, '');
    const slots = mk('div', 'h-slots', box);
    this.slotEls = [1, 2, 3].map((n) => mk('div', 'h-slot', slots, String(n)));
  }

  /** 上中央：スコア・フェーズ・参加者タイル・カウントダウン・アナウンス */
  _buildTopCenter() {
    this.scoreEl = mk('div', 'h-score', this.root, 'RED 0 - 0 BLUE');
    this.phaseEl = mk('div', 'h-phase', this.root, '');
    this.rosterEl = mk('div', 'h-roster', this.root);
    this.countEl = mk('div', 'h-count', this.root, '');
    this.announceEl = mk('div', 'h-announce', this.root, '');
  }

  /** 右上：歯車ボタンとキルフィード */
  _buildTopRight() {
    const wrap = mk('div', 'h-gear-wrap', this.root);
    this.gear = mk('button', 'h-gear', wrap, '⚙');
    this.gear.type = 'button';
    this.gear.title = '設定 (O)';
    this.gear.addEventListener('click', () => this.setSettingsOpen(!this._settingsOpen));
    mk('div', 'h-gear-hint', wrap, 'O');

    this.feed = mk('div', 'h-feed', this.root);
  }

  /** スコアボード（Tab） */
  _buildScoreboard() {
    this.board = mk('div', 'h-panel', this.root);
    const panel = mk('div', 'h-board', this.board);
    mk('div', 'h-board-title', panel, 'スコアボード');
    const head = mk('div', 'h-board-row head', panel);
    mk('div', 'h-board-c1', head, 'プレイヤー');
    mk('div', 'h-board-c2', head, 'キル');
    mk('div', 'h-board-c3', head, 'デス');
    this.boardRows = mk('div', 'h-board-scroll', panel);
    this._boardSig = null;
  }

  /** 装備選択（L） */
  _buildLoadout() {
    this.loadout = mk('div', 'h-panel', this.root);
    const panel = mk('div', 'h-loadout', this.loadout);
    mk('div', 'h-loadout-title', panel, '装備を選ぶ');
    const close = mk('button', 'h-close', panel, '✕');
    close.type = 'button';
    close.addEventListener('click', () => this.setLoadoutOpen(false));

    const cols = mk('div', 'h-lo-cols', panel);
    this._loCards = { primary: {}, secondary: {}, melee: {} };

    for (const cat of ['primary', 'secondary', 'melee']) {
      const col = mk('div', 'h-lo-col', cols);
      mk('div', 'h-lo-head', col, CATEGORY_LABEL[cat]);
      const list = LOADOUT_CHOICES[cat] || [];
      for (const key of list) {
        const w = WEAPONS[key] || {};
        const card = mk('button', 'h-lo-card', col);
        card.type = 'button';
        mk('div', 'h-lo-name', card, w.display || key);
        mk('div', 'h-lo-stat', card, weaponStatLine(key));
        card.addEventListener('click', () => this._pick(cat, key));
        this._loCards[cat][key] = card;
      }
      this._paintPicked(cat);
    }
  }

  /** 設定（O / 歯車） */
  _buildSettings() {
    this.settings = mk('div', 'h-panel', this.root);
    const panel = mk('div', 'h-settings', this.settings);
    mk('div', 'h-set-title', panel, '設定');
    const close = mk('button', 'h-close', panel, '✕');
    close.type = 'button';
    close.addEventListener('click', () => this.setSettingsOpen(false));

    // 共通のスライダー 1 行分を作るヘルパ
    const row = (label, min, max, step, value, digits, onChange) => {
      const r = mk('div', 'h-set-row', panel);
      const lab = mk('div', 'h-set-label', r);
      mk('span', null, lab, label);
      const val = mk('span', 'h-set-val', lab, value.toFixed(digits));
      const input = mk('input', 'h-slider', r);
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = v.toFixed(digits);
        if (onChange) onChange(v);
      });
      return input;
    };

    this.sensInput = row('マウス感度', 0.2, 3.0, 0.05, 1.0, 2, (v) => {
      if (this.onSensitivity) this.onSensitivity(v);
    });
    this.fovInput = row('視野角', 60, 110, 1, 80, 0, (v) => {
      if (this.onFov) this.onFov(v);
    });
  }

  /** 下の操作ヒント。25 秒たったら 1.5 秒かけて消えます。 */
  _buildHint() {
    this.hint = mk('div', 'h-hint', this.root, HINT_TEXT);
    this._hintT = setTimeout(() => this.hint.classList.add('out'), 25000);
  }

  // ---------------------------------------------------------------------
  // 毎フレームの更新
  // ---------------------------------------------------------------------

  update(s) {
    if (!s) return;
    const p = this._p;

    // --- 体力 ---------------------------------------------------------
    const maxHp = Math.max(1, num(s.maxHealth, 100));
    const hp = clamp(num(s.health, 0), 0, maxHp);
    const ratio = hp / maxHp;
    const hpText = String(Math.max(0, Math.round(hp)));
    if (hpText !== p.hpText) {
      this.hpNum.textContent = hpText;
      p.hpText = hpText;
    }
    const hpCol = mixHex(COLORS.healthLow, COLORS.healthHigh, ratio);
    if (hpCol !== p.hpCol) {
      this.hpNum.style.color = hpCol;
      this.hpFill.style.background = hpCol;
      p.hpCol = hpCol;
    }
    const hpW = (ratio * 100).toFixed(1) + '%';
    if (hpW !== p.hpW) {
      this.hpFill.style.width = hpW;
      p.hpW = hpW;
    }

    // 低体力の赤み。体力比 0.4 から 0 に向かって 0→1 に強まります。
    const danger = clamp((0.4 - ratio) / 0.4, 0, 1);
    const dOp = (danger * 0.28).toFixed(3);
    if (dOp !== p.dOp) {
      this.danger.style.opacity = dOp;
      p.dOp = dOp;
    }

    // --- スライド -----------------------------------------------------
    const slide = clamp(num(s.slideReady, 0), 0, 1);
    const slW = (slide * 100).toFixed(1) + '%';
    if (slW !== p.slW) {
      this.slideFill.style.width = slW;
      p.slW = slW;
    }
    const slCol = slide >= 1 ? COLORS.slideCyan : COLORS.slideCharge;
    if (slCol !== p.slCol) {
      this.slideFill.style.background = slCol;
      p.slCol = slCol;
    }

    // --- 投げ物 -------------------------------------------------------
    this._updateNades(s.grenades);

    // --- 武器と弾 -----------------------------------------------------
    const wname = typeof s.weaponName === 'string' ? s.weaponName : '';
    if (wname !== p.wname) {
      this.wName.textContent = wname;
      p.wname = wname;
    }

    const ammo = num(s.ammo, 0);
    const reserve = num(s.reserve, 0);
    const melee = ammo < 0 || reserve < 0;
    const ammoText = melee ? '∞' : ammo + ' / ' + reserve;
    if (ammoText !== p.ammoText) {
      this.ammoEl.textContent = ammoText;
      p.ammoText = ammoText;
    }
    const dry = !melee && ammo === 0;
    if (dry !== p.dry) {
      this.ammoEl.classList.toggle('dry', dry);
      p.dry = dry;
    }

    let hint = '';
    if (s.reloading) hint = 'リロード中...';
    else if (!melee && ammo === 0 && reserve > 0) hint = 'R でリロード';
    else if (!melee && ammo === 0 && reserve === 0) hint = '弾切れ';
    if (hint !== p.hint) {
      this.reloadEl.textContent = hint;
      p.hint = hint;
    }

    const slot = num(s.slot, 1);
    if (slot !== p.slot) {
      for (let i = 0; i < 3; i++) this.slotEls[i].classList.toggle('active', i + 1 === slot);
      p.slot = slot;
    }

    // --- スコアとフェーズ ---------------------------------------------
    const scoreText = 'RED ' + num(s.redScore, 0) + ' - ' + num(s.blueScore, 0) + ' BLUE';
    if (scoreText !== p.scoreText) {
      this.scoreEl.textContent = scoreText;
      p.scoreText = scoreText;
    }
    const phase = typeof s.phase === 'string' ? s.phase : '';
    if (phase !== p.phase) {
      this.phaseEl.textContent = phase;
      this.phaseEl.style.display = phase ? '' : 'none';
      p.phase = phase;
    }

    // --- 参加者タイル ---------------------------------------------------
    this._updateRoster(s.roster);

    // --- カウントダウン -------------------------------------------------
    const cd = num(s.countdown, 0);
    if (cd !== p.cd) {
      if (cd > 0) {
        this.countEl.textContent = String(cd);
        this.countEl.classList.add('on');
        // 数字が変わるたびに大きさをはずませる（アニメを掛け直す）
        this.countEl.classList.remove('punch');
        void this.countEl.offsetWidth;
        this.countEl.classList.add('punch');
      } else {
        this.countEl.classList.remove('on', 'punch');
      }
      p.cd = cd;
    }

    // --- 構え・死亡 -----------------------------------------------------
    const aiming = !!s.aiming;
    if (aiming !== p.aiming) {
      this.root.classList.toggle('aiming', aiming);
      p.aiming = aiming;
    }
    const dead = !!s.dead;
    if (dead !== p.dead) {
      this.root.classList.toggle('is-dead', dead);
      p.dead = dead;
    }

    // --- クロスヘアの開き ------------------------------------------------
    const target = 5 + num(s.spreadDeg, 0) * 6;
    this._gap += (target - this._gap) * 0.25;
    if (Math.abs(this._gap - this._gapWritten) >= 0.1) this._writeGap(this._gap);

    // --- スコアボードの中身（開いているときだけ作り直す） -------------------
    if (this._boardOpen) this._updateBoard(s.scoreboard);
  }

  /** ヒゲの位置を書く */
  _writeGap(g) {
    const v = Math.max(0, g);
    this.tickUp.style.transform = 'translateY(' + (-v - 5).toFixed(1) + 'px)';
    this.tickDown.style.transform = 'translateY(' + (v + 5).toFixed(1) + 'px)';
    this.tickLeft.style.transform = 'translateX(' + (-v - 5).toFixed(1) + 'px)';
    this.tickRight.style.transform = 'translateX(' + (v + 5).toFixed(1) + 'px)';
    this._gapWritten = v;
  }

  /** 投げ物の残り数 */
  _updateNades(grenades) {
    const g = grenades && typeof grenades === 'object' ? grenades : {};
    const keys = Object.keys(g);
    const sig = keys.join(',');
    if (!this._nadeEls || sig !== this._nadeSig) {
      this.nades.textContent = '';
      this._nadeEls = {};
      for (const k of keys) {
        const info = NADE_INFO[k] || { key: '?', label: k };
        const e = mk('div', 'h-nade', this.nades, '');
        e.dataset.prefix = '[' + info.key + '] ' + info.label + ' x';
        this._nadeEls[k] = e;
      }
      this._nadeSig = sig;
      this._nadeCounts = {};
    }
    for (const k of keys) {
      const e = this._nadeEls[k];
      if (!e) continue;
      const n = Math.max(0, num(g[k], 0));
      if (this._nadeCounts[k] !== n) {
        e.textContent = e.dataset.prefix + n;
        e.classList.toggle('empty', n === 0);
        this._nadeCounts[k] = n;
      }
    }
  }

  /** 参加者タイル。顔ぶれ・生死・自分が変わったときだけ作り直します。 */
  _updateRoster(roster) {
    const list = Array.isArray(roster) ? roster : [];
    let sig = '';
    for (const r of list) {
      sig += (r && r.name) + '|' + (r && r.team) + '|' + (r && r.alive ? 1 : 0) + '|' + (r && r.self ? 1 : 0) + ';';
    }
    if (sig === this._rosterSig) return;
    this._rosterSig = sig;

    this.rosterEl.textContent = '';
    for (const r of list) {
      if (!r) continue;
      const tile = mk('div', 'h-tile', this.rosterEl);
      tile.style.borderColor = teamColor(r.team);
      if (!r.alive) tile.classList.add('dead');
      if (r.self) tile.classList.add('self');
      mk('div', 'h-tile-name', tile, r.name == null ? '' : String(r.name));
      mk('div', 'h-tile-dead', tile, '✕');
      mk('div', 'h-tile-self', tile);
    }
  }

  /** スコアボードの行。中身が変わったときだけ作り直します。 */
  _updateBoard(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let sig = '';
    for (const r of list) {
      sig += (r && r.name) + '|' + (r && r.team) + '|' + (r && r.kills) + '|' + (r && r.deaths) + ';';
    }
    if (sig === this._boardSig) return;
    this._boardSig = sig;

    this.boardRows.textContent = '';
    let i = 0;
    for (const r of list) {
      if (!r) continue;
      const row = mk('div', 'h-board-row' + (i % 2 ? ' odd' : ''), this.boardRows);
      const c1 = mk('div', 'h-board-c1', row, r.name == null ? '' : String(r.name));
      c1.style.color = teamColor(r.team);
      mk('div', 'h-board-c2', row, String(num(r.kills, 0)));
      mk('div', 'h-board-c3', row, String(num(r.deaths, 0)));
      i++;
    }
  }

  // ---------------------------------------------------------------------
  // ホストから呼ばれる演出
  // ---------------------------------------------------------------------

  /** ヒットマーカーを光らせる。キルなら赤く大きく。 */
  hitMarker(isKill) {
    const kill = !!isKill;
    this.hit.classList.toggle('kill', kill);
    this.hit.classList.add('on');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => {
      this.hit.classList.remove('on', 'kill');
    }, kill ? 300 : 150);
  }

  /** 中心のあたりにダメージ数字を出す。上へ流れて消えます。 */
  damageNumber(n, head) {
    const e = mk('div', 'h-dmg' + (head ? ' head' : ''), this.dmgLayer, String(Math.round(num(n, 0))));
    const ox = -60 + Math.random() * 120;   // 横 -60〜60
    const oy = -30 + Math.random() * 40;    // 縦 -30〜10
    e.style.marginLeft = ox.toFixed(1) + 'px';
    e.style.marginTop = oy.toFixed(1) + 'px';
    e.addEventListener('animationend', () => e.remove());
    // 万一 animationend が来なくても溜め込まないように、古いものは捨てる
    while (this.dmgLayer.childElementCount > 24) this.dmgLayer.firstElementChild.remove();
  }

  /** キルフィードに 1 行足す。最大 5 行、6 秒で消えます。 */
  killFeed(text, color) {
    const line = mk('div', 'h-feed-line', null, text == null ? '' : String(text));
    if (color) line.style.color = color;
    this.feed.insertBefore(line, this.feed.firstChild);   // 新しいものが一番上
    while (this.feed.childElementCount > 5) this.feed.lastElementChild.remove();
    setTimeout(() => {
      line.classList.add('out');
      setTimeout(() => line.remove(), 600);
    }, 6000);
  }

  /** 画面上寄りに大きな文字を出す */
  announce(text, secs) {
    this.announceEl.textContent = text == null ? '' : String(text);
    this.announceEl.classList.add('on');
    clearTimeout(this._announceT);
    this._announceT = setTimeout(() => {
      this.announceEl.classList.remove('on');
    }, Math.max(0.1, num(secs, 2)) * 1000);
  }

  /** フラッシュバン。ぱっと白くなり、時間の 55% はそのまま、残りで薄れます。 */
  flash(intensity, secs) {
    const i = clamp(num(intensity, 1), 0, 1);
    const d = Math.max(0.05, num(secs, 1));
    const hold = d * 0.55;
    const fade = Math.max(0.05, d - hold);
    const e = this.flashEl;
    clearTimeout(this._flashT);
    e.style.transition = 'none';
    e.style.opacity = String(i);
    void e.offsetWidth;   // 直前の指定をブラウザに反映させてから薄め始める
    this._flashT = setTimeout(() => {
      e.style.transition = 'opacity ' + fade.toFixed(3) + 's linear';
      e.style.opacity = '0';
    }, hold * 1000);
  }

  /** スコープの出し入れ。出している間はクロスヘアを隠します。 */
  setScope(on) {
    this.root.classList.toggle('scope-on', !!on);
  }

  /** スコアボードの表示切り替え（Tab） */
  toggleScoreboard() {
    this._boardOpen = !this._boardOpen;
    this.board.classList.toggle('open', this._boardOpen);
    if (this._boardOpen) this._boardSig = null;   // 開いた直後に必ず作り直す
  }

  /** 装備選択の表示切り替え（L） */
  setLoadoutOpen(open) {
    this._loadoutOpen = !!open;
    this.loadout.classList.toggle('open', this._loadoutOpen);
  }

  /** 設定の表示切り替え（O / 歯車） */
  setSettingsOpen(open) {
    this._settingsOpen = !!open;
    this.settings.classList.toggle('open', this._settingsOpen);
  }

  // ---------------------------------------------------------------------
  // 内部：装備選択
  // ---------------------------------------------------------------------

  _pick(cat, key) {
    this._picked[cat] = key;
    this._paintPicked(cat);
    if (this.onLoadoutPick) this.onLoadoutPick(cat, key);
  }

  /** その列のカードの選択状態を塗り直す */
  _paintPicked(cat) {
    const cards = this._loCards[cat];
    for (const k in cards) cards[k].classList.toggle('sel', k === this._picked[cat]);
  }
}
