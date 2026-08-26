// 銃の見た目。
//
// 実在の銃をもとにしています。ブロックの組み合わせなので細かくはありませんが、
// シルエットで「あ、あれだ」と分かることを目指しています。
//
//   アサルトライフル … AUG（ブルパップ。弾倉が握りより後ろにある）
//   ピストル        … グロック18C（上に穴が開いていて、跳ね上がりを抑える）
//   スナイパー      … AWM（重い銃身・親指を通す銃床・二脚）
//
// 銃は -Z の向きを向いています（three.js のカメラが -Z を見るため）。
// 各モデルは userData.sightY に「覗く高さ」を入れます。
// 構えたとき、その高さが画面の中心に来るように main.js が下げます。

import * as THREE from '../lib/three.module.js';
import { build as buildAUGDetailed } from './models/aug.js';
import { build as buildGlockDetailed } from './models/glock18c.js';
import { build as buildAWMDetailed } from './models/awm.js';

const MAT = new Map();
function mat(hex) {
  let m = MAT.get(hex);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); MAT.set(hex, m); }
  return m;
}

const STEEL  = 0x1a1c21;   // 黒い金属
const DARK   = 0x101216;
const OD     = 0x59614a;   // オリーブドラブ（AUG や AWM の樹脂）
const ODLIT  = 0x6d7659;
const TAN    = 0x8a7d5c;
const GLASS  = 0x1e3a4a;

/** 箱をひとつ足す。回転は度で指定。 */
function box(g, w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
  g.add(m);
  return m;
}

function cyl(g, r, len, x, y, z, hex, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat(hex));
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  g.add(m);
  return m;
}

/**
 * 照門（後ろ）と照星（前）。
 * 覗いたとき、左右の柱のすき間の中に、前の柱が入って見えます。
 * どちらも中心の高さを sightY にそろえてあるので、狙った所へ飛びます。
 */
function ironSights(g, sightY, rearZ, frontZ, accent) {
  box(g, 0.06, 0.20, 0.07, -0.115, sightY, rearZ, STEEL);
  box(g, 0.06, 0.20, 0.07,  0.115, sightY, rearZ, STEEL);
  box(g, 0.30, 0.05, 0.07,  0,     sightY - 0.12, rearZ, STEEL);

  box(g, 0.05, 0.20, 0.06, 0, sightY, frontZ, STEEL);
  box(g, 0.07, 0.07, 0.07, 0, sightY, frontZ, accent);   // 先端の点
  box(g, 0.16, 0.05, 0.06, 0, sightY - 0.12, frontZ, STEEL);
}

// ============================================================
//  AUG（アサルトライフル）
//  ブルパップ。弾倉が握りより後ろにあるので、全体が短い。
//  上に光学サイト一体の運搬ハンドルが付いているのが目印。
// ============================================================
function buildAUGSimple(def) {
  const g = new THREE.Group();

  box(g, 0.40, 0.52, 1.95, 0, 0.02, -0.20, OD);          // 本体（銃床まで一体）
  box(g, 0.42, 0.16, 0.55, 0, 0.30, 0.55, ODLIT);        // 頬をつける所
  box(g, 0.44, 0.60, 0.14, 0, -0.02, 0.78, ODLIT);       // 肩に当てる板

  box(g, 0.26, 0.42, 0.42, 0, -0.42, 0.14, STEEL);       // 弾倉（握りより後ろ ＝ ブルパップ）
  box(g, 0.24, 0.10, 0.34, 0, -0.66, 0.16, DARK);

  box(g, 0.26, 0.56, 0.30, 0, -0.42, -0.62, OD, 8);      // 握り
  box(g, 0.22, 0.05, 0.42, 0, -0.20, -0.66, STEEL);      // 用心金
  box(g, 0.05, 0.16, 0.05, 0, -0.24, -0.60, STEEL);      // 引き金

  box(g, 0.34, 0.34, 0.95, 0, 0.00, -1.62, OD);          // 前の握り部（ハンドガード）
  box(g, 0.20, 0.46, 0.24, 0, -0.36, -1.60, OD, 12);     // 前の縦握り（AUG の特徴）
  cyl(g, 0.075, 1.15, 0, 0.02, -2.62, STEEL);            // 銃身
  cyl(g, 0.11, 0.22, 0, 0.02, -3.20, DARK);              // 消炎器

  // 運搬ハンドル＋光学サイト
  box(g, 0.30, 0.10, 1.35, 0, 0.44, -0.62, OD);
  cyl(g, 0.13, 1.15, 0, 0.56, -0.75, STEEL);
  cyl(g, 0.15, 0.08, 0, 0.56, -1.34, GLASS);             // 前のレンズ
  cyl(g, 0.15, 0.08, 0, 0.56, -0.17, GLASS);             // 後ろのレンズ
  box(g, 0.10, 0.16, 0.10, 0, 0.32, -0.20, OD);          // 支柱
  box(g, 0.10, 0.16, 0.10, 0, 0.32, -1.30, OD);

  g.userData.sightY = 0.56;   // 光学サイトの中心を覗く
  return g;
}

