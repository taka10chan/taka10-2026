// ============================================================
//  ことだま — アニメーション部屋
//
//  モデリング部屋で 作った モデルに、「キーフレーム」で うごきを つける 部屋です。
//  ロブロックスの アニメーションエディタと 同じ 考えかたです。
//
//    ① 上で うごかす モデルを えらぶ
//    ② 下の タイムラインで 時こくを えらぶ
//    ③ ぶひんを えらんで まわす／うごかす  → その時こくに ◆キーが うたれる
//    ④ ▶ で その場で さいせい（ループ）
//
//  作った ものは localStorage['kotodama-anims'] に しまわれます。
//
//  そうさ（モデリング部屋と おなじ）
//    右ドラッグ  … みまわす
//    右+WASD/QE … とぶ
//    中ドラッグ  … よこに うごく
//    ホイール    … よる / はなれる
//    F           … えらんだ ものに よる
//    W / R       … いどう / かいてん
//    Ctrl+Z      … もどす
// ============================================================

import * as THREE from '../../lib/three.module.js';

const $ = (id) => document.getElementById(id);

/** しまう場所。ここ以外の localStorage の キーには ぜったいに さわらない。 */
const KEY_ANIMS  = 'kotodama-anims';       // ★ここだけ 書きこむ
const KEY_MODELS = 'kotodama-models';      // ★読むだけ（モデリング部屋の もの）
const KEY_LAST   = 'kotodama-anim-last';   // さいごに ひらいていた アニメの なまえ

const r4 = (v) => Math.round(v * 10000) / 10000;   // 小数は 4けたまで
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deepCopy = (o) => JSON.parse(JSON.stringify(o));

// ============================================================
//  1. 3D の したごしらえ（モデリング部屋と 同じ 見た目）
// ============================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1319);
scene.add(new THREE.AmbientLight(0xffffff, 1.05));
const l1 = new THREE.DirectionalLight(0xfff4e2, 1.55); l1.position.set(6, 11, 8); scene.add(l1);
const l2 = new THREE.DirectionalLight(0x9fc4e8, 0.65); l2.position.set(-8, 4, -7); scene.add(l2);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);

// --- 地面（y = 0）---
const groundGroup = new THREE.Group();
scene.add(groundGroup);
{
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshBasicMaterial({ color: 0x101922 })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.02;
  groundGroup.add(plate);

  const grid = new THREE.GridHelper(60, 60, 0x6f8ba3, 0x2a3946);
  grid.material.transparent = true;
  grid.material.opacity = 0.85;
  groundGroup.add(grid);
}

/** ぜんぶの 部品を 入れておく 入れもの */
const model = new THREE.Group();
scene.add(model);

// えらんだ 部品を かこむ わく
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xffd66e })
);
outline.visible = false;
scene.add(outline);

// ============================================================
//  2. モデル（読むだけ。ぜったいに 書きかえない）
// ============================================================

/** localStorage から モデルを 読む。こわれていたら 空っぽ。 */
function loadModels() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY_MODELS) || '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const k of Object.keys(o)) {
      if (o[k] && Array.isArray(o[k].parts)) out[k] = o[k];
    }
    return out;
  } catch { return {}; }
}

let models = {};        // { なまえ: { parts:[...] } }  ← 読むだけ
let parts = [];         // { mesh, type, color, base:{ size,pos,rot } }
let selPart = -1;       // いま えらんでいる 部品の ばんごう（-1 は なし）

function makeGeometry(type, size) {
  return type === 'cyl'
    ? new THREE.CylinderGeometry(size.x / 2, size.x / 2, size.y, 16)
    : new THREE.BoxGeometry(size.x, size.y, size.z);
}

