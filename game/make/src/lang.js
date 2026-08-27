// =====================================================================
//  ことだま — 日本語でゲームを作ることばの「処理系」
// =====================================================================
//
//  この 1 まいの ファイルで つぎの 3 つを やっています。
//
//    1. 字句解析（じくかいせき）… 文字の ならびを 「トークン」に わける
//    2. 構文解析（こうぶんかいせき）… トークンを 「木（き）」の かたちにする
//    3. 実行（じっこう）… その 木を たどって うごかす
//
//  実行の 部分は ぜんぶ ジェネレータ（function*）で 書いています。
//  そうすると 「まつ(1)」で とちゅうで 止まったり、
//  むげんループでも ブラウザが かたまらないように できます。
//
//  エラーは かならず 日本語で
//    「なん行め」「なにが だめ」「どうすれば いい」
//  の 3 つを つたえます。英語の エラーは 外に 出しません。
// =====================================================================


// =====================================================================
//  0. エラー
// =====================================================================

/**
 * ことだまの エラー。
 * line    … 何行め（1 から はじまる）
 * message … 日本語の 説明（「12行目: …」から はじまる）
 * script  … どの スクリプトで おきたか（ワールド全体の コードなら 空文字）
 * hint    … どうすれば いいか
 */
export class KotodamaError extends Error {
  constructor(line, message, hint) {
    super(message);
    this.name = 'KotodamaError';
    this.line = line;
    this.message = message;
    this.hint = hint || '';
    // どの スクリプトで おきたか（ワールドの ものに 入れた コードの 名前）。
    // ワールド全体の コード（main）なら 空文字。
    this.script = '';
  }
}

/**
 * 中で つかう エラー作りの ヘルパー。
 * message の あたまに「12行目: 」を くっつけて KotodamaError を 返す。
 * （行番号なしの 本文は rawMessage に 入れておく）
 */
function err(line, message, hint) {
  const n = (typeof line === 'number' && line > 0) ? Math.floor(line) : 1;
  const e = new KotodamaError(n, n + '行目: ' + message, hint || '');
  e.rawMessage = message;
  return e;
}

/** これは ことだまの エラー？（別モジュールから来ても 名前で 見分ける） */
function isKotodamaError(e) {
  return !!e && (e instanceof KotodamaError || e.name === 'KotodamaError');
}

/** どんな エラーでも かならず 日本語の KotodamaError にする */
function toKotodamaError(e, line) {
  if (isKotodamaError(e)) return e;
  const wrapped = err(
    line,
    'なにか困ったことが起きました。',
    'この行を見なおしてください'
  );
  // 中で なにが おきたかは detail に しまっておく（画面には 出さない）
  wrapped.detail = (e && e.message) ? String(e.message) : String(e);
  return wrapped;
}


// =====================================================================
//  1. 正規化（せいきか）… 全角で 打っても 動くようにする
// =====================================================================

// 全角 → 半角 の 対応表。
// ※「ー」(長音 U+30FC) は ことばの 一部なので ぜったいに 変えない。
//   変えるのは 全角ハイフンマイナス U+FF0D だけ。
const ZENKAKU_TABLE = {
  '（': '(', '）': ')',
  '、': ',', '，': ',',
  '＝': '=', '＋': '+',
  '－': '-',            // U+FF0D 全角ハイフンマイナス
  '＊': '*', '／': '/',
  '＜': '<', '＞': '>',
  '！': '!', '％': '%',
  '．': '.',
  '［': '[', '］': ']',
  '　': ' ',            // U+3000 全角スペース
  '＃': '#',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  // ここから下は 仕様の 表には ないけれど、日本語の キーボードで
  // よく 出てしまう「かざり かっこ」も " として あつかう（親切のため）
  '”': '"', '“': '"', '＂': '"'
};

// ---------------------------------------------------------------------
//  半角カタカナ（ﾊｺ）を 全角カタカナ（ハコ）に なおす
// ---------------------------------------------------------------------
//  U+FF66〜U+FF9D が 半角カタカナの 本体で、この 順に ならんでいます。
//  そのあと U+FF9E が 濁点（ﾞ）、U+FF9F が 半濁点（ﾟ）です。

const HANKAKU_KANA_HEAD = 0xFF66;
const HANKAKU_KANA_TABLE =
  'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';

/** 濁点が つく かな（ｶ + ﾞ → ガ） */
const DAKUTEN_MAP = (() => {
  const pairs = 'カガキギクグケゲコゴサザシジスズセゼソゾタダチヂツヅテデトドハバヒビフブヘベホボウヴ';
  const m = {};
  for (let i = 0; i < pairs.length; i += 2) m[pairs[i]] = pairs[i + 1];
  return m;
})();

/** 半濁点が つく かな（ﾊ + ﾟ → パ） */
const HANDAKUTEN_MAP = (() => {
  const pairs = 'ハパヒピフプヘペホポ';
  const m = {};
  for (let i = 0; i < pairs.length; i += 2) m[pairs[i]] = pairs[i + 1];
  return m;
})();

/** 半角カタカナが 入っていそうか（入っていなければ 何も しない） */
const HANKAKU_RE = /[\uFF61-\uFF9F]/;

/** 半角カタカナと 半角の 記号を 全角に なおす（文字数は 減ることが ある） */
function hankakuKanaToZenkaku(s) {
  if (!HANKAKU_RE.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    if (code >= HANKAKU_KANA_HEAD && code <= 0xFF9D) {
      let z = HANKAKU_KANA_TABLE[code - HANKAKU_KANA_HEAD];
      const nx = s[i + 1];
      if (nx === 'ﾞ' && DAKUTEN_MAP[z]) { z = DAKUTEN_MAP[z]; i++; }
      else if (nx === 'ﾟ' && HANDAKUTEN_MAP[z]) { z = HANDAKUTEN_MAP[z]; i++; }
      out += z;
      continue;
    }
    // 半角の 句読点・かぎかっこ・中点
    if (c === '｡') { out += '。'; continue; }
    if (c === '｢') { out += '「'; continue; }
    if (c === '｣') { out += '」'; continue; }
    if (c === '､') { out += '、'; continue; }
    if (c === '･') { out += '・'; continue; }
    out += c;
  }
  return out;
}

/**
 * 「そろえた形」を つくる。
 *
 *   カタカナ → ひらがな に なおしたもの。
 *     ハコ      → はこ
 *     ウゴカス  → うごかす
 *     メッセージ → めっせーじ   （小さい字も 長音符 ー も 正しく）
 *     ヴ        → ゔ
 *   漢字と ひらがなは そのまま。
 *
 * 名前を さがすときの 2段目（そのままの字で 見つからなかったとき）に つかいます。
 * runtime.js でも 色や キーの 名前を くらべるのに つかえるよう 外に 出しています。
 */
export function そろえた形(s) {
  let t = String(s == null ? '' : s);
  if (HANKAKU_RE.test(t)) t = hankakuKanaToZenkaku(t);
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0);
    // ァ(30A1)〜ヶ(30F6) だけを ひらがな(3041〜3096)に ずらす。
    // ー(30FC) ・(30FB) ヷ〜ヺ(30F7〜30FA) は そのまま。
    out += (c >= 0x30A1 && c <= 0x30F6) ? String.fromCharCode(c - 0x60) : ch;
  }
  return out;
}

/** 中では みじかい 名前で つかう */
const fold = そろえた形;

/** ソース全体を 先に きれいにする（行の 数は 変わらない） */
function normalize(source) {
  let src = String(source == null ? '' : source)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  // 半角カタカナは ここで 全角に そろえておく
  src = hankakuKanaToZenkaku(src);
  let out = '';
  // for..of は 絵文字（サロゲートペア）も 1 文字として あつかってくれる
  for (const ch of src) {
    const rep = ZENKAKU_TABLE[ch];
    out += (rep === undefined) ? ch : rep;
  }
  return out;
}


// =====================================================================
//  2. 字句解析（トークンに わける）
// =====================================================================

// キーワード（この ことばは とくべつな いみを もつ）
//
//  ★ 中で つかう「代表の つづり」は ひらがなの ままです。
//    こうすると 今までの 処理が そのまま うごきます。
//    漢字で 書かれたら ここで ひらがなに もどし、
//    人に 見せるときだけ 漢字に します（KEYWORD_DISPLAY）。
const KEYWORDS = [
  'もし', 'なら', 'そうでなければ', 'そうでなくもし', 'おわり',
  'くりかえし', 'かい', 'のあいだ', 'ずっと', 'ひとつずつ', 'ぬける', 'つぎへ',
  'まいかい', 'はじめに', 'おしたとき', 'さわったとき',
  'てじゅん', 'かえす',
  'かつ', 'または', 'ではない',
  'はい', 'いいえ', 'なし'
];
const KEYWORD_SET = new Set(KEYWORDS);

// 漢字（正式）→ 代表の つづり（ひらがな）
// ひらがなも 今までどおり 動きます。両方 受けつけます。
const KEYWORD_ALIASES = {
  '繰り返し': 'くりかえし',
  '繰返し': 'くりかえし',
  '回': 'かい',
  '毎回': 'まいかい',
  '最初に': 'はじめに',
  '押したとき': 'おしたとき',
  '触れたとき': 'さわったとき',
  '手順': 'てじゅん',
  '返す': 'かえす',
  '抜ける': 'ぬける',
  '次へ': 'つぎへ',
  '終わり': 'おわり',
  '終り': 'おわり'
};

// 代表の つづり → 表に 出すときの 正式な つづり（漢字）
const KEYWORD_DISPLAY = {
  'くりかえし': '繰り返し',
  'かい': '回',
  'まいかい': '毎回',
  'はじめに': '最初に',
  'おしたとき': '押したとき',
  'さわったとき': '触れたとき',
  'てじゅん': '手順',
  'かえす': '返す',
  'ぬける': '抜ける',
  'つぎへ': '次へ',
  'おわり': '終わり'
};

/** キーワードを 表に 出すときの つづり（漢字）にする */
function kwDisp(v) {
  return Object.prototype.hasOwnProperty.call(KEYWORD_DISPLAY, v) ? KEYWORD_DISPLAY[v] : String(v);
}

/**
 * この ことばは キーワード？ そうなら 代表の つづりを 返す。
 *   1. そのままの字で さがす（ひらがな・漢字）… ふつうは ここ
 *   2. 見つからなければ そろえた形（カタカナ→ひらがな）で さがす
 * ちがえば null。
 */
function keywordOf(name) {
  if (KEYWORD_SET.has(name)) return name;
  if (Object.prototype.hasOwnProperty.call(KEYWORD_ALIASES, name)) return KEYWORD_ALIASES[name];
  const f = fold(name);
  if (f !== name) {
    if (KEYWORD_SET.has(f)) return f;
    if (Object.prototype.hasOwnProperty.call(KEYWORD_ALIASES, f)) return KEYWORD_ALIASES[f];
  }
  return null;
}

