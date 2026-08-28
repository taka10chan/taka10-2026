// ことだま — 予測変換（コード補完）   ★SPEC2 G章★
//
// 使う人（中学生）の言葉:
//   「もって打ったら、もの下に『もしかして、もしって打ちたいですか？』みたいのが
//     出てきて、スペース押してエンター押すと、それが出てくるようにしたらいいかも！！」
//
// ことばが 87語 ＋ 文法 25個。覚えられるわけがないので、打ちながら出します。
//
// ─────────────────────────────────────────────────────────────────────
//  このファイルで いちばん気をつけていること（大事な順）
// ─────────────────────────────────────────────────────────────────────
//
//  (1) 日本語入力（IME）の じゃまを ぜったいに しない
//      ・e.isComposing が真、または keyCode === 229 の間は 一切さわりません。
//      ・候補を作り直すのは input と compositionend のときだけです。
//      ・一覧が出ていないときは、キーを 1つも 横取りしません。
//
//  (2) スペースが 打てなくならないこと
//      ことだまは キーワードの前後に 空白が要ります（もし てん > 10 なら）。
//      ・打ちかけの語が ちょうど ことばと同じ（「もし」と打ち終えた）ときは
//        スペースを横取りしません。そのまま 空白が入ります。
//      ・打ちかけの語が 途中（「も」）のときだけ、スペースで候補を選びます。
//      ・文字列（" の中）でも スペースは 横取りしません（文の中に空白が要るので）。
//      ・候補を選んでいない状態のエンターは ふつうの改行です。
//
//  (3) 読みで探せること
//      「うご」と打って「動かす」が出ないと意味がありません。候補は つづりを
//      いくつも持っていて（動かす／うごかす／ウゴカス／ugokasu）、そのどれかに
//      前方一致すれば出ます。カタカナとひらがなは「そろえた形」でくらべます。
//
// ─────────────────────────────────────────────────────────────────────
//  外に出すもの（SPEC2 G-7 の契約。ここは1文字も変えないこと）
//
//    export class 予測 {
//      constructor(textarea, 語彙をとる);
//      更新();          // ワールドや作品が変わったとき呼ぶ
//      とじる();
//      こわす();
//      onInsert = (語) => {};
//    }
//
//  候補 1つの形（語彙をとる() が返す配列の中身）:
//    {
//      語: '動かす',
//      読み: ['うごかす', 'ウゴカス', '動かす'],  // 前方一致に使う つづり全部
//      挿入: '動かす(もの, x, y, z)',
//      カーソル: 4,                               // 入れたあとカーソルを置く位置（省略可）
//      説明: 'ものを x y z のぶんだけ動かします。',
//      種類: 'ことば' | '文法' | 'ワールド' | '変数',
//    }
// ─────────────────────────────────────────────────────────────────────

import { そろえた形 } from './lang.js';

/** 何個まで出すか（多いと選べないので 8個まで。SPEC2 G-4） */
const 出す数 = 8;

/** 打ちかけの語（カーソルの直前の かたまり）を取り出す */
const 打ちかけ抽出 = /[A-Za-z0-9_ぁ-んァ-ヶーｦ-ﾟ一-龯々〆ヵヶ]+$/;

/** 種類ごとの ならび順（自分で作ったものほど 上に出す） */
const 種類の順 = { '変数': 0, 'ワールド': 1, '文法': 2, 'ことば': 3 };

/** 種類ごとの 小さな札（一覧のいちばん左に出す） */
const 種類の札 = { '変数': '変数', 'ワールド': 'もの', '文法': '文法', 'ことば': 'ことば' };

/**
 * 1文字ちがいを 見つけるための 編集距離（レーベンシュタイン）。
 * 「もじし」→「もし」のような 打ち間違いを ひろうために使います。
 * 上限を こえたら もう用がないので 途中で切りあげます。
 */