// ============================================================
//  グロック18C（ピストル）
//  四角いスライド、上に開いた穴（コンペンセイター）、長い弾倉。
// ============================================================
function buildGlockSimple(def) {
  const g = new THREE.Group();

  box(g, 0.28, 0.30, 1.05, 0, 0.14, -0.38, STEEL);       // スライド
  box(g, 0.29, 0.06, 0.72, 0, 0.29, -0.30, DARK);        // 上面の溝

  // 18C の目印：銃口の上に開いた穴。ここからガスが抜けて跳ね上がりを抑える。
  for (const z of [-0.70, -0.80]) box(g, 0.10, 0.05, 0.06, 0, 0.30, z, 0x2a2d34);

  box(g, 0.26, 0.24, 0.86, 0, -0.08, -0.28, 0x24262c);   // 樹脂フレーム
  box(g, 0.22, 0.05, 0.34, 0, -0.20, -0.34, 0x24262c);   // 用心金の下
  box(g, 0.05, 0.14, 0.05, 0, -0.14, -0.20, STEEL);      // 引き金

  box(g, 0.24, 0.62, 0.30, 0, -0.48, 0.10, 0x24262c, 10);   // 握り
  box(g, 0.20, 0.34, 0.24, 0, -0.92, 0.18, DARK, 10);       // 延長弾倉（18C らしく長め）
  box(g, 0.23, 0.05, 0.28, 0, -0.74, 0.14, 0x2f333a, 10);

  cyl(g, 0.055, 0.20, 0, 0.14, -0.92, 0x3a3f47);         // 銃口

  ironSights(g, 0.34, 0.04, -0.82, def.accent ?? 0xd2d7e1);
  g.userData.sightY = 0.34;
  return g;
}

