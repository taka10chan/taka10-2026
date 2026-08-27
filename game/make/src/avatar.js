/**
 * avatar.js — ロブロックスの R15 みたいな プレイヤーを作る。
 *
 * SPEC2.md「C. プレイヤーを R15 アバターにする」のとおりに作っています。
 *
 * ・15 個の パーツ（頭・上胴・下胴・両腕6・両脚6）を 親子でつなぐ
 * ・回るところ（関節）は かならず Object3D。その子に Mesh を ずらして入れる
 *   → parts["右上腕"].rotation.x = 0.5  で 肩から 腕ぜんぶが ふれる
 * ・角は 丸い（面取りした箱を 自分で作っています。ロブロックスの角も丸い）
 * ・足元が y = 0、正面は -z、ぜんたいの高さは 5.0
 *
 * 使い方:
 *
 *     import { buildR15, 歩きポーズ } from './avatar.js';
 *     const ひと = buildR15();
 *     scene.add(ひと.group);
 *     ひと.group.position.set(0, 0, 0);     // 足元が y=0 なので そのまま置ける
 *     歩きポーズ(ひと.parts, (t % 1));       // t は 0〜1 の くりかえし
 */

import * as THREE from '../../lib/three.module.js';

// ===========================================================================
//  きまった数（SPEC2 C-2 / C-3）
// ===========================================================================

/** ぜんたいの 高さ（足の うらから 頭の てっぺんまで） */
const 高さ = 5.0;

/** 当たり判定の 横はば の半分 */
const 半径 = 1.0;

/** 角を 丸める大きさ。ロブロックスの パーツと 同じくらい */
const 角の丸み = 0.06;

/** 丸みの こまかさ（1つの角を 何分割するか）。3 で じゅうぶん きれい */
const 丸みの分割 = 3;

/**
 * 15 パーツの 大きさ（横 × 高さ × 奥行き）。もとは SPEC2 C-2 の表。
 *
 * ただし 腕の 長さだけ 表より のばしています（上腕 0.85→0.95、前腕 0.75→0.85）。
 * 表のままだと 手が こしの あたりで 終わってしまい、本物の R15 のように
 * 手が 腿の 中ほどまで とどきません。のばした けっかは
 *   肩 3.55 → ひじ 2.60 → 手くび 1.75 → 手の した 1.40
 * で、腿の まんなか（1.60）に 手が 来ます。
 */
const 大きさ表 = {
  頭:    [1.20, 1.10, 1.20],
  上胴:  [1.60, 1.00, 0.85],
  下胴:  [1.55, 0.60, 0.85],
  右上腕: [0.55, 0.95, 0.55],
  右前腕: [0.52, 0.85, 0.52],
  右手:  [0.55, 0.35, 0.55],
  左上腕: [0.55, 0.95, 0.55],
  左前腕: [0.52, 0.85, 0.52],
  左手:  [0.55, 0.35, 0.55],
  右腿:  [0.60, 0.90, 0.62],
  右脛:  [0.57, 0.80, 0.60],
  右足:  [0.62, 0.35, 0.75],
  左腿:  [0.60, 0.90, 0.62],
  左脛:  [0.57, 0.80, 0.60],
  左足:  [0.62, 0.35, 0.75],
};

/**
 * パーツの ならび順。アニメ部屋の track.part 番号（0〜14）が この順番です。
 * parts オブジェクトも かならず この順番で 作ります（Object.keys が この順になる）。
 */
const パーツの順 = [
  '頭', '上胴', '下胴',
  '右上腕', '右前腕', '右手',
  '左上腕', '左前腕', '左手',
  '右腿', '右脛', '右足',
  '左腿', '左脛', '左足',
];

/** 既定の色（SPEC2 C-3） */
const 既定の色 = {
  はだ:  '#f2c9a0',
  シャツ: '#3a7ad6',
  ズボン: '#37414d',
};