/** えらんだ モデルの 部品を 3D に ならべなおす */
function buildModel(name) {
  for (const p of parts) { p.mesh.geometry.dispose(); model.remove(p.mesh); }
  parts = [];
  const list = (models[name] && models[name].parts) || [];
  for (const d of list) {
    const type = d.type === 'cyl' ? 'cyl' : 'box';
    const size = { x: 1, y: 1, z: 1, ...(d.size || {}) };
    const pos  = { x: 0, y: 0, z: 0, ...(d.pos  || {}) };
    const rot  = { x: 0, y: 0, z: 0, ...(d.rot  || {}) };
    const color = d.color || '#8c9baa';
    const mesh = new THREE.Mesh(makeGeometry(type, size),
      new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.set(rot.x, rot.y, rot.z);
    model.add(mesh);
    parts.push({ mesh, type, color, base: { size, pos, rot } });
  }
  if (selPart >= parts.length) selPart = -1;
  tlScroll = 0;
  if (document.readyState !== 'loading') resize();
}

/** タイムラインに 出す みじかい なまえ（「3 みぎ」など） */
function partShort(i) {
  const p = parts[i];
  if (!p) return String(i + 1);
  const x = p.base.pos.x;
  return (i + 1) + (x > 0.15 ? ' みぎ' : (x < -0.15 ? ' ひだり' : ''));
}

/** 部品の なまえ（左右が わかるように、いちから すいそくする） */
function partLabel(i) {
  const p = parts[i];
  if (!p) return 'ぶひん' + (i + 1);
  const x = p.base.pos.x;
  const side = x > 0.15 ? 'みぎ' : (x < -0.15 ? 'ひだり' : '');
  return 'ぶひん' + (i + 1) + (side ? '(' + side + ')' : '');
}

// ============================================================
//  3. アニメの データ
//
//     anims = {
//       "あるく": { model:"ひと", loop:true, sec:1.0,
//                   tracks:[ { part:0, keys:[ {t,pos:{x,y,z},rot:{x,y,z}} ] } ] }
//     }
//     pos / rot は「もとの すがたからの ズレ」。rot は ラジアン。
// ============================================================
let anims = {};      // ぜんぶの アニメ
let current = '';    // いま ひらいている アニメの なまえ
let cur = null;      // anims[current] の 中みそのもの
let now = 0;         // いまの 時こく（びょう）

const zero = () => ({ x: 0, y: 0, z: 0 });

/** localStorage から 読む。こわれていたら 直す。 */
function loadAnims() {
  let o;
  try { o = JSON.parse(localStorage.getItem(KEY_ANIMS) || '{}'); } catch { o = {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  const out = {};
  for (const k of Object.keys(o)) {
    const a = o[k] || {};
    const tracks = [];
    for (const tr of (Array.isArray(a.tracks) ? a.tracks : [])) {
      if (!tr || typeof tr.part !== 'number') continue;
      const keys = (Array.isArray(tr.keys) ? tr.keys : []).map((k2) => ({
        t: Number(k2 && k2.t) || 0,
        pos: { ...zero(), ...((k2 && k2.pos) || {}) },
        rot: { ...zero(), ...((k2 && k2.rot) || {}) },
      })).sort((p, q) => p.t - q.t);
      if (keys.length) tracks.push({ part: tr.part | 0, keys });
    }
    out[k] = {
      model: typeof a.model === 'string' ? a.model : '',
      loop: a.loop !== false,
      sec: clamp(Number(a.sec) || 1, 0.2, 10),
      tracks,
    };
  }
  return out;
}

/** しまう形（SPEC どおり）に そろえて 書きだす。キーの ない トラックは すてる。 */
function serialize() {
  const out = {};
  for (const name of Object.keys(anims)) {
    const a = anims[name];
    const tracks = [];
    for (const tr of a.tracks) {
      if (!tr.keys.length) continue;                     // 空の トラックは 出さない
      const keys = tr.keys.slice().sort((p, q) => p.t - q.t).map((k) => ({
        t: r4(clamp(k.t, 0, a.sec)),
        pos: { x: r4(k.pos.x), y: r4(k.pos.y), z: r4(k.pos.z) },
        rot: { x: r4(k.rot.x), y: r4(k.rot.y), z: r4(k.rot.z) },
      }));
      tracks.push({ part: tr.part | 0, keys });
    }
    out[name] = {
      model: a.model,
      loop: !!a.loop,
      sec: r4(a.sec),
      tracks,
    };
  }
  return out;
}

function saveAll(quiet) {
  // ★ここだけ 書きこむ。ほかの キーには ぜったいに さわらない。
  localStorage.setItem(KEY_ANIMS, JSON.stringify(serialize()));
  if (current) localStorage.setItem(KEY_LAST, current);
  setState('ほぞんずみ');
  refreshAnims();
  if (!quiet) toast('ほぞんしました');
}

/** 手が とまったら じどうで ほぞん（保存し忘れて 消えた、を なくす） */
let autoT = 0;
function markDirty() {
  setState('ほぞん中…');
  clearTimeout(autoT);
  autoT = setTimeout(() => saveAll(true), 1000);
}
function setState(t) { $('state').textContent = t; }
addEventListener('beforeunload', () => { clearTimeout(autoT); saveAll(true); });

// --- もどす（Ctrl+Z）------------------------------------------------
let undoStack = [];
/** かえる「まえ」の すがたを つんでおく。かえる 直前に よぶこと。 */
function beginChange() {
  if (!cur) return;
  undoStack.push(deepCopy(cur));
  if (undoStack.length > 80) undoStack.shift();
}
function doUndo() {
  if (!undoStack.length) { toast('もう もどせません'); return; }
  const before = undoStack.pop();
  anims[current] = before;
  cur = before;
  selKey = null;
  if (cur.model && models[cur.model]) buildModel(cur.model);
  if (selPart >= parts.length) selPart = -1;
  gizmo.visible = outline.visible = selPart >= 0;
  syncTop(); refreshParts(); markDirty();
  setTime(clamp(now, 0, cur.sec));
  toast('ひとつ もどしました');
}

// ============================================================
//  4. トラック と キー（うごきの もと）
// ============================================================

/** その部品の トラックを さがす（なければ null） */
function trackOf(part) {
  if (!cur) return null;
  return cur.tracks.find((t) => t.part === part) || null;
}
/** その部品の トラックを 用意する（なければ 作る） */
function ensureTrack(part) {
  let tr = trackOf(part);
  if (!tr) { tr = { part, keys: [] }; cur.tracks.push(tr); }
  return tr;
}
function lerp(a, b, u) { return a + (b - a) * u; }
function lerpKey(a, b, u) {
  return {
    pos: { x: lerp(a.pos.x, b.pos.x, u), y: lerp(a.pos.y, b.pos.y, u), z: lerp(a.pos.z, b.pos.z, u) },
    rot: { x: lerp(a.rot.x, b.rot.x, u), y: lerp(a.rot.y, b.rot.y, u), z: lerp(a.rot.z, b.rot.z, u) },
  };
}
const copyVal = (k) => ({ pos: { ...k.pos }, rot: { ...k.rot } });

/**
 * その部品の、その時こくの ズレを 計算する（線形ほかん）。
 * キーが ないときは null（＝ もとの すがたの まま）。
 * ループのときは、さいごの キー → さいしょの キー へ ぐるりと つなぐ。
 */
function sample(part, t) {
  const tr = trackOf(part);
  if (!tr || !tr.keys.length) return null;
  const ks = tr.keys;
  if (ks.length === 1) return copyVal(ks[0]);

  const sec = cur.sec;
  const first = ks[0], last = ks[ks.length - 1];

  if (t <= first.t) {
    if (!cur.loop) return copyVal(first);
    const span = first.t + sec - last.t;               // ぐるりと まわる ながさ
    if (span <= 1e-6) return copyVal(first);
    return lerpKey(last, first, clamp((t + sec - last.t) / span, 0, 1));
  }
  if (t >= last.t) {
    if (!cur.loop) return copyVal(last);
    const span = first.t + sec - last.t;
    if (span <= 1e-6) return copyVal(last);
    return lerpKey(last, first, clamp((t - last.t) / span, 0, 1));
  }
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const d = b.t - a.t;
      return d <= 1e-9 ? copyVal(b) : lerpKey(a, b, (t - a.t) / d);
    }
  }
  return copyVal(last);
}

/** いまの 時こくの すがたを、3D に うつす（「今の姿勢を 常に表示」） */
function applyPose() {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const b = p.base;
    const v = sample(i, now);
    if (v) {
      p.mesh.position.set(b.pos.x + v.pos.x, b.pos.y + v.pos.y, b.pos.z + v.pos.z);
      p.mesh.rotation.set(b.rot.x + v.rot.x, b.rot.y + v.rot.y, b.rot.z + v.rot.z);
    } else {
      p.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
      p.mesh.rotation.set(b.rot.x, b.rot.y, b.rot.z);
    }
  }
}

/** その時こくの キーを さがす（ぴったり 近いもの） */
function keyAt(part, t) {
  const tr = trackOf(part);
  if (!tr) return null;
  return tr.keys.find((k) => Math.abs(k.t - t) < 1e-4) || null;
}

/**
 * その時こくに キーを うつ（もう あれば その キーを 返す）。
 * 値は「いま 見えている すがた」から とるので、うっても 見た目は かわらない。
 */
function putKey(part, t, quiet) {
  t = r4(clamp(t, 0, cur.sec));
  let k = keyAt(part, t);
  if (k) return k;
  const v = sample(part, t) || { pos: zero(), rot: zero() };
  k = { t, pos: { ...v.pos }, rot: { ...v.rot } };
  const tr = ensureTrack(part);
  tr.keys.push(k);
  tr.keys.sort((a, b) => a.t - b.t);
  if (!quiet) { refreshParts(); markDirty(); }
  return k;
}

/** キーを けす */
function removeKey(part, k) {
  const tr = trackOf(part);
  if (!tr) return false;
  const i = tr.keys.indexOf(k);
  if (i < 0) return false;
  tr.keys.splice(i, 1);
  if (!tr.keys.length) cur.tracks = cur.tracks.filter((x) => x !== tr);
  return true;
}

/** えらんでいる キー（タイムラインで クリックした もの） */
let selKey = null;   // { part, key }

// ============================================================
//  5. つまんで うごかす やじるし（ギズモ）
//     かいてんの ほうが よく つかうので、はじめは かいてん。
// ============================================================
const gizmo = new THREE.Group();
gizmo.visible = false;
scene.add(gizmo);

const AXES = [
  { k: 'x', col: 0xff4e60, dir: new THREE.Vector3(1, 0, 0) },
  { k: 'y', col: 0x5ae182, dir: new THREE.Vector3(0, 1, 0) },
  { k: 'z', col: 0x46a0ff, dir: new THREE.Vector3(0, 0, 1) },
];
const handles = [];
for (const a of AXES) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: a.col, depthTest: false });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), mat);
  shaft.position.y = 0.31;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.17, 10), mat);
  tip.position.y = 0.70;

  // かいてん用の わ。その じくの まわりを まわす。
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.016, 8, 48), mat);
  ring.rotation.x = Math.PI / 2;
  // わは つかみにくいので、見えない ふとい わを かさねておく
  const ringGrab = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.075, 6, 32),
    new THREE.MeshBasicMaterial({ visible: false }));
  ringGrab.rotation.x = Math.PI / 2;

  // ぼうも つかみやすいように、見えない ふとい ぼうを かさねる
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.86, 6),
    new THREE.MeshBasicMaterial({ visible: false }));
  grab.position.y = 0.43;

  g.add(shaft, tip, grab, ring, ringGrab);
  if (a.k === 'x') g.rotation.z = -Math.PI / 2;
  if (a.k === 'z') g.rotation.x = Math.PI / 2;
  g.renderOrder = 999;
  g.userData = { axis: a.k, dir: a.dir, shaft, tip, grab, ring, ringGrab };
  gizmo.add(g);
  handles.push(g);
}

