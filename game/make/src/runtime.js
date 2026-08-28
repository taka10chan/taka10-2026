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
//   ● ここで投げるエラーは かならず「日本語のメッセージだけ」。
//     何行目かは lang.js がつけてくれるので、ここでは書きません。
//     最後の安全網（つつむ）で、英語のエラーは全部 日本語に直します。
//
//   ● 表記（SPEC2 A）
//       組み込みのことばは「漢字が正式」。ひらがなも今までどおり動きます。
//       builtins() は同じ関数を漢字とひらがなの2つのキーに入れて返します。
//       画面に出す文（エラー・ログ）は、ふつうの日本語（漢字あり・分かち書きなし）。
// ============================================================================

// three.js は web/lib/three.module.js（r169）に あります。CDN は つかいません。
// このファイルは web/make/src/ に あるので、2つ 上の web/ から たどります。
import * as THREE from '../../lib/three.module.js';

// R15 のアバター（SPEC2 C）。15パーツの組み立ては avatar.js が持っています。
import { buildR15, 歩きポーズ } from './avatar.js';

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

/**
 * クローン()で ワールドに出せる ものの上限（SPEC2 H-2）。
 * 弾を出しっぱなしにしても 画面が止まらないように、ここで打ち止めにします。
 */
const クローンの上限 = 2000;

/** もの の 場所（SPEC2 H-1）。'ワールド'（既定）か '倉庫' */
const 場所のワールド = 'ワールド';
const 場所の倉庫 = '倉庫';

/** これより もの が おおいときは、ちかい かべ だけ しらべる（SPEC 4章） */
const グリッドを使う数 = 300;

/** 当たり判定の グリッドの ますの 大きさ */
const ますの大きさ = 24;

/** 文字を かくときの フォント（日本語が 出る ものを ならべる） */
const フォント =
  '"Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", ' +
  '"Yu Gothic", "Meiryo", sans-serif';

/** 色の名前 → 色コードの表（SPEC2 A-5。漢字が正式） */
const 色の表 = {
  赤: '#ff4d4d',
  青: '#4d7dff',
  緑: '#3fd45f',
  黄: '#ffe14d',
  白: '#ffffff',
  黒: '#222428',
  水色: '#5fd8ff',
  ピンク: '#ff7fc4',
  オレンジ: '#ff9a3c',
  紫: '#b06cff',
  灰色: '#9aa5b1',
  茶色: '#a56b3c',
  紺: '#26356e',
};

/** 色のひらがな別名（今までどおり動く。消してはいけない） */
const 色の別名 = {
  あか: '赤', あお: '青', みどり: '緑', きいろ: '黄', 黄色: '黄',
  しろ: '白', くろ: '黒', みずいろ: '水色', むらさき: '紫',
  はいいろ: '灰色', 灰いろ: '灰色', ちゃいろ: '茶色', 茶いろ: '茶色', こん: '紺',
};

/** キー名（漢字が正式） → KeyboardEvent.code の対応 */
const キーの表 = {
  右: ['ArrowRight'],
  左: ['ArrowLeft'],
  上: ['ArrowUp'],
  下: ['ArrowDown'],
  スペース: ['Space'],
  エンター: ['Enter', 'NumpadEnter'],
  シフト: ['ShiftLeft', 'ShiftRight'],
};

/** キー名のひらがな別名（今までどおり動く） */
const キーの別名 = {
  みぎ: '右', ひだり: '左', うえ: '上', した: '下',
  みぎキー: '右', ひだりキー: '左', うえキー: '上', したキー: '下',
  すぺーす: 'スペース', えんたー: 'エンター', しふと: 'シフト',
};

/**
 * 「もの」の見えるフィールド（SPEC2 A-6）。漢字が正式、ひらがなも動く。
 * 中では ひらがなの名前にしまって、漢字の名前は出し入れの窓口にします。
 */
const フィールドの別名 = {
  横: 'よこ',
  高さ: 'たかさ',
  奥行き: 'おくゆき',
  色: 'いろ',
  向き: 'むき',
  傾き: 'かたむき',
  見える: 'みえる',
};

// ---------------------------------------------------------------------------
// ひらがな・カタカナ・漢字を そろえる（SPEC2 F）
//
//   「ハコ」と「はこ」は同じもの。名前を探すときは2段階にします。
//     1. まず そのままの字で探す（速い。ふつうはここで見つかる）
//     2. 見つからなければ「そろえた形」で探す
//   そろえた形 ＝ 半角カタカナを全角に直し、カタカナをひらがなに直したもの。
//   長音符「ー」はそのまま。「ヴ」は「ゔ」。「ヷヸヹヺ」はそのまま。
// ---------------------------------------------------------------------------

/** 半角カタカナ → 全角カタカナ（濁点・半濁点はくっつける） */
const 半角カナのならび = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ｡｢｣､･';
const 全角カナのならび = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー。「」、・';

/** 濁点が つけられる かな（つけると 1つ うしろの 字に なる） */
const 濁点がつく = 'ウカキクケコサシスセソタチツテトハヒフヘホ';
/** 半濁点が つけられる かな（つけると 2つ うしろの 字に なる） */
const 半濁点がつく = 'ハヒフヘホ';

function 半角カナを全角に(s) {
  let 出 = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const い = 半角カナのならび.indexOf(c);
    let 字 = (い >= 0) ? 全角カナのならび[い] : c;
    const つぎ = s[i + 1];
    if (つぎ === 'ﾞ' || つぎ === '゛') {
      if (字 === 'ウ') { 字 = 'ヴ'; i++; }
      else if (濁点がつく.indexOf(字) >= 0) { 字 = String.fromCharCode(字.charCodeAt(0) + 1); i++; }
    } else if (つぎ === 'ﾟ' || つぎ === '゜') {
      if (半濁点がつく.indexOf(字) >= 0) { 字 = String.fromCharCode(字.charCodeAt(0) + 2); i++; }
    }
    出 += 字;
  }
  return 出;
}

/**
 * 名前を「そろえた形」にする。
 * 半角カタカナを全角に直してから、カタカナをひらがなに直す。
 * 前後の空白は取る。文字列でなければ空文字。
 */
function そろえる(s) {
  if (typeof s !== 'string') return '';
  const t = 半角カナを全角に(s).trim();
  let 出 = '';
  for (const ch of t) {
    const c = ch.codePointAt(0);
    // ァ(30A1) 〜 ヶ(30F6) だけ ひらがなに する。ヷヸヹヺ と ー は そのまま
    if (c >= 0x30a1 && c <= 0x30f6) 出 += String.fromCodePoint(c - 0x60);
    else 出 += ch;
  }
  return 出;
}

/** { そろえた形: 正式な名前 } の索引を作る */
function そろえ索引を作る(正式の表, 別名の表) {
  const 索引 = Object.create(null);
  for (const k of Object.keys(正式の表)) 索引[そろえる(k)] = k;
  for (const k of Object.keys(別名の表 || {})) 索引[そろえる(k)] = 別名の表[k];
  return 索引;
}

const 色のそろえ索引 = そろえ索引を作る(色の表, 色の別名);
const キーのそろえ索引 = そろえ索引を作る(キーの表, キーの別名);

/**
 * 保存されている名前（もよう・モデル・アニメ・ワールドのもの）を、
 * カタカナ・ひらがなの ちがいを こえて 探す。
 * @returns {string|null} 見つかった 本当のキー
 */
function 名前をさがす(表, なまえ) {
  if (!表 || typeof なまえ !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(表, なまえ)) return なまえ;
  const s = なまえ.trim();
  if (s !== なまえ && Object.prototype.hasOwnProperty.call(表, s)) return s;
  const そ = そろえる(なまえ);
  if (そ === '') return null;
  for (const k of Object.keys(表)) {
    if (そろえる(k) === そ) return k;
  }
  return null;
}

/** Map から 同じように 探す */
function 名前をさがすMap(表, なまえ) {
  if (!表 || typeof なまえ !== 'string') return null;
  if (表.has(なまえ)) return なまえ;
  const s = なまえ.trim();
  if (表.has(s)) return s;
  const そ = そろえる(なまえ);
  if (そ === '') return null;
  for (const k of 表.keys()) {
    if (そろえる(k) === そ) return k;
  }
  return null;
}

/**
 * R15 の 15パーツのならび（SPEC2 C-2）。
 * アニメ部屋の track.part の 0〜14 が この順番に対応します。
 */
const R15のならび = [
  '頭', '上胴', '下胴',
  '右上腕', '右前腕', '右手',
  '左上腕', '左前腕', '左手',
  '右腿', '右脛', '右足',
  '左腿', '左脛', '左足',
];

/** 色(プレイヤー, "赤") で色が変わるパーツ（頭・手・足はそのまま） */
const R15のいろがつく = [
  '上胴', '下胴',
  '右上腕', '右前腕', '左上腕', '左前腕',
  '右腿', '右脛', '左腿', '左脛',
];

/** プレイヤーの 見ための いろ */
const はだいろ = '#f2c9a0';
const シャツのいろ = '#3a7ad6';
const ズボンのいろ = '#37414d';

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

/** 値をエラーの文で見せる（長すぎたら切る） */
function 見せる(v) {
  if (v === null || v === undefined) return 'なし';
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '数ではないもの';
    if (!Number.isFinite(v)) return (v > 0) ? '大きすぎる数' : '小さすぎる数';
    return String(v);
  }
  if (typeof v === 'string') {
    const s = v.length > 20 ? v.slice(0, 20) + '…' : v;
    return '「' + s + '」';
  }
  if (Array.isArray(v)) return 'リスト';
  if (v && v.__もの) return 'もの';
  if (typeof v === 'function') return '手順';
  return 'よく分からないもの';
}

/** 引数の位置を日本語で（1 → 「1つ目」） */
function ばんめ(i) {
  return i + 'つ目';
}

// ---------------------------------------------------------------------------
// 使い方の表（エラーの文の「→ 使い方: …」に出す。SPEC2 A-7）
// ---------------------------------------------------------------------------

const 使い方の表 = {
  '箱': '箱(x, y, z, 横, 高さ, 奥行き)',
  '玉': '玉(x, y, z, 半径)',
  '筒': '筒(x, y, z, 半径, 高さ)',
  '看板': '看板(x, y, z, 文字)',
  '自分のモデル': '自分のモデル(x, y, z, 名前)',
  '消す': '消す(もの)',
  '動かす': '動かす(もの, x, y, z)',
  '置く': '置く(もの, x, y, z)',
  '前へ': '前へ(もの, 数)',
  '後ろへ': '後ろへ(もの, 数)',
  '右へ': '右へ(もの, 数)',
  '左へ': '左へ(もの, 数)',
  '上へ': '上へ(もの, 数)',
  '下へ': '下へ(もの, 数)',
  '回す': '回す(もの, 度)',
  '傾ける': '傾ける(もの, 度)',
  '向ける': '向ける(もの, 度)',
  '向かせる': '向かせる(もの, 相手)',
  '色': '色(もの, "赤")',
  '大きさ': '大きさ(もの, 倍)',
  '隠す': '隠す(もの)',
  '見せる': '見せる(もの)',
  '模様': '模様(もの, 名前)',
  '空の色': '空の色("水色")',
  '地面を作る': '地面を作る("緑", 広さ)',
  '霧': '霧("白", 濃さ)',
  '重力': '重力(もの, はい)',
  '壁にする': '壁にする(もの)',
  '速さ': '速さ(もの, x, y, z)',
  'ジャンプ': 'ジャンプ(もの, 強さ)',
  '床にいる': '床にいる(もの)',
  'カメラを置く': 'カメラを置く(x, y, z)',
  'カメラを向ける': 'カメラを向ける(x, y, z)',
  'カメラを向かせる': 'カメラを向かせる(もの)',
  'カメラを付ける': 'カメラを付ける(もの, 後ろ, 高さ)',
  'カメラの中に': 'カメラの中に(もの)',
  '押されてる': '押されてる("右")',
  '押した': '押した("スペース")',
  'ぶつかってる': 'ぶつかってる(A, B)',
  '距離': '距離(A, B)',
  '乱数': '乱数(1, 6)',
  '整数': '整数(x)',
  '絶対値': '絶対値(x)',
  '最大': '最大(a, b)',
  '最小': '最小(a, b)',
  '平方根': '平方根(x)',
  'サイン': 'サイン(度)',
  'コサイン': 'コサイン(度)',
  '角度': '角度(横, 奥行き)',
  '長さ': '長さ(文字かリスト)',
  '加える': '加える(リスト, もの)',
  '取り除く': '取り除く(リスト, もの)',
  '待つ': '待つ(秒)',
  '音': '音("ピコ")',
  '点数': '点数(数)',
  'メッセージ': 'メッセージ("文字")',
  'ゲーム終了': 'ゲーム終了("文字")',
  'アニメ': 'アニメ(もの, 名前)',
  'アニメを止める': 'アニメを止める(もの)',
  'プレイヤーの姿': 'プレイヤーの姿(名前)',
  '速さを変える': '速さを変える(歩く, 走る, ジャンプ)',
  '一人称': '一人称(はい)',
  '探す': '探す("名前")',
  'クローン': 'クローン(もの)',
  'プレイヤーの向き': 'プレイヤーの向き()',
};

