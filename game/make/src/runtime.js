// ============================================================================
// ことだま — runtime.js （3D）
//
//   ▶ をおしたときに うごく「ゲームの中身」。
//   絵（three.js）・入力（キー / マウス / ゆび）・音（WebAudio）・
//   かんたんな物理（おちる・ぶつかる）を ぜんぶ ここで めんどう を みます。
//
//   ● 3D の きまり（SPEC 2章）
//       y が うえ。x が よこ、z が おくゆき。地面は y = 0。
//       人の背は 5 くらい（スタッド）。
//       「もの」の x, y, z は まんなか。
//       角度は 「度」。むき は y じく まわり、かたむき は x じく まわり。
//       むき = 0 のとき、その もの の まえ は -z の ほう。
//
//   ● ここで なげる エラーは かならず「日本語のメッセージだけ」。
//     何行目かは lang.js が つけてくれるので ここでは 書きません。
//     さいごの 安全あみ（つつむ）で、英語のエラーは ぜんぶ 日本語に なおします。
// ============================================================================

// three.js は web/lib/three.module.js（r169）に あります。CDN は つかいません。
// このファイルは web/make/src/ に あるので、2つ 上の web/ から たどります。
import * as THREE from '../../lib/three.module.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 画面の 論理サイズ（app.js の canvas と おなじ） */
const 画面よこ = 640;
const 画面たて = 480;

/** じゅうりょく。1びょうに どれだけ はやさが 下に ふえるか */
const じゅうりょくの強さ = 55;

/** おちる はやさの かぎり（はやすぎると すり抜ける） */
const おちる上限 = 260;

/** もの の 上限。これを こえたら 作らずに 1回だけ 知らせる */
const ものの上限 = 4000;

/** これより もの が おおいときは、ちかい かべ だけ しらべる（SPEC 4章） */
const グリッドを使う数 = 300;

/** 当たり判定の グリッドの ますの 大きさ */
const ますの大きさ = 24;

/** 文字を かくときの フォント（日本語が 出る ものを ならべる） */
const フォント =
  '"Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", ' +
  '"Yu Gothic", "Meiryo", sans-serif';

/** いろの なまえ → 色コード の表（SPEC 5章 と おなじ ならび） */
const いろの表 = {
  あか: '#ff4d4d',
  あお: '#4d7dff',
  みどり: '#3fd45f',
  きいろ: '#ffe14d',
  しろ: '#ffffff',
  くろ: '#222428',
  みずいろ: '#5fd8ff',
  ピンク: '#ff7fc4',
  オレンジ: '#ff9a3c',
  むらさき: '#b06cff',
  はいいろ: '#9aa5b1',
  ちゃいろ: '#a56b3c',
  こん: '#26356e',
};

/** キー名（ことだま） → KeyboardEvent.code の たいおう */
const キーの表 = {
  みぎ: ['ArrowRight'],
  ひだり: ['ArrowLeft'],
  うえ: ['ArrowUp'],
  した: ['ArrowDown'],
  スペース: ['Space'],
  エンター: ['Enter', 'NumpadEnter'],
  シフト: ['ShiftLeft', 'ShiftRight'],
};

/** プレイヤーの 見ための いろ */
const はだいろ = '#f2c9a0';
const シャツのいろ = '#3a7ad6';
const ズボンのいろ = '#2f3f6b';
const めのいろ = '#26333f';

/** さいしょの そら と きり */
const きほんのそら = '#8fd3ff';
const きほんのきりのこさ = 0.34;

/** さいしょの プレイヤーの はやさ（SPEC 7章） */
const きほんのあるく = 14;
const きほんのはしる = 22;
const きほんのジャンプ = 32;

// ---------------------------------------------------------------------------
// エラーの どうぐ
// ---------------------------------------------------------------------------

/**
 * 日本語の メッセージだけを もつ Error を つくる。
 * `にほんご` の しるしを つけておいて、安全あみ（つつむ）で 見わける。
 */
function エラー(メッセージ) {
  const e = new Error(メッセージ);
  e.にほんご = true;
  return e;
}

/** 値を エラーメッセージ用に 見せる（長すぎたら きる） */
function 見せる(v) {
  if (v === null || v === undefined) return 'なし';
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const s = v.length > 20 ? v.slice(0, 20) + '…' : v;
    return '「' + s + '」';
  }
  if (Array.isArray(v)) return 'リスト';
  if (v && v.__もの) return 'もの';
  if (typeof v === 'function') return 'てじゅん';
  return 'よく わからないもの';
}

/** 引数の いちを 日本語で（1 → 「1ばんめ」） */
function ばんめ(i) {
  return i + 'ばんめ';
}

// ---------------------------------------------------------------------------
// 引数の チェック（だめなら ぜんぶ 日本語の エラー）
// ---------------------------------------------------------------------------

/** 「もの」かどうか しらべる */
function ものチェック(ことば, v) {
  if (v && typeof v === 'object' && v.__もの === true) return v;
  throw エラー(
    ことば + ' には ものを わたしてね。はこ() や たま() が かえす ものです' +
      '（いま わたされたのは ' + 見せる(v) + '）'
  );
}

/** 数に する。もじでも 数に できるなら して あげる */
function すうチェック(ことば, い, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') {
    throw エラー(
      ことば + ' の ' + ばんめ(い) + ' には すうじを わたしてね。' +
        見せる(v) + ' は すうじでは ありません'
    );
  }
  if (typeof v === 'string') {
    // 全角の 数字も なおして あげる
    const s = v
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[．]/g, '.')
      .replace(/[－ー−]/g, '-')
      .trim();
    if (s !== '') {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
  }
  throw エラー(
    ことば + ' の ' + ばんめ(い) + ' には すうじを わたしてね。' +
      見せる(v) + ' は すうじに できません'
  );
}

/** もじに する（数や はい・いいえ も もじに して あげる） */
function もじチェック(ことば, い, v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (v === null || v === undefined) return '';
  throw エラー(
    ことば + ' の ' + ばんめ(い) + ' には もじを わたしてね。' +
      見せる(v) + ' は もじに できません'
  );
}

/** リストかどうか */
function リストチェック(ことば, い, v) {
  if (Array.isArray(v)) return v;
  throw エラー(
    ことば + ' の ' + ばんめ(い) + ' には リストを わたしてね。' +
      '[1, 2, 3] のように かくと リストに なります' +
      '（いま わたされたのは ' + 見せる(v) + '）'
  );
}

/** いろの なまえ や 色コードを #rrggbb に なおす。だめなら 日本語エラー */
function いろに直す(ことば, v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (Object.prototype.hasOwnProperty.call(いろの表, s)) return いろの表[s];
    if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)) return s;
  }
  throw エラー(
    ことば + ' には いろの なまえを わたしてね。つかえるのは ' +
      Object.keys(いろの表).join(' ') + ' か #ff0000 のような かきかたです' +
      '（いま わたされたのは ' + 見せる(v) + '）'
  );
}

/** どんな 値が 来ても いろに する（えがくときに つかう。ぜったい 落ちない） */
function いろ安全(v, きめた値) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (Object.prototype.hasOwnProperty.call(いろの表, s)) return いろの表[s];
    if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)) return s;
  }
  return きめた値 || '#ffffff';
}

/** どんな 値が 来ても 数に する（だめなら きめた値） */
function 数にする(v, きめた値) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  if (v === true) return 1;
  if (v === false) return 0;
  return きめた値;
}

/** ことだまの「ほんとう / うそ」。0 "" なし いいえ だけが うそ */
function しんぎ(v) {
  if (v === undefined) return true;   // 引数を 書かなかったら「はい」あつかい
  return !(v === false || v === 0 || v === '' || v === null);
}

/** かく() や つなげる() で つかう、値の 日本語ひょうじ */
function 文字にする(v) {
  if (v === null || v === undefined) return 'なし';
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v === 0 ? 0 : v);
    return String(Math.round(v * 1e10) / 1e10);
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map((x) => 文字にする(x)).join(', ') + ']';
  if (v && v.__もの) {
    return '(もの x=' + Math.round(数にする(v.x, 0)) +
      ' y=' + Math.round(数にする(v.y, 0)) +
      ' z=' + Math.round(数にする(v.z, 0)) + ')';
  }
  if (typeof v === 'function') return '(てじゅん)';
  return String(v);
}

/** 度 → ラジアン */
function ど2ラジ(ど) {
  return (ど * Math.PI) / 180;
}

/**
 * KeyboardEvent から ことだまの キー名を つくる。わからなければ null。
 */
function キー名にする(e) {
  const code = e && e.code ? e.code : '';
  for (const 名 of Object.keys(キーの表)) {
    if (キーの表[名].includes(code)) return 名;
  }
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);          // KeyA → A
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);        // Digit1 → 1
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  const key = e && e.key ? e.key : '';
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  return null;
}

/** ユーザーが 書いた キー名を、ないぶの 名前に なおす */
function キー名を直す(ことば, キー) {
  if (typeof キー !== 'string') {
    if (typeof キー === 'number' && Number.isInteger(キー) && キー >= 0 && キー <= 9) {
      return String(キー);
    }
    throw エラー(
      ことば + ' には キーの なまえを もじで わたしてね。' +
        'みぎ ひだり うえ した スペース エンター シフト か A〜Z、0〜9 が つかえます' +
        '（いま わたされたのは ' + 見せる(キー) + '）'
    );
  }
  const s = キー
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (Object.prototype.hasOwnProperty.call(キーの表, s)) return s;
  if (/^[a-zA-Z]$/.test(s)) return s.toUpperCase();
  if (/^[0-9]$/.test(s)) return s;
  const べつめい = {
    'みぎキー': 'みぎ', 'ひだりキー': 'ひだり', 'うえキー': 'うえ', 'したキー': 'した',
    'すぺーす': 'スペース', 'えんたー': 'エンター', 'しふと': 'シフト',
    '右': 'みぎ', '左': 'ひだり', '上': 'うえ', '下': 'した',
  };
  if (Object.prototype.hasOwnProperty.call(べつめい, s)) return べつめい[s];
  throw エラー(
    ことば + ' に 「' + キー + '」という キーは ありません。' +
      'みぎ ひだり うえ した スペース エンター シフト か A〜Z、0〜9 が つかえます'
  );
}

/**
 * 組み込みことばを つつんで、
 * 「日本語じゃない エラー」が 外に 出ないようにする さいごの 安全あみ。
 */
function つつむ(名, 関数) {
  const f = function (...args) {
    try {
      return 関数.apply(null, args);
    } catch (e) {
      if (e && e.にほんご) throw e;                  // こちらで つくった 日本語エラー
      if (e && e.name === 'KotodamaError') throw e;  // lang.js の エラーは そのまま
      // 英語の エラー（TypeError など）は 日本語に 言いかえる
      throw エラー(
        '「' + 名 + '」の つかいかたが ちがうみたい。単語帳で つかいかたを みてみよう'
      );
    }
  };
  try {
    Object.defineProperty(f, 'name', { value: 名 });
  } catch (e) {
    /* 名前が つかなくても こまらない */
  }
  return f;
}

// ---------------------------------------------------------------------------
// AABB（軸に そった 箱）の どうぐ
// ---------------------------------------------------------------------------

/** もの の 当たり判定の 箱（中心と はんぶんの 大きさ）を つくる */
function はこにする(o) {
  const hx = Math.abs(数にする(o.よこ, 0)) / 2;
  const hy = Math.abs(数にする(o.たかさ, 0)) / 2;
  const hz = Math.abs(数にする(o.おくゆき, 0)) / 2;
  const x = 数にする(o.x, 0);
  const y = 数にする(o.y, 0);
  const z = 数にする(o.z, 0);
  return {
    minX: x - hx, maxX: x + hx,
    minY: y - hy, maxY: y + hy,
    minZ: z - hz, maxZ: z + hz,
  };
}

/** 2つの 箱が かさなっているか */
function かさなる(a, b) {
  return (
    a.maxX > b.minX && a.minX < b.maxX &&
    a.maxY > b.minY && a.minY < b.maxY &&
    a.maxZ > b.minZ && a.minZ < b.maxZ
  );
}

// ---------------------------------------------------------------------------
// アニメの どうぐ（キーフレームの あいだを まっすぐ つなぐ）
// ---------------------------------------------------------------------------

/** しせいを 入れておく 使いまわしの いれもの（毎フレーム 作らないため） */
const しせいのはこ = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

/**
 * キーと キーの あいだを まっすぐ つないで、いまの しせいを もとめる。
 *
 * @param {object[]} keys  t の ちいさい じゅんに ならんだ キー
 * @param {number} T       いまの びょう（0 いじょう sec いか）
 * @param {number} sec     アニメ ぜんたいの ながさ（びょう）
 * @param {boolean} loop   くりかえすか
 * @returns {object|null}  しせいのはこ（つかいまわし）
 */