let mode = 'rotate';   // 'rotate' | 'move' … 既定は かいてん
function setMode(m) {
  mode = m;
  $('tRot').classList.toggle('on', m === 'rotate');
  $('tMove').classList.toggle('on', m === 'move');
  const rot = m === 'rotate';
  for (const h of handles) {
    const u = h.userData;
    u.shaft.visible = !rot;      // かいてんのときは ぼうを 消して、わ だけにする
    u.grab.visible = !rot;
    u.tip.visible = !rot;
    u.ring.visible = rot;
    u.ringGrab.visible = rot;
  }
}
$('tRot').onclick = () => setMode('rotate');
$('tMove').onclick = () => setMode('move');

/** まわす とき の 中心（うで や あし は「つけね」で まわすと それっぽい） */
let pivot = 'center';   // 'center' | 'top' | 'bottom'

// ============================================================
//  6. カメラ（モデリング部屋と まったく おなじ そうさ）
// ============================================================
const cam = { pos: new THREE.Vector3(9, 7, 12), yaw: -2.5, pitch: -0.42 };
const keys = new Set();
let rightDown = false, midDown = false;
const FLY_SPEED = 14;

function camDir() {
  const cp = Math.cos(cam.pitch);
  return new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
}
/** カメラを まわす */
function look(dx, dy) {
  cam.yaw -= dx * 0.0032;
  cam.pitch = clamp(cam.pitch - dy * 0.0032, -1.5, 1.5);
}
/** カメラを よこ・たてに ずらす */
function pan(dx, dy) {
  const d = camDir();
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();
  const s = 0.0022 * Math.max(3, cam.pos.length());
  cam.pos.addScaledVector(right, -dx * s);
  cam.pos.addScaledVector(up, dy * s);
}
/** カメラを 前後に うごかす（＋で 近づく） */
function dolly(amount) {
  cam.pos.addScaledVector(camDir(), amount * Math.max(0.6, cam.pos.length() * 0.5));
}

canvas.addEventListener('mousedown', (e) => {
  closeDrawers();
  if (e.button === 2) { rightDown = true; e.preventDefault(); }
  else if (e.button === 1) { midDown = true; e.preventDefault(); }
  else if (e.button === 0) {
    // ここで preventDefault しないと、ブラウザが「画像を ドラッグ」しはじめて
    // ゴーストが 出てしまう（実際に 起きた 不具合）
    e.preventDefault();
    onLeftDown(e.clientX, e.clientY);
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) rightDown = false;
  if (e.button === 1) midDown = false;
  if (e.button === 0 && drag) { drag = null; markDirty(); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// 左ドラッグで ブラウザの「画像を ドラッグ」が はじまると、そうさを 取られる
canvas.addEventListener('dragstart', (e) => e.preventDefault());
canvas.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  e.preventDefault();
});

addEventListener('mousemove', (e) => {
  if (rightDown) look(e.movementX, e.movementY);
  else if (midDown) pan(e.movementX, e.movementY);
  else if (drag) onDragMove(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
  dolly(-Math.sign(e.deltaY) * 0.14);
  e.preventDefault();
}, { passive: false });

addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  keys.add(e.code);

  if (e.code === 'KeyF') frame();
  if (e.code === 'Delete' || e.code === 'Backspace') { deleteSelectedKey(); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyZ') { doUndo(); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyS') { saveAll(false); e.preventDefault(); }
  // ボタンに フォーカスが あるときの スペースは、ボタンの ほうに まかせる
  if (e.code === 'Space' && !(t && t.tagName === 'BUTTON')) { togglePlay(); e.preventDefault(); }
  if (e.code === 'Escape') { selectPart(-1); selKey = null; closeDrawers(); }

  // 右ドラッグ中の W は「とぶ」ための キーなので、切りかえない
  if (!e.ctrlKey && !rightDown) {
    if (e.code === 'KeyW' || e.code === 'KeyG') setMode('move');
    if (e.code === 'KeyR' || e.code === 'KeyE') setMode('rotate');
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); rightDown = midDown = false; });

/** 右クリックを おしている あいだだけ 飛べる（スタジオと おなじ） */
function flyStep(dt) {
  if (!rightDown) return;
  const d = camDir();
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3();
  if (keys.has('KeyW')) v.add(d);
  if (keys.has('KeyS')) v.sub(d);
  if (keys.has('KeyD')) v.add(right);
  if (keys.has('KeyA')) v.sub(right);
  if (keys.has('KeyE')) v.y += 1;
  if (keys.has('KeyQ')) v.y -= 1;
  if (v.lengthSq() > 0) {
    v.normalize().multiplyScalar(FLY_SPEED * dt * (keys.has('ShiftLeft') ? 2.6 : 1));
    cam.pos.add(v);
  }
}

/** えらんだ 部品（なければ ぜんたい）に よる */
function frame() {
  const target = selPart >= 0 ? parts[selPart].mesh : model;
  const b = new THREE.Box3().setFromObject(target);
  if (b.isEmpty()) { cam.pos.set(9, 7, 12); cam.yaw = -2.5; cam.pitch = -0.42; return; }
  const c = new THREE.Vector3(); b.getCenter(c);
  const s = new THREE.Vector3(); b.getSize(s);
  const dist = Math.max(2.2, Math.max(s.x, s.y, s.z) * 2.2);
  cam.pos.copy(c).addScaledVector(camDir(), -dist);
}

// ============================================================
//  7. ゆびの そうさ（学校の タブレット用）
// ============================================================
let touchState = null;
const touchPoint = (t) => ({ x: t.clientX, y: t.clientY });
const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const touchMid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  closeDrawers();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const grabbed = tryGrabGizmo(t.clientX, t.clientY);
    touchState = {
      kind: grabbed ? 'gizmo' : 'look',
      last: touchPoint(t), start: touchPoint(t), time: performance.now(), moved: 0,
    };
  } else if (e.touches.length >= 2) {
    drag = null;
    touchState = {
      kind: 'two',
      dist: touchDist(e.touches[0], e.touches[1]),
      mid: touchMid(e.touches[0], e.touches[1]),
    };
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!touchState) return;
  if (touchState.kind === 'two' && e.touches.length >= 2) {
    const d = touchDist(e.touches[0], e.touches[1]);
    const m = touchMid(e.touches[0], e.touches[1]);
    dolly((d - touchState.dist) * 0.012);          // ひろげると 近づく
    pan(m.x - touchState.mid.x, m.y - touchState.mid.y);
    touchState.dist = d; touchState.mid = m;
    return;
  }
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - touchState.last.x;
  const dy = t.clientY - touchState.last.y;
  touchState.last = touchPoint(t);
  touchState.moved += Math.abs(dx) + Math.abs(dy);
  if (touchState.kind === 'gizmo') onDragMove(t.clientX, t.clientY);
  else look(dx, dy);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!touchState) return;
  if (touchState.kind === 'gizmo') { drag = null; markDirty(); }
  else if (touchState.kind === 'look' && touchState.moved < 12 &&
           performance.now() - touchState.time < 500) {
    pickAt(touchState.start.x, touchState.start.y);   // タップして えらんだ
  }
  touchState = e.touches.length ? touchState : null;
}, { passive: false });

canvas.addEventListener('touchcancel', () => { touchState = null; drag = null; }, { passive: true });

