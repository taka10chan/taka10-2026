/* =======================================================================
   ことだま — app.js（画面ぜんたいの世話をする係）

   ここでやること
     ・ワールド一覧（箱・玉・筒・モデルを置く／選ぶ／複製／削除）
     ・設定パネル（名前・位置・大きさ・回転・色・壁・重力・見える）
     ・コードを書くところ（ワールド全体 と ものごとのスクリプト）
     ・▶ プレイ／■ ストップ と 1フレームずつのくり返し
     ・ログとエラーの表示（どのスクリプトの何行目か。クリックでその行へ飛ぶ）
     ・単語帳パネル（探す・分類・クリックで差しこむ）
     ・サンプルの読みこみ
     ・作品（localStorage への自動保存）

   ことばの中身（lang.js）・ゲームの中身（runtime.js）・単語帳のデータ
   （words.js）・3D をつかんで動かす道具（edit.js）は別の人が作っています。
   ここでは「呼ぶ」だけ。
   ======================================================================= */

import { parse, Runner, KotodamaError } from './lang.js';
import { Game } from './runtime.js';
import { CATEGORIES, GRAMMAR, SAMPLES } from './words.js';
import { 予測 } from './suggest.js';

/* =======================================================================
   0. 画面の部品をつかまえる
   ======================================================================= */
const $ = (id) => document.getElementById(id);

const ta         = $('code');       // コードを書く textarea
const gutter     = $('gutter');     // 行番号
const hlLayer    = $('hlLayer');    // 行を光らせる下敷き
const codeTabs   = $('codeTabs');   // コードのタブ
const codeWhere  = $('codeWhere');  // 「コードを書くところ」の見出し
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

// ワールドまわり
const worldPane  = $('worldPane');
const worldList  = $('worldList');
const btnFold    = $('btnFold');
const propEmpty  = $('propEmpty');
const propBox    = $('propBox');
const propTarget = $('propTarget');
const pName      = $('pName');
const pNameErr   = $('pNameErr');
const pModelRow  = $('pModelRow');
const pModel     = $('pModel');
const pColor     = $('pColor');
const pColorText = $('pColorText');
const pWall      = $('pWall');
const pGrav      = $('pGrav');
const pVis       = $('pVis');
const btnDup     = $('btnDup');
const btnDel     = $('btnDel');

// 数字の入力欄（設定パネルの id → 作品データのフィールド名）
const 数字欄 = {
  pX: 'x', pY: 'y', pZ: 'z',
  pW: '横', pH: '高さ', pD: '奥行き',
  pRY: '向き', pRX: '傾き'
};

// 道具のボタン（移動・大きさ・回転）
const 道具ボタン = { '移動': $('btnMove'), '大きさ': $('btnScale'), '回転': $('btnRot') };

/* =======================================================================
   1. ログ（書く() の出力・エラー・お知らせ）
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
  // たまりすぎると重くなるので、古いものから消す
  while (logBox.childElementCount > 400) logBox.removeChild(logBox.firstChild);
  logBox.scrollTop = logBox.scrollHeight;
}

/**
 * エラーを赤く出す。「[スクリプト名] ◯行目: メッセージ」＋「→ ヒント」。
 * クリックすると そのスクリプトのその行にカーソルが飛んで、行が光る。
 *
 * @param err        KotodamaError か ふつうのエラー
 * @param スクリプト  どのスクリプトで起きたか（'ワールド' か ものの名前）
 */
function showError(err, スクリプト) {
  let line = null, msg = '', hint = '';

  const isKoto = (err instanceof KotodamaError)
              || (err && (err.name === 'KotodamaError' || typeof err.line === 'number'));
  if (isKoto) {
    line = err.line;
    // lang.js の message には すでに「3行目: 」が ついていることがある。
    // ここでも行番号を出すので、二重にならないように外す。
    msg  = err.rawMessage || err.message || 'なにかおかしいです';
    msg  = String(msg).replace(/^\s*\d+\s*(ぎょうめ|行目)\s*[:：]\s*/, '');
    hint = err.hint || '';
  } else {
    // ことだま以外の（JS の）エラー。中学生には意味が分からないので言いかえる。
    msg  = 'プログラムを動かせませんでした（' + ((err && err.message) || err) + '）';
    hint = 'もう一度 ▶ プレイ を押してみよう';
  }

  // lang.js が「どのスクリプトか」を教えてくれるなら、そちらを優先する
  const 名 = (err && err.script) || スクリプト || 'ワールド';

  const d = document.createElement('div');
  d.className = 'li err';

  const sc = document.createElement('span');
  sc.className = 'scr';
  sc.textContent = '[' + 名 + '] ';
  d.appendChild(sc);

  if (typeof line === 'number' && line > 0) {
    const ln = document.createElement('span');
    ln.className = 'ln';
    ln.textContent = line + '行目: ';
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
    j.textContent = '（クリックするとそのスクリプトのその行に飛びます）';
    d.appendChild(j);
    d.addEventListener('click', () => スクリプトの行へ飛ぶ(名, line));
    エラー行を足す(スクリプトのキー(名), line);
  }

  pushLog(d);
}

$('btnClearLog').addEventListener('click', () => { logBox.textContent = ''; });

// 画面のどこかで JS の例外が出ても、真っ暗なまま黙らないようにする。
//
// ただし、使う人は英語が読めません。ブラウザが出す英語のメッセージを
// そのまま見せると、何が起きたのか分からずこわいだけなので、
//   ・気にしなくていいものは黙って捨てる
//   ・よくあるものは日本語に言いかえる
//   ・分からないものは日本語のひとことにして、英語は「くわしく」に落とす
// という3段がまえにします。

/** 出さなくていいもの（出ても害がない） */
const 気にしない = [
  'pointer lock',          // 画面をクリックする前に視点ロックを頼んだだけ
  'user gesture',
  'play() request',        // 音を鳴らそうとして止められただけ
  'autoplay',
  'ResizeObserver loop',   // ブラウザのよくある無害な警告
];

/** よくあるものを日本語に言いかえる */
const 言いかえ = [
  [/webgl|context lost|gpu/i,
   'この端末では 3D がうまく動かせないみたい。ブラウザを新しくするか、別の端末で試してみてね'],
  [/quota|storage/i,
   'この端末の保存場所がいっぱいです。いらない作品を消してみてね'],
  [/out of memory|allocation/i,
   'ものを作りすぎて重くなりました。全部消す() を使うか、数を減らしてみてね'],
  [/network|fetch|load/i,
   'ファイルの読みこみに失敗しました。ページを読みこみ直してみてね'],
];

function 内側のエラー(なま) {
  const t = String(なま == null ? '' : 中身(なま));
  if (!t) return;
  if (気にしない.some((k) => t.toLowerCase().includes(k))) return;

  for (const [しるし, にほんご] of 言いかえ) {
    if (しるし.test(t)) { logLine(にほんご, 'err'); return; }
  }
  logLine('内側でなにか起きました。▶ プレイ をもう一度押してみてね。', 'err');
  logLine('（くわしく: ' + t + '）', 'dim');
}

function 中身(v) { return (v && v.message) ? v.message : v; }

window.addEventListener('error', (e) => {
  内側のエラー(e.message || e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  内側のエラー(e.reason);
});

/* =======================================================================
   2. コードを書くところ（行番号・スクロール同期・行を光らせる）
   ======================================================================= */

let LH = 25;       // 1行の高さ(px)。CSS の --lh から取ってくる
let PADTOP = 10;   // コードの上のすきま(px)。CSS の --pad-top と同じ
let gutterCount = -1;                 // いま出ている行番号の数

/** スクリプトごとの「赤くする行」。キーは 'main' か ものの id */
const エラー行表 = new Map();

function readMetrics() {
  const cs = getComputedStyle(document.documentElement);
  const lh = parseFloat(cs.getPropertyValue('--lh'));
  const pt = parseFloat(cs.getPropertyValue('--pad-top'));
  if (lh > 0) LH = lh;
  if (pt >= 0) PADTOP = pt;
}

/** 行番号を作り直す（行の数が変わったときだけ） */
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

/** textarea のスクロールに行番号と下敷きを合わせる */
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

/** いま見ているスクリプトの「赤い行」の入れもの */
function いまのエラー行() {
  if (!エラー行表.has(表示中のキー)) エラー行表.set(表示中のキー, new Set());
  return エラー行表.get(表示中のキー);
}

function エラー行を足す(キー, line) {
  if (!エラー行表.has(キー)) エラー行表.set(キー, new Set());
  エラー行表.get(キー).add(line);
  if (キー === 表示中のキー) applyErrorMarks();
}

function clearErrorMarks() {
  エラー行表.clear();
  applyErrorMarks();
}

/** 赤い行番号と赤い下敷きをつけ直す */
function applyErrorMarks() {
  // 下敷きの赤いやつだけ消す（flash は残す）
  hlLayer.querySelectorAll('.hl.err').forEach((el) => el.remove());
  const kids = gutter.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.remove('err');
  いまのエラー行().forEach((line) => {
    if (kids[line - 1]) kids[line - 1].classList.add('err');
    makeHl(line, 'err');
  });
}

/** その行にカーソルを飛ばして、光らせる */
function jumpToLine(line) {
  const lines = ta.value.split('\n');
  if (line < 1) line = 1;
  if (line > lines.length) line = lines.length;

  let pos = 0;
  for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;

  ta.focus();
  ta.setSelectionRange(pos, pos + lines[line - 1].length);

  // 真ん中あたりに来るようにスクロール
  const want = (line - 1) * LH - ta.clientHeight / 2 + LH;
  ta.scrollTop = Math.max(0, want);
  syncScroll();

  const f = makeHl(line, 'flash');
  setTimeout(() => f.remove(), 1500);
}

/** 「[名前] 5行目」をクリックしたとき。そのスクリプトを開いてから飛ぶ */
function スクリプトの行へ飛ぶ(名, line) {
  const キー = スクリプトのキー(名);
  if (キー !== 表示中のキー) {
    if (キー === 'main') タブを開く('main');
    else { 選ぶ(キー); タブを開く(キー); }
  }
  jumpToLine(line);
}

/** スクリプト名（'ワールド' か ものの名前）→ タブのキー（'main' か id） */
function スクリプトのキー(名) {
  if (!名 || 名 === 'ワールド' || 名 === 'main') return 'main';
  const o = いまの作品().objects.find((x) => x.名前 === 名);
  return o ? o.id : 'main';
}

/** カーソルの所に文字を差しこむ（Ctrl+Z で戻せるように execCommand を使う） */
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

// --- textarea の基本の世話 ---
ta.addEventListener('scroll', syncScroll);
ta.addEventListener('input', onCodeChanged);

// Tab で字下げ（フォーカスがよそに飛ばないように止める）
ta.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  const s = ta.selectionStart, en = ta.selectionEnd;
  const val = ta.value;

  if (s === en && !e.shiftKey) {
    insertAtCursor('  ');           // ふつうはスペース2つ
    return;
  }
  // 選んでいる行をまとめて字下げ／戻す
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

/** コードが変わったときに呼ぶ */
function onCodeChanged() {
  const n = Math.max(1, ta.value.split('\n').length);
  // 行の数が変わったら、赤い印の行がずれるので消す
  if (n !== gutterCount) { エラー行表.delete(表示中のキー); applyErrorMarks(); }
  renderGutter();
  markDirty();
  // 一覧の 📄 マーク（コードが入っているか）を出し入れする
  renderWorldList();
}

/* =======================================================================
   3. 名前の決まり（画面側で守らせる）

   ワールドのものの名前は、そのままコードの変数になります。だから
     ・空白や記号は使えない
     ・数字から始められない
     ・同じ名前を2つ作れない
     ・ことだまが使うことば（箱・もし・終わり…）と同じにできない
   ======================================================================= */

/** 名前に使える字（ひらがな・カタカナ・漢字・英数字・_） */
const 名前の全体 = /^[A-Za-z0-9_ぁ-んァ-ヶーｦ-ﾟ一-龯々〆ヵヶ]+$/;
/** 1文字めに使える字（数字と長音はだめ） */
const 名前の最初 = /^[A-Za-z_ぁ-んァ-ヶ一-龯々〆ヵヶ]/;

/** ことだまが使うことば。ここに書いたものは名前にできない */
const 組み込みのことば = new Set();

function 予約語を集める() {
  // (1) 文法のことば（漢字・ひらがな 両方）
  const 文法 = [
    'もし', 'なら', 'そうでなければ', 'そうでなくもし', 'のあいだ', 'ずっと',
    'ひとつずつ', 'かつ', 'または', 'ではない', 'はい', 'いいえ', 'なし',
    '繰り返し', 'くりかえし', '回', 'かい', 'かいめ', '回目',
    '毎回', 'まいかい', '最初に', 'はじめに',
    '押したとき', 'おしたとき', '触れたとき', 'さわったとき',
    '手順', 'てじゅん', '返す', 'かえす', '抜ける', 'ぬける',
    '次へ', 'つぎへ', '終わり', 'おわり',
    '自分', 'じぶん', '相手', 'あいて'
  ];
  // (2) 組み込みのことば（SPEC2 A-4。漢字とひらがなの両方）
  const 組み込み = [
    '箱', 'はこ', '玉', 'たま', '筒', 'つつ', '看板', 'かんばん',
    '自分のモデル', 'じぶんのモデル', '消す', 'けす', '全部消す', 'ぜんぶけす',
    '動かす', 'うごかす', '置く', 'おく', '前へ', 'まえへ', '後ろへ', 'うしろへ',
    '右へ', 'みぎへ', '左へ', 'ひだりへ', '上へ', 'うえへ', '下へ', 'したへ',
    '回す', 'まわす', '傾ける', 'かたむける', '向ける', 'むける', '向かせる', 'むかせる',
    '色', 'いろ', '大きさ', 'おおきさ', '隠す', 'かくす', '見せる', 'みせる',
    '模様', 'もよう', '空の色', 'そらのいろ', '地面', 'じめん', 'ちめん',
    '地面を作る', 'じめんをつくる', '霧', 'きり',
    '重力', 'じゅうりょく', '壁にする', 'かべにする', '速さ', 'はやさ',
    'ジャンプ', '床にいる', 'ゆかにいる',
    'アニメ', 'アニメを止める', 'アニメをとめる', 'プレイヤーの姿', 'プレイヤーのすがた',
    'カメラを置く', 'カメラをおく', 'カメラを向ける', 'カメラをむける',
    'カメラを向かせる', 'カメラをむかせる', 'カメラを付ける', 'カメラをつける',
    'カメラの中に', 'カメラのなかに', 'マウスで見回す', 'マウスでみまわす',
    'カメラの向き', 'カメラのむき',
    '押されてる', 'おされてる', '押した', 'おした', 'ぶつかってる',
    '距離', 'きょり', '画面の横', 'がめんのよこ', '画面の縦', 'がめんのたて',
    'マウスX', 'マウスY', 'クリックした', 'クリック中', 'クリックちゅう',
    '乱数', 'らんすう', '整数', 'せいすう', '絶対値', 'ぜったいち',
    '最大', 'さいだい', '最小', 'さいしょう', '平方根', 'へいほうこん',
    'サイン', 'コサイン', '角度', 'かくど',
    'つなげる', '長さ', 'ながさ', '加える', 'くわえる', '取り除く', 'とりのぞく',
    '書く', 'かく', '待つ', 'まつ', '音', 'おと', '点数', 'てんすう',
    'メッセージ', 'ゲーム終了', 'ゲームしゅうりょう', '時間', 'じかん',
    '止める', 'とめる', '探す', 'さがす',
    'プレイヤー', '操作を切る', 'そうさをきる', 'プレイヤーを消す', 'プレイヤーをけす',
    '速さを変える', 'はやさをかえる', '一人称', 'いちにんしょう'
  ];
  // (3) 色とキーの名前
  const 色キー = [
    '赤', 'あか', '青', 'あお', '緑', 'みどり', '黄', 'きいろ', '白', 'しろ',
    '黒', 'くろ', '水色', 'みずいろ', 'ピンク', 'オレンジ', '紫', 'むらさき',
    '灰色', 'はいいろ', '茶色', 'ちゃいろ', '紺', 'こん',
    '右', 'みぎ', '左', 'ひだり', '上', 'うえ', '下', 'した',
    'スペース', 'エンター', 'シフト'
  ];

  [].concat(文法, 組み込み, 色キー).forEach((w) => 組み込みのことば.add(w));

  // (4) words.js（単語帳）に載っていることばも、まとめて禁止にする。
  //     単語帳が増えたら、そのぶん自動でここも増える。
  const 拾う一つ = (w) => {
    if (!w || typeof w !== 'object') return;
    const c = w.call || w.name;
    if (typeof c === 'string' && c && 名前の全体.test(c)) 組み込みのことば.add(c);
  };
  const 拾う = (list) => {
    [].concat(list || []).forEach((cat) => {
      if (!cat) return;
      const items = cat.words || cat.items || cat.entries;
      if (Array.isArray(items)) { items.forEach(拾う一つ); return; }
      拾う一つ(cat);
    });
  };
  try { 拾う(CATEGORIES); } catch (_) { /* words.js の形が違っても止めない */ }
  try { 拾う(GRAMMAR); }    catch (_) { /* 同上 */ }
}

/**
 * 名前を調べる。よければ null、だめなら日本語の理由を返す。
 * @param 名前   つけたい名前
 * @param 自分id  いま直しているものの id（自分自身とはぶつからない）
 */
function 名前のだめな理由(名前, 自分id) {
  const s = String(名前 == null ? '' : 名前).trim();
  if (!s) return '名前を入れてください。';
  if (/[ 　]/.test(String(名前))) {
    return '名前に空白は使えません。「あかい箱」のようにつめて書いてください。';
  }
  if (!名前の全体.test(s)) {
    return '名前に使えるのは ひらがな・カタカナ・漢字・英数字 だけです。記号は使えません。';
  }
  if (!名前の最初.test(s)) {
    return '名前を数字から始めることはできません。「箱1」のようにしてください。';
  }
  if (組み込みのことば.has(s)) {
    return '「' + s + '」はことだまが使うことばなので、名前にできません。別の名前にしてください。';
  }
  const かぶり = いまの作品().objects.find((o) => o.名前 === s && o.id !== 自分id);
  if (かぶり) return '「' + s + '」はもうワールドにあります。ちがう名前にしてください。';
  return null;
}

/** 「箱1」「箱2」…と、空いている名前を作る */
function 空いている名前(もと) {
  for (let i = 1; i < 9999; i++) {
    const n = もと + i;
    if (!名前のだめな理由(n, null)) return n;
  }
  return もと + Date.now().toString(36);
}

/* =======================================================================
   4. 作品（localStorage への自動保存）

   さわるキーは 'kotodama-works' ひとつだけ。
   ほかのページの 'gunarena-' で始まるデータにはぜったいさわらない。

   ★ここがいちばん大事★
   むかしの作品は「コードの文字列だけ」でした。新しい形（main と objects）に
   移すときに、書いたコードを1文字も失わないようにします。
   ======================================================================= */
const STORE_KEY = 'kotodama-works';

let store = null;         // { v, currentId, works:[ 作品 ] }
let saveTimer = 0;
let 移行しました = false;  // 古い形から直したか（ログでお知らせする）

function newId(あたま) {
  return (あたま || 'w') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 形ごとの決まった見た目 */
const 形の見本 = {
  '箱':   { 横: 4, 高さ: 4, 奥行き: 4, 色: '#7ec850' },
  '玉':   { 横: 3, 高さ: 3, 奥行き: 3, 色: '#e06b6b' },
  '筒':   { 横: 2, 高さ: 4, 奥行き: 2, 色: '#6b9be0' },
  'モデル': { 横: 2, 高さ: 2, 奥行き: 2, 色: '#d0d6dc' }
};
const 形のアイコン = { '箱': '🟩', '玉': '🔴', '筒': '🔵', 'モデル': '🧱' };

/** 数を読む。読めなければ もとの値 */
function 数(v, もと) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : もと;
}

/* -----------------------------------------------------------------------
   ものの「場所」（SPEC2 H-1）

   ワールドのものは2とおりの置きかたがあります。
     'ワールド' … 今までどおり画面に出る（既定）
     '倉庫'     … 画面に出ない。クローンのもとになる見本の置き場

   ★古い作品には `場所` が入っていません。そのときは 'ワールド' 扱いにします。
     ここを守らないと、前に作った作品のものが消えてしまいます。
   ----------------------------------------------------------------------- */
const 場所ワールド = 'ワールド';
const 場所倉庫     = '倉庫';

/** 保存されている `場所` を、決まった2つのどちらかにそろえる */
function 場所にする(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === 場所倉庫 || s === 'そうこ' || s === 'ソウコ' || s === 'storage') return 場所倉庫;
  return 場所ワールド;      // 空でも、知らない字でも、ワールド扱い
}