function しせいをもとめる(keys, T, sec, loop) {
  const n = keys.length;
  if (n === 0) return null;
  if (n === 1) return keys[0];

  let a = null, b = null, ta = 0, tb = 0;

  if (T <= keys[0].t) {
    if (loop) {
      // さいごの キー → さいしょの キー を ぐるりと つなぐ（つぎ目で カクつかせない）
      a = keys[n - 1]; ta = keys[n - 1].t - sec;
      b = keys[0];     tb = keys[0].t;
    } else {
      return keys[0];
    }
  } else if (T >= keys[n - 1].t) {
    if (loop) {
      a = keys[n - 1]; ta = keys[n - 1].t;
      b = keys[0];     tb = keys[0].t + sec;
    } else {
      return keys[n - 1];
    }
  } else {
    for (let i = 0; i < n - 1; i++) {
      if (T >= keys[i].t && T <= keys[i + 1].t) {
        a = keys[i];     ta = a.t;
        b = keys[i + 1]; tb = b.t;
        break;
      }
    }
    if (!a) return keys[n - 1];
  }

  const はば = tb - ta;
  const u = はば > 1e-9 ? (T - ta) / はば : 0;
  しせいのはこ.px = a.px + (b.px - a.px) * u;
  しせいのはこ.py = a.py + (b.py - a.py) * u;
  しせいのはこ.pz = a.pz + (b.pz - a.pz) * u;
  しせいのはこ.rx = a.rx + (b.rx - a.rx) * u;
  しせいのはこ.ry = a.ry + (b.ry - a.ry) * u;
  しせいのはこ.rz = a.rz + (b.rz - a.rz) * u;
  return しせいのはこ;
}

// ===========================================================================
// ゲーム本体
// ===========================================================================

export class Game {
  /**
   * @param {HTMLCanvasElement|null} canvas 640x480 の canvas（null でも いい）
   */
  constructor(canvas) {
    this.canvas = canvas || null;

    /** かく() の 出力さき。app.js が 入れかえる */
    this.onLog = () => {};
    /** とめる() / ゲームしゅうりょう() で よばれる。app.js が 入れかえる */
    this.onStop = () => {};

    /** 入力イベントを 1回だけ 登録するための しるし */
    this._入力登録ずみ = false;

    // --- 入力の じょうたい ---
    this._おされてる = new Set();  // いま おされている キー名
    this._おしたまち = new Set();  // つぎの beginFrame で「おした しゅんかん」にする
    this._おした = new Set();      // このフレームの「おした しゅんかん」
    this._マウスX = 画面よこ / 2;
    this._マウスY = 画面たて / 2;
    this._クリックちゅう = false;
    this._クリックまち = false;
    this._クリックした = false;
    this._みまわしdx = 0;          // このフレームで マウスが うごいた量
    this._みまわしdy = 0;
    this._ポインタロック中 = false;
    this._タッチ端末 = false;
    this._スティック = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
    this._みまわしタッチ = { id: null, x: 0, y: 0 };

    /** 音の AudioContext。さいしょの そうさまで つくらない */
    this._audio = null;

    // --- three.js の れんだらー（1回だけ つくる） ---
    this.renderer = null;
    this._レンダラを作る();

    // --- reset() が つかう いれもの ---
    this.もの一覧 = [];
    this._しげん = [];      // dispose する geometry / material / texture
    this._ざいりょう = new Map();
    this._もようキャッシュ = new Map();
    this._アニメキャッシュ = new Map();

    this.reset();
  }

  // =========================================================================
  // 1. 立ちあげ と リセット
  // =========================================================================

  /**
   * WebGLRenderer を つくる。
   * canvas が null だったり WebGL が つかえない ところ（node での テスト）でも
   * ぜったいに 落ちないように、ぜんぶ try で つつむ。
   */
  _レンダラを作る() {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      const ひ = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.renderer.setPixelRatio(Math.min(ひ, 2));
      this.renderer.setSize(画面よこ, 画面たて, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      // かげは「たいよう 1つぶんの、かいぞうど ひくい 1まい」だけ。
      // これ 1つで ぐっと ロブロックスっぽく なるのに、ほとんど おもくならない。
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.autoClear = true;
    } catch (e) {
      this.renderer = null;
    }
  }

  /**
   * ものを ぜんぶ けして、シーンを 作りなおす。
   * ふるい geometry / material / texture は dispose して、
   * 何回 ▶ を おしても メモリが ふえないようにする。
   */
  reset() {
    // --- ふるい シーンの あとしまつ ---
    this._しげんをすてる();

    // --- あたらしい シーン ---
    this.scene = new THREE.Scene();
    this.もの一覧 = [];
    this._つぎのID = 1;
    this._じかん = 0;
    this._dt = 0;
    this._とまった = false;
    this._上限警告ずみ = false;
    this._ざいりょう = new Map();
    this._もようキャッシュ = new Map();
    this._アニメキャッシュ = new Map();   // ▶ を おすたび よみ直す
    this._かべ一覧 = [];
    this._グリッド = null;

    // 入力の「おした しゅんかん」だけ けす（おしっぱなしは のこす）
    this._おした.clear();
    this._おしたまち.clear();
    this._クリックした = false;
    this._クリックまち = false;
    this._みまわしdx = 0;
    this._みまわしdy = 0;

    // --- そら と きり ---
    this._そらのいろ = きほんのそら;
    this._きりのいろ = きほんのそら;
    this._きりのこさ = きほんのきりのこさ;
    this._きりのばい = 0.022;    // こさ 1 で だいたい 45スタッド さきが 見えなくなる
    this._きりは自動 = true;      // そらのいろ() を かえたら きりも あわせる
    this.scene.background = new THREE.Color(this._そらのいろ);
    this.scene.fog = new THREE.FogExp2(this._きりのいろ, this._きりのこさ * this._きりのばい);

    // --- ひかり（かげは つかわない。かるく、ロブロックスっぽく） ---
    const そらのひかり = new THREE.HemisphereLight(0xdff1ff, 0x6f8f5a, 1.15);
    this.scene.add(そらのひかり);
    const たいよう = new THREE.DirectionalLight(0xffffff, 1.35);
    たいよう.position.set(40, 70, 25);
    たいよう.castShadow = true;
    たいよう.shadow.mapSize.set(1024, 1024);      // かいぞうどは ひくめ（かるさ ゆうせん）
    たいよう.shadow.camera.left = -30;
    たいよう.shadow.camera.right = 30;
    たいよう.shadow.camera.top = 30;
    たいよう.shadow.camera.bottom = -30;
    たいよう.shadow.camera.near = 1;
    たいよう.shadow.camera.far = 260;
    たいよう.shadow.bias = -0.0012;
    たいよう.shadow.normalBias = 0.5;             // しましま（かげの ノイズ）よけ
    this._ひかりのまと = new THREE.Object3D();     // かげの はんいの まんなか
    this.scene.add(this._ひかりのまと);
    たいよう.target = this._ひかりのまと;
    this._たいよう = たいよう;
    this.scene.add(たいよう);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    // --- カメラ ---
    this.camera = new THREE.PerspectiveCamera(70, 画面よこ / 画面たて, 0.1, 2000);
    this.camera.position.set(0, 14, 22);       // SPEC 2章の さいしょの いち
    this.camera.lookAt(0, 0, 0);
    this._カメラむき = 0;        // 左右（度）。0 のとき -z を 見ている
    this._カメラたて = 8;        // 上下（度）。プラスで 上から 見おろす
    this._カメラモード = 'じどう';   // じどう / ついせき / いちにんしょう / てうち
    this._カメラのあいて = null;
    this._カメラうしろ = 12;
    this._カメラたかさ = 6;
    this._カメラ注視 = null;      // カメラをむける(x,y,z) の いき先
    this._カメラ注視もの = null;  // カメラをむかせる(もの) の あいて
    this._マウスでみまわす = true;

    // --- きほんの ジオメトリ（つかいまわす。これが かるさの ひみつ） ---
    this._geoはこ = this._しげんにいれる(new THREE.BoxGeometry(1, 1, 1));
    this._geoたま = this._しげんにいれる(new THREE.SphereGeometry(0.5, 18, 12));
    this._geoつつ = this._しげんにいれる(new THREE.CylinderGeometry(0.5, 0.5, 1, 18));

    // --- HUD（てんすう と メッセージ）の したじゅんび ---
    this._てんすう = null;
    this._メッセージ = '';
    this._HUDを作る();

    // --- ★ さいしょから ある もの（SPEC 7章） ---
    this._ちめんを作る();
    this._プレイヤーを作る();

    // --- 自動そうさ ---
    this._そうさする = true;
    this._あるくはやさ = きほんのあるく;
    this._はしるはやさ = きほんのはしる;
    this._ジャンプのつよさ = きほんのジャンプ;
    this._あるき位相 = 0;
    this._ふりはば = 0;

    // さいしょの 1枚を えがいておく（▶ を おした しゅんかんに 絵が 出る）
    this._えがく();
  }

  /** 止まっているか */
  get stopped() {
    return this._とまった;
  }

  /** dispose する ものを おぼえておく */
  _しげんにいれる(x) {
    if (x && typeof x.dispose === 'function') this._しげん.push(x);
    return x;
  }

  /** おぼえておいた ものを ぜんぶ dispose する */
  _しげんをすてる() {
    if (this._しげん) {
      for (const x of this._しげん) {
        try { x.dispose(); } catch (e) { /* すてられなくても すすむ */ }
      }
    }
    this._しげん = [];
    if (this.scene) {
      // シーンから ぜんぶ はずす
      try {
        while (this.scene.children.length > 0) {
          this.scene.remove(this.scene.children[0]);
        }
      } catch (e) { /* 何もしない */ }
    }
    this.scene = null;
  }

  // =========================================================================
  // 2. ざいりょう（マテリアル）を つかいまわす
  // =========================================================================

  /**
   * いろ（＋もよう）ごとに 1つだけ マテリアルを つくって つかいまわす。
   * これを しないと もの が 数百こ に なった とき とても おもくなる。
   */
  _ざいりょうを取る(いろ, もようなまえ) {
    const かぎ = いろ + '|' + (もようなまえ || '');
    const あった = this._ざいりょう.get(かぎ);
    if (あった) return あった;

    const せってい = { color: new THREE.Color(いろ) };
    if (もようなまえ) {
      const t = this._もようをよむ(もようなまえ);
      if (t) せってい.map = t;
    }
    const m = this._しげんにいれる(new THREE.MeshLambertMaterial(せってい));
    this._ざいりょう.set(かぎ, m);
    return m;
  }

  // =========================================================================
  // 3. さいしょから ある もの（SPEC 7章）
  // =========================================================================

  /**
   * ちめん … 200 × 200 の ひろい ゆか（うすい みどり）。かべにする ずみ。
   * ロブロックスの ベースプレートっぽく、うっすら ますめの もようを つける。
   */
  _ちめんを作る() {
    const t = this._ますめのもよう();
    const せってい = { color: new THREE.Color('#7fc46a') };
    if (t) せってい.map = t;          // node など 絵が つくれない ところでは つけない
    const m = this._しげんにいれる(new THREE.MeshLambertMaterial(せってい));
    const mesh = new THREE.Mesh(this._geoはこ, m);
    mesh.receiveShadow = true;      // ゆかは かげを うけるだけ（じぶんは おとさない）
    this.scene.add(mesh);

    const o = this._ものをつくる({
      x: 0, y: -1, z: 0,
      よこ: 200, たかさ: 2, おくゆき: 200,
      いろ: '#7fc46a',
      __かたち: 'ちめん',
      __mesh: mesh,
      __きじゅん: { x: 1, y: 1, z: 1 },   // ジオメトリは 1 × 1 × 1 の はこ
      __かべ: true,
      __ざいりょう: m,
    });
    this.ちめん = o;
  }