// ============================================================
//  8. えらぶ・つかむ（うごかすと その時こくに キーが うたれる）
// ============================================================
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function setRay(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

/** やじるし（ギズモ）を つかめたか？ つかめたら ドラッグを はじめる */
function tryGrabGizmo(clientX, clientY) {
  if (!gizmo.visible || selPart < 0) return false;
  setRay(clientX, clientY);
  const hit = ray.intersectObjects(handles, true)[0];
  if (!hit || hit.object.visible === false) return false;
  let g = hit.object;
  while (g.parent && !g.userData.axis) g = g.parent;
  beginChange();
  startDrag(g.userData.axis, g.userData.dir);
  return true;
}

/** その場所に ある 部品を えらぶ */
function pickAt(clientX, clientY) {
  setRay(clientX, clientY);
  const hits = ray.intersectObjects(parts.map((p) => p.mesh), false);
  if (!hits.length) { selectPart(-1); return; }
  selectPart(parts.findIndex((p) => p.mesh === hits[0].object));
}

function onLeftDown(clientX, clientY) {
  if (tryGrabGizmo(clientX, clientY)) return;
  pickAt(clientX, clientY);
}

function selectPart(i) {
  selPart = (i >= 0 && i < parts.length) ? i : -1;
  gizmo.visible = outline.visible = selPart >= 0;
  refreshParts();
  syncProps();
}

/** その部品の いまの ズレ（キーが なければ 0） */
function deltaOf(part) {
  const v = sample(part, now);
  return v || { pos: zero(), rot: zero() };
}

/**
 * その部品の、いまの 時こくの ズレを 書きかえる。
 * 「その時こくの キー」が なければ 作る（＝ うごかしたら キーが うたれる）。
 */
function setDelta(part, val) {
  const k = putKey(part, now, true);
  k.pos.x = val.pos.x; k.pos.y = val.pos.y; k.pos.z = val.pos.z;
  k.rot.x = val.rot.x; k.rot.y = val.rot.y; k.rot.z = val.rot.z;
  selKey = { part, key: k };
  return k;
}

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/**
 * 「つけね」で まわしたいとき の 計算。
 * まわす 中心を うごかさないための「いち の ズレ」を 出す。
 *   もとの すがた: p0 + R0*v が つけね
 *   まわした あと: p1 + R1*v が おなじ 場所に なるように p1 を きめる
 *   → posのズレ = R0*v - R1*v
 */
function pivotOffset(part, rot) {
  if (pivot === 'center') return null;
  const b = parts[part].base;
  const h = b.size.y || 1;
  const v = new THREE.Vector3(0, pivot === 'top' ? h / 2 : -h / 2, 0);
  _q0.setFromEuler(_e.set(b.rot.x, b.rot.y, b.rot.z));
  _q1.setFromEuler(_e.set(b.rot.x + rot.x, b.rot.y + rot.y, b.rot.z + rot.z));
  const a = v.clone().applyQuaternion(_q0);
  const c = v.clone().applyQuaternion(_q1);
  return a.sub(c);
}

function startDrag(axis, dirLocal) {
  const p = parts[selPart];
  const start = deltaOf(selPart);

  // かいてんのときは、その部品の むきに あわせた じくで まわす
  const dir = dirLocal.clone();
  if (mode === 'rotate') {
    _q0.setFromEuler(_e.set(p.base.rot.x, p.base.rot.y, p.base.rot.z));
    dir.applyQuaternion(_q0).normalize();
  }

  const centre = new THREE.Vector3();
  new THREE.Box3().setFromObject(p.mesh).getCenter(centre);

  let plane;
  if (mode === 'rotate') {
    // かいてんは、その じくに たいして すいちょくな 板の上で 角度を はかる
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, centre);
  } else {
    // いどうは、じくを ふくみ カメラに 正対する 板の上で うごかす
    const view = camDir();
    const normal = new THREE.Vector3()
      .crossVectors(dir, new THREE.Vector3().crossVectors(view, dir)).normalize();
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
  }

  const p0 = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, p0)) return;
  drag = { axis, dir, plane, p0, centre, start: deepCopy(start) };
}

function onDragMove(clientX, clientY) {
  if (selPart < 0 || !drag) return;
  setRay(clientX, clientY);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(drag.plane, p)) return;

  const val = deepCopy(drag.start);

  if (mode === 'rotate') {
    // ---------- かいてん ----------
    const a0 = drag.p0.clone().sub(drag.centre);
    const a1 = p.clone().sub(drag.centre);
    if (a0.lengthSq() < 1e-8 || a1.lengthSq() < 1e-8) return;
    a0.normalize(); a1.normalize();
    let ang = Math.atan2(_v.copy(a0).cross(a1).dot(drag.dir), a0.dot(a1));
    ang = Math.round(ang / (Math.PI / 36)) * (Math.PI / 36);   // 5どきざみ
    val.rot[drag.axis] = drag.start.rot[drag.axis] + ang;
    const off = pivotOffset(selPart, val.rot);
    if (off) { val.pos.x = off.x; val.pos.y = off.y; val.pos.z = off.z; }
  } else {
    // ---------- いどう ----------
    let amount = p.clone().sub(drag.p0).dot(drag.dir);
    amount = Math.round(amount / 0.05) * 0.05;
    val.pos[drag.axis] = drag.start.pos[drag.axis] + amount;
  }

  setDelta(selPart, val);
  applyPose();
  syncProps();
  refreshParts();
}

// ============================================================
//  9. タイムライン（横が 時間。部品ごとに 1行）
// ============================================================
const tlc = $('tlc');
const g2 = tlc.getContext('2d');

const GUT = 96;        // 左の「なまえ」の はば
const RULER = 26;      // 上の めもりの たかさ
const ROW = 22;        // 1行の たかさ
let tlScroll = 0;      // 行が おおいときの たてスクロール
let snapT = 0.05;      // 時こくの きざみ（0 で なし）

function tlW() { return tlc.clientWidth || 600; }
function tlH() { return tlc.clientHeight || 120; }
const PADL = 10;      // 0びょうの ◆が なまえの らんに かぶらないように
function timeToX(t) { return GUT + PADL + (t / cur.sec) * (tlW() - GUT - PADL - 16); }
function xToTime(x) { return clamp(((x - GUT - PADL) / Math.max(1, tlW() - GUT - PADL - 16)) * cur.sec, 0, cur.sec); }
function rowY(i) { return RULER + 4 + i * ROW - tlScroll; }
function yToRow(y) { return Math.floor((y - RULER - 4 + tlScroll) / ROW); }

function snapTime(t) {
  if (snapT > 0) t = Math.round(t / snapT) * snapT;
  return r4(clamp(t, 0, cur.sec));
}