/** そのものが倉庫に入っているか */
function 倉庫にある(o) {
  return !!o && o.場所 === 場所倉庫;
}

/** 色を #rrggbb にそろえる */
function 色にする(v, もと) {
  const s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return もと;
}

/** ものの形をそろえる（古いデータでもこわれないように） */
function ものをならす(raw, い) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  let 形 = String(o.形 || o.かたち || o.shape || '箱');
  if (形 === 'はこ') 形 = '箱';
  if (形 === 'たま') 形 = '玉';
  if (形 === 'つつ') 形 = '筒';
  if (!形の見本[形]) 形 = '箱';
  const 見本 = 形の見本[形];
  const い2 = 数(い, 0);

  return {
    id:   String(o.id || newId('o')),
    名前: String(o.名前 || o.なまえ || o.name || (形 + (い2 + 1))),
    形:   形,
    // 場所（SPEC2 H-1）。書いてなければ 'ワールド'（古いデータもこわれない）
    場所: 場所にする(o.場所 != null ? o.場所 : o.ばしょ),
    モデル: (o.モデル == null && o.model == null) ? null : String(o.モデル != null ? o.モデル : o.model),
    x: 数(o.x, 0), y: 数(o.y, 見本.高さ / 2), z: 数(o.z, 0),
    横:   Math.max(0.1, Math.abs(数(o.横,   数(o.よこ,   見本.横)))),
    高さ: Math.max(0.1, Math.abs(数(o.高さ, 数(o.たかさ, 見本.高さ)))),
    奥行き: Math.max(0.1, Math.abs(数(o.奥行き, 数(o.おくゆき, 見本.奥行き)))),
    向き: 数(o.向き, 数(o.むき, 0)),
    傾き: 数(o.傾き, 数(o.かたむき, 0)),
    色:   色にする(o.色 != null ? o.色 : o.いろ, 見本.色),
    壁:   (o.壁   != null) ? !!o.壁   : ((o.かべ != null) ? !!o.かべ : true),
    重力: (o.重力 != null) ? !!o.重力 : ((o.じゅうりょく != null) ? !!o.じゅうりょく : false),
    見える: (o.見える != null) ? !!o.見える : ((o.みえる != null) ? !!o.みえる : true),
    コード: String(o.コード != null ? o.コード : (o.code != null ? o.code : ''))
  };
}

/**
 * 作品の形をそろえる。ここが「古いデータを1つも失わない」ための関門。
 *
 * 受けつける形:
 *   ・"…コード…"                    （文字列そのもの）
 *   ・{ code: "…" }                  （むかしの形）
 *   ・{ name: "…", code: "…" }        （むかしの形）
 *   ・{ name, main, objects:[…] }     （新しい形）
 */
function 作品をならす(raw, い) {
  const い2 = 数(い, 0);
  if (typeof raw === 'string') {
    return { id: newId(), name: '前の作品' + (い2 ? ' ' + (い2 + 1) : ''),
             main: raw, objects: [], updated: Date.now() };
  }
  const w = (raw && typeof raw === 'object') ? raw : {};

  // main を決める。むかしの code / source / コード も ぜんぶ拾う。
  let main = '';
  if (typeof w.main === 'string')            main = w.main;
  else if (typeof w.code === 'string')       main = w.code;       // ← むかしの形
  else if (typeof w['コード'] === 'string')  main = w['コード'];
  else if (typeof w.source === 'string')     main = w.source;
  else if (typeof w.src === 'string')        main = w.src;

  // main が見つからないときの、さいごの受け皿（名前が違っても拾う）
  if (!main) {
    for (const k of Object.keys(w)) {
      if (typeof w[k] === 'string' && /code|main|コード|ソース/i.test(k) && w[k].trim()) {
        main = w[k]; break;
      }
    }
  }

  const objs = Array.isArray(w.objects) ? w.objects
             : (Array.isArray(w['もの']) ? w['もの'] : []);

  return {
    id:   String(w.id || newId()),
    name: String(w.name || w['なまえ'] || w['名前'] || ('作品' + (い2 + 1))),
    main: String(main || ''),
    objects: objs.map(ものをならす),
    updated: 数(w.updated, Date.now())
  };
}

/** localStorage から読む。どんな古い形でも受け止める */
function loadStore() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (_) { return null; }
  if (!raw) return null;

  let o = null;
  try {
    o = JSON.parse(raw);
  } catch (_) {
    // JSON ですらない＝コードの文字列がそのまま入っていた。捨てずに作品にする。
    const w = 作品をならす(String(raw), 0);
    移行しました = true;
    return { v: 2, currentId: w.id, works: [w] };
  }

  let works = null;
  if (typeof o === 'string') {
    works = [o];                                   // "…コード…"
  } else if (Array.isArray(o)) {
    works = o;                                     // [ 作品, 作品, … ]
  } else if (o && Array.isArray(o.works)) {
    works = o.works;                               // { works: [...] }
  } else if (o && typeof o === 'object') {
    works = [o];                                   // { name, code } など1つだけ
  }
  if (!works || !works.length) return null;

  // 1つでも「古い形」があれば、あとでログに知らせる
  移行しました = works.some((w) =>
    typeof w === 'string' ||
    (w && typeof w === 'object' && !Array.isArray(w.objects))
  );

  const なおした = works.map(作品をならす);
  const cur = (o && o.currentId) ? String(o.currentId) : '';
  return {
    v: 2,
    currentId: なおした.some((w) => w.id === cur) ? cur : なおした[0].id,
    works: なおした
  };
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    setSaveState('保存済み', false);
  } catch (_) {
    setSaveState('保存できません', true);
  }
}

function setSaveState(text, dirty) {
  saveStateEl.textContent = text;
  saveStateEl.classList.toggle('dirty', !!dirty);
}

function いまの作品() {
  return store.works.find((w) => w.id === store.currentId) || store.works[0];
}

/** 1秒くらい手が止まったら保存する */
function markDirty() {
  setSaveState('保存中…', true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 1000);
}

/** いま textarea に出ているコードを、正しい行き先（main か もの）に書きこむ */
function コードを書き戻す() {
  const w = いまの作品();
  if (!w) return;
  if (表示中のキー === 'main') {
    w.main = ta.value;
  } else {
    const o = w.objects.find((x) => x.id === 表示中のキー);
    if (o) o.コード = ta.value;
  }
}

function flushSave() {
  clearTimeout(saveTimer);
  const w = いまの作品();
  if (!w) return;
  コードを書き戻す();
  w.updated = Date.now();
  saveStore();
}

function openWork(id) {
  flushSave();
  const w = store.works.find((x) => x.id === id);
  if (!w) return;
  if (running) stopRun('ストップしました');
  store.currentId = id;
  選択id = null;
  表示中のキー = 'main';
  clearErrorMarks();
  ta.value = w.main;
  renderGutter(true);
  ta.scrollTop = 0; syncScroll();
  workNameEl.textContent = w.name;
  saveStore();
  renderWorksMenu();
  renderWorldList();
  renderProps();
  renderTabs();
  予測変換.更新();     // 作品が変わったので 一覧を作り直す
  世界を作り直す();
  logSys('「' + w.name + '」を開きました');
}