// 文の あたまに 来る キーワード（打ち間違い さがしに つかう）
// ひらがなと 漢字の 両方を ならべます。
const STATEMENT_KEYWORDS = [
  'もし', 'そうでなくもし', 'そうでなければ',
  'おわり', '終わり',
  'くりかえし', '繰り返し',
  'ずっと', 'ひとつずつ',
  'ぬける', '抜ける',
  'つぎへ', '次へ',
  'まいかい', '毎回',
  'はじめに', '最初に',
  'おしたとき', '押したとき',
  'さわったとき', '触れたとき',
  'てじゅん', '手順',
  'かえす', '返す'
];

// 記号として つかう 文字
const SYMBOL_CHARS = new Set(['(', ')', '[', ']', ',', '.', '=', '!', '<', '>', '+', '-', '*', '/', '%']);

// つかえない 文字と、その ときの アドバイス
const BAD_CHARS = {
  '&': ['「&」は使いません。', '「かつ」と書いてください（例: もし 点 > 5 かつ 命 > 0 なら）'],
  '|': ['「|」は使いません。', '「または」と書いてください（例: もし 点 > 5 または 命 > 0 なら）'],
  ';': ['「;」は要りません。', '文の終わりは行をかえるだけで大丈夫です'],
  '{': ['「{」は使いません。', 'ブロックは行をかえて、最後に「終わり」と書きます'],
  '}': ['「}」は使いません。', 'ブロックは行をかえて、最後に「終わり」と書きます'],
  '\'': ['文字は \' では囲めません。', '「こんにちは」か "こんにちは" のように書いてください'],
  '。': ['「。」は要りません。', '文の終わりは行をかえるだけで大丈夫です'],
  '「': null, // 文字列の はじまりなので ここでは あつかわない
  '」': ['文字列のはじまりの 「 がありません。', '「こんにちは」のように囲んでください']
};

/** その 文字は 名前（識別子）に つかえる？ */
function isIdentChar(ch) {
  if (ch === undefined) return false;
  if (ch === '\n' || ch === ' ' || ch === '\t') return false;
  if (SYMBOL_CHARS.has(ch)) return false;
  if (ch === '"' || ch === '「' || ch === '」' || ch === '#') return false;
  if (Object.prototype.hasOwnProperty.call(BAD_CHARS, ch)) return false;
  return true;
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

/**
 * ソースを トークンの 配列にする。
 * トークン = { type, value, line }
 *   type: 'NUM' | 'STR' | 'IDENT' | 'KW' | 'OP' | 'NEWLINE' | 'EOF'
 */
function lex(source) {
  const s = normalize(source);
  const toks = [];
  let i = 0;
  let line = 1;

  const push = (type, value) => toks.push({ type, value, line });

  while (i < s.length) {
    const c = s[i];

    // --- 改行 -------------------------------------------------------
    if (c === '\n') {
      push('NEWLINE', '\n');
      i++;
      line++;
      continue;
    }

    // --- 空白は とばす -----------------------------------------------
    if (c === ' ' || c === '\t') { i++; continue; }

    // --- コメント（# から 行の おわりまで）----------------------------
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }

    // --- 文字列 "..." ------------------------------------------------
    if (c === '"') {
      const startLine = line;
      i++;
      let text = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\n') {
          throw err(startLine,
            '文字列の終わりの " がありません。',
            '"こんにちは" のように、同じ行の中で " を2つ書いてください');
        }
        text += s[i];
        i++;
      }
      if (i >= s.length) {
        throw err(startLine,
          '文字列の終わりの " がありません。',
          '"こんにちは" のように " で囲んでください');
      }
      i++; // とじる "
      push('STR', text);
      continue;
    }

    // --- 文字列 「...」（中に " が あっても いい）----------------------
    if (c === '「') {
      const startLine = line;
      i++;
      let text = '';
      let depth = 1;
      while (i < s.length) {
        if (s[i] === '「') { depth++; text += s[i]; i++; continue; }
        if (s[i] === '」') { depth--; if (depth === 0) break; text += s[i]; i++; continue; }
        if (s[i] === '\n') {
          throw err(startLine,
            '文字列の終わりの 」 がありません。',
            '「こんにちは」のように、同じ行の中で閉じてください');
        }
        text += s[i];
        i++;
      }
      if (i >= s.length) {
        throw err(startLine,
          '文字列の終わりの 」 がありません。',
          '「こんにちは」のように 」 で閉じてください');
      }
      i++; // とじる 」
      push('STR', text);
      continue;
    }

    // --- 数 -----------------------------------------------------------
    if (isDigit(c)) {
      let text = '';
      while (i < s.length && isDigit(s[i])) { text += s[i]; i++; }
      // 「1.5」のときだけ 小数点を とりこむ（「もの.x」の . と まちがえない）
      if (s[i] === '.' && isDigit(s[i + 1])) {
        text += '.';
        i++;
        while (i < s.length && isDigit(s[i])) { text += s[i]; i++; }
      }
      push('NUM', parseFloat(text));
      continue;
    }

    // --- 2 文字の 記号 -------------------------------------------------
    const two = s.substr(i, 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      push('OP', two);
      i += 2;
      continue;
    }

    // --- 1 文字の 記号 -------------------------------------------------
    if (c === '!') {
      throw err(line,
        '「!」だけでは使えません。',
        'ちがうかどうかを比べるときは「!=」と2つ書いてください');
    }
    if (SYMBOL_CHARS.has(c)) {
      push('OP', c);
      i++;
      continue;
    }

    // --- つかえない 文字 -----------------------------------------------
    if (Object.prototype.hasOwnProperty.call(BAD_CHARS, c) && BAD_CHARS[c]) {
      const [msg, hint] = BAD_CHARS[c];
      throw err(line, msg, hint);
    }

    // --- 名前（識別子）と キーワード ------------------------------------
    let name = '';
    while (i < s.length && isIdentChar(s[i])) { name += s[i]; i++; }
    if (name === '') {
      // ここには 来ないはずだけど、ねんのため
      throw err(line,
        '「' + c + '」は使えない文字です。',
        'ひらがな・カタカナ・漢字・数字と、記号 ( ) + - * / が使えます');
    }
    // キーワードなら 代表の つづりに そろえて しまう。
    // 使う人が 書いた ままの 字は raw に のこす。
    const kw = keywordOf(name);
    push(kw ? 'KW' : 'IDENT', kw || name);
    toks[toks.length - 1].raw = name;
  }

  push('NEWLINE', '\n');
  push('EOF', null);
  return toks;
}

/** トークンを 人に 見せるときの 文字 */
function tokenText(t) {
  if (!t) return 'コードの終わり';
  if (t.type === 'NEWLINE') return '改行';
  if (t.type === 'EOF') return 'コードの終わり';
  if (t.type === 'STR') return '"' + t.value + '"';
  return String(t.value);
}


// =====================================================================
//  3. 打ち間違い さがし（レーベンシュタイン距離）
// =====================================================================

/** 2 つの ことばが どれくらい ちがうか（1 なら 1 文字ちがい） */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = (a[i - 1] === b[j - 1]) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/**
 * 候補の 中から 1 文字ちがいの ことばを さがす。
 * くらべるのは「そろえた形」どうし。こうすると
 *   ハコ ／ はこ ／ ﾊｺ を またいでも 打ち間違いを 見つけられます。
 * 返すのは 候補の もとの つづり（そのまま 見せられるように）。
 */
function nearestWord(name, candidates) {
  if (!name || Array.from(name).length < 2) return null;
  const fname = fold(name);
  let best = null;
  let bestD = 99;
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    if (c === name) return null;      // ぴったり あるなら 打ち間違いでは ない
    const fc = fold(c);
    if (fc === fname) return null;    // そろえたら 同じ ＝ 打ち間違いでは ない
    if (fc.length < 2) continue;
    const d = editDistance(fname, fc);
    if (d < bestD) { bestD = d; best = c; }
  }
  return (bestD <= 1) ? best : null;
}


// =====================================================================
//  4. 構文解析（トークン → 木）
// =====================================================================
//
//  作る 木（ノード）の しゅるい:
//   文  : If / Times / While / Forever / ForEach / Block /
//         Proc / Return / Break / Continue / Assign / ExprStmt
//   式  : Num / Str / Bool / Nil / Name / List / Unary / Not /
//         Bin / Cmp / And / Or / Call / Member / Index
//
class Parser {
  constructor(toks) {
    this.t = toks;
    this.p = 0;
    this.loopDepth = 0;   // くりかえしの 中に いるか（ぬける・つぎへ の チェック）
    this.funcDepth = 0;   // てじゅんの 中に いるか（かえす の チェック）
  }

  // ---- トークンを 見る／すすめる ------------------------------------
  get cur() { return this.t[this.p]; }
  peek(k) { return this.t[Math.min(this.p + (k || 0), this.t.length - 1)]; }
  next() {
    const t = this.t[this.p];
    if (t.type !== 'EOF') this.p++;
    return t;
  }
  at(type, value) {
    const t = this.cur;
    return t.type === type && (value === undefined || t.value === value);
  }
  atKW(v) { return this.cur.type === 'KW' && this.cur.value === v; }
  eatKW(v) { if (this.atKW(v)) { this.p++; return true; } return false; }
  eatOP(v) { if (this.at('OP', v)) { this.p++; return true; } return false; }
  skipNL() { while (this.at('NEWLINE')) this.p++; }

  // ---- プログラム全体 ------------------------------------------------
  parseProgram() {
    const prog = {
      body: [],        // トップレベルの 文（最初に も ここに 入る）
      everyFrame: [],  // 毎回
      presses: [],     // 押したとき
      touches: [],     // 触れたとき（ものに 入れた コード 専用）
      procs: new Map() // 手順
    };

    this.skipNL();
    while (!this.at('EOF')) {
      if (this.atKW('まいかい')) {
        prog.everyFrame.push(this.parseEveryFrame());
      } else if (this.atKW('おしたとき')) {
        prog.presses.push(this.parseOnPress());
      } else if (this.atKW('さわったとき')) {
        prog.touches.push(this.parseOnTouch());
      } else if (this.atKW('てじゅん')) {
        const f = this.parseProc();
        prog.procs.set(f.name, f);
      } else {
        prog.body.push(this.parseStatement());
      }
      this.skipNL();
    }
    return prog;
  }