function drawTimeline() {
  const w = tlW(), h = tlH();
  const dpr = Math.min(devicePixelRatio, 2);
  if (tlc.width !== Math.round(w * dpr) || tlc.height !== Math.round(h * dpr)) {
    tlc.width = Math.round(w * dpr); tlc.height = Math.round(h * dpr);
  }
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2.clearRect(0, 0, w, h);
  if (!cur) return;

  // --- はいけい ---
  g2.fillStyle = '#111a22'; g2.fillRect(0, 0, w, h);
  g2.fillStyle = '#151e27'; g2.fillRect(0, 0, GUT, h);

  // --- 上の めもり ---
  g2.fillStyle = '#0d1319'; g2.fillRect(GUT, 0, w - GUT, RULER);
  g2.font = '10px ui-monospace, Consolas, monospace';
  g2.textBaseline = 'middle';
  // 0.1びょう ごとに 細い線、0.5びょう ごとに 太い線と すうじ
  const step = cur.sec <= 2 ? 0.1 : (cur.sec <= 5 ? 0.25 : 0.5);
  for (let t = 0; t <= cur.sec + 1e-6; t += step) {
    const x = timeToX(t);
    const big = Math.abs(t / (step * 5) - Math.round(t / (step * 5))) < 1e-6;
    g2.strokeStyle = big ? '#3d4f5e' : '#222e39';
    g2.beginPath(); g2.moveTo(x, big ? 6 : 14); g2.lineTo(x, h); g2.stroke();
    if (big) {
      g2.fillStyle = '#8c9baa';
      const last = t > cur.sec - step / 2;              // 右はしの すうじは 内がわに よせる
      g2.textAlign = last ? 'right' : 'left';
      g2.fillText(t.toFixed(t < 10 ? 2 : 1), x + (last ? -3 : 3), 11);
    }
  }

  // --- 部品ごとの 行 ---
  g2.textBaseline = 'middle';
  for (let i = 0; i < parts.length; i++) {
    const y = rowY(i);
    if (y + ROW < RULER || y > h) continue;
    const on = i === selPart;
    if (on) { g2.fillStyle = '#37301c'; g2.fillRect(0, y, w, ROW - 2); }
    // なまえ（左のはしら）
    g2.fillStyle = on ? '#ffd66e' : '#8c9baa';
    g2.font = '11px ui-monospace, Consolas, monospace';
    g2.textAlign = 'left';
    g2.fillText(partShort(i), 22, y + ROW / 2 - 1);
    // いろの しるし
    g2.fillStyle = parts[i].color;
    g2.fillRect(8, y + ROW / 2 - 6, 9, 9);
    // 行の 線
    g2.strokeStyle = '#1d2833';
    g2.beginPath(); g2.moveTo(GUT, y + ROW - 1); g2.lineTo(w, y + ROW - 1); g2.stroke();

    // キー（◆）と、キーと キーを つなぐ 線
    const tr = trackOf(i);
    if (tr && tr.keys.length) {
      const cy = y + ROW / 2 - 1;
      g2.strokeStyle = on ? '#7a6a3d' : '#33414e';
      g2.beginPath();
      g2.moveTo(timeToX(tr.keys[0].t), cy);
      g2.lineTo(timeToX(tr.keys[tr.keys.length - 1].t), cy);
      g2.stroke();
      for (const k of tr.keys) {
        const x = timeToX(k.t);
        const sel = selKey && selKey.key === k;
        g2.fillStyle = sel ? '#ffffff' : (on ? '#ffd66e' : '#c3a24f');
        g2.beginPath();
        g2.moveTo(x, cy - 6); g2.lineTo(x + 6, cy); g2.lineTo(x, cy + 6); g2.lineTo(x - 6, cy);
        g2.closePath(); g2.fill();
        if (sel) { g2.strokeStyle = '#ffd66e'; g2.lineWidth = 2; g2.stroke(); g2.lineWidth = 1; }
      }
    }
  }
  if (!parts.length) {
    g2.fillStyle = '#8c9baa';
    g2.font = '12px sans-serif';
    g2.textAlign = 'left';
    g2.fillText('この モデルには ぶひんが ありません。', GUT + 10, RULER + 20);
  }

  // --- 行が はみ出していたら、右はしに 細い つまみを 出す（ホイールで スクロール）---
  const full = parts.length * ROW;
  const view = h - RULER - 4;
  if (full > view) {
    const bh = Math.max(18, view * view / full);
    const by = RULER + 4 + (tlScroll / (full - view)) * (view - bh);
    g2.fillStyle = '#2b3945'; g2.fillRect(w - 6, RULER + 4, 4, view);
    g2.fillStyle = '#5c6f80'; g2.fillRect(w - 6, by, 4, bh);
  }

  // --- いまの 時こく（あかい たての線）---
  const px = timeToX(now);
  g2.strokeStyle = '#ffd66e'; g2.lineWidth = 1.5;
  g2.beginPath(); g2.moveTo(px, 2); g2.lineTo(px, h); g2.stroke();
  g2.lineWidth = 1;
  g2.fillStyle = '#ffd66e';
  g2.beginPath();
  g2.moveTo(px - 5, 2); g2.lineTo(px + 5, 2); g2.lineTo(px, 10);
  g2.closePath(); g2.fill();

  // 左のはしらを 上から かくして、線が はみ出さないように
  g2.fillStyle = '#151e27'; g2.fillRect(0, 0, GUT, RULER);
  g2.fillStyle = '#8c9baa';
  g2.font = '10px ui-monospace, Consolas, monospace';
  g2.textAlign = 'left';
  g2.fillText('ぶひん', 8, RULER / 2);
  g2.strokeStyle = '#2b3945';
  g2.beginPath(); g2.moveTo(GUT + .5, 0); g2.lineTo(GUT + .5, h); g2.stroke();
  g2.beginPath(); g2.moveTo(0, RULER + .5); g2.lineTo(w, RULER + .5); g2.stroke();
}

/** タイムラインの その場所に なにが あるか しらべる */
function tlHit(clientX, clientY) {
  const r = tlc.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  const row = yToRow(y);
  const t = xToTime(x);
  const out = { x, y, t, row: (row >= 0 && row < parts.length) ? row : -1, key: null, ruler: y < RULER };
  if (out.row >= 0 && x > GUT - 8) {
    const tr = trackOf(out.row);
    if (tr) {
      let best = null, bestD = 9;
      for (const k of tr.keys) {
        const d = Math.abs(timeToX(k.t) - x);
        if (d < bestD) { bestD = d; best = k; }
      }
      out.key = best;
    }
  }
  return out;
}

let tlDrag = null;   // キーを 時こくごと ずらす ドラッグ

function tlDown(clientX, clientY, isRight) {
  if (!cur) return;
  closeDrawers();
  const h = tlHit(clientX, clientY);

  // 右クリック → その場所に キーを うつ
  if (isRight) {
    if (h.row >= 0) {
      beginChange();
      selectPart(h.row);
      const k = putKey(h.row, snapTime(h.t));
      selKey = { part: h.row, key: k };
      setTime(k.t);
      toast('キーを うちました');
    }
    return;
  }

  if (h.ruler || h.x < GUT) {
    if (h.x < GUT && h.row >= 0) selectPart(h.row);     // なまえを クリック → その部品を えらぶ
    if (h.x >= GUT || h.ruler) { setTime(snapTime(h.t)); tlDrag = { kind: 'scrub' }; }
    return;
  }
  if (h.row < 0) { setTime(snapTime(h.t)); tlDrag = { kind: 'scrub' }; return; }

  selectPart(h.row);
  if (h.key) {
    selKey = { part: h.row, key: h.key };
    setTime(h.key.t);
    beginChange();
    tlDrag = { kind: 'key', part: h.row, key: h.key, moved: false };
  } else {
    selKey = null;
    setTime(snapTime(h.t));
    tlDrag = { kind: 'scrub' };
  }
}

function tlMove(clientX, clientY) {
  if (!tlDrag) return;
  const r = tlc.getBoundingClientRect();
  const t = snapTime(xToTime(clientX - r.left));
  if (tlDrag.kind === 'scrub') { setTime(t); return; }
  if (tlDrag.kind === 'key') {
    // おなじ時こくに 2つ キーが かさならないようにする
    const tr = trackOf(tlDrag.part);
    if (!tr) return;
    if (tr.keys.some((k) => k !== tlDrag.key && Math.abs(k.t - t) < 1e-4)) return;
    tlDrag.key.t = t;
    tlDrag.moved = true;
    tr.keys.sort((a, b) => a.t - b.t);
    setTime(t);
  }
}

function tlUp() {
  if (tlDrag && tlDrag.kind === 'key' && tlDrag.moved) markDirty();
  else if (tlDrag && tlDrag.kind === 'key') undoStack.pop();   // うごかさなかったら もどす記録も 消す
  tlDrag = null;
}

tlc.addEventListener('mousedown', (e) => {
  e.preventDefault();
  tlDown(e.clientX, e.clientY, e.button === 2);
});
tlc.addEventListener('contextmenu', (e) => e.preventDefault());
tlc.addEventListener('dblclick', (e) => {
  const h = tlHit(e.clientX, e.clientY);
  if (h.row >= 0 && h.x > GUT) {
    beginChange();
    selectPart(h.row);
    const k = putKey(h.row, snapTime(h.t));
    selKey = { part: h.row, key: k };
    setTime(k.t);
    toast('キーを うちました');
  }
});
addEventListener('mousemove', (e) => { if (tlDrag) tlMove(e.clientX, e.clientY); });
addEventListener('mouseup', () => tlUp());
tlc.addEventListener('dragstart', (e) => e.preventDefault());