// -- 体を 組み立てる ときの 高さ（世界ざひょう。足の うらが y=0）------------
//
//    5.00 ┬ 頭の てっぺん
//    3.90 ┼ 首（頭の 回るところ）
//    3.65 ┼ 上胴の うえ
//    3.55 ┼ 肩
//    2.65 ┼ こし（上胴の した ＝ 上胴の 回るところ）
//    2.60 ┼ ひじ
//    2.35 ┼ 下胴の まんなか（ここが ぜんぶの おおもと）
//    2.05 ┼ また（股）
//    1.75 ┼ 手くび
//    1.60 ┼ 腿の まんなか（ここに 手が 来る）
//    1.40 ┼ 手の した
//    1.15 ┼ ひざ
//    0.35 ┼ 足くび
//    0.00 ┴ 地面
//
//  よこの ならび（正面から 見て すきまが 分かるように）:
//    ・腕  … 肩を x = ±1.12 に。腕の 内がわ 0.845 と 上胴の はし 0.80 で
//            0.045 の すきま。体と 腕が くっついて 見えない。
//    ・脚  … またを x = ±0.365 に。脚と 脚の あいだが 0.13 あく。
//            下胴の はし 0.775 より 内がわ（0.665）なので 股から 離れすぎない。
//
const 首の高さ   = 3.90;
const 肩の高さ   = 3.55;
const こしの高さ = 2.65;
const 下胴の中心 = 2.35;
const またの高さ = 2.05;
const 肩の横     = 1.12;   // 体と 腕の あいだに 0.045 の すきま（R15 らしく）
const またの横   = 0.365;  // 脚と 脚の あいだに 0.13 の すきま（正面から 見て 分かる）

// ===========================================================================
//  角の丸い箱を 作る（RoundedBoxGeometry が 無いので 自分で書く）
// ===========================================================================
//
//  考えかた:
//    大きさ w×h×d の 箱を、ひとまわり小さい 箱（w-2r, h-2r, d-2r）の
//    まわりに 半径 r の まるみを つけた形 と考えます。
//      ・たいらな面 6枚      … ふつうの 四角
//      ・辺の まるみ 12本    … 4分の1の 円柱
//      ・角の まるみ 8個     … 8分の1の 球
//    つなぎ目で 法線（むき）が ぴったり合うように 式を そろえてあるので、
//    見た目は なめらかに つながります。