  // ---- 1 つの 文 -----------------------------------------------------
  parseStatement() {
    const t = this.cur;

    // ▼ よく ある 書きまちがいを 先に 見つける
    if (t.type === 'IDENT') this.checkKeywordTypo(t);

    if (t.type === 'KW') {
      switch (t.value) {
        case 'もし': return this.parseIf();
        case 'くりかえし': return this.parseTimes();
        case 'ずっと': return this.parseForever();
        case 'ひとつずつ': return this.parseForEach();
        case 'はじめに': return this.parseAtStart();
        case 'かえす': return this.parseReturn();
        case 'ぬける': return this.parseBreak();
        case 'つぎへ': return this.parseContinue();

        // この 4 つは いちばん そとがわ だけ
        case 'まいかい':
        case 'おしたとき':
        case 'さわったとき':
        case 'てじゅん':
          throw err(t.line,
            '「' + kwDisp(t.value) + '」は一番外側に書いてください。',
            'ほかのブロックの中には書けません');

        case 'そうでなければ':
        case 'そうでなくもし':
          throw err(t.line,
            '「' + kwDisp(t.value) + '」は「もし」のあとにしか書けません。',
            '先に「もし ○○ なら」を書いてください');

        case 'おわり':
          throw err(t.line,
            '「終わり」が余分にあります。',
            'はじまりの「もし」や「繰り返し」があるか見てください');

        case 'なら':
          throw err(t.line,
            '「なら」だけでは使えません。',
            '「もし 点 > 10 なら」のように書いてください');

        case 'かい':
          throw err(t.line,
            '「回」だけでは使えません。',
            '「繰り返し 5 回」のように書いてください');

        case 'のあいだ':
          throw err(t.line,
            '「のあいだ」の前に、比べることを書いてください。',
            '「点 < 10 のあいだ 繰り返し」のように書きます');
        default:
          break;
      }
    }

    // ▼ 式から はじまる 文（代入 / 〜のあいだ くりかえし / ただの式）
    const line = t.line;
    const expr = this.parseExpr(true);

    // 〜のあいだ くりかえし
    if (this.atKW('のあいだ')) {
      this.next();
      if (!this.eatKW('くりかえし')) {
        throw err(this.cur.line,
          '「のあいだ」のあとには「繰り返し」と書いてください。',
          '「点 < 10 のあいだ 繰り返し」のように書きます');
      }
      this.loopDepth++;
      const body = this.parseBlock('のあいだ 繰り返し', line, ['おわり']);
      this.loopDepth--;
      this.expectEnd('のあいだ 繰り返し', line);
      return { t: 'While', cond: expr, body, line };
    }

    // 代入
    if (this.at('OP', '=')) {
      const eqLine = this.cur.line;
      this.next();
      const value = this.parseExpr(false);
      if (expr.t !== 'Name' && expr.t !== 'Member' && expr.t !== 'Index') {
        throw err(eqLine,
          'ここには = でしまうことができません。',
          '「点 = 1」のように、左には名前を書いてください');
      }
      this.endStmt();
      return { t: 'Assign', target: expr, value, line };
    }

    // ただの 式（ほとんどは 関数よび出し）
    if (expr.t === 'Cmp' && expr.op === '==') {
      throw err(line,
        '「==」は比べるときに使います。この行では何も起きません。',
        '入れるときは「点 = 1」のように = を1つ書きます');
    }
    this.endStmt();
    return { t: 'ExprStmt', expr, line };
  }

  /**
   * 行の あたまの 名前が キーワードの 打ち間違い／空白わすれ じゃないか しらべる。
   *  れい: 「もしてん > 10 なら」 → もし の あとに 空白が ない
   *        「もじ てん > 10 なら」 → もし の 打ち間違い
   */
  checkKeywordTypo(t) {
    const name = t.value;
    const nx = this.peek(1);
    // うしろが ( = . [ , なら ふつうの 関数よび出しや 代入なので しらべない
    if (nx.type === 'OP' && ['(', '=', '.', '[', ','].includes(nx.value)) return;

    // (a) キーワードで はじまっているのに 空白が ない
    for (const kw of STATEMENT_KEYWORDS) {
      if (name.length > kw.length && name.startsWith(kw)) {
        throw err(t.line,
          '「' + kw + '」のあとには空白（スペース）をあけてください。',
          '「' + kw + ' ' + name.slice(kw.length) + '」のように分けて書きます');
      }
    }

    // (b) キーワードの 打ち間違い
    //     うしろに まだ なにか つづく 行（＝文の あたまっぽい）か、
    //     ブロックの キーワードに そっくりな ときだけ しらべる。
    const aloneOnLine = (nx.type === 'NEWLINE' || nx.type === 'EOF');
    const blockWords = ['おわり', 'ずっと', 'はじめに', 'まいかい', 'ぬける', 'つぎへ'];
    const pool = aloneOnLine ? blockWords : STATEMENT_KEYWORDS;
    const near = nearestWord(name, pool);
    if (near) {
      throw err(t.line,
        '「' + name + '」ということばはわかりません。もしかして「' + near + '」ですか？',
        '「' + near + '」と書いて、あとには空白をあけてください');
    }
  }

  /** 文の おわり（改行）を たしかめる */
  endStmt() {
    if (this.at('NEWLINE')) { this.p++; return; }
    if (this.at('EOF')) return;
    const t = this.cur;
    if (t.type === 'KW' && t.value === 'なら') {
      throw err(t.line,
        '「なら」の前は「もし」ではじめてください。',
        '「もし 点 > 10 なら」のように書きます');
    }
    throw err(t.line,
      'この行の終わりに余分な「' + tokenText(t) + '」があります。',
      '1つの行には1つの命令を書きます');
  }

  /**
   * ブロック（改行 → 文が ならぶ → stops の どれか）を 読む。
   * openKW / openLine は 「おわりが ない」ときの エラーに つかう。
   */
  parseBlock(openKW, openLine, stops) {
    if (!this.at('NEWLINE')) {
      const t = this.cur;
      if (t.type === 'EOF') {
        throw err(openLine,
          '「' + openKW + '」のあとに何もありません。',
          '次の行にやることを書いて、最後に「終わり」と書きます');
      }
      throw err(t.line,
        '「' + openKW + '」の行のあとは行をかえてください。「' + tokenText(t) + '」はここには書けません。',
        '「' + openKW + '」の次の行からやることを書きます');
    }
    this.p++; // 改行を たべる

    const stmts = [];
    for (;;) {
      this.skipNL();
      if (this.at('EOF')) {
        throw err(openLine,
          '「' + openKW + '」に対応する「終わり」がありません。',
          'ブロックの最後には 終わり を書きます');
      }
      if (this.cur.type === 'KW' && stops.includes(this.cur.value)) return stmts;
      stmts.push(this.parseStatement());
    }
  }

  /** 「おわり」を たべる */
  expectEnd(openKW, openLine) {
    if (this.atKW('おわり')) {
      this.p++;
      this.endStmt();
      return;
    }
    const t = this.cur;
    if (t.type === 'KW' && (t.value === 'そうでなければ' || t.value === 'そうでなくもし')) {
      throw err(t.line,
        '「' + kwDisp(t.value) + '」は「もし」の中でだけ使えます。',
        '「' + openKW + '」のブロックでは使えません');
    }
    throw err(openLine,
      '「' + openKW + '」に対応する「終わり」がありません。',
      'ブロックの最後には 終わり を書きます');
  }

  /** 名前を 1 つ 読む */
  expectName(what) {
    const t = this.cur;
    if (t.type !== 'IDENT') {
      throw err(t.line,
        what + 'の名前がありません。（「' + tokenText(t) + '」がありました）',
        'ひらがなや漢字で名前をつけてください');
    }
    this.p++;
    return t.value;
  }

  // ---- もし ----------------------------------------------------------
  parseIf() {
    const line = this.next().line; // もし
    const cond = this.parseExpr(false);
    if (!this.eatKW('なら')) {
      throw err(this.cur.line,
        '「もし」の行の最後には「なら」を書いてください。',
        '「もし 点 > 10 なら」のように書きます');
    }
    const clauses = [];
    clauses.push({ cond, body: this.parseBlock('もし', line, ['そうでなくもし', 'そうでなければ', 'おわり']) });

    while (this.atKW('そうでなくもし')) {
      const l2 = this.next().line;
      const c2 = this.parseExpr(false);
      if (!this.eatKW('なら')) {
        throw err(this.cur.line,
          '「そうでなくもし」の行の最後には「なら」を書いてください。',
          '「そうでなくもし 点 > 5 なら」のように書きます');
      }
      clauses.push({ cond: c2, body: this.parseBlock('そうでなくもし', l2, ['そうでなくもし', 'そうでなければ', 'おわり']) });
    }

    let elseBody = null;
    if (this.atKW('そうでなければ')) {
      const l3 = this.next().line;
      elseBody = this.parseBlock('そうでなければ', l3, ['おわり']);
    }

    this.expectEnd('もし', line);
    return { t: 'If', clauses, elseBody, line };
  }

  // ---- くりかえし N かい ----------------------------------------------
  parseTimes() {
    const line = this.next().line; // くりかえし
    const count = this.parseExpr(false);
    if (!this.eatKW('かい')) {
      throw err(this.cur.line,
        '「繰り返し」の行の最後には「回」を書いてください。',
        '「繰り返し 5 回」のように書きます');
    }
    this.loopDepth++;
    const body = this.parseBlock('繰り返し', line, ['おわり']);
    this.loopDepth--;
    this.expectEnd('繰り返し', line);
    return { t: 'Times', count, body, line };
  }

  // ---- ずっと ---------------------------------------------------------
  parseForever() {
    const line = this.next().line;
    this.loopDepth++;
    const body = this.parseBlock('ずっと', line, ['おわり']);
    this.loopDepth--;
    this.expectEnd('ずっと', line);
    return { t: 'Forever', body, line };
  }

  // ---- ひとつずつ x = リスト --------------------------------------------
  parseForEach() {
    const line = this.next().line;
    const name = this.expectName('ひとつずつ の へんすう');
    if (!this.eatOP('=')) {
      throw err(this.cur.line,
        '「ひとつずつ」は「ひとつずつ ○ = リスト」のように書いてください。',
        '例: ひとつずつ 敵 = 敵たち');
    }
    const list = this.parseExpr(false);
    this.loopDepth++;
    const body = this.parseBlock('ひとつずつ', line, ['おわり']);
    this.loopDepth--;
    this.expectEnd('ひとつずつ', line);
    return { t: 'ForEach', name, list, body, line };
  }

  // ---- はじめに --------------------------------------------------------
  parseAtStart() {
    const line = this.next().line;
    const body = this.parseBlock('最初に', line, ['おわり']);
    this.expectEnd('最初に', line);
    return { t: 'Block', body, line };
  }

  // ---- まいかい --------------------------------------------------------
  parseEveryFrame() {
    const line = this.next().line;
    const body = this.parseBlock('毎回', line, ['おわり']);
    this.expectEnd('毎回', line);
    return { t: 'EveryFrame', body, line };
  }

  // ---- おしたとき(キー) -------------------------------------------------
  parseOnPress() {
    const line = this.next().line;
    if (!this.eatOP('(')) {
      throw err(this.cur.line,
        '「押したとき」のあとには ( ) でキーの名前を書いてください。',
        '例: 押したとき("スペース")');
    }
    const key = this.parseExpr(false);
    if (!this.eatOP(')')) {
      throw err(this.cur.line,
        '「押したとき」の ) が足りません。',
        '例: 押したとき("スペース")');
    }
    const body = this.parseBlock('押したとき', line, ['おわり']);
    this.expectEnd('押したとき', line);
    return { t: 'OnPress', key, body, line };
  }