/** 「→ 使い方: …」の一行を作る（分からなければ空文字） */
function 使い方(ことば) {
  const u = 使い方の表[ことば];
  return u ? '\n  → 使い方: ' + u : '';
}

/** 引数が足りないときの決まり文句 */
function たりない(ことば, い) {
  return エラー(
    '「' + ことば + '」に渡すものが足りません（' + い + 'つ目がありません）。' + 使い方(ことば)
  );
}

// ---------------------------------------------------------------------------
// 引数のチェック（だめなら全部 日本語のエラー）
// ---------------------------------------------------------------------------

/** 「もの」かどうか調べる */
function ものチェック(ことば, v, い) {
  if (v && typeof v === 'object' && v.__もの === true) return v;
  if (v === undefined) throw たりない(ことば, い || 1);
  throw エラー(
    '「' + ことば + '」には「もの」を渡してください。' +
      '箱() や 玉() が返すものです（渡されたのは ' + 見せる(v) + '）。' + 使い方(ことば)
  );
}

/** 数にする。文字でも数にできるならしてあげる */
function すうチェック(ことば, い, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v === undefined) throw たりない(ことば, い);
  if (typeof v === 'boolean') {
    throw エラー(
      '「' + ことば + '」の' + ばんめ(い) + 'には数を渡してください。' +
        見せる(v) + ' は数ではありません。' + 使い方(ことば)
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
    '「' + ことば + '」の' + ばんめ(い) + 'には数を渡してください。' +
      見せる(v) + ' は数にできません。' + 使い方(ことば)
  );
}

/** 文字にする（数や はい・いいえ も文字にしてあげる） */
function もじチェック(ことば, い, v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v === true) return 'はい';
  if (v === false) return 'いいえ';
  if (v === null || v === undefined) return '';
  throw エラー(
    '「' + ことば + '」の' + ばんめ(い) + 'には文字を渡してください。' +
      見せる(v) + ' は文字にできません。' + 使い方(ことば)
  );
}

/** リストかどうか */
function リストチェック(ことば, い, v) {
  if (Array.isArray(v)) return v;
  if (v === undefined) throw たりない(ことば, い);
  throw エラー(
    '「' + ことば + '」の' + ばんめ(い) + 'にはリストを渡してください。' +
      '[1, 2, 3] のように書くとリストになります（渡されたのは ' + 見せる(v) + '）。' + 使い方(ことば)
  );
}

/**
 * 色の名前や色コードを #rrggbb に直す。だめなら日本語のエラー。
 * 漢字・ひらがな・カタカナ、どれでも通す（SPEC2 F）。
 */
function いろに直す(ことば, v) {
  const c = 色コードにする(v);
  if (c) return c;
  if (v === undefined) throw たりない(ことば, 1);
  throw エラー(
    '「' + ことば + '」には色の名前を渡してください。使えるのは ' +
      Object.keys(色の表).join(' ') + ' か #ff0000 のような書き方です' +
      '（渡されたのは ' + 見せる(v) + '）。' + 使い方(ことば)
  );
}

/** 色の名前・色コードを #rrggbb に直す。分からなければ null */
function 色コードにする(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  // 1段階目: そのままの字で探す
  if (Object.prototype.hasOwnProperty.call(色の表, s)) return 色の表[s];
  if (Object.prototype.hasOwnProperty.call(色の別名, s)) return 色の表[色の別名[s]];
  if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)) return s;
  // 2段階目: そろえた形（カタカナ→ひらがな）で探す
  const そ = 色のそろえ索引[そろえる(s)];
  if (そ) return 色の表[そ];
  return null;
}

