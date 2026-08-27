/* =======================================================================
   ことだま — app.js（画面ぜんたいの世話をする係）

   ここでやること
     ・コードを かくところ（行番号・字下げ・行を光らせる）
     ・▶ プレイ／■ ストップ と 1フレームずつの くりかえし
     ・ログとエラーの表示（クリックで その行へ とぶ）
     ・単語帳パネル（さがす・分類・クリックで さしこむ）
     ・サンプルの よみこみ
     ・さくひん（localStorage への じどう保存）

   ことばの中身（lang.js）・ゲームの中身（runtime.js）・単語帳のデータ
   （words.js）は べつの人が つくっています。ここでは「よぶ」だけ。
   ======================================================================= */

import { parse, Runner, KotodamaError } from './lang.js';
import { Game } from './runtime.js';
import { CATEGORIES, GRAMMAR, SAMPLES } from './words.js';

/* =======================================================================
   0. 画面の部品を つかまえる
   ======================================================================= */
const $ = (id) => document.getElementById(id);

const ta         = $('code');       // コードを かく textarea
const gutter     = $('gutter');     // 行番号
const hlLayer    = $('hlLayer');    // 行を光らせる下じき
const canvas     = $('screen');     // ゲームの canvas（640x480）
const stageWrap  = $('stageWrap');
const stageHint  = $('stageHint');
const logBox     = $('log');
const btnRun     = $('btnRun');
const runIcon    = $('runIcon');
const runLabel   = $('runLabel');
const btnSample  = $('btnSample');
const popSample  = $('popSample');
const btnWorks   = $('btnWorks');
const popWorks   = $('popWorks');
const btnWords   = $('btnWords');
const dict       = $('dict');
const dictQ      = $('dictQ');
const dictList   = $('dictList');
const dictClose  = $('dictClose');
const scrim      = $('scrim');
const workNameEl = $('workName');
const saveStateEl= $('saveState');

/* =======================================================================
   1. ログ（かく() の出力・エラー・お知らせ）
   ======================================================================= */

/** ふつうの1行 */
function logLine(text, cls) {
  const d = document.createElement('div');
  d.className = 'li ' + (cls || '');
  d.textContent = text;
  pushLog(d);
}
const logSys = (t) => logLine(t, 'sys');
const logOk  = (t) => logLine(t, 'ok');

function pushLog(el) {
  logBox.appendChild(el);
  // たまりすぎると おもくなるので、古いものから 消す
  while (logBox.childElementCount > 400) logBox.removeChild(logBox.firstChild);
  logBox.scrollTop = logBox.scrollHeight;
}

/**
 * エラーを 赤く出す。「◯ぎょうめ: メッセージ」＋「→ ヒント」。
 * クリックすると その行に カーソルが とんで、行が 光る。
 */
function showError(err) {
  let line = null, msg = '', hint = '';

  const isKoto = (err instanceof KotodamaError)
              || (err && (err.name === 'KotodamaError' || typeof err.line === 'number'));
  if (isKoto) {
    line = err.line;
    // lang.js の message には すでに「3ぎょうめ: 」が ついていることがある。
    // ここでも 行番号を 出すので、二重に ならないように はずす。
    msg  = err.rawMessage || err.message || 'なにか おかしいです';
    msg  = String(msg).replace(/^\s*\d+\s*(ぎょうめ|行目)\s*[:：]\s*/, '');
    hint = err.hint || '';
  } else {
    // ことだま以外の（JS の）エラー。中学生には意味が分からないので言いかえる。
    msg  = 'プログラムを うごかせませんでした（' + ((err && err.message) || err) + '）';
    hint = 'もういちど ▶ プレイ を おしてみよう';
  }

  const d = document.createElement('div');
  d.className = 'li err';

  if (typeof line === 'number' && line > 0) {
    const ln = document.createElement('span');
    ln.className = 'ln';
    ln.textContent = line + 'ぎょうめ: ';
    d.appendChild(ln);
  }
  d.appendChild(document.createTextNode(msg));

  if (hint) {
    const h = document.createElement('span');
    h.className = 'hint';
    h.textContent = '→ ' + hint;
    d.appendChild(h);
  }

  if (typeof line === 'number' && line > 0) {
    const j = document.createElement('span');
    j.className = 'jump';
    j.textContent = '（クリックすると その行に とびます）';
    d.appendChild(j);
    d.addEventListener('click', () => jumpToLine(line));
    addErrorLine(line);
  }

  pushLog(d);
}