  // ---- 触れたとき(相手) -------------------------------------------------
  //  ※ かっこの 中は「式」ではなく「変数の 名前」です。
  //     押したとき("スペース") とは ちがうので 気をつけてください。
  parseOnTouch() {
    const line = this.next().line;
    if (!this.eatOP('(')) {
      throw err(this.cur.line,
        '「触れたとき」のあとには ( ) で相手の名前を書いてください。',
        '例: 触れたとき (相手)');
    }
    let param = null;
    if (!this.at('OP', ')')) param = this.expectName('触れたとき の 相手');
    if (!this.eatOP(')')) {
      throw err(this.cur.line,
        '「触れたとき」の ) が足りません。',
        '例: 触れたとき (相手)');
    }
    const body = this.parseBlock('触れたとき', line, ['おわり']);
    this.expectEnd('触れたとき', line);
    return { t: 'OnTouch', param, body, line };
  }

  // ---- 手順 名前(引数…) --------------------------------------------------
  parseProc() {
    const line = this.next().line;
    const name = this.expectName('てじゅん');
    if (!this.eatOP('(')) {
      throw err(this.cur.line,
        '「手順 ' + name + '」のあとには ( ) を書いてください。',
        '例: 手順 たす(あ, い)');
    }
    const params = [];
    if (!this.at('OP', ')')) {
      for (;;) {
        params.push(this.expectName('ひきすう'));
        if (this.eatOP(',')) continue;
        break;
      }
    }
    if (!this.eatOP(')')) {
      throw err(this.cur.line,
        '「手順 ' + name + '」の ) が足りません。',
        '引数は「,」で区切って、最後に ) を書きます');
    }

    // てじゅんの 中では くりかえしの そとに もどる
    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    this.funcDepth++;
    const body = this.parseBlock('手順', line, ['おわり']);
    this.funcDepth--;
    this.loopDepth = savedLoop;

    this.expectEnd('手順', line);
    return { t: 'Proc', name, params, body, line };
  }

  // ---- かえす / ぬける / つぎへ -------------------------------------------
  parseReturn() {
    const line = this.next().line;
    if (this.funcDepth === 0) {
      throw err(line,
        '「返す」は手順の中でだけ使えます。',
        '「手順 名前(…)」の中に書いてください');
    }
    let value = null;
    if (!this.at('NEWLINE') && !this.at('EOF')) {
      value = this.parseExpr(false);
    }
    this.endStmt();
    return { t: 'Return', value, line };
  }

  parseBreak() {
    const line = this.next().line;
    if (this.loopDepth === 0) {
      throw err(line,
        '「抜ける」は繰り返しの中でだけ使えます。',
        '「繰り返し … 終わり」の中に書いてください');
    }
    this.endStmt();
    return { t: 'Break', line };
  }

  parseContinue() {
    const line = this.next().line;
    if (this.loopDepth === 0) {
      throw err(line,
        '「次へ」は繰り返しの中でだけ使えます。',
        '「繰り返し … 終わり」の中に書いてください');
    }
    this.endStmt();
    return { t: 'Continue', line };
  }

  // ===================================================================
  //  式（ゆうせんじゅんい: または < かつ < くらべる < + - < * / % < 前置 < 後置）
  // ===================================================================
  //
  //  top が true のときは、文の いちばん そとがわ なので
  //  「=」が 出てきても エラーに しないで 呼び出しもとに まかせる（代入だから）。
  //
  parseExpr(top) { return this.parseOr(!!top); }

  parseOr(top) {
    let left = this.parseAnd(top);
    while (this.atKW('または')) {
      const line = this.next().line;
      const right = this.parseAnd(false);
      left = { t: 'Or', a: left, b: right, line };
    }
    return left;
  }

  parseAnd(top) {
    let left = this.parseCompare(top);
    while (this.atKW('かつ')) {
      const line = this.next().line;
      const right = this.parseCompare(false);
      left = { t: 'And', a: left, b: right, line };
    }
    return left;
  }

  parseCompare(top) {
    let left = this.parseAdd();
    for (;;) {
      const t = this.cur;
      if (t.type === 'OP' && t.value === '=') {
        if (top) return left;   // 文の 代入 → 呼び出しもとに まかせる
        throw err(t.line,
          '比べるときは = ではなく == と2つ書いてください。',
          '例: もし 点 == 10 なら');
      }
      if (t.type === 'OP' && ['==', '!=', '<', '>', '<=', '>='].includes(t.value)) {
        this.p++;
        const right = this.parseAdd();
        left = { t: 'Cmp', op: t.value, a: left, b: right, line: t.line };
        continue;
      }
      return left;
    }
  }

  parseAdd() {
    let left = this.parseMul();
    for (;;) {
      const t = this.cur;
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        this.p++;
        const right = this.parseMul();
        left = { t: 'Bin', op: t.value, a: left, b: right, line: t.line };
        continue;
      }
      return left;
    }
  }

  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      const t = this.cur;
      if (t.type === 'OP' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.p++;
        const right = this.parseUnary();
        left = { t: 'Bin', op: t.value, a: left, b: right, line: t.line };
        continue;
      }
      return left;
    }
  }

  parseUnary() {
    const t = this.cur;
    if (t.type === 'OP' && t.value === '-') {
      this.p++;
      return { t: 'Unary', op: '-', a: this.parseUnary(), line: t.line };
    }
    if (t.type === 'KW' && t.value === 'ではない') {
      this.p++;
      return { t: 'Not', a: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.cur;
      if (t.type === 'OP' && t.value === '(') {
        this.p++;
        const args = this.parseArgs(node);
        node = { t: 'Call', callee: node, args, line: t.line };
        continue;
      }
      if (t.type === 'OP' && t.value === '.') {
        this.p++;
        const n = this.cur;
        if (n.type !== 'IDENT' && n.type !== 'KW') {
          throw err(t.line,
            '「.」のあとには名前を書いてください。',
            '例: 勇者.x');
        }
        this.p++;
        node = { t: 'Member', obj: node, name: String(n.value), line: t.line };
        continue;
      }
      if (t.type === 'OP' && t.value === '[') {
        this.p++;
        this.skipNL();
        const idx = this.parseExpr(false);
        this.skipNL();
        if (!this.eatOP(']')) {
          throw err(this.cur.line,
            '「]」が足りません。',
            '例: リスト[0]');
        }
        node = { t: 'Index', obj: node, index: idx, line: t.line };
        continue;
      }
      return node;
    }
  }

  /** よび出しの ひきすう（( は すでに たべてある） */
  parseArgs(calleeNode) {
    const args = [];
    this.skipNL();
    if (this.eatOP(')')) return args;
    for (;;) {
      this.skipNL();
      args.push(this.parseExpr(false));
      this.skipNL();
      if (this.eatOP(',')) continue;
      if (this.eatOP(')')) return args;
      const t = this.cur;
      const nm = (calleeNode && calleeNode.t === 'Name') ? calleeNode.name : 'この手順';
      if (t.type === 'EOF' || t.type === 'NEWLINE') {
        throw err(t.line,
          '「' + nm + '」の閉じる ) がありません。',
          '( ではじめたら ) で閉じてください（例: ' + nm + '(1, 2)）');
      }
      throw err(t.line,
        '「' + nm + '」の引数のところに「' + tokenText(t) + '」があってわかりません。ここに ) が足りないのかもしれません。',
        '引数は「,」（コンマ）で区切って、最後に ) を書きます');
    }
  }

  parsePrimary() {
    const t = this.cur;

    if (t.type === 'NUM') { this.p++; return { t: 'Num', v: t.value, line: t.line }; }
    if (t.type === 'STR') { this.p++; return { t: 'Str', v: t.value, line: t.line }; }

    if (t.type === 'KW') {
      if (t.value === 'はい') { this.p++; return { t: 'Bool', v: true, line: t.line }; }
      if (t.value === 'いいえ') { this.p++; return { t: 'Bool', v: false, line: t.line }; }
      if (t.value === 'なし') { this.p++; return { t: 'Nil', line: t.line }; }
      throw err(t.line,
        'ここに「' + kwDisp(t.value) + '」は書けません。',
        '数や文字や変数の名前を書いてください');
    }

    if (t.type === 'IDENT') { this.p++; return { t: 'Name', name: t.value, line: t.line }; }

    if (t.type === 'OP' && t.value === '(') {
      this.p++;
      this.skipNL();
      const e = this.parseExpr(false);
      this.skipNL();
      if (!this.eatOP(')')) {
        throw err(this.cur.line,
          '「)」が足りません。',
          '( ではじめたら ) で閉じてください');
      }
      return e;
    }

    if (t.type === 'OP' && t.value === '[') {
      this.p++;
      const items = [];
      this.skipNL();
      if (this.eatOP(']')) return { t: 'List', items, line: t.line };
      for (;;) {
        this.skipNL();
        items.push(this.parseExpr(false));
        this.skipNL();
        if (this.eatOP(',')) continue;
        if (this.eatOP(']')) return { t: 'List', items, line: t.line };
        throw err(this.cur.line,
          'リストの中に「' + tokenText(this.cur) + '」があってわかりません。',
          'リストは [1, 2, 3] のように「,」で区切ります');
      }
    }

    if (t.type === 'NEWLINE' || t.type === 'EOF') {
      throw err(t.line,
        'ここに計算するものがありません。',
        '数や文字や変数の名前を書いてください');
    }

    if (t.type === 'OP' && t.value === '=') {
      throw err(t.line,
        '比べるときは = ではなく == と2つ書いてください。',
        '例: もし 点 == 10 なら');
    }

    throw err(t.line,
      '「' + tokenText(t) + '」の使い方がちがうようです。',
      'この行を見なおしてください');
  }
}


// =====================================================================
//  5. parse() — 契約の 入口
// =====================================================================

/**
 * ソースを 読んで 実行できる かたち（program）に する。
 * だめなら KotodamaError を なげる。
 */
export function parse(source) {
  const toks = lex(source);
  const p = new Parser(toks);
  return p.parseProgram();
}


// =====================================================================
//  6. 値の あつかい
// =====================================================================

/** 「ほんとう」と みなすか（0 "" なし いいえ は うそ） */
function truthy(v) {
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === 'number') return !(v === 0 || Number.isNaN(v));
  if (typeof v === 'string') return v !== '';
  return true;
}

/** 値を 日本語の 文字に する */
function toStr(v) {
  if (v === null || v === undefined) return 'なし';
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '数ではない';
    if (!Number.isFinite(v)) return (v > 0 ? '無限大' : '-無限大');
    if (Number.isInteger(v)) return String(v);
    // 0.30000000000000004 みたいなのを きれいにする
    return String(parseFloat(v.toFixed(10)));
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(toStr).join(', ') + ']';
  if (typeof v === 'function') return '手順';
  if (typeof v === 'object') {
    if (v.__proc) return '手順';
    if (typeof v['もじ'] === 'string' && v['もじ'] !== '') return 'もの(' + v['もじ'] + ')';
    return 'もの';
  }
  return String(v);
}

