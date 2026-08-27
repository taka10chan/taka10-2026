// ============================================================
//  ことだま・おえかき部屋（ドット絵エディタ）
//
//  かいた絵は localStorage の "kotodama-arts" に、この形で入ります。
//
//    {
//      "ゆうしゃ": { "w":16, "h":16, "px":["#ff0000", null, ...] },
//      "てき":     { "w":32, "h":32, "px":[ ... ] }
//    }
//
//  ・キーが 絵の名前（日本語でよい）
//  ・px は長さ w*h の配列。左上から右へ、そして次の行へ、の順。
//  ・色は "#rrggbb" の文字列。とうめいは null。
//
//  ほかのキー（gunarena- や kotodama-works ではじまるもの）は
//  ぜったいに さわりません。
// ============================================================

const KEY = 'kotodama-arts';        // ★この文字は1文字も変えないこと★

// よく使う色を24こ
const PALETTE = [
  '#000000', '#3a3a3a', '#7a7a7a', '#b8b8b8', '#ffffff', '#5a3216',
  '#ff4d6d', '#ff0000', '#ff7a00', '#ffb703', '#ffd66e', '#fff275',
  '#a7e05a', '#3fbf5f', '#1f8a4c', '#7ce7e0', '#29a8e0', '#1e5fd0',
  '#7a4de0', '#c46bea', '#ff9ab0', '#f5a04a', '#8b5a2b', '#0d1319',
];

const UNDO_MAX = 60;   // 元にもどせる回数（30回以上ないとダメ、という約束）

// ------------------------------------------------------------
//  画面の部品を集めておく
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const elBoard   = $('board');
const elWrap    = $('boardwrap');
const elPrev    = $('prev');
const elList    = $('list');
const elPalette = $('palette');
const elNowSw   = $('nowsw');
const elNowTx   = $('nowtx');
const elPick    = $('pick');
const elCode    = $('code');
const elToast   = $('toast');

const bctx = elBoard.getContext('2d');
const pctx = elPrev.getContext('2d');

// ------------------------------------------------------------
//  いまの状態
// ------------------------------------------------------------
let arts = {};        // 保存してある絵ぜんぶ
let name = '';        // いま ひらいている絵の名前
let art  = null;      // いま ひらいている絵 { w, h, px }

let tool  = 'pen';    // pen / eraser / fill / pick / rect / line
let color = '#ff4d6d';
let gridOn = true;

let undoStack = [];   // もどす用（古い順）
let redoStack = [];   // やりなおす用

let cell = 12;        // 板の1マスの大きさ（画面の px）

// ------------------------------------------------------------
//  ちいさな道具たち
// ------------------------------------------------------------

/** 画面の下に、しばらくメッセージを出す */
let toastTimer = 0;
function toast(text) {
  elToast.textContent = text;
  elToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), 1800);
}

/** "#rrggbb" の形かどうか */
function isColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

/** どんな色の書きかたで来ても "#rrggbb"（小文字）に そろえる */
function normColor(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) {
    s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return isColor(s) ? s : null;
}

/** 8 / 16 / 32 / 64 のどれかに そろえる */
function normSize(n) {
  n = Number(n);
  return [8, 16, 32, 64].includes(n) ? n : 16;
}

// ------------------------------------------------------------
//  保存と よみこみ
// ------------------------------------------------------------

/** localStorage から読む。こわれていても できるだけ直す */
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
  if (!raw) return {};

  let data;
  try { data = JSON.parse(raw); } catch (e) { return {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const out = {};
  for (const k of Object.keys(data)) {
    const a = data[k];
    if (!a || typeof a !== 'object') continue;
    const w = normSize(a.w);
    const h = normSize(a.h);
    const src = Array.isArray(a.px) ? a.px : [];
    const px = new Array(w * h);
    for (let i = 0; i < w * h; i++) px[i] = normColor(src[i]);   // 変な値は とうめい に
    out[k] = { w, h, px };
  }
  return out;
}

/** localStorage に書く。ほかのキーには いっさい さわらない */
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(arts));
  } catch (e) {
    toast('保存できませんでした（' + e.message + '）');
  }
}