$('btnClearLog').addEventListener('click', () => { logBox.textContent = ''; });

// 画面のどこかで JS の例外が出ても、まっくらなまま だまらないようにする。
//
// ただし、使う人は英語が読めません。ブラウザが出す英語のメッセージを
// そのまま見せると、何が起きたのか分からず こわいだけなので、
//   ・気にしなくていいものは 黙って 捨てる
//   ・よくあるものは 日本語に 言いかえる
//   ・分からないものは 日本語の ひとことに して、英語は「くわしく」に落とす
// という3段がまえにします。

/** 出さなくていいもの（出ても害がない） */
const きにしない = [
  'pointer lock',          // 画面をクリックする前に 視点ロックを頼んだだけ
  'user gesture',
  'play() request',        // 音を鳴らそうとして 止められただけ
  'autoplay',
  'ResizeObserver loop',   // ブラウザの よくある 無害な警告
];

/** よくあるものを 日本語に 言いかえる */
const いいかえ = [
  [/webgl|context lost|gpu/i,
   'この端末では 3D が うまく うごかせないみたい。ブラウザを 新しくするか、べつの端末で ためしてみてね'],
  [/quota|storage/i,
   'この端末の ほぞん場所が いっぱいです。いらない さくひんを けしてみてね'],
  [/out of memory|allocation/i,
   'ものを 作りすぎて おもくなりました。ぜんぶけす() を つかうか、数を へらしてみてね'],
  [/network|fetch|load/i,
   'ファイルの 読みこみに しっぱいしました。ページを 読みこみ直してみてね'],
];

function うちがわのエラー(なま) {
  const t = String(なま == null ? '' : nama0(なま));
  if (!t) return;
  if (きにしない.some((k) => t.toLowerCase().includes(k))) return;

  for (const [しるし, にほんご] of いいかえ) {
    if (しるし.test(t)) { logLine(にほんご, 'err'); return; }
  }
  logLine('うちがわで なにか おきました。▶ プレイ を もう一度 おしてみてね。', 'err');
  logLine('（くわしく: ' + t + '）', 'dim');
}

function nama0(v) { return (v && v.message) ? v.message : v; }

window.addEventListener('error', (e) => {
  うちがわのエラー(e.message || e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  うちがわのエラー(e.reason);
});

/* =======================================================================
   2. コードを かくところ（行番号・スクロール同期・行を光らせる）
   ======================================================================= */

let LH = 25;       // 1行の高さ(px)。CSS の --lh から とってくる
let PADTOP = 10;   // コードの上のすきま(px)。CSS の --pad-top と同じ
let gutterCount = -1;              // いま出ている行番号の数
const errorLines = new Set();      // 赤くする行（1から）

function readMetrics() {
  const cs = getComputedStyle(document.documentElement);
  const lh = parseFloat(cs.getPropertyValue('--lh'));
  const pt = parseFloat(cs.getPropertyValue('--pad-top'));
  if (lh > 0) LH = lh;
  if (pt >= 0) PADTOP = pt;
}

/** 行番号を つくりなおす（行の数が かわったときだけ） */
function renderGutter(force) {
  const n = Math.max(1, ta.value.split('\n').length);
  if (!force && n === gutterCount) return;
  gutterCount = n;
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= n; i++) {
    const d = document.createElement('div');
    d.textContent = String(i);
    frag.appendChild(d);
  }
  gutter.textContent = '';
  gutter.appendChild(frag);
  applyErrorMarks();
  syncScroll();
}

/** textarea の スクロールに 行番号と 下じきを あわせる */
function syncScroll() {
  gutter.scrollTop = ta.scrollTop;
  hlLayer.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
}

/** 行を光らせる四角を1つ作る */
function makeHl(line, cls) {
  const d = document.createElement('div');
  d.className = 'hl ' + cls;
  d.style.top = (PADTOP + (line - 1) * LH) + 'px';
  hlLayer.appendChild(d);
  return d;
}

