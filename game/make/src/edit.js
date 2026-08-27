// ============================================================
//  ことだま — 手で つかんで 動かす 道具（エディタ）
//
//  ゲーム画面が 止まっている あいだ、ワールドの ものを
//  スクリプトを 書かずに 直に つかんで
//        いどう ／ おおきさ ／ かいてん
//  できるようにする 道具です。ロブロックス・スタジオと おなじ 感じ。
//
//  3D の 中身（scene / camera / canvas / 世界のもの）は runtime.js が
//  持っているので、ここでは「編集の 道具」だけを あつかいます。
//  さくひんの データ（保存・複製・削除）は 画面側（app.js）が 持っているので、
//  この道具は「こう変わったよ」と 知らせるだけです。
//
//  そうさ（モデリング部屋 src/model.js と そろえてあります）
//    左クリック   … ものを えらぶ（黄色い わくが 光る）
//    やじるしを ドラッグ … うごかす
//    W / E / R    … いどう ／ おおきさ ／ かいてん
//    右ドラッグ   … みまわす
//    右＋WASD/QE  … とぶ
//    中ドラッグ   … よこに ずれる
//    ホイール     … よる ／ はなれる
//    F            … えらんだ ものに よる
//    G            … ますめに そろえる の 入 / 切
//    Ctrl+Z       … ひとつ もどす（30手 以上）
//    Ctrl+D       … ふくせい（画面側に おねがいする）
//    Delete       … けす（画面側に おねがいする）
//    ゆび 1本     … みまわす ／ タップで えらぶ ／ やじるしを つまむ
//    ゆび 2本     … ズーム と へいこういどう
//
//  つかいかた:
//      import { Editor } from './edit.js';
//      const editor = new Editor(game);
//      editor.onSelect     = (id) => { ... };
//      editor.onChange     = (id, patch) => { ... };
//      editor.onDuplicate  = (id) => { ... };
//      editor.onDelete     = (id) => { ... };
//      editor.有効(true);      // ■ ストップ の とき
//      editor.有効(false);     // ▶ プレイ の とき
// ============================================================

import * as THREE from '../../lib/three.module.js';

// ------------------------------------------------------------
//  小さな 道具
// ------------------------------------------------------------

/** ど → ラジアン */
const ラジ = (d) => (d * Math.PI) / 180;
/** ラジアン → ど */
const ド = (r) => (r * 180) / Math.PI;
/** 数でなければ きめられた 値に する（NaN や undefined よけ） */
const 数 = (v, 既定 = 0) => (typeof v === 'number' && isFinite(v) ? v : 既定);
/** 小数は 4けたまで。0.30000000000000004 みたいな 数を 出さない */
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * フィールドの 名前ゆれを 吸収する ための 名前表。
 *
 * SPEC2 の A章で ひらがな → 漢字 に 名前を かえている 最中なので、
 * どちらで 来ても 動くようにしておく。書くときは
 * 「もう ある ほうの 名前」に 書く（かってに キーを ふやさない）。
 */
const 名前表 = {
  横:     ['横', 'よこ'],
  高さ:   ['高さ', 'たかさ'],
  奥行き: ['奥行き', 'おくゆき'],
  向き:   ['向き', 'むき'],
  傾き:   ['傾き', 'かたむき'],
  形:     ['形', 'かたち', '__かたち'],
};

/** もの から フィールドを 読む */
function よむ(o, キー, 既定) {
  const 候補 = 名前表[キー] || [キー];
  for (const k of 候補) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return 既定;
}

/** もの に フィールドを 書く（すでに ある 名前に 書く。なければ 漢字の ほうに 作る） */
function かく(o, キー, 値) {
  const 候補 = 名前表[キー] || [キー];
  let かけた = false;
  for (const k of 候補) {
    if (o && Object.prototype.hasOwnProperty.call(o, k)) { o[k] = 値; かけた = true; }
  }
  if (!かけた && o) o[候補[0]] = 値;
}

/** その もの と、その 親ぜんぶが 見えているか */
function ほんとに見える(m) {
  let n = m;
  while (n) { if (n.visible === false) return false; n = n.parent; }
  return true;
}

/** 数だけを くらべて、おなじ 中身か しらべる */
function おなじ(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (Math.abs(数(a[k]) - 数(b[k])) > 1e-6) return false;
  return true;
}

// 3つの じくの 色（ロブロックス・スタジオと おなじ ならび）
const じくたち = [
  { k: 'x', 色: 0xff4e60, 向き: new THREE.Vector3(1, 0, 0) },
  { k: 'y', 色: 0x5ae182, 向き: new THREE.Vector3(0, 1, 0) },
  { k: 'z', 色: 0x46a0ff, 向き: new THREE.Vector3(0, 0, 1) },
];

/** じく → おおきさの フィールド名 */
const じくの大きさ = { x: '横', y: '高さ', z: '奥行き' };

const 道具名 = { 移動: '移動', 大きさ: '大きさ', 回転: '回転' };