  /** ますめの もようを つくる（うっすら 線が 入った 白い もの） */
  _ますめのもよう() {
    if (typeof document === 'undefined') return null;
    try {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const c = cv.getContext('2d');
      if (!c) return null;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 64, 64);
      c.strokeStyle = 'rgba(0,0,0,0.13)';
      c.lineWidth = 2;
      c.strokeRect(1, 1, 62, 62);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(50, 50);
      t.colorSpace = THREE.SRGBColorSpace;
      return this._しげんにいれる(t);
    } catch (e) {
      return null;
    }
  }

  /**
   * プレイヤー … まるっこい 人。原点の うえ（0, 4, 0）に 立っている。
   *
   *   あたま … 球（はんけい 0.7、はだいろ）
   *   からだ … カプセル（青いシャツ）
   *   うで2本・あし2本 … ほそい カプセル。あるくと 前後に ふる。
   *   ぜんぶで たかさ 5（-2.5 〜 +2.5）。
   */
  _プレイヤーを作る() {
    const G = new THREE.Group();

    // --- ざいりょう（プレイヤー用に 5つだけ つくる） ---
    const はだ = this._しげんにいれる(new THREE.MeshLambertMaterial({ color: new THREE.Color(はだいろ) }));
    const シャツ = this._しげんにいれる(new THREE.MeshLambertMaterial({ color: new THREE.Color(シャツのいろ) }));
    const ズボン = this._しげんにいれる(new THREE.MeshLambertMaterial({ color: new THREE.Color(ズボンのいろ) }));
    const め = this._しげんにいれる(new THREE.MeshLambertMaterial({ color: new THREE.Color(めのいろ) }));

    // --- ジオメトリ（まるっこく するため CapsuleGeometry を つかう） ---
    const geoあたま = this._しげんにいれる(new THREE.SphereGeometry(0.7, 20, 14));
    const geoからだ = this._しげんにいれる(this._カプセル(0.55, 1.0));
    const geoうで = this._しげんにいれる(this._カプセル(0.24, 1.32));
    const geoあし = this._しげんにいれる(this._カプセル(0.28, 1.44));
    const geoめ = this._しげんにいれる(new THREE.SphereGeometry(0.11, 8, 6));

    // からだ（すこし よこに ひろげて 人らしく）
    const からだ = new THREE.Mesh(geoからだ, シャツ);
    からだ.position.set(0, 0.35, 0);
    からだ.scale.set(1.2, 1, 0.85);
    からだ.__いろつく = true;
    G.add(からだ);

    // あたま
    const あたま = new THREE.Mesh(geoあたま, はだ);
    あたま.position.set(0, 1.8, 0);
    G.add(あたま);

    // め（前は -z がわ）
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(geoめ, め);
      e.position.set(0.26 * s, 1.9, -0.63);
      G.add(e);
    }

    // うで（かたの ところで まわすので、いれものの Group を つくる）
    const うで = [];
    for (const s of [-1, 1]) {
      const ピボット = new THREE.Group();
      ピボット.position.set(0.78 * s, 1.2, 0);
      const m = new THREE.Mesh(geoうで, シャツ);
      m.position.set(0, -0.9, 0);
      m.__いろつく = true;
      ピボット.add(m);
      G.add(ピボット);
      うで.push(ピボット);
    }

    // あし
    const あし = [];
    for (const s of [-1, 1]) {
      const ピボット = new THREE.Group();
      ピボット.position.set(0.32 * s, -0.5, 0);
      const m = new THREE.Mesh(geoあし, ズボン);
      m.position.set(0, -1.0, 0);
      m.__いろつく = true;
      ピボット.add(m);
      G.add(ピボット);
      あし.push(ピボット);
    }

    G.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.scene.add(G);

    const o = this._ものをつくる({
      x: 0, y: 4, z: 0,
      よこ: 1.8, たかさ: 5, おくゆき: 1.2,
      いろ: シャツのいろ,
      __かたち: 'プレイヤー',
      __mesh: G,
      __じゅうりょく: true,
      __プレイヤー: true,
      __だんさ: 1.0,        // これ以下の 段差は のぼれる
      __うで: うで,
      __あし: あし,
    });
    this.プレイヤー = o;
  }

  /**
   * カプセル（上下が まるい 柱）を つくる。
   * three.js に CapsuleGeometry が あれば それを、なければ 球で だいたい 作る。
   */
  _カプセル(はんけい, まっすぐな長さ) {
    if (typeof THREE.CapsuleGeometry === 'function') {
      return new THREE.CapsuleGeometry(はんけい, まっすぐな長さ, 6, 12);
    }
    // ここに 来ることは まず ないが、ねんのため
    return new THREE.SphereGeometry(はんけい, 12, 8);
  }

  // =========================================================================
  // 4. もの を つくる
  // =========================================================================

  /**
   * もの の もとを つくる。
   * 上限を こえていたら 一覧に 入れずに（死んだ）ものを かえす。
   * こうすると `けす()` ずみの ものと おなじ あつかいに なって、
   * あとから つかっても ぜったい 落ちない。
   */
  _ものをつくる(データ) {
    const もの = {
      // --- 見える フィールド（日本語の 名前そのまま。SPEC 2章） ---
      x: 0, y: 0, z: 0,
      よこ: 1, たかさ: 1, おくゆき: 1,
      いろ: '#ffffff',
      むき: 0,
      かたむき: 0,
      みえる: true,
      // --- 中で つかう もの（__ で はじめる） ---
      __もの: true,
      __いきてる: true,
      __かたち: 'はこ',
      __mesh: null,
      __きじゅん: null,        // scale = よこ / きじゅんよこ
      __もとよこ: 1, __もとたかさ: 1, __もとおくゆき: 1,
      __いろ適用: null,
      __もよう: null,
      __じゅうりょく: false,
      __かべ: false,
      __vx: 0, __vy: 0, __vz: 0,
      __ゆかにいる: false,
      __だんさ: 0,
      // --- アニメ用（じぶんのモデル / プレイヤーのすがた の ときだけ 中身が 入る）---
      __モデルめい: null,
      __モデルぶひん: null,     // parts の ばんごうと おなじ ならびの Mesh
      __もとしせい: null,       // その ぶひんの もとの いち・むき
      __アニメ: null,           // { なまえ, データ, じかん }
      __プレイヤー: false,
      __id: this._つぎのID++,
    };
    Object.assign(もの, データ);

    もの.__もとよこ = 数にする(もの.よこ, 1);
    もの.__もとたかさ = 数にする(もの.たかさ, 1);
    もの.__もとおくゆき = 数にする(もの.おくゆき, 1);
    if (!もの.__きじゅん) {
      もの.__きじゅん = {
        x: もの.__もとよこ || 1,
        y: もの.__もとたかさ || 1,
        z: もの.__もとおくゆき || 1,
      };
    }
    もの.__いろ適用 = もの.いろ;

    if (this.もの一覧.length >= ものの上限) {
      if (!this._上限警告ずみ) {
        this._上限警告ずみ = true;
        this._ログ(
          '⚠ ものが ' + ものの上限 + 'こを こえたので、これいじょう 作れません。' +
            'いらなくなった ものは けす() で けしてね'
        );
      }
      もの.__いきてる = false;
      if (もの.__mesh && this.scene) {
        try { this.scene.remove(もの.__mesh); } catch (e) { /* 何もしない */ }
      }
      return もの;
    }
    this.もの一覧.push(もの);
    return もの;
  }

  /** はこ・たま・つつ のような、きほんの かたちの もの を つくる */
  _かたちをつくる(かたち, geo, データ) {
    const いろ = データ.いろ || いろの表.しろ;
    const mesh = new THREE.Mesh(geo, this._ざいりょうを取る(いろ, null));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (this.scene) this.scene.add(mesh);
    return this._ものをつくる(Object.assign({
      __かたち: かたち,
      __mesh: mesh,
      __きじゅん: { x: 1, y: 1, z: 1 },   // ジオメトリは 1 × 1 × 1
      いろ: いろ,
    }, データ));
  }

  // =========================================================================
  // 5. おえかき部屋の もよう（localStorage: kotodama-arts）
  //
  //   { "なまえ": { w, h, px: ["#ff0000", null, ...] } }
  //   null は とうめい。ひだり上から みぎへ ならんでいる。
  // =========================================================================

  _もようをよむ(なまえ) {
    if (this._もようキャッシュ.has(なまえ)) return this._もようキャッシュ.get(なまえ);

    let 表 = null;
    try {
      表 = JSON.parse(localStorage.getItem('kotodama-arts') || '{}');
    } catch (e) {
      表 = {};
    }
    const d = 表 && 表[なまえ];
    if (!d || !d.px || !d.w || !d.h) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」という もようは まだ ありません。' +
        (ある.length
          ? 'いま あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です'
          : 'おえかき部屋で かいてから つかってね')
      );
    }

    if (typeof document === 'undefined') return null;   // node での テスト用
    let t = null;
    try {
      const cv = document.createElement('canvas');
      cv.width = d.w;
      cv.height = d.h;
      const c = cv.getContext('2d');
      for (let i = 0; i < d.px.length; i++) {
        const いろ = d.px[i];
        if (!いろ) continue;                 // null は とうめい
        c.fillStyle = いろ;
        c.fillRect(i % d.w, Math.floor(i / d.w), 1, 1);
      }
      t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter;     // ドットを くっきり
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      this._しげんにいれる(t);
    } catch (e) {
      t = null;
    }
    this._もようキャッシュ.set(なまえ, t);
    return t;
  }

  // =========================================================================
  // 6. モデリング部屋の モデル（localStorage: kotodama-models）
  //
  //   { "なまえ": { parts: [ { type, size, pos, rot(ラジアン), color } ] } }
  // =========================================================================

  _モデルをよむ(なまえ) {
    let 表 = null;
    try {
      表 = JSON.parse(localStorage.getItem('kotodama-models') || '{}');
    } catch (e) {
      表 = {};
    }
    const d = 表 && 表[なまえ];
    if (!d || !Array.isArray(d.parts)) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」という モデルは まだ ありません。' +
        (ある.length
          ? 'いま あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です'
          : 'モデリング部屋で つくってから つかってね')
      );
    }
    if (d.parts.length === 0) {
      throw エラー('「' + なまえ + '」の モデルには ぶひんが 1つも ありません');
    }

    // --- ぶひんを ならべた Group を つくる ---
    //   ぶひん[] と もとしせい[] は、保存された parts の ばんごう（0から）と
    //   おなじ ならびに する。アニメの track.part が この ばんごうを さす。
    const 中身 = new THREE.Group();
    const ぶひん = [];
    const もとしせい = [];
    for (const p of d.parts) {
      if (!p) { ぶひん.push(null); もとしせい.push(null); continue; }
      const sx = Math.abs(数にする(p.size && p.size.x, 1)) || 0.001;
      const sy = Math.abs(数にする(p.size && p.size.y, 1)) || 0.001;
      const sz = Math.abs(数にする(p.size && p.size.z, 1)) || 0.001;
      const いろ = いろ安全(p.color, '#cccccc');
      const geo = (p.type === 'cyl') ? this._geoつつ : this._geoはこ;
      const m = new THREE.Mesh(geo, this._ざいりょうを取る(いろ, null));
      // 円柱は size.x が 直径、size.y が たかさ（editor.html と おなじ）
      if (p.type === 'cyl') m.scale.set(sx, sy, sx);
      else m.scale.set(sx, sy, sz);
      m.position.set(
        数にする(p.pos && p.pos.x, 0),
        数にする(p.pos && p.pos.y, 0),
        数にする(p.pos && p.pos.z, 0)
      );
      // rot は ラジアン（editor.html と おなじ）
      m.rotation.set(
        数にする(p.rot && p.rot.x, 0),
        数にする(p.rot && p.rot.y, 0),
        数にする(p.rot && p.rot.z, 0)
      );
      m.__いろつく = true;
      m.castShadow = true;
      m.receiveShadow = true;
      中身.add(m);
      ぶひん.push(m);
      // アニメは「もとの しせいからの ズレ」なので、もとを おぼえておく
      もとしせい.push({
        px: m.position.x, py: m.position.y, pz: m.position.z,
        rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z,
      });
    }

    // --- ぜんぶを かこむ 箱を はかる（当たり判定に つかう） ---
    中身.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(中身);
    let よこ = bb.max.x - bb.min.x;
    let たかさ = bb.max.y - bb.min.y;
    let おくゆき = bb.max.z - bb.min.z;
    if (!Number.isFinite(よこ) || よこ <= 0) よこ = 1;
    if (!Number.isFinite(たかさ) || たかさ <= 0) たかさ = 1;
    if (!Number.isFinite(おくゆき) || おくゆき <= 0) おくゆき = 1;
    const 中心 = {
      x: (bb.max.x + bb.min.x) / 2,
      y: (bb.max.y + bb.min.y) / 2,
      z: (bb.max.z + bb.min.z) / 2,
    };
    // もの の x,y,z は「まんなか」なので、まんなかが 原点に くるように ずらす
    中身.position.set(-中心.x, -中心.y, -中心.z);

    const そと = new THREE.Group();
    そと.add(中身);
    return {
      group: そと, よこ, たかさ, おくゆき,
      いろ: いろ安全(d.parts[0] && d.parts[0].color, '#cccccc'),
      ぶひん, もとしせい,
    };
  }

  // =========================================================================
  // 6b. アニメ部屋の アニメ（localStorage: kotodama-anims）
  //
  //   { "なまえ": { model, loop, sec, tracks: [ { part, keys: [
  //       { t, pos:{x,y,z}, rot:{x,y,z}(ラジアン) } ] } ] } }
  //
  //   pos / rot は「もとの しせいからの ズレ」。
  //   part は そのモデルの parts の ばんごう（0から）。
  // =========================================================================

  _アニメをよむ(なまえ) {
    if (this._アニメキャッシュ.has(なまえ)) return this._アニメキャッシュ.get(なまえ);

    let 表 = null;
    try {
      表 = JSON.parse(localStorage.getItem('kotodama-anims') || '{}');
    } catch (e) {
      表 = {};
    }
    const d = 表 && 表[なまえ];
    if (!d || !Array.isArray(d.tracks)) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」という アニメは まだ ありません。' +
        (ある.length
          ? 'いま あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です'
          : 'アニメ部屋で つくってから つかってね')
      );
    }

    // --- つかいやすい かたちに ととのえる（へんな 数が 入っていても 落ちない）---
    let sec = 数にする(d.sec, 1);
    if (!(sec > 0)) sec = 1;
    const loop = しんぎ(d.loop) && d.loop !== undefined;

    const tracks = [];
    for (const tr of d.tracks) {
      if (!tr || !Array.isArray(tr.keys) || tr.keys.length === 0) continue;
      const part = Math.floor(数にする(tr.part, -1));
      if (!(part >= 0)) continue;
      const keys = [];
      for (const k of tr.keys) {
        if (!k) continue;
        let t = 数にする(k.t, 0);
        if (t < 0) t = 0;
        if (t > sec) t = sec;
        keys.push({
          t: t,
          px: 数にする(k.pos && k.pos.x, 0),
          py: 数にする(k.pos && k.pos.y, 0),
          pz: 数にする(k.pos && k.pos.z, 0),
          rx: 数にする(k.rot && k.rot.x, 0),
          ry: 数にする(k.rot && k.rot.y, 0),
          rz: 数にする(k.rot && k.rot.z, 0),
        });
      }
      if (keys.length === 0) continue;
      keys.sort((x, y) => x.t - y.t);      // t の ちいさい じゅんに（ねんのため）
      tracks.push({ part, keys });
    }
    if (tracks.length === 0) {
      throw エラー(
        '「' + なまえ + '」の アニメには うごく ぶひんが 1つも ありません。' +
          'アニメ部屋で キーを うってから つかってね'
      );
    }

    const できあがり = {
      なまえ: なまえ,
      モデル: typeof d.model === 'string' ? d.model : '',
      sec: sec,
      loop: loop,
      tracks: tracks,
    };
    this._アニメキャッシュ.set(なまえ, できあがり);
    return できあがり;
  }

  /** アニメを 1フレームぶん すすめて、ぶひんの しせいに あてはめる */
  _アニメをすすめる(o, dt) {
    const A = o.__アニメ;
    const ぶひん = o.__モデルぶひん;
    const もと = o.__もとしせい;
    if (!A || !ぶひん || !もと) return;

    A.じかん += dt;
    let T = A.じかん;
    if (A.データ.loop) {
      T = T % A.データ.sec;
      if (T < 0) T += A.データ.sec;
    } else if (T > A.データ.sec) {
      T = A.データ.sec;              // くりかえさない ときは さいごの かたちで とまる
    }

    const tracks = A.データ.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const m = ぶひん[tr.part];
      const b = もと[tr.part];
      if (!m || !b) continue;        // その ばんごうの ぶひんが なければ とばす
      const s = しせいをもとめる(tr.keys, T, A.データ.sec, A.データ.loop);
      if (!s) continue;
      m.position.set(b.px + s.px, b.py + s.py, b.pz + s.pz);
      m.rotation.set(b.rx + s.rx, b.ry + s.ry, b.rz + s.rz);
    }
  }

  /** ぶひんを ぜんぶ もとの しせいに もどす */
  _しせいをもどす(o) {
    const ぶひん = o.__モデルぶひん;
    const もと = o.__もとしせい;
    if (!ぶひん || !もと) return;
    for (let i = 0; i < ぶひん.length; i++) {
      const m = ぶひん[i];
      const b = もと[i];
      if (!m || !b) continue;
      m.position.set(b.px, b.py, b.pz);
      m.rotation.set(b.rx, b.ry, b.rz);
    }
  }

  // =========================================================================
  // 7. かんばん（いつも カメラを むく 文字の 板）
  // =========================================================================

  _かんばんをつくる(もじ) {
    let tex = null;
    let ひ = 4;    // よこ / たて の ひりつ
    if (typeof document !== 'undefined') {
      try {
        const 行 = String(もじ).split('\n');
        const cv = document.createElement('canvas');
        const c0 = cv.getContext('2d');
        const サイズ = 72;
        c0.font = 'bold ' + サイズ + 'px ' + フォント;
        let はば = 16;
        for (const l of 行) はば = Math.max(はば, c0.measureText(l).width);
        cv.width = Math.min(2048, Math.ceil(はば) + 48);
        cv.height = Math.ceil(サイズ * 1.35 * 行.length) + 28;
        const c = cv.getContext('2d');
        // うしろの ふだ（すこし まるい 黒い 板）
        c.fillStyle = 'rgba(20,26,34,0.72)';
        const r = 18;
        c.beginPath();
        c.moveTo(r, 0);
        c.lineTo(cv.width - r, 0);
        c.quadraticCurveTo(cv.width, 0, cv.width, r);
        c.lineTo(cv.width, cv.height - r);
        c.quadraticCurveTo(cv.width, cv.height, cv.width - r, cv.height);
        c.lineTo(r, cv.height);
        c.quadraticCurveTo(0, cv.height, 0, cv.height - r);
        c.lineTo(0, r);
        c.quadraticCurveTo(0, 0, r, 0);
        c.fill();
        // もじ
        c.font = 'bold ' + サイズ + 'px ' + フォント;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#ffffff';
        for (let i = 0; i < 行.length; i++) {
          c.fillText(行[i], cv.width / 2, 14 + サイズ * 1.35 * (i + 0.5) - 6);
        }
        tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        this._しげんにいれる(tex);
        ひ = cv.width / cv.height;
      } catch (e) {
        tex = null;
      }
    }
    const せってい = {
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      fog: true,
    };
    if (tex) せってい.map = tex;      // node など 絵が つくれない ところでは つけない
    const mat = this._しげんにいれる(new THREE.SpriteMaterial(せってい));
    const sp = new THREE.Sprite(mat);
    const たかさ = 2;
    return { sprite: sp, よこ: たかさ * ひ, たかさ: たかさ, ざいりょう: mat };
  }

  // =========================================================================
  // 8. HUD（てんすう と メッセージ）
  //
  //   canvas は 1まいしか ないので、
  //   2D で かいた 絵を テクスチャに して、3D の うえに もう1回 かさねる。
  // =========================================================================

  _HUDを作る() {
    this._hud = null;
    if (!this.renderer || typeof document === 'undefined') return;
    try {
      const cv = document.createElement('canvas');
      cv.width = 画面よこ;
      cv.height = 画面たて;
      const tex = this._しげんにいれる(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = this._しげんにいれる(new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false,
      }));
      const geo = this._しげんにいれる(new THREE.PlaneGeometry(2, 2));
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(geo, mat));
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._hud = {
        canvas: cv, ctx: cv.getContext('2d'), tex, scene, cam,
        よごれ: true, みえる: false,
      };
    } catch (e) {
      this._hud = null;
    }
  }

  /**
   * もじが はばに おさまるように、1行を おりかえす。
   * まず 空白（半角・全角）の ところで きって、それでも 入らなければ 文字で きる。
   */
  _おりかえす(ctx, 行, はば) {
    if (ctx.measureText(行).width <= はば) return [行];
    const もじ = Array.from(行);
    const 出 = [];
    let いま = '';
    let きれめ = -1;              // さいごに 見つけた 空白の うしろ（いま の 中の いち）
    for (let i = 0; i < もじ.length; i++) {
      const c = もじ[i];
      const ため = いま + c;
      if (いま !== '' && ctx.measureText(ため).width > はば) {
        if (きれめ > 0) {
          出.push(いま.slice(0, きれめ).replace(/[ 　]+$/, ''));
          いま = いま.slice(きれめ).replace(/^[ 　]+/, '') + c;
        } else {
          出.push(いま);
          いま = c;
        }
        きれめ = -1;
      } else {
        いま = ため;
        if (c === ' ' || c === '　') きれめ = いま.length;
      }
    }
    if (いま !== '') 出.push(いま);
    return 出;
  }

  /**
   * もじを、はばに おさまる フォントサイズと 行に くみなおす。
   *   1. まず フォントを だんだん 小さくして、はばに 入るか ためす
   *   2. いちばん 小さくしても 入らないほど 長いときは 空白で おりかえす
   * @returns {{サイズ:number, 行:string[]}}
   */
  _もじをくむ(ctx, もと, さいだい, さいしょう, はば) {
    const げんぶん = String(もと).split('\n');
    for (let サイズ = さいだい; サイズ >= さいしょう; サイズ -= 2) {
      ctx.font = 'bold ' + サイズ + 'px ' + フォント;
      let 入る = true;
      for (const l of げんぶん) {
        if (ctx.measureText(l).width > はば) { 入る = false; break; }
      }
      if (入る) return { サイズ: サイズ, 行: げんぶん };
    }
    // ここまで きたら、いちばん 小さい フォントで おりかえす
    ctx.font = 'bold ' + さいしょう + 'px ' + フォント;
    const 行 = [];
    for (const l of げんぶん) {
      for (const w of this._おりかえす(ctx, l, はば)) 行.push(w);
    }
    return { サイズ: さいしょう, 行: 行 };
  }

  _HUDをかく() {
    const h = this._hud;
    if (!h || !h.ctx) return;
    const ctx = h.ctx;
    ctx.clearRect(0, 0, 画面よこ, 画面たて);
    let なにか = false;

    if (this._てんすう !== null) {
      なにか = true;
      ctx.save();
      // けたが ふえても 右はしから はみ出さないように、はばを 見て 小さくする
      const s = String(this._てんすう);
      const くみ = this._もじをくむ(ctx, s, 30, 12, 画面よこ * 0.44);
      ctx.font = 'bold ' + くみ.サイズ + 'px ' + フォント;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, くみ.サイズ * 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(くみ.行[0], 画面よこ - 18, 14);
      ctx.fillStyle = '#ffd66e';
      ctx.fillText(くみ.行[0], 画面よこ - 18, 14);
      ctx.restore();
    }

    if (this._メッセージ !== '' && this._メッセージ !== null) {
      なにか = true;
      ctx.save();
      // 画面の 90% に おさまるまで 小さくして、それでも 長ければ おりかえす。
      // ゲームしゅうりょう() の もじも ここを とおる。
      const くみ2 = this._もじをくむ(ctx, this._メッセージ, 46, 22, 画面よこ * 0.90);
      const 行 = くみ2.行;
      const 行たかさ = くみ2.サイズ * 1.25;
      ctx.font = 'bold ' + くみ2.サイズ + 'px ' + フォント;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const はじめ = 画面たて / 2 - ((行.length - 1) * 行たかさ) / 2;
      ctx.lineWidth = Math.max(4, くみ2.サイズ * 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 行.length; i++) {
        const yy = はじめ + i * 行たかさ;
        ctx.strokeText(行[i], 画面よこ / 2, yy);
        ctx.fillText(行[i], 画面よこ / 2, yy);
      }
      ctx.restore();
    }

    h.みえる = なにか;
    h.tex.needsUpdate = true;
    h.よごれ = false;
  }

  // =========================================================================
  // 9. フレーム
  // =========================================================================

  /** ユーザーコードの まえ。入力の「おした しゅんかん」を きめる */
  beginFrame(dt) {
    const d = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    this._dt = d > 0.05 ? 0.05 : (d > 0 ? d : 0);
    this._じかん += this._dt;

    this._おした = new Set(this._おしたまち);
    this._おしたまち.clear();
    this._クリックした = this._クリックまち;
    this._クリックまち = false;
  }

  /** ユーザーコードの あと。そうさ → 物理 → 絵 の じゅんばん */
  endFrame() {
    const dt = this._dt || 0;
    try {
      this._じどうそうさ(dt);      // WASD で あるく（SPEC 7章）
      this._ぶつりをすすめる(dt);  // おちる・ぶつかる（SPEC 4章）
      this._アニメ(dt);            // うで と あしを ふる
      this._カメラをすすめる(dt);
      this._えがく();
    } catch (e) {
      // 絵で 落ちても ゲームは とめない（英語の エラーを 外に 出さない）
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ことだま runtime]', e);
      }
    }
    this._おした.clear();
    this._クリックした = false;
    this._みまわしdx = 0;
    this._みまわしdy = 0;
  }

  // =========================================================================
  // 10. 自動そうさ（コードを 書かなくても うごく）
  // =========================================================================

  _じどうそうさ(dt) {
    const p = this.プレイヤー;
    if (!this._そうさする || !p || !p.__いきてる) return;

    // --- キーと ゆびから 前後（f）と 左右（r）を つくる ---
    let f = 0, r = 0;
    if (this._おされてる.has('W') || this._おされてる.has('うえ')) f += 1;
    if (this._おされてる.has('S') || this._おされてる.has('した')) f -= 1;
    if (this._おされてる.has('D') || this._おされてる.has('みぎ')) r += 1;
    if (this._おされてる.has('A') || this._おされてる.has('ひだり')) r -= 1;
    if (this._スティック.id !== null) {
      f = -this._スティック.dy;
      r = this._スティック.dx;
    }
    const ながさ = Math.hypot(f, r);
    if (ながさ > 1) { f /= ながさ; r /= ながさ; }

    // --- カメラの むいている ほうへ あるく ---
    const ラジ = ど2ラジ(this._カメラむき);
    const まえx = -Math.sin(ラジ), まえz = -Math.cos(ラジ);
    const みぎx = Math.cos(ラジ), みぎz = -Math.sin(ラジ);
    const はしる = this._おされてる.has('シフト');
    const はやさ = はしる ? this._はしるはやさ : this._あるくはやさ;

    const wx = まえx * f + みぎx * r;
    const wz = まえz * f + みぎz * r;
    const l = Math.hypot(wx, wz);
    if (l > 0.001) {
      p.__vx = (wx / l) * はやさ;
      p.__vz = (wz / l) * はやさ;
      // すすむ ほうを むく（ゆっくり まわる と 気もちいい）
      const ねらい = (Math.atan2(-wx / l, -wz / l) * 180) / Math.PI;
      p.むき = this._むきをちかづける(数にする(p.むき, 0), ねらい, dt * 900);
    } else {
      p.__vx = 0;
      p.__vz = 0;
    }
    // 一人称の ときは カメラと おなじ ほうを むく
    if (this._カメラモード === 'いちにんしょう' && this._カメラのあいて === p) {
      p.むき = this._カメラむき;
    }

    // --- ジャンプ（ゆかに いるときだけ） ---
    if (this._おされてる.has('スペース') && p.__ゆかにいる) {
      p.__vy = this._ジャンプのつよさ;
      p.__ゆかにいる = false;
    }
  }

  /** いまの むきから ねらいの むきへ、さいだい `はやさ` 度だけ ちかづける */
  _むきをちかづける(いま, ねらい, はやさ) {
    let さ = ((ねらい - いま + 540) % 360) - 180;
    if (Math.abs(さ) <= はやさ) return ねらい;
    return いま + Math.sign(さ) * はやさ;
  }

  // =========================================================================
  // 11. かんたんな 物理（SPEC 4章）
  //
  //   ・じゅうりょく にした ものは まいフレーム おちる（y に -55）
  //   ・かべにする した ものは 通りぬけできない
  //   ・当たり判定は 軸ごとに じゅんに おしもどす AABB（x → z → y の じゅん）
  //   ・ものが 300こを こえたら、ちかい かべ だけ しらべる
  // =========================================================================

  _ぶつりをすすめる(dt) {
    if (dt <= 0) return;

    // --- かべの 一覧（と、おおいときは ますめ）を つくりなおす ---
    this._かべをあつめる();

    for (let i = 0; i < this.もの一覧.length; i++) {
      const o = this.もの一覧[i];
      if (!o || !o.__いきてる) continue;

      // うごく ひつようが ある もの だけ しらべる（かるくする）
      const うごく =
        o.__じゅうりょく ||
        o.__vx !== 0 || o.__vy !== 0 || o.__vz !== 0;
      if (!うごく) continue;

      if (o.__じゅうりょく) {
        o.__vy = 数にする(o.__vy, 0) - じゅうりょくの強さ * dt;
        if (o.__vy < -おちる上限) o.__vy = -おちる上限;
      }
      this._からだをうごかす(o, dt);
    }
  }

  /** かべに なっている ものを あつめる。おおければ ますめに 分ける */
  _かべをあつめる() {
    const 一覧 = [];
    for (let i = 0; i < this.もの一覧.length; i++) {
      const o = this.もの一覧[i];
      if (o && o.__いきてる && o.__かべ) 一覧.push(o);
    }
    this._かべ一覧 = 一覧;
    this._グリッド = null;

    if (一覧.length <= グリッドを使う数) return;

    // ものが おおい ときだけ、よこ（x,z）で ますめに 分けて はやくする
    const g = new Map();
    for (const o of 一覧) {
      const b = はこにする(o);
      const x0 = Math.floor(b.minX / ますの大きさ), x1 = Math.floor(b.maxX / ますの大きさ);
      const z0 = Math.floor(b.minZ / ますの大きさ), z1 = Math.floor(b.maxZ / ますの大きさ);
      // でかすぎる もの（ちめん など）は ますめに 入れずに いつも しらべる
      if ((x1 - x0) * (z1 - z0) > 400) {
        if (!g.has('*')) g.set('*', []);
        g.get('*').push(o);
        continue;
      }
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const かぎ = x + ',' + z;
          let c = g.get(かぎ);
          if (!c) { c = []; g.set(かぎ, c); }
          c.push(o);
        }
      }
    }
    this._グリッド = g;
  }

  /** その はんいに かさなりそうな かべを かえす */
  _ちかいかべ(b) {
    if (!this._グリッド) return this._かべ一覧;
    const out = [];
    const みた = new Set();
    const おおきいの = this._グリッド.get('*');
    if (おおきいの) for (const o of おおきいの) { みた.add(o); out.push(o); }
    const x0 = Math.floor(b.minX / ますの大きさ), x1 = Math.floor(b.maxX / ますの大きさ);
    const z0 = Math.floor(b.minZ / ますの大きさ), z1 = Math.floor(b.maxZ / ますの大きさ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const c = this._グリッド.get(x + ',' + z);
        if (!c) continue;
        for (const o of c) {
          if (みた.has(o)) continue;
          みた.add(o);
          out.push(o);
        }
      }
    }
    return out;
  }

  /**
   * もの を 1歩 うごかす。
   * x → z → y の じゅんに 「うごかす → めりこんでいたら おしもどす」。
   */
  _からだをうごかす(o, dt) {
    const すきま = 0.001;
    o.__ゆかにいる = false;
    this._じくをうごかす(o, 'x', 数にする(o.__vx, 0) * dt, すきま);
    this._じくをうごかす(o, 'z', 数にする(o.__vz, 0) * dt, すきま);
    this._じくをうごかす(o, 'y', 数にする(o.__vy, 0) * dt, すきま);
  }

  _じくをうごかす(o, じく, ずれ, すきま) {
    if (ずれ === 0 || !Number.isFinite(ずれ)) return;
    o[じく] = 数にする(o[じく], 0) + ずれ;

    const じぶん = はこにする(o);
    const かべ = this._ちかいかべ(じぶん);
    const はんx = (じぶん.maxX - じぶん.minX) / 2;
    const はんy = (じぶん.maxY - じぶん.minY) / 2;
    const はんz = (じぶん.maxZ - じぶん.minZ) / 2;

    for (let i = 0; i < かべ.length; i++) {
      const w = かべ[i];
      if (w === o) continue;                 // じぶん とは ぶつからない
      const a = はこにする(o);
      const b = はこにする(w);
      if (!かさなる(a, b)) continue;

      if (じく === 'y') {
        if (ずれ > 0) {                      // あたまを ぶつけた
          o.y = b.minY - はんy - すきま;
          if (数にする(o.__vy, 0) > 0) o.__vy = 0;
        } else {                             // ちゃくちした
          o.y = b.maxY + はんy + すきま;
          if (数にする(o.__vy, 0) < 0) o.__vy = 0;
          o.__ゆかにいる = true;
        }
      } else {
        // ひくい 段差なら のりこえられるか ためす（プレイヤー だけ）
        const だんさ = 数にする(o.__だんさ, 0);
        if (だんさ > 0) {
          const のぼり = b.maxY - a.minY;
          if (のぼり > 0 && のぼり <= だんさ) {
            const ためし = 数にする(o.y, 0) + のぼり + すきま;
            if (this._そこに立てる(o, 数にする(o.x, 0), ためし, 数にする(o.z, 0))) {
              o.y = ためし;
              continue;
            }
          }
        }
        if (じく === 'x') {
          o.x = (ずれ > 0) ? (b.minX - はんx - すきま) : (b.maxX + はんx + すきま);
          o.__vx = 0;
        } else {
          o.z = (ずれ > 0) ? (b.minZ - はんz - すきま) : (b.maxZ + はんz + すきま);
          o.__vz = 0;
        }
      }
    }
  }

  /** そこに 立てるか（あたまが つかえないか） */
  _そこに立てる(o, x, y, z) {
    const ためし = { x, y, z, よこ: o.よこ, たかさ: o.たかさ, おくゆき: o.おくゆき };
    const a = はこにする(ためし);
    const かべ = this._ちかいかべ(a);
    for (let i = 0; i < かべ.length; i++) {
      const w = かべ[i];
      if (w === o) continue;
      if (かさなる(a, はこにする(w))) return false;
    }
    return true;
  }

  // =========================================================================
  // 12. プレイヤーの アニメ（うで と あしを ふる）
  // =========================================================================

  _アニメ(dt) {
    // --- アニメ部屋で つくった アニメを すすめる ---
    for (let i = 0; i < this.もの一覧.length; i++) {
      const o = this.もの一覧[i];
      if (o && o.__いきてる && o.__アニメ) this._アニメをすすめる(o, dt);
    }

    // --- さいしょから いる プレイヤーの 腕・脚の ふり ---
    //   プレイヤーのすがた() で 見ためを 入れかえたら __うで が なくなるので、
    //   ここは 自然に 止まる。
    const p = this.プレイヤー;
    if (!p || !p.__いきてる || !p.__うで) return;

    const はやさ = Math.hypot(数にする(p.__vx, 0), 数にする(p.__vz, 0));
    // あるいて いるほど おおきく、止まったら すーっと もどす
    const ねらいふりはば = Math.min(0.85, はやさ * 0.042);
    this._ふりはば += (ねらいふりはば - this._ふりはば) * Math.min(1, dt * 10);
    this._あるき位相 += dt * (2.4 + はやさ * 0.42);

    const s = Math.sin(this._あるき位相) * this._ふりはば;
    p.__うで[0].rotation.x = s;
    p.__うで[1].rotation.x = -s;
    p.__あし[0].rotation.x = -s;
    p.__あし[1].rotation.x = s;
    // うでは すこし 外に ひらく（ぼうっと 立って いるように 見えないように）
    p.__うで[0].rotation.z = 0.09;
    p.__うで[1].rotation.z = -0.09;
  }

  // =========================================================================
  // 13. カメラ
  // =========================================================================

  _カメラをすすめる(dt) {
    const cam = this.camera;
    if (!cam) return;

    // --- マウス（または ゆび）で 見まわす ---
    if (this._マウスでみまわす && (this._みまわしdx !== 0 || this._みまわしdy !== 0)) {
      this._カメラむき -= this._みまわしdx * 0.13;
      this._カメラたて += this._みまわしdy * 0.13;
      if (this._カメラたて > 68) this._カメラたて = 68;
      if (this._カメラたて < -55) this._カメラたて = -55;
      this._カメラむき = ((this._カメラむき % 360) + 360) % 360;
    }

    const モード = this._カメラモード;

    if (モード === 'いちにんしょう') {
      const o = this._カメラのあいて;
      if (o && o.__いきてる) {
        const めのたかさ = Math.abs(数にする(o.たかさ, 5)) * 0.36;
        cam.position.set(
          数にする(o.x, 0),
          数にする(o.y, 0) + めのたかさ,
          数にする(o.z, 0)
        );
        const yr = ど2ラジ(this._カメラむき);
        const pr = ど2ラジ(this._カメラたて);
        const cp = Math.cos(pr);
        cam.lookAt(
          cam.position.x - Math.sin(yr) * cp,
          cam.position.y - Math.sin(pr),
          cam.position.z - Math.cos(yr) * cp
        );
      }
      return;
    }

    if (モード === 'じどう' || モード === 'ついせき') {
      const o = (モード === 'じどう') ? this.プレイヤー : this._カメラのあいて;
      if (o && o.__いきてる) {
        const うしろ = Math.max(0.5, 数にする(this._カメラうしろ, 12));
        const たかさ = 数にする(this._カメラたかさ, 6);
        const yr = ど2ラジ(this._カメラむき);
        const pr = ど2ラジ(this._カメラたて);
        const よこきょり = うしろ * Math.cos(pr);
        const たてずれ = たかさ + うしろ * Math.sin(pr);
        const tx = 数にする(o.x, 0);
        const ty = 数にする(o.y, 0) + Math.abs(数にする(o.たかさ, 5)) * 0.25;
        const tz = 数にする(o.z, 0);
        cam.position.set(
          tx + Math.sin(yr) * よこきょり,
          ty + たてずれ,
          tz + Math.cos(yr) * よこきょり
        );
        cam.lookAt(tx, ty, tz);
      }
      return;
    }

    // てうち（カメラをおく / カメラをむける / カメラをむかせる）
    if (this._カメラ注視もの && this._カメラ注視もの.__いきてる) {
      const o = this._カメラ注視もの;
      cam.lookAt(数にする(o.x, 0), 数にする(o.y, 0), 数にする(o.z, 0));
    } else if (this._カメラ注視) {
      cam.lookAt(this._カメラ注視.x, this._カメラ注視.y, this._カメラ注視.z);
    }
  }

  // =========================================================================
  // 14. えがく（もの の フィールドを Mesh に うつして レンダリング）
  //
  //   ユーザーが `ゆうしゃ.y = 20` のように フィールドを 直接 書きかえても
  //   つぎの えがきで かならず Mesh に つたわるように、
  //   まいフレーム ぜんぶ 同期する（数百こ なら じゅうぶん はやい）。
  // =========================================================================

  _えがく() {
    if (!this.renderer || !this.scene || !this.camera) return;

    // かげの はんい（30スタッド 四方）を、いま 見ている ところへ もっていく。
    // こうすると せまい かげの 1まいでも きれいに 見える。
    if (this._ひかりのまと && this._たいよう) {
      const p = this.プレイヤー;
      let cx = 0, cy = 0, cz = 0;
      if (p && p.__いきてる) {
        cx = 数にする(p.x, 0); cy = 数にする(p.y, 0) - 2.5; cz = 数にする(p.z, 0);
      } else {
        // プレイヤーが いなければ、カメラの まえ 18スタッド あたり
        cx = this.camera.position.x;
        cz = this.camera.position.z;
        cy = 0;
      }
      this._ひかりのまと.position.set(cx, cy, cz);
      this._たいよう.position.set(cx + 40, cy + 70, cz + 25);
    }

    for (let i = 0; i < this.もの一覧.length; i++) {
      this._ものを同期(this.もの一覧[i]);
    }

    // 一人称の あいては 見えなくする（自分の 中に カメラが あるので）
    if (this._カメラモード === 'いちにんしょう' &&
        this._カメラのあいて && this._カメラのあいて.__mesh) {
      this._カメラのあいて.__mesh.visible = false;
    }

    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);

    // HUD（てんすう と メッセージ）を うえに かさねる
    const h = this._hud;
    if (h) {
      if (h.よごれ) this._HUDをかく();
      if (h.みえる) {
        this.renderer.autoClear = false;
        this.renderer.render(h.scene, h.cam);
        this.renderer.autoClear = true;
      }
    }
  }

  /** もの1つの フィールドを Mesh に うつす */
  _ものを同期(o) {
    if (!o) return;
    const m = o.__mesh;
    if (!m) return;

    const みえる = o.__いきてる && しんぎ(o.みえる);
    m.visible = みえる;
    if (!みえる) return;

    m.position.set(数にする(o.x, 0), 数にする(o.y, 0), 数にする(o.z, 0));

    const き = o.__きじゅん || { x: 1, y: 1, z: 1 };
    const sx = 数にする(o.よこ, 1) / (き.x || 1);
    const sy = 数にする(o.たかさ, 1) / (き.y || 1);
    const sz = 数にする(o.おくゆき, 1) / (き.z || 1);

    if (o.__かたち === 'かんばん') {
      // かんばんは いつも カメラを むく Sprite。まわらない
      m.scale.set(Math.max(0.0001, 数にする(o.よこ, 1)), Math.max(0.0001, 数にする(o.たかさ, 1)), 1);
    } else {
      m.scale.set(sx || 0.0001, sy || 0.0001, sz || 0.0001);
      // むき は y じく、かたむき は x じく（YXZ の じゅんに かける）
      m.rotation.order = 'YXZ';
      m.rotation.set(ど2ラジ(数にする(o.かたむき, 0)), ど2ラジ(数にする(o.むき, 0)), 0);
    }

    // いろ（や もよう）が かわっていたら つけかえる
    if (o.いろ !== o.__いろ適用) {
      o.__いろ適用 = o.いろ;
      this._いろをつける(o, いろ安全(o.いろ, '#ffffff'));
    }
  }

  /** もの の Mesh（や Group）に いろを つける */
  _いろをつける(o, hex) {
    const m = o.__mesh;
    if (!m) return;
    if (o.__かたち === 'かんばん') {
      if (m.material && m.material.color) m.material.color.set(hex);
      return;
    }
    if (o.__かたち === 'ちめん' && o.__ざいりょう) {
      // ちめんは じぶん専用の ざいりょう（ますめの もようが ついている）
      o.__ざいりょう.color.set(hex);
      return;
    }
    const ざい = this._ざいりょうを取る(hex, o.__もよう);
    if (m.isMesh) {
      m.material = ざい;
      return;
    }
    // Group（プレイヤー や じぶんのモデル）は しるしの ついた ぶひんだけ
    m.traverse((c) => {
      if (c.isMesh && c.__いろつく) c.material = ざい;
    });
  }

  // =========================================================================
  // 15. 入力（キー・マウス・ゆび）
  // =========================================================================

  /** イベントを 1回だけ 登録する */
  attachInput() {
    if (this._入力登録ずみ) return;
    this._入力登録ずみ = true;

    const canvas = this.canvas;
    const win = typeof window !== 'undefined' ? window : null;
    if (!win || !canvas || typeof canvas.addEventListener !== 'function') return;

    // --- キーボード ---
    win.addEventListener('keydown', (e) => {
      this._おとの準備();
      const 名 = キー名にする(e);
      if (!名) return;
      if (['みぎ', 'ひだり', 'うえ', 'した', 'スペース'].includes(名)) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      if (!this._おされてる.has(名)) this._おしたまち.add(名);
      this._おされてる.add(名);
    });
    win.addEventListener('keyup', (e) => {
      const 名 = キー名にする(e);
      if (!名) return;
      this._おされてる.delete(名);
    });
    win.addEventListener('blur', () => {
      this._おされてる.clear();
      this._クリックちゅう = false;
    });

    // --- マウス ---
    canvas.addEventListener('mousemove', (e) => {
      if (this._ポインタロック中) {
        this._みまわしdx += 数にする(e.movementX, 0);
        this._みまわしdy += 数にする(e.movementY, 0);
        return;
      }
      const p = this._画面の位置(e.clientX, e.clientY);
      this._マウスX = p.x;
      this._マウスY = p.y;
    });
    win.addEventListener('mousemove', (e) => {
      // ポインタロック中は canvas から 出ても うごきが とどく
      if (!this._ポインタロック中) return;
      if (e.target === canvas) return;   // 二重に かぞえない
      this._みまわしdx += 数にする(e.movementX, 0);
      this._みまわしdy += 数にする(e.movementY, 0);
    });
    canvas.addEventListener('mousedown', (e) => {
      this._おとの準備();
      const p = this._画面の位置(e.clientX, e.clientY);
      this._マウスX = p.x;
      this._マウスY = p.y;
      this._クリックちゅう = true;
      this._クリックまち = true;
      // 画面を クリックしたら マウスで 見まわせるように する
      if (this._マウスでみまわす && !this._ポインタロック中) {
        try {
          if (typeof canvas.requestPointerLock === 'function') canvas.requestPointerLock();
        } catch (err) { /* できなくても こまらない */ }
      }
    });
    win.addEventListener('mouseup', () => { this._クリックちゅう = false; });
    canvas.addEventListener('contextmenu', (e) => {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    });

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerlockchange', () => {
        this._ポインタロック中 = (document.pointerLockElement === canvas);
        if (!this._ポインタロック中) this._クリックちゅう = false;
      });
    }

    // --- ゆび（タブレット）---
    //   画面の ひだり半分を なぞる → あるく
    //   画面の みぎ半分を なぞる → 見まわす
    const タッチ = (e, しゅるい) => {
      this._おとの準備();
      this._タッチ端末 = true;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const list = e.changedTouches || [];

      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const p = this._画面の位置(t.clientX, t.clientY);

        if (しゅるい === 'start') {
          if (p.x < 画面よこ * 0.45 && this._スティック.id === null) {
            this._スティック = { id: t.identifier, cx: p.x, cy: p.y, dx: 0, dy: 0 };
          } else if (this._みまわしタッチ.id === null) {
            this._みまわしタッチ = { id: t.identifier, x: p.x, y: p.y };
            this._マウスX = p.x;
            this._マウスY = p.y;
            this._クリックちゅう = true;
            this._クリックまち = true;
          }
        } else if (しゅるい === 'move') {
          if (t.identifier === this._スティック.id) {
            const R = 70;
            let dx = p.x - this._スティック.cx;
            let dy = p.y - this._スティック.cy;
            const l = Math.hypot(dx, dy);
            if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
            this._スティック.dx = dx / R;
            this._スティック.dy = dy / R;
          } else if (t.identifier === this._みまわしタッチ.id) {
            this._みまわしdx += (p.x - this._みまわしタッチ.x) * 1.8;
            this._みまわしdy += (p.y - this._みまわしタッチ.y) * 1.8;
            this._みまわしタッチ.x = p.x;
            this._みまわしタッチ.y = p.y;
            this._マウスX = p.x;
            this._マウスY = p.y;
          }
        } else {
          if (t.identifier === this._スティック.id) {
            this._スティック = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
          }
          if (t.identifier === this._みまわしタッチ.id) {
            this._みまわしタッチ = { id: null, x: 0, y: 0 };
            this._クリックちゅう = false;
          }
        }
      }
    };
    canvas.addEventListener('touchstart', (e) => タッチ(e, 'start'), { passive: false });
    canvas.addEventListener('touchmove', (e) => タッチ(e, 'move'), { passive: false });
    canvas.addEventListener('touchend', (e) => タッチ(e, 'end'), { passive: false });
    canvas.addEventListener('touchcancel', (e) => タッチ(e, 'end'), { passive: false });
  }

  /** ブラウザの ざひょうを 640x480 の 論理ざひょうに なおす */
  _画面の位置(clientX, clientY) {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
      return { x: 数にする(clientX, 0), y: 数にする(clientY, 0) };
    }
    const r = canvas.getBoundingClientRect();
    const w = r.width || 画面よこ;
    const h = r.height || 画面たて;
    return {
      x: ((数にする(clientX, 0) - r.left) * 画面よこ) / w,
      y: ((数にする(clientY, 0) - r.top) * 画面たて) / h,
    };
  }

  // =========================================================================
  // 16. 音（WebAudio で その場で つくる。音源ファイルは なし）
  // =========================================================================

  /** さいしょの ユーザー操作の ときだけ AudioContext を つくる */
  _おとの準備() {
    if (this._audio) {
      if (this._audio.state === 'suspended' && typeof this._audio.resume === 'function') {
        try { this._audio.resume(); } catch (e) { /* 何もしない */ }
      }
      return this._audio;
    }
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this._audio = new AC();
    } catch (e) {
      this._audio = null;
    }
    return this._audio;
  }

  /** 音を ならす。ピコ / ドン / キラン / ジャン / ボヨン */
  _おとをならす(なまえ) {
    const ac = this._audio;   // まだ 準備できて いなければ だまって 何もしない
    if (!ac) return;
    const いま = ac.currentTime;

    const ならす = (かたち, しゅうはすう, はじまり, ながさ, おおきさ, おわり) => {
      try {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = かたち;
        osc.frequency.setValueAtTime(しゅうはすう, いま + はじまり);
        if (おわり !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, おわり), いま + はじまり + ながさ);
        }
        gain.gain.setValueAtTime(0.0001, いま + はじまり);
        gain.gain.exponentialRampToValueAtTime(おおきさ, いま + はじまり + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, いま + はじまり + ながさ);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(いま + はじまり);
        osc.stop(いま + はじまり + ながさ + 0.02);
      } catch (e) {
        /* 音が 出なくても ゲームは とめない */
      }
    };

    switch (なまえ) {
      case 'ピコ':
        ならす('square', 880, 0, 0.07, 0.18);
        ならす('square', 1320, 0.06, 0.09, 0.16);
        break;
      case 'ドン':
        ならす('sine', 160, 0, 0.22, 0.35, 45);
        ならす('triangle', 90, 0, 0.18, 0.2, 40);
        break;
      case 'キラン':
        ならす('triangle', 1046, 0.0, 0.09, 0.14);
        ならす('triangle', 1568, 0.06, 0.09, 0.13);
        ならす('triangle', 2093, 0.12, 0.16, 0.12);
        break;
      case 'ジャン':
        ならす('sawtooth', 523, 0, 0.5, 0.1);
        ならす('sawtooth', 659, 0, 0.5, 0.09);
        ならす('sawtooth', 784, 0, 0.55, 0.09);
        break;
      case 'ボヨン':
        ならす('sine', 220, 0, 0.14, 0.22, 640);
        ならす('sine', 640, 0.13, 0.16, 0.18, 180);
        break;
      default:
        break;
    }
  }

  /** ログに 出す（onLog で 落ちないように つつむ） */
  _ログ(s) {
    try { this.onLog(s); } catch (e) { /* 何もしない */ }
  }

  // =========================================================================
  // 17. 組み込みことば（SPEC 5章 と 7章）
  // =========================================================================

  /**
   * lang.js に わたす { 日本語名: 関数 } を かえす。
   * 関数で ない もの（プレイヤー・ちめん）も 入れてよい。
   * それらは lang.js で「さいしょから ある へんすう」に なる。
   */
  builtins() {
    const G = this;

    // ==================== つくる ====================

    /** はこ(x, y, z, よこ, たかさ, おくゆき) */
    const はこ = (x, y, z, よこ, たかさ, おくゆき) => {
      return G._かたちをつくる('はこ', G._geoはこ, {
        x: すうチェック('はこ', 1, x),
        y: すうチェック('はこ', 2, y),
        z: すうチェック('はこ', 3, z),
        よこ: Math.abs(すうチェック('はこ', 4, よこ)),
        たかさ: Math.abs(すうチェック('はこ', 5, たかさ)),
        おくゆき: Math.abs(すうチェック('はこ', 6, おくゆき)),
      });
    };

    /** たま(x, y, z, はんけい) */
    const たま = (x, y, z, はんけい) => {
      const r = Math.abs(すうチェック('たま', 4, はんけい));
      return G._かたちをつくる('たま', G._geoたま, {
        x: すうチェック('たま', 1, x),
        y: すうチェック('たま', 2, y),
        z: すうチェック('たま', 3, z),
        よこ: r * 2, たかさ: r * 2, おくゆき: r * 2,
      });
    };

    /** つつ(x, y, z, はんけい, たかさ) */
    const つつ = (x, y, z, はんけい, たかさ) => {
      const r = Math.abs(すうチェック('つつ', 4, はんけい));
      const h = Math.abs(すうチェック('つつ', 5, たかさ));
      return G._かたちをつくる('つつ', G._geoつつ, {
        x: すうチェック('つつ', 1, x),
        y: すうチェック('つつ', 2, y),
        z: すうチェック('つつ', 3, z),
        よこ: r * 2, たかさ: h, おくゆき: r * 2,
      });
    };

    /** かんばん(x, y, z, もじ) いつも カメラを むく 文字の 板 */
    const かんばん = (x, y, z, もじ) => {
      const xx = すうチェック('かんばん', 1, x);
      const yy = すうチェック('かんばん', 2, y);
      const zz = すうチェック('かんばん', 3, z);
      const t = もじチェック('かんばん', 4, もじ);
      const k = G._かんばんをつくる(t);
      if (G.scene) G.scene.add(k.sprite);
      return G._ものをつくる({
        x: xx, y: yy, z: zz,
        よこ: k.よこ, たかさ: k.たかさ, おくゆき: k.よこ,
        いろ: '#ffffff',
        __かたち: 'かんばん',
        __mesh: k.sprite,
        __きじゅん: { x: 1, y: 1, z: 1 },
        __もじ: t,
      });
    };

    /** じぶんのモデル(x, y, z, なまえ) モデリング部屋で つくった もの */
    const じぶんのモデル = (x, y, z, なまえ) => {
      const xx = すうチェック('じぶんのモデル', 1, x);
      const yy = すうチェック('じぶんのモデル', 2, y);
      const zz = すうチェック('じぶんのモデル', 3, z);
      const n = もじチェック('じぶんのモデル', 4, なまえ);
      const m = G._モデルをよむ(n);
      if (G.scene) G.scene.add(m.group);
      return G._ものをつくる({
        x: xx, y: yy, z: zz,
        よこ: m.よこ, たかさ: m.たかさ, おくゆき: m.おくゆき,
        いろ: m.いろ,
        __かたち: 'モデル',
        __mesh: m.group,
        __きじゅん: { x: m.よこ, y: m.たかさ, z: m.おくゆき },
        __モデルめい: n,
        __モデルぶひん: m.ぶひん,
        __もとしせい: m.もとしせい,
      });
    };

    /** けす(もの) */
    const けす = (もの) => {
      const o = ものチェック('けす', もの);
      o.__いきてる = false;
      o.みえる = false;
      if (o.__mesh) {
        if (o.__mesh.visible !== undefined) o.__mesh.visible = false;
        if (G.scene) { try { G.scene.remove(o.__mesh); } catch (e) { /* 何もしない */ } }
      }
      const i = G.もの一覧.indexOf(o);
      if (i >= 0) G.もの一覧.splice(i, 1);
      return null;
    };

    /**
     * ぜんぶけす() ユーザーが つくった ものを ぜんぶ けす。
     * プレイヤー と ちめん は のこす（けしたい ときは プレイヤーをけす()）。
     */
    const ぜんぶけす = () => {
      const のこす = [];
      for (const o of G.もの一覧.slice()) {
        if (o === G.プレイヤー || o === G.ちめん) { のこす.push(o); continue; }
        o.__いきてる = false;
        if (o.__mesh) {
          if (o.__mesh.visible !== undefined) o.__mesh.visible = false;
          if (G.scene) { try { G.scene.remove(o.__mesh); } catch (e) { /* 何もしない */ } }
        }
      }
      G.もの一覧 = のこす;
      G._上限警告ずみ = false;
      return null;
    };

    // ==================== うごかす ====================

    /** うごかす(もの, x, y, z) いまの ばしょから ずらす */
    const うごかす = (もの, x, y, z) => {
      const o = ものチェック('うごかす', もの);
      o.x = 数にする(o.x, 0) + すうチェック('うごかす', 2, x);
      o.y = 数にする(o.y, 0) + すうチェック('うごかす', 3, y);
      o.z = 数にする(o.z, 0) + すうチェック('うごかす', 4, z);
      return null;
    };

    /** おく(もの, x, y, z) その ばしょに する */
    const おく = (もの, x, y, z) => {
      const o = ものチェック('おく', もの);
      o.x = すうチェック('おく', 2, x);
      o.y = すうチェック('おく', 3, y);
      o.z = すうチェック('おく', 4, z);
      return null;
    };

    /**
     * むいている ほうへ うごかす どうぐ。
     * むき = 0 の とき まえ は -z（SPEC 2章）。
     *   まえ  = (-sin, 0, -cos)
     *   みぎ  = ( cos, 0, -sin)
     */
    const むきへうごかす = (ことば, もの, n, まえ倍, みぎ倍) => {
      const o = ものチェック(ことば, もの);
      const d = すうチェック(ことば, 2, n);
      const r = ど2ラジ(数にする(o.むき, 0));
      const s = Math.sin(r), c = Math.cos(r);
      o.x = 数にする(o.x, 0) + (-s * まえ倍 + c * みぎ倍) * d;
      o.z = 数にする(o.z, 0) + (-c * まえ倍 - s * みぎ倍) * d;
      return null;
    };

    const まえへ = (もの, n) => むきへうごかす('まえへ', もの, n, 1, 0);
    const うしろへ = (もの, n) => むきへうごかす('うしろへ', もの, n, -1, 0);
    const みぎへ = (もの, n) => むきへうごかす('みぎへ', もの, n, 0, 1);
    const ひだりへ = (もの, n) => むきへうごかす('ひだりへ', もの, n, 0, -1);

    const うえへ = (もの, n) => {
      const o = ものチェック('うえへ', もの);
      o.y = 数にする(o.y, 0) + すうチェック('うえへ', 2, n);
      return null;
    };
    const したへ = (もの, n) => {
      const o = ものチェック('したへ', もの);
      o.y = 数にする(o.y, 0) - すうチェック('したへ', 2, n);
      return null;
    };

    /** まわす(もの, ど) いまの むきから ど だけ 左右に まわす */
    const まわす = (もの, ど) => {
      const o = ものチェック('まわす', もの);
      o.むき = 数にする(o.むき, 0) + すうチェック('まわす', 2, ど);
      return null;
    };

    /** かたむける(もの, ど) いまの かたむきから ど だけ 前後に たおす */
    const かたむける = (もの, ど) => {
      const o = ものチェック('かたむける', もの);
      o.かたむき = 数にする(o.かたむき, 0) + すうチェック('かたむける', 2, ど);
      return null;
    };

    /** むける(もの, ど) むきを その 角度に する */
    const むける = (もの, ど) => {
      const o = ものチェック('むける', もの);
      o.むき = すうチェック('むける', 2, ど);
      return null;
    };

    /** むかせる(もの, あいて) あいての ほうを むかせる */
    const むかせる = (もの, あいて) => {
      const o = ものチェック('むかせる', もの);
      const a = ものチェック('むかせる', あいて);
      const dx = 数にする(a.x, 0) - 数にする(o.x, 0);
      const dz = 数にする(a.z, 0) - 数にする(o.z, 0);
      if (dx === 0 && dz === 0) return null;
      o.むき = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      return null;
    };

    // ==================== みため ====================

    /** いろ(もの, いろ) */
    const いろ = (もの, いろな) => {
      const o = ものチェック('いろ', もの);
      o.いろ = いろに直す('いろ', いろな);
      return null;
    };

    /** おおきさ(もの, ばい) さいしょの 大きさの 何ばいに するか */
    const おおきさ = (もの, ばい) => {
      const o = ものチェック('おおきさ', もの);
      const b = すうチェック('おおきさ', 2, ばい);
      if (b < 0) throw エラー('おおきさ の ばい には 0いじょうの すうじを わたしてね');
      o.よこ = 数にする(o.__もとよこ, 1) * b;
      o.たかさ = 数にする(o.__もとたかさ, 1) * b;
      o.おくゆき = 数にする(o.__もとおくゆき, 1) * b;
      return null;
    };

    const かくす = (もの) => {
      ものチェック('かくす', もの).みえる = false;
      return null;
    };
    const みせる = (もの) => {
      ものチェック('みせる', もの).みえる = true;
      return null;
    };

    /** もよう(もの, なまえ) おえかき部屋の 絵を はる */
    const もよう = (もの, なまえ) => {
      const o = ものチェック('もよう', もの);
      const n = もじチェック('もよう', 2, なまえ);
      G._もようをよむ(n);          // ない なまえなら ここで 日本語エラー
      o.__もよう = n;
      o.__いろ適用 = null;          // つぎの えがきで つけなおす
      return null;
    };

    /** そらのいろ(いろ) */
    const そらのいろ = (いろな) => {
      const c = いろに直す('そらのいろ', いろな);
      G._そらのいろ = c;
      if (G.scene) {
        if (G.scene.background && G.scene.background.set) G.scene.background.set(c);
        else G.scene.background = new THREE.Color(c);
        // きりを じぶんで きめて いなければ、そらと おなじ いろに する
        if (G._きりは自動 && G.scene.fog) {
          G._きりのいろ = c;
          G.scene.fog.color.set(c);
        }
      }
      return null;
    };

    /**
     * じめん(いろ, ひろさ) 地面を つくって かえす。
     * さいしょから ある「ちめん」の いろと ひろさを かえて、それを かえす
     * （2まい かさなって チラチラしないように）。
     */
    const じめん = (いろな, ひろさ) => {
      const c = いろに直す('じめん', いろな);
      let w = (ひろさ === undefined) ? 200 : Math.abs(すうチェック('じめん', 2, ひろさ));
      if (w < 1) w = 1;
      let g = G.ちめん;
      if (!g || !g.__いきてる) {
        G._ちめんを作る();
        g = G.ちめん;
      }
      g.いろ = c;
      g.よこ = w;
      g.おくゆき = w;
      g.__もとよこ = w;
      g.__もとおくゆき = w;
      // ますめの もようも ひろさに あわせる
      if (g.__ざいりょう && g.__ざいりょう.map) {
        g.__ざいりょう.map.repeat.set(Math.max(1, w / 4), Math.max(1, w / 4));
      }
      return g;
    };

    /** きり(いろ, こさ) こさは 0〜1 くらい */
    const きり = (いろな, こさ) => {
      const c = いろに直す('きり', いろな);
      let k = (こさ === undefined) ? 0.4 : すうチェック('きり', 2, こさ);
      if (k < 0) k = 0;
      if (k > 4) k = 4;
      G._きりのいろ = c;
      G._きりのこさ = k;
      G._きりは自動 = false;
      if (G.scene) {
        G.scene.fog = new THREE.FogExp2(c, k * G._きりのばい);
      }
      return null;
    };

    // ==================== うごき（物理）====================

    /** じゅうりょく(もの, はい) おちるように する */
    const じゅうりょく = (もの, はい) => {
      const o = ものチェック('じゅうりょく', もの);
      o.__じゅうりょく = しんぎ(はい);
      if (!o.__じゅうりょく) o.__vy = 0;
      return null;
    };

    /** かべにする(もの) 通りぬけ できなくする */
    const かべにする = (もの) => {
      ものチェック('かべにする', もの).__かべ = true;
      return null;
    };

    /** はやさ(もの, x, y, z) はやさを 直接 いれる */
    const はやさ = (もの, x, y, z) => {
      const o = ものチェック('はやさ', もの);
      o.__vx = すうチェック('はやさ', 2, x);
      o.__vy = すうチェック('はやさ', 3, y);
      o.__vz = すうチェック('はやさ', 4, z);
      return null;
    };

    /** ジャンプ(もの, つよさ) ゆかに いるときだけ きく */
    const ジャンプ = (もの, つよさ) => {
      const o = ものチェック('ジャンプ', もの);
      const t = (つよさ === undefined) ? G._ジャンプのつよさ : すうチェック('ジャンプ', 2, つよさ);
      if (!o.__ゆかにいる) return false;
      o.__vy = t;
      o.__ゆかにいる = false;
      return true;
    };

    /** ゆかにいる(もの) */
    const ゆかにいる = (もの) => {
      return ものチェック('ゆかにいる', もの).__ゆかにいる === true;
    };

    // ==================== カメラ ====================

    const カメラをおく = (x, y, z) => {
      const xx = すうチェック('カメラをおく', 1, x);
      const yy = すうチェック('カメラをおく', 2, y);
      const zz = すうチェック('カメラをおく', 3, z);
      G._カメラモード = 'てうち';       // 自動の カメラは やめる
      G._カメラのあいて = null;
      if (G.camera) G.camera.position.set(xx, yy, zz);
      return null;
    };

    const カメラをむける = (x, y, z) => {
      const xx = すうチェック('カメラをむける', 1, x);
      const yy = すうチェック('カメラをむける', 2, y);
      const zz = すうチェック('カメラをむける', 3, z);
      G._カメラモード = 'てうち';
      G._カメラのあいて = null;
      G._カメラ注視もの = null;
      G._カメラ注視 = { x: xx, y: yy, z: zz };
      if (G.camera) G.camera.lookAt(xx, yy, zz);
      return null;
    };

    const カメラをむかせる = (もの) => {
      const o = ものチェック('カメラをむかせる', もの);
      G._カメラモード = 'てうち';
      G._カメラのあいて = null;
      G._カメラ注視 = null;
      G._カメラ注視もの = o;
      return null;
    };

    /** カメラをつける(もの, うしろ, たかさ) 三人称で おいかける */
    const カメラをつける = (もの, うしろ, たかさ) => {
      const o = ものチェック('カメラをつける', もの);
      G._カメラモード = 'ついせき';
      G._カメラのあいて = o;
      G._カメラうしろ = (うしろ === undefined) ? 12 : すうチェック('カメラをつける', 2, うしろ);
      G._カメラたかさ = (たかさ === undefined) ? 6 : すうチェック('カメラをつける', 3, たかさ);
      G._カメラ注視 = null;
      G._カメラ注視もの = null;
      return null;
    };

    /** カメラのなかに(もの) 一人称。その ものは 見えなくなる */
    const カメラのなかに = (もの) => {
      const o = ものチェック('カメラのなかに', もの);
      G._カメラモード = 'いちにんしょう';
      G._カメラのあいて = o;
      G._カメラ注視 = null;
      G._カメラ注視もの = null;
      return null;
    };

    /** マウスでみまわす(はい) 画面を クリックすると マウスで 視点が まわる */
    const マウスでみまわす = (はい) => {
      G._マウスでみまわす = しんぎ(はい);
      if (!G._マウスでみまわす && typeof document !== 'undefined' &&
          document.exitPointerLock && G._ポインタロック中) {
        try { document.exitPointerLock(); } catch (e) { /* 何もしない */ }
      }
      return null;
    };

    /** カメラのむき() いま むいている 左右の 角度（度） */
    const カメラのむき = () => {
      return ((G._カメラむき % 360) + 360) % 360;
    };

    // ==================== しらべる ====================

    const おされてる = (キー) => G._おされてる.has(キー名を直す('おされてる', キー));
    const おした = (キー) => G._おした.has(キー名を直す('おした', キー));

    /** ぶつかってる(A, B) 3D の 箱どうしの かさなり */
    const ぶつかってる = (A, B) => {
      const a = ものチェック('ぶつかってる', A);
      const b = ものチェック('ぶつかってる', B);
      if (!a.__いきてる || !b.__いきてる) return false;
      return かさなる(はこにする(a), はこにする(b));
    };

    /** きょり(A, B) まんなか どうしの きょり（3D） */
    const きょり = (A, B) => {
      const a = ものチェック('きょり', A);
      const b = ものチェック('きょり', B);
      const dx = 数にする(a.x, 0) - 数にする(b.x, 0);
      const dy = 数にする(a.y, 0) - 数にする(b.y, 0);
      const dz = 数にする(a.z, 0) - 数にする(b.z, 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    const マウスX = () => G._マウスX;
    const マウスY = () => G._マウスY;
    const クリックした = () => G._クリックした;
    const クリックちゅう = () => G._クリックちゅう;

    // ==================== すうじ ====================

    const らんすう = (a, b) => {
      let lo = Math.ceil(すうチェック('らんすう', 1, a));
      let hi = Math.floor(すうチェック('らんすう', 2, b));
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    };
    const せいすう = (x) => Math.floor(すうチェック('せいすう', 1, x));
    const ぜったいち = (x) => Math.abs(すうチェック('ぜったいち', 1, x));
    const さいだい = (a, b) =>
      Math.max(すうチェック('さいだい', 1, a), すうチェック('さいだい', 2, b));
    const さいしょう = (a, b) =>
      Math.min(すうチェック('さいしょう', 1, a), すうチェック('さいしょう', 2, b));
    const へいほうこん = (x) => {
      const n = すうチェック('へいほうこん', 1, x);
      if (n < 0) {
        throw エラー('へいほうこん には 0いじょうの すうじを わたしてね（' + n + ' は マイナスです）');
      }
      return Math.sqrt(n);
    };
    const サイン = (ど) => Math.sin(ど2ラジ(すうチェック('サイン', 1, ど)));
    const コサイン = (ど) => Math.cos(ど2ラジ(すうチェック('コサイン', 1, ど)));

    /**
     * かくど(よこ, おくゆき) → 度。
     * `むける(もの, かくど(dx, dz))` と 書くと その ほうを むく。
     * （むき = 0 の とき まえ は -z なので atan2(-dx, -dz)）
     */
    const かくど = (よこ, おくゆき) => {
      const dx = すうチェック('かくど', 1, よこ);
      const dz = すうチェック('かくど', 2, おくゆき);
      let d = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      if (d < 0) d += 360;
      return d;
    };

    // ==================== もじ と リスト ====================

    const つなげる = (...args) => {
      if (args.length > 0 && args.every((a) => Array.isArray(a))) {
        const r = [];
        for (const a of args) r.push(...a);
        return r;
      }
      let s = '';
      for (let i = 0; i < args.length; i++) s += 文字にする(args[i]);
      return s;
    };
    const ながさ = (v) => {
      if (typeof v === 'string') return Array.from(v).length;
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'number') return String(v).length;
      throw エラー('ながさ には もじ か リストを わたしてね（いま わたされたのは ' + 見せる(v) + '）');
    };
    const くわえる = (リスト, もの) => {
      const a = リストチェック('くわえる', 1, リスト);
      a.push(もの === undefined ? null : もの);
      return a;
    };
    const とりのぞく = (リスト, もの) => {
      const a = リストチェック('とりのぞく', 1, リスト);
      const i = a.indexOf(もの === undefined ? null : もの);
      if (i >= 0) a.splice(i, 1);
      return a;
    };

    // ==================== そのた ====================

    const かく = (...args) => {
      G._ログ(args.map((a) => 文字にする(a)).join(' '));
      return null;
    };

    const まつ = (びょう) => {
      let n = すうチェック('まつ', 1, びょう);
      if (n < 0) n = 0;
      if (n > 60) n = 60;
      return { __wait: n };
    };

    const おと = (なまえ) => {
      const 使える = ['ピコ', 'ドン', 'キラン', 'ジャン', 'ボヨン'];
      const s = typeof なまえ === 'string' ? なまえ.trim() : '';
      if (!使える.includes(s)) {
        throw エラー(
          'おと には ' + 使える.join(' ') + ' の どれかを わたしてね' +
            '（いま わたされたのは ' + 見せる(なまえ) + '）'
        );
      }
      G._おとをならす(s);
      return null;
    };

    const てんすう = (n) => {
      G._てんすう = すうチェック('てんすう', 1, n);
      if (G._hud) G._hud.よごれ = true;
      return null;
    };

    const メッセージ = (もじな) => {
      G._メッセージ = もじチェック('メッセージ', 1, もじな);
      if (G._hud) G._hud.よごれ = true;
      return null;
    };

    const とめる = () => {
      G._とまった = true;
      try { G.onStop(); } catch (e) { /* 何もしない */ }
      return null;
    };

    const ゲームしゅうりょう = (もじな) => {
      G._メッセージ = (もじな === undefined)
        ? 'おしまい'
        : もじチェック('ゲームしゅうりょう', 1, もじな);
      if (G._hud) G._hud.よごれ = true;
      とめる();
      return null;
    };

    const じかん = () => G._じかん;

    // ==================== SPEC 7章：プレイヤーまわり ====================

    /** そうさをきる() 自動の そうさを やめる（自分で うごかしたい とき） */
    const そうさをきる = () => {
      G._そうさする = false;
      const p = G.プレイヤー;
      if (p) { p.__vx = 0; p.__vz = 0; }
      return null;
    };

    /** プレイヤーをけす() プレイヤーごと けす（見せるだけの ものを 作るとき） */
    const プレイヤーをけす = () => {
      const p = G.プレイヤー;
      if (p && p.__いきてる) けす(p);
      G._そうさする = false;
      // 自動の カメラは やめて、さいしょの ばしょに もどす
      if (G._カメラモード === 'じどう') {
        G._カメラモード = 'てうち';
        if (G.camera) {
          G.camera.position.set(0, 14, 22);
          G.camera.lookAt(0, 0, 0);
        }
        G._カメラ注視 = { x: 0, y: 0, z: 0 };
      }
      return null;
    };

    /** はやさをかえる(あるく, はしる, ジャンプ) きほんは 14 / 22 / 32 */
    const はやさをかえる = (あるく, はしる, ジャンプ) => {
      if (あるく !== undefined) {
        G._あるくはやさ = Math.abs(すうチェック('はやさをかえる', 1, あるく));
      }
      if (はしる !== undefined) {
        G._はしるはやさ = Math.abs(すうチェック('はやさをかえる', 2, はしる));
      }
      if (ジャンプ !== undefined) {
        G._ジャンプのつよさ = Math.abs(すうチェック('はやさをかえる', 3, ジャンプ));
      }
      return null;
    };

    /** いちにんしょう(はい) 一人称に きりかえる */
    const いちにんしょう = (はい) => {
      const p = G.プレイヤー;
      if (しんぎ(はい)) {
        G._カメラモード = 'いちにんしょう';
        G._カメラのあいて = p;
      } else {
        G._カメラモード = 'じどう';
        G._カメラのあいて = null;
        if (p && p.__mesh) p.__mesh.visible = true;
      }
      return null;
    };

    // ==================== アニメ部屋の アニメ ====================

    /**
     * アニメ(もの, なまえ)
     *   アニメ部屋で つくった うごきを、その ものに させる。
     *   つかえるのは じぶんのモデル() で つくった もの と、
     *   プレイヤーのすがた() で すがたを かえた プレイヤー。
     *   もう べつの アニメが うごいていたら、そちらを やめて さしかえる。
     *   → なし を かえす
     */
    const アニメ = (もの, なまえ) => {
      const o = ものチェック('アニメ', もの);
      const n = もじチェック('アニメ', 2, なまえ);
      const データ = G._アニメをよむ(n);     // ない なまえなら ここで 日本語エラー
      if (!o.__モデルぶひん) {
        throw エラー(
          'アニメ は じぶんのモデル() で つくった ものか、' +
            'プレイヤーのすがた() で すがたを かえた プレイヤーに つかってね' +
            '（はこ() や たま() には つかえません）'
        );
      }
      if (o.__アニメ) G._しせいをもどす(o);  // まえの アニメを やめて もとの かたちに
      o.__アニメ = { なまえ: n, データ: データ, じかん: 0 };
      return null;
    };

    /**
     * アニメをとめる(もの)
     *   さいせいを やめて、もとの しせいに もどす。
     *   うごいて いなくても おこられない。
     *   → なし を かえす
     */
    const アニメをとめる = (もの) => {
      const o = ものチェック('アニメをとめる', もの);
      o.__アニメ = null;
      G._しせいをもどす(o);
      return null;
    };

    /**
     * プレイヤーのすがた(なまえ)
     *   プレイヤーの 見ためだけを、モデリング部屋で つくった モデルに 入れかえる。
     *   当たり判定・じゅうりょく・カメラ・WASD の そうさは これまで どおり きく。
     *   ・当たり判定の 箱は、モデル ぜんたいを かこむ 大きさに あわせる
     *   ・足もとが いままでと おなじ たかさ（地面なら y=0）に くるように おきなおす
     *   ・もとから ある 腕・脚の ふりは ここで やめる（歩きは アニメ() で つける）
     *   → すがたを かえた プレイヤー（もの）を かえす
     */
    const プレイヤーのすがた = (なまえ) => {
      const n = もじチェック('プレイヤーのすがた', 1, なまえ);
      const p = G.プレイヤー;
      if (!p) throw エラー('プレイヤーが いないので すがたを かえられません');

      const m = G._モデルをよむ(n);          // ない なまえなら ここで 日本語エラー

      // いまの 足もとの たかさを おぼえておく（足もとを ずらさないため）
      const あしもと = 数にする(p.y, 0) - Math.abs(数にする(p.たかさ, 5)) / 2;

      // ふるい 見ためを はずして、あたらしい ものを つける
      if (p.__mesh && G.scene) {
        try { G.scene.remove(p.__mesh); } catch (e) { /* 何もしない */ }
      }
      m.group.visible = p.__いきてる;        // けされた あとなら 出さない
      if (G.scene) G.scene.add(m.group);

      p.__mesh = m.group;
      p.__かたち = 'モデル';
      p.__うで = null;                       // 腕・脚の ふりを やめる
      p.__あし = null;
      p.__モデルめい = n;
      p.__モデルぶひん = m.ぶひん;
      p.__もとしせい = m.もとしせい;
      p.__アニメ = null;

      // 当たり判定を モデル ぜんたいを かこむ 箱に あわせる
      p.よこ = m.よこ;
      p.たかさ = m.たかさ;
      p.おくゆき = m.おくゆき;
      p.__もとよこ = m.よこ;
      p.__もとたかさ = m.たかさ;
      p.__もとおくゆき = m.おくゆき;
      p.__きじゅん = { x: m.よこ, y: m.たかさ, z: m.おくゆき };

      // いろは モデルの ままに する（あとから いろ() で かえられる）
      p.いろ = m.いろ;
      p.__いろ適用 = m.いろ;

      // 足もとを さっきと おなじ たかさに もどす
      // （モデルは 足もと y=0 めやすで つくるので、これで 地面に ちゃんと 立つ）
      p.y = あしもと + m.たかさ / 2;

      return p;
    };

    // ==================== ぜんぶ まとめる ====================

    const 表 = {
      // つくる
      'はこ': はこ,
      'たま': たま,
      'つつ': つつ,
      'かんばん': かんばん,
      'じぶんのモデル': じぶんのモデル,
      'けす': けす,
      'ぜんぶけす': ぜんぶけす,
      // うごかす
      'うごかす': うごかす,
      'おく': おく,
      'まえへ': まえへ,
      'うしろへ': うしろへ,
      'みぎへ': みぎへ,
      'ひだりへ': ひだりへ,
      'うえへ': うえへ,
      'したへ': したへ,
      'まわす': まわす,
      'かたむける': かたむける,
      'むける': むける,
      'むかせる': むかせる,
      // みため
      'いろ': いろ,
      'おおきさ': おおきさ,
      'かくす': かくす,
      'みせる': みせる,
      'もよう': もよう,
      'そらのいろ': そらのいろ,
      'じめん': じめん,
      'きり': きり,
      // うごき（物理）
      'じゅうりょく': じゅうりょく,
      'かべにする': かべにする,
      'はやさ': はやさ,
      'ジャンプ': ジャンプ,
      'ゆかにいる': ゆかにいる,
      // カメラ
      'カメラをおく': カメラをおく,
      'カメラをむける': カメラをむける,
      'カメラをむかせる': カメラをむかせる,
      'カメラをつける': カメラをつける,
      'カメラのなかに': カメラのなかに,
      'マウスでみまわす': マウスでみまわす,
      'カメラのむき': カメラのむき,
      // しらべる
      'おされてる': おされてる,
      'おした': おした,
      'ぶつかってる': ぶつかってる,
      'きょり': きょり,
      'マウスX': マウスX,
      'マウスY': マウスY,
      'クリックした': クリックした,
      'クリックちゅう': クリックちゅう,
      // すうじ
      'らんすう': らんすう,
      'せいすう': せいすう,
      'ぜったいち': ぜったいち,
      'さいだい': さいだい,
      'さいしょう': さいしょう,
      'へいほうこん': へいほうこん,
      'サイン': サイン,
      'コサイン': コサイン,
      'かくど': かくど,
      // もじ と リスト
      'つなげる': つなげる,
      'ながさ': ながさ,
      'くわえる': くわえる,
      'とりのぞく': とりのぞく,
      // そのた
      'かく': かく,
      'まつ': まつ,
      'おと': おと,
      'てんすう': てんすう,
      'メッセージ': メッセージ,
      'ゲームしゅうりょう': ゲームしゅうりょう,
      'じかん': じかん,
      'とめる': とめる,
      // SPEC 7章：プレイヤー
      'そうさをきる': そうさをきる,
      'プレイヤーをけす': プレイヤーをけす,
      'はやさをかえる': はやさをかえる,
      'いちにんしょう': いちにんしょう,
      // アニメ部屋の アニメ
      'アニメ': アニメ,
      'アニメをとめる': アニメをとめる,
      'プレイヤーのすがた': プレイヤーのすがた,
    };

    // 安全あみ：英語の エラーが 外に もれないように、ぜんぶ つつむ
    const つつんだ表 = {};
    for (const 名 of Object.keys(表)) {
      つつんだ表[名] = つつむ(名, 表[名]);
    }

    // 関数で ない もの（lang.js で「さいしょから ある へんすう」に なる）
    つつんだ表['プレイヤー'] = this.プレイヤー;
    つつんだ表['ちめん'] = this.ちめん;

    return つつんだ表;
  }
}