function 距離(a, b, 上限) {
  const A = Array.from(a), B = Array.from(b);
  if (Math.abs(A.length - B.length) > 上限) return 上限 + 1;
  let 前 = new Array(B.length + 1);
  let 今 = new Array(B.length + 1);
  for (let j = 0; j <= B.length; j++) 前[j] = j;
  for (let i = 1; i <= A.length; i++) {
    今[0] = i;
    let 行の最小 = i;
    for (let j = 1; j <= B.length; j++) {
      const 費用 = (A[i - 1] === B[j - 1]) ? 0 : 1;
      今[j] = Math.min(前[j] + 1, 今[j - 1] + 1, 前[j - 1] + 費用);
      if (今[j] < 行の最小) 行の最小 = 今[j];
    }
    if (行の最小 > 上限) return 上限 + 1;   // もう どうやっても はみ出す
    const t = 前; 前 = 今; 今 = t;
  }
  return 前[B.length];
}

/** 文字の数（絵文字なども 1文字と数える） */
const 字数 = (s) => Array.from(String(s == null ? '' : s)).length;


export class 予測 {

  /**
   * @param {HTMLTextAreaElement} textarea コードを書く欄
   * @param {Function} 語彙をとる  () => 候補の配列。打つたびに呼ばれるので軽くすること
   */
  constructor(textarea, 語彙をとる) {
    this.ta = textarea;
    this.語彙をとる = (typeof 語彙をとる === 'function') ? 語彙をとる : () => [];

    /** 入れたときに呼ばれる（保存などに使う） */
    this.onInsert = () => {};

    // ── いまの状態 ──────────────────────────────────────
    this.候補 = [];          // いま出している候補（多くても 8個）
    this.選択 = -1;          // 選んでいる行。-1 は「まだ選んでいない」
    this.語のはじめ = 0;     // 打ちかけの語が 始まる 文字位置
    this.打ちかけ = '';      // 打ちかけの語そのもの
    this.ぴったり = false;   // 打ちかけの語が ちょうど ことばと同じか
    this.文字列内 = false;   // " の中を打っているか
    this.変換中 = false;     // IME で変換している最中か
    this.入れた直後 = false; // 自分で入れた input を ひろい直さないための札

    this.作る();
    this.つなぐ();
  }

  // ===================================================================
  //  画面のつくり
  // ===================================================================