/** 値の しゅるいの 名まえ（エラーで つかう） */
function typeName(v) {
  if (v === null || v === undefined) return 'なし';
  if (typeof v === 'boolean') return 'はい／いいえ';
  if (typeof v === 'number') return '数字';
  if (typeof v === 'string') return '文字列';
  if (Array.isArray(v)) return 'リスト';
  if (typeof v === 'function') return '手順';
  return 'もの';
}

/**
 * ものの フィールド名を さがす。
 * そのままの字で あれば そのまま、なければ そろえた形が 同じ ものを さがす。
 * （タカサ → たかさ、ｲﾛ → いろ）
 */
function foldedFieldName(o, name) {
  if (o && typeof o === 'object' && (name in o)) return name;
  if (!o || typeof o !== 'object') return name;
  const f = fold(name);
  for (const k of Object.keys(o)) {
    if (fold(k) === f) return k;
  }
  return name;
}

/** == の くらべかた */
function equals(a, b) {
  const x = (a === undefined) ? null : a;
  const y = (b === undefined) ? null : b;
  if (typeof x === 'number' && typeof y === 'number') return x === y;
  return x === y;
}


// =====================================================================
//  7. JS 関数の ひきすうの 名まえを しらべる（つかいかた を 出すため）
// =====================================================================

const paramCache = new WeakMap();

function paramNamesOf(fn) {
  if (typeof fn !== 'function') return null;
  if (paramCache.has(fn)) return paramCache.get(fn);
  let result = null;
  try {
    const s = String(fn);
    // かっこの ない アロー関数 「x => …」
    const arrow = s.match(/^\s*(?:async\s+)?([^\s(=,)]+)\s*=>/);
    if (arrow) {
      result = [arrow[1]];
    } else {
      const m = s.match(/^[^(]*\(([^)]*)\)/);
      if (m) {
        const inner = m[1].trim();
        if (inner === '') {
          result = [];
        } else {
          const parts = inner.split(',').map(x => x.trim().replace(/=[\s\S]*$/, '').trim());
          result = parts.some(p => p === '' || p.includes('{') || p.includes('[')) ? null : parts;
        }
      }
    }
  } catch (e) {
    result = null;
  }
  paramCache.set(fn, result);
  return result;
}

/** 「使い方: 動かす(もの, x, y, z)」の 文字を つくる */
function usageOf(name, fn) {
  const ps = paramNamesOf(fn);
  // 引数の 名前が わからない ばあい（bind した 関数 など）は … と 出す
  if (!ps) return '使い方: ' + name + '(…)';
  if (ps.length === 0 && fn.length > 0) return '使い方: ' + name + '(…)';
  return '使い方: ' + name + '(' + ps.join(', ') + ')';
}


// =====================================================================
//  8. 実行（インタプリタ）
// =====================================================================
//
//  ぜんぶの 評価関数は ジェネレータ。
//  yield する ものは
//     { t:'tick' }            くりかえしの 1 まわりごと
//     { t:'frame' }           つぎの フレームまで まつ
//     { t:'wait', sec: かず } びょう だけ まつ
//
//  文を 実行すると「しるし」が かえってくる:
//     null … ふつうに おわった
//     { k:'break' } / { k:'continue' } / { k:'return', v }
//
const MAX_CALL_DEPTH = 300;   // 再帰の ふかさ
const TICK_BUDGET = 300000;   // 1 フレームで つかえる くりかえしの かず

class Interp {
  constructor(program, builtins) {
    this.program = program;
    this.builtins = builtins || {};
    this.globals = new Map();
    this.procs = new Map();

    // ── そろえた形の 索引 ────────────────────────────────
    //  「そのままの字」で 見つからなかった ときの 2段目に つかいます。
    //  索引には「そろえた形 → もとの つづり」を しまいます。
    //  組み込みの アニメ は あにめ として 入るので 使う人が あにめ と
    //  書いても 見つかり、はこ は はこ として 入るので ハコ と 書いても
    //  見つかります。両方向に 効きます。
    this.builtinsFolded = new Map();
    this.globalsFolded = new Map();
    this.procsFolded = new Map();

    // いま どの スクリプトを 走らせているか（ワールドの ものに 入れた コード）。
    // 自分（じぶん）だけは スクリプトごとに ちがう ものを 指します。
    this.script = null;

    for (const 名 of Object.keys(this.builtins)) {
      const f = fold(名);
      if (!this.builtinsFolded.has(f)) this.builtinsFolded.set(f, 名);
      // ことばのうち、関数でないものは「さいしょからある 変数」にします。
      // （プレイヤー や 地面 など、書かなくても もう そこに あるもの）
      if (typeof this.builtins[名] !== 'function') this.setGlobal(名, this.builtins[名]);
    }

    if (program) this.addProgram(program);

    this.depth = 0;
    this.line = 1;   // いま どの 行を 実行しているか（エラー用）
  }

  // ---- プログラムを 足す（attach で ふえる） ---------------------------

  /** その プログラムの 手順を みんなで 共有する ところに 入れる */
  addProgram(program) {
    if (!program || !program.procs) return;
    for (const [name, def] of program.procs) {
      this.procs.set(name, def);
      const f = fold(name);
      if (!this.procsFolded.has(f)) this.procsFolded.set(f, name);
    }
  }

  // ---- 変数 -----------------------------------------------------------

  /** グローバルに しまう（そろえた形の 索引も 作る） */
  setGlobal(name, value) {
    this.globals.set(name, value);
    const f = fold(name);
    if (!this.globalsFolded.has(f)) this.globalsFolded.set(f, name);
  }

  /**
   * 名前が しまわれている 場所を さがす。
   *   1段目 … そのままの字（速い。ふつうは ここで 見つかる）
   *   2段目 … そろえた形（カタカナ→ひらがな）
   * どちらの 段でも「手順の 中 → その スクリプトだけの もの → みんなの もの」の順。
   * 見つからなければ null。
   */
  findSlot(name, fr) {
    const sc = this.script;
    // ── 1段目: そのままの字 ──
    if (fr && fr.locals.has(name)) return { map: fr.locals, key: name };
    if (sc && sc.extras.has(name)) return { map: sc.extras, key: name };
    if (this.globals.has(name)) return { map: this.globals, key: name };
    // ── 2段目: そろえた形 ──
    const f = fold(name);
    if (fr) {
      const k = fr.folded.get(f);
      if (k !== undefined && fr.locals.has(k)) return { map: fr.locals, key: k };
    }
    if (sc) {
      const k = sc.extrasFolded.get(f);
      if (k !== undefined && sc.extras.has(k)) return { map: sc.extras, key: k };
    }
    const g = this.globalsFolded.get(f);
    if (g !== undefined && this.globals.has(g)) return { map: this.globals, key: g };
    return null;
  }

  /** 名前を さがす（見つからないと undefined） */
  lookup(name, fr) {
    const slot = this.findSlot(name, fr);
    return slot ? slot.map.get(slot.key) : undefined;
  }