// 自動保存。かいている間は 0.8秒 止まったら書く。ひと筆おわったら すぐ書く。
let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}
function saveNow() {
  clearTimeout(saveTimer);
  save();
}
// ページを閉じるときも 念のため書いておく
addEventListener('beforeunload', saveNow);
addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

// ------------------------------------------------------------
//  見本の絵（はじめて来た人が 真っ白で こまらないように）
// ------------------------------------------------------------

/** 文字の絵地図を { w, h, px } に変える */
function fromRows(rows, map) {
  const h = rows.length, w = rows[0].length;
  const px = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      px[y * w + x] = map[rows[y][x]] || null;
    }
  }
  return { w, h, px };
}

function sampleArts() {
  // --- ねこ ---
  const neko = fromRows([
    '................',
    '...O........O...',
    '..OPO......OPO..',
    '..OPPO....OPPO..',
    '..OOOOOOOOOOOO..',
    '.OOOOOOOOOOOOOO.',
    '.OOKKOOOOOOKKOO.',
    '.OOKKOOOOOOKKOO.',
    '.OOOOOOOOOOOOOO.',
    '.OOOOOONNOOOOOO.',
    '.OOOOOKNNKOOOOO.',
    '.OOOOOOOOOOOOOO.',
    '.OOOOOOOOOOOOOO.',
    '..OOOOOOOOOOOO..',
    '...OOOOOOOOOO...',
    '................',
  ], { O: '#f5a04a', P: '#ff9ab0', K: '#2b2b2b', N: '#ff7a9c' });

  // --- はーと ---
  const heart = fromRows([
    '................',
    '...RRR....RRR...',
    '..RRRRR..RRRRR..',
    '.RRRHHRRRRRRRRR.',
    '.RRRHRRRRRRRRRR.',
    '.RRRRRRRRRRRRRR.',
    '..RRRRRRRRRRRR..',
    '...RRRRRRRRRR...',
    '....RRRRRRRR....',
    '.....RRRRRR.....',
    '......RRRR......',
    '.......RR.......',
    '................',
    '................',
    '................',
    '................',
  ], { R: '#ff4d6d', H: '#ffe0e6' });

  // --- ほし ---
  const star = fromRows([
    '................',
    '.......SS.......',
    '.......SS.......',
    '......SSSS......',
    '......SSSS......',
    'SSSSSSSSSSSSSSSS',
    '.SSSSSSSSSSSSSS.',
    '..SSSSSSSSSSSS..',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '..SSSSSSSSSSSS..',
    '..SSSS....SSSS..',
    '.SSSS......SSSS.',
    '.SSS........SSS.',
    'SSS..........SSS',
    '................',
  ], { S: '#ffd66e' });

  return { 'ねこ': neko, 'はーと': heart, 'ほし': star };
}

// ------------------------------------------------------------
//  もどす／やりなおす
// ------------------------------------------------------------

/** いまの絵を まるごと ひかえておく */
function snapshot() {
  return { w: art.w, h: art.h, px: art.px.slice() };
}

/** これから絵を変えます、というときに 先に呼ぶ */
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;     // 新しく描いたら「やりなおす」は消える
  updateHistoryButtons();
}

function undo() {
  if (!undoStack.length) { toast('これ以上 もどせません'); return; }
  redoStack.push(snapshot());
  const s = undoStack.pop();
  art.w = s.w; art.h = s.h; art.px = s.px;
  afterChange(true);
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) { toast('やりなおすものが ありません'); return; }
  undoStack.push(snapshot());
  const s = redoStack.pop();
  art.w = s.w; art.h = s.h; art.px = s.px;
  afterChange(true);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('bUndo').disabled = undoStack.length === 0;
  $('bRedo').disabled = redoStack.length === 0;
}