function addErrorLine(line) {
  errorLines.add(line);
  applyErrorMarks();
}

function clearErrorMarks() {
  errorLines.clear();
  applyErrorMarks();
}

/** 赤い行番号と 赤い下じきを つけなおす */
function applyErrorMarks() {
  // 下じきの 赤いやつだけ 消す（flash は のこす）
  hlLayer.querySelectorAll('.hl.err').forEach((el) => el.remove());
  const kids = gutter.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.remove('err');
  errorLines.forEach((line) => {
    if (kids[line - 1]) kids[line - 1].classList.add('err');
    makeHl(line, 'err');
  });
}

/** その行に カーソルを とばして、光らせる */
function jumpToLine(line) {
  const lines = ta.value.split('\n');
  if (line < 1) line = 1;
  if (line > lines.length) line = lines.length;

  let pos = 0;
  for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;

  ta.focus();
  ta.setSelectionRange(pos, pos + lines[line - 1].length);

  // まんなかあたりに 来るように スクロール
  const want = (line - 1) * LH - ta.clientHeight / 2 + LH;
  ta.scrollTop = Math.max(0, want);
  syncScroll();

  const f = makeHl(line, 'flash');
  setTimeout(() => f.remove(), 1500);
}

/** カーソルの ところに もじを さしこむ（Ctrl+Z で もどせるように execCommand を使う） */
function insertAtCursor(text) {
  ta.focus();
  let done = false;
  try { done = document.execCommand('insertText', false, text); } catch (_) { done = false; }
  if (!done) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end');
  }
  onCodeChanged();
}

// --- textarea の きほんの世話 ---
ta.addEventListener('scroll', syncScroll);
ta.addEventListener('input', onCodeChanged);

// Tab で 字下げ（フォーカスが よそに とばないように 止める）
ta.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  const s = ta.selectionStart, en = ta.selectionEnd;
  const val = ta.value;

  if (s === en && !e.shiftKey) {
    insertAtCursor('  ');           // ふつうは スペース2つ
    return;
  }
  // えらんでいる行 まとめて 字下げ／もどす
  const from = val.lastIndexOf('\n', s - 1) + 1;
  const to   = val.indexOf('\n', en) === -1 ? val.length : val.indexOf('\n', en);
  const block = val.slice(from, to);
  const out = block.split('\n').map((ln) =>
    e.shiftKey ? ln.replace(/^ {1,2}/, '') : '  ' + ln
  ).join('\n');
  ta.setSelectionRange(from, to);
  let ok = false;
  try { ok = document.execCommand('insertText', false, out); } catch (_) { ok = false; }
  if (!ok) ta.setRangeText(out, from, to, 'select');
  ta.setSelectionRange(from, from + out.length);
  onCodeChanged();
});

/** コードが かわったときに よぶ */
function onCodeChanged() {
  const n = Math.max(1, ta.value.split('\n').length);
  // 行の数が かわったら、赤い印の 行がずれるので 消す
  if (n !== gutterCount) clearErrorMarks();
  renderGutter();
  markDirty();
}

/* =======================================================================
   3. さくひん（localStorage への じどう保存）

   さわるキーは 'kotodama-works' ひとつだけ。
   ほかのページの 'gunarena-' で はじまるデータには ぜったい さわらない。
   ======================================================================= */
const STORE_KEY = 'kotodama-works';

let store = null;         // { v, currentId, works:[{id,name,code,updated}] }
let saveTimer = 0;

function newId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultCode() {
  // サンプルが あれば その1つめ。なければ かんたんな出だし。
  const s = samples[0];
  if (s && s.code) return s.code;
  return [
    '# はじめての ことだま',
    'はいけい("こん")',
    'ゆうしゃ = え(320, 240, "🐱")',
    '',
    'ずっと',
    '  もし おされてる("みぎ") なら',
    '    みぎへ(ゆうしゃ, 4)',
    '  おわり',
    '  もし おされてる("ひだり") なら',
    '    ひだりへ(ゆうしゃ, 4)',
    '  おわり',
    '  まつ(0.02)',
    'おわり',
    ''
  ].join('\n');
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.works) && o.works.length) {
        o.works = o.works.filter((w) => w && typeof w.code === 'string');
        if (o.works.length) return o;
      }
    }
  } catch (_) { /* こわれていたら 新しく作る */ }
  return null;
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    setSaveState('ほぞんずみ', false);
  } catch (_) {
    setSaveState('ほぞんできません', true);
  }
}