/** ベクトルの 引き算 */
function 引く(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/** ベクトルの 外積 */
function 外積(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** ベクトルの 内積 */
function 内積(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/**
 * 四角を 1枚（三角2つ）足す。
 * 表と裏を まちがえないように、法線の むきを 見て 順番を 入れかえます。
 * @param 位置 [x,y,z] を 4つ
 * @param 法線 [x,y,z] を 4つ（頂点ごと）
 */
function 四角を足す(P, N, 位置, 法線) {
  // 4つの 法線の へいきん（表裏の 判定に つかう）
  const 平均 = [
    (法線[0][0] + 法線[1][0] + 法線[2][0] + 法線[3][0]) / 4,
    (法線[0][1] + 法線[1][1] + 法線[2][1] + 法線[3][1]) / 4,
    (法線[0][2] + 法線[1][2] + 法線[2][2] + 法線[3][2]) / 4,
  ];
  const むき = 外積(引く(位置[1], 位置[0]), 引く(位置[2], 位置[0]));
  const 順 = 内積(むき, 平均) >= 0
    ? [0, 1, 2, 0, 2, 3]
    : [0, 2, 1, 0, 3, 2];
  for (const i of 順) {
    P.push(位置[i][0], 位置[i][1], 位置[i][2]);
    N.push(法線[i][0], 法線[i][1], 法線[i][2]);
  }
}

/**
 * 角の丸い箱の ジオメトリを 作る。
 * @param {number} w 横
 * @param {number} h 高さ
 * @param {number} d 奥行き
 * @param {number} r 角の 丸み（大きすぎたら 自動で 小さくする）
 * @param {number} n 丸みの 分割数
 * @return {THREE.BufferGeometry} まんなかが 原点。大きさは ちょうど w×h×d
 */
function 丸い箱(w, h, d, r = 角の丸み, n = 丸みの分割) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  // 丸みが 大きすぎると 形が こわれるので おさえる
  r = Math.max(0.001, Math.min(r, hw * 0.9, hh * 0.9, hd * 0.9));
  // ひとまわり 小さい箱（この まわりに 丸みを つける）
  const a = hw - r, b = hh - r, c = hd - r;

  const P = [];   // 頂点の 位置
  const N = [];   // 頂点の むき（法線）

  // --- (1) たいらな面 6枚 -------------------------------------------------
  // +X と -X（横の面）
  for (const sx of [1, -1]) {
    const n0 = [sx, 0, 0];
    四角を足す(P, N,
      [[sx * hw, -b, -c], [sx * hw, -b, c], [sx * hw, b, c], [sx * hw, b, -c]],
      [n0, n0, n0, n0]);
  }
  // +Y と -Y（上と下の面）
  for (const sy of [1, -1]) {
    const n0 = [0, sy, 0];
    四角を足す(P, N,
      [[-a, sy * hh, -c], [a, sy * hh, -c], [a, sy * hh, c], [-a, sy * hh, c]],
      [n0, n0, n0, n0]);
  }
  // +Z と -Z（前と後ろの面）
  for (const sz of [1, -1]) {
    const n0 = [0, 0, sz];
    四角を足す(P, N,
      [[-a, -b, sz * hd], [a, -b, sz * hd], [a, b, sz * hd], [-a, b, sz * hd]],
      [n0, n0, n0, n0]);
  }

  const 半周 = Math.PI / 2;

  // --- (2) 辺の まるみ 12本（4分の1の 円柱）-------------------------------
  // z の むきの 辺 4本
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * 半周, t1 = ((i + 1) / n) * 半周;
      const na = [sx * Math.cos(t0), sy * Math.sin(t0), 0];
      const nb = [sx * Math.cos(t1), sy * Math.sin(t1), 0];
      const pa0 = [sx * a + r * na[0], sy * b + r * na[1], -c];
      const pa1 = [sx * a + r * na[0], sy * b + r * na[1], c];
      const pb0 = [sx * a + r * nb[0], sy * b + r * nb[1], -c];
      const pb1 = [sx * a + r * nb[0], sy * b + r * nb[1], c];
      四角を足す(P, N, [pa0, pa1, pb1, pb0], [na, na, nb, nb]);
    }
  }
  // x の むきの 辺 4本
  for (const sy of [1, -1]) for (const sz of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * 半周, t1 = ((i + 1) / n) * 半周;
      const na = [0, sy * Math.cos(t0), sz * Math.sin(t0)];
      const nb = [0, sy * Math.cos(t1), sz * Math.sin(t1)];
      const pa0 = [-a, sy * b + r * na[1], sz * c + r * na[2]];
      const pa1 = [a, sy * b + r * na[1], sz * c + r * na[2]];
      const pb0 = [-a, sy * b + r * nb[1], sz * c + r * nb[2]];
      const pb1 = [a, sy * b + r * nb[1], sz * c + r * nb[2]];
      四角を足す(P, N, [pa0, pa1, pb1, pb0], [na, na, nb, nb]);
    }
  }
  // y の むきの 辺 4本
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * 半周, t1 = ((i + 1) / n) * 半周;
      const na = [sx * Math.cos(t0), 0, sz * Math.sin(t0)];
      const nb = [sx * Math.cos(t1), 0, sz * Math.sin(t1)];
      const pa0 = [sx * a + r * na[0], -b, sz * c + r * na[2]];
      const pa1 = [sx * a + r * na[0], b, sz * c + r * na[2]];
      const pb0 = [sx * a + r * nb[0], -b, sz * c + r * nb[2]];
      const pb1 = [sx * a + r * nb[0], b, sz * c + r * nb[2]];
      四角を足す(P, N, [pa0, pa1, pb1, pb0], [na, na, nb, nb]);
    }
  }

  // --- (3) 角の まるみ 8個（8分の1の 球）----------------------------------
  // 法線を  n = (sx cosθ cosφ, sy sinφ, sz sinθ cosφ)  と きめると、
  // φ=0 / θ=0 / θ=90° の ふちが (2) の 辺と ぴったり 合います。
  const 角の法線 = (sx, sy, sz, θ, φ) => [
    sx * Math.cos(θ) * Math.cos(φ),
    sy * Math.sin(φ),
    sz * Math.sin(θ) * Math.cos(φ),
  ];
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const θ0 = (i / n) * 半周, θ1 = ((i + 1) / n) * 半周;
      const φ0 = (j / n) * 半周, φ1 = ((j + 1) / n) * 半周;
      const ns = [
        角の法線(sx, sy, sz, θ0, φ0),
        角の法線(sx, sy, sz, θ1, φ0),
        角の法線(sx, sy, sz, θ1, φ1),
        角の法線(sx, sy, sz, θ0, φ1),
      ];
      const ps = ns.map((v) => [sx * a + r * v[0], sy * b + r * v[1], sz * c + r * v[2]]);
      四角を足す(P, N, ps, ns);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * いくつかの ジオメトリを 1つに まとめる（ドローコールを へらすため）。
 * @param {{g:THREE.BufferGeometry, x?:number, y?:number, z?:number, rz?:number}[]} 部品
 */