/**
 * 絵が変わったあとに 呼ぶもの。
 *   relayout … 大きさが 変わったときは true（板を作りなおす）
 *   light    … かいている 途中は true（板だけ 描きなおして 軽くする）
 */
function afterChange(relayout, light) {
  arts[name] = art;
  if (relayout) {
    layoutBoard();
    updateSizeButton();
    renderList();      // 一覧の「16×16」という表示も 直す
  } else {
    drawBoard();
  }
  if (!light) {
    drawPreview();
    updateThumb(name);
    updatePng();
  }
  saveSoon();
}

// ------------------------------------------------------------
//  板を描く
// ------------------------------------------------------------

/** 板の大きさを 場所に合わせて 決めなおす */
function layoutBoard() {
  const pad = 10;
  let W = elWrap.clientWidth - pad;
  let H = elWrap.clientHeight - pad;
  if (!(W > 20)) W = 320;
  if (!(H > 20)) H = 320;
  const S = Math.min(W, H);
  const n = Math.max(art.w, art.h);

  cell = Math.max(1, Math.floor(S / n));
  const dw = cell * art.w;
  const dh = cell * art.h;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  elBoard.style.width = dw + 'px';
  elBoard.style.height = dh + 'px';
  elBoard.width = Math.round(dw * dpr);
  elBoard.height = Math.round(dh * dpr);
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawBoard();
}

/** 板の中身を ぜんぶ 描きなおす */
function drawBoard() {
  const { w, h, px } = art;
  bctx.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0,
                    Math.min(window.devicePixelRatio || 1, 2), 0, 0);
  bctx.clearRect(0, 0, w * cell, h * cell);

  // 1) とうめいを あらわす 市松もよう
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      bctx.fillStyle = ((x + y) & 1) ? '#232d36' : '#2c3742';
      bctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // 2) 絵そのもの
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px[y * w + x];
      if (c) { bctx.fillStyle = c; bctx.fillRect(x * cell, y * cell, cell, cell); }
    }
  }

  // 3) いま しかく／せん を ひいている 途中の ようす
  if (preview) {
    bctx.fillStyle = previewColor || '#000000';
    bctx.globalAlpha = previewColor ? 1 : 0.35;
    for (const p of preview) {
      bctx.fillRect(p.x * cell, p.y * cell, cell, cell);
    }
    bctx.globalAlpha = 1;
  }

  // 4) グリッド線（マスが小さすぎるときは出さない）
  if (gridOn && cell >= 5) {
    // 明るい色の上でも 暗い色の上でも 見えるように、
    // 黒い線と 白い線を すこしずつ ずらして 2回ひく
    bctx.lineWidth = 1;
    bctx.strokeStyle = 'rgba(0,0,0,0.20)';
    bctx.beginPath();
    for (let x = 1; x < w; x++) { bctx.moveTo(x * cell + .5, 0); bctx.lineTo(x * cell + .5, h * cell); }
    for (let y = 1; y < h; y++) { bctx.moveTo(0, y * cell + .5); bctx.lineTo(w * cell, y * cell + .5); }
    bctx.stroke();
    bctx.strokeStyle = 'rgba(255,255,255,0.16)';
    bctx.beginPath();
    for (let x = 1; x < w; x++) { bctx.moveTo(x * cell - .5, 0); bctx.lineTo(x * cell - .5, h * cell); }
    for (let y = 1; y < h; y++) { bctx.moveTo(0, y * cell - .5); bctx.lineTo(w * cell, y * cell - .5); }
    bctx.stroke();
    // 8マスごとの 太めの線（大きい板で 目印になる）
    if (Math.max(w, h) >= 32) {
      bctx.strokeStyle = 'rgba(255,255,255,0.22)';
      bctx.beginPath();
      for (let x = 8; x < w; x += 8) { bctx.moveTo(x * cell + .5, 0); bctx.lineTo(x * cell + .5, h * cell); }
      for (let y = 8; y < h; y += 8) { bctx.moveTo(0, y * cell + .5); bctx.lineTo(w * cell, y * cell + .5); }
      bctx.stroke();
    }
  }
}