function setSaveState(text, dirty) {
  saveStateEl.textContent = text;
  saveStateEl.classList.toggle('dirty', !!dirty);
}

function currentWork() {
  return store.works.find((w) => w.id === store.currentId) || store.works[0];
}

/** 1秒くらい 手が とまったら 保存する */
function markDirty() {
  setSaveState('ほぞんちゅう…', true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 1000);
}

function flushSave() {
  clearTimeout(saveTimer);
  const w = currentWork();
  if (!w) return;
  w.code = ta.value;
  w.updated = Date.now();
  saveStore();
}

function openWork(id) {
  flushSave();
  const w = store.works.find((x) => x.id === id);
  if (!w) return;
  store.currentId = id;
  ta.value = w.code;
  clearErrorMarks();
  renderGutter(true);
  ta.scrollTop = 0; syncScroll();
  workNameEl.textContent = w.name;
  saveStore();
  renderWorksMenu();
  logSys('「' + w.name + '」を ひらきました');
}

function addWork(name, code) {
  const w = { id: newId(), name: name, code: code, updated: Date.now() };
  store.works.push(w);
  store.currentId = w.id;
  ta.value = code;
  clearErrorMarks();
  renderGutter(true);
  workNameEl.textContent = name;
  saveStore();
  renderWorksMenu();
  return w;
}

/** さくひんメニューの 中身を つくる */
function renderWorksMenu() {
  popWorks.textContent = '';

  store.works.forEach((w) => {
    const row = document.createElement('div');
    row.className = 'row';

    const b = document.createElement('button');
    b.className = 'item' + (w.id === store.currentId ? ' on' : '');
    b.type = 'button';
    const nm = document.createElement('span');
    nm.textContent = (w.id === store.currentId ? '● ' : '　') + w.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = w.code.split('\n').length + 'ぎょう ／ ' + when(w.updated);
    b.appendChild(nm); b.appendChild(sub);
    b.addEventListener('click', () => { closePops(); if (w.id !== store.currentId) openWork(w.id); });

    const ren = tool('なまえ', 'なまえを かえる', () => {
      const nn = prompt('あたらしい なまえは？', w.name);
      if (nn && nn.trim()) {
        w.name = nn.trim();
        if (w.id === store.currentId) workNameEl.textContent = w.name;
        saveStore(); renderWorksMenu();
      }
    });
    const dup = tool('コピー', 'ふくせいする', () => {
      flushSave();
      closePops();
      addWork(w.name + ' の コピー', w.code);
      logSys('ふくせい しました');
    });
    const del = tool('けす', 'けす', () => {
      if (store.works.length <= 1) { alert('さくひんが 1つしか ないので けせません'); return; }
      if (!confirm('「' + w.name + '」を けします。もとに もどせません。よろしいですか？')) return;
      store.works = store.works.filter((x) => x.id !== w.id);
      if (store.currentId === w.id) { store.currentId = store.works[0].id; openWork(store.currentId); }
      saveStore(); renderWorksMenu();
    }, 'del');

    row.appendChild(b); row.appendChild(ren); row.appendChild(dup); row.appendChild(del);
    popWorks.appendChild(row);
  });

  const sep = document.createElement('div');
  sep.className = 'sep';
  popWorks.appendChild(sep);

  const add = document.createElement('button');
  add.className = 'item';
  add.type = 'button';
  add.textContent = '＋ あたらしく つくる';
  add.addEventListener('click', () => {
    closePops();
    const nn = prompt('あたらしい さくひんの なまえは？', 'さくひん ' + (store.works.length + 1));
    if (nn === null) return;
    addWork((nn.trim() || 'なまえのない さくひん'), '# ここに かいてね\n');
    logSys('あたらしい さくひんを つくりました');
  });
  popWorks.appendChild(add);
}

function tool(label, title, fn, cls) {
  const b = document.createElement('button');
  b.className = 'tool ' + (cls || '');
  b.type = 'button';
  b.title = title;
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
}