// ============================================================
//  Editor 本体
// ============================================================
export class Editor {
  /**
   * @param game runtime.js の Game。
   *             game.scene / game.camera / game.canvas / game.世界のもの を つかう。
   */
  constructor(game) {
    this.game = game || null;

    // --- 外に 出す しらせ（画面側が つなぎかえる）-------------------
    /** 画面で クリックして えらばれた（null も ありうる） */
    this.onSelect = () => {};
    /** ドラッグで 中身が かわった。patch は
     *  { x, y, z } / { 横, 高さ, 奥行き } / { 向き, 傾き } の どれか */
    this.onChange = () => {};
    /** Ctrl+D。じっさいの データは 画面側が 持っているので おねがいする */
    this.onDuplicate = () => {};
    /** Delete。おなじく 画面側に おねがいする */
    this.onDelete = () => {};

    // --- 中で つかう ものたち ---------------------------------------
    this._on = false;              // 有効かどうか
    this._選んだ = null;            // えらんでいる ものの id（null で なし）
    this._道具 = '移動';            // '移動' | '大きさ' | '回転'

    this._ギズモ = null;            // やじるしの 入れもの
    this._つまみ = [];              // じくごとの Group
    this._わく = null;              // 黄色い わく
    this._すてる物 = [];            // dispose する geometry / material

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    this._ドラッグ = null;          // つかんでいる とちゅうの 情報
    this._押した = new Set();        // いま おされている キー
    this._右 = false;               // 右ボタン
    this._中 = false;               // 中ボタン
    this._まえ = { x: 0, y: 0 };     // マウスの ひとつ前の いち
    this._ゆび = null;              // ゆびの じょうたい

    this._カメラ = { 位置: new THREE.Vector3(9, 7, 12), よこ: -2.5, たて: -0.42 };
    this._とぶ速さ = 14;

    this._もどす表 = [];            // Ctrl+Z 用（30手 以上 のこす）
    this._もどす上限 = 60;
    this._さいごの記録 = 0;

    this._きざみ = 0.25;            // ますめ。0 で そろえない
    this._回転きざみ = 15;          // かいてんは 15ど きざみ

    this._待ち = null;              // まだ 送っていない onChange
    this._送った = null;            // さいごに 送った 中身（同じものは 送らない）
    this._送った時 = 0;
    this._送る間隔 = 60;            // ミリびょう。連打すると 画面側が おもくなる

    this._イベント = [];            // はずすための ひかえ
    this._ループ番号 = 0;
    this._前の時 = 0;
    this._canvasの元 = null;        // canvas の 見た目を もとに もどす ための ひかえ

    /**
     * runtime が 止まっている あいだ 画面を えがいてくれない ときだけ true にする。
     * ふつうは runtime.js が えがき続けるので false のまま（二重に えがかない）。
     */
    this.えがく = false;

    // ドラッグ中の 使いまわし用（毎フレーム new しない）
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  // ==========================================================
  //  1. 外から よぶ しごと（SPEC2 D-1 の 契約）
  // ==========================================================

  /**
   * 編集を 入 / 切 する。
   * 切のときは イベントを ひとつも 拾わず、やじるしも わくも 消す。
   * （プレイ中に ゲームの そうさを じゃましない ため）
   */
  有効(on) {
    const ほしい = !!on;
    if (ほしい === this._on) return;
    this._on = ほしい;
    if (ほしい) {
      this._組み立てる();
      this._イベントをつける();
      this._カメラをもらう();
      this._前の時 = performance.now();
      this._ループ番号 = requestAnimationFrame(this._まわす);
    } else {
      this._イベントをはずす();
      this._片づける();
    }
  }

  /**
   * ものを えらぶ（画面の 一覧から えらんだ とき など）。
   * null で えらぶのを やめる。ここでは onSelect は よばない
   * （よんだ 相手に そのまま 返すと ぐるぐる 回ってしまう ため）。
   */
  選ぶ(id) {
    const ある = id != null && this._ものを取る(id);
    this._選んだ = ある ? id : null;
    this._ドラッグ = null;
    this._見た目を合わせる();
  }

  /** 道具を かえる。'移動' | '大きさ' | '回転' */
  道具(name) {
    const n = 道具名[name] ||
      ({ move: '移動', scale: '大きさ', rotate: '回転' }[name]) || null;
    if (!n) return;
    this._道具 = n;
    this._ドラッグ = null;
    this._やじるしの形をそろえる();
  }

  /**
   * 設定パネルの 数字が かわった → 3D に うつす。
   * patch は { x, y, z } / { 横, 高さ, 奥行き } / { 向き, 傾き } の どれか
   * （その うち かわった ぶんだけで よい）。
   * ここから onChange は よばない（もともと 画面側が 知っている ため）。
   */
  更新(id, patch) {
    const o = this._ものを取る(id);
    if (!o || !patch) return;
    this._記録する(id);          // 数字を いじった ぶんも Ctrl+Z で もどせる
    for (const k of ['x', 'y', 'z']) {
      if (patch[k] !== undefined) o[k] = 数(patch[k], 数(o[k]));
    }
    for (const k of ['横', '高さ', '奥行き']) {
      if (patch[k] !== undefined) かく(o, k, Math.max(0.05, 数(patch[k], 1)));
    }
    for (const k of ['向き', '傾き']) {
      if (patch[k] !== undefined) かく(o, k, 数(patch[k], 0));
    }
    this._ものにうつす(o);
    this._見た目を合わせる();
  }

  /** ぜんぶ 片づける。もう つかわない ときに よぶ */
  こわす() {
    this.有効(false);
    this._もどす表 = [];
    this._待ち = null;
    this._送った = null;
    this.game = null;
  }

  /**
   * ますめに そろえるか どうか。
   * 引数なしで よぶと 入 / 切 が 入れかわる。いまの じょうたいを 返す。
   */
  そろえる(on) {
    const 次 = (on === undefined) ? !(this._きざみ > 0) : !!on;
    this._きざみ = 次 ? 0.25 : 0;
    return 次;
  }

  /** いま そろえているか */
  そろえてる() { return this._きざみ > 0; }

  /** いま えらんでいる ものの id（null も ありうる） */
  えらんでいる() { return this._選んだ; }

  /** いまの 道具の 名前 */
  いまの道具() { return this._道具; }

  // ==========================================================
  //  2. やじるし（ギズモ）と 黄色い わくを 組み立てる / 片づける
  // ==========================================================

  /** dispose する ものを ひかえておく */
  _ひかえる(x) { this._すてる物.push(x); return x; }

  _組み立てる() {
    const scene = this.game && this.game.scene;
    if (!scene || this._ギズモ) return;

    // --- 黄色い わく（1×1×1 の はこの ふち。おおきさは 毎フレーム 合わせる）---
    const わくGeo = this._ひかえる(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)));
    const わくMat = this._ひかえる(new THREE.LineBasicMaterial({
      color: 0xffd66e,        // 黄色。えらんだ ものが すぐ わかる
      depthTest: false,       // ものの うしろに かくれないで 光って 見える
      transparent: true,
      opacity: 0.95,
    }));
    this._わく = new THREE.LineSegments(わくGeo, わくMat);
    this._わく.renderOrder = 998;
    this._わく.visible = false;
    this._わく.userData.__editor = true;   // 「これは 道具だよ」の しるし
    scene.add(this._わく);