/** 実物大（ゲームで見える大きさ）の プレビュー */
function drawPreview() {
  const { w, h, px } = art;
  elPrev.style.width = w + 'px';
  elPrev.style.height = h + 'px';
  elPrev.width = w;
  elPrev.height = h;
  pctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pctx.fillStyle = ((x + y) & 1) ? '#232d36' : '#2c3742';
      pctx.fillRect(x, y, 1, 1);
      const c = px[y * w + x];
      if (c) { pctx.fillStyle = c; pctx.fillRect(x, y, 1, 1); }
    }
  }
}

// ------------------------------------------------------------
//  マスを ぬる いろいろ
// ------------------------------------------------------------

function inside(x, y) { return x >= 0 && y >= 0 && x < art.w && y < art.h; }
function getPx(x, y) { return inside(x, y) ? art.px[y * art.w + x] : undefined; }
function setPx(x, y, c) { if (inside(x, y)) art.px[y * art.w + x] = c; }

/** ブレゼンハム。2つのマスの あいだを とばさずに つなぐ */
function cellsOfLine(x0, y0, x1, y1) {
  const out = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  for (let guard = 0; guard < 20000; guard++) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/** しかく（わく だけ）のマス */
function cellsOfRect(x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const out = [];
  for (let x = ax; x <= bx; x++) { out.push({ x, y: ay }); out.push({ x, y: by }); }
  for (let y = ay + 1; y < by; y++) { out.push({ x: ax, y }); out.push({ x: bx, y }); }
  return out;
}

/** ぬりつぶし（同じ色が つながっている ところだけ） */
function floodFill(sx, sy, to) {
  const from = getPx(sx, sy);
  if (from === undefined) return;
  if (from === to) return;                      // もう その色なら 何もしない
  const { w, h, px } = art;
  const stack = [sx + sy * w];
  const done = new Uint8Array(w * h);
  done[sx + sy * w] = 1;
  while (stack.length) {
    const i = stack.pop();
    px[i] = to;
    const x = i % w, y = (i / w) | 0;
    if (x > 0     && !done[i - 1] && px[i - 1] === from) { done[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && !done[i + 1] && px[i + 1] === from) { done[i + 1] = 1; stack.push(i + 1); }
    if (y > 0     && !done[i - w] && px[i - w] === from) { done[i - w] = 1; stack.push(i - w); }
    if (y < h - 1 && !done[i + w] && px[i + w] === from) { done[i + w] = 1; stack.push(i + w); }
  }
}

// ------------------------------------------------------------
//  マウス／タッチで かく
// ------------------------------------------------------------
let drawing = false;
let lastX = 0, lastY = 0;     // 前のマス（線でつなぐため）
let startX = 0, startY = 0;   // しかく／せん の 始めのマス
let preview = null;           // しかく／せん の 途中のようす
let previewColor = null;

/** 画面の座標を マスの座標に する */
function toCell(ev) {
  const r = elBoard.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * art.w);
  const y = Math.floor((ev.clientY - r.top) / r.height * art.h);
  return { x, y };
}

function onDown(ev) {
  if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
  ev.preventDefault();
  const { x, y } = toCell(ev);
  if (!inside(x, y)) return;

  // スポイトは 絵を変えないので undo に積まない
  if (tool === 'pick') {
    const c = getPx(x, y);
    if (c) { setColor(c); toast('いろを とりました ' + c); }
    else   { toast('ここは とうめいです'); }
    return;
  }

  try { elBoard.setPointerCapture(ev.pointerId); } catch (e) { /* 気にしない */ }
  drawing = true;
  startX = lastX = x; startY = lastY = y;
  pushUndo();

  if (tool === 'pen')    { setPx(x, y, color); afterChange(false, true); }
  if (tool === 'eraser') { setPx(x, y, null);  afterChange(false, true); }
  if (tool === 'fill')   { floodFill(x, y, color); afterChange(false, true); }
  if (tool === 'rect' || tool === 'line') {
    previewColor = color;
    preview = [{ x, y }];
    drawBoard();
  }
}

function onMove(ev) {
  if (!drawing) return;
  ev.preventDefault();
  const { x, y } = toCell(ev);
  const cx = Math.max(0, Math.min(art.w - 1, x));
  const cy = Math.max(0, Math.min(art.h - 1, y));

  if (tool === 'pen' || tool === 'eraser') {
    if (cx === lastX && cy === lastY) return;
    const c = (tool === 'pen') ? color : null;
    for (const p of cellsOfLine(lastX, lastY, cx, cy)) setPx(p.x, p.y, c);
    lastX = cx; lastY = cy;
    afterChange(false, true);       // 途中は 板だけ 描きなおして 軽くする
  } else if (tool === 'rect' || tool === 'line') {
    preview = (tool === 'rect')
      ? cellsOfRect(startX, startY, cx, cy)
      : cellsOfLine(startX, startY, cx, cy);
    lastX = cx; lastY = cy;
    drawBoard();
  }
}

function onUp(ev) {
  if (!drawing) return;
  ev.preventDefault();
  drawing = false;
  try { elBoard.releasePointerCapture(ev.pointerId); } catch (e) { /* 気にしない */ }

  if (preview) {
    for (const p of preview) setPx(p.x, p.y, previewColor);
    preview = null;
  }
  afterChange(false);
  saveNow();               // ひと筆おわったら すぐ保存
}

elBoard.addEventListener('pointerdown', onDown);
elBoard.addEventListener('pointermove', onMove);
elBoard.addEventListener('pointerup', onUp);
elBoard.addEventListener('pointercancel', onUp);
// 指でなぞったときに 画面が スクロールしないように
elBoard.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
elBoard.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ★左ドラッグで 絵の ゴーストが 出ないようにする（前に ほんとうに あった不具合）
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => {
  // 名前を打つ入力らんの中だけは えらべるように のこす
  if (e.target && e.target.tagName === 'INPUT') return;
  e.preventDefault();
});