function when(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ページを はなれるときは かならず 保存
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

/* =======================================================================
   4. words.js の データを ならしてから つかう

   words.js は べつの人が 書いています。かたちが すこし ちがっても
   こわれないように、ここで よくある かたちを 受けとめておきます。
   ======================================================================= */

/** 1つの ことばを { sig, desc, ex, insert, tags } に そろえる */
function normWord(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return { sig: raw, desc: '', ex: '', insert: raw, tags: '' };
  }
  const sig  = raw.sig || raw.usage || raw['つかいかた'] || raw.name || raw['なまえ'] || '';
  const desc = raw.desc || raw['いみ'] || raw.description || '';
  let ex     = raw.ex || raw.example || raw['れい'] || raw['例'] || '';
  if (Array.isArray(ex)) ex = ex.join('\n');
  const insert = (raw.insert !== undefined && raw.insert !== null) ? raw.insert
               : (raw['そうにゅう'] !== undefined ? raw['そうにゅう'] : sig);
  let tags = raw.tags || raw['タグ'] || '';
  if (Array.isArray(tags)) tags = tags.join(' ');
  // call（ことばの なまえ）も さがせるように タグに まぜておく
  if (raw.call) tags = String(tags) + ' ' + raw.call;
  if (!sig && !desc) return null;
  return { sig: String(sig), desc: String(desc), ex: String(ex || ''),
           insert: String(insert), tags: String(tags) };
}

/** ことばの ならびを [{name, words:[...]}] に そろえる */
function normCategories(src, fallbackName) {
  const out = [];
  if (!src) return out;

  const pushCat = (name, arr, icon) => {
    const words = [].concat(arr || []).map(normWord).filter(Boolean);
    if (words.length) out.push({ name: name || fallbackName || 'そのた', icon: icon || '', words: words });
  };

  if (Array.isArray(src)) {
    // (a) [{name, items:[...]}, ...] のかたち
    const looksGrouped = src.some((c) => c && (c.items || c.words || c.entries || c['ことば']));
    if (looksGrouped) {
      src.forEach((c) => {
        if (!c) return;
        const items = c.items || c.words || c.entries || c['ことば'];
        pushCat(c.name || c.title || c['ぶんるい'] || c['分類'], items, c.icon);
      });
      return out;
    }
    // (b) 平たい配列。cat / category / 分類 があれば それで まとめる
    const groups = new Map();
    src.forEach((raw) => {
      if (!raw) return;
      const key = (raw.cat || raw.category || raw['ぶんるい'] || raw['分類'] || fallbackName || 'そのた');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(raw);
    });
    groups.forEach((arr, key) => pushCat(key, arr));
    return out;
  }

  if (typeof src === 'object') {
    // (c) { '分類名': [ ... ] } のかたち
    Object.keys(src).forEach((k) => {
      const v = src[k];
      if (Array.isArray(v)) pushCat(k, v);
      else if (v && (v.items || v.words)) pushCat(v.name || k, v.items || v.words);
    });
  }
  return out;
}

/** サンプルを [{name, code}] に そろえる */
function normSamples(src) {
  const out = [];
  if (!src) return out;
  if (Array.isArray(src)) {
    src.forEach((s, i) => {
      if (!s) return;
      if (typeof s === 'string') { out.push({ name: 'サンプル ' + (i + 1), code: s }); return; }
      const code = s.code || s['コード'] || s.src || s.source || '';
      const name = s.name || s.title || s['なまえ'] || ('サンプル ' + (i + 1));
      const desc = s.desc || s['いみ'] || s.description || '';
      if (code) out.push({ name: String(name), code: String(code), desc: String(desc), icon: s.icon || '' });
    });
  } else if (typeof src === 'object') {
    Object.keys(src).forEach((k) => {
      const v = src[k];
      const code = typeof v === 'string' ? v : (v && (v.code || v['コード'])) || '';
      if (code) out.push({ name: k, code: String(code), desc: (v && v.desc) || '' });
    });
  }
  return out;
}