    // --- やじるし（3じく ぶん）-------------------------------------
    this._ギズモ = new THREE.Group();
    this._ギズモ.visible = false;
    this._ギズモ.userData.__editor = true;
    scene.add(this._ギズモ);
    this._つまみ = [];

    // つかみやすくする ための「見えない ふとい あたり判定」用の ざいりょう
    const すけるMat = this._ひかえる(new THREE.MeshBasicMaterial({ visible: false }));

    for (const a of じくたち) {
      const g = new THREE.Group();
      const mat = this._ひかえる(new THREE.MeshBasicMaterial({ color: a.色, depthTest: false }));

      // ぼう
      const ぼう = new THREE.Mesh(
        this._ひかえる(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8)), mat);
      ぼう.position.y = 0.31;
      // さき（いどう用の やじるし）
      const さき = new THREE.Mesh(
        this._ひかえる(new THREE.ConeGeometry(0.06, 0.17, 10)), mat);
      さき.position.y = 0.70;
      // しかく（おおきさ用の つまみ）
      const しかく = new THREE.Mesh(
        this._ひかえる(new THREE.BoxGeometry(0.11, 0.11, 0.11)), mat);
      しかく.position.y = 0.68;
      しかく.visible = false;
      // わ（かいてん用）
      const わ = new THREE.Mesh(
        this._ひかえる(new THREE.TorusGeometry(0.60, 0.016, 8, 48)), mat);
      わ.rotation.x = Math.PI / 2;
      わ.visible = false;
      // わは ほそくて つまみにくいので、見えない ふとい わを かさねる
      const わつかみ = new THREE.Mesh(
        this._ひかえる(new THREE.TorusGeometry(0.60, 0.09, 6, 32)), すけるMat);
      わつかみ.rotation.x = Math.PI / 2;
      わつかみ.visible = false;
      // ぼうも おなじく、見えない ふとい ぼうを かさねる
      const つかみ = new THREE.Mesh(
        this._ひかえる(new THREE.CylinderGeometry(0.09, 0.09, 0.86, 6)), すけるMat);
      つかみ.position.y = 0.43;