// ------------------------------------------------------------
//  色えらび
// ------------------------------------------------------------
function setColor(c) {
  color = normColor(c) || '#000000';
  elNowSw.style.backgroundColor = color;
  elNowTx.textContent = color;
  elPick.value = color;
  for (const b of elPalette.children) b.classList.toggle('on', b.dataset.color === color);
}

for (const c of PALETTE) {
  const b = document.createElement('button');
  b.dataset.color = c;
  b.style.backgroundColor = c;
  b.title = c;
  b.addEventListener('click', () => setColor(c));
  elPalette.appendChild(b);
}
elPick.addEventListener('input', () => setColor(elPick.value));

// ------------------------------------------------------------
//  道具えらび
// ------------------------------------------------------------
for (const b of document.querySelectorAll('#tools .btn')) {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('#tools .btn')) o.classList.toggle('on', o === b);
  });
}

// ------------------------------------------------------------
//  絵の いちらん
// ------------------------------------------------------------
const thumbs = new Map();     // 名前 → サムネイルの canvas

/** サムネイルを 描きなおす */
function updateThumb(n) {
  const cv = thumbs.get(n);
  const a = arts[n];
  if (!cv || !a) return;
  const ctx = cv.getContext('2d');
  cv.width = a.w; cv.height = a.h;
  ctx.clearRect(0, 0, a.w, a.h);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      ctx.fillStyle = ((x + y) & 1) ? '#1a232c' : '#212c36';
      ctx.fillRect(x, y, 1, 1);
      const c = a.px[y * a.w + x];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  }
}