// ぶんぽう（GRAMMAR）は 先頭の分類「ぶんぽう」として ならべる
const grammarCats = normCategories(GRAMMAR, 'ぶんぽう').map((c, i, all) => ({
  name: (all.length === 1 ? 'ぶんぽう' : 'ぶんぽう ／ ' + c.name),
  icon: c.icon || '📘',
  words: c.words
}));
const wordCats = normCategories(CATEGORIES, 'ことば');
const allCats  = grammarCats.concat(wordCats);
const samples  = normSamples(SAMPLES);

/* =======================================================================
   5. 単語帳パネル
   ======================================================================= */
// たたんでいる分類の なまえ。さいしょは ぜんぶ たたんでおく
// （分類の 一覧が ひと目で 見えるので、目あての ことばを さがしやすい）
const closedCats = new Set();

let dictFirst = true;          // さいしょに ひらいたとき だけ ぜんぶ たたむ

function renderDict() {
  if (dictFirst) { dictFirst = false; allCats.forEach((c) => closedCats.add(c.name)); }
  const q = dictQ.value.trim().toLowerCase();
  dictList.textContent = '';

  let hit = 0;
  allCats.forEach((cat, idx) => {
    // さがす: tags と sig と desc の 部分一致
    const words = q
      ? cat.words.filter((w) =>
          (w.sig + ' ' + w.desc + ' ' + w.tags).toLowerCase().indexOf(q) >= 0)
      : cat.words;
    if (!words.length) return;
    hit += words.length;

    const box = document.createElement('section');
    box.className = 'cat';
    // さがしている間は ぜんぶ ひらいておく
    if (!q && closedCats.has(cat.name)) box.classList.add('closed');

    const h = document.createElement('button');
    h.className = 'cat-h';
    h.type = 'button';
    const hn = document.createElement('span');
    hn.textContent = (box.classList.contains('closed') ? '▸ ' : '▾ ')
                   + (cat.icon ? cat.icon + ' ' : '') + cat.name;
    const hc = document.createElement('span');
    hc.className = 'cnt';
    hc.textContent = words.length + 'こ';
    h.appendChild(hn); h.appendChild(hc);
    h.addEventListener('click', () => {
      if (closedCats.has(cat.name)) closedCats.delete(cat.name);
      else closedCats.add(cat.name);
      renderDict();
    });

    const body = document.createElement('div');
    body.className = 'cat-b';
    words.forEach((w) => body.appendChild(wordCard(w)));

    box.appendChild(h);
    box.appendChild(body);
    dictList.appendChild(box);
  });

  if (!hit) {
    const e = document.createElement('div');
    e.className = 'dict-empty';
    e.textContent = q ? '「' + dictQ.value + '」に あう ことばは ありません。\nひらがなで さがしてみよう。'
                      : '単語帳の データが まだ ありません。';
    dictList.appendChild(e);
  }
}

/** 1つの ことばの カード */
function wordCard(w) {
  const d = document.createElement('div');
  d.className = 'w';
  d.title = 'クリックすると コードに はいります';

  const sig = document.createElement('div');
  sig.className = 'sig';
  sig.textContent = w.sig;
  d.appendChild(sig);

  if (w.desc) {
    const de = document.createElement('div');
    de.className = 'desc';
    de.textContent = w.desc;
    d.appendChild(de);
  }
  if (w.ex) {
    const ex = document.createElement('div');
    ex.className = 'ex';
    ex.textContent = w.ex;
    // れい は コピーしたいので、ここを えらんでも カードは 反応しない
    ex.addEventListener('click', (e) => e.stopPropagation());
    d.appendChild(ex);
  }

  d.addEventListener('click', () => {
    insertAtCursor(w.insert || w.sig);
    closeDict();
  });
  return d;
}

function openDict() {
  dict.hidden = false;
  scrim.hidden = false;
  btnWords.setAttribute('aria-expanded', 'true');
  btnWords.classList.add('on');
  renderDict();
  dictQ.focus();
}
function closeDict() {
  dict.hidden = true;
  scrim.hidden = true;
  btnWords.setAttribute('aria-expanded', 'false');
  btnWords.classList.remove('on');
}

btnWords.addEventListener('click', () => { dict.hidden ? openDict() : closeDict(); });
dictClose.addEventListener('click', closeDict);
scrim.addEventListener('click', closeDict);
// 日本語を うっている とちゅう（IME）でも さがせるように input で ひろう
dictQ.addEventListener('input', renderDict);