      g.add(ぼう, さき, しかく, つかみ, わ, わつかみ);
      // ぼうは もともと y じくむき。x と z は たおして むきを あわせる
      if (a.k === 'x') g.rotation.z = -Math.PI / 2;
      if (a.k === 'z') g.rotation.x = Math.PI / 2;
      g.renderOrder = 999;
      g.userData = { じく: a.k, 向き: a.向き, ぼう, さき, しかく, つかみ, わ, わつかみ, __editor: true };
      this._ギズモ.add(g);
      this._つまみ.push(g);
    }

    this._やじるしの形をそろえる();
    this._見た目を合わせる();
  }

  /** 有効(false) と こわす() で よぶ。ゴミを ひとつも のこさない */
  _片づける() {
    const scene = this.game && this.game.scene;
    if (this._ギズモ) {
      if (scene) scene.remove(this._ギズモ);
      this._ギズモ = null;
    }
    if (this._わく) {
      if (scene) scene.remove(this._わく);
      this._わく = null;
    }
    this._つまみ = [];
    for (const x of this._すてる物) {
      try { if (x && typeof x.dispose === 'function') x.dispose(); } catch (e) { /* 何もしない */ }
    }
    this._すてる物 = [];
    this._ドラッグ = null;
    this._ゆび = null;
    this._押した.clear();
    this._右 = this._中 = false;
    this._待ち = null;
    if (this._ループ番号) { cancelAnimationFrame(this._ループ番号); this._ループ番号 = 0; }
  }

  /** いまの 道具に あわせて、ぼう／やじるし／しかく／わ の 見え かくれを きめる */
  _やじるしの形をそろえる() {
    const かいてん = this._道具 === '回転';
    for (const g of this._つまみ) {
      const u = g.userData;
      u.ぼう.visible = !かいてん;
      u.つかみ.visible = !かいてん;
      u.さき.visible = this._道具 === '移動';
      u.しかく.visible = this._道具 === '大きさ';
      u.わ.visible = かいてん;
      u.わつかみ.visible = かいてん;
      // かいてんは「向き（y じく）」と「傾き（x じく）」の 2つだけ。
      // z じくの ころがりは ものが 持っていないので 出さない。
      g.visible = !(かいてん && u.じく === 'z');
    }
  }

  // ==========================================================
  //  3. ワールドの ものを さがす
  // ==========================================================

  /** id から ものを 取る */
  _ものを取る(id) {
    const m = this.game && this.game.世界のもの;
    if (!m || id == null) return null;
    const o = (typeof m.get === 'function') ? m.get(id) : m[id];
    return o || null;
  }

  /** いま えらんでいる もの */
  _えらんだもの() { return this._ものを取る(this._選んだ); }

  /** ぜんぶの もの を [id, もの] の ならびで 取る */
  _ものたち() {
    const m = this.game && this.game.世界のもの;
    const 出 = [];
    if (!m) return 出;
    if (typeof m.forEach === 'function' && typeof m.get === 'function') {
      m.forEach((o, id) => { if (o) 出.push([id, o]); });
    } else {
      for (const id of Object.keys(m)) if (m[id]) 出.push([id, m[id]]);
    }
    return 出;
  }

  /** もの の いまの すがた（もどす用の ひかえ） */
  _すがた(o) {
    return {
      x: 数(o.x), y: 数(o.y), z: 数(o.z),
      横: 数(よむ(o, '横', 1), 1),
      高さ: 数(よむ(o, '高さ', 1), 1),
      奥行き: 数(よむ(o, '奥行き', 1), 1),
      向き: 数(よむ(o, '向き', 0)),
      傾き: 数(よむ(o, '傾き', 0)),
    };
  }

  /**
   * もの の フィールドを Mesh に うつす。
   * runtime.js の _ものを同期 と おなじ 計算に そろえてある:
   *   scale = おおきさ ÷ __きじゅん、rotation は YXZ の じゅんで（向き→y, 傾き→x）
   */
  _ものにうつす(o) {
    const m = o && o.__mesh;
    if (!m) return;
    m.position.set(数(o.x), 数(o.y), 数(o.z));

    const 形 = よむ(o, '形', '箱');
    if (形 === 'かんばん') {
      // かんばんは いつも カメラを むく Sprite。まわらない
      m.scale.set(Math.max(0.0001, 数(よむ(o, '横', 1), 1)),
                  Math.max(0.0001, 数(よむ(o, '高さ', 1), 1)), 1);
      return;
    }
    const き = o.__きじゅん || o.__基準 || { x: 1, y: 1, z: 1 };
    m.scale.set(
      Math.max(0.0001, 数(よむ(o, '横', 1), 1) / (き.x || 1)),
      Math.max(0.0001, 数(よむ(o, '高さ', 1), 1) / (き.y || 1)),
      Math.max(0.0001, 数(よむ(o, '奥行き', 1), 1) / (き.z || 1)),
    );
    m.rotation.order = 'YXZ';
    m.rotation.set(ラジ(数(よむ(o, '傾き', 0))), ラジ(数(よむ(o, '向き', 0))), 0);
    m.updateMatrixWorld(true);
  }

  // ==========================================================
  //  4. えらぶ・つかむ
  // ==========================================================

  /** 画面の いちから 3D の 光線を 作る */
  _レイをむける(cx, cy) {
    const canvas = this.game && this.game.canvas;
    const camera = this.game && this.game.camera;
    if (!canvas || !camera) return false;

    // 「どこを さしているか」は 世界の 行列が 新しくないと 計算できない。
    // えがく 直前にしか そろえない つくりも あるので、ここで じぶんで そろえる。
    // （えがきそこねた あとに クリックすると 当たらない、という 不具合よけ）
    if (this.game.scene) this.game.scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    const r = canvas.getBoundingClientRect();
    const w = r.width || canvas.clientWidth || canvas.width || 1;
    const h = r.height || canvas.clientHeight || canvas.height || 1;
    this._ndc.set(((cx - r.left) / w) * 2 - 1, -((cy - r.top) / h) * 2 + 1);
    this._ray.setFromCamera(this._ndc, camera);
    return true;
  }

  /** その ばしょに ある ものの id を さがす（なければ null） */
  _あてる(cx, cy) {
    if (!this._レイをむける(cx, cy)) return null;
    const 的 = [];
    const 持ち主 = new Map();
    for (const [id, o] of this._ものたち()) {
      const m = o.__mesh;
      if (!m || !ほんとに見える(m)) continue;
      的.push(m);
      m.traverse((c) => 持ち主.set(c, id));
    }
    if (!的.length) return null;
    for (const h of this._ray.intersectObjects(的, true)) {
      let n = h.object;
      while (n && !持ち主.has(n)) n = n.parent;
      if (n) return 持ち主.get(n);
    }
    return null;
  }

  /** やじるしを つかめたか？ つかめたら ドラッグを はじめる */
  _やじるしをつかむ(cx, cy) {
    if (!this._ギズモ || !this._ギズモ.visible) return false;
    if (!this._レイをむける(cx, cy)) return false;

    const 当たり = this._ray.intersectObjects(this._つまみ, true)
      .filter((h) => ほんとに見える(h.object));
    if (!当たり.length) return false;

    let g = 当たり[0].object;
    while (g && !g.userData.じく) g = g.parent;
    if (!g) return false;

    return this._つかみはじめ(g.userData.じく, g.userData.向き);
  }

  /** ドラッグの はじまり。いまの すがたを おぼえて、うごかす「板」を きめる */
  _つかみはじめ(じく, 向き) {
    const o = this._えらんだもの();
    if (!o) return false;

    const 中心 = new THREE.Vector3(数(o.x), 数(o.y), 数(o.z));
    // やじるしの むきは ギズモ全体の 向きの ぶんだけ 回っている
    const 世界の向き = 向き.clone().applyQuaternion(this._ギズモ.quaternion).normalize();

    let 板;
    if (this._道具 === '回転') {
      // かいてんは、その じくに すいちょくな 板の上で 角度を はかる
      板 = new THREE.Plane().setFromNormalAndCoplanarPoint(世界の向き.clone(), 中心);
    } else {
      // いどう と おおきさは、じくを ふくみ カメラに 正対する 板の上で うごかす
      const 目 = this._カメラの向き();
      const 法線 = new THREE.Vector3()
        .crossVectors(世界の向き, new THREE.Vector3().crossVectors(目, 世界の向き));
      if (法線.lengthSq() < 1e-8) return false;   // 真横から 見ていて 板が 作れない
      法線.normalize();
      板 = new THREE.Plane().setFromNormalAndCoplanarPoint(法線, 中心);
    }

    const p0 = new THREE.Vector3();
    if (!this._ray.ray.intersectPlane(板, p0)) return false;

    this._記録する(this._選んだ, true);   // ドラッグの まえの すがたを つんでおく
    this._ドラッグ = {
      じく, 向き: 世界の向き, 板, p0, 中心,
      はじめ: this._すがた(o),
      道具: this._道具,
    };
    return true;
  }

  /** ドラッグの とちゅう */
  _つかみ中(cx, cy) {
    const d = this._ドラッグ;
    const o = this._えらんだもの();
    if (!d || !o) return;
    if (!this._レイをむける(cx, cy)) return;

    const p = this._v;
    if (!this._ray.ray.intersectPlane(d.板, p)) return;

    // ---------- かいてん ----------
    if (d.道具 === '回転') {
      const a0 = d.p0.clone().sub(d.中心);
      const a1 = p.clone().sub(d.中心);
      if (a0.lengthSq() < 1e-8 || a1.lengthSq() < 1e-8) return;
      a0.normalize(); a1.normalize();
      let 角 = ド(Math.atan2(this._v2.copy(a0).cross(a1).dot(d.向き), a0.dot(a1)));
      if (this._きざみ > 0) {
        // 15ど きざみ（スタジオと おなじ）
        角 = Math.round(角 / this._回転きざみ) * this._回転きざみ;
      }
      if (d.じく === 'y') かく(o, '向き', r4(d.はじめ.向き + 角));
      else                かく(o, '傾き', r4(d.はじめ.傾き + 角));
      this._ものにうつす(o);
      this._しらせる(this._選んだ, {
        向き: 数(よむ(o, '向き', 0)), 傾き: 数(よむ(o, '傾き', 0)),
      });
      return;
    }

    // ---------- いどう と おおきさ ----------
    let 量 = p.clone().sub(d.p0).dot(d.向き);
    if (this._きざみ > 0) 量 = Math.round(量 / this._きざみ) * this._きざみ;

    if (d.道具 === '移動') {
      // いどうの やじるしは いつも「世界の じく」むき（ギズモを 回していない）ので、
      // その じくの 数字だけを ずらせば よい。
      // ますめに そろえる ときは「はじめの いち ＋ そろえた ずれ」なので、
      // はじめの いちが ますめに 乗っていれば ずっと 0.25 の ばいすう に なる。
      const k = d.じく;
      o.x = d.はじめ.x; o.y = d.はじめ.y; o.z = d.はじめ.z;
      o[k] = r4(d.はじめ[k] + 量);
      this._ものにうつす(o);
      this._しらせる(this._選んだ, { x: o.x, y: o.y, z: o.z });
      return;
    }

    // おおきさ
    const k = d.じく;
    const 名 = じくの大きさ[k];
    const 形 = よむ(o, '形', '箱');
    const 新 = Math.max(0.05, r4(数(d.はじめ[名], 1) + 量));
    かく(o, 名, 新);
    // 玉 は まんまる、筒 は よこ と 奥行き が おなじ でないと おかしくなる
    if (形 === '玉') { かく(o, '横', 新); かく(o, '高さ', 新); かく(o, '奥行き', 新); }
    else if (形 === '筒' && (k === 'x' || k === 'z')) { かく(o, '横', 新); かく(o, '奥行き', 新); }
    this._ものにうつす(o);
    this._しらせる(this._選んだ, {
      横: 数(よむ(o, '横', 1), 1),
      高さ: 数(よむ(o, '高さ', 1), 1),
      奥行き: 数(よむ(o, '奥行き', 1), 1),
    });
  }

  /** ドラッグの おわり。たまっている しらせを 出しきる */
  _つかみおわり() {
    if (!this._ドラッグ) return;
    this._ドラッグ = null;
    this._ながす();
  }

  // ==========================================================
  //  5. 「かわったよ」の しらせ（送りすぎない）
  // ==========================================================

  /**
   * onChange を 出す。ただし
   *   ・中身が まえと おなじなら 出さない
   *   ・ドラッグ中は 60ミリびょうに 1回まで（画面側が じどう保存するので 連打すると おもい）
   * ドラッグが おわったら _ながす() で のこりを かならず 出す。
   */
  _しらせる(id, patch) {
    if (id == null) return;
    const きれい = {};
    for (const k of Object.keys(patch)) きれい[k] = r4(数(patch[k]));
    if (this._送った && this._送った.id === id && おなじ(this._送った.patch, きれい)) return;

    const いま = performance.now();
    if (this._ドラッグ && いま - this._送った時 < this._送る間隔) {
      this._待ち = { id, patch: きれい };     // あとで まとめて 出す
      return;
    }
    this._待ち = null;
    this._送った = { id, patch: きれい };
    this._送った時 = いま;
    try { this.onChange(id, きれい); } catch (e) { console.error(e); }
  }

  /** たまっている しらせを 出しきる */
  _ながす() {
    const w = this._待ち;
    if (!w) return;
    this._待ち = null;
    if (this._送った && this._送った.id === w.id && おなじ(this._送った.patch, w.patch)) return;
    this._送った = w;
    this._送った時 = performance.now();
    try { this.onChange(w.id, w.patch); } catch (e) { console.error(e); }
  }

  // ==========================================================
  //  6. もどす（Ctrl+Z）
  // ==========================================================

  /**
   * かえる まえの すがたを つんでおく。
   * @param むりやり true なら まとめない（ドラッグの はじめは かならず 1手 のこす）
   */
  _記録する(id, むりやり) {
    const o = this._ものを取る(id);
    if (!o) return;
    const いま = performance.now();
    const さいご = this._もどす表[this._もどす表.length - 1];
    // 数字を 1文字ずつ うつと 1文字ごとに つまれてしまうので、
    // おなじ ものを つづけて いじった ぶんは まとめる
    if (!むりやり && さいご && さいご.id === id && いま - this._さいごの記録 < 1200) {
      this._さいごの記録 = いま;
      return;
    }
    this._もどす表.push({ id, 値: this._すがた(o) });
    if (this._もどす表.length > this._もどす上限) this._もどす表.shift();
    this._さいごの記録 = いま;
  }

  /** ひとつ もどす。もどった ぶんは onChange で 画面側にも 知らせる */
  もどす() {
    while (this._もどす表.length) {
      const 手 = this._もどす表.pop();
      const o = this._ものを取る(手.id);
      if (!o) continue;                 // もう 消えた ものは とばす
      const 前 = this._すがた(o);
      const v = 手.値;

      o.x = v.x; o.y = v.y; o.z = v.z;
      かく(o, '横', v.横); かく(o, '高さ', v.高さ); かく(o, '奥行き', v.奥行き);
      かく(o, '向き', v.向き); かく(o, '傾き', v.傾き);
      this._ものにうつす(o);

      // かわった かたまり だけを しらせる（patch の 形を くずさない）
      this._送った = null;
      if (前.x !== v.x || 前.y !== v.y || 前.z !== v.z) {
        this._しらせる(手.id, { x: v.x, y: v.y, z: v.z });
      }
      if (前.横 !== v.横 || 前.高さ !== v.高さ || 前.奥行き !== v.奥行き) {
        this._送った = null;
        this._しらせる(手.id, { 横: v.横, 高さ: v.高さ, 奥行き: v.奥行き });
      }
      if (前.向き !== v.向き || 前.傾き !== v.傾き) {
        this._送った = null;
        this._しらせる(手.id, { 向き: v.向き, 傾き: v.傾き });
      }
      this._見た目を合わせる();
      return true;
    }
    return false;
  }

  // ==========================================================
  //  7. カメラ（スタジオと おなじ そうさ）
  // ==========================================================

  /** いま カメラが 見ている むき */
  _カメラの向き() {
    const c = this._カメラ;
    const cp = Math.cos(c.たて);
    return new THREE.Vector3(Math.sin(c.よこ) * cp, Math.sin(c.たて), Math.cos(c.よこ) * cp);
  }

  /** いまの game.camera の いちと むきを 引きつぐ（有効(true) の とき） */
  _カメラをもらう() {
    const cam = this.game && this.game.camera;
    if (!cam) return;
    this._カメラ.位置.copy(cam.position);
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    if (d.lengthSq() > 1e-8) {
      this._カメラ.たて = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, d.y)))));
      this._カメラ.よこ = Math.atan2(d.x, d.z);
    }
  }

  /** みまわす */
  _みまわす(dx, dy) {
    this._カメラ.よこ -= dx * 0.0032;
    this._カメラ.たて = Math.max(-1.5, Math.min(1.5, this._カメラ.たて - dy * 0.0032));
  }

  /** よこ・たてに ずれる */
  _ずれる(dx, dy) {
    const d = this._カメラの向き();
    const 右 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const 上 = new THREE.Vector3().crossVectors(右, d).normalize();
    const s = 0.0022 * Math.max(3, this._カメラ.位置.length());
    this._カメラ.位置.addScaledVector(右, -dx * s);
    this._カメラ.位置.addScaledVector(上, dy * s);
  }

  /** 前後に うごく（＋で 近づく） */
  _よる(量) {
    this._カメラ.位置.addScaledVector(
      this._カメラの向き(), 量 * Math.max(0.6, this._カメラ.位置.length() * 0.5));
  }

  /** 右クリックを おしている あいだだけ 飛べる（スタジオと おなじ） */
  _とぶ(dt) {
    if (!this._右) return;
    const d = this._カメラの向き();
    const 右 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3();
    const k = this._押した;
    if (k.has('KeyW')) v.add(d);
    if (k.has('KeyS')) v.sub(d);
    if (k.has('KeyD')) v.add(右);
    if (k.has('KeyA')) v.sub(右);
    if (k.has('KeyE')) v.y += 1;
    if (k.has('KeyQ')) v.y -= 1;
    if (v.lengthSq() > 0) {
      v.normalize().multiplyScalar(this._とぶ速さ * dt * (k.has('ShiftLeft') ? 2.6 : 1));
      this._カメラ.位置.add(v);
    }
  }

  /** F キー。えらんだ ものに よる */
  よせる() {
    const o = this._えらんだもの();
    if (!o) return;
    const c = new THREE.Vector3(数(o.x), 数(o.y), 数(o.z));
    const 大 = Math.max(
      数(よむ(o, '横', 1), 1), 数(よむ(o, '高さ', 1), 1), 数(よむ(o, '奥行き', 1), 1));
    const きょり = Math.max(2.2, 大 * 2.2);
    this._カメラ.位置.copy(c).addScaledVector(this._カメラの向き(), -きょり);
  }

  // ==========================================================
  //  8. イベント（有効(true) の あいだ だけ つける）
  // ==========================================================

  /** はずせるように ひかえながら つける */
  _つける(的, 種, 手, opt) {
    的.addEventListener(種, 手, opt);
    this._イベント.push([的, 種, 手, opt]);
  }

  _イベントをつける() {
    const canvas = this.game && this.game.canvas;
    if (!canvas) return;

    // --- 左ドラッグで「画像を ドラッグ」の ゴーストが 出ない ように する ---
    //     （実際に 起きた 不具合。4つ ぜんぶ 入れて はじめて 止まる）
    this._canvasの元 = {
      webkitUserDrag: canvas.style.webkitUserDrag || '',
      userSelect: canvas.style.userSelect || '',
      touchAction: canvas.style.touchAction || '',
      draggable: canvas.getAttribute('draggable'),
    };
    canvas.style.webkitUserDrag = 'none';
    canvas.style.userSelect = 'none';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('draggable', 'false');

    const とめる = (e) => { e.preventDefault(); return false; };
    this._つける(canvas, 'dragstart', とめる);
    this._つける(canvas, 'selectstart', とめる);
    this._つける(document, 'dragstart', とめる);
    this._つける(canvas, 'contextmenu', とめる);

    // --- マウス -----------------------------------------------------
    this._つける(canvas, 'mousedown', this._押す);
    this._つける(window, 'mousemove', this._うごく);
    this._つける(window, 'mouseup', this._はなす);
    this._つける(canvas, 'wheel', this._ホイール, { passive: false });

    // --- キー -------------------------------------------------------
    this._つける(window, 'keydown', this._キー押す);
    this._つける(window, 'keyup', this._キー離す);
    this._つける(window, 'blur', this._ぼんやり);

    // --- ゆび（学校の タブレット用）---------------------------------
    this._つける(canvas, 'touchstart', this._ゆび始め, { passive: false });
    this._つける(canvas, 'touchmove', this._ゆび中, { passive: false });
    this._つける(canvas, 'touchend', this._ゆび終わり, { passive: false });
    this._つける(canvas, 'touchcancel', this._ゆび消し, { passive: true });
  }

  _イベントをはずす() {
    for (const [的, 種, 手, opt] of this._イベント) {
      try { 的.removeEventListener(種, 手, opt); } catch (e) { /* 何もしない */ }
    }
    this._イベント = [];

    const canvas = this.game && this.game.canvas;
    if (canvas && this._canvasの元) {
      canvas.style.webkitUserDrag = this._canvasの元.webkitUserDrag;
      canvas.style.userSelect = this._canvasの元.userSelect;
      canvas.style.touchAction = this._canvasの元.touchAction;
      if (this._canvasの元.draggable === null) canvas.removeAttribute('draggable');
      else canvas.setAttribute('draggable', this._canvasの元.draggable);
    }
    this._canvasの元 = null;
  }

  // --- マウス ---------------------------------------------------------

  _押す = (e) => {
    if (!this._on) return;
    this._まえ.x = e.clientX; this._まえ.y = e.clientY;
    if (e.button === 2) { this._右 = true; e.preventDefault(); return; }
    if (e.button === 1) { this._中 = true; e.preventDefault(); return; }
    if (e.button !== 0) return;

    // ここで preventDefault しないと、ブラウザが「画像を ドラッグ」しはじめて
    // 半とうめいの ゴーストが ついてきてしまう（実際に 起きた 不具合）
    e.preventDefault();

    // まず やじるしを ねらう。つかめたら そのまま ドラッグ
    if (this._やじるしをつかむ(e.clientX, e.clientY)) return;
    this._えらび直す(e.clientX, e.clientY);
  };

  _うごく = (e) => {
    if (!this._on) return;
    // movementX は 合成イベントだと 0 のことが あるので、
    // ひとつ前の いちからの ずれも つかう
    const dx = e.movementX || (e.clientX - this._まえ.x);
    const dy = e.movementY || (e.clientY - this._まえ.y);
    this._まえ.x = e.clientX; this._まえ.y = e.clientY;

    if (this._右) this._みまわす(dx, dy);
    else if (this._中) this._ずれる(dx, dy);
    else if (this._ドラッグ) this._つかみ中(e.clientX, e.clientY);
  };

  _はなす = (e) => {
    if (!this._on) return;
    if (e.button === 2) this._右 = false;
    if (e.button === 1) this._中 = false;
    if (e.button === 0) this._つかみおわり();
  };

  _ホイール = (e) => {
    if (!this._on) return;
    e.preventDefault();
    this._よる(-Math.sign(e.deltaY) * 0.14);
  };

  // --- キー -----------------------------------------------------------

  _キー押す = (e) => {
    if (!this._on) return;
    const t = e.target;
    // 文字を うっている とちゅうは 何も しない
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this._押した.add(e.code);

    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') { this.もどす(); e.preventDefault(); return; }
      if (e.code === 'KeyD') {
        if (this._選んだ != null) { try { this.onDuplicate(this._選んだ); } catch (err) { console.error(err); } }
        e.preventDefault();
        return;
      }
      return;   // ほかの Ctrl+○ は ブラウザに ゆずる
    }

    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (this._選んだ != null) {
        const id = this._選んだ;
        this.選ぶ(null);
        try { this.onDelete(id); } catch (err) { console.error(err); }
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyF') { this.よせる(); return; }
    if (e.code === 'KeyG') { this.そろえる(); return; }
    if (e.code === 'Escape') {
      if (this._選んだ != null) { this.選ぶ(null); try { this.onSelect(null); } catch (err) { console.error(err); } }
      return;
    }

    // 右ドラッグ中の W / E は「とぶ」ための キーなので 道具を かえない
    if (!this._右) {
      if (e.code === 'KeyW') this.道具('移動');
      else if (e.code === 'KeyE') this.道具('大きさ');
      else if (e.code === 'KeyR') this.道具('回転');
    }
  };

  _キー離す = (e) => { this._押した.delete(e.code); };

  _ぼんやり = () => {
    // ほかの まどに 行った ときに キーが おされっぱなしに ならないように
    this._押した.clear();
    this._右 = this._中 = false;
    this._つかみおわり();
  };

  // --- ゆび -----------------------------------------------------------

  _ゆびの間 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  _ゆびの中 = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  _ゆび始め = (e) => {
    if (!this._on) return;
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      // まず やじるしを ねらう。つかめたら そのまま ドラッグ
      const つかめた = this._やじるしをつかむ(t.clientX, t.clientY);
      this._ゆび = {
        種: つかめた ? 'やじるし' : 'みまわす',
        前: { x: t.clientX, y: t.clientY },
        はじめ: { x: t.clientX, y: t.clientY },
        時: performance.now(),
        うごき: 0,
      };
    } else if (e.touches.length >= 2) {
      this._ドラッグ = null;
      this._ゆび = {
        種: '2本',
        間: this._ゆびの間(e.touches[0], e.touches[1]),
        中: this._ゆびの中(e.touches[0], e.touches[1]),
      };
    }
  };

  _ゆび中 = (e) => {
    if (!this._on || !this._ゆび) return;
    e.preventDefault();

    if (this._ゆび.種 === '2本' && e.touches.length >= 2) {
      const d = this._ゆびの間(e.touches[0], e.touches[1]);
      const m = this._ゆびの中(e.touches[0], e.touches[1]);
      this._よる((d - this._ゆび.間) * 0.012);        // ひろげると 近づく
      this._ずれる(m.x - this._ゆび.中.x, m.y - this._ゆび.中.y);
      this._ゆび.間 = d; this._ゆび.中 = m;
      return;
    }
    if (e.touches.length !== 1) return;

    const t = e.touches[0];
    const dx = t.clientX - this._ゆび.前.x;
    const dy = t.clientY - this._ゆび.前.y;
    this._ゆび.前 = { x: t.clientX, y: t.clientY };
    this._ゆび.うごき += Math.abs(dx) + Math.abs(dy);

    if (this._ゆび.種 === 'やじるし') this._つかみ中(t.clientX, t.clientY);
    else this._みまわす(dx, dy);
  };

  _ゆび終わり = (e) => {
    if (!this._on || !this._ゆび) return;
    e.preventDefault();
    if (this._ゆび.種 === 'やじるし') {
      this._つかみおわり();
    } else if (this._ゆび.種 === 'みまわす' &&
               this._ゆび.うごき < 12 && performance.now() - this._ゆび.時 < 500) {
      // うごかさずに はなしたら「タップして えらんだ」
      this._えらび直す(this._ゆび.はじめ.x, this._ゆび.はじめ.y);
    }
    this._ゆび = e.touches.length ? this._ゆび : null;
  };

  _ゆび消し = () => { this._ゆび = null; this._つかみおわり(); };

  /** 画面を さわって えらび直す。ここでだけ onSelect を 出す */
  _えらび直す(cx, cy) {
    const id = this._あてる(cx, cy);
    const まえ = this._選んだ;
    this.選ぶ(id);
    if (id !== まえ) {
      try { this.onSelect(this._選んだ); } catch (e) { console.error(e); }
    }
  }

  // ==========================================================
  //  9. 毎フレームの しごと
  // ==========================================================

  /** わく と やじるしを、えらんでいる ものに ぴったり 合わせる */
  _見た目を合わせる() {
    const o = this._えらんだもの();
    const ある = !!(o && o.__mesh);

    if (this._わく) {
      this._わく.visible = ある;
      if (ある) {
        const m = o.__mesh;
        this._わく.position.set(数(o.x), 数(o.y), 数(o.z));
        this._わく.rotation.order = 'YXZ';
        this._わく.rotation.set(ラジ(数(よむ(o, '傾き', 0))), ラジ(数(よむ(o, '向き', 0))), 0);
        // わくは 中身より ほんの少し 大きく して、めり込んで ちらつかないように する
        this._わく.scale.set(
          Math.max(0.02, 数(よむ(o, '横', 1), 1)) * 1.02,
          Math.max(0.02, 数(よむ(o, '高さ', 1), 1)) * 1.02,
          Math.max(0.02, 数(よむ(o, '奥行き', 1), 1)) * 1.02,
        );
        if (m.visible === false) this._わく.visible = false;
      }
    }

    if (this._ギズモ) {
      this._ギズモ.visible = ある;
      if (ある) {
        const c = this._v.set(数(o.x), 数(o.y), 数(o.z));
        this._ギズモ.position.copy(c);
        // いどうは いつも 世界の じく。おおきさ・かいてんは ものの 向きに あわせる
        this._ギズモ.rotation.order = 'YXZ';
        if (this._道具 === '移動') this._ギズモ.rotation.set(0, 0, 0);
        else if (this._道具 === '回転') this._ギズモ.rotation.set(0, ラジ(数(よむ(o, '向き', 0))), 0);
        else this._ギズモ.rotation.set(ラジ(数(よむ(o, '傾き', 0))), ラジ(数(よむ(o, '向き', 0))), 0);

        // 画面での 大きさが いつも おなじに 見えるように、きょりで 大きくする
        const cam = this.game && this.game.camera;
        const きょり = cam ? cam.position.distanceTo(c) : 10;
        this._ギズモ.scale.setScalar(Math.max(0.35, きょり * 0.34));
      }
    }
  }

  _まわす = () => {
    if (!this._on) return;
    this._ループ番号 = requestAnimationFrame(this._まわす);

    const いま = performance.now();
    const dt = Math.min(0.05, (いま - this._前の時) / 1000);
    this._前の時 = いま;

    // カメラ
    this._とぶ(dt);
    const cam = this.game && this.game.camera;
    if (cam) {
      cam.position.copy(this._カメラ.位置);
      cam.lookAt(this._カメラ.位置.clone().add(this._カメラの向き()));
    }

    // わく と やじるし
    this._見た目を合わせる();

    // たまっていた しらせを 出す（ドラッグ中の 間引きぶん）
    if (this._待ち && いま - this._送った時 >= this._送る間隔) this._ながす();

    // runtime が 止まっている あいだ えがいてくれない ときの ための 逃げ道
    if (this.えがく && this.game && this.game.renderer && this.game.scene && cam) {
      this.game.renderer.render(this.game.scene, cam);
    }
  };
}

export default Editor;