function renderList() {
  elList.textContent = '';
  thumbs.clear();
  const names = Object.keys(arts).sort((a, b) => a.localeCompare(b, 'ja'));
  for (const n of names) {
    const row = document.createElement('div');
    row.className = 'arow' + (n === name ? ' on' : '');

    const cv = document.createElement('canvas');
    cv.draggable = false;
    thumbs.set(n, cv);
    row.appendChild(cv);

    const box = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = n;
    const sz = document.createElement('div');
    sz.className = 'sz'; sz.textContent = arts[n].w + '×' + arts[n].h;
    box.appendChild(nm); box.appendChild(sz);
    row.appendChild(box);

    row.addEventListener('click', () => openArt(n));
    elList.appendChild(row);
    updateThumb(n);
  }
}

/** 絵をひらく */
function openArt(n) {
  if (!arts[n]) return;
  saveNow();
  name = n;
  art = arts[n];
  undoStack = []; redoStack = [];
  updateHistoryButtons();
  updateSizeButton();
  updateCode();
  updatePng();
  layoutBoard();
  drawPreview();
  renderList();
}

// ------------------------------------------------------------
//  まんなかに出る箱（名前を聞く／たしかめる）
// ------------------------------------------------------------
const dlg = $('dlg');
let dlgResolve = null;
let dlgValidate = null;
let dlgSize = 16;

/**
 * 箱を出す。
 *   opts = { title, message, input:true/false, initial, sizes:true/false,
 *            okText, validate(値) → エラー文 か null }
 * 「OK」なら 打った文字（sizes つきなら {text, size}）を、
 * 「やめる」なら null を かえす。
 */
function ask(opts) {
  $('dlgTitle').textContent = opts.title || '';
  $('dlgMsg').textContent = opts.message || '';
  $('dlgMsg').style.display = opts.message ? '' : 'none';
  $('dlgErr').textContent = '';
  const inp = $('dlgInput');
  inp.style.display = opts.input ? '' : 'none';
  inp.value = opts.initial || '';
  $('dlgSizes').style.display = opts.sizes ? '' : 'none';
  $('dlgOk').textContent = opts.okText || 'OK';
  dlgValidate = opts.validate || null;

  if (opts.sizes) {
    dlgSize = normSize(opts.initialSize || 16);
    for (const b of $('dlgSizes').children) {
      b.classList.toggle('on', Number(b.dataset.size) === dlgSize);
    }
  }

  dlg.classList.add('show');
  if (opts.input) setTimeout(() => { inp.focus(); inp.select(); }, 30);
  return new Promise((res) => { dlgResolve = res; });
}

function dlgClose(value) {
  dlg.classList.remove('show');
  const r = dlgResolve; dlgResolve = null;
  if (r) r(value);
}

for (const b of $('dlgSizes').children) {
  b.addEventListener('click', () => {
    dlgSize = Number(b.dataset.size);
    for (const o of $('dlgSizes').children) o.classList.toggle('on', o === b);
  });
}

$('dlgOk').addEventListener('click', () => {
  const text = $('dlgInput').value.trim();
  if (dlgValidate) {
    const err = dlgValidate(text);
    if (err) { $('dlgErr').textContent = err; return; }   // 直すまで 閉じない
  }
  dlgClose({ text, size: dlgSize });
});
$('dlgCancel').addEventListener('click', () => dlgClose(null));
dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) dlgClose(null); });
$('dlgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('dlgOk').click(); }
  if (e.key === 'Escape') { e.preventDefault(); dlgClose(null); }
});

/** 名前が つかえるか しらべる（重なっていたら 教える） */
function nameError(text, allowSame) {
  if (!text) return '名前を 入れてね';
  if (text.length > 24) return '名前が ながすぎます（24文字まで）';
  if (allowSame !== undefined && text === allowSame) return null;
  if (Object.prototype.hasOwnProperty.call(arts, text)) {
    return '「' + text + '」は もう あります。ちがう名前に してね';
  }
  return null;
}