tlc.addEventListener('wheel', (e) => {
  const max = Math.max(0, parts.length * ROW - (tlH() - RULER - 8));
  tlScroll = clamp(tlScroll + Math.sign(e.deltaY) * ROW, 0, max);
  e.preventDefault();
}, { passive: false });

// ゆびでも さわれるように
tlc.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) tlDown(e.touches[0].clientX, e.touches[0].clientY, false);
}, { passive: false });
tlc.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) tlMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
tlc.addEventListener('touchend', (e) => { e.preventDefault(); tlUp(); }, { passive: false });

// ============================================================
//  10. 時こく と さいせい
// ============================================================
function setTime(t) {
  now = clamp(t, 0, cur ? cur.sec : 1);
  applyPose();
  syncTime();
  syncProps();
}
function syncTime() {
  if (!cur) return;
  $('scrub').value = String(Math.round((now / cur.sec) * 1000));
  $('tnow').textContent = now.toFixed(2) + ' / ' + cur.sec.toFixed(2) + ' びょう';
}
$('scrub').addEventListener('input', (e) => {
  playing = false; syncPlayBtn();
  setTime((Number(e.target.value) / 1000) * cur.sec);
});

let playing = false;
function syncPlayBtn() {
  $('play').textContent = playing ? '■ とめる' : '▶ さいせい';
  $('play').classList.toggle('on', playing);
}
function togglePlay() {
  playing = !playing;
  if (playing && now >= cur.sec - 1e-6) now = 0;
  syncPlayBtn();
}
$('play').onclick = togglePlay;
$('rew').onclick = () => { playing = false; syncPlayBtn(); setTime(0); };

$('loopBtn').onclick = () => {
  beginChange();
  cur.loop = !cur.loop;
  syncTop(); markDirty(); applyPose();
};

$('secIn').addEventListener('change', (e) => {
  const v = clamp(Number(e.target.value) || 1, 0.2, 10);
  beginChange();
  cur.sec = r4(v);
  // 1周より あとに はみ出した キーは、おしりに そろえる
  for (const tr of cur.tracks) {
    for (const k of tr.keys) k.t = r4(clamp(k.t, 0, cur.sec));
    tr.keys.sort((a, b) => a.t - b.t);
  }
  e.target.value = String(cur.sec);
  setTime(clamp(now, 0, cur.sec));
  markDirty();
});

const SNAPS = [0.05, 0.1, 0];
let snapIndex = 0;
$('snapBtn').onclick = (e) => {
  snapIndex = (snapIndex + 1) % SNAPS.length;
  snapT = SNAPS[snapIndex];
  e.currentTarget.textContent = snapT ? snapT + ' きざみ' : 'きざみ なし';
  e.currentTarget.classList.toggle('on', snapT > 0);
};

// ============================================================
//  11. キーの ボタン
// ============================================================
function addKeyNow() {
  if (selPart < 0) { toast('さきに ぶひんを えらんでね'); return; }
  beginChange();
  const k = putKey(selPart, snapTime(now));
  selKey = { part: selPart, key: k };
  setTime(k.t);
  toast('キーを うちました');
}
$('keyAdd').onclick = addKeyNow;
$('keyAdd2').onclick = addKeyNow;

function deleteSelectedKey() {
  if (!cur) return;
  let target = selKey;
  if (!target && selPart >= 0) {
    const k = keyAt(selPart, now);
    if (k) target = { part: selPart, key: k };
  }
  if (!target) { toast('けす キーが えらばれていません'); return; }
  beginChange();
  removeKey(target.part, target.key);
  selKey = null;
  applyPose(); refreshParts(); syncProps(); markDirty();
  toast('キーを けしました');
}
$('keyDel').onclick = deleteSelectedKey;
$('undoBtn').onclick = doUndo;

$('grid').onclick = (e) => {
  groundGroup.visible = !groundGroup.visible;
  e.currentTarget.classList.toggle('on', groundGroup.visible);
};

// ============================================================
//  12. べんりな コピー（左右対称 と はんぶんずらし）
// ============================================================

/**
 * その部品の「はんたいがわ」の 部品を さがす。
 * いち が x について ちょうど うら返し、大きさと しゅるいが 同じ もの。
 */
function mirrorPartOf(i) {
  const a = parts[i];
  if (!a || Math.abs(a.base.pos.x) < 0.05) return -1;
  let best = -1, bestD = 0.4;
  for (let j = 0; j < parts.length; j++) {
    if (j === i) continue;
    const b = parts[j];
    if (b.type !== a.type) continue;
    const d = Math.abs(b.base.pos.x + a.base.pos.x)
            + Math.abs(b.base.pos.y - a.base.pos.y)
            + Math.abs(b.base.pos.z - a.base.pos.z);
    const ds = Math.abs(b.base.size.x - a.base.size.x)
             + Math.abs(b.base.size.y - a.base.size.y)
             + Math.abs(b.base.size.z - a.base.size.z);
    if (d < bestD && ds < 0.3) { bestD = d; best = j; }
  }
  return best;
}

/**
 * 左右に うつす。
 * x を うら返すので、いちの x と、まわり方の y・z が はんたいに なる。
 * shift が true なら、時こくを 半分（1周の まんなか）だけ ずらす（あるく の 足に べんり）。
 */
function mirrorCopy(shift) {
  if (selPart < 0) { toast('さきに ぶひんを えらんでね'); return; }
  const src = trackOf(selPart);
  if (!src || !src.keys.length) { toast('この ぶひんには まだ キーが ありません'); return; }
  const j = mirrorPartOf(selPart);
  if (j < 0) { toast('はんたいがわの ぶひんが 見つかりません'); return; }

  beginChange();
  const half = shift ? cur.sec / 2 : 0;
  const keys = src.keys.map((k) => ({
    t: r4((k.t + half) % cur.sec),
    pos: { x: r4(-k.pos.x), y: r4(k.pos.y), z: r4(k.pos.z) },
    rot: { x: r4(k.rot.x), y: r4(-k.rot.y), z: r4(-k.rot.z) },
  })).sort((a, b) => a.t - b.t);

  // かさなった 時こくは まとめる
  const out = [];
  for (const k of keys) {
    if (out.length && Math.abs(out[out.length - 1].t - k.t) < 1e-4) out[out.length - 1] = k;
    else out.push(k);
  }
  cur.tracks = cur.tracks.filter((t) => t.part !== j);
  cur.tracks.push({ part: j, keys: out });

  applyPose(); refreshParts(); syncProps(); markDirty();
  toast(partLabel(j) + ' に ' + (shift ? '半分 ずらして ' : '') + 'うつしました');
}
$('mirror').onclick = () => mirrorCopy(false);
$('mirrorHalf').onclick = () => mirrorCopy(true);

$('clearTrack').onclick = () => {
  if (selPart < 0) { toast('さきに ぶひんを えらんでね'); return; }
  if (!trackOf(selPart)) { toast('まだ キーが ありません'); return; }
  beginChange();
  cur.tracks = cur.tracks.filter((t) => t.part !== selPart);
  selKey = null;
  applyPose(); refreshParts(); syncProps(); markDirty();
  toast('キーを ぜんぶ けしました');
};