  /** そのままの字だけで さがす（そろえた形は つかわない） */
  lookupExact(name, fr) {
    const sc = this.script;
    if (fr && fr.locals.has(name)) return fr.locals.get(name);
    if (sc && sc.extras.has(name)) return sc.extras.get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  hasVar(name, fr) {
    return this.findSlot(name, fr) !== null;
  }

  /** 手順を さがす（そのままの字 → そろえた形） */
  findProc(name) {
    if (this.procs.has(name)) return this.procs.get(name);
    const k = this.procsFolded.get(fold(name));
    if (k !== undefined) return this.procs.get(k);
    return null;
  }

  /** 組み込みの ことばを さがす（そのままの字 → そろえた形） */
  findBuiltin(name) {
    const b = this.builtins;
    if (Object.prototype.hasOwnProperty.call(b, name) && typeof b[name] === 'function') {
      return { name, fn: b[name] };
    }
    const k = this.builtinsFolded.get(fold(name));
    if (k !== undefined && k !== name && typeof b[k] === 'function') return { name: k, fn: b[k] };
    return null;
  }

  /** 打ち間違いさがし に つかう 名前を ぜんぶ ならべる */
  allNames(fr) {
    return [
      ...this.globals.keys(),
      ...(fr ? fr.locals.keys() : []),
      ...(this.script ? this.script.extras.keys() : []),
      ...this.procs.keys(),
      ...Object.keys(this.builtins)
    ];
  }

  /**
   * 読む（なければ 親切な エラー）。
   *  ★ さがす 順番は「そのままの字を ぜんぶ ためしてから、そろえた形」。
   *    たとえば あにめ という 変数を 作っていても、
   *    アニメ と 書いたら 組み込みの アニメ の ほうが 勝ちます。
   */
  getVar(name, fr, line) {
    // ── 1段目: そのままの字 ──
    const ex = this.lookupExact(name, fr);
    if (ex !== undefined) return ex;
    if (this.procs.has(name) ||
        (Object.prototype.hasOwnProperty.call(this.builtins, name) &&
         typeof this.builtins[name] === 'function')) {
      throw err(line,
        '「' + name + '」を使うときは ( ) を書いてください。',
        '例: ' + name + '(…)');
    }

    // ── 2段目: そろえた形 ──
    const slot = this.findSlot(name, fr);
    if (slot) return slot.map.get(slot.key);
    if (this.findProc(name) || this.findBuiltin(name)) {
      throw err(line,
        '「' + name + '」を使うときは ( ) を書いてください。',
        '例: ' + name + '(…)');
    }

    // ── どこにも ない（打ち間違い さがし）──
    const near = nearestWord(name, this.allNames(fr));
    throw err(line,
      '「' + name + '」という変数はまだありません。',
      near
        ? 'もしかして「' + near + '」ですか？'
        : '先に  ' + name + ' = 箱(0, 5, 0, 4, 4, 4)  のように作ってください');
  }

  /**
   * しまう。
   *   もう ある 名前（そのままの字 でも そろえた形 でも）→ その 場所に 上書き
   *   どこにも ない → 手順の 中なら 手順のもの、そとなら みんなのもの
   * ※ 触れたとき／押したとき の ように 引数だけ 入れた わく（fr.global）は、
   *    新しい 名前を みんなの ものに します。
   */
  setVar(name, value, fr) {
    const slot = this.findSlot(name, fr);
    if (slot) { slot.map.set(slot.key, value); return; }
    if (fr && !fr.global) {
      fr.locals.set(name, value);
      const f = fold(name);
      if (!fr.folded.has(f)) fr.folded.set(f, name);
      return;
    }
    this.setGlobal(name, value);
  }

  // ---- 文 -------------------------------------------------------------

  /** ならんだ 文を じゅんばんに 実行する */
  * execBlock(stmts, fr) {
    for (let i = 0; i < stmts.length; i++) {
      const sig = yield* this.execStmt(stmts[i], fr);
      if (sig) return sig;
    }
    return null;
  }

  /** タスクの 入口（トップレベル用）。fr は 触れたとき の 相手を 入れるのに つかう */
  * runBody(stmts, fr) {
    yield* this.execBlock(stmts, fr || null);
    return null;
  }

  * execStmt(st, fr) {
    this.line = st.line;
    switch (st.t) {

      case 'ExprStmt':
        yield* this.evalExpr(st.expr, fr);
        return null;

      case 'Assign': {
        const v = yield* this.evalExpr(st.value, fr);
        yield* this.assignTo(st.target, v, fr);
        return null;
      }

      case 'Block':                        // 「はじめに」
        return yield* this.execBlock(st.body, fr);

      case 'If': {
        for (const cl of st.clauses) {
          const c = yield* this.evalExpr(cl.cond, fr);
          if (truthy(c)) return yield* this.execBlock(cl.body, fr);
        }
        if (st.elseBody) return yield* this.execBlock(st.elseBody, fr);
        return null;
      }

      case 'Times': {
        const raw = yield* this.evalExpr(st.count, fr);
        if (typeof raw !== 'number' || Number.isNaN(raw)) {
          throw err(st.line,
            '「繰り返し」の回数は数字で書いてください。（いまは ' + typeName(raw) + ' です）',
            '例: 繰り返し 5 回');
        }
        const n = Math.floor(raw);
        for (let i = 1; i <= n; i++) {
          yield { t: 'tick' };
          // 「かいめ」も「回目」も 同じ 数が 入ります（毎回 入れなおすので ずれません）
          this.setVar('かいめ', i, fr);
          this.setVar('回目', i, fr);
          const sig = yield* this.execBlock(st.body, fr);
          if (sig) {
            if (sig.k === 'break') break;
            if (sig.k === 'continue') continue;
            return sig;
          }
        }
        return null;
      }

      case 'While': {
        for (;;) {
          yield { t: 'tick' };
          this.line = st.line;
          const c = yield* this.evalExpr(st.cond, fr);
          if (!truthy(c)) break;
          const sig = yield* this.execBlock(st.body, fr);
          if (sig) {
            if (sig.k === 'break') break;
            if (sig.k === 'continue') continue;
            return sig;
          }
        }
        return null;
      }

      case 'Forever': {
        for (;;) {
          yield { t: 'tick' };
          const sig = yield* this.execBlock(st.body, fr);
          if (sig) {
            if (sig.k === 'break') break;
            if (sig.k !== 'continue') return sig;
          }
          // 1 まわりごとに 1 フレーム まつ（がめんが かたまらない）
          yield { t: 'frame' };
        }
        return null;
      }

      case 'ForEach': {
        const list = yield* this.evalExpr(st.list, fr);
        let items;
        if (Array.isArray(list)) items = list;
        else if (typeof list === 'string') items = Array.from(list);
        else {
          throw err(st.line,
            '「ひとつずつ」にはリストを渡してください。（いまは ' + typeName(list) + ' です）',
            '例: ひとつずつ 番号 = [1, 2, 3]');
        }
        // 中で リストが かわっても こまらないように 写しを つかう
        const copy = items.slice();
        for (const item of copy) {
          yield { t: 'tick' };
          this.setVar(st.name, item, fr);
          const sig = yield* this.execBlock(st.body, fr);
          if (sig) {
            if (sig.k === 'break') break;
            if (sig.k === 'continue') continue;
            return sig;
          }
        }
        return null;
      }

      case 'Return': {
        const v = st.value ? yield* this.evalExpr(st.value, fr) : null;
        return { k: 'return', v };
      }

      case 'Break': return { k: 'break' };
      case 'Continue': return { k: 'continue' };

      default:
        throw err(st.line, 'この文はまだわかりません。', 'コードを見なおしてください');
    }
  }

  /** 左がわに しまう */
  * assignTo(target, value, fr) {
    this.line = target.line;

    if (target.t === 'Name') {
      this.setVar(target.name, value, fr);
      return;
    }

    if (target.t === 'Member') {
      const o = yield* this.evalExpr(target.obj, fr);
      if (o === null || o === undefined) {
        throw err(target.line,
          '「なし」の「' + target.name + '」は変えられません。',
          '先に  勇者 = 箱(0, 5, 0, 4, 4, 4)  のようにものを作ってください');
      }
      if (typeof o !== 'object') {
        throw err(target.line,
          typeName(o) + 'の「' + target.name + '」は変えられません。',
          '「.」が使えるのはものだけです');
      }
      // そのままの字で ある なら そこへ。なければ そろえた形で さがす。
      o[foldedFieldName(o, target.name)] = value;
      return;
    }

    if (target.t === 'Index') {
      const o = yield* this.evalExpr(target.obj, fr);
      const iRaw = yield* this.evalExpr(target.index, fr);
      if (!Array.isArray(o)) {
        throw err(target.line,
          typeName(o) + 'に [ ] でしまうことはできません。',
          '[ ] が使えるのはリストだけです');
      }
      if (typeof iRaw !== 'number' || Number.isNaN(iRaw)) {
        throw err(target.line,
          'リストの番号は数字で書いてください。（いまは ' + typeName(iRaw) + ' です）',
          '例: リスト[0] = 5');
      }
      const idx = Math.floor(iRaw);
      if (idx < 0) {
        throw err(target.line,
          'リストの番号は 0 からはじまります。（' + idx + ' は使えません）',
          '最初は リスト[0] です');
      }
      if (idx > o.length) {
        throw err(target.line,
          'リストの ' + idx + ' 番目にはしまえません。（長さは ' + o.length + ' です）',
          'あとから増やすときは 加える(リスト, もの) を使ってください');
      }
      o[idx] = value;
      return;
    }

    throw err(target.line,
      'ここには = でしまうことができません。',
      '「点 = 1」のように、左には名前を書いてください');
  }

  // ---- 式 -------------------------------------------------------------

  * evalExpr(node, fr) {
    this.line = node.line;
    switch (node.t) {

      case 'Num': return node.v;
      case 'Str': return node.v;
      case 'Bool': return node.v;
      case 'Nil': return null;

      case 'Name': return this.getVar(node.name, fr, node.line);

      case 'List': {
        const arr = [];
        for (const it of node.items) arr.push(yield* this.evalExpr(it, fr));
        return arr;
      }

      case 'Not': {
        const v = yield* this.evalExpr(node.a, fr);
        return !truthy(v);
      }

      case 'Unary': {
        const v = yield* this.evalExpr(node.a, fr);
        if (typeof v !== 'number') {
          throw err(node.line,
            'マイナスは数字にしかつけられません。（いまは ' + typeName(v) + ' です）',
            '数字を書いてください');
        }
        return -v;
      }

      case 'And': {
        const a = yield* this.evalExpr(node.a, fr);
        if (!truthy(a)) return false;
        const b = yield* this.evalExpr(node.b, fr);
        return truthy(b);
      }

      case 'Or': {
        const a = yield* this.evalExpr(node.a, fr);
        if (truthy(a)) return true;
        const b = yield* this.evalExpr(node.b, fr);
        return truthy(b);
      }

      case 'Cmp': {
        const a = yield* this.evalExpr(node.a, fr);
        const b = yield* this.evalExpr(node.b, fr);
        return this.compare(node.op, a, b, node.line);
      }

      case 'Bin': {
        const a = yield* this.evalExpr(node.a, fr);
        const b = yield* this.evalExpr(node.b, fr);
        return this.arith(node.op, a, b, node.line);
      }

      case 'Member': {
        const o = yield* this.evalExpr(node.obj, fr);
        return this.readMember(o, node.name, node.line);
      }

      case 'Index': {
        const o = yield* this.evalExpr(node.obj, fr);
        const i = yield* this.evalExpr(node.index, fr);
        return this.readIndex(o, i, node.line);
      }

      case 'Call':
        return yield* this.evalCall(node, fr);

      default:
        throw err(node.line, 'この式はまだわかりません。', 'コードを見なおしてください');
    }
  }

  /** + - * / % */
  arith(op, a, b, line) {
    if (op === '+') {
      if (typeof a === 'string' || typeof b === 'string') return toStr(a) + toStr(b);
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      throw err(line,
        '「+」は数字どうしか文字列でしか使えません。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        '文字列にするときは "" で囲んでください');
    }
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw err(line,
        '「' + op + '」は数字どうしでしか使えません。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        '数字を入れてください');
    }
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') {
      if (b === 0) {
        throw err(line, '0 で割ることはできません。', '割る数が 0 にならないか確かめてください');
      }
      return a / b;
    }
    if (op === '%') {
      if (b === 0) {
        throw err(line, '0 で割ったあまりは求められません。', '割る数が 0 にならないか確かめてください');
      }
      return a % b;
    }
    throw err(line, '知らない計算です。', 'コードを見なおしてください');
  }

  /** == != < > <= >= */
  compare(op, a, b, line) {
    if (op === '==') return equals(a, b);
    if (op === '!=') return !equals(a, b);
    const bothNum = (typeof a === 'number' && typeof b === 'number');
    const bothStr = (typeof a === 'string' && typeof b === 'string');
    if (!bothNum && !bothStr) {
      throw err(line,
        '「' + op + '」で比べられるのは、数字どうしか文字列どうしだけです。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        '同じかどうかを調べるときは == を使ってください');
    }
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
    throw err(line, '知らない比べ方です。', 'コードを見なおしてください');
  }

  /** もの.なまえ を 読む */
  readMember(o, name, line) {
    if (o === null || o === undefined) {
      throw err(line,
        '「なし」の「' + name + '」は見られません。',
        '先に  勇者 = 箱(0, 5, 0, 4, 4, 4)  のようにものを作ってください');
    }
    if (Array.isArray(o)) {
      if (name === 'ながさ') return o.length;
      throw err(line,
        'リストに「' + name + '」はありません。',
        '長さを知りたいときは 長さ(リスト) を使ってください');
    }
    if (typeof o === 'string') {
      if (name === 'ながさ') return Array.from(o).length;
      throw err(line,
        '文字列に「' + name + '」はありません。',
        '長さを知りたいときは 長さ(文字列) を使ってください');
    }
    if (typeof o !== 'object') {
      throw err(line,
        typeName(o) + 'には「.」が使えません。',
        '「.」が使えるのはものだけです（例: 勇者.x）');
    }
    if (!(name in o)) {
      // そろえた形で もう一度 さがす（タカサ → たかさ など）
      const alt = foldedFieldName(o, name);
      if (alt !== name) {
        const av = o[alt];
        return (av === undefined) ? null : av;
      }
      const near = nearestWord(name, Object.keys(o));
      throw err(line,
        'このものに「' + name + '」はありません。',
        near
          ? 'もしかして「' + near + '」ですか？'
          : '使えるのは x y z 横 高さ 奥行き 色 向き 傾き 見える です');
    }
    const v = o[name];
    return (v === undefined) ? null : v;
  }

  /** リスト[ばんごう] を 読む */
  readIndex(o, i, line) {
    if (typeof i !== 'number' || Number.isNaN(i)) {
      throw err(line,
        'リストの番号は数字で書いてください。（いまは ' + typeName(i) + ' です）',
        '例: リスト[0]');
    }
    const idx = Math.floor(i);
    if (typeof o === 'string') {
      const chars = Array.from(o);
      if (idx < 0 || idx >= chars.length) {
        throw err(line,
          '文字列の ' + idx + ' 番目はありません。（長さは ' + chars.length + ' です）',
          '番号は 0 からはじまります');
      }
      return chars[idx];
    }
    if (!Array.isArray(o)) {
      throw err(line,
        typeName(o) + 'に [ ] は使えません。',
        '[ ] が使えるのはリストと文字列だけです');
    }
    if (idx < 0) {
      throw err(line,
        'リストの番号は 0 からはじまります。（' + idx + ' は使えません）',
        '最初のものは リスト[0] です');
    }
    if (idx >= o.length) {
      throw err(line,
        'リストの ' + idx + ' 番目はありません。（長さは ' + o.length + ' です）',
        '番号は 0 から ' + (o.length - 1) + ' までです');
    }
    const v = o[idx];
    return (v === undefined) ? null : v;
  }

  // ---- よび出し --------------------------------------------------------

  * evalCall(node, fr) {
    // ひきすうを さきに ぜんぶ もとめる
    const args = [];
    for (const a of node.args) args.push(yield* this.evalExpr(a, fr));
    this.line = node.line;

    // だれを よぶ？
    //  ★ さがす 順番は「そのままの字を ぜんぶ ためしてから、そろえた形」。
    //    そのままの字での 一致を かならず 優先します。
    if (node.callee.t === 'Name') {
      const name = node.callee.name;

      // ── 1段目: そのままの字 ──
      // 1) 使う人の 手順
      if (this.procs.has(name)) {
        return yield* this.callProc(this.procs.get(name), args, node.line);
      }
      // 2) 変数に 入っている 手順
      const v0 = this.lookupExact(name, fr);
      if (v0 !== undefined) {
        if (v0 && typeof v0 === 'object' && v0.__proc) {
          return yield* this.callProc(v0.__proc, args, node.line);
        }
        if (typeof v0 === 'function') {
          return yield* this.callBuiltin(name, v0, args, node.line);
        }
      }
      // 3) 組み込みの ことば
      const b = this.builtins;
      if (Object.prototype.hasOwnProperty.call(b, name) && typeof b[name] === 'function') {
        return yield* this.callBuiltin(name, b[name], args, node.line);
      }

      // ── 2段目: そろえた形（カタカナ↔ひらがな）──
      const p2 = this.findProc(name);
      if (p2) return yield* this.callProc(p2, args, node.line);
      const v2 = this.lookup(name, fr);
      if (v2 !== undefined) {
        if (v2 && typeof v2 === 'object' && v2.__proc) {
          return yield* this.callProc(v2.__proc, args, node.line);
        }
        if (typeof v2 === 'function') {
          return yield* this.callBuiltin(name, v2, args, node.line);
        }
      }
      const b2 = this.findBuiltin(name);
      if (b2) return yield* this.callBuiltin(b2.name, b2.fn, args, node.line);

      // ── どこにも ない ──
      const near = nearestWord(name, [
        ...this.procs.keys(),
        ...Object.keys(this.builtins)
      ]);
      throw err(node.line,
        '「' + name + '」ということばはありません。単語帳で探してみてください。',
        near ? 'もしかして「' + near + '」ですか？' : 'つづりを確かめてください');
    }

    // なまえ いがい（もの.なにか() など）
    const target = yield* this.evalExpr(node.callee, fr);
    if (target && typeof target === 'object' && target.__proc) {
      return yield* this.callProc(target.__proc, args, node.line);
    }
    if (typeof target === 'function') {
      return yield* this.callBuiltin('手順', target, args, node.line);
    }
    throw err(node.line,
      typeName(target) + 'は ( ) で呼び出せません。',
      '呼び出せるのは手順だけです');
  }

  /** ユーザーの てじゅんを よぶ */
  * callProc(def, args, line) {
    if (args.length < def.params.length) {
      throw err(line,
        '「' + def.name + '」に渡すものが足りません（' + def.params.length + 'つ必要です）。',
        '使い方: ' + def.name + '(' + def.params.join(', ') + ')');
    }
    if (args.length > def.params.length) {
      throw err(line,
        '「' + def.name + '」に渡すものが多すぎます（' + def.params.length + 'つで大丈夫です）。',
        '使い方: ' + def.name + '(' + def.params.join(', ') + ')');
    }

    this.depth++;
    if (this.depth > MAX_CALL_DEPTH) {
      this.depth--;
      throw err(line,
        '手順の呼び出しが深すぎます。',
        '手順が自分を呼びつづけていないか確かめてください');
    }
    try {
      const nfr = { locals: new Map(), folded: new Map(), name: def.name, global: false };
      for (let i = 0; i < def.params.length; i++) {
        nfr.locals.set(def.params[i], args[i]);
        const f = fold(def.params[i]);
        if (!nfr.folded.has(f)) nfr.folded.set(f, def.params[i]);
      }
      const sig = yield* this.execBlock(def.body, nfr);
      if (sig && sig.k === 'return') return (sig.v === undefined) ? null : sig.v;
      return null;
    } finally {
      this.depth--;
    }
  }

  /** 組み込みの ことばを よぶ */
  /**
   * 「使い方: …」の ヒントを 作ります。
   * 中で ラップされた ことばは 引数の 名前が とれず
   * `(...args)` のような 英語が 出てしまうので、そのときは 出しません。
   */
  つかいかたヒント(name, fn) {
    const u = usageOf(name, fn);
    // 引数の 名前に 英語が まざっていたら 出さない。
    // ただし x y z は ことだまの 正式な 名前なので ゆるします。
    const しらべる = String(u).split(name).join('').replace(/\b[xyz]\b/g, '');
    if (!u || u.includes('...') || /[A-Za-z]/.test(しらべる)) {
      return '単語帳で「' + name + '」を探すと使い方が見られます';
    }
    return u;
  }

  * callBuiltin(name, fn, args, line) {
    const ps = paramNamesOf(fn);
    const variadic = !!(ps && ps.some(p => p.startsWith('...')));
    const need = fn.length;

    if (!variadic && need > 0 && args.length < need) {
      throw err(line,
        '「' + name + '」に渡すものが足りません（' + need + 'つ必要です）。',
        this.つかいかたヒント(name, fn));
    }
    if (!variadic && ps && args.length > ps.length && ps.length > 0) {
      throw err(line,
        '「' + name + '」に渡すものが多すぎます（' + ps.length + 'つで大丈夫です）。',
        this.つかいかたヒント(name, fn));
    }

    let r;
    try {
      r = fn.apply(null, args);
    } catch (e) {
      if (isKotodamaError(e)) throw e;
      const なま = (e && e.message) ? String(e.message) : String(e);
      // ゲームがわ（runtime.js）は 日本語の メッセージを 投げてきます。
      // それが いちばん くわしくて 分かりやすいので、
      // 「うまく いきませんでした」で 上書きせずに そのまま つかいます。
      if (/[ぁ-んァ-ヶ一-龯]/.test(なま)) {
        throw err(line, なま, this.つかいかたヒント(name, fn));
      }
      const wrapped = err(line,
        '「' + name + '」を使うときにうまくいきませんでした。',
        this.つかいかたヒント(name, fn));
      wrapped.detail = なま;
      throw wrapped;
    }

    // まつ() や 1フレームまち
    if (r && typeof r === 'object') {
      if (typeof r.__wait === 'number') {
        yield { t: 'wait', sec: r.__wait };
        return null;
      }
      if (r.__frame === true) {
        yield { t: 'frame' };
        return null;
      }
    }
    return (r === undefined) ? null : r;
  }
}


// =====================================================================
//  9. タスク
// =====================================================================

class Task {
  /**
   * @param gen     ジェネレータ
   * @param name    見出し（デバッグ用）
   * @param script  どの スクリプトの ものか（自分 が ちがう）
   */
  constructor(gen, name, script) {
    this.gen = gen;
    this.name = name || '';
    this.script = script || null;
    this.done = false;
    this.waitSec = 0;     // 待つ() の のこり秒
  }
}


// =====================================================================
//  10. Runner — 契約の 本体
// =====================================================================
//
//  ロブロックス・スタジオのように、ものひとつひとつに コードを 入れられます。
//
//      const runner = new Runner(mainProgram, builtins, onError);
//      runner.start();
//      runner.attach(program2, { 自分: もの2, じぶん: もの2 }, "あかい箱");
//
//  ・変数と 手順は 全部で 共有します（main で 作った 変数が
//    ものの コードから 見え、その 逆も 同じ）
//  ・自分（じぶん）だけは その スクリプト専用です
//  ・エラーには script（スクリプト名）と line（その スクリプト内の 行番号）が 入ります
//

export class Runner {
  /**
   * @param program  parse() の もどり値（ワールド全体の コード）
   * @param builtins { 名前: 関数 } の たいらな オブジェクト
   * @param onError  (KotodamaError) => void
   */
  constructor(program, builtins, onError) {
    this.program = program;
    this.builtins = builtins || {};
    this.onError = (typeof onError === 'function') ? onError : function () {};
    this.tasks = [];
    this.interp = null;
    this.budget = TICK_BUDGET;
    this._started = false;
    this._stopped = false;

    // できごとの うけつけ。どれも { node, script, task } の かたち。
    this._everyFrames = [];    // 毎回
    this._pressHandlers = [];  // 押したとき
    this._touchHandlers = [];  // 触れたとき

    this._attached = [];       // start() より 前に attach() された ぶん
    this._mainScript = null;
    this._curScript = null;    // いま 走っている スクリプト（エラーの script 用）

    this._ranAFrame = false;
    this._pressQueue = [];
    this._touchQueue = [];
  }

  /** 変数を 消して、はじめの タスクを 作る */
  start() {
    if (!this.program || !Array.isArray(this.program.body)) {
      const e = err(1, '動かすコードがありません。', 'なにか書いてから ▶ を押してください');
      this.onError(e);
      return;
    }

    // 触れたとき は ものに 入れた コード専用。main に 書かれていたら 教える。
    const さわる = this.program.touches || [];
    if (さわる.length > 0) {
      const e = err(さわる[0].line,
        '触れたときは、ものに入れたコードの中だけで使えます。',
        'ワールド一覧からものを選んで、そこに書いてください');
      this.onError(e);
      return;
    }

    this.interp = new Interp(this.program, this.builtins);
    this.tasks = [];
    this.budget = TICK_BUDGET;
    this._started = true;
    this._stopped = false;

    this._mainScript = makeScript('', null);
    this._curScript = this._mainScript;

    // 「トップレベルの 文 ＋ 最初に」で タスク 1 本
    this.tasks.push(new Task(this.interp.runBody(this.program.body), 'はじめ', this._mainScript));

    this._everyFrames = (this.program.everyFrame || [])
      .map(node => ({ node, script: this._mainScript }));
    this._pressHandlers = (this.program.presses || [])
      .map(node => ({ node, script: this._mainScript, task: null }));
    this._touchHandlers = [];

    // まだ 1フレームも すすめていないと、トップレベルの 変数が
    // できていません。その間に 押された キーは ためておいて、
    // 1フレーム目の あとで まとめて うけつけます。
    this._ranAFrame = false;
    this._pressQueue = [];
    this._touchQueue = [];

    // start() より 前に attach() された ぶんを、ここで つなぐ。
    // 順番は「main のトップレベル → 各 attach のトップレベル」。
    const まち = this._attached;
    this._attached = [];
    try {
      for (const entry of まち) this._activate(entry);
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * ワールドの もの に 入れた コードを つなぐ。
   *
   * @param program      parse() の もどり値
   * @param extraGlobals { 自分: もの, じぶん: もの } … その スクリプトだけの 変数
   * @param scriptName   スクリプトの 名前（エラーの script に 入る）
   *
   * ・その プログラムの トップレベル文・最初に・毎回・押したとき・触れたとき を 登録します
   * ・変数と 手順は main と 全部で 共有します
   * ・start() の 前でも あとでも 呼べます
   */
  attach(program, extraGlobals, scriptName) {
    const entry = {
      program,
      extraGlobals: extraGlobals || null,
      name: (scriptName === undefined || scriptName === null) ? '' : String(scriptName)
    };
    if (!this._started) { this._attached.push(entry); return; }
    if (this._stopped) return;
    try {
      this._activate(entry);
    } catch (e) {
      this._fail(e);
    }
  }

  /** attach された 1本を 実際に つなぐ */
  _activate(entry) {
    const p = entry.program;
    if (!p || !Array.isArray(p.body)) {
      const e = err(1, '動かすコードがありません。', 'なにか書いてから ▶ を押してください');
      e.script = entry.name;
      throw e;
    }
    const script = makeScript(entry.name, entry.extraGlobals);
    entry.script = script;

    // 手順は みんなで 共有
    this.interp.addProgram(p);

    this.tasks.push(new Task(this.interp.runBody(p.body), 'はじめ', script));
    for (const node of (p.everyFrame || [])) this._everyFrames.push({ node, script });
    for (const node of (p.presses || [])) this._pressHandlers.push({ node, script, task: null });
    for (const node of (p.touches || [])) this._touchHandlers.push({ node, script, task: null });
  }

  /** 1 フレーム すすめる（dt は 秒） */
  frame(dt) {
    if (!this._started || this._stopped) return;
    const step = (typeof dt === 'number' && dt >= 0) ? dt : 0;
    this.budget = TICK_BUDGET;
    try {
      // 1) うごいている タスク
      const list = this.tasks.slice();
      for (const t of list) {
        if (this._stopped) break;
        if (!t.done) this._runTask(t, step);
      }
      this.tasks = this.tasks.filter(t => !t.done);

      // 1.5) 始まる前に 押されていた キー・当たった もの を、ここで うけつける
      this._ranAFrame = true;
      if (this._pressQueue.length && !this._stopped) {
        const まちキー = this._pressQueue;
        this._pressQueue = [];
        for (const k of まちキー) {
          this.press(k);
          if (this._stopped) break;
        }
      }
      if (this._touchQueue.length && !this._stopped) {
        const まち = this._touchQueue;
        this._touchQueue = [];
        for (const t of まち) {
          this.touch(t[0], t[1]);
          if (this._stopped) break;
        }
      }

      // 2) 毎回（毎フレーム 最初から 最後まで）
      if (!this._stopped) {
        for (const ev of this._everyFrames) {
          this._runEveryFrame(ev);
          if (this._stopped) break;
        }
      }
    } catch (e) {
      this._fail(e);
    }
  }

  /** キーが 押された しゅんかん */
  press(keyName) {
    if (!this._started || this._stopped) return;
    // 1フレーム目の 前なら、まだ 変数が できていないので ためておく
    if (!this._ranAFrame) {
      if (this._pressQueue.length < 16) this._pressQueue.push(keyName);
      return;
    }
    try {
      for (const h of this._pressHandlers) {
        this._enter(h.script);
        const key = this._evalNow(h.node.key);
        if (!sameKey(key, keyName)) continue;
        // おなじ ハンドラは 1 本まで（走っていたら むし）
        if (h.task && !h.task.done) continue;
        const t = new Task(this.interp.runBody(h.node.body), '押したとき', h.script);
        h.task = t;
        this.tasks.push(t);
        // 押した しゅんかんに すこし すすめる（待つ／フレームまち まで）
        this.budget = TICK_BUDGET;
        this._runTask(t, 0);
      }
      this.tasks = this.tasks.filter(t => !t.done);
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * もの に なにかが 当たった しゅんかん。
   *   もの   … ぶつかられた ほう（その ものに 入れた コードの 触れたとき が 走る）
   *   相手   … ぶつかってきた ほう（触れたとき (相手) の 中に 入る）
   * 同じ ハンドラが 走っている あいだの 重ねがけは、押したとき と 同じで むしします。
   */
  touch(もの, 相手) {
    if (!this._started || this._stopped) return;
    if (!this._ranAFrame) {
      if (this._touchQueue.length < 16) this._touchQueue.push([もの, 相手]);
      return;
    }
    try {
      for (const h of this._touchHandlers) {
        if (!h.script || h.script.extras.get('自分') !== もの) continue;
        if (h.task && !h.task.done) continue;
        // 相手 を 入れた わくを 作る。
        // global: true なので、中で 作った 新しい 変数は みんなの ものに なります。
        const fr = { locals: new Map(), folded: new Map(), name: '触れたとき', global: true };
        if (h.node.param) {
          fr.locals.set(h.node.param, 相手);
          fr.folded.set(そろえた形(h.node.param), h.node.param);
        }
        const t = new Task(this.interp.runBody(h.node.body, fr), '触れたとき', h.script);
        h.task = t;
        this.tasks.push(t);
        this.budget = TICK_BUDGET;
        this._runTask(t, 0);
      }
      this.tasks = this.tasks.filter(t => !t.done);
    } catch (e) {
      this._fail(e);
    }
  }

  /** ぜんぶ 止める */
  stop() {
    this.tasks = [];
    this._pressHandlers.forEach(h => { h.task = null; });
    this._touchHandlers.forEach(h => { h.task = null; });
    this._stopped = true;
  }

  /** まだ うごいている？ */
  get running() {
    if (!this._started || this._stopped) return false;
    if (this.tasks.some(t => !t.done)) return true;
    if (this._everyFrames.length > 0) return true;
    if (this._pressHandlers.length > 0) return true;
    if (this._touchHandlers.length > 0) return true;
    return false;
  }

  // ---- ここから 中で つかう ぶぶん --------------------------------------

  /** いまから この スクリプトを 走らせる、と しるしを つける */
  _enter(script) {
    this._curScript = script || this._mainScript;
    if (this.interp) this.interp.script = this._curScript;
  }

  /** タスクを 「フレームまち」か「おわり」まで まわす */
  _runTask(task, dt) {
    if (task.done) return;

    // まっている とちゅう？
    if (task.waitSec > 0) {
      task.waitSec -= dt;
      if (task.waitSec > 0) return;
      task.waitSec = 0;
    }

    this._enter(task.script);
    for (;;) {
      if (this.budget <= 0) {
        throw err(this._line(),
          '繰り返しが多すぎて止まりません。',
          'ずっと の中に 待つ(0.1) を入れてみてください');
      }
      const r = task.gen.next();
      if (r.done) { task.done = true; return; }

      const v = r.value || {};
      if (v.t === 'tick') { this.budget--; continue; }
      if (v.t === 'frame') return;
      if (v.t === 'wait') {
        const sec = Number(v.sec);
        task.waitSec = (Number.isFinite(sec) && sec > 0) ? sec : 0;
        return;   // 待つ() は すくなくとも 1 フレーム やすむ
      }
      // しらない yield は かぞえるだけ
      this.budget--;
    }
  }

  /** 毎回 を 1 回 さいごまで まわす（待つ は つかえない） */
  _runEveryFrame(ev) {
    this._enter(ev.script);
    const gen = this.interp.runBody(ev.node.body);
    for (;;) {
      if (this.budget <= 0) {
        throw err(this._line(),
          '繰り返しが多すぎて止まりません。',
          'ずっと の中に 待つ(0.1) を入れてみてください');
      }
      const r = gen.next();
      if (r.done) return;
      const v = r.value || {};
      if (v.t === 'tick') { this.budget--; continue; }
      if (v.t === 'frame' || v.t === 'wait') {
        throw err(this._line(),
          '毎回 の中では 待つ() は使えません。',
          '待つ() を使いたいときは「ずっと」の中に書いてください');
      }
      this.budget--;
    }
  }

  /** 式を その場で もとめる（押したとき の キーの ため） */
  _evalNow(node) {
    const gen = this.interp.evalExpr(node, null);
    let guard = 100000;
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
      if (--guard <= 0) {
        throw err(node.line,
          '押したとき のキーの調べ方が長すぎます。',
          '押したとき("スペース") のように簡単に書いてください');
      }
    }
  }

  _line() {
    return (this.interp && this.interp.line) ? this.interp.line : 1;
  }

  _fail(e) {
    const ke = toKotodamaError(e, this._line());
    // どの スクリプトで おきたか を つける（main なら 空文字）
    if (!ke.script) ke.script = this._curScript ? this._curScript.name : '';
    this.stop();
    try {
      this.onError(ke);
    } catch (e2) {
      // onError が こけても なにも しない
    }
  }
}

/**
 * スクリプトの 入れもの を つくる。
 *   name        … スクリプトの 名前（main は 空文字）
 *   extras      … その スクリプトだけの 変数（自分 など）
 *   extrasFolded… そろえた形の 索引（ジブン でも 見つかるように）
 */
function makeScript(name, extraGlobals) {
  const extras = new Map();
  const extrasFolded = new Map();
  if (extraGlobals) {
    for (const k of Object.keys(extraGlobals)) {
      extras.set(k, extraGlobals[k]);
      const f = そろえた形(k);
      if (!extrasFolded.has(f)) extrasFolded.set(f, k);
    }
  }
  return { name: name || '', extras, extrasFolded };
}

/** キーの 名まえくらべ（英字は 大文字小文字を 気にしない） */
function sameKey(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.toUpperCase() === b.toUpperCase();
}