// ------------------------------------------------------------
//  絵を つくる・名前をかえる・ふくせい・けす
// ------------------------------------------------------------
$('bNew').addEventListener('click', async () => {
  const r = await ask({
    title: 'あたらしい 絵',
    message: '名前と 大きさを えらんでね',
    input: true, initial: '', sizes: true, initialSize: 16,
    okText: 'つくる',
    validate: (t) => nameError(t),
  });
  if (!r) return;
  const n = normSize(r.size);
  arts[r.text] = { w: n, h: n, px: new Array(n * n).fill(null) };
  saveNow();
  openArt(r.text);
  toast('「' + r.text + '」を つくりました');
});

$('bRename').addEventListener('click', async () => {
  const old = name;
  const r = await ask({
    title: '名前を かえる',
    input: true, initial: old, okText: 'かえる',
    validate: (t) => nameError(t, old),
  });
  if (!r || r.text === old) return;
  // 順番を できるだけ たもって 入れかえる
  const next = {};
  for (const k of Object.keys(arts)) {
    if (k === old) next[r.text] = arts[k];
    else next[k] = arts[k];
  }
  arts = next;
  name = r.text;
  saveNow();
  renderList(); updateCode(); updatePng();
  toast('「' + r.text + '」に かえました');
});

$('bDup').addEventListener('click', async () => {
  let base = name + 'のコピー', try2 = base, i = 2;
  while (arts[try2]) { try2 = base + i; i++; }
  const r = await ask({
    title: 'ふくせい',
    message: '同じ絵を もう1つ つくります',
    input: true, initial: try2, okText: 'つくる',
    validate: (t) => nameError(t),
  });
  if (!r) return;
  arts[r.text] = { w: art.w, h: art.h, px: art.px.slice() };
  saveNow();
  openArt(r.text);
  toast('「' + r.text + '」を つくりました');
});

$('bDel').addEventListener('click', async () => {
  if (Object.keys(arts).length <= 1) { toast('さいごの1まいは 消せません'); return; }
  const r = await ask({
    title: 'ほんとうに 消す？',
    message: '「' + name + '」を 消します。\nもとには もどせません。',
    input: false, okText: '消す',
  });
  if (!r) return;
  const gone = name;
  delete arts[gone];
  saveNow();
  openArt(Object.keys(arts)[0]);
  toast('「' + gone + '」を 消しました');
});

// ------------------------------------------------------------
//  板の大きさを かえる（あとから）
// ------------------------------------------------------------
function updateSizeButton() {
  $('bSize').textContent = '大きさ ' + art.w + '×' + art.h;
}

$('bSize').addEventListener('click', async () => {
  const r = await ask({
    title: '板の 大きさを かえる',
    message: '絵が はみ出ると、その分は 消えます。\n中身は できるだけ のこします。',
    input: false, sizes: true, initialSize: art.w,
    okText: 'かえる',
  });
  if (!r) return;
  const n = normSize(r.size);
  if (n === art.w && n === art.h) return;
  pushUndo();
  const px = new Array(n * n).fill(null);
  for (let y = 0; y < Math.min(n, art.h); y++) {
    for (let x = 0; x < Math.min(n, art.w); x++) {
      px[y * n + x] = art.px[y * art.w + x];     // 左上を そろえて うつす
    }
  }
  art.w = n; art.h = n; art.px = px;
  updateSizeButton();
  afterChange(true);
  saveNow();
  toast(n + '×' + n + ' に しました');
});

// ------------------------------------------------------------
//  はんてん・回転・ぜんぶ消す
// ------------------------------------------------------------
$('bFlipH').addEventListener('click', () => {
  pushUndo();
  const { w, h, px } = art, out = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px[y * w + (w - 1 - x)];
  art.px = out; afterChange(false); saveNow();
});