// ============================================================
//  AWM（スナイパーライフル）
//  重い銃身、親指を通す銃床、大きなスコープ、二脚。
// ============================================================
function buildAWMSimple(def) {
  const g = new THREE.Group();

  box(g, 0.30, 0.46, 1.30, 0, -0.04, 0.60, OD);          // 銃床
  box(g, 0.32, 0.18, 0.50, 0, 0.26, 0.70, ODLIT);        // 頬あて
  box(g, 0.34, 0.52, 0.14, 0, -0.06, 1.22, DARK);        // 肩に当てる板
  box(g, 0.14, 0.26, 0.30, 0, 0.02, 0.42, 0x000000);     // 親指を通す穴（黒い抜き）

  box(g, 0.34, 0.40, 1.05, 0, 0.02, -0.52, 0x2b2f36);    // 機関部
  box(g, 0.14, 0.12, 0.34, 0.22, 0.10, -0.30, STEEL);    // 遊底の取っ手
  box(g, 0.10, 0.10, 0.10, 0.34, 0.10, -0.16, STEEL);

  box(g, 0.26, 0.34, 0.34, 0, -0.34, -0.34, STEEL);      // 弾倉
  box(g, 0.24, 0.56, 0.28, 0, -0.40, 0.02, OD, 6);       // 握り

  cyl(g, 0.10, 1.85, 0, 0.04, -1.98, 0x2b2f36);          // 重い銃身
  cyl(g, 0.13, 0.30, 0, 0.04, -3.02, DARK);              // 銃口制退器
  for (const x of [-0.13, 0.13]) box(g, 0.05, 0.10, 0.22, x, 0.04, -3.02, 0x000000);

  box(g, 0.26, 0.20, 1.00, 0, -0.16, -1.55, OD);         // 前の木部

  // 二脚
  for (const s of [-1, 1]) {
    box(g, 0.05, 0.52, 0.05, s * 0.16, -0.52, -2.35, STEEL, 0, 0, s * 18);
    box(g, 0.14, 0.05, 0.05, s * 0.24, -0.78, -2.35, STEEL);
  }

  // スコープ
  cyl(g, 0.15, 1.55, 0, 0.55, -0.95, 0x15171c);
  cyl(g, 0.19, 0.20, 0, 0.55, -1.80, 0x15171c);          // 対物側は太い
  cyl(g, 0.17, 0.06, 0, 0.55, -1.90, GLASS);
  cyl(g, 0.16, 0.06, 0, 0.55, -0.19, GLASS);
  box(g, 0.12, 0.14, 0.12, 0, 0.55, -0.62, 0x15171c, 0, 0, 90);  // ダイヤル
  box(g, 0.10, 0.22, 0.10, 0, 0.32, -0.42, 0x2b2f36);            // 支柱
  box(g, 0.10, 0.22, 0.10, 0, 0.32, -1.42, 0x2b2f36);

  g.userData.sightY = 0.55;
  return g;
}

// ============================================================
//  そのほかの銃（形は一般的なもの）
// ============================================================
function buildGeneric(def) {
  const g = new THREE.Group();
  const L = def.length || 3;
  const body = def.body ?? 0x30343c;
  const accent = def.accent ?? 0xffaa3c;

  box(g, 0.40, 0.48, L * 0.62, 0, 0, -L * 0.18, body);
  box(g, 0.42, 0.16, L * 0.24, 0, 0.28, L * 0.20, body);      // 銃床
  box(g, 0.30, 0.52, 0.30, 0, -0.42, 0.06, body, 8);          // 握り
  box(g, 0.24, 0.05, 0.40, 0, -0.18, 0.02, STEEL);            // 用心金
  box(g, 0.26, 0.36, 0.36, 0, -0.36, -0.34, STEEL);           // 弾倉
  box(g, 0.28, 0.26, L * 0.30, 0, -0.02, -L * 0.62, body);    // 前の握り
  cyl(g, 0.07, L * 0.34, 0, 0.02, -L * 0.86, STEEL);          // 銃身
  box(g, 0.24, 0.08, 0.5, 0, 0.28, -L * 0.30, accent);        // 上のレール

  const sightY = 0.40;
  ironSights(g, sightY, -L * 0.14, -L * 0.86, accent);
  g.userData.sightY = sightY;
  return g;
}