function addWork(name, main, objects) {
  flushSave();
  const w = {
    id: newId(), name: name, main: main || '',
    objects: (objects || []).map(ものをならす), updated: Date.now()
  };
  store.works.push(w);
  store.currentId = w.id;
  選択id = null;
  表示中のキー = 'main';
  clearErrorMarks();
  ta.value = w.main;
  renderGutter(true);
  workNameEl.textContent = name;
  saveStore();
  renderWorksMenu();
  renderWorldList();
  renderProps();
  renderTabs();
  世界を作り直す();
  return w;
}

/** 作品メニューの中身を作る */
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
    sub.textContent = (w.objects.length + 'こ ／ '
                    + String(w.main || '').split('\n').length + '行 ／ ' + when(w.updated));
    b.appendChild(nm); b.appendChild(sub);
    b.addEventListener('click', () => { closePops(); if (w.id !== store.currentId) openWork(w.id); });

    const ren = tool('名前', '名前を変える', () => {
      const nn = prompt('新しい名前は？', w.name);
      if (nn && nn.trim()) {
        w.name = nn.trim();
        if (w.id === store.currentId) workNameEl.textContent = w.name;
        saveStore(); renderWorksMenu();
      }
    });
    const dup = tool('コピー', '複製する', () => {
      flushSave();
      closePops();
      addWork(w.name + ' のコピー', w.main,
              w.objects.map((o) => Object.assign({}, o, { id: newId('o') })));
      logSys('複製しました');
    });
    const del = tool('消す', '消す', () => {
      if (store.works.length <= 1) { alert('作品が1つしかないので消せません'); return; }
      if (!confirm('「' + w.name + '」を消します。元に戻せません。よろしいですか？')) return;
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
  add.textContent = '＋ 新しく作る';
  add.addEventListener('click', () => {
    closePops();
    const nn = prompt('新しい作品の名前は？', '作品' + (store.works.length + 1));
    if (nn === null) return;
    addWork((nn.trim() || '名前のない作品'), 出だしのコード(), []);
    logSys('新しい作品を作りました');
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

/** まっさらな作品の、はじめのコード */
function 出だしのコード() {
  return [
    '# ここにワールド全体のコードを書きます。',
    '# ▶ プレイ を押すと、プレイヤーがもう立っています。',
    '#   W A S D か矢印キーで歩く / スペースでジャンプ / シフトで走る',
    '',
    '# 左のワールド一覧で ＋箱 を押すと、ものを置けます。',
    '# 置いたものは、その名前でそのままコードに書けます。',
    '#   例）  色(箱1, "赤")',
    ''
  ].join('\n');
}

// ページを離れるときは かならず保存
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

/* =======================================================================
   5. ワールド一覧
   ======================================================================= */
let 選択id = null;        // いま選んでいるものの id（null なら選んでいない）

/* -----------------------------------------------------------------------
   最初からあるもの（プレイヤー・地面）

   この2つは 作品のデータ（objects）では ありません。runtime.js が
   ▶ プレイのたびに 作り直しているものです。だから objects には
   ぜったいに 書き足しません（保存の形が変わると、前に作った作品がこわれます）。

   選ぶときの id には、置いたものの id と ぜったいにぶつからない
   「@」で始まる合いことばを使います（置いたものの id は newId('o') が作るので
   かならず「o」で始まります）。
   ----------------------------------------------------------------------- */
const 組み込み一覧 = [
  {
    キー: '@地面', 名前: '地面', アイコン: '🟫',
    説明: '最初からある広い床です。コードでは 地面 と書けば そのまま使えます。'
  },
  {
    キー: '@プレイヤー', 名前: 'プレイヤー', アイコン: '🧍',
    説明: '最初からいる人です。コードでは プレイヤー と書けば そのまま使えます。'
  }
];
const 組み込みのキー集 = new Set(組み込み一覧.map((b) => b.キー));

/** その id は「最初からあるもの」か */
function 組み込みか(id) {
  return !!id && 組み込みのキー集.has(id);
}

/** 合いことばから 一覧の中身を引く */
function 組み込みを取る(キー) {
  return 組み込み一覧.find((b) => b.キー === キー) || null;
}

/**
 * runtime.js が持っている 本物の「もの」を取り出す。
 * これは 作品のデータでは ないので、ここで変えた値は 保存されません。
 * （▶ プレイのたびに runtime.js が 作り直すので、そのとき元に戻ります）
 */
function 組み込みの実体(キー) {
  if (!game || !組み込みか(キー)) return null;
  const プレイヤーか = (キー === '@プレイヤー');
  try {
    const 直に = プレイヤーか ? game.プレイヤー : (game.ちめん || game['地面']);
    if (直に && typeof 直に === 'object') return 直に;
  } catch (_) { /* 下の builtins() で もう一度さがす */ }
  try {
    const b = (typeof game.builtins === 'function') ? game.builtins() : null;
    const o = b ? (プレイヤーか ? b['プレイヤー'] : b['地面']) : null;
    if (o && typeof o === 'object') return o;
  } catch (_) { /* 3D がまだ出ていないときは null でよい */ }
  return null;
}

/** 一覧の見出し（「置いたもの」「倉庫」など）を1行足す */
function 一覧の見出し(文, 説明) {
  const h = document.createElement('div');
  h.className = 'whead';
  h.textContent = 文;
  if (説明) h.title = 説明;
  worldList.appendChild(h);
  return h;
}

/** 中身が無いときの案内を1つ足す */
function 一覧の案内(文) {
  const e = document.createElement('div');
  e.className = 'wempty';
  e.textContent = 文;
  worldList.appendChild(e);
}

/** ものの行を1つ作って一覧に足す */
function 一覧の行(o) {
  const 倉庫か = 倉庫にある(o);

  const b = document.createElement('button');
  b.className = 'witem' + (o.id === 選択id ? ' on' : '') + (倉庫か ? ' soko' : '');
  b.type = 'button';
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', o.id === 選択id ? 'true' : 'false');
  b.title = o.名前 + '（' + o.形 + '）'
          + (倉庫か ? '／倉庫にあります。画面には出ませんが、クローン() のもとになります' : '');

  const ic = document.createElement('span');
  ic.className = 'ico';
  ic.textContent = 形のアイコン[o.形] || '🟩';

  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = o.名前;

  b.appendChild(ic); b.appendChild(nm);

  // コードが入っているものには 📄 を出す
  const ある = (o.id === 表示中のキー) ? ta.value.trim() : String(o.コード || '').trim();
  if (ある) {
    const doc = document.createElement('span');
    doc.className = 'doc';
    doc.textContent = '📄';
    doc.title = 'スクリプトが入っています';
    b.appendChild(doc);
  }

  b.addEventListener('click', () => 選ぶ(o.id));
  worldList.appendChild(b);
}

/** 「最初からあるもの」の行を1つ作って一覧に足す（置いたものと同じ見た目） */
function 一覧の組み込みの行(b) {
  const えらんでいる = (b.キー === 選択id);

  const el = document.createElement('button');
  el.className = 'witem fixed' + (えらんでいる ? ' on' : '');
  el.type = 'button';
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', えらんでいる ? 'true' : 'false');
  el.title = b.説明 + '（ここで変えた値は ▶ プレイのたびに元に戻ります）';

  const ic = document.createElement('span');
  ic.className = 'ico';
  ic.textContent = b.アイコン;

  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = b.名前;

  el.appendChild(ic);
  el.appendChild(nm);
  el.addEventListener('click', () => 選ぶ(b.キー));
  worldList.appendChild(el);
}

/**
 * ワールド一覧を作り直す（SPEC2 H-1）。
 *
 *   最初からあるもの … 地面・プレイヤー（設定は変えられない）
 *   置いたもの       … 画面に出るもの
 *   倉庫             … 画面に出ない見本。クローンのもと
 *
 * 倉庫は、中身が0このときも見出しだけは出します。
 * 「そういう場所がある」と分からないと、だれも使えないからです。
 */
function renderWorldList() {
  const w = いまの作品();
  worldList.textContent = '';

  // --- 最初からあるもの（選ぶと 位置・向き・色などを その場で変えられる） ---
  一覧の見出し('最初からあるもの',
             'いつでもコードから使えます。ここで変えた値は ▶ プレイのたびに元に戻ります');
  組み込み一覧.forEach(一覧の組み込みの行);

  // --- 置いたもの と 倉庫 に分ける ---
  const 置いたもの = w.objects.filter((o) => !倉庫にある(o));
  const 倉庫のもの = w.objects.filter(倉庫にある);

  一覧の見出し('置いたもの（' + 置いたもの.length + 'こ）', '画面に出るものです');
  if (!置いたもの.length) {
    一覧の案内('まだ何もありません。下の ＋箱 を押してみよう。');
  } else {
    置いたもの.forEach(一覧の行);
  }

  一覧の見出し(
    倉庫のもの.length ? '📦 倉庫（' + 倉庫のもの.length + 'こ）' : '📦 倉庫（からっぽ）',
    '画面に出ない見本の置き場です。クローン() のもとになります'
  );
  if (!倉庫のもの.length) {
    一覧の案内('画面に出ない見本の置き場です。ものを選んで「倉庫へしまう」を押すと ここに入ります。'
             + 'コードで クローン(名前) と書くと いくつでも出せます。');
  } else {
    倉庫のもの.forEach(一覧の行);
  }

  // --- キーの案内（使う人は Ctrl+D を知りませんでした。見えるように書く） ---
  const k = document.createElement('div');
  k.className = 'wkeys';
  k.textContent = 'ものを選んで Ctrl+D で複製 ／ Del で削除';
  worldList.appendChild(k);
}

/**
 * ものを選ぶ。一覧・設定・コードのタブをまとめて合わせる。
 * @param id      ものの id（null で解除）
 * @param 三Dから  3D 画面でクリックされたときは true（ed.選ぶ を呼び返さない）
 */
function 選ぶ(id, 三Dから) {
  if (id === 選択id) { if (id) タブを開く(id); return; }
  flushSave();
  選択id = id || null;
  renderWorldList();
  renderProps();
  renderTabs();
  // 最初からあるもの（プレイヤー・地面）には コードのタブが ありません
  if (選択id && !組み込みか(選択id)) タブを開く(選択id); else タブを開く('main');
  if (ed && !三Dから) {
    try { ed.選ぶ(組み込みか(選択id) ? null : 選択id); } catch (_) { /* 道具が無くても平気 */ }
  }
}

/* =======================================================================
   6. 設定パネル
   ======================================================================= */

function 選んでいるもの() {
  if (!選択id) return null;
  return いまの作品().objects.find((o) => o.id === 選択id) || null;
}

function まるめる(n) {
  const v = 数(n, 0);
  return Math.round(v * 1000) / 1000;
}

/** 設定パネルを、選んでいるものの中身で書きかえる */
function renderProps() {
  // 最初からあるもの（プレイヤー・地面）は 出しかたが ちがう
  if (組み込みか(選択id)) { 組み込みの設定を出す(選択id); return; }
  組み込みの見た目(false, null);

  const o = 選んでいるもの();
  if (!o) {
    propBox.hidden = true;
    propEmpty.hidden = false;
    propTarget.textContent = '選んでいません';
    return;
  }
  propBox.hidden = false;
  propEmpty.hidden = true;
  propTarget.textContent = o.形 + (倉庫にある(o) ? '（倉庫）' : '');

  pName.value = o.名前;
  pName.classList.remove('bad');
  pNameErr.hidden = true;

  Object.keys(数字欄).forEach((id) => {
    const el = $(id);
    // 入力中の欄はじゃましない
    if (document.activeElement !== el) el.value = String(まるめる(o[数字欄[id]]));
  });

  倉庫ボタンを直す(o);

  pColor.value = o.色;
  pColorText.textContent = o.色;
  pWall.checked = !!o.壁;
  pGrav.checked = !!o.重力;
  pVis.checked  = !!o.見える;

  // モデルのときだけ「どのモデルか」を選ばせる
  if (o.形 === 'モデル') {
    pModelRow.hidden = false;
    モデル一覧を作る(o.モデル);
  } else {
    pModelRow.hidden = true;
  }
}

/** モデリング部屋のモデル名を <select> に並べる */
function モデル一覧を作る(いま) {
  pModel.textContent = '';
  let 表 = {};
  try { 表 = JSON.parse(localStorage.getItem('kotodama-models') || '{}') || {}; } catch (_) { 表 = {}; }
  const 名前たち = Object.keys(表);
  if (!名前たち.length) {
    const op = document.createElement('option');
    op.value = '';
    op.textContent = '（モデリング部屋で作ってください）';
    pModel.appendChild(op);
    return;
  }
  名前たち.forEach((n) => {
    const op = document.createElement('option');
    op.value = n; op.textContent = n;
    if (n === いま) op.selected = true;
    pModel.appendChild(op);
  });
  if (名前たち.indexOf(いま) < 0) pModel.selectedIndex = 0;
}

/**
 * 設定が変わったので、作品データと 3D の両方に反映する。
 * @param patch  { 高さ: 5 } のような、変わった分だけ
 */
function 設定を変える(patch) {
  const o = 選んでいるもの();
  if (!o) return;
  Object.assign(o, patch);
  markDirty();
  三Dに反映(o.id, patch);
}

/** 3D の見た目に反映する。編集の道具があればそれに任せる */
let 作り直しタイマー = 0;
function 三Dに反映(id, patch) {
  if (ed) {
    try { ed.更新(id, patch); return; } catch (_) { /* だめなら下で作り直す */ }
  }
  // 道具が無いときは、少し待ってからワールドを作り直す（打つたびに作らない）
  clearTimeout(作り直しタイマー);
  作り直しタイマー = setTimeout(() => { if (!running) 世界を作り直す(); }, 150);
}

// --- 名前 ---
pName.addEventListener('input', () => {
  if (組み込みか(選択id)) return;     // 最初からあるものの名前は 変えられない
  const o = 選んでいるもの();
  if (!o) return;
  const だめ = 名前のだめな理由(pName.value, o.id);
  if (だめ) {
    pName.classList.add('bad');
    pNameErr.textContent = だめ;
    pNameErr.hidden = false;
    return;
  }
  pName.classList.remove('bad');
  pNameErr.hidden = true;
  o.名前 = pName.value.trim();
  markDirty();
  renderWorldList();
  renderTabs();
  // コード欄の見出しも、新しい名前に合わせる
  if (表示中のキー === o.id) {
    codeWhere.textContent = '「' + o.名前 + '」のコード（自分 でそのものを指します）';
  }
});
// 直せないまま外れたら、元の名前に戻す（変な名前で保存されないように）
pName.addEventListener('blur', () => {
  if (組み込みか(選択id)) return;
  const o = 選んでいるもの();
  if (!o) return;
  if (名前のだめな理由(pName.value, o.id)) {
    pName.value = o.名前;
    pName.classList.remove('bad');
    pNameErr.hidden = true;
  }
});

// --- 数字（位置・大きさ・回転） ---
Object.keys(数字欄).forEach((id) => {
  const el = $(id);
  const フィールド = 数字欄[id];
  const 大きさ系 = (フィールド === '横' || フィールド === '高さ' || フィールド === '奥行き');

  el.addEventListener('input', () => {
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;                       // 打ちかけは待つ
    if (大きさ系) v = Math.max(0.1, Math.abs(v));
    const patch = {}; patch[フィールド] = v;
    // 最初からあるものは 作品のデータに書かず、3D のほうを直に変える
    if (組み込みか(選択id)) { 組み込みを変える(patch); return; }
    if (!選んでいるもの()) return;
    設定を変える(patch);
  });
  el.addEventListener('blur', () => renderProps());
});

// 数字のラベルを左右にドラッグしても増減できる（気持ちいいので）
document.querySelectorAll('.num .cap').forEach((cap) => {
  const id = cap.dataset.num;
  const el = $(id);
  const フィールド = 数字欄[id];
  const 大きさ系 = (フィールド === '横' || フィールド === '高さ' || フィールド === '奥行き');
  let つかんでいる = false, 前x = 0;

  cap.addEventListener('pointerdown', (e) => {
    if (!選んでいるもの() && !組み込みか(選択id)) return;
    つかんでいる = true; 前x = e.clientX;
    try { cap.setPointerCapture(e.pointerId); } catch (_) { /* 平気 */ }
    e.preventDefault();
  });
  cap.addEventListener('pointermove', (e) => {
    if (!つかんでいる) return;
    const 組み込み = 組み込みか(選択id);
    const o = 組み込み ? 組み込みの実体(選択id) : 選んでいるもの();
    if (!o) return;
    const きざみ = (フィールド === '向き' || フィールド === '傾き') ? 1 : 0.25;
    let v = 数(o[フィールド], 0) + (e.clientX - 前x) * きざみ;
    前x = e.clientX;
    if (大きさ系) v = Math.max(0.1, v);
    v = Math.round(v * 100) / 100;
    const patch = {}; patch[フィールド] = v;
    if (組み込み) 組み込みを変える(patch); else 設定を変える(patch);
    el.value = String(v);
  });
  const はなす = (e) => {
    if (!つかんでいる) return;
    つかんでいる = false;
    try { cap.releasePointerCapture(e.pointerId); } catch (_) { /* 平気 */ }
  };
  cap.addEventListener('pointerup', はなす);
  cap.addEventListener('pointercancel', はなす);
});

// --- 色 ---
pColor.addEventListener('input', () => {
  pColorText.textContent = pColor.value;
  if (組み込みか(選択id)) { 組み込みを変える({ 色: pColor.value }); return; }
  設定を変える({ 色: pColor.value });
});

// --- 当たり判定のチェックボックス ---
pWall.addEventListener('change', () => {
  if (組み込みか(選択id)) { 組み込みの壁(pWall.checked); return; }
  設定を変える({ 壁: pWall.checked });
});
pGrav.addEventListener('change', () => {
  if (組み込みか(選択id)) { 組み込みの重力(pGrav.checked); return; }
  設定を変える({ 重力: pGrav.checked });
});
pVis .addEventListener('change', () => {
  if (組み込みか(選択id)) { 組み込みを変える({ 見える: pVis.checked }); return; }
  設定を変える({ 見える: pVis.checked });
});

// --- モデル ---
pModel.addEventListener('change', () => 設定を変える({ モデル: pModel.value || null }));

/* =======================================================================
   6b. 倉庫へしまう／ワールドへ出す（SPEC2 H-1）と、キーの案内

   index.html はさわらない約束なので、ここでボタンを作って設定パネルに
   差しこみます。「複製」「削除」のボタンのすぐ上に入れます。
   ======================================================================= */

/** 「倉庫へしまう」／「ワールドへ出す」のボタン */
const btnSoko = document.createElement('button');
btnSoko.type = 'button';
btnSoko.className = 'mini soko';
btnSoko.textContent = '倉庫へしまう';

/** ボタンの下に出す ひとこと説明 */
const sokoNote = document.createElement('div');
sokoNote.className = 'pnote';

/** キーの案内。使う人は Ctrl+D を知りませんでした（SPEC2 H-5） */
const keyNote = document.createElement('div');
keyNote.className = 'pkeys';
keyNote.textContent = 'Ctrl+D で複製 ／ Del で削除';

(function 設定パネルに差しこむ() {
  const 場所欄 = document.createElement('div');
  場所欄.className = 'pgroup';
  const 見出し = document.createElement('div');
  見出し.className = 'ptitle';
  見出し.textContent = '場所';
  場所欄.appendChild(見出し);
  場所欄.appendChild(btnSoko);
  場所欄.appendChild(sokoNote);

  const ボタン行 = btnDup.parentNode;           // index.html の .pbtns
  if (ボタン行 && ボタン行.parentNode) {
    ボタン行.parentNode.insertBefore(場所欄, ボタン行);
    // 「複製」ボタンのすぐ下に、キーの案内を出す
    if (ボタン行.nextSibling) ボタン行.parentNode.insertBefore(keyNote, ボタン行.nextSibling);
    else ボタン行.parentNode.appendChild(keyNote);
  } else {
    propBox.appendChild(場所欄);
    propBox.appendChild(keyNote);
  }
  // ボタンの文字にもキーを添えておく（見えるところに1回は書く）
  btnDup.textContent = '複製 Ctrl+D';
  btnDel.textContent = '削除 Del';
}());

/** 選んでいるものに合わせて、ボタンの文字を変える */
function 倉庫ボタンを直す(o) {
  if (倉庫にある(o)) {
    btnSoko.textContent = '⬅ ワールドへ出す';
    btnSoko.title = 'このものを倉庫から出して、画面に出します';
    sokoNote.textContent = 'いまは倉庫にあります。画面には出ませんが、名前でコードから使えます。';
  } else {
    btnSoko.textContent = '📦 倉庫へしまう';
    btnSoko.title = 'このものを倉庫にしまいます（画面から消えて、クローンのもとになります）';
    sokoNote.textContent = 'いまはワールドにあります。倉庫にしまうと画面から消えて、クローン() のもとになります。';
  }
}

/**
 * ものを 倉庫 ⇄ ワールド に移す。
 * 一覧の並びも 3D の見た目も その場で作り直します。
 */
function 場所を移す(id) {
  const o = いまの作品().objects.find((x) => x.id === (id || 選択id));
  if (!o) return;
  if (running) {
    logSys('▶ プレイ中は倉庫に移せません。■ ストップ を押してから もう一度どうぞ。');
    return;
  }
  const 倉庫へ = !倉庫にある(o);
  o.場所 = 倉庫へ ? 場所倉庫 : 場所ワールド;
  flushSave();
  renderWorldList();
  renderProps();
  世界を作り直す();                 // ★3D からも消える（倉庫は見た目を作らない）
  if (ed && 選択id) { try { ed.選ぶ(選択id); } catch (_) { /* 平気 */ } }
  if (倉庫へ) {
    logSys('「' + o.名前 + '」を倉庫にしまいました。画面からは消えますが、'
         + 'コードで クローン(' + o.名前 + ') と書くと いくつでも出せます。');
  } else {
    logSys('「' + o.名前 + '」をワールドに出しました。');
  }
}

btnSoko.addEventListener('click', () => 場所を移す(選択id));

/* =======================================================================
   6c. 最初からあるもの（プレイヤー・地面）の設定パネル

   使う人の言葉:
     「キャラの向きが変えられなーい」

   一覧の「最初からあるもの」を選んだときは、ふつうの設定パネルを
   すこし着がえさせて 使います（index.html はさわらない約束なので、
   足りない欄は ここで作って 差しこみます）。

   ★いちばん大事なこと★
     ここで変えた値は 作品のデータ（objects）には ぜったいに入れません。
     プレイヤーと地面は runtime.js が ▶ プレイのたびに 作り直すものなので、
     変えた値は プレイのたびに 元に戻ります。それが正しい動きです。
     「変えたのに戻った」で こまらないように、パネルの上に そう書いておきます。
   ======================================================================= */

// index.html にある欄（まとめて 出したり 消したり するために つかまえておく）
const 名前欄     = pName.closest('.prow');
const 位置欄     = $('pX').closest('.pgroup');
const 大きさ欄   = $('pW').closest('.pgroup');
const 回転欄     = $('pRY').closest('.pgroup');
const 色欄       = pColor.closest('.prow');
const 当たり欄   = pWall.closest('.pgroup');
const ボタン欄   = btnDup.closest('.pbtns');
const 場所欄     = btnSoko.closest('.pgroup');

/** 「▶ プレイのたびに元に戻ります」の案内（これが無いと 使う人が こまります） */
const 組み込み案内 = document.createElement('div');
組み込み案内.className = 'pnotice';
組み込み案内.hidden = true;
(function 案内の文を作る() {
  組み込み案内.appendChild(document.createTextNode(
    'ここで変えた値は、▶ プレイのたびに元に戻ります。ずっと変えたいときは、コードに '));
  const c = document.createElement('code');
  c.textContent = '向ける(プレイヤー, 90)';
  組み込み案内.appendChild(c);
  組み込み案内.appendChild(document.createTextNode(' のように書いてください。'));
}());

/** 名前の下に出す「変えられません」の ひとこと */
const 名前の注 = document.createElement('div');
名前の注.className = 'pnote';
名前の注.hidden = true;

/** プレイヤーの「大きさ（倍）」。体ぜんたいを 大きく・小さく します */
const 倍率欄   = document.createElement('div');
const 倍率入力 = document.createElement('input');
(function 倍率の欄を作る() {
  倍率欄.className = 'pgroup';
  倍率欄.hidden = true;

  const 見出し = document.createElement('div');
  見出し.className = 'ptitle';
  見出し.textContent = '大きさ';

  const 並び = document.createElement('div');
  並び.className = 'pnums';

  const ラベル = document.createElement('label');
  ラベル.className = 'num';
  const キャップ = document.createElement('span');
  キャップ.className = 'cap fixedcap';
  キャップ.textContent = '体の大きさ（倍）';

  倍率入力.type = 'number';
  倍率入力.step = '0.1';
  倍率入力.min = '0.1';
  倍率入力.setAttribute('aria-label', '体の大きさ（倍）');

  ラベル.appendChild(キャップ);
  ラベル.appendChild(倍率入力);
  並び.appendChild(ラベル);
  倍率欄.appendChild(見出し);
  倍率欄.appendChild(並び);
}());

(function 組み込みの欄を差しこむ() {
  // 案内は パネルのいちばん上
  propBox.insertBefore(組み込み案内, propBox.firstChild);
  // 名前の注は 名前のエラー欄の すぐ下
  if (pNameErr.parentNode) pNameErr.parentNode.insertBefore(名前の注, pNameErr.nextSibling);
  // 大きさ（倍）は ふつうの「大きさ」の すぐ下（どちらか片方だけ出します）
  if (大きさ欄 && 大きさ欄.parentNode) 大きさ欄.parentNode.insertBefore(倍率欄, 大きさ欄.nextSibling);
}());

/** 欄を出す／消す（無くても落ちない） */
function 欄をみせる(el, みせる) {
  if (el) el.hidden = !みせる;
}

/**
 * 設定パネルを「最初からあるもの」用に着がえさせる／もとに戻す。
 * @param オン  true なら 最初からあるもの用
 * @param キー  '@プレイヤー' か '@地面'
 */
function 組み込みの見た目(オン, キー) {
  const プレイヤーか = (キー === '@プレイヤー');

  欄をみせる(組み込み案内, オン);
  欄をみせる(名前の注, オン);

  // 大きさ … プレイヤーは「倍」ひとつ、地面は 横・高さ・奥行き
  欄をみせる(倍率欄, オン && プレイヤーか);
  欄をみせる(大きさ欄, !オン || !プレイヤーか);

  // 壁・重力・見える … プレイヤーは 自動で決まるので 出さない
  欄をみせる(当たり欄, !オン || !プレイヤーか);

  // 倉庫へしまう・複製・削除は、最初からあるものには 出さない
  欄をみせる(場所欄, !オン);
  欄をみせる(ボタン欄, !オン);
  欄をみせる(keyNote, !オン);

  // 名前は 最初からあるものでは 変えられない
  pName.readOnly = !!オン;
  pName.classList.toggle('locked', !!オン);
  pName.title = オン ? '最初からあるものの名前は変えられません' : '';
  if (オン) {
    pName.classList.remove('bad');
    pNameErr.hidden = true;
  }
}

/** プレイヤーの いまの「大きさ（倍）」 */
function 体の倍率(o) {
  const もと = 数(o.__もとたかさ, 0);
  if (!(もと > 0)) return 1;
  return 数(o.高さ, もと) / もと;
}

/** 設定パネルを「最初からあるもの」の中身で書きかえる */
function 組み込みの設定を出す(キー) {
  const b = 組み込みを取る(キー);
  if (!b) return;

  propBox.hidden = false;
  propEmpty.hidden = true;
  propTarget.textContent = b.名前 + '（最初からあるもの）';
  組み込みの見た目(true, キー);
  pModelRow.hidden = true;

  pName.value = b.名前;
  名前の注.textContent = '名前は変えられません。コードでは ' + b.名前 + ' と書けば そのまま使えます。';

  const o = 組み込みの実体(キー);
  if (!o) return;                 // 3D がまだ出ていないとき（数字は そのまま）

  const 入れる = (id, v) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = String(まるめる(v));
  };
  入れる('pX', o.x); 入れる('pY', o.y); 入れる('pZ', o.z);
  入れる('pRY', o.向き); 入れる('pRX', o.傾き);

  if (キー === '@プレイヤー') {
    if (document.activeElement !== 倍率入力) 倍率入力.value = String(まるめる(体の倍率(o)));
  } else {
    入れる('pW', o.横); 入れる('pH', o.高さ); 入れる('pD', o.奥行き);
    pWall.checked = !!o.__かべ;
    pGrav.checked = !!o.__じゅうりょく;
    pVis.checked  = (o.見える !== false);
  }

  const いろ = 色にする(o.色, '#ffffff');
  pColor.value = いろ;
  pColorText.textContent = いろ;
}

/**
 * 3D のほうを 直に変える。作品のデータには 何も書きません。
 * runtime.js は 毎フレーム このフィールドを見て 見た目に うつすので、
 * ここで入れれば その場で 画面が変わります。
 */
function 組み込みを変える(patch) {
  const o = 組み込みの実体(選択id);
  if (!o || !patch) return;
  try { Object.assign(o, patch); } catch (_) { /* こわれても 画面は止めない */ }
}

/** プレイヤーの体を 大きく・小さくする（大きさ(プレイヤー, 倍) と同じ） */
function 体の倍率を変える(倍) {
  const o = 組み込みの実体(選択id);
  if (!o) return;
  const ば = Math.max(0.1, Math.min(20, 数(倍, 1)));
  try {
    Object.assign(o, {
      横:   数(o.__もとよこ, 1) * ば,
      高さ: 数(o.__もとたかさ, 1) * ば,
      奥行き: 数(o.__もとおくゆき, 1) * ば
    });
  } catch (_) { /* 平気 */ }
}

/** 地面の「壁（通り抜けできない）」 */
function 組み込みの壁(オン) {
  const o = 組み込みの実体(選択id);
  if (!o) return;
  o.__かべ = !!オン;
  o.__かべ設定 = !!オン;
}

/** 地面の「重力（落ちる）」 */
function 組み込みの重力(オン) {
  const o = 組み込みの実体(選択id);
  if (!o) return;
  o.__じゅうりょく = !!オン;
  o.__じゅうりょく設定 = !!オン;
  if (!オン) o.__vy = 0;
}

/**
 * ワールドを作り直したあとに呼ぶ。
 * プレイヤーと地面は 作り直されて 元の値に戻っているので、
 * パネルの数字も そこに合わせ直します。
 */
function 組み込みなら設定を出し直す() {
  if (組み込みか(選択id)) renderProps();
}

倍率入力.addEventListener('input', () => {
  if (!組み込みか(選択id)) return;
  const v = parseFloat(倍率入力.value);
  if (!Number.isFinite(v) || v <= 0) return;      // 打ちかけは待つ
  体の倍率を変える(v);
});
倍率入力.addEventListener('blur', () => renderProps());

/* =======================================================================
   7. ものを置く・複製する・消す
   ======================================================================= */

/** 「プレイヤーの前あたり」＝いまカメラが見ている先を出す */
function 置く場所(高さ) {
  let x = 0, y = 高さ / 2, z = -8;
  try {
    const cam = game && game.camera;
    if (cam) {
      cam.updateMatrixWorld();
      // three.js の行列から、カメラの正面（-z 方向）を取り出す
      const m = cam.matrixWorld.elements;
      const fx = -m[8], fy = -m[9], fz = -m[10];
      x = cam.position.x + fx * 14;
      y = cam.position.y + fy * 14;
      z = cam.position.z + fz * 14;
    }
  } catch (_) { /* カメラが無くても平気 */ }
  // 0.5 きざみにそろえて、地面より下に行かないようにする
  const そろえる = (v) => Math.round(v * 2) / 2;
  return { x: そろえる(x), y: Math.max(高さ / 2, そろえる(y)), z: そろえる(z) };
}

/** ものを1つ足す。置いたらすぐ選んだ状態にする */
function ものを足す(形) {
  const w = いまの作品();
  const 見本 = 形の見本[形] || 形の見本['箱'];

  let モデル名 = null;
  if (形 === 'モデル') {
    let 表 = {};
    try { 表 = JSON.parse(localStorage.getItem('kotodama-models') || '{}') || {}; } catch (_) { 表 = {}; }
    const 名前たち = Object.keys(表);
    if (!名前たち.length) {
      logSys('モデルがまだありません。🧱モデリング部屋 で作ってから置いてください。');
      return null;
    }
    モデル名 = 名前たち[0];
  }

  const 場所 = 置く場所(見本.高さ);
  const o = ものをならす({
    形: 形,
    名前: 空いている名前(形),
    場所: 場所ワールド,        // ＋ボタンで置いたものは、いつも「置いたもの」に入る
    モデル: モデル名,
    x: 場所.x, y: 場所.y, z: 場所.z,
    横: 見本.横, 高さ: 見本.高さ, 奥行き: 見本.奥行き,
    色: 見本.色,
    壁: true, 重力: false, 見える: true,
    コード: ''
  }, w.objects.length);

  w.objects.push(o);
  flushSave();
  renderWorldList();
  世界を作り直す();
  選ぶ(o.id);
  logSys('「' + o.名前 + '」を置きました。設定の数字か、画面でつかんで動かせます。');
  return o;
}

/** ものを複製する（Ctrl+D） */
function 複製する(id) {
  const w = いまの作品();
  const もと = w.objects.find((o) => o.id === (id || 選択id));
  if (!もと) return;
  const コピー = Object.assign({}, もと, {
    id: newId('o'),
    名前: 空いている名前(もと.形),
    x: まるめる(数(もと.x, 0) + 2)
  });
  w.objects.push(コピー);
  flushSave();
  renderWorldList();
  世界を作り直す();
  選ぶ(コピー.id);
  logSys('「' + コピー.名前 + '」に複製しました。');
}

/** ものを消す（Del） */
function 削除する(id) {
  const w = いまの作品();
  const い = w.objects.findIndex((o) => o.id === (id || 選択id));
  if (い < 0) return;
  const o = w.objects[い];
  const コードあり = (o.id === 表示中のキー) ? ta.value.trim() : String(o.コード || '').trim();
  if (コードあり) {
    if (!confirm('「' + o.名前 + '」にはスクリプトが入っています。消すと元に戻せません。よろしいですか？')) return;
  }
  w.objects.splice(い, 1);
  if (表示中のキー === o.id) { 表示中のキー = 'main'; ta.value = w.main; renderGutter(true); }
  選択id = null;
  flushSave();
  renderWorldList();
  renderProps();
  renderTabs();
  世界を作り直す();
  logSys('「' + o.名前 + '」を消しました。');
}

$('btnAddBox')  .addEventListener('click', () => ものを足す('箱'));
$('btnAddBall') .addEventListener('click', () => ものを足す('玉'));
$('btnAddTube') .addEventListener('click', () => ものを足す('筒'));
$('btnAddModel').addEventListener('click', () => ものを足す('モデル'));
btnDup.addEventListener('click', () => 複製する(選択id));
btnDel.addEventListener('click', () => 削除する(選択id));

// ワールド一覧を畳む／広げる
btnFold.addEventListener('click', () => {
  const 畳む = !worldPane.classList.contains('folded');
  worldPane.classList.toggle('folded', 畳む);
  btnFold.textContent = 畳む ? '▶' : '◀ 畳む';
  btnFold.title = 畳む ? 'ワールド一覧を広げる' : 'ワールド一覧を畳む';
});

/* =======================================================================
   8. コードのタブ（「ワールド」と、選んでいるものの名前）
   ======================================================================= */
let 表示中のキー = 'main';     // 'main' か ものの id

function renderTabs() {
  codeTabs.textContent = '';

  const 作る = (キー, 名) => {
    const b = document.createElement('button');
    b.className = 'ctab' + (キー === 表示中のキー ? ' on' : '');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = 名;
    b.title = 名 + ' のコード';
    b.addEventListener('click', () => タブを開く(キー));
    codeTabs.appendChild(b);
  };

  作る('main', 'ワールド');
  const o = 選んでいるもの();
  if (o) 作る(o.id, o.名前);
}

/** タブを切りかえる。いま書いているコードは先に書き戻す */
function タブを開く(キー) {
  if (キー !== 'main' && !いまの作品().objects.some((o) => o.id === キー)) キー = 'main';
  if (キー === 表示中のキー) { renderTabs(); return; }

  コードを書き戻す();          // 今の中身をしまう
  表示中のキー = キー;

  const w = いまの作品();
  if (キー === 'main') {
    ta.value = w.main;
    codeWhere.textContent = 'ワールド全体のコード';
  } else {
    const o = w.objects.find((x) => x.id === キー);
    ta.value = o ? o.コード : '';
    codeWhere.textContent = '「' + (o ? o.名前 : '') + '」のコード（自分 でそのものを指します）';
  }
  renderGutter(true);
  ta.scrollTop = 0; syncScroll();
  applyErrorMarks();
  renderTabs();
  markDirty();
  予測変換.更新();     // 別のコードに変わったので 一覧を作り直す
}

/* =======================================================================
   9. 3D（ゲーム画面）と、手でつかんで動かす道具（edit.js）

   edit.js はまだ無いかもしれません。無くても画面がこわれないように、
   あったら使う・無かったら設定の数字だけで動かす、という作りにします。
   ======================================================================= */
let game = null;         // runtime.js の Game
let Editor = null;       // edit.js の Editor クラス（無ければ null）
let ed = null;           // その入れもの
let 道具名 = '移動';      // '移動' | '大きさ' | '回転'

/** Game は1回だけ作る（attachInput も1回だけ） */
function ensureGame() {
  if (game) return game;
  game = new Game(canvas);
  game.onLog  = (t) => logLine(String(t));
  game.onStop = () => { if (running) stopRun('ゲームが止まりました'); };
  // クローンができたら知らせてもらう（SPEC2 H-3）。中で running を見ています。
  game.onClone = クローンにコードを入れる;
  game.attachInput();
  return game;
}

/** edit.js を読みこむ（まだ無くてもエラーにしない） */
async function 編集の道具を読みこむ() {
  try {
    const m = await import('./edit.js');
    Editor = (m && m.Editor) || null;
  } catch (_) {
    Editor = null;
  }
}

/** 編集の道具を作り直す（game.reset() のあとは作り直す） */
function 編集器を作り直す() {
  if (ed) { try { ed.こわす(); } catch (_) { /* 平気 */ } ed = null; }
  if (!Editor || running || !game) return;
  try {
    ed = new Editor(game);
    ed.onSelect = (id) => 選ぶ(id, true);
    ed.onChange = (id, patch) => {
      const o = いまの作品().objects.find((x) => x.id === id);
      if (!o) return;
      Object.assign(o, patch);
      markDirty();
      if (id === 選択id) renderProps();
    };
    ed.onDuplicate = (id) => 複製する(id);
    ed.onDelete = (id) => 削除する(id);
    ed.有効(true);
    ed.道具(道具名);
    if (選択id) ed.選ぶ(選択id);
  } catch (_) {
    ed = null;
  }
}

/**
 * ワールドのものを 3D に作る。
 * 新しい runtime.js には buildWorld があります。まだ無いときのために、
 * 組み込みのことばを使って同じことをする道を用意しておきます。
 * @return { 名前: もの } の表
 */
function ワールドを作る(objects) {
  const list = objects || [];
  if (game && typeof game.buildWorld === 'function') {
    try { return game.buildWorld(list) || {}; } catch (_) { /* 下で自分で作る */ }
  }

  // --- ここから、buildWorld がまだ無いときの代わり ---
  const b = game.builtins();
  const 呼ぶ = function () {
    for (let i = 0; i < arguments.length; i++) {
      const n = arguments[i];
      if (typeof b[n] === 'function') return b[n];
    }
    return null;
  };
  const 作る箱     = 呼ぶ('箱', 'はこ');
  const 作る玉     = 呼ぶ('玉', 'たま');
  const 作る筒     = 呼ぶ('筒', 'つつ');
  const 作るモデル = 呼ぶ('自分のモデル', 'じぶんのモデル');
  const 色を塗る   = 呼ぶ('色', 'いろ');
  const 向ける     = 呼ぶ('向ける', 'むける');
  const 傾ける     = 呼ぶ('傾ける', 'かたむける');
  const 壁にする   = 呼ぶ('壁にする', 'かべにする');
  const 重力にする = 呼ぶ('重力', 'じゅうりょく');
  const 隠す       = 呼ぶ('隠す', 'かくす');

  if (!(game.世界のもの instanceof Map)) game.世界のもの = new Map();
  game.世界のもの.clear();

  const 表 = {};
  for (const o of list) {
    let もの = null;
    try {
      if (o.形 === '玉' && 作る玉)                          もの = 作る玉(o.x, o.y, o.z, o.横 / 2);
      else if (o.形 === '筒' && 作る筒)                     もの = 作る筒(o.x, o.y, o.z, o.横 / 2, o.高さ);
      else if (o.形 === 'モデル' && 作るモデル && o.モデル) もの = 作るモデル(o.x, o.y, o.z, o.モデル);
      else if (作る箱)                                      もの = 作る箱(o.x, o.y, o.z, o.横, o.高さ, o.奥行き);
    } catch (e) {
      logSys('「' + o.名前 + '」を置けませんでした（' + (e && e.message ? e.message : e) + '）');
      continue;
    }
    if (!もの) continue;

    try {
      if (色を塗る) 色を塗る(もの, o.色);
      if (o.向き && 向ける) 向ける(もの, o.向き);
      if (o.傾き && 傾ける) 傾ける(もの, o.傾き);
      // 倉庫のものは 見えない・当たらない・落ちない（SPEC2 H-1）。
      // 名前で呼べる「もの」としてだけ 残します。
      if (倉庫にある(o)) {
        if (隠す) 隠す(もの);
      } else {
        if (o.壁 && 壁にする) 壁にする(もの);
        if (o.重力 && 重力にする) 重力にする(もの, true);
        if (!o.見える && 隠す) 隠す(もの);
      }
    } catch (_) { /* 見た目が付かなくても、ものは残す */ }

    もの.__id = o.id;
    表[o.名前] = もの;
    game.世界のもの.set(o.id, もの);
  }
  return 表;
}

/** ワールドを作り直して、編集できる状態に戻す（止まっているとき用） */
function 世界を作り直す() {
  const g = ensureGame();
  try { g.reset(); } catch (_) { /* 作り直せなくても止めない */ }
  try { ワールドを作る(いまの作品().objects); } catch (_) { /* 同上 */ }
  編集器を作り直す();
  組み込みなら設定を出し直す();     // プレイヤーと地面は 作り直されたので 数字を入れ直す
  stageHint.hidden = !!(g && g.renderer);
}

/** 止まっているときの描画。物理もカメラも動かさず、絵だけ出す */
function 編集中の描画() {
  if (!game) return;
  try {
    if (typeof game.えがく === 'function') { game.えがく(); return; }
    if (typeof game._えがく === 'function') { game._えがく(); return; }
    if (game.renderer && game.scene && game.camera) game.renderer.render(game.scene, game.camera);
  } catch (_) { /* 絵が出なくても止めない */ }
}

// --- 道具のボタン（移動・大きさ・回転） ---
function 道具を選ぶ(名) {
  道具名 = 名;
  Object.keys(道具ボタン).forEach((k) => {
    if (道具ボタン[k]) 道具ボタン[k].classList.toggle('on', k === 名);
  });
  if (ed) { try { ed.道具(名); } catch (_) { /* 平気 */ } }
}
Object.keys(道具ボタン).forEach((k) => {
  if (道具ボタン[k]) 道具ボタン[k].addEventListener('click', () => 道具を選ぶ(k));
});

/* =======================================================================
   10. ゲームを動かす

   ▶ を押したら
     1. ワールドのものを全部作り直す
     2. ワールド全体のコード（main）を動かす
     3. ものごとのスクリプトを、一覧の上から順につなぐ
   ■ を押したら、ものは元の位置に戻る（遊んだ結果は保存しない）。
   ======================================================================= */
let runner = null;       // ワールド全体の Runner
let 子ランナー = [];      // attach がまだ無い runtime のための代わり
let running = false;     // いま動いているか
let rafId = 0;
let lastT = 0;
let 作り直し予約 = false; // ストップの直後に、次のフレームで作り直す

/* -----------------------------------------------------------------------
   クローンにコードを入れるための 覚え書き（SPEC2 H-2）

   キー   … さくひんの objects の id（クローンのもとになったもの）
   中身   … parse() の結果。null は「コードが無い」か「まちがいがあって読めない」

   ★ parse() は 重いので、同じ id では 1回しかしません。
     弾を毎フレーム撃つようなコードだと、ここを毎回やると すぐ重くなります。
   ★ ▶ を押すたびに 中身を捨てます（コードを直したのに 古いままだと 困るので）。
   ----------------------------------------------------------------------- */
const クローンのコード表 = new Map();

/**
 * クローンができた ちょうどそのときに runtime.js から呼ばれます（SPEC2 H-3）。
 *
 *   game.onClone = (新しいもの, もとのもの) => { … }
 *
 * ここで、もとのものに入っている コードを クローンにも つなぎます。
 * その中の `自分`（`じぶん`）は クローン自身を指します。
 * ★これが無いと「クローンでもスクリプトが動く」が成り立ちません。
 */
function クローンにコードを入れる(新しいもの, もとのもの) {
  if (!running || !runner || typeof runner.attach !== 'function') return;
  if (!新しいもの) return;

  // runtime.js が、さくひんの objects の id を __もとid に入れてくれています。
  // クローンのクローンでも、いちばん元の id を指したままになります。
  const もとid = (新しいもの.__もとid)
              || (もとのもの && (もとのもの.__もとid || もとのもの.__世界id))
              || null;
  if (!もとid) return;

  const 元 = いまの作品().objects.find((x) => x.id === もとid) || null;

  // すでに読んであれば それを使う（★毎回 parse しない★）
  let program = クローンのコード表.get(もとid);
  if (program === undefined) {
    const src = 元 ? String(元.コード || '') : '';
    if (!src.trim()) { クローンのコード表.set(もとid, null); return; }   // コードなし
    try {
      program = parse(src);
    } catch (err) {
      program = null;
      // まちがいの知らせは 1回だけ（下で null を覚えるので 2回目は来ません）
      showError(err, (元 && 元.名前) || 'クローン');
      logSys('（コードにまちがいがあるので、クローンでは動かしませんでした）');
    }
    クローンのコード表.set(もとid, program);
  }
  if (!program) return;

  const 名 = (元 && 元.名前) ? 元.名前 : String(新しいもの.__名前 || 'クローン');
  try {
    runner.attach(program, { 自分: 新しいもの, じぶん: 新しいもの }, 名);
  } catch (err) {
    showError(err, 名);
  }
}

function setRunUI(on) {
  running = on;
  btnRun.classList.toggle('running', on);
  runIcon.textContent = on ? '■' : '▶';
  runLabel.textContent = on ? 'ストップ' : 'プレイ';
  btnRun.title = on ? 'ストップ' : 'プレイ';
  // 動いている間は、つかんで動かす道具は使えない
  Object.keys(道具ボタン).forEach((k) => { if (道具ボタン[k]) 道具ボタン[k].disabled = on; });

  // ▶ プレイ中だけ、マウスで見回せるようにする。
  // 止まっているときにマウスを掴むと、ブラウザが
  // 「制限されています。Escで解除」と出してきて、
  // ものを選ぶだけのクリックの じゃまになります。
  if (game) game.プレイ中 = on;
  if (!on && typeof document !== 'undefined' && document.exitPointerLock) {
    try { document.exitPointerLock(); } catch (_) { /* 平気 */ }
  }
}

function run() {
  予測変換.とじる();          // 出しっぱなしの候補は しまっておく
  if (running) { stopRun('ストップしました'); return; }

  flushSave();
  clearErrorMarks();
  クローンのコード表.clear();   // ★覚えていた parse の結果は ここで捨てる

  const w = いまの作品();
  const g = ensureGame();

  // 編集の道具は切る（動いている間はさわれない）
  if (ed) { try { ed.有効(false); } catch (_) { /* 平気 */ } }

  // 1. ワールドのものを作り直す
  try { g.reset(); } catch (_) { /* 平気 */ }
  let 名前表 = {};
  try {
    名前表 = ワールドを作る(w.objects) || {};
  } catch (err) {
    showError(err, 'ワールド');
    return;
  }
  組み込みなら設定を出し直す();   // プレイヤーと地面は 作り直されたので 数字を入れ直す

  // 2. コードを読む。
  //    ★スクリプトごとに parse するので「どのスクリプトの何行目か」が分かります。
  //    1つ目でやめずに 全部 読んで、まちがいを まとめて 見せます。
  let mainProgram = null;
  let だめだった = false;

  try {
    mainProgram = parse(w.main || '');
  } catch (err) {
    showError(err, 'ワールド');
    だめだった = true;
  }

  const スクリプトたち = [];
  for (const o of w.objects) {
    const src = String(o.コード || '');
    if (!src.trim()) continue;
    try {
      const program = parse(src);
      // クローン用に覚えておく（クローンのたびに parse しなくてすむ）
      クローンのコード表.set(o.id, program);
      // ★倉庫のものは 見本なので、そのものでは動かしません。
      //   クローンにだけ このコードが つきます（ロブロックスの倉庫と同じ）。
      if (倉庫にある(o)) continue;
      スクリプトたち.push({ 名前: o.名前, もの: 名前表[o.名前] || null, program: program });
    } catch (err) {
      showError(err, o.名前);
      クローンのコード表.set(o.id, null);   // まちがいのあるコードは クローンにも つけない
      だめだった = true;
    }
  }

  if (だめだった) {
    logSys('動かせませんでした。上の赤いところをクリックすると、そのスクリプトのその行に飛びます');
    return;
  }

  // 3. 動かす人（Runner）を作る
  const 土台 = Object.assign({}, g.builtins(), 名前表);
  子ランナー = [];
  try {
    runner = new Runner(mainProgram, 土台, (err) => { showError(err, 'ワールド'); stopRun(); });
  } catch (err) {
    showError(err, 'ワールド');
    return;
  }

  // ★クローンができたら、もとのもののコードを クローンにも つなぐ（SPEC2 H-2）
  //   start() の前につないでおきます（「最初に」の中で クローンしても間に合うように）
  try { g.onClone = クローンにコードを入れる; } catch (_) { /* 古い runtime なら何もしない */ }

  stageHint.hidden = true;
  setRunUI(true);
  stageWrap.focus();          // 矢印キーがすぐ効くように

  try {
    runner.start();
  } catch (err) {
    showError(err, 'ワールド');
    stopRun();
    return;
  }

  // 4. ものごとのスクリプトをつなぐ
  for (const s of スクリプトたち) {
    const 追加 = { 自分: s.もの, じぶん: s.もの };
    if (typeof runner.attach === 'function') {
      try {
        runner.attach(s.program, 追加, s.名前);
      } catch (err) {
        showError(err, s.名前);
        stopRun();
        return;
      }
    } else {
      // まだ attach が無い lang.js のとき。別の Runner にして動かす。
      try {
        const 名 = s.名前;
        const r2 = new Runner(s.program, Object.assign({}, 土台, 追加),
                              (err) => { showError(err, 名); stopRun(); });
        r2.start();
        子ランナー.push(r2);
      } catch (err) {
        showError(err, s.名前);
        stopRun();
        return;
      }
    }
  }

  // 5. 「触れたとき」をつなぐ
  try {
    g.onTouch = (もの, 相手) => {
      if (runner && typeof runner.touch === 'function') {
        try { runner.touch(もの, 相手); } catch (err) { showError(err); }
      }
    };
  } catch (_) { /* 古い runtime なら何も起きない */ }

  logOk('▶ プレイ中'
      + (スクリプトたち.length ? '（スクリプト ' + スクリプトたち.length + 'こ）' : ''));
  lastT = performance.now();
}

/** いつでも回っている。動いているときはゲーム、止まっているときは絵だけ */
function tick(now) {
  rafId = requestAnimationFrame(tick);

  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.05) dt = 0.05;      // タブを戻した直後に飛ばないように

  if (!running) {
    // ストップの直後は、ここでワールドを元どおりに作り直す
    if (作り直し予約) {
      作り直し予約 = false;
      世界を作り直す();
      logSys('ものは元の場所に戻りました。');
    }
    編集中の描画();
    return;
  }

  try {
    game.beginFrame(dt);
    runner.frame(dt);
    for (const r of 子ランナー) r.frame(dt);
    game.endFrame();
  } catch (err) {
    showError(err);
    stopRun();
    return;
  }

  if (game.stopped) { stopRun('ゲームが終わりました'); return; }
  // コードが終わっても、プレイヤーで遊べるので止めません。
}

function stopRun(msg) {
  if (!running) return;
  if (runner) { try { runner.stop(); } catch (_) { /* 平気 */ } }
  for (const r of 子ランナー) { try { r.stop(); } catch (_) { /* 平気 */ } }
  子ランナー = [];
  runner = null;
  setRunUI(false);
  if (msg) logSys('■ ' + msg);
  // ★ ものは元の位置に戻る。遊んで動いた結果は保存しない（スタジオと同じ）
  作り直し予約 = true;
}

btnRun.addEventListener('click', run);

/* =======================================================================
   11. words.js のデータをならしてから使う

   words.js は別の人が書いています。形がすこし違っても
   こわれないように、ここでよくある形を受けとめておきます。
   ======================================================================= */

/** 1つのことばを { sig, desc, ex, insert, tags } にそろえる */
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
  // call（ことばの名前）も探せるようにタグに混ぜておく
  if (raw.call) tags = String(tags) + ' ' + raw.call;
  if (!sig && !desc) return null;
  return { sig: String(sig), desc: String(desc), ex: String(ex || ''),
           insert: String(insert), tags: String(tags) };
}

/** ことばの並びを [{name, words:[...]}] にそろえる */
function normCategories(src, fallbackName) {
  const out = [];
  if (!src) return out;

  const pushCat = (name, arr, icon) => {
    const words = [].concat(arr || []).map(normWord).filter(Boolean);
    if (words.length) out.push({ name: name || fallbackName || 'そのほか', icon: icon || '', words: words });
  };

  if (Array.isArray(src)) {
    // (a) [{name, items:[...]}, ...] の形
    const looksGrouped = src.some((c) => c && (c.items || c.words || c.entries || c['ことば']));
    if (looksGrouped) {
      src.forEach((c) => {
        if (!c) return;
        const items = c.items || c.words || c.entries || c['ことば'];
        pushCat(c.name || c.title || c['ぶんるい'] || c['分類'], items, c.icon);
      });
      return out;
    }
    // (b) 平たい配列。cat / category / 分類 があればそれでまとめる
    const groups = new Map();
    src.forEach((raw) => {
      if (!raw) return;
      const key = (raw.cat || raw.category || raw['ぶんるい'] || raw['分類'] || fallbackName || 'そのほか');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(raw);
    });
    groups.forEach((arr, key) => pushCat(key, arr));
    return out;
  }

  if (typeof src === 'object') {
    // (c) { '分類名': [ ... ] } の形
    Object.keys(src).forEach((k) => {
      const v = src[k];
      if (Array.isArray(v)) pushCat(k, v);
      else if (v && (v.items || v.words)) pushCat(v.name || k, v.items || v.words);
    });
  }
  return out;
}

/** サンプルを [{name, code}] にそろえる */
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
      // サンプルは、ワールドに置くもの（objects）も持てます。
      // 「触れたとき」を使うサンプルは、ものに入れたコードでないと動かないためです。
      const もの = Array.isArray(s.objects) ? s.objects
                 : (Array.isArray(s['もの']) ? s['もの'] : null);
      if (code) out.push({
        name: String(name), code: String(code), desc: String(desc),
        icon: s.icon || '', objects: もの,
      });
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

// 文法（GRAMMAR）は先頭の分類「文法」として並べる
const grammarCats = normCategories(GRAMMAR, '文法').map((c, i, all) => ({
  name: (all.length === 1 ? '文法' : '文法 ／ ' + c.name),
  icon: c.icon || '📘',
  words: c.words
}));
const wordCats = normCategories(CATEGORIES, 'ことば');
const allCats  = grammarCats.concat(wordCats);
const samples  = normSamples(SAMPLES);

/* =======================================================================
   12. 単語帳パネル
   ======================================================================= */
// 畳んでいる分類の名前。最初はぜんぶ畳んでおく
// （分類の一覧がひと目で見えるので、目あてのことばを探しやすい）
const closedCats = new Set();

let dictFirst = true;          // 最初に開いたときだけぜんぶ畳む

function renderDict() {
  if (dictFirst) { dictFirst = false; allCats.forEach((c) => closedCats.add(c.name)); }
  const q = dictQ.value.trim().toLowerCase();
  dictList.textContent = '';

  let hit = 0;
  allCats.forEach((cat) => {
    // 探す: tags と sig と desc の部分一致
    const words = q
      ? cat.words.filter((w) =>
          (w.sig + ' ' + w.desc + ' ' + w.tags).toLowerCase().indexOf(q) >= 0)
      : cat.words;
    if (!words.length) return;
    hit += words.length;

    const box = document.createElement('section');
    box.className = 'cat';
    // 探している間はぜんぶ開いておく
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
    e.textContent = q ? '「' + dictQ.value + '」に合うことばはありません。\n読み方（ひらがな）でも探せます。'
                      : '単語帳のデータがまだありません。';
    dictList.appendChild(e);
  }
}

/** 1つのことばのカード */
function wordCard(w) {
  const d = document.createElement('div');
  d.className = 'w';
  d.title = 'クリックするとコードに入ります';

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
    // 例はコピーしたいので、ここを選んでもカードは反応しない
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
// 日本語を打っている途中（IME）でも探せるように input で拾う
dictQ.addEventListener('input', renderDict);

/* =======================================================================
   13. サンプル
   ======================================================================= */
function renderSampleMenu() {
  popSample.textContent = '';
  if (!samples.length) {
    const e = document.createElement('div');
    e.className = 'dict-empty';
    e.textContent = 'サンプルがありません';
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
  const w = いまの作品();
  コードを書き戻す();

  // サンプルが持っているワールド（無ければ空にする）。
  // 前のサンプルのものが残っていると混乱するので、必ず入れかえます。
  const いま置いてある = Array.isArray(w.objects) ? w.objects.length : 0;
  const サンプルのもの = Array.isArray(s.objects)
    // id は今のワールドとぶつからないよう振り直す
    ? s.objects.map((o, i) => ものをならす(Object.assign({}, o, { id: newId('o') }), i))
    : [];

  // 今のものが消えてしまうので、かならず聞く
  const コードが消える = String(w.main || '').trim() !== '' && w.main !== s.code;
  const ものが消える = いま置いてある > 0;
  if (コードが消える || ものが消える) {
    const 消えるもの = [];
    if (コードが消える) 消えるもの.push('ワールド全体のコード');
    if (ものが消える) 消えるもの.push('ワールドに置いた ' + いま置いてある + ' このもの');
    if (!confirm('いまの' + 消えるもの.join('と')
               + 'は「' + s.name + '」で入れかわって消えます。\nよろしいですか？\n\n'
               + '（消したくないときは「作品▾」→「＋ 新しく作る」）')) return;
  }

  if (running) stopRun('ストップしました');
  w.main = s.code;
  w.objects = サンプルのもの;
  選択id = null;
  表示中のキー = 'main';
  ta.value = w.main;
  codeWhere.textContent = 'ワールド全体のコード';
  clearErrorMarks();
  renderGutter(true);
  ta.scrollTop = 0; syncScroll();
  renderWorldList();
  renderProps();
  renderTabs();
  flushSave();
  logSys('サンプル「' + s.name + '」を読みこみました。▶ プレイ を押してみよう');
  // ものにコードが入っているサンプルは、そこを見てもらわないと分かりません
  const コード持ち = (w.objects || []).filter((o) => String(o.コード || '').trim() !== '');
  if (コード持ち.length) {
    logSys('「' + コード持ち[0].名前 + '」にもコードが入っています。左の一覧で選ぶと見られます。');
  }
  // 倉庫を使うサンプルは、そこに気づいてもらわないと分かりません
  const 倉庫のもの = (w.objects || []).filter(倉庫にある);
  if (倉庫のもの.length) {
    logSys('「' + 倉庫のもの[0].名前 + '」は【倉庫】に入っています。画面には出ませんが、'
         + 'コードで クローン(' + 倉庫のもの[0].名前 + ') と書くと出てきます。');
  }
}

/* =======================================================================
   14. とびだすメニューの開け閉め
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

/* =======================================================================
   15. 予測変換（コード補完）   ★SPEC2 G章★

   ことばが 87語 ＋ 文法 25個。覚えられるわけがないので、打ちながら出します。
   一覧を出したり キーを見たりするのは src/suggest.js。
   ここでやるのは「候補を集めること」だけです。

   集めるもの:
     ・words.js の CATEGORIES（種類「ことば」）と GRAMMAR（種類「文法」）
     ・ワールドに置いたものの名前（種類「ワールド」）
     ・いま書いているコードの中で、使う人が作った変数と手順（種類「変数」）
     ・色の名前とキーの名前 … " の中を打っているときだけ

   ★読みの集めかた（ここが肝心。SPEC2 G-4）★
     「うご」と打って「動かす」が出ないと 意味がありません。
     words.js の tags は
         動かす ウゴカス うごかす move ugokasu 移動 ずらす 進む 相対
     のように、【前のほうが 読み】【後ろのほうが 似た意味のことば】です。
     そこで「漢字の入った tag が出てきたら そこで打ち切る」ことにしました。
     こうすると 読み（ウゴカス・うごかす・move・ugokasu）だけが きれいに取れ、
     「移動」「進む」のような よその意味のことばは 入りません。
     （入れてしまうと、「もし」の tag にある「おわり」のせいで
       「お」と打っただけで「もし」が出る、という へんなことになります）
   ======================================================================= */

/** 漢字が入っているか（読みの打ち切りに使う） */
const 漢字が入っている = /[一-龯々〆]/;

/**
 * ことば1つぶんの「読み」を集める。
 * @param 語   ことばの名前（漢字が正式）
 * @param tags words.js の tags（空白区切り）
 */
function 読みを集める(語, tags) {
  const 出 = [];
  const 足す = (s) => {
    const t = String(s == null ? '' : s).trim();
    if (t && 出.indexOf(t) < 0) 出.push(t);
  };
  足す(語);                                  // 漢字のつづりは かならず入れる
  const 並び = String(tags == null ? '' : tags).split(/[\s　]+/).filter(Boolean);
  for (const t of 並び) {
    if (t === 語) continue;                  // tags の先頭は たいてい 語そのもの
    if (漢字が入っている.test(t)) break;      // ここから先は 読みではないので おしまい
    足す(t);
    if (出.length >= 8) break;               // 多すぎても 使わない
  }
  return 出;
}

/**
 * 文法は「かたまりごと」入れます（SPEC2 G-6）。
 *   もし  なら
 *
 *   終わり
 * カーソルは 書き足したい所（もし なら 条件の所）に置きます。
 * 数字は「何文字めの うしろに カーソルを置くか」です。
 */
const 文法のかたまり = {
  'もし':             { 挿入: 'もし  なら\n  \n終わり',           カーソル: 3 },
  'そうでなくもし':   { 挿入: 'そうでなくもし  なら\n  ',          カーソル: 8 },
  'そうでなければ':   { 挿入: 'そうでなければ\n  ',                カーソル: 10 },
  '繰り返し':         { 挿入: '繰り返し  回\n  \n終わり',          カーソル: 5 },
  'のあいだ 繰り返し':{ 挿入: 'のあいだ 繰り返し\n  \n終わり',      カーソル: 12 },
  'ずっと':           { 挿入: 'ずっと\n  \n終わり',                カーソル: 6 },
  'ひとつずつ':       { 挿入: 'ひとつずつ 中身 = リスト\n  \n終わり', カーソル: 6 },
  '毎回':             { 挿入: '毎回\n  \n終わり',                  カーソル: 5 },
  '最初に':           { 挿入: '最初に\n  \n終わり',                カーソル: 6 },
  '押したとき':       { 挿入: '押したとき ( "" )\n  \n終わり',      カーソル: 9 },
  '触れたとき':       { 挿入: '触れたとき (相手)\n  \n終わり',      カーソル: 13 },
  '手順':             { 挿入: '手順 ()\n  \n終わり',               カーソル: 3 },
  '返す':             { 挿入: '返す ',                            カーソル: 3 },
};

/**
 * 単語帳には あるけれど、候補にしないもの。
 * 「ことばの書きかた」「ものを複製する」は ことばではなく 読みもの（説明の項目）で、
 * そのまま入れても コードになりません。かわりに 下の 足りない文法 で
 * 本当のことば（クローン）を 出します。
 */
const 候補にしないことば = new Set(['ことばの書きかた', 'ものを複製する', '=', '#', '[ ]', '[]']);

/**
 * words.js の 1項目を 候補の形にする。
 * 候補の形は SPEC2 G-7 のとおり { 語, 読み, 挿入, カーソル, 説明, 種類 }。
 */
function 候補にする(w, 種類) {
  if (!w || typeof w !== 'object') return null;
  const 語 = String(w.call || '').trim();
  if (!語 || 候補にしないことば.has(語)) return null;
  // = や # や [ ] は、打ちかけの語として つかまえられないので 出しません
  // （「のあいだ 繰り返し」のように 空白が入るものは 読みで探せるので 残します）
  if (!名前の最初.test(語)) return null;

  let 挿入 = (w.insert === undefined || w.insert === null) ? 語 : String(w.insert);
  let カーソル;

  const かたまり = (種類 === '文法') ? 文法のかたまり[語] : null;
  if (かたまり) {
    挿入 = かたまり.挿入;
    カーソル = かたまり.カーソル;
  } else {
    // 「箱(0, 5, 0, 4, 4, 4)」なら 最初の数字の所に カーソルを置く
    const か = 挿入.indexOf('(');
    if (か >= 0) カーソル = か + 1;
  }

  return {
    語: 語,
    読み: 読みを集める(語, w.tags),
    挿入: 挿入,
    カーソル: カーソル,
    説明: String(w.desc || w.sig || ''),
    種類: 種類,
  };
}

/** words.js の並び（分類つき・平たい、どちらでも）から 候補を集める */
function 候補を集める(元, 種類, 入れもの) {
  [].concat(元 || []).forEach((かたまり) => {
    if (!かたまり) return;
    const 中身 = かたまり.words || かたまり.items || かたまり.entries;
    if (Array.isArray(中身)) {
      中身.forEach((w) => { const c = 候補にする(w, 種類); if (c) 入れもの.push(c); });
      return;
    }
    const c = 候補にする(かたまり, 種類);
    if (c) 入れもの.push(c);
  });
  return 入れもの;
}

/**
 * 単語帳に 項目が無いけれど、書くときに いちばん要ることば。
 * （終わり は「もし」の説明の中にしか 出てこないので、ここで足します）
 */
const 足りない文法 = [
  { 語: '終わり', 読み: ['終わり', 'おわり', 'オワリ', 'owari', 'end'], 挿入: '終わり',
    説明: 'もし・繰り返し・毎回・手順 などの かたまりを ここで とじます。', 種類: '文法' },
  { 語: 'なら', 読み: ['なら', 'ナラ', 'nara'], 挿入: 'なら',
    説明: '「もし 条件 なら」の形で 使います。', 種類: '文法' },
  { 語: '回', 読み: ['回', 'かい', 'カイ', 'kai'], 挿入: '回',
    説明: '「繰り返し 5 回」の形で 使います。', 種類: '文法' },
  { 語: 'かいめ', 読み: ['かいめ', 'カイメ', '回目', 'kaime'], 挿入: 'かいめ',
    説明: '繰り返しの中で 1, 2, 3 … と 増えていく数です。', 種類: '文法' },
  // クローン は 単語帳では「ものを複製する」の中で 説明されていて、
  // ことばとしての 項目が ありません。ここで 足しておきます。
  { 語: 'クローン', 読み: ['クローン', 'くろーん', 'clone'], 挿入: 'クローン(もの)', カーソル: 5,
    説明: 'そっくり同じものを もう1つ作ります。弾や敵を 遊んでいる最中に 増やすときに 使います。',
    種類: 'ことば' },
];

/** ずっと変わらない候補（文法 → ことば の順。よく使うものが先） */
const いつもの候補 = 候補を集める(
  CATEGORIES, 'ことば',
  候補を集める(GRAMMAR, '文法', 足りない文法.slice())
);

/**
 * 色とキーの名前（SPEC2 A-5）。" の中を打っているときだけ 出します。
 * カタカナは「そろえた形」で当たるので、ひらがなを 1つ持たせれば足ります。
 */
const 色キーの候補 = [
  ['赤', 'あか'], ['青', 'あお'], ['緑', 'みどり'], ['黄', 'きいろ'],
  ['白', 'しろ'], ['黒', 'くろ'], ['水色', 'みずいろ'], ['ピンク', 'ぴんく'],
  ['オレンジ', 'おれんじ'], ['紫', 'むらさき'], ['灰色', 'はいいろ'],
  ['茶色', 'ちゃいろ'], ['紺', 'こん'],
].map(([語, よみ]) => ({
  語: 語, 読み: [語, よみ], 挿入: 語, 説明: '色の名前です。', 種類: 'ことば',
})).concat([
  ['右', 'みぎ'], ['左', 'ひだり'], ['上', 'うえ'], ['下', 'した'],
  ['スペース', 'すぺーす'], ['エンター', 'えんたー'], ['シフト', 'しふと'],
].map(([語, よみ]) => ({
  語: 語, 読み: [語, よみ], 挿入: 語, 説明: 'キーの名前です。', 種類: 'ことば',
})));

/** ワールドに置いたものの名前を 候補にする */
function ワールドの候補() {
  const w = いまの作品();
  const もの = (w && Array.isArray(w.objects)) ? w.objects : [];
  return もの.map((o) => ({
    語: String(o.名前 || ''),
    読み: [String(o.名前 || '')],
    挿入: String(o.名前 || ''),
    説明: 倉庫にある(o)
      ? '倉庫にある ' + (o.形 || 'もの') + ' です。クローン(' + o.名前 + ') で 増やせます。'
      : 'ワールドに置いた ' + (o.形 || 'もの') + ' です。そのまま 変数として 使えます。',
    種類: 'ワールド',
  })).filter((c) => c.語);
}

// --- 使う人が作った変数と手順を、いま書いているコードから ひろう -------
//     きっちり解析はしません。正規表現で 拾える ぶんだけで十分です。
const 名前の字 = '[A-Za-z0-9_ぁ-んァ-ヶーｦ-ﾟ一-龯々〆ヵヶ]+';
const 代入の形     = new RegExp('(^|\\n)[ \\t　]*(' + 名前の字 + ')[ \\t　]*=(?!=)', 'g');
const 手順の形     = new RegExp('(?:手順|てじゅん|テジュン)[ \\t　]+(' + 名前の字 + ')[ \\t　]*\\(([^)\\n]*)\\)', 'g');
const ひとつずつの形 = new RegExp('(?:ひとつずつ|ヒトツズツ)[ \\t　]+(' + 名前の字 + ')[ \\t　]*=', 'g');
const 受けとる形   = new RegExp('(?:触れたとき|さわったとき|サワッタトキ)[ \\t　]*\\([ \\t　]*(' + 名前の字 + ')', 'g');

/** いま書いているコードの中の 変数と手順を 候補にする */
function じぶんの候補() {
  const コード = ta.value;
  const 出 = [];
  const すでに = new Set();
  const 足す = (名, 説明) => {
    const s = String(名 || '').trim();
    if (!s || すでに.has(s)) return;
    if (/^[0-9]/.test(s)) return;               // 数字から始まる名前は ない
    if (組み込みのことば.has(s)) return;         // もし・箱 などは 変数ではない
    すでに.add(s);
    出.push({ 語: s, 読み: [s], 挿入: s, 説明: 説明, 種類: '変数' });
  };

  let m;
  代入の形.lastIndex = 0;
  while ((m = 代入の形.exec(コード))) 足す(m[2], '自分で作った変数です。');
  ひとつずつの形.lastIndex = 0;
  while ((m = ひとつずつの形.exec(コード))) 足す(m[1], '「ひとつずつ」で 取り出す名前です。');
  受けとる形.lastIndex = 0;
  while ((m = 受けとる形.exec(コード))) 足す(m[1], '「触れたとき」で 当たった相手です。');
  手順の形.lastIndex = 0;
  while ((m = 手順の形.exec(コード))) {
    足す(m[1], '自分で作った手順です。');
    String(m[2] || '').split(',').forEach((p) => 足す(p, '手順に わたすものの名前です。'));
  }
  return 出;
}

/** カーソルが 文字列（" の中）にいるか。色とキーの名前は ここでだけ 出します */
function 文字列の中にいる() {
  const 前 = ta.value.slice(0, ta.selectionEnd);
  const 行 = 前.slice(前.lastIndexOf('\n') + 1);
  return ((行.match(/"/g) || []).length % 2) === 1;
}

/**
 * suggest.js に わたす「候補ぜんぶ」。打つたびに 呼ばれるので 軽くします。
 * ・いつもの候補（文法・ことば）は 最初に1回 作ったものを 使いまわす
 * ・変わるところ（ワールドのもの・自分の変数）だけ そのつど 作る
 */
function 語彙をとる() {
  // " の中では 色とキーの名前だけ（SPEC2 G-3）
  if (文字列の中にいる()) return 色キーの候補;
  return いつもの候補.concat(ワールドの候補(), じぶんの候補());
}

/**
 * ★ここで 予測変換を 作ります★
 * このすぐ下の「16. キーを だれに わたすか」で、app.js は window の capture に
 * onKeyCapture を つけて、ゲーム用のキー（スペース・エンター・矢印）に
 * stopImmediatePropagation() をしています。
 * suggest.js も window の capture でキーを見るので、
 * ★かならず onKeyCapture より先に ここで作ってください★
 * （あとにすると スペースやエンターが suggest.js まで 届きません）
 */
const 予測変換 = new 予測(ta, 語彙をとる);
予測変換.onInsert = () => { markDirty(); };

/* =======================================================================
   16. キーを だれに わたすか

   ・ゲームの画面をクリックしているとき → ゲームへ。
     矢印キーとスペースでページがスクロールしないように止める。
   ・コードを書いているときは、ゲームにキーを渡さない。

   ※ この capture の listener を game.attachInput() より先につけておくと、
     runtime.js が window/document につけた listener より先に走れる。
   ======================================================================= */
const KEY_JP = {
  ArrowRight: '右', ArrowLeft: '左', ArrowUp: '上', ArrowDown: '下',
  ' ': 'スペース', Spacebar: 'スペース', Space: 'スペース',
  Enter: 'エンター', Shift: 'シフト'
};
const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                     ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End'];

/** ブラウザのキー名をことだまのキー名にする。分からなければ null */
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

/** 文字を打っている最中か（入力欄にいるか） */
function 文字を打っている() {
  const a = document.activeElement;
  if (!a) return false;
  const t = (a.tagName || '').toLowerCase();
  return t === 'input' || t === 'textarea' || t === 'select' || a.isContentEditable;
}

function onKeyCapture(e) {
  if (stageHasFocus() && dict.hidden) {
    // ゲームの番。ページがスクロールしないように止める。
    if (SCROLL_KEYS.indexOf(e.key) >= 0) e.preventDefault();
    if (e.type === 'keydown' && !e.repeat && running && runner) {
      const n = keyName(e);
      if (n) {
        try {
          runner.press(n);
          for (const r of 子ランナー) r.press(n);
        } catch (err) { showError(err); }
      }
    }
    return;   // runtime.js の listener にそのまま渡す
  }
  // ★Ctrl+D（複製）は ここで受けます★
  //   このすぐ下で「ゲーム用のキーはここで止める」ことにしているので、
  //   D を止めると、下の document のショートカットまで届きません。
  //   画面に「Ctrl+D で複製」と書いてあるのに効かないと 使う人が困るので、
  //   一覧や設定パネルを見ているときは ここで複製します
  //   （ゲーム画面を見ているときは 上で return しているので、下の document 側が受けます）。
  if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')
      && !文字を打っている() && 選択id && !組み込みか(選択id) && !running) {
    e.preventDefault();
    複製する(選択id);
  }
  // コードを書いているときなど。ゲーム用のキーはゲームに見せない。
  if (keyName(e)) e.stopImmediatePropagation();
}
window.addEventListener('keydown', onKeyCapture, true);
window.addEventListener('keyup', onKeyCapture, true);

// ---- 画面ぜんたいのショートカット ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePops(); if (!dict.hidden) closeDict(); return; }

  // 文字を打っている最中は、ショートカットを効かせない
  if (文字を打っている()) return;

  // Ctrl+D … 複製
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    if (選択id && !組み込みか(選択id) && !running) { e.preventDefault(); 複製する(選択id); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Del / Backspace … 消す
  if ((e.key === 'Delete' || e.key === 'Backspace')
      && 選択id && !組み込みか(選択id) && !running) {
    e.preventDefault(); 削除する(選択id); return;
  }
  // W / E / R … 道具を切りかえ（止まっているときだけ）
  if (!running) {
    if (e.key === 'w' || e.key === 'W') { 道具を選ぶ('移動'); return; }
    if (e.key === 'e' || e.key === 'E') { 道具を選ぶ('大きさ'); return; }
    if (e.key === 'r' || e.key === 'R') { 道具を選ぶ('回転'); return; }
  }
});

// ゲームの画面をさわったら、そこにフォーカスを移す
stageWrap.addEventListener('pointerdown', () => stageWrap.focus());
stageWrap.addEventListener('focus', () => stageWrap.classList.add('focused'));
stageWrap.addEventListener('blur',  () => stageWrap.classList.remove('focused'));
// 左ドラッグで画像のゴーストが出ないようにする
stageWrap.addEventListener('dragstart', (e) => e.preventDefault());

/* =======================================================================
   17. モデリング部屋に「R15」の見本モデルを入れておく

   アニメ部屋でそのまま歩きを作れるように、R15（15 パーツ）の見本を
   localStorage['kotodama-models'] に足します。
   ★同じ名前がもうあるときは、ぜったいに上書きしません。
   ======================================================================= */
const R15の色 = { はだ: '#f2c9a0', シャツ: '#3a7ad6', ズボン: '#37414d', くつ: '#232a33' };

/** SPEC2 C-2 の 15 パーツ。番号（0〜14）はアニメの part 番号と同じ順番 */
function R15の見本() {
  const p = (name, sx, sy, sz, x, y, z, color) => ({
    type: 'box',
    size: { x: sx, y: sy, z: sz },
    pos:  { x: x,  y: y,  z: z  },
    rot:  { x: 0,  y: 0,  z: 0  },
    color: color,
    name: name
  });
  const c = R15の色;
  return {
    parts: [
      /*  0 */ p('頭',     1.20, 1.10, 1.20,  0.00, 4.45, 0.00, c.はだ),
      /*  1 */ p('上胴',   1.60, 1.00, 0.85,  0.00, 3.15, 0.00, c.シャツ),
      /*  2 */ p('下胴',   1.55, 0.60, 0.85,  0.00, 2.35, 0.00, c.ズボン),
      /*  3 */ p('右上腕', 0.55, 0.85, 0.55,  1.07, 3.22, 0.00, c.シャツ),
      /*  4 */ p('右前腕', 0.52, 0.75, 0.52,  1.07, 2.42, 0.00, c.シャツ),
      /*  5 */ p('右手',   0.55, 0.35, 0.55,  1.07, 1.88, 0.00, c.はだ),
      /*  6 */ p('左上腕', 0.55, 0.85, 0.55, -1.07, 3.22, 0.00, c.シャツ),
      /*  7 */ p('左前腕', 0.52, 0.75, 0.52, -1.07, 2.42, 0.00, c.シャツ),
      /*  8 */ p('左手',   0.55, 0.35, 0.55, -1.07, 1.88, 0.00, c.はだ),
      /*  9 */ p('右腿',   0.60, 0.90, 0.62,  0.40, 1.60, 0.00, c.ズボン),
      /* 10 */ p('右脛',   0.57, 0.80, 0.60,  0.40, 0.75, 0.00, c.ズボン),
      /* 11 */ p('右足',   0.62, 0.35, 0.75,  0.40, 0.18, 0.02, c.くつ),
      /* 12 */ p('左腿',   0.60, 0.90, 0.62, -0.40, 1.60, 0.00, c.ズボン),
      /* 13 */ p('左脛',   0.57, 0.80, 0.60, -0.40, 0.75, 0.00, c.ズボン),
      /* 14 */ p('左足',   0.62, 0.35, 0.75, -0.40, 0.18, 0.02, c.くつ)
    ]
  };
}

function R15を入れておく() {
  let 表 = null;
  try {
    表 = JSON.parse(localStorage.getItem('kotodama-models') || '{}');
  } catch (_) {
    return;   // こわれていたらさわらない（人のデータを消さない）
  }
  if (!表 || typeof 表 !== 'object' || Array.isArray(表)) return;
  if (表['R15']) return;                       // ★すでにあるなら上書きしない
  表['R15'] = R15の見本();
  try {
    localStorage.setItem('kotodama-models', JSON.stringify(表));
  } catch (_) { /* 入らなくても止めない */ }
}

/* =======================================================================
   18. 最初に1回だけやること
   ======================================================================= */
async function boot() {
  readMetrics();
  window.addEventListener('resize', () => { readMetrics(); applyErrorMarks(); syncScroll(); });

  予約語を集める();
  R15を入れておく();

  // --- 作品を読む（古い形はここで直す） ---
  store = loadStore();
  if (!store) {
    const w = {
      id: newId(), name: 'はじめての作品',
      main: 出だしのコード(),
      objects: [ものをならす({
        形: '箱', 名前: '足場', x: 0, y: 2, z: -10,
        横: 8, 高さ: 1, 奥行き: 8, 色: '#7ec850',
        壁: true, 重力: false, 見える: true, コード: ''
      }, 0)],
      updated: Date.now()
    };
    store = { v: 2, currentId: w.id, works: [w] };
    saveStore();
  }
  const w = いまの作品();
  store.currentId = w.id;
  // 古い形から直したときは、その場で新しい形にして保存し直す
  // （直した中身は もう ぜんぶ store に入っているので、失うものは無い）
  if (移行しました) saveStore();
  表示中のキー = 'main';
  ta.value = w.main;
  codeWhere.textContent = 'ワールド全体のコード';
  workNameEl.textContent = w.name;
  setSaveState('保存済み', false);

  renderGutter(true);
  renderWorksMenu();
  renderSampleMenu();
  renderDict();
  renderWorldList();
  renderProps();
  renderTabs();

  // --- 3D を出す（止まっていても出しっぱなし） ---
  await 編集の道具を読みこむ();
  世界を作り直す();
  道具を選ぶ(道具名);
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);

  logSys('ようこそ。左の ＋箱 でものを置いて、右にコードを書いて ▶ プレイ を押してね。');
  logSys('ことばが分からなくなったら 📖単語帳 を開こう。');
  if (移行しました) {
    logOk('前に書いたコードは、そのまま「ワールド」のタブに入っています。');
  }
  if (!Editor) {
    logSys('（3D画面をつかんで動かす道具はまだ入っていません。設定の数字で動かせます）');
  }
}

boot();