$('bFlipV').addEventListener('click', () => {
  pushUndo();
  const { w, h, px } = art, out = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px[(h - 1 - y) * w + x];
  art.px = out; afterChange(false); saveNow();
});

$('bRot').addEventListener('click', () => {
  pushUndo();
  const { w, h, px } = art;
  const nw = h, nh = w;                       // 90度まわすと たてよこが 入れかわる
  const out = new Array(nw * nh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[x * nw + (h - 1 - y)] = px[y * w + x];   // 時計まわり
    }
  }
  art.w = nw; art.h = nh; art.px = out;
  updateSizeButton();
  afterChange(true); saveNow();
});

$('bClear').addEventListener('click', async () => {
  const r = await ask({
    title: 'ぜんぶ 消す？',
    message: '「' + name + '」の 中身を まっさらに します。\n（Ctrl+Z で もどせます）',
    input: false, okText: '消す',
  });
  if (!r) return;
  pushUndo();
  art.px = new Array(art.w * art.h).fill(null);
  afterChange(false); saveNow();
});

// ------------------------------------------------------------
//  グリッド・もどす・やりなおす
// ------------------------------------------------------------
$('bGrid').addEventListener('click', () => {
  gridOn = !gridOn;
  $('bGrid').classList.toggle('on', gridOn);
  drawBoard();
});
$('bUndo').addEventListener('click', undo);
$('bRedo').addEventListener('click', redo);

addEventListener('keydown', (e) => {
  if (dlg.classList.contains('show')) return;       // 箱が出ているときは 何もしない
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// ------------------------------------------------------------
//  ゲームでの 書きかた（クリックで コピー）
// ------------------------------------------------------------
function updateCode() {
  elCode.textContent = 'もよう(はこ(0, 5, 0, 4, 4, 4), "' + name + '")';
}

elCode.addEventListener('click', async () => {
  const text = elCode.textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました');
  } catch (e) {
    // clipboard が つかえない ブラウザ用の 逃げ道
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('コピーしました'); }
    catch (e2) { toast('コピーできませんでした'); }
    ta.remove();
  }
});

// ------------------------------------------------------------
//  PNG で 書き出す
// ------------------------------------------------------------
/** 絵を canvas に 描いて とりだす（scale ばい） */
function toPngUrl(scale) {
  const { w, h, px } = art;
  const cv = document.createElement('canvas');
  cv.width = w * scale; cv.height = h * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px[y * w + x];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale); }
      // とうめいの ところは 何も描かない ＝ PNG でも とうめい
    }
  }
  return cv.toDataURL('image/png');
}

function updatePng() {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  $('bPng1').download = safe + '.png';
  $('bPng8').download = safe + '_x8.png';
}
// クリックされた そのときに 中身を つくる（いつも新しい絵になるように）
$('bPng1').addEventListener('click', (e) => { e.currentTarget.href = toPngUrl(1); });
$('bPng8').addEventListener('click', (e) => { e.currentTarget.href = toPngUrl(8); });

// ------------------------------------------------------------
//  窓の大きさが 変わったら 板も 合わせる
// ------------------------------------------------------------
let roTimer = 0;
function relayoutSoon() {
  clearTimeout(roTimer);
  roTimer = setTimeout(() => { if (art) layoutBoard(); }, 40);
}
addEventListener('resize', relayoutSoon);
if (window.ResizeObserver) new ResizeObserver(relayoutSoon).observe(elWrap);

// ------------------------------------------------------------
//  はじまり
// ------------------------------------------------------------
arts = load();
if (!Object.keys(arts).length) {
  arts = sampleArts();       // まっさらな人には 見本を 3まい
  save();
}
setColor(color);
openArt(Object.keys(arts)[0]);

// テストや ほかの画面から さわれるように、そっと出しておく
window.kotodamaPaint = {
  get arts() { return arts; },
  get name() { return name; },
  get art() { return art; },
  openArt, save: saveNow, undo, redo,
  setColor, setTool: (t) => { tool = t; },
  KEY,
};
