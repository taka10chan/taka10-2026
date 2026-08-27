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
 * message … 日本語の せつめい（「12ぎょうめ: …」から はじまる）
 * hint    … どうすれば いいか
 */
export class KotodamaError extends Error {
  constructor(line, message, hint) {
    super(message);
    this.name = 'KotodamaError';
    this.line = line;
    this.message = message;
    this.hint = hint || '';
  }
}

/**
 * 中で つかう エラー作りの ヘルパー。
 * message の あたまに「12ぎょうめ: 」を くっつけて KotodamaError を 返す。
 * （行番号なしの 本文は rawMessage に 入れておく）
 */
function err(line, message, hint) {
  const n = (typeof line === 'number' && line > 0) ? Math.floor(line) : 1;
  const e = new KotodamaError(n, n + 'ぎょうめ: ' + message, hint || '');
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
    'なにか こまった ことが おきました。',
    'この 行を 見なおしてみてね'
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

/** ソース全体を 先に きれいにする（行の 数は 変わらない） */
function normalize(source) {
  const src = String(source == null ? '' : source)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
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
const KEYWORDS = [
  'もし', 'なら', 'そうでなければ', 'そうでなくもし', 'おわり',
  'くりかえし', 'かい', 'のあいだ', 'ずっと', 'ひとつずつ', 'ぬける', 'つぎへ',
  'まいかい', 'はじめに', 'おしたとき',
  'てじゅん', 'かえす',
  'かつ', 'または', 'ではない',
  'はい', 'いいえ', 'なし'
];
const KEYWORD_SET = new Set(KEYWORDS);

// 文の あたまに 来る キーワード（打ち間違い さがしに つかう）
const STATEMENT_KEYWORDS = [
  'もし', 'そうでなくもし', 'そうでなければ', 'おわり',
  'くりかえし', 'ずっと', 'ひとつずつ', 'ぬける', 'つぎへ',
  'まいかい', 'はじめに', 'おしたとき', 'てじゅん', 'かえす'
];

// 記号として つかう 文字
const SYMBOL_CHARS = new Set(['(', ')', '[', ']', ',', '.', '=', '!', '<', '>', '+', '-', '*', '/', '%']);

// つかえない 文字と、その ときの アドバイス
const BAD_CHARS = {
  '&': ['「&」は つかいません。', '「かつ」と 書いてね（れい: もし A かつ B なら）'],
  '|': ['「|」は つかいません。', '「または」と 書いてね（れい: もし A または B なら）'],
  ';': ['「;」は いりません。', '文の おわりは 行を かえるだけで いいよ'],
  '{': ['「{」は つかいません。', 'ブロックは 行を かえて さいごに 「おわり」と 書きます'],
  '}': ['「}」は つかいません。', 'ブロックは 行を かえて さいごに 「おわり」と 書きます'],
  '\'': ['文字は \' では かこめません。', '「こんにちは」か "こんにちは" のように 書いてね'],
  '。': ['「。」は いりません。', '文の おわりは 行を かえるだけで いいよ'],
  '「': null, // 文字列の はじまりなので ここでは あつかわない
  '」': ['文字列の はじまりの 「 が ありません。', '「こんにちは」の ように かこんでね']
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
            '文字列の おわりの " が ありません。',
            '"こんにちは" の ように おなじ 行の 中で " を 2つ 書いてね');
        }
        text += s[i];
        i++;
      }
      if (i >= s.length) {
        throw err(startLine,
          '文字列の おわりの " が ありません。',
          '"こんにちは" の ように " で かこんでね');
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
            '文字列の おわりの 」 が ありません。',
            '「こんにちは」の ように おなじ 行の 中で とじてね');
        }
        text += s[i];
        i++;
      }
      if (i >= s.length) {
        throw err(startLine,
          '文字列の おわりの 」 が ありません。',
          '「こんにちは」の ように 」 で とじてね');
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
        '「!」だけでは つかえません。',
        'ちがう かどうかを くらべるときは 「!=」と 2つ 書いてね');
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
        '「' + c + '」は つかえない 文字です。',
        'ひらがな・カタカナ・漢字・数字・記号( ) + - * / を つかってね');
    }
    push(KEYWORD_SET.has(name) ? 'KW' : 'IDENT', name);
  }

  push('NEWLINE', '\n');
  push('EOF', null);
  return toks;
}