// ============================================================
//  近接
// ============================================================
function buildMelee(def) {
  const g = new THREE.Group();
  const L = def.length || 2;
  const accent = def.accent ?? 0xe1ebf5;

  // 刃は必ず「上向き」。銃のように前を向かないこと。
  if (def.name === 'Scythe') {
    box(g, 0.12, L, 0.14, 0, L / 2, 0, def.body ?? 0x2e221c);   // 柄
    for (let i = 0; i < 5; i++) {                                // 曲がった刃
      const t = i / 4;
      box(g, 0.09, 0.34, 0.30, 0, L - 0.1 - t * 0.15, -0.2 - t * 0.62, accent, t * 22, 0, 0);
    }
  } else if (def.name === 'Katana') {
    box(g, 0.10, L * 0.78, 0.24, 0, L * 0.52, 0, accent);        // 刀身
    box(g, 0.30, 0.05, 0.34, 0, 0.14, 0, 0xb49650);              // つば
    box(g, 0.13, 0.42, 0.16, 0, -0.10, 0, 0x782830);             // 柄
  } else {
    box(g, 0.09, L * 0.66, 0.22, 0, L * 0.48, 0, accent);        // 刃
    box(g, 0.24, 0.05, 0.26, 0, 0.10, 0, 0x26282e);              // つば
    box(g, 0.14, 0.34, 0.16, 0, -0.10, 0, 0x26282e);             // 柄
  }
  g.userData.sightY = 0;
  return g;
}

// 実銃をもとにした、作り込んだモデル。
// 中身は src/models/ にあります（1丁ずつファイルを分けています）。
const BUILDERS = {
  AR: buildAUGDetailed,
  Pistol: buildGlockDetailed,
  Sniper: buildAWMDetailed,
};

/** エディタで作って「ゲームで使う」を押したものが、この名前で保存されています。 */
export const CUSTOM_KEY = (name) => 'gunarena-custom-' + name;

/**
 * 自作モデルがあれば、それを組み立てて返す。無ければ null。
 * ブラウザの保存領域（localStorage）に入っているので、
 * ファイルをいじらなくてもゲームに反映されます。
 */
export function buildCustom(name) {
  if (typeof localStorage === 'undefined') return null;
  let data;
  try {
    const raw = localStorage.getItem(CUSTOM_KEY(name));
    if (!raw) return null;
    data = JSON.parse(raw);
  } catch { return null; }
  if (!data || !Array.isArray(data.parts) || !data.parts.length) return null;

  const g = new THREE.Group();
  for (const p of data.parts) {
    const hex = typeof p.color === 'string' ? parseInt(p.color.slice(1), 16) : p.color;
    const m = p.type === 'cyl'
      ? new THREE.Mesh(new THREE.CylinderGeometry(p.size.x / 2, p.size.x / 2, p.size.y, 12), mat(hex))
      : new THREE.Mesh(new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z), mat(hex));
    m.position.set(p.pos.x, p.pos.y, p.pos.z);
    m.rotation.set(p.rot.x, p.rot.y, p.rot.z);
    g.add(m);
  }
  g.userData.sightY = data.sightY ?? 0.4;
  g.userData.muzzle = new THREE.Vector3(
    data.muzzle?.x ?? 0, data.muzzle?.y ?? 0, data.muzzle?.z ?? -1);
  g.userData.custom = true;
  return g;
}

/** 武器の見た目を作る。main.js から呼ばれます。 */
export function buildGunMesh(def) {
  const mine = buildCustom(def.name);
  if (mine) return mine;                    // 自分で作ったものを優先
  if (def.melee) return buildMelee(def);
  const f = BUILDERS[def.name];
  return f ? f(def) : buildGeneric(def);
}

/**
 * 銃口の位置。
 * 作り込んだモデルは自分で userData.muzzle を持っているので、そちらを優先します。
 */
export function muzzleOf(def, mesh) {
  if (mesh && mesh.userData && mesh.userData.muzzle) return mesh.userData.muzzle.clone();
  return muzzleFallback(def);
}

function muzzleFallback(def) {
  if (def.name === 'AR') return new THREE.Vector3(0, 0.02, -3.35);
  if (def.name === 'Pistol') return new THREE.Vector3(0, 0.14, -1.05);
  if (def.name === 'Sniper') return new THREE.Vector3(0, 0.04, -3.20);
  return new THREE.Vector3(0, 0.02, -(def.length || 3) * 1.05);
}