// ============================================================
//  13. アニメの 出し入れ（名前を つけて 何個でも）
// ============================================================
function openAnim(name) {
  if (!anims[name]) return;
  current = name;
  cur = anims[name];
  undoStack = [];
  selKey = null;
  // モデルが 消えていたら、あるもので 代わりを たてる
  if (!models[cur.model]) cur.model = Object.keys(models)[0] || '';
  buildModel(cur.model);
  // その モデルに ない 部品の トラックは すてる
  cur.tracks = cur.tracks.filter((t) => t.part >= 0 && t.part < parts.length);
  selPart = -1;
  gizmo.visible = outline.visible = false;
  playing = false; syncPlayBtn();
  tlScroll = 0;
  localStorage.setItem(KEY_LAST, current);
  syncTop(); refreshAnims(); refreshParts(); syncProps();
  setTime(0);
  frame();
  setState('ほぞんずみ');
}

/** うえの ほうの 見た目（1周のながさ・ループ・モデル）を そろえる */
function syncTop() {
  if (!cur) return;
  $('secIn').value = String(cur.sec);
  $('loopBtn').textContent = cur.loop ? 'ループ する' : 'ループ しない';
  $('loopBtn').classList.toggle('on', !!cur.loop);
  const sel = $('modelSel');
  sel.innerHTML = '';
  for (const n of Object.keys(models)) {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === cur.model) o.selected = true;
    sel.appendChild(o);
  }
  syncTime();
}

$('modelSel').addEventListener('change', (e) => {
  const n = e.target.value;
  if (!models[n]) return;
  beginChange();
  cur.model = n;
  buildModel(n);
  cur.tracks = cur.tracks.filter((t) => t.part >= 0 && t.part < parts.length);
  selPart = -1; selKey = null;
  gizmo.visible = outline.visible = false;
  refreshParts(); syncProps(); setTime(now); frame(); markDirty();
});

/** 名前が つかえるか しらべる（空 / かぶり を はじく） */
function checkName(name, allowSame) {
  const n = (name || '').trim();
  if (!n) { toast('なまえを 入れてください'); return null; }
  if (anims[n] && n !== allowSame) { toast('その なまえは もう あります'); return null; }
  return n;
}

$('aNew').onclick = () => {
  let base = 'アニメ', i = 1;
  while (anims[base + i]) i++;
  const n = checkName(prompt('あたらしい アニメの なまえ（あるく / はしる など）', base + i));
  if (!n) return;
  anims[n] = { model: (cur && cur.model) || Object.keys(models)[0] || '', loop: true, sec: 1, tracks: [] };
  saveAll(true);
  openAnim(n);
  toast('「' + n + '」を 作りました');
};

$('aRename').onclick = () => {
  if (!current) return;
  const n = checkName(prompt('あたらしい なまえ', current), current);
  if (!n || n === current) return;
  // ならび順を くずさないように、キーを 入れかえながら 作りなおす
  const next = {};
  for (const k of Object.keys(anims)) next[k === current ? n : k] = anims[k];
  anims = next;
  current = n;
  saveAll(true);
  refreshAnims();
  toast('「' + n + '」に しました');
};

$('aDup').onclick = () => {
  if (!current) return;
  let n = current + 'のコピー', i = 2;
  while (anims[n]) n = current + 'のコピー' + (i++);
  anims[n] = deepCopy(cur);
  saveAll(true);
  openAnim(n);
  toast('「' + n + '」に ふくせいしました');
};

$('aDel').onclick = () => {
  if (!current) return;
  if (!confirm('「' + current + '」を けしますか？\nもとには もどせません。')) return;
  delete anims[current];
  const keys = Object.keys(anims);
  if (!keys.length) {
    anims['アニメ1'] = { model: Object.keys(models)[0] || '', loop: true, sec: 1, tracks: [] };
  }
  saveAll(true);
  openAnim(Object.keys(anims)[0]);
  toast('けしました');
};

// ============================================================
//  14. 一覧 と すうじ
// ============================================================
const alist = $('alist');
function refreshAnims() {
  alist.innerHTML = '';
  for (const name of Object.keys(anims)) {
    const a = anims[name];
    const row = document.createElement('div');
    row.className = 'wrow' + (name === current ? ' on' : '');
    const n = document.createElement('div');
    n.className = 'nm'; n.textContent = name;
    const c = document.createElement('div');
    c.className = 'cnt';
    c.textContent = a.tracks.reduce((s, t) => s + t.keys.length, 0) + '◆';
    row.append(n, c);
    row.onclick = () => { if (name !== current) { saveAll(true); openAnim(name); } };
    alist.appendChild(row);
  }
}

const plist = $('plist');
function refreshParts() {
  plist.innerHTML = '';
  parts.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'prow' + (i === selPart ? ' on' : '');
    const sw = document.createElement('div');
    sw.className = 'sw'; sw.style.background = p.color;
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = partLabel(i);
    const ty = document.createElement('div');
    const tr = trackOf(i);
    ty.className = 'ty'; ty.textContent = tr ? tr.keys.length + '◆' : '';
    row.append(sw, nm, ty);
    row.onclick = () => selectPart(i);
    plist.appendChild(row);
  });
  if (!parts.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.style.padding = '6px 8px';
    d.textContent = 'この モデルには ぶひんが ありません。';
    plist.appendChild(d);
  }
}

const props = $('props');
let beforeEdit = null;   // 数字を いじる 直前の すがた（もどす用）

function syncProps() {
  if (selPart < 0) {
    props.innerHTML = '<div class="empty">ぶひんを クリックすると、ここで うごきの すうじを いじれます。'
      + '<br><br>まわしたり うごかしたり すると、その 時こくに ◆キーが うたれます。</div>';
    return;
  }
  const d = deltaOf(selPart);
  const onKey = !!keyAt(selPart, now);
  const f = (v) => v.toFixed(2);
  const fd = (v) => (v * 180 / Math.PI).toFixed(0);

  props.innerHTML = `
    <div class="flab" style="color:#e7eef5;font-size:.8rem;margin-bottom:8px">
      ${partLabel(selPart)}　<span style="color:${onKey ? '#ffd66e' : '#8c9baa'}">
      ${now.toFixed(2)}びょう ${onKey ? '◆キーの上' : '（キーの あいだ）'}</span></div>
    <div class="fgrp"><div class="flab">まわす（ど） X / Y / Z</div><div class="frow">
      <input type="number" step="5" id="rx" value="${fd(d.rot.x)}">
      <input type="number" step="5" id="ry" value="${fd(d.rot.y)}">
      <input type="number" step="5" id="rz" value="${fd(d.rot.z)}"></div></div>
    <div class="fgrp"><div class="flab">ずらす（もとの いちから） X / Y / Z</div><div class="frow">
      <input type="number" step="0.25" id="px" value="${f(d.pos.x)}">
      <input type="number" step="0.25" id="py" value="${f(d.pos.y)}">
      <input type="number" step="0.25" id="pz" value="${f(d.pos.z)}"></div></div>
    <div class="fgrp"><div class="flab">まわす ときの 中心</div><div class="pivrow">
      <button class="btn small" id="pvT">うえ</button>
      <button class="btn small" id="pvC">まんなか</button>
      <button class="btn small" id="pvB">した</button></div></div>
    <div class="stack">
      <button class="btn small go" id="pKey">◆ ここに キーを うつ</button>
      <button class="btn small" id="pZero">この 時こくを 0 に もどす</button>
      <button class="btn small red" id="pDelKey">この キーを けす</button>
    </div>`;

  $('pvT').classList.toggle('on', pivot === 'top');
  $('pvC').classList.toggle('on', pivot === 'center');
  $('pvB').classList.toggle('on', pivot === 'bottom');
  $('pvT').onclick = () => { pivot = 'top'; syncProps(); };
  $('pvC').onclick = () => { pivot = 'center'; syncProps(); };
  $('pvB').onclick = () => { pivot = 'bottom'; syncProps(); };

  $('pKey').onclick = addKeyNow;
  $('pDelKey').onclick = () => {
    const k = keyAt(selPart, now);
    if (!k) { toast('この 時こくには キーが ありません'); return; }
    beginChange();
    removeKey(selPart, k);
    selKey = null;
    applyPose(); refreshParts(); syncProps(); markDirty();
    toast('キーを けしました');
  };
  $('pZero').onclick = () => {
    beginChange();
    setDelta(selPart, { pos: zero(), rot: zero() });
    applyPose(); refreshParts(); syncProps(); markDirty();
  };

  // --- 数字を いじったら、その 時こくに キーが うたれる ---
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) ? v : 0; };
  const readAll = () => ({
    pos: { x: num('px'), y: num('py'), z: num('pz') },
    rot: {
      x: num('rx') * Math.PI / 180,
      y: num('ry') * Math.PI / 180,
      z: num('rz') * Math.PI / 180,
    },
  });

  const watch = (el, isRot) => {
    el.addEventListener('focus', () => { beforeEdit = deepCopy(cur); });
    el.addEventListener('input', () => {
      const val = readAll();
      if (isRot) {
        const off = pivotOffset(selPart, val.rot);
        if (off) { val.pos.x = off.x; val.pos.y = off.y; val.pos.z = off.z; }
      }
      setDelta(selPart, val);
      applyPose();
      refreshParts();
    });
    el.addEventListener('change', () => {
      if (beforeEdit) { undoStack.push(beforeEdit); beforeEdit = null; }
      markDirty();
    });
  };
  for (const id of ['rx', 'ry', 'rz']) watch($(id), true);
  for (const id of ['px', 'py', 'pz']) watch($(id), false);
}