/* =======================================================================
   6. サンプル
   ======================================================================= */
function renderSampleMenu() {
  popSample.textContent = '';
  if (!samples.length) {
    const e = document.createElement('div');
    e.className = 'dict-empty';
    e.textContent = 'サンプルが ありません';
    popSample.appendChild(e);
    return;
  }
  samples.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'item';
    b.type = 'button';
    const nm = document.createElement('span');
    nm.textContent = (s.icon ? s.icon + ' ' : '') + s.name;
    b.appendChild(nm);
    if (s.desc) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = s.desc;
      b.appendChild(sub);
    }
    b.addEventListener('click', () => { closePops(); loadSample(s); });
    popSample.appendChild(b);
  });
}

function loadSample(s) {
  // いまの コードが 消えてしまうので、かならず 聞く
  if (ta.value.trim() !== '' && ta.value !== s.code) {
    if (!confirm('いま かいている コードは 「' + s.name + '」で うわがきされて 消えます。\nよろしいですか？\n\n（消したくないときは「さくひん▾」→「＋ あたらしく つくる」）')) return;
  }
  if (running) stopRun();
  ta.value = s.code;
  clearErrorMarks();
  renderGutter(true);
  ta.scrollTop = 0; syncScroll();
  flushSave();
  logSys('サンプル「' + s.name + '」を よみこみました。▶ プレイ を おしてみよう');
}

/* =======================================================================
   7. とびだすメニューの あけしめ
   ======================================================================= */
function closePops() {
  popSample.hidden = true;
  popWorks.hidden = true;
  btnSample.setAttribute('aria-expanded', 'false');
  btnWorks.setAttribute('aria-expanded', 'false');
}
function togglePop(pop, btn) {
  const willOpen = pop.hidden;
  closePops();
  if (willOpen) {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
}
btnSample.addEventListener('click', (e) => { e.stopPropagation(); renderSampleMenu(); togglePop(popSample, btnSample); });
btnWorks .addEventListener('click', (e) => { e.stopPropagation(); renderWorksMenu();  togglePop(popWorks,  btnWorks);  });
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest || !e.target.closest('.menu')) closePops();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePops(); if (!dict.hidden) closeDict(); }
});

/* =======================================================================
   8. ゲームを うごかす
   ======================================================================= */
let game = null;         // runtime.js の Game
let runner = null;       // lang.js の Runner
let running = false;     // いま うごいているか
let rafId = 0;
let lastT = 0;
// プレイヤーは さいしょから いて、コードが 空でも 歩けます。
// なので コードが おわっても ゲームは 止めません。
// 止まるのは とめる() / ゲームしゅうりょう() が よばれたときだけです。

/** Game は 1回だけ 作る（attachInput も 1回だけ） */
function ensureGame() {
  if (game) return game;
  game = new Game(canvas);
  game.onLog  = (t) => logLine(String(t));
  game.onStop = () => { if (running) stopRun('ゲームが とまりました'); };
  game.attachInput();
  return game;
}

function setRunUI(on) {
  running = on;
  btnRun.classList.toggle('running', on);
  runIcon.textContent = on ? '■' : '▶';
  runLabel.textContent = on ? 'ストップ' : 'プレイ';
  btnRun.title = on ? 'ストップ' : 'プレイ';
}

function run() {
  if (running) { stopRun('ストップしました'); return; }

  flushSave();
  clearErrorMarks();

  const src = ta.value;
  const g = ensureGame();
  g.reset();

  // 1. まず ことばを 読む（だめなら KotodamaError）
  let program;
  try {
    program = parse(src);
  } catch (err) {
    showError(err);
    logSys('うごかせませんでした。上の 赤い ところを クリックすると その行に とびます');
    return;
  }

  // 2. うごかす人（Runner）を つくる
  try {
    runner = new Runner(program, g.builtins(), (err) => {
      showError(err);
      stopRun();
    });
  } catch (err) {
    showError(err);
    return;
  }

  // 「まいかい」「おしたとき」が あるプログラムは、
  // トップレベルが おわっても キー待ちで うごきつづける。


  stageHint.hidden = true;
  setRunUI(true);
  stageWrap.focus();          // 矢印キーが すぐ きくように

  try {
    runner.start();
  } catch (err) {
    showError(err);
    stopRun();
    return;
  }

  logOk('▶ プレイちゅう');
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(now) {
  if (!running) return;
  rafId = requestAnimationFrame(tick);

  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.05) dt = 0.05;      // タブを もどした直後に 飛ばないように

  try {
    game.beginFrame(dt);
    runner.frame(dt);
    game.endFrame();
  } catch (err) {
    showError(err);
    stopRun();
    return;
  }

  if (game.stopped) { stopRun('ゲームが おわりました'); return; }
  // コードが おわっても、プレイヤーで あそべるので 止めません。
}