function 一つにまとめる(部品) {
  const P = [], N = [];
  const m = new THREE.Matrix4();
  const 法線用 = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const b of 部品) {
    m.makeRotationZ(b.rz || 0);
    m.setPosition(b.x || 0, b.y || 0, b.z || 0);
    法線用.getNormalMatrix(m);
    const pa = b.g.attributes.position.array;
    const na = b.g.attributes.normal.array;
    for (let i = 0; i < pa.length; i += 3) {
      v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(m);
      P.push(v.x, v.y, v.z);
      v.set(na[i], na[i + 1], na[i + 2]).applyMatrix3(法線用).normalize();
      N.push(v.x, v.y, v.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}

// ===========================================================================
//  色を あんぜんに 読む
// ===========================================================================

/** 色の 名前として ゆるすもの（これ以外は 既定にもどす。まちがっても 落ちない） */
const 色の名前 = new Set([
  'white', 'black', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
  'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'navy', 'tan',
  'skyblue', 'lime', 'gold', 'silver', 'beige',
]);

/**
 * どんな値が 来ても 落ちないように 色を 決める。
 * つかえるのは 数（0xff0000）、"#ff0000"、"#f00"、かんたんな 英語の色名。
 * それ以外（なし・文字化け・オブジェクト など）は 既定の色に します。
 */
function 色をきめる(値, 既定) {
  try {
    if (typeof 値 === 'number' && Number.isFinite(値) && 値 >= 0 && 値 <= 0xffffff) {
      return new THREE.Color(Math.floor(値));
    }
    if (typeof 値 === 'string') {
      const s = 値.trim();
      if (/^#?[0-9a-fA-F]{3}$/.test(s) || /^#?[0-9a-fA-F]{6}$/.test(s)) {
        return new THREE.Color('#' + s.replace('#', ''));
      }
      if (色の名前.has(s.toLowerCase())) return new THREE.Color(s.toLowerCase());
    }
    if (値 && 値.isColor) return 値.clone();
  } catch (e) {
    // なにが あっても 既定の色で つづける
  }
  return new THREE.Color(既定);
}

// ===========================================================================
//  R15 アバターを 作る
// ===========================================================================

/**
 * R15 の アバターを 作る。
 *
 * @param {{はだ?:string, シャツ?:string, ズボン?:string}} [色] 省略できます
 * @return {{ group: THREE.Group, parts: Object, 高さ: number, 半径: number }}
 *   group … 足元が y=0、正面は -z
 *   parts … SPEC2 C-2 の 15個 ちょうど（キーは 日本語名、中身は Object3D）
 *   高さ  … 5.0
 *   半径  … 1.0
 */
export function buildR15(色) {
  const 指定 = (色 && typeof 色 === 'object') ? 色 : {};

  // ---- 材料（1体で 5つだけ。使いまわす）--------------------------------
  const はだ色 = 色をきめる(指定.はだ, 既定の色.はだ);
  const シャツ色 = 色をきめる(指定.シャツ, 既定の色.シャツ);
  const ズボン色 = 色をきめる(指定.ズボン, 既定の色.ズボン);
  // 靴は ズボンより 暗く（ロブロックスも 足だけ 色がちがう ことが多い）
  const 靴色 = ズボン色.clone().multiplyScalar(0.55);

  const 材 = {
    はだ:  new THREE.MeshLambertMaterial({ color: はだ色 }),
    シャツ: new THREE.MeshLambertMaterial({ color: シャツ色 }),
    ズボン: new THREE.MeshLambertMaterial({ color: ズボン色 }),
    靴:    new THREE.MeshLambertMaterial({ color: 靴色 }),
    顔:    new THREE.MeshLambertMaterial({ color: 0x1b1b1f }),
  };

  // ---- ジオメトリは 同じ大きさなら 使いまわす --------------------------
  //  （右腕と左腕、右脚と左脚 などは まったく同じ 形なので 1つで すむ）
  const ジオ置き場 = new Map();
  const しげん = [];   // あとで dispose できるように おぼえておく
  const 箱ジオ = (w, h, d) => {
    const かぎ = w + '/' + h + '/' + d;
    let g = ジオ置き場.get(かぎ);
    if (!g) { g = 丸い箱(w, h, d); ジオ置き場.set(かぎ, g); しげん.push(g); }
    return g;
  };
  for (const m of Object.values(材)) しげん.push(m);

  // ---- 関節（Object3D）と 見た目（Mesh）を 作る ------------------------
  const parts = {};

  /**
   * 関節を 1つ 作る。
   *   ・Object3D を 関節の ところに 置く（ここが 回る 中心）
   *   ・その子に Mesh を ずらして 入れる
   *  これで parts["右上腕"].rotation.x = 0.5 と すると 肩から 腕ぜんぶが ふれる。
   *
   * @param 名前   15パーツの 日本語名
   * @param 親     親の Object3D（いちばん上は null）
   * @param 位置   親の 関節から見た この関節の 場所 [x,y,z]
   * @param ずらし 関節から見た Mesh の まんなかの 場所 [x,y,z]
   * @param 材料   MeshLambertMaterial
   * @param 服     true なら いろ() で 色が かわる パーツ
   */
  function 関節(名前, 親, 位置, ずらし, 材料, 服) {
    const j = new THREE.Object3D();
    j.name = 名前;
    j.position.set(位置[0], 位置[1], 位置[2]);
    const [w, h, d] = 大きさ表[名前];
    const mesh = new THREE.Mesh(箱ジオ(w, h, d), 材料);
    mesh.position.set(ずらし[0], ずらし[1], ずらし[2]);
    mesh.name = 名前 + 'の見た目';
    if (服) mesh.__いろつく = true;   // runtime の いろ() で 色を かえられる
    j.add(mesh);
    if (親) 親.add(j);
    j.userData.見た目 = mesh;
    j.userData.大きさ = [w, h, d];
    parts[名前] = j;          // 15パーツの 表に 登録
    return j;
  }

  // --- 下胴（ぜんぶの おおもと）------------------------------------------
  //  ここだけ 関節が まんなか。体ぜんたいを 前に たおしたい ときに 自然。
  const 下胴 = 関節('下胴', null, [0, 下胴の中心, 0], [0, 0, 0], 材.ズボン, true);

  // --- 上胴（こしで 回る）------------------------------------------------
  const 上胴 = 関節('上胴', 下胴,
    [0, こしの高さ - 下胴の中心, 0],      // こし = 上胴の した
    [0, 大きさ表.上胴[1] / 2, 0],          // Mesh は 関節から 上に
    材.シャツ, true);

  // --- 首（かざり。パーツ15個には 入れない）------------------------------
  //  上胴の うえ（3.65）と 頭の した（3.90）の あいだを うめます。
  const 首ジオ = new THREE.CylinderGeometry(0.33, 0.36, 0.34, 14, 1, true);
  しげん.push(首ジオ);
  const 首 = new THREE.Mesh(首ジオ, 材.はだ);
  首.position.set(0, (3.79 - こしの高さ), 0);
  首.name = '首';
  上胴.add(首);

  // --- 頭（首で 回る）----------------------------------------------------
  const 頭 = 関節('頭', 上胴,
    [0, 首の高さ - こしの高さ, 0],
    [0, 大きさ表.頭[1] / 2, 0],
    材.はだ, false);

  // --- 顔（目2つ ＋ うっすら 口）。正面は -z ------------------------------
  //  小さい箱を 7つ ならべて、1つの ジオメトリに まとめます（ドローコール 1）。
  {
    const 頭の高さ = 大きさ表.頭[1];
    const 顔のz = -大きさ表.頭[2] / 2 - 0.008;   // ほんの少し 前に 出す
    const 目の高さ = 頭の高さ / 2 + 0.10;
    const 口の高さ = 頭の高さ / 2 - 0.19;

    const 目ジオ = 丸い箱(0.140, 0.205, 0.045, 0.055, 2);
    const 口ジオ = 丸い箱(0.145, 0.050, 0.04, 0.022, 1);
    const 部品 = [
      { g: 目ジオ, x: -0.235, y: 目の高さ, z: 顔のz },
      { g: 目ジオ, x:  0.235, y: 目の高さ, z: 顔のz },
      // 口は 小さい ぼうを 5つ かさねて うっすら 笑った 形に
      { g: 口ジオ, x: -0.172, y: 口の高さ + 0.043, z: 顔のz, rz: -0.60 },
      { g: 口ジオ, x: -0.088, y: 口の高さ + 0.008, z: 顔のz, rz: -0.24 },
      { g: 口ジオ, x:  0.000, y: 口の高さ,         z: 顔のz, rz: 0 },
      { g: 口ジオ, x:  0.088, y: 口の高さ + 0.008, z: 顔のz, rz: 0.24 },
      { g: 口ジオ, x:  0.172, y: 口の高さ + 0.043, z: 顔のz, rz: 0.60 },
    ];
    const 顔ジオ = 一つにまとめる(部品);
    目ジオ.dispose();
    口ジオ.dispose();
    しげん.push(顔ジオ);
    const 顔 = new THREE.Mesh(顔ジオ, 材.顔);
    顔.name = '顔';
    頭.add(顔);
  }

  // --- 腕（肩 → ひじ → 手くび）-------------------------------------------
  //  肩は 上胴の 子。ひじは 上腕の 子。手は 前腕の 子。
  //  こうすると 肩を 回すだけで 腕ぜんぶが ついてきます。
  const 腕を作る = (みぎ) => {
    const s = みぎ ? 1 : -1;              // 正面が -z なので、右手は +x がわ
    const 上 = みぎ ? '右上腕' : '左上腕';
    const 前 = みぎ ? '右前腕' : '左前腕';
    const 手 = みぎ ? '右手' : '左手';
    const 上腕 = 関節(上, 上胴,
      [s * 肩の横, 肩の高さ - こしの高さ, 0],   // 肩
      [0, -大きさ表[上][1] / 2, 0],       // Mesh は 関節（肩）から 下に
      材.シャツ, true);
    const 前腕 = 関節(前, 上腕,
      [0, -大きさ表[上][1], 0],           // ひじ = 上腕の した はし
      [0, -大きさ表[前][1] / 2, 0],
      材.シャツ, true);
    関節(手, 前腕,
      [0, -大きさ表[前][1], 0],           // 手くび = 前腕の した はし
      [0, -大きさ表[手][1] / 2, 0],
      材.はだ, false);
  };
  腕を作る(true);
  腕を作る(false);

  // --- 脚（また → ひざ → 足くび）-----------------------------------------
  const 脚を作る = (みぎ) => {
    const s = みぎ ? 1 : -1;
    const 腿 = みぎ ? '右腿' : '左腿';
    const 脛 = みぎ ? '右脛' : '左脛';
    const 足 = みぎ ? '右足' : '左足';
    const 腿j = 関節(腿, 下胴,
      [s * またの横, またの高さ - 下胴の中心, 0],
      [0, -大きさ表[腿][1] / 2, 0],
      材.ズボン, true);
    const 脛j = 関節(脛, 腿j,
      [0, -大きさ表[腿][1], 0],
      [0, -大きさ表[脛][1] / 2, 0],
      材.ズボン, true);
    関節(足, 脛j,
      [0, -大きさ表[脛][1], 0],
      // つま先が すこし 前（-z）に 出るように ずらす
      [0, -大きさ表[足][1] / 2, -0.065],
      材.靴, true);
  };
  脚を作る(true);
  脚を作る(false);

  // ---- parts を SPEC2 C-2 の 順番（0〜14）で ならべ直す ------------------
  //  アニメ部屋の track.part 番号が この順番に なります。
  const ならべた = {};
  for (const 名 of パーツの順) ならべた[名] = parts[名];

  // ---- group（足元が y=0）-----------------------------------------------
  const group = new THREE.Group();
  group.name = 'R15';
  group.add(下胴);
  group.userData.しげん = しげん;      // runtime が 片づけたいとき用
  group.userData.parts = ならべた;
  group.userData.パーツの順 = パーツの順.slice();

  // 立っている ときの 姿勢を おぼえる（歩きポーズの 土台）
  for (const 名 of パーツの順) {
    const p = ならべた[名];
    p.userData.もとの位置 = p.position.clone();
    p.userData.もとの回転 = p.rotation.clone();
  }

  return { group, parts: ならべた, 高さ, 半径 };
}

// ===========================================================================
//  歩きの 見本ポーズ
// ===========================================================================

/**
 * 歩きの 見本ポーズ。
 * 腕と 脚が 逆の むきに ふれる、すなおな 歩きです。
 * 腿と 上腕が おもに ふれて、ひざと ひじは すこしだけ 曲がります。
 *
 * 使う人が アニメ部屋で 自分の 歩きを 作ったら、runtime は こちらを 止めます。
 *
 * @param {Object} parts buildR15 が 返した parts
 * @param {number} t     0〜1 の くりかえし（1 で ひとまわり）
 */
export function 歩きポーズ(parts, t) {
  if (!parts || typeof parts !== 'object') return;
  const 時 = Number.isFinite(t) ? t : 0;
  const θ = 時 * Math.PI * 2;

  // ふれの 大きさ
  const 腿のふれ = 0.55;
  const 腕のふれ = 0.50;

  const s = Math.sin(θ);          // 右脚が 前のとき ＋
  const 反 = -s;                  // 左脚は 逆

  // かんたんな 書きかえ（パーツが なくても 落ちない）
  const 回す = (名, x) => {
    const p = parts[名];
    if (p && p.rotation) p.rotation.x = x;
  };

  // --- 腿（歩きの 主役）---------------------------------------------------
  //  rotation.x が ＋ だと 前（-z）に ふれます。
  回す('右腿', 腿のふれ * s);
  回す('左腿', 腿のふれ * 反);

  // --- ひざ（すこしだけ）-------------------------------------------------
  //  地面を けった すぐ あとに いちばん 曲がります。
  //  ひざは 後ろにしか 曲がらないので マイナスに します。
  const ひざ = (位相) => -0.62 * Math.max(0, Math.cos(θ + 位相 + Math.PI / 4));
  回す('右脛', ひざ(0));
  回す('左脛', ひざ(Math.PI));

  // --- 足くび（ほんの すこし。ぺたぺたしないように）------------------------
  回す('右足', 0.16 * Math.max(0, Math.cos(θ + Math.PI / 4)));
  回す('左足', 0.16 * Math.max(0, Math.cos(θ + Math.PI + Math.PI / 4)));

  // --- 上腕（脚と 逆の むきに ふる）---------------------------------------
  回す('右上腕', 腕のふれ * 反);
  回す('左上腕', 腕のふれ * s);

  // --- ひじ（すこしだけ 曲げる。ひじは 前にしか 曲がらないので プラス）------
  回す('右前腕', 0.22 + 0.20 * Math.max(0, s));
  回す('左前腕', 0.22 + 0.20 * Math.max(0, 反));

  // --- 上半身（歩きに あわせて ほんの すこし ひねる）----------------------
  const 上胴 = parts['上胴'];
  if (上胴 && 上胴.rotation) {
    上胴.rotation.y = 0.10 * 反;
    上胴.rotation.x = 0.05;          // すこし 前かがみ
  }
  const 頭 = parts['頭'];
  if (頭 && 頭.rotation) 頭.rotation.y = 0.05 * s;

  // --- 上下の はずみ（下胴を すこし 上下させる）---------------------------
  //  脚を 大きく ひらいた とき（t = 0.25 / 0.75）が いちばん こしが 低い。
  //  ここで 下げると 足が 地面から うきにくく なります。
  const 下胴 = parts['下胴'];
  if (下胴 && 下胴.position) {
    if (!下胴.userData.もとの位置) 下胴.userData.もとの位置 = 下胴.position.clone();
    const もと = 下胴.userData.もとの位置;
    下胴.position.y = もと.y - 0.09 * Math.abs(s);
    下胴.rotation.z = 0.03 * s;
  }
}