  作る() {
    // 一覧の入れもの。body に置いて position:fixed にします。
    // （コード欄の中に置くと 欄の外に はみ出せず、下のほうで切れてしまうため）
    const 箱 = document.createElement('div');
    箱.className = 'yosoku';
    箱.hidden = true;
    箱.setAttribute('role', 'listbox');
    箱.setAttribute('aria-label', '予測変換の候補');

    const 一覧 = document.createElement('div');
    一覧.className = 'yosoku-list';
    箱.appendChild(一覧);

    const 説明 = document.createElement('div');
    説明.className = 'yosoku-desc';
    説明.hidden = true;
    箱.appendChild(説明);

    const 案内 = document.createElement('div');
    案内.className = 'yosoku-help';
    案内.textContent = 'スペースで選ぶ　エンターで入れる　Escで閉じる';
    箱.appendChild(案内);

    document.body.appendChild(箱);
    this.箱 = 箱;
    this.一覧 = 一覧;
    this.説明 = 説明;
    this.案内 = 案内;

    // カーソルの 横の位置を測るための、見えない ものさし。
    // コード欄と同じ字形にして、行のはじめからカーソルまでの文字を入れ、
    // その幅を測ります。これがいちばん確実です。
    const ものさし = document.createElement('span');
    ものさし.className = 'yosoku-measure';
    ものさし.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ものさし);
    this.ものさし = ものさし;
  }

  // ===================================================================
  //  出来事の つなぎこみ
  // ===================================================================

  つなぐ() {
    const ta = this.ta;

    // --- 打った字が変わったとき ---------------------------------
    // ★IME で変換している最中の input は 見なかったことにします。
    this.on入力 = (e) => {
      if (this.変換中 || (e && e.isComposing)) return;
      if (this.入れた直後) { this.入れた直後 = false; this.とじる(); return; }
      this.再計算();
    };
    ta.addEventListener('input', this.on入力);

    // --- IME（日本語入力）--------------------------------------
    this.on変換はじめ = () => { this.変換中 = true; this.とじる(); };
    this.on変換おわり = () => {
      this.変換中 = false;
      // 変換が 終わった「あと」に作り直します。作り直すのは ここと input だけ。
      this.再計算();
    };
    ta.addEventListener('compositionstart', this.on変換はじめ);
    ta.addEventListener('compositionupdate', this.on変換はじめ);
    ta.addEventListener('compositionend', this.on変換おわり);

    // --- カーソルが 飛んだら しまう ------------------------------
    this.onクリック = () => { this.とじる(); };
    ta.addEventListener('mousedown', this.onクリック);
    this.onぼやけ = () => { this.とじる(); };
    ta.addEventListener('blur', this.onぼやけ);

    // --- コード欄が 動いたら 位置を合わせ直す --------------------
    this.on巻き = () => { if (this.開いている()) this.位置を合わせる(); };
    ta.addEventListener('scroll', this.on巻き);
    this.on窓が変わった = () => { if (this.開いている()) this.位置を合わせる(); };
    window.addEventListener('resize', this.on窓が変わった);

    // --- キー ---------------------------------------------------
    // ★window の capture につけます。
    //   app.js が window の capture で「ゲーム用のキーを ゲームに見せない」ため
    //   stopImmediatePropagation() をしています。それより先に見ないと
    //   スペースやエンターが ここまで届きません。
    //   （app.js 側で、この 予測 を作ってから onKeyCapture を つけています）
    this.onキー = (e) => this.キーを見る(e);
    window.addEventListener('keydown', this.onキー, true);

    // --- 一覧の クリック／タップ ---------------------------------
    // mousedown で preventDefault すると コード欄から フォーカスが外れません。
    this.on押し始め = (e) => { e.preventDefault(); };
    this.箱.addEventListener('mousedown', this.on押し始め);
    this.on選ぶ = (e) => {
      const 行 = (e.target && e.target.closest) ? e.target.closest('.yosoku-row') : null;
      if (!行) return;
      const i = Number(行.dataset.i);
      if (Number.isInteger(i)) { this.選択 = i; this.入れる(i); }
    };
    this.箱.addEventListener('click', this.on選ぶ);
    this.onなぞる = (e) => {
      const 行 = (e.target && e.target.closest) ? e.target.closest('.yosoku-row') : null;
      if (!行) return;
      const i = Number(行.dataset.i);
      if (Number.isInteger(i) && i !== this.選択) { this.選択 = i; this.光らせる(); }
    };
    this.箱.addEventListener('mousemove', this.onなぞる);
  }

  // ===================================================================
  //  キーの世話
  // ===================================================================

  キーを見る(e) {
    // ★★ ここが いちばん大事 ★★
    // IME で変換している最中は、ぜったいに さわりません。
    if (e.isComposing || e.keyCode === 229 || this.変換中) return;
    // コード欄を 打っていないなら 関係ありません
    if (e.target !== this.ta) return;
    // 一覧が 出ていないときは、キーを 1つも 横取りしません
    if (!this.開いている()) return;
    // Ctrl や Alt と いっしょのときは ショートカットなので さわりません
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const k = e.key;

    // ── ↓ ↑ で選ぶ ────────────────────────────────
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      this.止める(e);
      const n = this.候補.length;
      if (k === 'ArrowDown') this.選択 = (this.選択 + 1) % n;
      else this.選択 = (this.選択 <= 0 ? n : this.選択) - 1;
      this.光らせる();
      return;
    }

    // ── Esc で閉じる ──────────────────────────────
    if (k === 'Escape' || k === 'Esc') { this.止める(e); this.とじる(); return; }

    // ── Tab でも入る ──────────────────────────────
    if (k === 'Tab') {
      this.止める(e);
      this.入れる(this.選択 < 0 ? 0 : this.選択);
      return;
    }

    // ── スペースで 候補を選ぶ ──────────────────────
    if (k === ' ' || k === 'Spacebar' || k === 'Space') {
      // ★横取りしてよいのは「打ちかけの語が まだ途中」のときだけ★
      //   ・ちょうど ことばと同じ（「もし」と打ち終えた）→ ふつうの空白
      //   ・" の中（文の中）→ ふつうの空白
      //   ここを間違えると コードが 1行も 書けなくなります。
      if (this.ぴったり || this.文字列内) { this.とじる(); return; }
      this.止める(e);
      this.選択 = (this.選択 + 1) % this.候補.length;   // 押すたびに 次の候補へ
      this.光らせる();
      return;
    }

    // ── エンターで 入れる ──────────────────────────
    if (k === 'Enter') {
      // 候補を 選んでいないときは ふつうの改行。横取りしません。
      if (this.選択 < 0) { this.とじる(); return; }
      this.止める(e);
      this.入れる(this.選択);
      return;
    }

    // それ以外のキーは さわりません（字は そのまま打てます）
  }

  /** このキーは 予測変換が もらった、と はっきりさせる */
  止める(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  // ===================================================================
  //  候補さがし
  // ===================================================================

  開いている() { return !!this.箱 && !this.箱.hidden && this.候補.length > 0; }

  /** ワールドや作品が 変わったとき呼ぶ（出ている一覧を 作り直す） */
  更新() { if (this.開いている()) this.再計算(); }

  /** 打ちかけの語を見て、候補を 作り直す */
  再計算() {
    const ta = this.ta;
    const 終 = ta.selectionEnd;

    // 字を 選んでいるときは 出しません
    if (ta.selectionStart !== 終) { this.とじる(); return; }

    const 前文 = ta.value.slice(0, 終);
    const 行のはじめ = 前文.lastIndexOf('\n') + 1;
    const 行 = 前文.slice(行のはじめ);

    // # から後ろは メモ（コメント）なので 出しません
    if (行.indexOf('#') >= 0) { this.とじる(); return; }

    const m = 打ちかけ抽出.exec(前文);
    if (!m) { this.とじる(); return; }
    const 打ちかけ = m[0];
    // 数字だけのときは 出しません（10 と打っただけで出たら うるさい）
    if (/^[0-9]+$/.test(打ちかけ)) { this.とじる(); return; }

    this.打ちかけ = 打ちかけ;
    this.語のはじめ = 終 - 打ちかけ.length;
    // " の数が 奇数なら 文字列の中です（このとき スペースは 横取りしない）
    this.文字列内 = ((行.match(/"/g) || []).length % 2) === 1;

    let 語彙 = [];
    try { 語彙 = this.語彙をとる() || []; } catch (_) { 語彙 = []; }

    const 結果 = this.えらぶ(語彙, 打ちかけ);
    this.ぴったり = this.ちょうど同じか(語彙, 打ちかけ);

    if (!結果.length) { this.とじる(); return; }

    this.候補 = 結果;
    this.選択 = -1;              // まだ選んでいない（この状態のエンターは 改行）
    this.描く();
    this.箱.hidden = false;
    this.位置を合わせる();
  }

  /**
   * 打ちかけの語に 合うものを えらんで ならべる（SPEC2 G-4）。
   *   0段め … そのままの字で 前方一致        （うご → うごかす）
   *   1段め … そろえた形で 前方一致          （ウゴ → うごかす）
   *   2段め … 途中に ふくむ
   *   3段め … どれも当たらないときだけ 1文字ちがい（もしかして）
   * ならび順は 短いことば → 自分で作ったもの → もとの順番。8個まで。
   */
  えらぶ(語彙, 打ちかけ) {
    const そろえた打ちかけ = そろえた形(打ちかけ);
    const 長さ = 字数(打ちかけ);
    const 当たり = [];

    for (let i = 0; i < 語彙.length; i++) {
      const c = 語彙[i];
      if (!c || !c.語) continue;
      const よみ = Array.isArray(c.読み) ? c.読み : [String(c.語)];

      let 段 = 9;
      for (const y of よみ) {
        if (typeof y === 'string' && y.length && y.indexOf(打ちかけ) === 0) { 段 = 0; break; }
      }
      if (段 > 0) {
        for (const y of よみ) {
          if (typeof y !== 'string' || !y.length) continue;
          if (そろえた形(y).indexOf(そろえた打ちかけ) === 0) { 段 = 1; break; }
        }
      }
      // 「途中に ふくむ」は 2文字以上 打ってから（1文字だと 当たりすぎる）
      if (段 > 1 && 長さ >= 2) {
        for (const y of よみ) {
          if (typeof y !== 'string' || !y.length) continue;
          if (そろえた形(y).indexOf(そろえた打ちかけ) > 0) { 段 = 2; break; }
        }
      }
      if (段 < 9) 当たり.push({ c: c, 段: 段, i: i });
    }

    // ── どれも 当たらなければ「もしかして」（1文字ちがい）──────
    if (!当たり.length && 長さ >= 2) {
      for (let i = 0; i < 語彙.length; i++) {
        const c = 語彙[i];
        if (!c || !c.語) continue;
        const よみ = Array.isArray(c.読み) ? c.読み : [String(c.語)];
        let 近い = false;
        for (const y of よみ) {
          if (typeof y !== 'string' || 字数(y) < 2) continue;
          if (距離(そろえた打ちかけ, そろえた形(y), 1) <= 1) { 近い = true; break; }
        }
        if (近い) 当たり.push({ c: c, 段: 3, i: i });
      }
    }

    当たり.sort((a, b) => {
      if (a.段 !== b.段) return a.段 - b.段;
      const la = 字数(a.c.語), lb = 字数(b.c.語);
      if (la !== lb) return la - lb;                      // 短いことば優先
      const ka = 種類の順[a.c.種類], kb = 種類の順[b.c.種類];
      const na = (ka === undefined ? 9 : ka), nb = (kb === undefined ? 9 : kb);
      if (na !== nb) return na - nb;
      return a.i - b.i;                                    // よく使う順（語彙のならび順）
    });

    const 出す = [];
    const すでに = new Set();
    for (const a of 当たり) {
      if (すでに.has(a.c.語)) continue;
      すでに.add(a.c.語);
      a.c.もしかして = (a.段 === 3);
      出す.push(a.c);
      if (出す.length >= 出す数) break;
    }
    return 出す;
  }

  /**
   * 打ちかけの語が ちょうど ことばと同じか。
   * ★同じなら スペースを 横取りしません（空白が打てなくなるのを ふせぐ）★
   */
  ちょうど同じか(語彙, 打ちかけ) {
    const そろえた = そろえた形(打ちかけ);
    for (const c of 語彙) {
      if (!c || !c.語) continue;
      if (c.語 === 打ちかけ) return true;
      const よみ = Array.isArray(c.読み) ? c.読み : [];
      for (const y of よみ) {
        if (typeof y !== 'string') continue;
        if (y === 打ちかけ || そろえた形(y) === そろえた) return true;
      }
    }
    return false;
  }

  // ===================================================================
  //  えがく
  // ===================================================================

  描く() {
    const 一覧 = this.一覧;
    一覧.textContent = '';
    this.候補.forEach((c, i) => {
      const 行 = document.createElement('div');
      const 種 = (種類の順[c.種類] === undefined) ? 'other' : c.種類;
      行.className = 'yosoku-row k-' + 種;
      行.dataset.i = String(i);
      行.setAttribute('role', 'option');

      const 札 = document.createElement('span');
      札.className = 'yosoku-kind';
      札.textContent = 種類の札[c.種類] || 'その他';
      行.appendChild(札);

      const 語 = document.createElement('span');
      語.className = 'yosoku-word';
      語.textContent = c.語;
      行.appendChild(語);

      const 使いかた = document.createElement('span');
      使いかた.className = 'yosoku-sig';
      // 入れるものの 1行めを「使いかた」として 見せます
      使いかた.textContent = String(c.挿入 == null ? c.語 : c.挿入).split('\n')[0];
      行.appendChild(使いかた);

      一覧.appendChild(行);
    });
    // 案内の文。「もしかして」のときと、" の中のときで 変えます。
    // （" の中では スペースを 横取りしないので、スペースでは 選べません）
    const もしかして = !!(this.候補.length && this.候補[0].もしかして);
    this.箱.classList.toggle('maybe', もしかして);
    const 選びかた = this.文字列内 ? '↓で選ぶ' : 'スペースで選ぶ';
    this.案内.textContent = (もしかして ? 'もしかして…　' : '')
      + 選びかた + '　エンターで入れる　Escで閉じる';
    this.光らせる();
  }

  /** 選んでいる行に 色をつけて、その説明を 下に出す */
  光らせる() {
    const 行たち = this.一覧.children;
    for (let i = 0; i < 行たち.length; i++) {
      const on = (i === this.選択);
      行たち[i].classList.toggle('on', on);
      行たち[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const c = (this.選択 >= 0) ? this.候補[this.選択] : null;
    if (c && c.説明) {
      this.説明.textContent = c.説明;
      this.説明.hidden = false;
    } else {
      this.説明.textContent = '';
      this.説明.hidden = true;
    }
    // 選んだ行が 見えるところに来るように すこし巻く
    if (this.選択 >= 0 && 行たち[this.選択]) {
      const 行 = 行たち[this.選択];
      const 上 = 行.offsetTop, 下 = 上 + 行.offsetHeight;
      if (上 < this.一覧.scrollTop) this.一覧.scrollTop = 上;
      else if (下 > this.一覧.scrollTop + this.一覧.clientHeight) {
        this.一覧.scrollTop = 下 - this.一覧.clientHeight;
      }
    }
    this.位置を合わせる();
  }

  /**
   * カーソルの すぐ下に 一覧を出す。
   * 見えない ものさし（同じ字形の span）に「行のはじめからカーソルまで」を
   * 入れて 幅を測るので、どんな字が来ても ずれません。
   * 画面の下に はみ出すときは カーソルの 上に出します。
   */
  位置を合わせる() {
    if (!this.箱 || this.箱.hidden) return;
    const ta = this.ta;
    const cs = getComputedStyle(ta);
    const 前文 = ta.value.slice(0, ta.selectionEnd);
    const 行たち = 前文.split('\n');
    const 行番 = 行たち.length - 1;
    const 行文 = 行たち[行番];

    // 横の位置 … 同じ字形で 文字の幅を 測る
    const も = this.ものさし;
    も.style.fontFamily = cs.fontFamily;
    も.style.fontSize = cs.fontSize;
    も.style.fontWeight = cs.fontWeight;
    も.style.fontStyle = cs.fontStyle;
    も.style.letterSpacing = cs.letterSpacing;
    も.textContent = 行文;
    const 横 = も.getBoundingClientRect().width;

    const 行高 = parseFloat(cs.lineHeight) || 25;
    const 上余白 = parseFloat(cs.paddingTop) || 0;
    const 左余白 = parseFloat(cs.paddingLeft) || 0;
    const r = ta.getBoundingClientRect();

    const カーソルx = r.left + 左余白 + 横 - ta.scrollLeft;
    const カーソルy = r.top + 上余白 + 行番 * 行高 - ta.scrollTop;

    // カーソルが コード欄の外に 巻き上がっているときは しまう
    if (カーソルy + 行高 < r.top - 2 || カーソルy > r.bottom + 2) { this.とじる(); return; }

    const 大きさ = this.箱.getBoundingClientRect();
    const 幅 = 大きさ.width || 300;
    const 高さ = 大きさ.height || 140;
    const 画面幅 = window.innerWidth;
    const 画面高 = window.innerHeight;

    let x = カーソルx - 8;
    if (x + 幅 > 画面幅 - 8) x = 画面幅 - 幅 - 8;
    if (x < 8) x = 8;

    // ふつうは カーソルの すぐ下。はみ出すなら 上に出す。
    let y = カーソルy + 行高 + 4;
    let 上に出す = false;
    if (y + 高さ > 画面高 - 8) {
      const 上向き = カーソルy - 高さ - 4;
      if (上向き >= 8) { y = 上向き; 上に出す = true; }
      else y = Math.max(8, 画面高 - 高さ - 8);
    }
    this.箱.classList.toggle('above', 上に出す);
    this.箱.style.left = Math.round(x) + 'px';
    this.箱.style.top = Math.round(y) + 'px';
  }

  // ===================================================================
  //  入れる
  // ===================================================================

  /** i 番めの候補を コードに 入れる */
  入れる(i) {
    const c = this.候補[i];
    if (!c) { this.とじる(); return; }
    const ta = this.ta;
    const 文 = String((c.挿入 === undefined || c.挿入 === null) ? c.語 : c.挿入);

    // 打ちかけの語を まるごと 入れかえます
    const はじめ = this.語のはじめ;
    const おわり = ta.selectionEnd;
    const 語 = c.語;

    this.入れた直後 = true;    // このあとの input で 一覧を 出し直さない
    ta.focus();
    ta.setSelectionRange(はじめ, おわり);
    let できた = false;
    // execCommand なら Ctrl+Z で 戻せます（ふつうの打ち直しと 同じあつかい）
    try { できた = document.execCommand('insertText', false, 文); } catch (_) { できた = false; }
    if (!できた) {
      ta.setRangeText(文, はじめ, おわり, 'end');
      // 手で入れたときは input が 出ないので、こちらから 出します
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 書き足したい場所に カーソルを置く（もし → 条件の所、箱( → 最初の数字）
    const ずれ = (typeof c.カーソル === 'number' && c.カーソル >= 0 && c.カーソル <= 文.length)
      ? c.カーソル : 文.length;
    const 置く = はじめ + ずれ;
    ta.setSelectionRange(置く, 置く);

    this.入れた直後 = false;
    this.とじる();
    try { this.onInsert(語); } catch (_) { /* 呼び先で こけても 止めない */ }
  }

  // ===================================================================
  //  しまう・かたづける
  // ===================================================================

  とじる() {
    if (this.箱) { this.箱.hidden = true; this.箱.classList.remove('above', 'maybe'); }
    this.候補 = [];
    this.選択 = -1;
    this.ぴったり = false;
  }

  こわす() {
    const ta = this.ta;
    ta.removeEventListener('input', this.on入力);
    ta.removeEventListener('compositionstart', this.on変換はじめ);
    ta.removeEventListener('compositionupdate', this.on変換はじめ);
    ta.removeEventListener('compositionend', this.on変換おわり);
    ta.removeEventListener('mousedown', this.onクリック);
    ta.removeEventListener('blur', this.onぼやけ);
    ta.removeEventListener('scroll', this.on巻き);
    window.removeEventListener('resize', this.on窓が変わった);
    window.removeEventListener('keydown', this.onキー, true);
    if (this.箱) {
      this.箱.removeEventListener('mousedown', this.on押し始め);
      this.箱.removeEventListener('click', this.on選ぶ);
      this.箱.removeEventListener('mousemove', this.onなぞる);
      if (this.箱.parentNode) this.箱.parentNode.removeChild(this.箱);
    }
    if (this.ものさし && this.ものさし.parentNode) {
      this.ものさし.parentNode.removeChild(this.ものさし);
    }
    this.箱 = null;
    this.ものさし = null;
    this.候補 = [];
  }
}