/** トークンを 人に 見せるときの 文字 */
function tokenText(t) {
  if (!t) return 'コードの おわり';
  if (t.type === 'NEWLINE') return '改行';
  if (t.type === 'EOF') return 'コードの おわり';
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

/** 候補の 中から 1 文字ちがいの ことばを さがす */
function nearestWord(name, candidates) {
  if (!name || name.length < 2) return null;
  let best = null;
  let bestD = 99;
  for (const c of candidates) {
    if (c === name) return null; // ぴったり あるなら 打ち間違いでは ない
    if (c.length < 2) continue;
    const d = editDistance(name, c);
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
      body: [],        // トップレベルの 文（はじめに も ここに 入る）
      everyFrame: [],  // まいかい
      presses: [],     // おしたとき
      procs: new Map() // てじゅん
    };

    this.skipNL();
    while (!this.at('EOF')) {
      if (this.atKW('まいかい')) {
        prog.everyFrame.push(this.parseEveryFrame());
      } else if (this.atKW('おしたとき')) {
        prog.presses.push(this.parseOnPress());
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

        // この 3 つは いちばん そとがわ だけ
        case 'まいかい':
        case 'おしたとき':
        case 'てじゅん':
          throw err(t.line,
            '「' + t.value + '」は いちばん そとがわに 書いてね。',
            'ほかの ブロックの 中には 書けません');

        case 'そうでなければ':
        case 'そうでなくもし':
          throw err(t.line,
            '「' + t.value + '」は 「もし」の あとにしか 書けません。',
            'さきに 「もし ○○ なら」を 書いてね');

        case 'おわり':
          throw err(t.line,
            '「おわり」が よぶんに あります。',
            'はじまりの 「もし」や 「くりかえし」が あるか 見てね');

        case 'なら':
          throw err(t.line,
            '「なら」だけでは つかえません。',
            '「もし てん > 10 なら」の ように 書いてね');

        case 'かい':
          throw err(t.line,
            '「かい」だけでは つかえません。',
            '「くりかえし 5 かい」の ように 書いてね');

        case 'のあいだ':
          throw err(t.line,
            '「のあいだ」の まえに くらべる ことを 書いてね。',
            '「てん < 10 のあいだ くりかえし」の ように 書きます');
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
          '「のあいだ」の あとには 「くりかえし」と 書いてね。',
          '「てん < 10 のあいだ くりかえし」の ように 書きます');
      }
      this.loopDepth++;
      const body = this.parseBlock('のあいだ くりかえし', line, ['おわり']);
      this.loopDepth--;
      this.expectEnd('のあいだ くりかえし', line);
      return { t: 'While', cond: expr, body, line };
    }

    // 代入
    if (this.at('OP', '=')) {
      const eqLine = this.cur.line;
      this.next();
      const value = this.parseExpr(false);
      if (expr.t !== 'Name' && expr.t !== 'Member' && expr.t !== 'Index') {
        throw err(eqLine,
          'ここには = で しまうことが できません。',
          '「てん = 1」の ように 左には なまえを 書いてね');
      }
      this.endStmt();
      return { t: 'Assign', target: expr, value, line };
    }

    // ただの 式（ほとんどは 関数よび出し）
    if (expr.t === 'Cmp' && expr.op === '==') {
      throw err(line,
        '「==」は くらべる ときに つかいます。この 行では なにも おきません。',
        'いれる ときは 「てん = 1」の ように = を 1つ 書きます');
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
          '「' + kw + '」の あとには 空白（スペース）を あけてね。',
          '「' + kw + ' ' + name.slice(kw.length) + '」の ように わけて 書きます');
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
        '「' + name + '」という ことばは わかりません。もしかして 「' + near + '」ですか？',
        '「' + near + '」と 書いて、あとには 空白を あけてね');
    }
  }

  /** 文の おわり（改行）を たしかめる */
  endStmt() {
    if (this.at('NEWLINE')) { this.p++; return; }
    if (this.at('EOF')) return;
    const t = this.cur;
    if (t.type === 'KW' && t.value === 'なら') {
      throw err(t.line,
        '「なら」の まえは 「もし」で はじめてね。',
        '「もし てん > 10 なら」の ように 書きます');
    }
    throw err(t.line,
      'この 行の おわりに よぶんな 「' + tokenText(t) + '」が あります。',
      '1つの 行には 1つの めいれいを 書きます');
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
          '「' + openKW + '」の あとに なにも ありません。',
          'つぎの 行に やることを 書いて、さいごに 「おわり」と 書きます');
      }
      throw err(t.line,
        '「' + openKW + '」の 行の あとは 行を かえてね。「' + tokenText(t) + '」は ここには 書けません。',
        '「' + openKW + '」の つぎの 行から やることを 書きます');
    }
    this.p++; // 改行を たべる

    const stmts = [];
    for (;;) {
      this.skipNL();
      if (this.at('EOF')) {
        throw err(openLine,
          '「' + openKW + '」に あう 「おわり」が ありません。',
          'ブロックの さいごには おわり を 書きます');
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
        '「' + t.value + '」は 「もし」の 中でだけ つかえます。',
        '「' + openKW + '」の ブロックでは つかえません');
    }
    throw err(openLine,
      '「' + openKW + '」に あう 「おわり」が ありません。',
      'ブロックの さいごには おわり を 書きます');
  }

  /** 名前を 1 つ 読む */
  expectName(what) {
    const t = this.cur;
    if (t.type !== 'IDENT') {
      throw err(t.line,
        what + 'の なまえが ありません。（「' + tokenText(t) + '」が ありました）',
        'ひらがなや 漢字で なまえを つけてね');
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
        '「もし」の 行の さいごには 「なら」を 書いてね。',
        '「もし てん > 10 なら」の ように 書きます');
    }
    const clauses = [];
    clauses.push({ cond, body: this.parseBlock('もし', line, ['そうでなくもし', 'そうでなければ', 'おわり']) });

    while (this.atKW('そうでなくもし')) {
      const l2 = this.next().line;
      const c2 = this.parseExpr(false);
      if (!this.eatKW('なら')) {
        throw err(this.cur.line,
          '「そうでなくもし」の 行の さいごには 「なら」を 書いてね。',
          '「そうでなくもし てん > 5 なら」の ように 書きます');
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
        '「くりかえし」の 行の さいごには 「かい」を 書いてね。',
        '「くりかえし 5 かい」の ように 書きます');
    }
    this.loopDepth++;
    const body = this.parseBlock('くりかえし', line, ['おわり']);
    this.loopDepth--;
    this.expectEnd('くりかえし', line);
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
        '「ひとつずつ」は 「ひとつずつ ○ = リスト」の ように 書いてね。',
        'れい: ひとつずつ てき = てきたち');
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
    const body = this.parseBlock('はじめに', line, ['おわり']);
    this.expectEnd('はじめに', line);
    return { t: 'Block', body, line };
  }

  // ---- まいかい --------------------------------------------------------
  parseEveryFrame() {
    const line = this.next().line;
    const body = this.parseBlock('まいかい', line, ['おわり']);
    this.expectEnd('まいかい', line);
    return { t: 'EveryFrame', body, line };
  }

  // ---- おしたとき(キー) -------------------------------------------------
  parseOnPress() {
    const line = this.next().line;
    if (!this.eatOP('(')) {
      throw err(this.cur.line,
        '「おしたとき」の あとには ( ) で キーの なまえを 書いてね。',
        'れい: おしたとき("スペース")');
    }
    const key = this.parseExpr(false);
    if (!this.eatOP(')')) {
      throw err(this.cur.line,
        '「おしたとき」の ) が たりません。',
        'れい: おしたとき("スペース")');
    }
    const body = this.parseBlock('おしたとき', line, ['おわり']);
    this.expectEnd('おしたとき', line);
    return { t: 'OnPress', key, body, line };
  }

  // ---- てじゅん なまえ(ひきすう…) ----------------------------------------
  parseProc() {
    const line = this.next().line;
    const name = this.expectName('てじゅん');
    if (!this.eatOP('(')) {
      throw err(this.cur.line,
        '「てじゅん ' + name + '」の あとには ( ) を 書いてね。',
        'れい: てじゅん たす(a, b)');
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
        '「てじゅん ' + name + '」の ) が たりません。',
        'ひきすうは 「,」で くぎって さいごに ) を 書きます');
    }

    // てじゅんの 中では くりかえしの そとに もどる
    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    this.funcDepth++;
    const body = this.parseBlock('てじゅん', line, ['おわり']);
    this.funcDepth--;
    this.loopDepth = savedLoop;

    this.expectEnd('てじゅん', line);
    return { t: 'Proc', name, params, body, line };
  }

  // ---- かえす / ぬける / つぎへ -------------------------------------------
  parseReturn() {
    const line = this.next().line;
    if (this.funcDepth === 0) {
      throw err(line,
        '「かえす」は てじゅんの 中でだけ つかえます。',
        '「てじゅん なまえ(…)」の 中に 書いてね');
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
        '「ぬける」は くりかえしの 中でだけ つかえます。',
        '「くりかえし … おわり」の 中に 書いてね');
    }
    this.endStmt();
    return { t: 'Break', line };
  }

  parseContinue() {
    const line = this.next().line;
    if (this.loopDepth === 0) {
      throw err(line,
        '「つぎへ」は くりかえしの 中でだけ つかえます。',
        '「くりかえし … おわり」の 中に 書いてね');
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
          'くらべるときは = ではなく == と 2つ 書いてね。',
          'れい: もし てん == 10 なら');
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
            '「.」の あとには なまえを 書いてね。',
            'れい: ゆうしゃ.x');
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
            '「]」が たりません。',
            'れい: リスト[0]');
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
      const nm = (calleeNode && calleeNode.t === 'Name') ? calleeNode.name : 'この てじゅん';
      if (t.type === 'EOF' || t.type === 'NEWLINE') {
        throw err(t.line,
          '「' + nm + '」の とじる ) が ありません。',
          '( で はじめたら ) で とじてね（れい: ' + nm + '(1, 2)）');
      }
      throw err(t.line,
        '「' + nm + '」の ひきすうの ところに 「' + tokenText(t) + '」が あって わかりません。ここに ) が たりないのかも。',
        'ひきすうは 「,」（コンマ）で くぎって さいごに ) を 書きます');
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
        'ここに 「' + t.value + '」は 書けません。',
        'かず や もじ や へんすうの なまえを 書いてね');
    }

    if (t.type === 'IDENT') { this.p++; return { t: 'Name', name: t.value, line: t.line }; }

    if (t.type === 'OP' && t.value === '(') {
      this.p++;
      this.skipNL();
      const e = this.parseExpr(false);
      this.skipNL();
      if (!this.eatOP(')')) {
        throw err(this.cur.line,
          '「)」が たりません。',
          '( で はじめたら ) で とじてね');
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
          'リストの 中に 「' + tokenText(this.cur) + '」が あって わかりません。',
          'リストは [1, 2, 3] の ように 「,」で くぎります');
      }
    }

    if (t.type === 'NEWLINE' || t.type === 'EOF') {
      throw err(t.line,
        'ここに けいさんする ものが ありません。',
        'かず や もじ や へんすうの なまえを 書いてね');
    }

    if (t.type === 'OP' && t.value === '=') {
      throw err(t.line,
        'くらべるときは = ではなく == と 2つ 書いてね。',
        'れい: もし てん == 10 なら');
    }

    throw err(t.line,
      '「' + tokenText(t) + '」の つかいかたが ちがうみたいです。',
      'この 行を 見なおしてみてね');
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
    if (Number.isNaN(v)) return 'すうじではない';
    if (!Number.isFinite(v)) return (v > 0 ? 'むげんだい' : '-むげんだい');
    if (Number.isInteger(v)) return String(v);
    // 0.30000000000000004 みたいなのを きれいにする
    return String(parseFloat(v.toFixed(10)));
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(toStr).join(', ') + ']';
  if (typeof v === 'function') return 'てじゅん';
  if (typeof v === 'object') {
    if (v.__proc) return 'てじゅん';
    if (typeof v['もじ'] === 'string' && v['もじ'] !== '') return 'もの(' + v['もじ'] + ')';
    return 'もの';
  }
  return String(v);
}