/** どんな値が来ても色にする（描くときに使う。絶対に落ちない） */
function いろ安全(v, きめた値) {
  const c = 色コードにする(v);
  if (c) return c;
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
    if (Number.isNaN(v)) return '数ではないもの';
    if (!Number.isFinite(v)) return (v > 0) ? '大きすぎる数' : '小さすぎる数';
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
  if (typeof v === 'function') return '(手順)';
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

/** 使えるキーの一覧（エラーの文に出す） */
const キーの案内 = '右 左 上 下 スペース エンター シフト か A〜Z、0〜9 が使えます';

/**
 * 使う人が書いたキー名を、中で使う名前（漢字）に直す。
 * 漢字・ひらがな・カタカナ、半角カタカナ、どれでも通す（SPEC2 F）。
 */
function キー名を直す(ことば, キー) {
  if (typeof キー !== 'string') {
    if (typeof キー === 'number' && Number.isInteger(キー) && キー >= 0 && キー <= 9) {
      return String(キー);
    }
    if (キー === undefined) throw たりない(ことば, 1);
    throw エラー(
      '「' + ことば + '」にはキーの名前を文字で渡してください。' + キーの案内 +
        '（渡されたのは ' + 見せる(キー) + '）。' + 使い方(ことば)
    );
  }
  const s = 半角カナを全角に(キー)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  // 1段階目: そのままの字で探す
  if (Object.prototype.hasOwnProperty.call(キーの表, s)) return s;
  if (Object.prototype.hasOwnProperty.call(キーの別名, s)) return キーの別名[s];
  if (/^[a-zA-Z]$/.test(s)) return s.toUpperCase();
  if (/^[0-9]$/.test(s)) return s;
  // 2段階目: そろえた形（カタカナ→ひらがな）で探す
  const そ = キーのそろえ索引[そろえる(s)];
  if (そ) return そ;
  throw エラー(
    '「' + ことば + '」に「' + キー + '」というキーはありません。' + キーの案内
  );
}

/**
 * 組み込みのことばをつつんで、
 * 「日本語じゃないエラー」が外に出ないようにする最後の安全網。
 */
function つつむ(名, 関数) {
  const f = function (...args) {
    try {
      return 関数.apply(null, args);
    } catch (e) {
      if (e && e.にほんご) throw e;                  // こちらで作った日本語のエラー
      if (e && e.name === 'KotodamaError') throw e;  // lang.js のエラーはそのまま
      // 英語のエラー（TypeError など）は日本語に言いかえる
      throw エラー(
        '「' + 名 + '」の使い方が違うようです。単語帳で使い方を見てみてください。' + 使い方(名)
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

/**
 * 「もの」に 漢字のフィールド名（横 高さ 奥行き 色 向き 傾き 見える）を つける。
 * 中身は ひらがなの名前1つだけ。漢字は その出し入れの窓口なので、
 * `o.高さ = 3` と書けば `o.たかさ` も 3 になります（SPEC2 A-6）。
 */
function フィールドの別名をつける(o) {
  for (const 漢字 of Object.keys(フィールドの別名)) {
    const かな = フィールドの別名[漢字];
    Object.defineProperty(o, 漢字, {
      enumerable: true,
      configurable: true,
      get() { return this[かな]; },
      set(v) { this[かな] = v; },
    });
  }
}

/**
 * ワールドのものの名前が、変数として使える形か（SPEC2 B-3）。
 * 空白・記号・数字はじまりは だめ。ひらがな・カタカナ・漢字・英数字は よい。
 * （ふだんは画面側が守っていますが、こわれたデータでも落ちないように ここでも見ます）
 */
function 使える名前か(s) {
  if (typeof s !== 'string' || s === '') return false;
  if (s === '__proto__' || s === 'constructor' || s === 'prototype') return false;
  if (/^[0-9０-９]/.test(s)) return false;
  return /^[A-Za-z_0-9々〆ーぁ-ゖァ-ヺ一-鿿豈-﫿]+$/.test(s);
}

/**
 * さくひんの `場所` を、中で使う名前に直す（SPEC2 H-1）。
 * 「倉庫」（ひらがな・カタカナも可）だけが倉庫。
 * 書いてなければ「ワールド」＝ 今までどおり（古いデータでもこわれない）。
 */
function 場所を直す(v) {
  if (typeof v !== 'string') return 場所のワールド;
  const s = v.trim();
  if (s === 場所の倉庫) return 場所の倉庫;
  const そ = そろえる(s);
  if (そ === 'そうこ') return 場所の倉庫;
  return 場所のワールド;
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
    // マウスのボタンは 0=左 1=中 2=右 の3つに 分ける（SPEC2 E）。
    // 指（タッチ）は 左クリック あつかい。
    this._ボタン中 = [false, false, false];    // いま 押しっぱなし
    this._ボタン待ち = [false, false, false];  // つぎの beginFrame で「押した瞬間」にする
    this._ボタン押した = [false, false, false];// このフレームの「押した瞬間」
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

    /**
     * 触れたとき（SPEC2 B-4）。app.js が入れかえる。
     *   game.onTouch = (もの, 相手) => {}
     * 新しく重なった瞬間に1回だけ呼びます。
     */
    this.onTouch = () => {};

    /**
     * クローンを作ったとき（SPEC2 H-3）。app.js が入れかえる。
     *   game.onClone = (新しいもの, もとのもの) => {}
     * 新しいものを作ったら すぐ呼びます。app.js はこれを受けて、
     * もとのものの「コード」を新しいものにも attach します（自分＝クローン自身）。
     */
    this.onClone = () => {};

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

    // --- ワールド（SPEC2 B）。buildWorld() で 中身が 入る ---
    this.世界のもの = new Map();     // id → もの（edit.js が つかう。SPEC2 D-3）
    this.世界の名前 = new Map();     // 名前 → もの（探す() が つかう）
    this._いま触れてる = new Set();  // このフレーム 重なっている 組み合わせ
    this._まえ触れてた = new Set();  // 1つ まえの フレーム
    this._触れた時刻 = new Map();    // 組み合わせ → さいごに 鳴らした 秒

    // --- クローン（SPEC2 H-2）---
    this._クローン番号 = new Map();  // 名前の根 → つぎに つかう 番号
    this._クローン名 = new Set();    // もう つかった クローンの名前
    this._クローン警告ずみ = false;

    // 入力の「おした しゅんかん」だけ けす（おしっぱなしは のこす）
    this._おした.clear();
    this._おしたまち.clear();
    this._ボタン押した = [false, false, false];
    this._ボタン待ち = [false, false, false];
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

    // ▶ プレイ中かどうか。画面（app.js）が切りかえます。
    // 止まっているとき（＝ものを置いたり動かしたりしているとき）に
    // マウスを掴んでしまうと、ブラウザが「制限されています。Escで解除」と
    // 出してきて、ものを選ぶだけでも じゃまになります。
    this.プレイ中 = false;

    // マウスポインタを「掴む」（ポインタロック）かどうか。
    // 掴むと、ブラウザが「マウスポインターは …に制限されています。
    // Escキーを押すと解除できます」という警告を必ず出します。
    // うっとうしいので、ふだんは掴まず、
    // 「左ボタンを押しながら動かすと見回る」ドラッグ方式にします。
    // 本物のFPSのように動かしたい人だけ マウスを固定(はい) で掴めます。
    this._ポインタ固定 = false;

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
    // プレイヤーの「向き」に こちらから 最後に 書いた値。
    // これと ちがっていたら「使う人が 書きかえた」と わかります
    this._むきを写した = null;

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
   * プレイヤー … ロブロックスの R15 と同じ 15パーツの人（SPEC2 C）。
   * 原点の上（0, 4, 0）に立っています。
   *
   *   組み立ては avatar.js の buildR15() が持っています。
   *   buildR15() の group は「足元が y=0」なので、
   *   ここでは 外側の Group に入れて 高さの半分だけ下げ、
   *   もの の x,y,z（＝まんなか）と合うようにします。
   *
   *   parts の 15個は SPEC2 C-2 の順番（0〜14）で __モデルぶひん に入れます。
   *   こうすると アニメ(プレイヤー, "…") が そのまま効きます。
   */
  _プレイヤーを作る() {
    const R = this._R15のみためを作る();
    const o = this._ものをつくる({
      x: 0, y: 4, z: 0,
      よこ: R.半径 * 2, たかさ: R.高さ, おくゆき: R.半径 * 2,
      いろ: シャツのいろ,
      __かたち: 'プレイヤー',
      __mesh: R.group,
      __きじゅん: { x: R.半径 * 2, y: R.高さ, z: R.半径 * 2 },
      __じゅうりょく: true,
      __プレイヤー: true,
      __だんさ: 1.0,        // これ以下の 段差は のぼれる
      __R15: R.parts,       // 歩きポーズ() に わたす
      __モデルぶひん: R.ぶひん,
      __もとしせい: R.もとしせい,
    });
    this.プレイヤー = o;
  }

  /**
   * R15 の見ためを1体 作って、シーンに入れる。
   * プレイヤーを作るときと、プレイヤーをクローンするときの 両方で使います。
   * @returns {{group, parts, ぶひん, もとしせい, 高さ, 半径}}
   */
  _R15のみためを作る() {
    const A = buildR15({ はだ: はだいろ, シャツ: シャツのいろ, ズボン: ズボンのいろ });
    const parts = (A && A.parts) ? A.parts : {};
    const 高さ = Math.abs(数にする(A && A.高さ, 5)) || 5;
    const 半径 = Math.abs(数にする(A && A.半径, 1)) || 1;

    // 外側の Group。中身を 高さの半分だけ 下げて、まんなかを 原点に合わせる
    const G = new THREE.Group();
    if (A && A.group) {
      A.group.position.y = -高さ / 2;
      G.add(A.group);
      this._しげんをひろう(A.group);
    }

    // 15パーツを SPEC2 C-2 の順番に ならべる（アニメの part 番号 0〜14）
    const ぶひん = [];
    const もとしせい = [];
    for (const 名 of R15のならび) {
      const p = parts[名] || null;
      ぶひん.push(p);
      もとしせい.push(p ? {
        px: p.position.x, py: p.position.y, pz: p.position.z,
        rx: p.rotation.x, ry: p.rotation.y, rz: p.rotation.z,
      } : null);
    }

    // 色(プレイヤー, "赤") で 色が変わるところに 印をつける。
    // 直接の子の Mesh だけ（腕の先の 前腕などは 別のパーツなので さわらない）
    for (const 名 of R15のいろがつく) {
      const p = parts[名];
      if (!p || !p.children) continue;
      for (const c of p.children) {
        if (c && c.isMesh) c.__いろつく = true;
      }
    }

    G.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    if (this.scene) this.scene.add(G);
    return { group: G, parts, ぶひん, もとしせい, 高さ, 半径 };
  }

  /** group の中の geometry / material を 片づけの一覧に入れる（メモリを ふやさない） */
  _しげんをひろう(group) {
    if (!group || typeof group.traverse !== 'function') return;
    const みた = new Set();
    group.traverse((c) => {
      if (c.geometry && !みた.has(c.geometry)) { みた.add(c.geometry); this._しげんにいれる(c.geometry); }
      const m = c.material;
      if (Array.isArray(m)) {
        for (const mm of m) if (mm && !みた.has(mm)) { みた.add(mm); this._しげんにいれる(mm); }
      } else if (m && !みた.has(m)) { みた.add(m); this._しげんにいれる(m); }
    });
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
      // さくひんで 決めた 壁・重力（倉庫にしまっても 消えない。クローンが 使う）
      __かべ設定: false,
      __じゅうりょく設定: false,
      __vx: 0, __vy: 0, __vz: 0,
      __ゆかにいる: false,
      __だんさ: 0,
      // --- アニメ用（じぶんのモデル / プレイヤーのすがた の ときだけ 中身が 入る）---
      __モデルめい: null,
      __モデルぶひん: null,     // parts の ばんごうと おなじ ならびの Mesh
      __もとしせい: null,       // その ぶひんの もとの いち・むき
      __アニメ: null,           // { なまえ, データ, じかん }
      __プレイヤー: false,
      // --- ワールド用（SPEC2 B）---
      __世界id: null,           // さくひんの objects の id
      __名前: null,             // ワールド一覧での 名前
      __触れる: false,          // 「触れたとき」を しらべる 印（コードが 入っていたら true）
      // --- 倉庫と クローン用（SPEC2 H）---
      __場所: 場所のワールド,   // 'ワールド' か '倉庫'
      __コードあり: false,      // さくひんの「コード」が 空でない（クローンにも 写す）
      __もとid: null,           // クローンの もとに なった ものの id
      __クローンの根: null,     // クローンの 名前の もと（たま見本2 → 根は たま見本）
      __もじ: null,             // 看板の 文字
      __id: this._つぎのID++,
    };
    // 漢字の フィールド名（横 高さ 奥行き 色 向き 傾き 見える）を つける。
    // Object.assign より 先に つけて、どちらの つづりで わたされても 通るようにする。
    フィールドの別名をつける(もの);
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

    // 倉庫のものは ワールドに 出さない（SPEC2 H-1）。
    // もの一覧に 入れないので、描くのも・当たり判定も・触れたときも 通りません。
    // それでも「もの」なので、名前でコードから 使えます。
    if (もの.__場所 === 場所の倉庫) {
      // いま効いているぶんだけ 消します。さくひんで決めた 壁・重力（__かべ設定 /
      // __じゅうりょく設定）は のこすので、クローンすると ちゃんと 壁になり 落ちます
      もの.__かべ = false;
      もの.__じゅうりょく = false;
      もの.__触れる = false;
      もの.__vx = 0; もの.__vy = 0; もの.__vz = 0;
      if (もの.__mesh) {
        // まちがえて 見ためが ついてきたら、はずしておく
        if (もの.__mesh.visible !== undefined) もの.__mesh.visible = false;
        if (this.scene) { try { this.scene.remove(もの.__mesh); } catch (e) { /* 何もしない */ } }
        もの.__mesh = null;
      }
      return もの;
    }

    if (this.もの一覧.length >= ものの上限) {
      if (!this._上限警告ずみ) {
        this._上限警告ずみ = true;
        this._ログ(
          '⚠ ものが ' + ものの上限 + '個を超えたので、これ以上は作れません。' +
            'いらなくなったものは 消す() で消してください。'
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
    const いろ = データ.いろ || 色の表.白;
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
    // ひらがな・カタカナのちがいを こえて 探す（SPEC2 F）
    const かぎ = 名前をさがす(表, なまえ);
    const d = (かぎ !== null) ? 表[かぎ] : null;
    if (!d || !d.px || !d.w || !d.h) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」という模様はまだありません。' +
        (ある.length
          ? '今あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です。'
          : '\n  → おえかき部屋で描いてから使ってください')
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
    // ひらがな・カタカナのちがいを こえて 探す（SPEC2 F）
    const かぎ = 名前をさがす(表, なまえ);
    const d = (かぎ !== null) ? 表[かぎ] : null;
    if (!d || !Array.isArray(d.parts)) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」というモデルはまだありません。' +
        (ある.length
          ? '今あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です。'
          : '\n  → モデリング部屋で作ってから使ってください')
      );
    }
    if (d.parts.length === 0) {
      throw エラー('「' + なまえ + '」のモデルには部品が1つもありません。');
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
    // ひらがな・カタカナのちがいを こえて 探す（SPEC2 F）
    const かぎ = 名前をさがす(表, なまえ);
    const d = (かぎ !== null) ? 表[かぎ] : null;
    if (!d || !Array.isArray(d.tracks)) {
      const ある = 表 ? Object.keys(表) : [];
      throw エラー(
        '「' + なまえ + '」というアニメはまだありません。' +
        (ある.length
          ? '今あるのは ' + ある.map((n) => '「' + n + '」').join(' ') + ' です。'
          : '\n  → アニメ部屋で作ってから使ってください')
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
        '「' + なまえ + '」のアニメには動く部品が1つもありません。' +
          '\n  → アニメ部屋でキーを打ってから使ってください'
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
    this._ボタン押した = this._ボタン待ち;
    this._ボタン待ち = [false, false, false];
  }

  /** ユーザーコードの あと。そうさ → 物理 → 触れたとき → 絵 の じゅんばん */
  endFrame() {
    const dt = this._dt || 0;
    try {
      // 使う人が「プレイヤー.向き = 90」と書いていたら、見ている方向も そちらへ。
      // 歩く方向も この向きから 決まるので、いちばん先に 見ます
      this._プレイヤーの向きの書きこみを見る();
      this._じどうそうさ(dt);      // WASD で あるく（SPEC 7章）
      this._ぶつりをすすめる(dt);  // おちる・ぶつかる（SPEC 4章）
      this._アニメ(dt);            // うで と あしを ふる
      this._カメラをすすめる(dt);
      // 見回したあとの 向きを プレイヤーの「向き」に 写す
      this._プレイヤーの向きをあわせる();
    } catch (e) {
      // 物理で 落ちても ゲームは とめない（英語の エラーを 外に 出さない）
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ことだま runtime]', e);
      }
    }

    // 触れたとき（SPEC2 B-4）。ここで 使う人の コードが 動くので、
    // エラーが 出たら いったん おぼえておいて、絵を かいてから 外に 出す。
    let 触れエラー = null;
    try {
      this._触れたをしらべる();
    } catch (e) {
      触れエラー = e;
    }

    try {
      this._えがく();
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ことだま runtime]', e);
      }
    }

    this._おした.clear();
    this._ボタン押した = [false, false, false];
    this._みまわしdx = 0;
    this._みまわしdy = 0;

    if (触れエラー) throw 触れエラー;
  }

  // =========================================================================
  // 9b. 触れたとき（SPEC2 B-4）
  //
  //   毎フレーム重なりを見て、新しく重なった瞬間に1回だけ onTouch を呼びます。
  //   ・「壁」が OFF でも鳴る（すり抜けながら反応できる。コインなど）
  //   ・同じ組み合わせは 0.25秒に1回まで
  //   ・プレイヤーも相手になる
  //
  //   ● 印の付け方（速さのために、呼ぶ側を しぼっています）
  //       `もの.__触れる` が true のものだけが「触れたとき」の持ち主です。
  //       buildWorld() が、さくひんの `コード` が空でないものに付けます。
  //       （app.js / edit.js から `もの.__触れる = true` と書いても増やせます）
  //       相手のほうは しぼりません。プレイヤーでも、コードで作った箱でも、
  //       生きているものなら 何でも相手になります。
  //
  //   ● 速さ
  //       1. `__触れる` が1つも無いフレームは、何もせずに すぐ帰ります。
  //       2. 生きているものを x の小さい順に1回だけ並べます。
  //       3. しらべるのは「__触れる が付いたもの」からだけ。
  //          並べた列の中で x が重なる範囲だけを見ます（スイープ＆プルーン）。
  //       全部の組み合わせは 見ません。
  // =========================================================================

  _触れたをしらべる() {
    if (typeof this.onTouch !== 'function') return;

    // --- 「触れたとき」を持つものが 1つも無ければ、すぐ帰る（いちばん速い道）---
    const 主たち = [];
    for (let i = 0; i < this.もの一覧.length; i++) {
      const o = this.もの一覧[i];
      if (o && o.__いきてる && o.__触れる) 主たち.push(o);
    }
    if (主たち.length === 0) {
      if (this._いま触れてる.size) this._いま触れてる.clear();
      if (this._まえ触れてた.size) this._まえ触れてた.clear();
      return;
    }

    // --- 生きているものを x の小さい順に ならべる ---
    const 一覧 = [];
    for (let i = 0; i < this.もの一覧.length; i++) {
      const o = this.もの一覧[i];
      if (o && o.__いきてる) 一覧.push(o);
    }
    if (一覧.length < 2) return;

    const はこ = new Map();
    let さいだいはば = 0;
    for (const o of 一覧) {
      const b = はこにする(o);
      はこ.set(o, b);
      const w = b.maxX - b.minX;
      if (w > さいだいはば) さいだいはば = w;
    }
    一覧.sort((a, c) => はこ.get(a).minX - はこ.get(c).minX);

    const いま = this._いま触れてる;
    const まえ = this._まえ触れてた;
    const 時刻 = this._じかん;
    const あいだ = 0.25;
    const 出来事 = [];

    for (const S of 主たち) {
      const a = はこ.get(S);
      if (!a) continue;
      // x が重なりうる範囲だけを見る。
      // ならびは minX の順なので、minX が (a.minX - さいだいはば) 以上のところから
      // minX が a.maxX 未満のところまで。
      let lo = 0, hi = 一覧.length;
      const さかい = a.minX - さいだいはば;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (はこ.get(一覧[mid]).minX < さかい) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < 一覧.length; i++) {
        const O = 一覧[i];
        const b = はこ.get(O);
        if (b.minX >= a.maxX) break;      // これより先は x で離れている
        if (O === S) continue;
        if (!かさなる(a, b)) continue;

        const かぎ = S.__id + '>' + O.__id;
        いま.add(かぎ);
        if (まえ.has(かぎ)) continue;      // 前のフレームから ずっと重なっている

        const さいご = this._触れた時刻.get(かぎ);
        if (さいご !== undefined && 時刻 - さいご < あいだ) continue;
        this._触れた時刻.set(かぎ, 時刻);
        出来事.push(S, O);
      }
    }

    // 「まえ」と「いま」を入れかえる（使いまわして ゴミを出さない）
    this._まえ触れてた = いま;
    まえ.clear();
    this._いま触れてる = まえ;

    // 古い記録を そうじする（ずっと遊んでいても ふくらまない）
    if (this._触れた時刻.size > 4000) {
      for (const [k, t] of this._触れた時刻) {
        if (時刻 - t > あいだ * 4) this._触れた時刻.delete(k);
      }
    }

    // 呼ぶのは しらべ終わってから（中で 消す() されても こわれない）
    for (let i = 0; i < 出来事.length; i += 2) {
      const 主 = 出来事[i];
      const 相手 = 出来事[i + 1];
      if (!主.__いきてる) continue;
      this.onTouch(主, 相手);
    }
  }

  // =========================================================================
  // 10. 自動そうさ（コードを 書かなくても うごく）
  // =========================================================================

  _じどうそうさ(dt) {
    const p = this.プレイヤー;
    if (!this._そうさする || !p || !p.__いきてる) return;

    // --- キーと ゆびから 前後（f）と 左右（r）を つくる ---
    let f = 0, r = 0;
    if (this._おされてる.has('W') || this._おされてる.has('上')) f += 1;
    if (this._おされてる.has('S') || this._おされてる.has('下')) f -= 1;
    if (this._おされてる.has('D') || this._おされてる.has('右')) r += 1;
    if (this._おされてる.has('A') || this._おされてる.has('左')) r -= 1;
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
    } else {
      p.__vx = 0;
      p.__vz = 0;
    }
    // むきは ここでは いじりません。
    // 「プレイヤー.向き ＝ 見ている方向」に そろえるので、
    // _プレイヤーの向きをあわせる() が まとめて 面倒を みます

    // --- ジャンプ（ゆかに いるときだけ） ---
    if (this._おされてる.has('スペース') && p.__ゆかにいる) {
      p.__vy = this._ジャンプのつよさ;
      p.__ゆかにいる = false;
    }
  }

  // -------------------------------------------------------------------------
  // プレイヤーの「向き」（SPEC2 の追加。使う人の「プレイヤーの向きってやつも作ってー」）
  //
  //   ● どちらの向きにするか
  //       プレイヤー.向き ＝ **見ている方向**（＝ カメラの向き()）にしました。
  //       進行方向ではありません。理由は3つです:
  //         1. 使う人が この値を ほしがる場面は「弾を飛ばす」
  //            （向ける(たま, プレイヤーの向き())）と「敵をこちらに向かせる」で、
  //            どちらも ほしいのは 見ている方向です。進行方向だと、
  //            立ち止まった瞬間に 何を返せばよいか 決まりません
  //            （最後に歩いた方向が 残るだけで、画面と ずれます）。
  //         2. 進行方向にすると、A キーで 左に歩いただけで 向きが 90度 変わり、
  //            そのまま撃つと 弾が 横に飛びます。見ていて 意味が分かりません。
  //         3. SPEC 2章は「むき = 0 のとき その ものの 前は -z」と決めています。
  //            見ための R15 も この向きを向くので、
  //            「向き」と「モデルの正面」と「前へ() の進む先」が 全部 同じになります。
  //            3つが ばらばらだと、中学生には 追いきれません。
  //       そのかわり 横歩き・後ろ歩きでは 体が そちらを向かず、横に すべります
  //       （ロブロックスの シフトロックと同じ見ためです）。
  //
  //   ● 読むだけでなく 書けます
  //       プレイヤー.向き = 90 と書くと、見ている方向も 90度に なります。
  // -------------------------------------------------------------------------

  /** 角度を 0以上 360未満 に そろえる */
  _むきをそろえる(ど) {
    const d = 数にする(ど, 0);
    if (!Number.isFinite(d)) return 0;
    return ((d % 360) + 360) % 360;
  }

  /**
   * 使う人が プレイヤー.向き に 書きこんでいたら、見ている方向も そちらへ向ける。
   * 毎フレーム いちばん先に 呼びます（歩く方向も この向きから 決まるので）。
   * 変な値（文字・なし・数でないもの）が 入っていたら、今の向きの ままにします。
   */
  _プレイヤーの向きの書きこみを見る() {
    const p = this.プレイヤー;
    if (!p || !p.__いきてる) return;
    const いま = p.むき;
    // まえに こちらから 書いた値と 同じなら、使う人は さわっていない
    if (this._むきを写した !== null && いま === this._むきを写した) return;
    const ど = 数にする(いま, this._カメラむき);
    this._カメラむき = this._むきをそろえる(
      Number.isFinite(ど) ? ど : this._カメラむき
    );
  }

  /** 見ている方向を プレイヤーの「向き」に 写す（見ための R15 も この向きを向きます）*/
  _プレイヤーの向きをあわせる() {
    this._カメラむき = this._むきをそろえる(this._カメラむき);
    const p = this.プレイヤー;
    if (!p || !p.__いきてる) return;
    p.むき = this._カメラむき;
    this._むきを写した = this._カメラむき;
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

    // --- 最初からいる R15 プレイヤーの 歩きポーズ（SPEC2 C-4）---
    //   ・プレイヤーの姿() で見ためを入れかえたら __R15 が消えるので、自然に止まる
    //   ・アニメ(プレイヤー, "…") を入れたら そちらが優先（歩きポーズは止まる）
    const p = this.プレイヤー;
    if (!p || !p.__いきてる || !p.__R15 || p.__アニメ) return;

    const はやさ = Math.hypot(数にする(p.__vx, 0), 数にする(p.__vz, 0));
    if (はやさ > 0.5) {
      // 歩く速さに合わせて、1秒あたりの周回数を変える
      this._あるき位相 += dt * (0.55 + はやさ * 0.085);
      this._あるき位相 -= Math.floor(this._あるき位相);
    } else {
      // 止まったら、まっすぐ立つ姿（t = 0）へ すーっと戻す
      let t = this._あるき位相 - Math.floor(this._あるき位相);
      const さき = (t > 0.5) ? 1 : 0;
      const すすむ = Math.min(Math.abs(さき - t), dt * 2.2);
      t += Math.sign(さき - t) * すすむ;
      this._あるき位相 = t - Math.floor(t);
    }
    try {
      歩きポーズ(p.__R15, this._あるき位相);
    } catch (e) {
      // アバター側でこけても ゲームは止めない
      p.__R15 = null;
    }
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
      if (['右', '左', '上', '下', 'スペース'].includes(名)) {
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
      this._ボタン中 = [false, false, false];
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

      // 掴んでいないときは、左ボタンを押しながら動かすと見回れます。
      // これならブラウザの警告が出ません。
      if (this.プレイ中 && this._マウスでみまわす && this._ボタン中[0]) {
        let dx = 数にする(e.movementX, NaN);
        let dy = 数にする(e.movementY, NaN);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          // movementX が使えないブラウザ用に、前の位置との差で出す
          dx = (this._まえのマウスX == null) ? 0 : (e.clientX - this._まえのマウスX);
          dy = (this._まえのマウスY == null) ? 0 : (e.clientY - this._まえのマウスY);
        }
        this._みまわしdx += dx;
        this._みまわしdy += dy;
      }
      this._まえのマウスX = e.clientX;
      this._まえのマウスY = e.clientY;
    });
    win.addEventListener('mousemove', (e) => {
      // ポインタロック中は canvas から 出ても うごきが とどく
      if (!this._ポインタロック中) return;
      if (e.target === canvas) return;   // 二重に かぞえない
      this._みまわしdx += 数にする(e.movementX, 0);
      this._みまわしdy += 数にする(e.movementY, 0);
    });
    // 左・中・右を きちんと 分ける（SPEC2 E）。e.button は 0=左 1=中 2=右。
    canvas.addEventListener('mousedown', (e) => {
      this._おとの準備();
      const p = this._画面の位置(e.clientX, e.clientY);
      this._マウスX = p.x;
      this._マウスY = p.y;
      const b = (e && typeof e.button === 'number') ? e.button : 0;
      if (b >= 0 && b <= 2) {
        this._ボタン中[b] = true;
        this._ボタン待ち[b] = true;
      }
      // マウスで 見まわせるようにするのは
      //   ・左クリックのときだけ
      //   ・▶ プレイ中のときだけ（止まっているときは ものを選ぶための クリック）
      if (b === 0 && this.プレイ中 && this._マウスでみまわす
          && this._ポインタ固定 && !this._ポインタロック中) {
        try {
          if (typeof canvas.requestPointerLock === 'function') canvas.requestPointerLock();
        } catch (err) { /* できなくても こまらない */ }
      }
    });
    // 離したボタンだけ false にする（左を押しながら右を離しても 左は のこる）
    win.addEventListener('mouseup', (e) => {
      const b = (e && typeof e.button === 'number') ? e.button : 0;
      if (b >= 0 && b <= 2) this._ボタン中[b] = false;
    });
    canvas.addEventListener('contextmenu', (e) => {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    });

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerlockchange', () => {
        this._ポインタロック中 = (document.pointerLockElement === canvas);
        if (!this._ポインタロック中) this._ボタン中 = [false, false, false];
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
            // 指は 左クリック あつかい（SPEC2 E）
            this._ボタン中[0] = true;
            this._ボタン待ち[0] = true;
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
            this._ボタン中[0] = false;
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
  // 16b. ワールドを作る（SPEC2 B-2 / B-3 / B-5）
  //
  //   さくひんの `objects` を 3D に置きます。reset() のすぐあとに呼ばれます。
  //
  //     const 表 = game.buildWorld(objects);   // → { 名前: もの, … }
  //
  //   ● 渡された配列は 1文字も書きかえません（読むだけ）。
  //     遊んだ結果が保存に戻ると、作ったものが壊れるからです（SPEC2 B-7）。
  //   ● おかしなデータ（項目が足りない・知らない形・名前が同じ）でも落ちません。
  //   ● 「見える」が OFF でも 当たり判定は残ります（見えない壁。SPEC2 B-5）。
  // =========================================================================

  /**
   * @param {Array} objects さくひんの objects（SPEC2 B-2 の形）
   * @returns {object} { 名前: もの, … }。コードから名前でそのまま使えます
   */
  buildWorld(objects) {
    const 表 = {};
    if (!Array.isArray(objects)) return 表;

    let 名なし = 0;
    for (let i = 0; i < objects.length; i++) {
      const d = objects[i];
      if (!d || typeof d !== 'object') continue;

      let o = null;
      try {
        o = this._世界のものを1つ作る(d);
      } catch (e) {
        // ここで 落とさない。1つ おかしくても 残りは 置く
        o = null;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ことだま buildWorld]', e);
        }
      }
      if (!o) continue;

      // --- id で 引けるようにする（edit.js が つかう。SPEC2 D-3）---
      let id = (typeof d.id === 'string' && d.id !== '') ? d.id : null;
      if (id === null) id = 'o' + (++名なし) + '-' + o.__id;
      if (this.世界のもの.has(id)) id = id + '#' + o.__id;   // id が かぶっても 消えない
      o.__世界id = id;
      this.世界のもの.set(id, o);

      // --- 名前で 引けるようにする（変数になる。SPEC2 B-3）---
      const 名前 = (typeof d.名前 === 'string') ? d.名前.trim() : '';
      o.__名前 = 名前 || null;
      if (!名前) continue;
      if (!使える名前か(名前)) {
        this._ログ('⚠ 「' + 名前 + '」は名前に使えないので、コードからは名前で呼べません。');
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(表, 名前)) {
        this._ログ('⚠ 「' + 名前 + '」という名前が2つ以上あります。上にあるほうを使います。');
        continue;
      }
      表[名前] = o;
      this.世界の名前.set(名前, o);
    }
    return 表;
  }

  /**
   * objects の1つを 3D の「もの」にする（データは 読むだけ）。
   *
   * `場所` が '倉庫' のものは、見た目も物理も作りません（SPEC2 H-1）。
   * それでも「もの」としては作るので、名前でコードから使えて、
   * クローン() のもとにできます。
   */
  _世界のものを1つ作る(d) {
    const かたち = (typeof d.形 === 'string') ? d.形.trim() : '箱';
    const 場所 = 場所を直す(d.場所);
    const 倉庫か = (場所 === 場所の倉庫);
    const x = 数にする(d.x, 0);
    const y = 数にする(d.y, 0);
    const z = 数にする(d.z, 0);
    let 横 = Math.abs(数にする(d.横, 4));
    let 高さ = Math.abs(数にする(d.高さ, 4));
    let 奥行き = Math.abs(数にする(d.奥行き, 4));
    if (!(横 > 0)) 横 = 0.01;
    if (!(高さ > 0)) 高さ = 0.01;
    if (!(奥行き > 0)) 奥行き = 0.01;
    const 色 = いろ安全(d.色, '#9aa5b1');
    const 向き = 数にする(d.向き, 0);
    const 傾き = 数にする(d.傾き, 0);
    // 「見える」は 書いてなければ 見える。「壁」は 書いてなければ 通れない
    const 見える = (d.見える === undefined) ? true : しんぎ(d.見える);
    const 壁 = (d.壁 === undefined) ? true : しんぎ(d.壁);
    const 重力 = しんぎ(d.重力) && d.重力 !== undefined;
    const コード = (typeof d.コード === 'string') ? d.コード : '';
    const コードあり = コード.trim() !== '';
    const モデル名 = (typeof d.モデル === 'string') ? d.モデル : '';

    const きほん = {
      x, y, z, いろ: 色, むき: 向き, かたむき: 傾き, みえる: 見える,
      __かべ: 壁,
      __じゅうりょく: 重力,
      __かべ設定: 壁,
      __じゅうりょく設定: 重力,
      __場所: 場所,
      __コードあり: コードあり,
      // コードが入っているものだけ「触れたとき」をしらべる（SPEC2 B-4・速さのため）。
      // 倉庫のものは 鳴らない（_ものをつくる が 消します）
      __触れる: コードあり,
    };

    // --- 形ごとの 内側の名前と 大きさ ---
    let 内かたち = 'はこ';
    let 寸法 = { よこ: 横, たかさ: 高さ, おくゆき: 奥行き };
    if (かたち === '玉') {
      内かたち = 'たま';
      寸法 = { よこ: 横, たかさ: 横, おくゆき: 横 };   // 玉は 横 が 直径
    } else if (かたち === '筒') {
      内かたち = 'つつ';
      寸法 = { よこ: 横, たかさ: 高さ, おくゆき: 横 }; // 筒は 横 が 直径、高さ が 高さ
    } else if (かたち === 'モデル') {
      内かたち = 'モデル';
    }
    // 「箱」と、知らない形は 箱

    // --- 倉庫: 見た目も物理も作らない（SPEC2 H-1）---
    if (倉庫か) {
      return this._ものをつくる(Object.assign({}, 寸法, きほん, {
        __かたち: 内かたち,
        __mesh: null,
        __モデルめい: (内かたち === 'モデル') ? モデル名 : null,
      }));
    }

    // --- ワールド: 今までどおり 3D に出す ---
    if (内かたち === 'たま') {
      return this._かたちをつくる('たま', this._geoたま, Object.assign({}, 寸法, きほん));
    }
    if (内かたち === 'つつ') {
      return this._かたちをつくる('つつ', this._geoつつ, Object.assign({}, 寸法, きほん));
    }
    if (内かたち === 'モデル') {
      let m = null;
      try {
        if (モデル名) m = this._モデルをよむ(モデル名);
      } catch (e) {
        m = null;
        this._ログ('⚠ ' + (e && e.message ? e.message : 'モデルが読めませんでした。'));
      }
      if (!m) {
        // モデルが 見つからないときは 箱にして 置く（何も出ないより ましなので）
        return this._かたちをつくる('はこ', this._geoはこ, Object.assign({}, 寸法, きほん));
      }
      if (this.scene) this.scene.add(m.group);
      return this._ものをつくる(Object.assign({}, 寸法, きほん, {
        __かたち: 'モデル',
        __mesh: m.group,
        __きじゅん: { x: m.よこ, y: m.たかさ, z: m.おくゆき },
        __モデルめい: モデル名,
        __モデルぶひん: m.ぶひん,
        __もとしせい: m.もとしせい,
      }));
    }
    return this._かたちをつくる('はこ', this._geoはこ, Object.assign({}, 寸法, きほん));
  }

  // =========================================================================
  // 16c. クローン（SPEC2 H-2 / H-3）
  //
  //   クローン(もの) … そのものと同じものを1つ作って、ワールドに出す。
  //
  //   ・倉庫のものをクローンすると ワールドに出ます（これが主な使いかた）
  //   ・位置・大きさ・向き・傾き・色・壁・重力・見える をそのまま写します
  //   ・作ったらすぐ game.onClone(新しいもの, もとのもの) を呼びます。
  //     app.js がこれを受けて、もとのもののコードをクローンにも attach します。
  //     （これが無いと「クローンでもスクリプトが動く」が成り立ちません）
  // =========================================================================

  /**
   * もの を1つ コピーして、ワールドに出す。
   * @param {object} もと コピーのもと（生きている もの）
   * @returns {object} 新しい もの
   */
  _ものをクローンする(もと) {
    // --- 作りすぎ防止（SPEC2 H-2）---
    if (this.もの一覧.length >= クローンの上限) {
      if (!this._クローン警告ずみ) {
        this._クローン警告ずみ = true;
        this._ログ(
          '⚠ ワールドのものが ' + クローンの上限 + '個を超えたので、これ以上はクローンを作れません。' +
            'いらなくなったものは 消す() で消してください。'
        );
      }
      // 死んだものを返す（消す() 済みと同じあつかい）。あとから使っても落ちません
      const から = this._ものをつくる({ __場所: 場所の倉庫 });
      から.__いきてる = false;
      return から;
    }

    const 倉庫もと = (もと.__場所 === 場所の倉庫);
    const 寸法 = {
      よこ: 数にする(もと.よこ, 1),
      たかさ: 数にする(もと.たかさ, 1),
      おくゆき: 数にする(もと.おくゆき, 1),
    };
    const きほん = {
      x: 数にする(もと.x, 0),
      y: 数にする(もと.y, 0),
      z: 数にする(もと.z, 0),
      いろ: いろ安全(もと.いろ, '#ffffff'),
      むき: 数にする(もと.むき, 0),
      かたむき: 数にする(もと.かたむき, 0),
      みえる: しんぎ(もと.みえる),
      // 倉庫のものは いま効いている 壁・重力を 切ってあるので、
      // さくひんで決めたほう（__かべ設定 / __じゅうりょく設定）を 写します。
      // ワールドのものは いまのまま 写します（壁にする() したのも そのまま）
      __かべ: 倉庫もと ? (もと.__かべ設定 === true) : (もと.__かべ === true),
      __じゅうりょく: 倉庫もと ? (もと.__じゅうりょく設定 === true) : (もと.__じゅうりょく === true),
      __かべ設定: 倉庫もと ? (もと.__かべ設定 === true) : (もと.__かべ === true),
      __じゅうりょく設定: 倉庫もと ? (もと.__じゅうりょく設定 === true) : (もと.__じゅうりょく === true),
      __もよう: もと.__もよう || null,
      // クローンは かならず ワールドに出る（SPEC2 H-2）
      __場所: 場所のワールド,
      __コードあり: もと.__コードあり === true,
      // もとにコードがあれば クローンでも 触れたとき が鳴る
      __触れる: もと.__コードあり === true,
    };

    const かたち = もと.__かたち;
    let 新 = null;

    if (かたち === 'たま') {
      新 = this._かたちをつくる('たま', this._geoたま, Object.assign({}, 寸法, きほん));
    } else if (かたち === 'つつ') {
      新 = this._かたちをつくる('つつ', this._geoつつ, Object.assign({}, 寸法, きほん));
    } else if (かたち === 'かんばん') {
      const k = this._かんばんをつくる(もと.__もじ === null ? '' : String(もと.__もじ));
      if (this.scene) this.scene.add(k.sprite);
      新 = this._ものをつくる(Object.assign({}, 寸法, きほん, {
        __かたち: 'かんばん',
        __mesh: k.sprite,
        __きじゅん: { x: 1, y: 1, z: 1 },
        __もじ: もと.__もじ,
      }));
    } else if (かたち === 'モデル' || (かたち === 'プレイヤー' && もと.__モデルめい)) {
      // モデリング部屋のモデル。部品はクローンごとに 作りなおします
      //（アニメが お互いに 干渉しないように）
      let m = null;
      try {
        if (もと.__モデルめい) m = this._モデルをよむ(もと.__モデルめい);
      } catch (e) {
        m = null;
        this._ログ('⚠ ' + (e && e.message ? e.message : 'モデルが読めませんでした。'));
      }
      if (m) {
        if (this.scene) this.scene.add(m.group);
        新 = this._ものをつくる(Object.assign({}, 寸法, きほん, {
          __かたち: 'モデル',
          __mesh: m.group,
          __きじゅん: { x: m.よこ, y: m.たかさ, z: m.おくゆき },
          __モデルめい: もと.__モデルめい,
          __モデルぶひん: m.ぶひん,
          __もとしせい: m.もとしせい,
        }));
      } else {
        // モデルが読めなければ 箱にする（何も出ないより ましなので）
        新 = this._かたちをつくる('はこ', this._geoはこ, Object.assign({}, 寸法, きほん));
      }
    } else if (かたち === 'プレイヤー' && もと.__R15) {
      // R15 の見ためを もう1体 作る（動かすのは 使う人のコード）
      const R = this._R15のみためを作る();
      新 = this._ものをつくる(Object.assign({}, 寸法, きほん, {
        __かたち: 'プレイヤー',
        __mesh: R.group,
        __きじゅん: { x: R.半径 * 2, y: R.高さ, z: R.半径 * 2 },
        __R15: R.parts,
        __モデルぶひん: R.ぶひん,
        __もとしせい: R.もとしせい,
      }));
    } else {
      // はこ・地面・知らない形は 箱にする
      新 = this._かたちをつくる('はこ', this._geoはこ, Object.assign({}, 寸法, きほん));
    }

    // 大きさ() が もとと同じ倍率ではかれるように、もとの「もとの大きさ」も写す
    新.__もとよこ = 数にする(もと.__もとよこ, 新.よこ);
    新.__もとたかさ = 数にする(もと.__もとたかさ, 新.たかさ);
    新.__もとおくゆき = 数にする(もと.__もとおくゆき, 新.おくゆき);
    // 模様がついていたら、つぎの描きで はりなおす
    if (新.__もよう) 新.__いろ適用 = null;

    // --- 名前（もとの名前 + 連番。変数にはしない）---
    const 名 = this._クローンの名前(もと);
    新.__名前 = 名.名前;
    新.__クローンの根 = 名.根;

    // --- id は新しく振る。もとの id も おぼえておく（app.js がコードを探す）---
    // クローンのクローンでも、さくひんに ある もの の id を 指したまま にする
    //（app.js は この id で コードを 探すので、クローンの id では 見つからない）
    const もとid = もと.__もとid || もと.__世界id || null;
    新.__もとid = もとid;
    let id = (もとid ? もとid : 'c') + '/c' + 新.__id;
    while (this.世界のもの.has(id)) id = id + '#';
    新.__世界id = id;
    this.世界のもの.set(id, 新);

    return 新;
  }

  /**
   * クローンの名前を決める（もとの名前 + 連番）。
   * 「たま見本」→「たま見本2」「たま見本3」…。
   * クローンのクローンも 同じならびを つづけます（たま見本2 → たま見本3）。
   */
  _クローンの名前(もと) {
    const 根 = もと.__クローンの根 ||
      ((typeof もと.__名前 === 'string' && もと.__名前) ? もと.__名前 : 'クローン');
    let n = this._クローン番号.get(根) || 2;
    while (this.世界の名前.has(根 + n) || this._クローン名.has(根 + n)) n++;
    const 名前 = 根 + n;
    this._クローン番号.set(根, n + 1);
    this._クローン名.add(名前);
    return { 名前, 根 };
  }

  /** onClone を安全に呼ぶ（app.js がこけても ゲームは止めない） */
  _クローンを知らせる(新, もと) {
    if (typeof this.onClone !== 'function') return;
    try {
      this.onClone(新, もと);
    } catch (e) {
      // 使う人のコードのエラー（日本語）は そのまま外に出す
      if (e && (e.にほんご || e.name === 'KotodamaError')) throw e;
      this._ログ('⚠ クローンにコードを入れるところで うまくいきませんでした。');
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ことだま onClone]', e);
      }
    }
  }

  // =========================================================================
  // 17. 組み込みことば（SPEC 5章 と 7章、SPEC2 A-4）
  // =========================================================================

  /**
   * lang.js に渡す { 日本語名: 関数 } を返す。
   *
   * ● 漢字が正式・ひらがなも今までどおり動く（SPEC2 A-4）。
   *   同じ関数を2つのキーに入れているだけです。ひらがなは絶対に消しません。
   * ● 名前がぶつかる1つだけ、SPEC2 のとおりに直しました:
   *     地面を作る関数 … `地面を作る` / `じめんをつくる`（`じめん` も今までどおり動く）
   *     最初からある床 … `地面` / `ちめん`
   * ● 関数でないもの（プレイヤー・地面）も入れてよい。
   *   それらは lang.js で「最初からある変数」になります。
   */
  builtins() {
    const G = this;

    // ==================== つくる ====================

    /** 箱(x, y, z, 横, 高さ, 奥行き) */
    const はこ = (x, y, z, よこ, たかさ, おくゆき) => {
      return G._かたちをつくる('はこ', G._geoはこ, {
        x: すうチェック('箱', 1, x),
        y: すうチェック('箱', 2, y),
        z: すうチェック('箱', 3, z),
        よこ: Math.abs(すうチェック('箱', 4, よこ)),
        たかさ: Math.abs(すうチェック('箱', 5, たかさ)),
        おくゆき: Math.abs(すうチェック('箱', 6, おくゆき)),
      });
    };

    /** 玉(x, y, z, 半径) */
    const たま = (x, y, z, はんけい) => {
      const r = Math.abs(すうチェック('玉', 4, はんけい));
      return G._かたちをつくる('たま', G._geoたま, {
        x: すうチェック('玉', 1, x),
        y: すうチェック('玉', 2, y),
        z: すうチェック('玉', 3, z),
        よこ: r * 2, たかさ: r * 2, おくゆき: r * 2,
      });
    };

    /** 筒(x, y, z, 半径, 高さ) */
    const つつ = (x, y, z, はんけい, たかさ) => {
      const r = Math.abs(すうチェック('筒', 4, はんけい));
      const h = Math.abs(すうチェック('筒', 5, たかさ));
      return G._かたちをつくる('つつ', G._geoつつ, {
        x: すうチェック('筒', 1, x),
        y: すうチェック('筒', 2, y),
        z: すうチェック('筒', 3, z),
        よこ: r * 2, たかさ: h, おくゆき: r * 2,
      });
    };

    /** 看板(x, y, z, 文字) いつもカメラを向く文字の板 */
    const かんばん = (x, y, z, もじ) => {
      const xx = すうチェック('看板', 1, x);
      const yy = すうチェック('看板', 2, y);
      const zz = すうチェック('看板', 3, z);
      const t = もじチェック('看板', 4, もじ);
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

    /** 自分のモデル(x, y, z, 名前) モデリング部屋で作ったもの */
    const じぶんのモデル = (x, y, z, なまえ) => {
      const xx = すうチェック('自分のモデル', 1, x);
      const yy = すうチェック('自分のモデル', 2, y);
      const zz = すうチェック('自分のモデル', 3, z);
      const n = もじチェック('自分のモデル', 4, なまえ);
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

    /** 消す(もの) */
    const けす = (もの) => {
      const o = ものチェック('消す', もの, 1);
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
     * 全部消す() 使う人が作ったものを全部消す。
     * プレイヤーと地面は残します（消したいときは プレイヤーを消す()）。
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

    /** 動かす(もの, x, y, z) 今の場所からずらす */
    const うごかす = (もの, x, y, z) => {
      const o = ものチェック('動かす', もの, 1);
      o.x = 数にする(o.x, 0) + すうチェック('動かす', 2, x);
      o.y = 数にする(o.y, 0) + すうチェック('動かす', 3, y);
      o.z = 数にする(o.z, 0) + すうチェック('動かす', 4, z);
      return null;
    };

    /** 置く(もの, x, y, z) その場所にする */
    const おく = (もの, x, y, z) => {
      const o = ものチェック('置く', もの, 1);
      o.x = すうチェック('置く', 2, x);
      o.y = すうチェック('置く', 3, y);
      o.z = すうチェック('置く', 4, z);
      return null;
    };

    /**
     * 向いているほうへ動かす道具。
     * 向き = 0 のとき前は -z（SPEC 2章）。
     *   前  = (-sin, 0, -cos)
     *   右  = ( cos, 0, -sin)
     */
    const むきへうごかす = (ことば, もの, n, まえ倍, みぎ倍) => {
      const o = ものチェック(ことば, もの, 1);
      const d = すうチェック(ことば, 2, n);
      const r = ど2ラジ(数にする(o.むき, 0));
      const s = Math.sin(r), c = Math.cos(r);
      o.x = 数にする(o.x, 0) + (-s * まえ倍 + c * みぎ倍) * d;
      o.z = 数にする(o.z, 0) + (-c * まえ倍 - s * みぎ倍) * d;
      return null;
    };

    const まえへ = (もの, n) => むきへうごかす('前へ', もの, n, 1, 0);
    const うしろへ = (もの, n) => むきへうごかす('後ろへ', もの, n, -1, 0);
    const みぎへ = (もの, n) => むきへうごかす('右へ', もの, n, 0, 1);
    const ひだりへ = (もの, n) => むきへうごかす('左へ', もの, n, 0, -1);

    const うえへ = (もの, n) => {
      const o = ものチェック('上へ', もの, 1);
      o.y = 数にする(o.y, 0) + すうチェック('上へ', 2, n);
      return null;
    };
    const したへ = (もの, n) => {
      const o = ものチェック('下へ', もの, 1);
      o.y = 数にする(o.y, 0) - すうチェック('下へ', 2, n);
      return null;
    };

    /** 回す(もの, 度) 今の向きから 度 だけ左右に回す */
    const まわす = (もの, ど) => {
      const o = ものチェック('回す', もの, 1);
      o.むき = 数にする(o.むき, 0) + すうチェック('回す', 2, ど);
      return null;
    };

    /** 傾ける(もの, 度) 今の傾きから 度 だけ前後に倒す */
    const かたむける = (もの, ど) => {
      const o = ものチェック('傾ける', もの, 1);
      o.かたむき = 数にする(o.かたむき, 0) + すうチェック('傾ける', 2, ど);
      return null;
    };

    /** 向ける(もの, 度) 向きをその角度にする */
    const むける = (もの, ど) => {
      const o = ものチェック('向ける', もの, 1);
      o.むき = すうチェック('向ける', 2, ど);
      return null;
    };

    /** 向かせる(もの, 相手) 相手のほうを向かせる */
    const むかせる = (もの, あいて) => {
      const o = ものチェック('向かせる', もの, 1);
      const a = ものチェック('向かせる', あいて, 2);
      const dx = 数にする(a.x, 0) - 数にする(o.x, 0);
      const dz = 数にする(a.z, 0) - 数にする(o.z, 0);
      if (dx === 0 && dz === 0) return null;
      o.むき = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      return null;
    };

    // ==================== みため ====================

    /** 色(もの, "赤") */
    const いろ = (もの, いろな) => {
      const o = ものチェック('色', もの, 1);
      o.いろ = いろに直す('色', いろな);
      return null;
    };

    /** 大きさ(もの, 倍) 最初の大きさの何倍にするか */
    const おおきさ = (もの, ばい) => {
      const o = ものチェック('大きさ', もの, 1);
      const b = すうチェック('大きさ', 2, ばい);
      if (b < 0) throw エラー('「大きさ」の倍には 0以上の数を渡してください。' + 使い方('大きさ'));
      o.よこ = 数にする(o.__もとよこ, 1) * b;
      o.たかさ = 数にする(o.__もとたかさ, 1) * b;
      o.おくゆき = 数にする(o.__もとおくゆき, 1) * b;
      return null;
    };

    const かくす = (もの) => {
      ものチェック('隠す', もの, 1).みえる = false;
      return null;
    };
    const みせる = (もの) => {
      ものチェック('見せる', もの, 1).みえる = true;
      return null;
    };

    /** 模様(もの, 名前) おえかき部屋の絵を貼る */
    const もよう = (もの, なまえ) => {
      const o = ものチェック('模様', もの, 1);
      const n = もじチェック('模様', 2, なまえ);
      G._もようをよむ(n);          // ない名前ならここで日本語のエラー
      o.__もよう = n;
      o.__いろ適用 = null;          // 次の描きでつけ直す
      return null;
    };

    /** 空の色("水色") */
    const そらのいろ = (いろな) => {
      const c = いろに直す('空の色', いろな);
      G._そらのいろ = c;
      if (G.scene) {
        if (G.scene.background && G.scene.background.set) G.scene.background.set(c);
        else G.scene.background = new THREE.Color(c);
        // 霧を自分で決めていなければ、空と同じ色にする
        if (G._きりは自動 && G.scene.fog) {
          G._きりのいろ = c;
          G.scene.fog.color.set(c);
        }
      }
      return null;
    };

    /**
     * 地面を作る(色, 広さ) 地面を作って返す。
     * 最初からある「地面」の色と広さを変えて、それを返します
     * （2枚重なってチラチラしないように）。
     */
    const じめんをつくる = (いろな, ひろさ) => {
      const c = いろに直す('地面を作る', いろな);
      let w = (ひろさ === undefined) ? 200 : Math.abs(すうチェック('地面を作る', 2, ひろさ));
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
      // ますめの模様も広さに合わせる
      if (g.__ざいりょう && g.__ざいりょう.map) {
        g.__ざいりょう.map.repeat.set(Math.max(1, w / 4), Math.max(1, w / 4));
      }
      return g;
    };

    /** 霧(色, 濃さ) 濃さは 0〜1 くらい */
    const きり = (いろな, こさ) => {
      const c = いろに直す('霧', いろな);
      let k = (こさ === undefined) ? 0.4 : すうチェック('霧', 2, こさ);
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

    /** 重力(もの, はい) 落ちるようにする */
    const じゅうりょく = (もの, はい) => {
      const o = ものチェック('重力', もの, 1);
      const つける = しんぎ(はい);
      o.__じゅうりょく設定 = つける;
      // 倉庫のものは 落ちません。クローンしたときに 落ちるようになります
      o.__じゅうりょく = (o.__場所 === 場所の倉庫) ? false : つける;
      if (!o.__じゅうりょく) o.__vy = 0;
      return null;
    };

    /** 壁にする(もの) 通り抜けできなくする */
    const かべにする = (もの) => {
      const o = ものチェック('壁にする', もの, 1);
      o.__かべ設定 = true;
      // 倉庫のものは 当たりません。クローンしたときに 壁になります
      o.__かべ = (o.__場所 !== 場所の倉庫);
      return null;
    };

    /** 速さ(もの, x, y, z) 速さを直接入れる */
    const はやさ = (もの, x, y, z) => {
      const o = ものチェック('速さ', もの, 1);
      o.__vx = すうチェック('速さ', 2, x);
      o.__vy = すうチェック('速さ', 3, y);
      o.__vz = すうチェック('速さ', 4, z);
      return null;
    };

    /** ジャンプ(もの, 強さ) 床にいるときだけ効く */
    const ジャンプ = (もの, つよさ) => {
      const o = ものチェック('ジャンプ', もの, 1);
      const t = (つよさ === undefined) ? G._ジャンプのつよさ : すうチェック('ジャンプ', 2, つよさ);
      if (!o.__ゆかにいる) return false;
      o.__vy = t;
      o.__ゆかにいる = false;
      return true;
    };

    /** 床にいる(もの) */
    const ゆかにいる = (もの) => {
      return ものチェック('床にいる', もの, 1).__ゆかにいる === true;
    };

    // ==================== カメラ ====================

    const カメラをおく = (x, y, z) => {
      const xx = すうチェック('カメラを置く', 1, x);
      const yy = すうチェック('カメラを置く', 2, y);
      const zz = すうチェック('カメラを置く', 3, z);
      G._カメラモード = 'てうち';       // 自動のカメラはやめる
      G._カメラのあいて = null;
      if (G.camera) G.camera.position.set(xx, yy, zz);
      return null;
    };

    const カメラをむける = (x, y, z) => {
      const xx = すうチェック('カメラを向ける', 1, x);
      const yy = すうチェック('カメラを向ける', 2, y);
      const zz = すうチェック('カメラを向ける', 3, z);
      G._カメラモード = 'てうち';
      G._カメラのあいて = null;
      G._カメラ注視もの = null;
      G._カメラ注視 = { x: xx, y: yy, z: zz };
      if (G.camera) G.camera.lookAt(xx, yy, zz);
      return null;
    };

    const カメラをむかせる = (もの) => {
      const o = ものチェック('カメラを向かせる', もの, 1);
      G._カメラモード = 'てうち';
      G._カメラのあいて = null;
      G._カメラ注視 = null;
      G._カメラ注視もの = o;
      return null;
    };

    /** カメラを付ける(もの, 後ろ, 高さ) 三人称で追いかける */
    const カメラをつける = (もの, うしろ, たかさ) => {
      const o = ものチェック('カメラを付ける', もの, 1);
      G._カメラモード = 'ついせき';
      G._カメラのあいて = o;
      G._カメラうしろ = (うしろ === undefined) ? 12 : すうチェック('カメラを付ける', 2, うしろ);
      G._カメラたかさ = (たかさ === undefined) ? 6 : すうチェック('カメラを付ける', 3, たかさ);
      G._カメラ注視 = null;
      G._カメラ注視もの = null;
      return null;
    };

    /** カメラの中に(もの) 一人称。そのものは見えなくなる */
    const カメラのなかに = (もの) => {
      const o = ものチェック('カメラの中に', もの, 1);
      G._カメラモード = 'いちにんしょう';
      G._カメラのあいて = o;
      G._カメラ注視 = null;
      G._カメラ注視もの = null;
      return null;
    };

    /**
     * マウスを固定(はい) 本物のFPSのようにポインタを掴む。
     * ブラウザが「Escキーを押すと解除できます」と出します。
     * ふだんは いいえ（左ボタンを押しながら動かして見回る）。
     */
    const マウスをこてい = (はい) => {
      G._ポインタ固定 = しんぎ(はい);
      if (!G._ポインタ固定 && typeof document !== 'undefined' &&
          document.exitPointerLock && G._ポインタロック中) {
        try { document.exitPointerLock(); } catch (e) { /* 何もしない */ }
      }
      return null;
    };

    /** マウスで見回す(はい) 画面をクリックするとマウスで視点が回る */
    const マウスでみまわす = (はい) => {
      G._マウスでみまわす = しんぎ(はい);
      if (!G._マウスでみまわす && typeof document !== 'undefined' &&
          document.exitPointerLock && G._ポインタロック中) {
        try { document.exitPointerLock(); } catch (e) { /* 何もしない */ }
      }
      return null;
    };

    /** カメラの向き() 今向いている左右の角度（度） */
    const カメラのむき = () => {
      return ((G._カメラむき % 360) + 360) % 360;
    };

    /**
     * プレイヤーの向き() プレイヤーが向いている左右の角度（度）。
     *   見ている方向です。カメラの向き() と同じ値になります。
     *   向ける(たま, プレイヤーの向き()) と書くと、弾が正面に飛びます。
     */
    const プレイヤーのむき = () => {
      const p = G.プレイヤー;
      if (p && p.__いきてる) {
        // 使う人が さっき プレイヤー.向き = 90 と書いた ばかりのときは、
        // まだ カメラに 写していないので、もの の値を そのまま かえします
        const ど = 数にする(p.むき, G._カメラむき);
        if (Number.isFinite(ど)) return ((ど % 360) + 360) % 360;
      }
      return ((G._カメラむき % 360) + 360) % 360;
    };

    // ==================== しらべる ====================

    const おされてる = (キー) => G._おされてる.has(キー名を直す('押されてる', キー));
    const おした = (キー) => G._おした.has(キー名を直す('押した', キー));

    /** ぶつかってる(A, B) 3D の箱どうしの重なり */
    const ぶつかってる = (A, B) => {
      const a = ものチェック('ぶつかってる', A, 1);
      const b = ものチェック('ぶつかってる', B, 2);
      if (!a.__いきてる || !b.__いきてる) return false;
      return かさなる(はこにする(a), はこにする(b));
    };

    /** 距離(A, B) まんなかどうしの距離（3D） */
    const きょり = (A, B) => {
      const a = ものチェック('距離', A, 1);
      const b = ものチェック('距離', B, 2);
      const dx = 数にする(a.x, 0) - 数にする(b.x, 0);
      const dy = 数にする(a.y, 0) - 数にする(b.y, 0);
      const dz = 数にする(a.z, 0) - 数にする(b.z, 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    const がめんのよこ = () => 画面よこ;
    const がめんのたて = () => 画面たて;

    const マウスX = () => G._マウスX;
    const マウスY = () => G._マウスY;

    // マウスのボタンは 左・中・右 を きちんと分ける（SPEC2 E）。
    // 「クリックした」「クリック中」は 今までの名前のまま、左だけを見ます。
    const クリックした = () => G._ボタン押した[0] === true;
    const みぎクリックした = () => G._ボタン押した[2] === true;
    const なかクリックした = () => G._ボタン押した[1] === true;
    const クリックちゅう = () => G._ボタン中[0] === true;
    const みぎクリックちゅう = () => G._ボタン中[2] === true;
    const なかクリックちゅう = () => G._ボタン中[1] === true;

    // ==================== すうじ ====================

    const らんすう = (a, b) => {
      let lo = Math.ceil(すうチェック('乱数', 1, a));
      let hi = Math.floor(すうチェック('乱数', 2, b));
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    };
    const せいすう = (x) => Math.floor(すうチェック('整数', 1, x));
    const ぜったいち = (x) => Math.abs(すうチェック('絶対値', 1, x));
    const さいだい = (a, b) =>
      Math.max(すうチェック('最大', 1, a), すうチェック('最大', 2, b));
    const さいしょう = (a, b) =>
      Math.min(すうチェック('最小', 1, a), すうチェック('最小', 2, b));
    const へいほうこん = (x) => {
      const n = すうチェック('平方根', 1, x);
      if (n < 0) {
        throw エラー('「平方根」には 0以上の数を渡してください（' + n + ' はマイナスです）。');
      }
      return Math.sqrt(n);
    };
    const サイン = (ど) => Math.sin(ど2ラジ(すうチェック('サイン', 1, ど)));
    const コサイン = (ど) => Math.cos(ど2ラジ(すうチェック('コサイン', 1, ど)));

    /**
     * 角度(横, 奥行き) → 度。
     * `向ける(もの, 角度(dx, dz))` と書くと そのほうを向きます。
     * （向き = 0 のとき前は -z なので atan2(-dx, -dz)）
     */
    const かくど = (よこ, おくゆき) => {
      const dx = すうチェック('角度', 1, よこ);
      const dz = すうチェック('角度', 2, おくゆき);
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
      if (v === undefined) throw たりない('長さ', 1);
      throw エラー('「長さ」には文字かリストを渡してください（渡されたのは ' + 見せる(v) + '）。' + 使い方('長さ'));
    };
    const くわえる = (リスト, もの) => {
      const a = リストチェック('加える', 1, リスト);
      a.push(もの === undefined ? null : もの);
      return a;
    };
    const とりのぞく = (リスト, もの) => {
      const a = リストチェック('取り除く', 1, リスト);
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
      let n = すうチェック('待つ', 1, びょう);
      if (n < 0) n = 0;
      if (n > 60) n = 60;
      return { __wait: n };
    };

    const おと = (なまえ) => {
      const 使える = ['ピコ', 'ドン', 'キラン', 'ジャン', 'ボヨン'];
      const s = typeof なまえ === 'string' ? なまえ.trim() : '';
      // ひらがなで書かれても通す（SPEC2 F）
      let きまり = 使える.includes(s) ? s : null;
      if (!きまり) {
        const そ = そろえる(s);
        for (const n of 使える) if (そろえる(n) === そ && そ !== '') きまり = n;
      }
      if (!きまり) {
        if (なまえ === undefined) throw たりない('音', 1);
        throw エラー(
          '「音」には ' + 使える.join(' ') + ' のどれかを渡してください' +
            '（渡されたのは ' + 見せる(なまえ) + '）。' + 使い方('音')
        );
      }
      G._おとをならす(きまり);
      return null;
    };

    const てんすう = (n) => {
      G._てんすう = すうチェック('点数', 1, n);
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
        : もじチェック('ゲーム終了', 1, もじな);
      if (G._hud) G._hud.よごれ = true;
      とめる();
      return null;
    };

    const じかん = () => G._じかん;

    // ==================== ワールド（SPEC2 B-3）====================

    /**
     * 探す("名前") ワールドに置いたものを名前で探す。
     * ふつうは名前をそのまま書けますが（あかい箱 のように）、
     * 名前を文字で組み立てたいときは これを使います。
     * ひらがな・カタカナのちがいは こえて探します（SPEC2 F）。
     */
    const さがす = (なまえ) => {
      const n = もじチェック('探す', 1, なまえ);
      const かぎ = 名前をさがすMap(G.世界の名前, n);
      if (かぎ !== null) return G.世界の名前.get(かぎ);
      // 最初からあるものも 探せるようにする
      const そ = そろえる(n);
      if (n === 'プレイヤー' || そ === 'ぷれいやー') {
        if (G.プレイヤー) return G.プレイヤー;
      }
      if (n === '地面' || n === 'ちめん' || そ === 'ちめん') {
        if (G.ちめん) return G.ちめん;
      }
      const ある = [];
      for (const k of G.世界の名前.keys()) ある.push('「' + k + '」');
      throw エラー(
        '「' + n + '」というものはワールドにありません。' +
          (ある.length
            ? '今あるのは ' + ある.join(' ') + ' です。'
            : '\n  → ワールド一覧の ＋箱 などで置いてから使ってください')
      );
    };

    /**
     * クローン(もの) / 複製(もの) / ふくせい(もの)
     *   そのものと同じものを1つ作って、ワールドに出す。→ 新しいもの
     *   倉庫のものをクローンすると、ワールドに出ます（これが主な使いかた）。
     *   もとのものにコードが入っていたら、クローンでもそのコードが動きます
     *   （app.js が game.onClone を受けて入れます。自分＝クローン自身）。
     */
    const クローン = (もの) => {
      const もと = ものチェック('クローン', もの, 1);
      if (!もと.__いきてる) {
        throw エラー(
          '「クローン」には生きているものを渡してください。' +
            '消したものはクローンできません。' + 使い方('クローン')
        );
      }
      const 新 = G._ものをクローンする(もと);
      // 作ったらすぐ知らせる（SPEC2 H-3）。
      // app.js がここで もとのもののコードを クローンにも入れます
      if (新.__いきてる) G._クローンを知らせる(新, もと);
      return 新;
    };

    // ==================== SPEC 7章：プレイヤーまわり ====================

    /** 操作を切る() 自動の操作をやめる（自分で動かしたいとき） */
    const そうさをきる = () => {
      G._そうさする = false;
      const p = G.プレイヤー;
      if (p) { p.__vx = 0; p.__vz = 0; }
      return null;
    };

    /** プレイヤーを消す() プレイヤーごと消す（見せるだけのものを作るとき） */
    const プレイヤーをけす = () => {
      const p = G.プレイヤー;
      if (p && p.__いきてる) けす(p);
      G._そうさする = false;
      // 自動のカメラはやめて、最初の場所に戻す
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

    /** 速さを変える(歩く, 走る, ジャンプ) 既定は 14 / 22 / 32 */
    const はやさをかえる = (あるく, はしる, ジャンプ) => {
      if (あるく !== undefined) {
        G._あるくはやさ = Math.abs(すうチェック('速さを変える', 1, あるく));
      }
      if (はしる !== undefined) {
        G._はしるはやさ = Math.abs(すうチェック('速さを変える', 2, はしる));
      }
      if (ジャンプ !== undefined) {
        G._ジャンプのつよさ = Math.abs(すうチェック('速さを変える', 3, ジャンプ));
      }
      return null;
    };

    /** 一人称(はい) 一人称に切りかえる */
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

    // ==================== アニメ部屋のアニメ ====================

    /**
     * アニメ(もの, 名前)
     *   アニメ部屋で作った動きを、そのものにさせる。
     *   使えるのは 自分のモデル() で作ったものと、
     *   最初からいる R15 のプレイヤー、
     *   プレイヤーの姿() で姿を変えたプレイヤーです。
     *   もう別のアニメが動いていたら、そちらをやめて差しかえます。
     *   → なし を返す
     */
    const アニメ = (もの, なまえ) => {
      const o = ものチェック('アニメ', もの, 1);
      const n = もじチェック('アニメ', 2, なまえ);
      const データ = G._アニメをよむ(n);     // ない名前ならここで日本語のエラー
      if (!o.__モデルぶひん) {
        throw エラー(
          '「アニメ」は プレイヤーか、自分のモデル() で作ったものに使ってください' +
            '（箱() や 玉() には使えません）。' + 使い方('アニメ')
        );
      }
      if (o.__アニメ) G._しせいをもどす(o);  // 前のアニメをやめて元のかたちに
      o.__アニメ = { なまえ: n, データ: データ, じかん: 0 };
      return null;
    };

    /**
     * アニメを止める(もの)
     *   再生をやめて、元の姿勢に戻す。動いていなくても怒られません。
     *   → なし を返す
     */
    const アニメをとめる = (もの) => {
      const o = ものチェック('アニメを止める', もの, 1);
      o.__アニメ = null;
      G._しせいをもどす(o);
      return null;
    };

    /**
     * プレイヤーの姿(名前)
     *   プレイヤーの見ためだけを、モデリング部屋で作ったモデルに入れかえる。
     *   当たり判定・重力・カメラ・WASD の操作はこれまでどおり効きます。
     *   ・当たり判定の箱は、モデル全体を囲む大きさに合わせる
     *   ・足元が今までと同じ高さ（地面なら y=0）に来るように置き直す
     *   ・最初から入っている R15 の歩きポーズは ここでやめる
     *     （歩きは アニメ() でつける）
     *   → 姿を変えたプレイヤー（もの）を返す
     */
    const プレイヤーのすがた = (なまえ) => {
      const n = もじチェック('プレイヤーの姿', 1, なまえ);
      const p = G.プレイヤー;
      if (!p) throw エラー('プレイヤーがいないので姿を変えられません。');

      const m = G._モデルをよむ(n);          // ない名前ならここで日本語のエラー

      // 今の足元の高さを覚えておく（足元をずらさないため）
      const あしもと = 数にする(p.y, 0) - Math.abs(数にする(p.たかさ, 5)) / 2;

      // 古い見ためを外して、新しいものをつける
      if (p.__mesh && G.scene) {
        try { G.scene.remove(p.__mesh); } catch (e) { /* 何もしない */ }
      }
      m.group.visible = p.__いきてる;        // 消されたあとなら出さない
      if (G.scene) G.scene.add(m.group);

      p.__mesh = m.group;
      p.__かたち = 'モデル';
      p.__R15 = null;                        // R15 の歩きポーズをやめる
      p.__モデルめい = n;
      p.__モデルぶひん = m.ぶひん;
      p.__もとしせい = m.もとしせい;
      p.__アニメ = null;

      // 当たり判定をモデル全体を囲む箱に合わせる
      p.よこ = m.よこ;
      p.たかさ = m.たかさ;
      p.おくゆき = m.おくゆき;
      p.__もとよこ = m.よこ;
      p.__もとたかさ = m.たかさ;
      p.__もとおくゆき = m.おくゆき;
      p.__きじゅん = { x: m.よこ, y: m.たかさ, z: m.おくゆき };

      // 色はモデルのままにする（あとから 色() で変えられる）
      p.いろ = m.いろ;
      p.__いろ適用 = m.いろ;

      // 足元をさっきと同じ高さに戻す
      // （モデルは足元 y=0 めやすで作るので、これで地面にちゃんと立つ）
      p.y = あしもと + m.たかさ / 2;

      return p;
    };

    // ==================== 全部まとめる ====================
    //
    //   [漢字（正式）, ひらがな別名, 関数] のならびで書きます。
    //   同じ関数を 両方のキーに入れるだけ。ひらがなは絶対に消しません。
    //   エラーの文には 漢字の名前が出ます。

    const 表 = [
      // つくる
      ['箱', 'はこ', はこ],
      ['玉', 'たま', たま],
      ['筒', 'つつ', つつ],
      ['看板', 'かんばん', かんばん],
      ['自分のモデル', 'じぶんのモデル', じぶんのモデル],
      ['消す', 'けす', けす],
      ['全部消す', 'ぜんぶけす', ぜんぶけす],
      // うごかす
      ['動かす', 'うごかす', うごかす],
      ['置く', 'おく', おく],
      ['前へ', 'まえへ', まえへ],
      ['後ろへ', 'うしろへ', うしろへ],
      ['右へ', 'みぎへ', みぎへ],
      ['左へ', 'ひだりへ', ひだりへ],
      ['上へ', 'うえへ', うえへ],
      ['下へ', 'したへ', したへ],
      ['回す', 'まわす', まわす],
      ['傾ける', 'かたむける', かたむける],
      ['向ける', 'むける', むける],
      ['向かせる', 'むかせる', むかせる],
      // みため
      ['色', 'いろ', いろ],
      ['大きさ', 'おおきさ', おおきさ],
      ['隠す', 'かくす', かくす],
      ['見せる', 'みせる', みせる],
      ['模様', 'もよう', もよう],
      ['空の色', 'そらのいろ', そらのいろ],
      // 「じめん」は 今までどおり 地面を作る関数。床の変数は 地面／ちめん（下）
      ['地面を作る', ['じめんをつくる', 'じめん'], じめんをつくる],
      ['霧', 'きり', きり],
      // うごき（物理）
      ['重力', 'じゅうりょく', じゅうりょく],
      ['壁にする', 'かべにする', かべにする],
      ['速さ', 'はやさ', はやさ],
      ['ジャンプ', null, ジャンプ],
      ['床にいる', 'ゆかにいる', ゆかにいる],
      // カメラ
      ['カメラを置く', 'カメラをおく', カメラをおく],
      ['カメラを向ける', 'カメラをむける', カメラをむける],
      ['カメラを向かせる', 'カメラをむかせる', カメラをむかせる],
      ['カメラを付ける', 'カメラをつける', カメラをつける],
      ['カメラの中に', 'カメラのなかに', カメラのなかに],
      ['マウスで見回す', 'マウスでみまわす', マウスでみまわす],
      ['マウスを固定', 'マウスをこてい', マウスをこてい],
      ['カメラの向き', 'カメラのむき', カメラのむき],
      ['プレイヤーの向き', 'プレイヤーのむき', プレイヤーのむき],
      // しらべる
      ['押されてる', 'おされてる', おされてる],
      ['押した', 'おした', おした],
      ['ぶつかってる', null, ぶつかってる],
      ['距離', 'きょり', きょり],
      ['画面の横', 'がめんのよこ', がめんのよこ],
      ['画面の縦', 'がめんのたて', がめんのたて],
      ['マウスX', null, マウスX],
      ['マウスY', null, マウスY],
      // マウスのボタン（SPEC2 E）。「クリックした」「クリック中」は 左だけ
      ['クリックした', null, クリックした],
      ['左クリックした', 'ひだりクリックした', クリックした],
      ['右クリックした', 'みぎクリックした', みぎクリックした],
      ['中クリックした', 'なかクリックした', なかクリックした],
      ['クリック中', 'クリックちゅう', クリックちゅう],
      ['左クリック中', 'ひだりクリックちゅう', クリックちゅう],
      ['右クリック中', 'みぎクリックちゅう', みぎクリックちゅう],
      ['中クリック中', 'なかクリックちゅう', なかクリックちゅう],
      // すうじ
      ['乱数', 'らんすう', らんすう],
      ['整数', 'せいすう', せいすう],
      ['絶対値', 'ぜったいち', ぜったいち],
      ['最大', 'さいだい', さいだい],
      ['最小', 'さいしょう', さいしょう],
      ['平方根', 'へいほうこん', へいほうこん],
      ['サイン', null, サイン],
      ['コサイン', null, コサイン],
      ['角度', 'かくど', かくど],
      // もじ と リスト
      ['つなげる', null, つなげる],
      ['長さ', 'ながさ', ながさ],
      ['加える', 'くわえる', くわえる],
      ['取り除く', 'とりのぞく', とりのぞく],
      // そのた
      ['書く', 'かく', かく],
      ['待つ', 'まつ', まつ],
      ['音', 'おと', おと],
      ['点数', 'てんすう', てんすう],
      ['メッセージ', null, メッセージ],
      ['ゲーム終了', 'ゲームしゅうりょう', ゲームしゅうりょう],
      ['時間', 'じかん', じかん],
      ['止める', 'とめる', とめる],
      // ワールド（SPEC2 B）
      ['探す', 'さがす', さがす],
      ['クローン', ['複製', 'ふくせい'], クローン],
      // SPEC 7章：プレイヤー
      ['操作を切る', 'そうさをきる', そうさをきる],
      ['プレイヤーを消す', 'プレイヤーをけす', プレイヤーをけす],
      ['速さを変える', 'はやさをかえる', はやさをかえる],
      ['一人称', 'いちにんしょう', いちにんしょう],
      // アニメ部屋のアニメ
      ['アニメ', null, アニメ],
      ['アニメを止める', 'アニメをとめる', アニメをとめる],
      ['プレイヤーの姿', 'プレイヤーのすがた', プレイヤーのすがた],
    ];

    // 安全網：英語のエラーが外にもれないように、全部つつむ。
    // つつむときの名前は「漢字（正式）」。ひらがなで呼んでも 漢字で怒られます。
    const つつんだ表 = {};
    for (const [漢字, 別名, 関数] of 表) {
      const w = つつむ(漢字, 関数);
      つつんだ表[漢字] = w;
      const ならび = (別名 === null || 別名 === undefined)
        ? []
        : (Array.isArray(別名) ? 別名 : [別名]);
      for (const n of ならび) {
        if (n && n !== 漢字) つつんだ表[n] = w;
      }
    }

    // 関数でないもの（lang.js で「最初からある変数」になる）
    つつんだ表['プレイヤー'] = this.プレイヤー;
    つつんだ表['地面'] = this.ちめん;
    つつんだ表['ちめん'] = this.ちめん;

    // ワールドに置いたものも、名前でそのまま使えるようにする（SPEC2 B-3）。
    // 同じ名前の組み込みのことばがあったら、組み込みのほうを守ります。
    for (const [名前, もの] of this.世界の名前) {
      if (!Object.prototype.hasOwnProperty.call(つつんだ表, 名前)) {
        つつんだ表[名前] = もの;
      }
    }

    return つつんだ表;
  }
}