function stopRun(msg) {
  if (!running && !rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
  if (runner) { try { runner.stop(); } catch (_) {} }
  setRunUI(false);
  if (msg) logSys('■ ' + msg);
}

btnRun.addEventListener('click', run);

/* =======================================================================
   9. キーを だれに わたすか

   ・ゲームの がめんを クリックしているとき → ゲームへ。
     矢印キーと スペースで ページが スクロールしないように 止める。
   ・コードを かいている ときは、ゲームに キーを わたさない。

   ※ この capture の listener を game.attachInput() より先に つけておくと、
     runtime.js が window/document に つけた listener より 先に 走れる。
   ======================================================================= */
const KEY_JP = {
  ArrowRight: 'みぎ', ArrowLeft: 'ひだり', ArrowUp: 'うえ', ArrowDown: 'した',
  ' ': 'スペース', Spacebar: 'スペース', Space: 'スペース',
  Enter: 'エンター', Shift: 'シフト'
};
const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                     ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End'];

/** ブラウザのキー名を ことだまの キー名に する。分からなければ null */
function keyName(e) {
  if (KEY_JP[e.key]) return KEY_JP[e.key];
  if (e.code && KEY_JP[e.code]) return KEY_JP[e.code];
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase();
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (/^Key[A-Z]$/.test(e.code || '')) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code || '')) return e.code.slice(5);
  return null;
}

function stageHasFocus() {
  const a = document.activeElement;
  return !!a && (a === stageWrap || stageWrap.contains(a));
}

function onKeyCapture(e) {
  if (stageHasFocus() && dict.hidden) {
    // ゲームの ばん。ページが スクロールしないように 止める。
    if (SCROLL_KEYS.indexOf(e.key) >= 0) e.preventDefault();
    if (e.type === 'keydown' && !e.repeat && running && runner) {
      const n = keyName(e);
      if (n) { try { runner.press(n); } catch (err) { showError(err); } }
    }
    return;   // runtime.js の listener に そのまま わたす
  }
  // コードを かいている ときなど。ゲーム用のキーは ゲームに 見せない。
  if (keyName(e)) e.stopImmediatePropagation();
}
window.addEventListener('keydown', onKeyCapture, true);
window.addEventListener('keyup', onKeyCapture, true);

// ゲームの がめんを さわったら、そこに フォーカスを うつす
stageWrap.addEventListener('pointerdown', () => stageWrap.focus());
stageWrap.addEventListener('focus', () => stageWrap.classList.add('focused'));
stageWrap.addEventListener('blur',  () => stageWrap.classList.remove('focused'));

/* =======================================================================
   10. さいしょに 1回だけ やること
   ======================================================================= */
function boot() {
  readMetrics();
  window.addEventListener('resize', () => { readMetrics(); applyErrorMarks(); syncScroll(); });

  store = loadStore();
  if (!store) {
    store = { v: 1, currentId: '', works: [] };
    const w = { id: newId(), name: 'はじめての さくひん', code: defaultCode(), updated: Date.now() };
    store.works.push(w);
    store.currentId = w.id;
    saveStore();
  }
  const w = currentWork();
  store.currentId = w.id;
  ta.value = w.code;
  workNameEl.textContent = w.name;
  setSaveState('ほぞんずみ', false);

  renderGutter(true);
  renderWorksMenu();
  renderSampleMenu();
  renderDict();

  logSys('ようこそ。コードを かいて ▶ プレイ を おしてね。');
  logSys('ことばが 分からなくなったら 📖単語帳 を ひらこう。');
}

boot();