/** 値の しゅるいの 名まえ（エラーで つかう） */
function typeName(v) {
  if (v === null || v === undefined) return 'なし';
  if (typeof v === 'boolean') return 'はい／いいえ';
  if (typeof v === 'number') return 'すうじ';
  if (typeof v === 'string') return 'もじれつ';
  if (Array.isArray(v)) return 'リスト';
  if (typeof v === 'function') return 'てじゅん';
  return 'もの';
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

/** 「つかいかた: うごかす(もの, よこ, たて)」の 文字を つくる */
function usageOf(name, fn) {
  const ps = paramNamesOf(fn);
  // ひきすうの 名まえが わからない ばあい（bind した 関数 など）は … と 出す
  if (!ps) return 'つかいかた: ' + name + '(…)';
  if (ps.length === 0 && fn.length > 0) return 'つかいかた: ' + name + '(…)';
  return 'つかいかた: ' + name + '(' + ps.join(', ') + ')';
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
    this.procs = (program && program.procs) ? program.procs : new Map();
    this.globals = new Map();

    // ことばのうち、関数でないものは「さいしょからある へんすう」にします。
    // （プレイヤー や ちめん など、書かなくても もう そこに あるもの）
    for (const 名 of Object.keys(this.builtins)) {
      if (typeof this.builtins[名] !== 'function') {
        this.globals.set(名, this.builtins[名]);
      }
    }
    this.depth = 0;
    this.line = 1;   // いま どの 行を 実行しているか（エラー用）
  }

  // ---- へんすう -------------------------------------------------------

  /** 名まえを さがす（見つからないと undefined） */
  lookup(name, fr) {
    if (fr && fr.locals.has(name)) return fr.locals.get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  hasVar(name, fr) {
    return !!((fr && fr.locals.has(name)) || this.globals.has(name));
  }

  /** 読む（なければ 親切な エラー） */
  getVar(name, fr, line) {
    if (fr && fr.locals.has(name)) return fr.locals.get(name);
    if (this.globals.has(name)) return this.globals.get(name);

    // てじゅん や 組み込みの 名まえを ( ) なしで 書いた ばあい
    if (this.procs.has(name) || typeof this.builtins[name] === 'function') {
      throw err(line,
        '「' + name + '」を つかうときは ( ) を 書いてね。',
        'れい: ' + name + '(…)');
    }
    // 打ち間違い さがし
    const near = nearestWord(name, [
      ...this.globals.keys(),
      ...(fr ? fr.locals.keys() : []),
      ...this.procs.keys(),
      ...Object.keys(this.builtins)
    ]);
    throw err(line,
      '「' + name + '」という へんすうは まだ ありません。',
      near
        ? 'もしかして 「' + near + '」ですか？'
        : 'さきに ' + name + ' = え(100, 200, "🐱") のように つくってね');
  }

  /**
   * しまう。
   * てじゅんの 中では
   *   すでに ローカルに ある → ローカル
   *   グローバルに ある       → グローバル
   *   どこにも ない           → あたらしく ローカル
   */
  setVar(name, value, fr) {
    if (fr) {
      if (fr.locals.has(name)) { fr.locals.set(name, value); return; }
      if (this.globals.has(name)) { this.globals.set(name, value); return; }
      fr.locals.set(name, value);
      return;
    }
    this.globals.set(name, value);
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

  /** タスクの 入口（トップレベル用） */
  * runBody(stmts) {
    yield* this.execBlock(stmts, null);
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
            '「くりかえし」の かいすうは すうじで 書いてね。（いまは ' + typeName(raw) + ' です）',
            'れい: くりかえし 5 かい');
        }
        const n = Math.floor(raw);
        for (let i = 1; i <= n; i++) {
          yield { t: 'tick' };
          this.setVar('かいめ', i, fr);
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
            '「ひとつずつ」には リストを わたしてね。（いまは ' + typeName(list) + ' です）',
            'れい: ひとつずつ x = [1, 2, 3]');
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
        throw err(st.line, 'この 文は まだ わかりません。', 'コードを 見なおしてみてね');
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
          '「なし」の 「' + target.name + '」は かえられません。',
          'さきに ものを つくってね（れい: ゆうしゃ = え(100, 200, "🐱")）');
      }
      if (typeof o !== 'object') {
        throw err(target.line,
          typeName(o) + 'の 「' + target.name + '」は かえられません。',
          '「.」が つかえるのは ものだけです');
      }
      o[target.name] = value;
      return;
    }

    if (target.t === 'Index') {
      const o = yield* this.evalExpr(target.obj, fr);
      const iRaw = yield* this.evalExpr(target.index, fr);
      if (!Array.isArray(o)) {
        throw err(target.line,
          typeName(o) + 'に [ ] で しまうことは できません。',
          '[ ] が つかえるのは リストだけです');
      }
      if (typeof iRaw !== 'number' || Number.isNaN(iRaw)) {
        throw err(target.line,
          'リストの ばんごうは すうじで 書いてね。（いまは ' + typeName(iRaw) + ' です）',
          'れい: リスト[0] = 5');
      }
      const idx = Math.floor(iRaw);
      if (idx < 0) {
        throw err(target.line,
          'リストの ばんごうは 0 から はじまります。（' + idx + ' は つかえません）',
          'さいしょは リスト[0] です');
      }
      if (idx > o.length) {
        throw err(target.line,
          'リストの ' + idx + ' ばんめには しまえません。（ながさは ' + o.length + ' です）',
          'あとから ふやすときは くわえる(リスト, もの) を つかってね');
      }
      o[idx] = value;
      return;
    }

    throw err(target.line,
      'ここには = で しまうことが できません。',
      '「てん = 1」の ように 左には なまえを 書いてね');
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
            'マイナスは すうじにしか つけられません。（いまは ' + typeName(v) + ' です）',
            'すうじを 書いてね');
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
        throw err(node.line, 'この しきは まだ わかりません。', 'コードを 見なおしてみてね');
    }
  }

  /** + - * / % */
  arith(op, a, b, line) {
    if (op === '+') {
      if (typeof a === 'string' || typeof b === 'string') return toStr(a) + toStr(b);
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      throw err(line,
        '「+」は すうじ どうし か もじれつ でしか つかえません。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        'もじれつに するときは "" で かこんでね');
    }
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw err(line,
        '「' + op + '」は すうじ どうしでしか つかえません。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        'すうじを 入れてね');
    }
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') {
      if (b === 0) {
        throw err(line, '0 で わることは できません。', 'わる かずが 0 に ならないか たしかめてね');
      }
      return a / b;
    }
    if (op === '%') {
      if (b === 0) {
        throw err(line, '0 で わった あまりは もとめられません。', 'わる かずが 0 に ならないか たしかめてね');
      }
      return a % b;
    }
    throw err(line, 'しらない けいさんです。', 'コードを 見なおしてみてね');
  }

  /** == != < > <= >= */
  compare(op, a, b, line) {
    if (op === '==') return equals(a, b);
    if (op === '!=') return !equals(a, b);
    const bothNum = (typeof a === 'number' && typeof b === 'number');
    const bothStr = (typeof a === 'string' && typeof b === 'string');
    if (!bothNum && !bothStr) {
      throw err(line,
        '「' + op + '」で くらべられるのは すうじ どうし か もじれつ どうし だけです。（' + typeName(a) + ' と ' + typeName(b) + ' でした）',
        'おなじかどうかを しらべるときは == を つかってね');
    }
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
    throw err(line, 'しらない くらべかたです。', 'コードを 見なおしてみてね');
  }

  /** もの.なまえ を 読む */
  readMember(o, name, line) {
    if (o === null || o === undefined) {
      throw err(line,
        '「なし」の 「' + name + '」は 見られません。',
        'さきに ものを つくってね（れい: ゆうしゃ = え(100, 200, "🐱")）');
    }
    if (Array.isArray(o)) {
      if (name === 'ながさ') return o.length;
      throw err(line,
        'リストに 「' + name + '」は ありません。',
        'ながさを 知りたいときは ながさ(リスト) を つかってね');
    }
    if (typeof o === 'string') {
      if (name === 'ながさ') return Array.from(o).length;
      throw err(line,
        'もじれつに 「' + name + '」は ありません。',
        'ながさを 知りたいときは ながさ(もじれつ) を つかってね');
    }
    if (typeof o !== 'object') {
      throw err(line,
        typeName(o) + 'には 「.」が つかえません。',
        '「.」が つかえるのは ものだけです（れい: ゆうしゃ.x）');
    }
    if (!(name in o)) {
      const near = nearestWord(name, Object.keys(o));
      throw err(line,
        'この ものに 「' + name + '」は ありません。',
        near
          ? 'もしかして 「' + near + '」ですか？'
          : 'つかえるのは x y よこ たて いろ むき もじ みえる です');
    }
    const v = o[name];
    return (v === undefined) ? null : v;
  }

  /** リスト[ばんごう] を 読む */
  readIndex(o, i, line) {
    if (typeof i !== 'number' || Number.isNaN(i)) {
      throw err(line,
        'リストの ばんごうは すうじで 書いてね。（いまは ' + typeName(i) + ' です）',
        'れい: リスト[0]');
    }
    const idx = Math.floor(i);
    if (typeof o === 'string') {
      const chars = Array.from(o);
      if (idx < 0 || idx >= chars.length) {
        throw err(line,
          'もじれつの ' + idx + ' ばんめは ありません。（ながさは ' + chars.length + ' です）',
          'ばんごうは 0 から はじまります');
      }
      return chars[idx];
    }
    if (!Array.isArray(o)) {
      throw err(line,
        typeName(o) + 'に [ ] は つかえません。',
        '[ ] が つかえるのは リストと もじれつ だけです');
    }
    if (idx < 0) {
      throw err(line,
        'リストの ばんごうは 0 から はじまります。（' + idx + ' は つかえません）',
        'さいしょの ものは リスト[0] です');
    }
    if (idx >= o.length) {
      throw err(line,
        'リストの ' + idx + ' ばんめは ありません。（ながさは ' + o.length + ' です）',
        'ばんごうは 0 から ' + (o.length - 1) + ' までです');
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
    if (node.callee.t === 'Name') {
      const name = node.callee.name;

      // 1) ユーザーの てじゅん
      if (this.procs.has(name)) {
        return yield* this.callProc(this.procs.get(name), args, node.line);
      }
      // 2) へんすうに 入っている てじゅん
      const v = this.lookup(name, fr);
      if (v !== undefined) {
        if (v && typeof v === 'object' && v.__proc) {
          return yield* this.callProc(v.__proc, args, node.line);
        }
        if (typeof v === 'function') {
          return yield* this.callBuiltin(name, v, args, node.line);
        }
      }
      // 3) 組み込みの ことば
      const bi = this.builtins[name];
      if (typeof bi === 'function') {
        return yield* this.callBuiltin(name, bi, args, node.line);
      }
      // 4) ない
      const near = nearestWord(name, [
        ...this.procs.keys(),
        ...Object.keys(this.builtins)
      ]);
      throw err(node.line,
        '「' + name + '」という ことばは ありません。単語帳で さがしてみよう。',
        near ? 'もしかして 「' + near + '」ですか？' : 'つづりを たしかめてね');
    }

    // なまえ いがい（もの.なにか() など）
    const target = yield* this.evalExpr(node.callee, fr);
    if (target && typeof target === 'object' && target.__proc) {
      return yield* this.callProc(target.__proc, args, node.line);
    }
    if (typeof target === 'function') {
      return yield* this.callBuiltin('てじゅん', target, args, node.line);
    }
    throw err(node.line,
      typeName(target) + 'は ( ) で よび出せません。',
      'よび出せるのは てじゅん だけです');
  }

  /** ユーザーの てじゅんを よぶ */
  * callProc(def, args, line) {
    if (args.length < def.params.length) {
      throw err(line,
        '「' + def.name + '」に わたす ものが たりません。（' + def.params.length + 'つ ひつようです）',
        'つかいかた: ' + def.name + '(' + def.params.join(', ') + ')');
    }
    if (args.length > def.params.length) {
      throw err(line,
        '「' + def.name + '」に わたす ものが おおすぎます。（' + def.params.length + 'つで いいです）',
        'つかいかた: ' + def.name + '(' + def.params.join(', ') + ')');
    }

    this.depth++;
    if (this.depth > MAX_CALL_DEPTH) {
      this.depth--;
      throw err(line,
        'てじゅんの よびだしが ふかすぎます。',
        'てじゅんが じぶんを よびつづけて いないか たしかめてね');
    }
    try {
      const nfr = { locals: new Map(), name: def.name };
      for (let i = 0; i < def.params.length; i++) nfr.locals.set(def.params[i], args[i]);
      const sig = yield* this.execBlock(def.body, nfr);
      if (sig && sig.k === 'return') return (sig.v === undefined) ? null : sig.v;
      return null;
    } finally {
      this.depth--;
    }
  }

  /** 組み込みの ことばを よぶ */
  /**
   * 「つかいかた: …」の ヒントを 作ります。
   * 中で ラップされた ことばは 引数の 名前が とれず
   * `(...args)` のような 英語が 出てしまうので、そのときは 出しません。
   */
  つかいかたヒント(name, fn) {
    const u = usageOf(name, fn);
    if (!u || u.includes('...') || /[A-Za-z]{3}/.test(u.replace(name, ''))) {
      return '単語帳で 「' + name + '」を さがすと つかいかたが 見られます';
    }
    return u;
  }

  * callBuiltin(name, fn, args, line) {
    const ps = paramNamesOf(fn);
    const variadic = !!(ps && ps.some(p => p.startsWith('...')));
    const need = fn.length;

    if (!variadic && need > 0 && args.length < need) {
      throw err(line,
        '「' + name + '」に わたす ものが たりません。（' + need + 'つ ひつようです）',
        this.つかいかたヒント(name, fn));
    }
    if (!variadic && ps && args.length > ps.length && ps.length > 0) {
      throw err(line,
        '「' + name + '」に わたす ものが おおすぎます。（' + ps.length + 'つで いいです）',
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
        '「' + name + '」を つかうときに うまく いきませんでした。',
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
  constructor(gen, name) {
    this.gen = gen;       // ジェネレータ
    this.name = name || '';
    this.done = false;
    this.waitSec = 0;     // まつ() の のこり びょう
  }
}


// =====================================================================
//  10. Runner — 契約の 本体
// =====================================================================

export class Runner {
  /**
   * @param program  parse() の もどり値
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
    this._pressHandlers = [];
  }

  /** へんすうを 消して、はじめの タスクを 作る */
  start() {
    if (!this.program || !Array.isArray(this.program.body)) {
      const e = err(1, 'うごかす コードが ありません。', 'なにか 書いてから ▶ を おしてね');
      this.onError(e);
      return;
    }
    this.interp = new Interp(this.program, this.builtins);
    this.tasks = [];
    this.budget = TICK_BUDGET;
    this._started = true;
    this._stopped = false;

    // 「トップレベルの 文 ＋ はじめに」で タスク 1 本
    this.tasks.push(new Task(this.interp.runBody(this.program.body), 'はじめ'));

    // 「おしたとき」の うけつけ
    this._pressHandlers = (this.program.presses || []).map(node => ({ node, task: null }));

    // まだ 1フレームも すすめていないと、トップレベルの へんすうが
    // できていません。その間に おされた キーは ためておいて、
    // 1フレーム目の あとで まとめて うけつけます。
    this._ranAFrame = false;
    this._pressQueue = [];
  }

  /** 1 フレーム すすめる（dt は びょう） */
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

      // 1.5) 始まる前に おされていた キーを、ここで うけつける
      this._ranAFrame = true;
      if (this._pressQueue.length && !this._stopped) {
        const まちキー = this._pressQueue;
        this._pressQueue = [];
        for (const k of まちキー) {
          this.press(k);
          if (this._stopped) break;
        }
      }

      // 2) まいかい（毎フレーム さいしょから さいごまで）
      if (!this._stopped) {
        for (const ev of (this.program.everyFrame || [])) {
          this._runEveryFrame(ev);
          if (this._stopped) break;
        }
      }
    } catch (e) {
      this._fail(e);
    }
  }

  /** キーが おされた しゅんかん */
  press(keyName) {
    if (!this._started || this._stopped) return;
    // 1フレーム目の 前なら、まだ へんすうが できていないので ためておく
    if (!this._ranAFrame) {
      if (this._pressQueue.length < 16) this._pressQueue.push(keyName);
      return;
    }
    try {
      for (const h of this._pressHandlers) {
        const key = this._evalNow(h.node.key);
        if (!sameKey(key, keyName)) continue;
        // おなじ ハンドラは 1 本まで（走っていたら むし）
        if (h.task && !h.task.done) continue;
        const t = new Task(this.interp.runBody(h.node.body), 'おしたとき');
        h.task = t;
        this.tasks.push(t);
        // おした しゅんかんに すこし すすめる（まつ／フレームまち まで）
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
    this._stopped = true;
  }

  /** まだ うごいている？ */
  get running() {
    if (!this._started || this._stopped) return false;
    if (this.tasks.some(t => !t.done)) return true;
    if ((this.program.everyFrame || []).length > 0) return true;
    if ((this.program.presses || []).length > 0) return true;
    return false;
  }

  // ---- ここから 中で つかう ぶぶん --------------------------------------

  /** タスクを 「フレームまち」か「おわり」まで まわす */
  _runTask(task, dt) {
    if (task.done) return;

    // まっている とちゅう？
    if (task.waitSec > 0) {
      task.waitSec -= dt;
      if (task.waitSec > 0) return;
      task.waitSec = 0;
    }

    for (;;) {
      if (this.budget <= 0) {
        throw err(this._line(),
          'くりかえしが おおすぎて とまりません。',
          'ずっと の中に まつ(0.1) を いれてみよう');
      }
      const r = task.gen.next();
      if (r.done) { task.done = true; return; }

      const v = r.value || {};
      if (v.t === 'tick') { this.budget--; continue; }
      if (v.t === 'frame') return;
      if (v.t === 'wait') {
        const sec = Number(v.sec);
        task.waitSec = (Number.isFinite(sec) && sec > 0) ? sec : 0;
        return;   // まつ() は すくなくとも 1 フレーム やすむ
      }
      // しらない yield は かぞえるだけ
      this.budget--;
    }
  }

  /** まいかい を 1 回 さいごまで まわす（まつ は つかえない） */
  _runEveryFrame(ev) {
    const gen = this.interp.runBody(ev.body);
    for (;;) {
      if (this.budget <= 0) {
        throw err(this._line(),
          'くりかえしが おおすぎて とまりません。',
          'ずっと の中に まつ(0.1) を いれてみよう');
      }
      const r = gen.next();
      if (r.done) return;
      const v = r.value || {};
      if (v.t === 'tick') { this.budget--; continue; }
      if (v.t === 'frame' || v.t === 'wait') {
        throw err(this._line(),
          'まいかい の中では まつ() は つかえません。',
          'まつ() を つかいたいときは 「ずっと」の 中に 書いてね');
      }
      this.budget--;
    }
  }

  /** 式を その場で もとめる（おしたとき の キーの ため） */
  _evalNow(node) {
    const gen = this.interp.evalExpr(node, null);
    let guard = 100000;
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
      if (--guard <= 0) {
        throw err(node.line,
          'おしたとき の キーの しらべかたが ながすぎます。',
          'おしたとき("スペース") の ように かんたんに 書いてね');
      }
    }
  }

  _line() {
    return (this.interp && this.interp.line) ? this.interp.line : 1;
  }

  _fail(e) {
    const ke = toKotodamaError(e, this._line());
    this.stop();
    try {
      this.onError(ke);
    } catch (e2) {
      // onError が こけても なにも しない
    }
  }
}

/** キーの 名まえくらべ（英字は 大文字小文字を 気にしない） */
function sameKey(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.toUpperCase() === b.toUpperCase();
}