// ============================================================
//  15. ことだまで つかう / 引き出し / おしらせ
// ============================================================
/**
 * ことだま本体に そのまま はれる コードを 作る。
 *   プレイヤーのすがた("ひと")     … プレイヤーの 見た目を じぶんの モデルに する
 *   アニメ(プレイヤー, "あるく")   … その うごきを 再生する
 * この 2行で、モデリング部屋で 作った ひとが、じぶんの キャラクターに なる。
 */
function useCode() {
  return `プレイヤーのすがた("${cur.model}")
アニメ(プレイヤー, "${current}")`;
}

$('use').onclick = async () => {
  saveAll(true);
  const code = useCode();
  let ok = false;
  try {
    await navigator.clipboard.writeText(code);
    ok = true;
  } catch {
    // clipboard が つかえない ブラウザ用の 逃げ道
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? '2ぎょう コピーしました。ことだまに はりつけてね' : code);
};

function closeDrawers() {
  $('left').classList.remove('open');
  $('right').classList.remove('open');
}
$('burger').onclick = () => {
  $('right').classList.remove('open');
  $('left').classList.toggle('open');
};
$('gear').onclick = () => {
  $('left').classList.remove('open');
  $('right').classList.toggle('open');
};

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = 0; }, 1800);
}

/**
 * タイムラインの たかさを、ぶひんの 数に あわせる。
 * ぶひんが すくなければ 3Dの画面を 広く、多ければ タイムラインを 広くする。
 */
function fitTimeline() {
  const need = RULER + 10 + parts.length * ROW
    + $('tlbar').offsetHeight + $('scrubrow').offsetHeight;
  $('tl').style.height = Math.round(clamp(need, 170, innerHeight * 0.55)) + 'px';
}

function resize() {
  fitTimeline();
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, Math.max(1, r.height), false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ============================================================
//  16. まいかいの えがき
// ============================================================
let t0 = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const nowMs = performance.now();
  const dt = Math.min(0.05, (nowMs - t0) / 1000); t0 = nowMs;

  // --- さいせい ---
  if (playing && cur) {
    let t = now + dt;
    if (t >= cur.sec) {
      if (cur.loop) t = t % cur.sec;
      else { t = cur.sec; playing = false; syncPlayBtn(); }
    }
    now = t;
    applyPose();
    syncTime();
  }

  flyStep(dt);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.pos.clone().add(camDir()));

  if (selPart >= 0 && parts[selPart]) {
    const mesh = parts[selPart].mesh;
    const b = new THREE.Box3().setFromObject(mesh);
    const c = new THREE.Vector3(); b.getCenter(c);
    const s = new THREE.Vector3(); b.getSize(s);
    outline.position.copy(c);
    outline.scale.set(Math.max(s.x, .002), Math.max(s.y, .002), Math.max(s.z, .002));

    gizmo.position.copy(mesh.position);
    // かいてんの わは、その部品の むきに あわせる（うでの じくで まわせる）
    if (mode === 'rotate') gizmo.quaternion.copy(mesh.quaternion);
    else gizmo.quaternion.identity();
    gizmo.scale.setScalar(cam.pos.distanceTo(mesh.position) * 0.34);
  }

  renderer.render(scene, camera);
  drawTimeline();
}

// ============================================================
//  17. さいしょに するしごと
// ============================================================

/**
 * 見本の アニメ「てをふる」を 1つ 作る。
 * どの モデルでも それっぽく なるように、
 *   ・いちばん よこに ある ぶひん（うで っぽい もの）を さがして
 *   ・それを 前後に ふる
 * ということを します。
 */
function seed() {
  const name = Object.keys(models)[0];
  const list = (models[name] && models[name].parts) || [];
  if (!list.length) return;

  // よこに いちばん はなれた ぶひん = うで っぽい
  let arm = 0, bestX = -1;
  list.forEach((p, i) => {
    const x = Math.abs((p.pos && p.pos.x) || 0);
    if (x > bestX) { bestX = x; arm = i; }
  });

  const wave = (a) => ([
    { t: 0,    pos: zero(), rot: { x: r4(-a), y: 0, z: 0 } },
    { t: 0.5,  pos: zero(), rot: { x: r4(a),  y: 0, z: 0 } },
  ]);

  anims['てをふる'] = {
    model: name, loop: true, sec: 1,
    tracks: [{ part: arm, keys: wave(0.6) }],
  };
  saveAll(true);
}

models = loadModels();
anims = loadAnims();

if (!Object.keys(models).length) {
  // モデルが 1つも ないときは、案内だけ 出して おしまい
  $('nomodel').classList.add('show');
  setState('モデルが ありません');
} else {
  if (!Object.keys(anims).length) seed();
  if (!Object.keys(anims).length) {
    anims['アニメ1'] = { model: Object.keys(models)[0], loop: true, sec: 1, tracks: [] };
    saveAll(true);
  }
  const last = localStorage.getItem(KEY_LAST);
  const start = anims[last] ? last : Object.keys(anims)[0];

  setMode('rotate');
  resize();
  openAnim(start);
  loop();
}

// ------------------------------------------------------------
//  うごきを たしかめる ための 小さな まど口（テスト用）
// ------------------------------------------------------------
window.KOTODAMA_ANIM = {
  anims: () => anims,
  cur: () => cur,
  current: () => current,
  parts: () => parts,
  partPose: (i) => ({
    pos: parts[i].mesh.position.toArray(),
    rot: parts[i].mesh.rotation.toArray().slice(0, 3),
  }),
  sample: (part, t) => sample(part, t),
  selectPart,
  sel: () => selPart,
  setTime,
  time: () => now,
  putKey: (part, t) => putKey(part, t),
  setDeltaAt: (part, t, pos, rot) => {
    selectPart(part); setTime(t);
    setDelta(part, { pos: { ...zero(), ...pos }, rot: { ...zero(), ...rot } });
    applyPose(); refreshParts(); syncProps(); markDirty();
  },
  mirrorCopy,
  setMode,
  openAnim,
  newAnim: (name, modelName) => {
    anims[name] = { model: modelName || Object.keys(models)[0], loop: true, sec: 1, tracks: [] };
    saveAll(true); openAnim(name);
  },
  useCode,
  save: () => saveAll(true),
  play: togglePlay,
  playing: () => playing,
};
