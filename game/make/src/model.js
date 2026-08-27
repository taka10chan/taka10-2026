// ============================================================
//  ことだま — モデリング部屋
//
//  はこ と えんちゅう を ならべて、じぶんの 3D モデルを 作る 部屋です。
//  作った ものは localStorage['kotodama-models'] に しまわれて、
//  ことだま本体から
//        じぶんのモデル(0, 5, 0, "くるま")
//  で よび出せます。
//
//  そうさは ロブロックス・スタジオに 寄せてあります。
//    右ドラッグ  … みまわす
//    右+WASD/QE … とぶ
//    中ドラッグ  … よこに うごく
//    ホイール    … よる / はなれる
//    F           … えらんだ ものに よる
//    W / E / R   … いどう / おおきさ / かいてん
//    Shift+クリック … いくつも えらぶ
//    Ctrl+Z      … もどす
// ============================================================

import * as THREE from '../../lib/three.module.js';

const $ = (id) => document.getElementById(id);

/** しまう場所。ここ以外の localStorage の キーには ぜったいに さわらない。 */
const KEY_MODELS = 'kotodama-models';   // { なまえ: { parts:[...] } }
const KEY_LAST   = 'kotodama-model-last';  // さいごに ひらいていた さくひんの なまえ

// ============================================================
//  1. 3D の したごしらえ
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

// --- 地面（y = 0）。ここに あしが つくように 作るのが めやす ---
const groundGroup = new THREE.Group();
scene.add(groundGroup);
{
  // うっすら暗い板。これより 下に はみ出すと「地面より 下」だと わかる。
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshBasicMaterial({ color: 0x101922 })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.02;
  groundGroup.add(plate);

  // 1スタッドごとの ます目。まんなかの 線は 少し明るい。
  const grid = new THREE.GridHelper(60, 60, 0x6f8ba3, 0x2a3946);
  grid.material.transparent = true;
  grid.material.opacity = 0.85;
  groundGroup.add(grid);
}

/** ぜんぶの 部品を 入れておく 入れもの */
const model = new THREE.Group();
scene.add(model);

// えらんだ 部品を かこむ わく。いくつも えらべるので、必要な数だけ 使いまわす。
const outlines = new THREE.Group();
scene.add(outlines);
const OUTLINE_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const OUTLINE_MAT = new THREE.LineBasicMaterial({ color: 0xffd66e });
function outlineAt(i) {
  while (outlines.children.length <= i) {
    outlines.add(new THREE.LineSegments(OUTLINE_GEO, OUTLINE_MAT));
  }
  return outlines.children[i];
}

// えらんだ ものの「かげ」を y=0 に うつす。モデルの 下が どこか すぐ わかる。
const footprint = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.16, depthWrite: false })
);
footprint.rotation.x = -Math.PI / 2;
footprint.position.y = 0.012;
footprint.visible = false;
scene.add(footprint);

// ============================================================
//  2. 部品
// ============================================================
let parts = [];       // { mesh, type:'box'|'cyl', color }
let selection = [];   // いま えらんでいる 部品
let undoStack = [];   // もどす用。「かえる まえ」の すがたを つみ上げる

const isSel = (p) => selection.includes(p);

/** えらんでいる もの ぜんぶを まとめて かこむ はこ */
function selBounds() {
  const b = new THREE.Box3();
  for (const p of selection) b.union(new THREE.Box3().setFromObject(p.mesh));
  return b;
}

function makeGeometry(type, size) {
  return type === 'cyl'
    ? new THREE.CylinderGeometry(size.x / 2, size.x / 2, size.y, 16)
    : new THREE.BoxGeometry(size.x, size.y, size.z);
}

function makeMesh(type, size, pos, rot, color) {
  const m = new THREE.Mesh(makeGeometry(type, size), new THREE.MeshLambertMaterial({ color }));
  m.position.set(pos.x, pos.y, pos.z);
  m.rotation.set(rot.x, rot.y, rot.z);
  m.userData.type = type;
  m.userData.size = { ...size };
  return m;
}

/** 部品を ひとつ ふやす。quiet のときは 一覧の 作りなおしなどを しない（まとめて 読むとき用） */
function addPart(type, size, pos, rot, color, quiet) {
  const mesh = makeMesh(type, size, pos, rot, color);
  model.add(mesh);
  const p = { mesh, type, color };
  parts.push(p);
  if (!quiet) { select(p, false); markDirty(); }
  return p;
}

function rebuildGeometry(p) {
  const s = p.mesh.userData.size;
  p.mesh.geometry.dispose();
  p.mesh.geometry = makeGeometry(p.type, s);
}

const r4 = (v) => Math.round(v * 10000) / 10000;   // 小数は 4けたまで

/**
 * いまの すがたを、そのまま しまえる 形（SPEC 6章）で 取り出す。
 *   { type, size:{x,y,z}, pos:{x,y,z}, rot:{x,y,z}（ラジアン）, color }
 */
function snapshot() {
  return parts.map((p) => ({
    type: p.type,
    size: { x: r4(p.mesh.userData.size.x), y: r4(p.mesh.userData.size.y), z: r4(p.mesh.userData.size.z) },
    pos:  { x: r4(p.mesh.position.x), y: r4(p.mesh.position.y), z: r4(p.mesh.position.z) },
    rot:  { x: r4(p.mesh.rotation.x), y: r4(p.mesh.rotation.y), z: r4(p.mesh.rotation.z) },
    color: p.color,
  }));
}

/** しまってあった 形から、部品を 作りなおす */
function restore(list) {
  clearAll();
  for (const d of (list || [])) {
    addPart(d.type === 'cyl' ? 'cyl' : 'box',
      d.size || { x: 1, y: 1, z: 1 },
      d.pos  || { x: 0, y: 0, z: 0 },
      d.rot  || { x: 0, y: 0, z: 0 },
      d.color || '#8c9baa', true);
  }
  select(null, false);
}

function clearAll() {
  for (const p of parts) { p.mesh.geometry.dispose(); model.remove(p.mesh); }
  parts = []; selection = [];
  outlines.visible = false; gizmo.visible = false; footprint.visible = false;
}

// --- もどす（Ctrl+Z）------------------------------------------------
/** かえる「まえ」の すがたを つんでおく。かえる 直前に よぶこと。 */
function beginChange() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
}
function doUndo() {
  if (!undoStack.length) { toast('もう もどせません'); return; }
  restore(undoStack.pop());
  refreshList(); syncProps(); markDirty();
  toast('ひとつ もどしました');
}

// ============================================================
//  3. さくひん（名前を つけて 何個でも 持てる）
// ============================================================

/** localStorage から ぜんぶの さくひんを 読む。こわれていたら 空っぽ。 */
function loadAll() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY_MODELS) || '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    // parts が ない ものは 直しておく
    for (const k of Object.keys(o)) {
      if (!o[k] || !Array.isArray(o[k].parts)) o[k] = { parts: [] };
    }
    return o;
  } catch { return {}; }
}
function saveAll(o) {
  localStorage.setItem(KEY_MODELS, JSON.stringify(o));
}

let works = {};        // { なまえ: { parts:[...] } }
let current = '';      // いま ひらいている さくひんの なまえ

/** いま 画面に 出ている ものを、いまの さくひんに しまう */
function saveCurrent(quiet) {
  if (!current) return;
  works[current] = { parts: snapshot() };
  saveAll(works);
  localStorage.setItem(KEY_LAST, current);
  setState('ほぞんずみ');
  refreshWorks();
  if (!quiet) toast('ほぞんしました');
}

/** さくひんを ひらく */
function openWork(name) {
  if (!works[name]) return;
  current = name;
  restore(works[name].parts);
  undoStack = [];
  localStorage.setItem(KEY_LAST, current);
  refreshWorks(); refreshList(); syncProps();
  frame();
  setState('ほぞんずみ');
}

/** 名前が つかえるか しらべる（空 / かぶり をはじく） */
function checkName(name, allowSame) {
  const n = (name || '').trim();
  if (!n) { toast('なまえを 入れてください'); return null; }
  if (works[n] && n !== allowSame) { toast('その なまえは もう あります'); return null; }
  return n;
}

$('wNew').onclick = () => {
  let base = 'さくひん', i = 1;
  while (works[base + i]) i++;
  const n = checkName(prompt('あたらしい さくひんの なまえ', base + i));
  if (!n) return;
  saveCurrent(true);
  works[n] = { parts: [] };
  saveAll(works);
  openWork(n);
  toast('「' + n + '」を 作りました');
};

$('wRename').onclick = () => {
  if (!current) return;
  const n = checkName(prompt('あたらしい なまえ', current), current);
  if (!n || n === current) return;
  // ならび順を くずさないように、キーを 入れかえながら 作りなおす
  const next = {};
  for (const k of Object.keys(works)) next[k === current ? n : k] = works[k];
  works = next;
  current = n;
  saveCurrent(true);
  toast('「' + n + '」に しました');
};

$('wDup').onclick = () => {
  if (!current) return;
  saveCurrent(true);
  let n = current + 'のコピー', i = 2;
  while (works[n]) n = current + 'のコピー' + (i++);
  works[n] = { parts: JSON.parse(JSON.stringify(works[current].parts)) };
  saveAll(works);
  openWork(n);
  toast('「' + n + '」に ふくせいしました');
};

$('wDel').onclick = () => {
  if (!current) return;
  if (!confirm('「' + current + '」を けしますか？\nもとには もどせません。')) return;
  delete works[current];
  saveAll(works);
  const keys = Object.keys(works);
  if (keys.length) {
    openWork(keys[0]);
  } else {
    // ぜんぶ なくなったら、空っぽの さくひんを ひとつ 作っておく
    works['さくひん1'] = { parts: [] };
    saveAll(works);
    openWork('さくひん1');
  }
  toast('けしました');
};

/** 手が とまったら じどうで ほぞんする（保存し忘れて 消えた、を なくす） */
let autoT = 0;
function markDirty() {
  setState('ほぞん中…');
  clearTimeout(autoT);
  autoT = setTimeout(() => saveCurrent(true), 1000);
}
function setState(t) { $('state').textContent = t; }
addEventListener('beforeunload', () => { clearTimeout(autoT); saveCurrent(true); });

// ============================================================
//  4. つまんで うごかす やじるし（ギズモ）
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
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), mat);
  cube.position.y = 0.68; cube.visible = false;

  // かいてん用の わ。その じくの まわりを まわす。
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.016, 8, 48), mat);
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  // わは つかみにくいので、見えない ふとい わを かさねておく
  const ringGrab = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.075, 6, 32),
    new THREE.MeshBasicMaterial({ visible: false }));
  ringGrab.rotation.x = Math.PI / 2;
  ringGrab.visible = false;

  // ぼうも つかみやすいように、見えない ふとい ぼうを かさねる
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.86, 6),
    new THREE.MeshBasicMaterial({ visible: false }));
  grab.position.y = 0.43;

  g.add(shaft, tip, cube, grab, ring, ringGrab);
  if (a.k === 'x') g.rotation.z = -Math.PI / 2;
  if (a.k === 'z') g.rotation.x = Math.PI / 2;
  g.renderOrder = 999;
  g.userData = { axis: a.k, dir: a.dir, shaft, tip, cube, grab, ring, ringGrab };
  gizmo.add(g);
  handles.push(g);
}

let mode = 'move';   // 'move' | 'scale' | 'rotate'
function setMode(m) {
  mode = m;
  $('tMove').classList.toggle('on', m === 'move');
  $('tScale').classList.toggle('on', m === 'scale');
  $('tRot').classList.toggle('on', m === 'rotate');
  const rot = m === 'rotate';
  for (const h of handles) {
    const u = h.userData;
    u.shaft.visible = !rot;         // かいてんのときは ぼうを 消して、わ だけにする
    u.grab.visible = !rot;
    u.tip.visible = m === 'move';
    u.cube.visible = m === 'scale';
    u.ring.visible = rot;
    u.ringGrab.visible = rot;
  }
}
$('tMove').onclick = () => setMode('move');
$('tScale').onclick = () => setMode('scale');
$('tRot').onclick = () => setMode('rotate');

// ============================================================
//  5. カメラ（ロブロックス・スタジオと おなじ そうさ）
// ============================================================
const cam = { pos: new THREE.Vector3(9, 7, 12), yaw: -2.5, pitch: -0.42 };
const keys = new Set();
let rightDown = false, midDown = false;
const FLY_SPEED = 14;

function camDir() {
  const cp = Math.cos(cam.pitch);
  return new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
}

/** カメラを まわす（マウスでも 指でも 使う） */
function look(dx, dy) {
  cam.yaw -= dx * 0.0032;
  cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - dy * 0.0032));
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
    onLeftDown(e.clientX, e.clientY, e.shiftKey || e.ctrlKey);
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
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  keys.add(e.code);

  if (e.code === 'KeyF') frame();
  if (e.code === 'Delete' || e.code === 'Backspace') { removeSel(); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyD') { duplicate(); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyZ') { doUndo(); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyS') { saveCurrent(false); e.preventDefault(); }
  if (e.ctrlKey && e.code === 'KeyA') { selectAll(); e.preventDefault(); }
  if (e.code === 'Escape') { select(null, false); closeDrawers(); }

  // 右ドラッグ中の W/E は「とぶ」ための キーなので、切りかえない
  if (!e.ctrlKey && !rightDown) {
    if (e.code === 'KeyW' || e.code === 'KeyG') setMode('move');
    if (e.code === 'KeyE' || e.code === 'KeyT') setMode('scale');
    if (e.code === 'KeyR') setMode('rotate');
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
  const b = selection.length ? selBounds() : new THREE.Box3().setFromObject(model);
  if (b.isEmpty()) { cam.pos.set(9, 7, 12); cam.yaw = -2.5; cam.pitch = -0.42; return; }
  const c = new THREE.Vector3(); b.getCenter(c);
  const s = new THREE.Vector3(); b.getSize(s);
  const dist = Math.max(2.2, Math.max(s.x, s.y, s.z) * 2.2);
  cam.pos.copy(c).addScaledVector(camDir(), -dist);
}

// ============================================================
//  6. ゆびの そうさ（学校の タブレット用）
//     1本 … みまわす / タップで えらぶ / やじるしを つまむ
//     2本 … ズーム と へいこういどう
// ============================================================
let touchState = null;

function touchPoint(t) { return { x: t.clientX, y: t.clientY }; }
function touchDist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
function touchMid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  closeDrawers();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    // まず やじるし（ギズモ）を ねらう。つかめたら そのまま ドラッグ。
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
    // うごかさずに はなしたら「タップして えらんだ」
    pickAt(touchState.start.x, touchState.start.y, false);
  }
  touchState = e.touches.length ? touchState : null;
}, { passive: false });

canvas.addEventListener('touchcancel', () => { touchState = null; drag = null; }, { passive: true });

// ============================================================
//  7. えらぶ・つかむ
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
  if (!gizmo.visible) return false;
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
function pickAt(clientX, clientY, add) {
  setRay(clientX, clientY);
  const hits = ray.intersectObjects(parts.map((p) => p.mesh), false);
  const hitPart = hits.length ? parts.find((p) => p.mesh === hits[0].object) : null;
  select(hitPart, add);
}

function onLeftDown(clientX, clientY, add) {
  if (tryGrabGizmo(clientX, clientY)) return;
  pickAt(clientX, clientY, add);
}

function startDrag(axis, dir) {
  const centre = new THREE.Vector3();
  selBounds().getCenter(centre);

  let plane;
  if (mode === 'rotate') {
    // かいてんは、その じくに たいして すいちょくな 板の上で 角度を はかる
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir.clone(), centre);
  } else {
    // いどう と おおきさは、じくを ふくみ カメラに 正対する 板の上で うごかす
    const view = camDir();
    const normal = new THREE.Vector3()
      .crossVectors(dir, new THREE.Vector3().crossVectors(view, dir)).normalize();
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
  }

  const p0 = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, p0)) return;

  // えらんでいる ぜんぶについて、はじめの 値を おぼえておく
  const start = selection.map((p) => ({
    p,
    pos: p.mesh.position.clone(),
    quat: p.mesh.quaternion.clone(),
    size: { ...p.mesh.userData.size },
  }));
  drag = { axis, dir: dir.clone(), plane, p0, start, centre };
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function onDragMove(clientX, clientY) {
  if (!selection.length || !drag) return;
  setRay(clientX, clientY);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(drag.plane, p)) return;

  // ---------- かいてん ----------
  if (mode === 'rotate') {
    const a0 = drag.p0.clone().sub(drag.centre);
    const a1 = p.clone().sub(drag.centre);
    if (a0.lengthSq() < 1e-8 || a1.lengthSq() < 1e-8) return;
    a0.normalize(); a1.normalize();
    let ang = Math.atan2(_v.copy(a0).cross(a1).dot(drag.dir), a0.dot(a1));
    if (snap > 0) {
      const step = Math.PI / 12;            // 15どきざみ（スタジオと おなじ）
      ang = Math.round(ang / step) * step;
    }
    _q.setFromAxisAngle(drag.dir, ang);
    for (const st of drag.start) {
      st.p.mesh.quaternion.copy(_q).multiply(st.quat);
      if (drag.start.length > 1) {
        // いくつも えらんでいるときは、まんなかの まわりを まわる
        st.p.mesh.position.copy(st.pos).sub(drag.centre).applyQuaternion(_q).add(drag.centre);
      }
    }
    syncProps();
    return;
  }

  // ---------- いどう と おおきさ ----------
  let amount = p.clone().sub(drag.p0).dot(drag.dir);
  if (snap > 0) amount = Math.round(amount / snap) * snap;

  const k = drag.axis;
  for (const st of drag.start) {
    if (mode === 'move') {
      st.p.mesh.position.copy(st.pos).addScaledVector(drag.dir, amount);
    } else {
      const s = st.p.mesh.userData.size;
      s[k] = Math.max(0.05, st.size[k] + amount);
      if (st.p.type === 'cyl' && (k === 'x' || k === 'z')) { s.x = s[k]; s.z = s[k]; }
      rebuildGeometry(st.p);
    }
  }
  syncProps();
  refreshList();
}

/**
 * @param p    えらぶ 部品（null なら ぜんぶ はずす）
 * @param add  true なら いま えらんでいる ものに 足す／はずす（Shift+クリック）
 */
function select(p, add) {
  if (!p) selection = [];
  else if (!add) selection = [p];
  else if (isSel(p)) selection = selection.filter((q) => q !== p);
  else selection.push(p);

  outlines.visible = gizmo.visible = footprint.visible = selection.length > 0;
  refreshList();
  syncProps();
}

function selectAll() {
  selection = parts.slice();
  outlines.visible = gizmo.visible = footprint.visible = selection.length > 0;
  refreshList();
  syncProps();
}

// ============================================================
//  8. 部品を ふやす・へらす
// ============================================================
let newColor = '#e5453f';   // つぎに 作る 部品の いろ

function duplicate() {
  if (!selection.length) return;
  beginChange();
  const made = [];
  for (const q of selection) {
    const s = q.mesh;
    made.push(addPart(q.type, { ...s.userData.size },
      { x: s.position.x, y: s.position.y, z: s.position.z + 1 },
      { x: s.rotation.x, y: s.rotation.y, z: s.rotation.z }, q.color, true));
  }
  selection = made;                       // ふくせいした ほうを えらんだ ままにする
  outlines.visible = gizmo.visible = footprint.visible = true;
  refreshList(); syncProps(); markDirty();
  toast(made.length + ' こ ふくせいしました');
}

function removeSel() {
  if (!selection.length) return;
  beginChange();
  const n = selection.length;
  for (const q of selection) { q.mesh.geometry.dispose(); model.remove(q.mesh); }
  parts = parts.filter((p) => !isSel(p));
  select(null, false);
  markDirty();
  toast(n + ' こ けしました');
}

$('addBox').onclick = () => {
  beginChange();
  addPart('box', { x: 2, y: 2, z: 2 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, newColor);
  refreshList();
};
$('addCyl').onclick = () => {
  beginChange();
  addPart('cyl', { x: 2, y: 2, z: 2 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, newColor);
  refreshList();
};
$('dup').onclick = duplicate;
$('del').onclick = removeSel;
$('undoBtn').onclick = doUndo;

$('grid').onclick = (e) => {
  groundGroup.visible = !groundGroup.visible;
  e.currentTarget.classList.toggle('on', groundGroup.visible);
};

// グリッドへの スナップ。0.25 → 1 → なし を 順ぐりに。
const SNAPS = [0.25, 1, 0];
let snapIndex = 0;
let snap = SNAPS[0];
$('snapBtn').onclick = (e) => {
  snapIndex = (snapIndex + 1) % SNAPS.length;
  snap = SNAPS[snapIndex];
  e.currentTarget.textContent = snap ? snap + ' きざみ' : 'きざみ なし';
  e.currentTarget.classList.toggle('on', snap > 0);
};

// ============================================================
//  9. 一覧 と すうじ と いろ
// ============================================================
const wlist = $('wlist');
function refreshWorks() {
  wlist.innerHTML = '';
  for (const name of Object.keys(works)) {
    const row = document.createElement('div');
    row.className = 'wrow' + (name === current ? ' on' : '');
    const n = document.createElement('div');
    n.className = 'nm'; n.textContent = name;
    const c = document.createElement('div');
    c.className = 'cnt'; c.textContent = (works[name].parts || []).length + 'こ';
    row.append(n, c);
    row.onclick = () => { if (name !== current) { saveCurrent(true); openWork(name); } };
    wlist.appendChild(row);
  }
}

const plist = $('plist');
function refreshList() {
  plist.innerHTML = '';
  parts.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'prow' + (isSel(p) ? ' on' : '');
    const s = p.mesh.userData.size;
    const sw = document.createElement('div');
    sw.className = 'sw'; sw.style.background = p.color;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = `${s.x.toFixed(2)}×${s.y.toFixed(2)}×${s.z.toFixed(2)}`;
    const ty = document.createElement('div');
    ty.className = 'ty'; ty.textContent = p.type === 'cyl' ? 'えんちゅう' : 'はこ';
    row.append(sw, nm, ty);
    row.onclick = (ev) => select(p, ev.shiftKey || ev.ctrlKey);
    plist.appendChild(row);
  });
  if (!parts.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.style.padding = '6px 8px';
    d.textContent = 'まだ ぶひんが ありません。＋はこ を おしてみよう。';
    plist.appendChild(d);
  }
}

const props = $('props');

/** えらんでいる もの ぜんぶで おなじ 値なら 返す。ばらばらなら null。 */
function common(get) {
  if (!selection.length) return null;
  const first = get(selection[0]);
  for (const q of selection) if (Math.abs(get(q) - first) > 1e-6) return null;
  return first;
}

let beforeEdit = null;   // 数字を いじる 直前の すがた（もどす用）

function syncProps() {
  const n = selection.length;
  if (n === 0) {
    props.innerHTML = '<div class="empty">ぶひんを クリックすると、ここで すうじを いじれます。' +
      '<br><br>Shift を おしながら クリックすると、いくつも えらべます。</div>';
    return;
  }

  const f = (v) => (v == null ? '' : v.toFixed(3));
  const fd = (v) => (v == null ? '' : (v * 180 / Math.PI).toFixed(1));

  // 位置は「えらんだ もの ぜんぶの まんなか」を 出す。うごかすと まとめて ずれる。
  const c = new THREE.Vector3();
  selBounds().getCenter(c);
  const b = selBounds();

  const sx = common((q) => q.mesh.userData.size.x);
  const sy = common((q) => q.mesh.userData.size.y);
  const sz = common((q) => q.mesh.userData.size.z);
  const rx = common((q) => q.mesh.rotation.x);
  const ry = common((q) => q.mesh.rotation.y);
  const rz = common((q) => q.mesh.rotation.z);
  const colSame = selection.every((q) => q.color === selection[0].color);

  const head = n > 1
    ? `<div class="multi">${n} こ えらんでいます<span>ばらばらの らんは 空です。うつと ぜんぶ そろいます</span></div>`
    : '';

  props.innerHTML = head + `
    <div class="fgrp"><div class="flab">${n > 1 ? 'いち（まんなか）' : 'いち'} (X / Y / Z)</div><div class="frow">
      <input type="number" step="0.25" id="px" value="${f(c.x)}">
      <input type="number" step="0.25" id="py" value="${f(c.y)}">
      <input type="number" step="0.25" id="pz" value="${f(c.z)}"></div></div>
    <div class="fgrp"><div class="flab">おおきさ (X / Y / Z)</div><div class="frow">
      <input type="number" step="0.25" min="0.05" id="sx" value="${f(sx)}" placeholder="—">
      <input type="number" step="0.25" min="0.05" id="sy" value="${f(sy)}" placeholder="—">
      <input type="number" step="0.25" min="0.05" id="sz" value="${f(sz)}" placeholder="—"></div></div>
    <div class="fgrp"><div class="flab">むき（ど）</div><div class="frow">
      <input type="number" step="15" id="rx" value="${fd(rx)}" placeholder="—">
      <input type="number" step="15" id="ry" value="${fd(ry)}" placeholder="—">
      <input type="number" step="15" id="rz" value="${fd(rz)}" placeholder="—"></div></div>
    <div class="fgrp"><div class="flab">いろ${colSame ? '' : '（ばらばら）'}</div>
      <input type="color" id="col" value="${selection[0].color}"></div>
    <div class="flab">いちばん した は y = ${b.min.y.toFixed(2)}${b.min.y < -0.005 ? '（地面より 下）' : ''}</div>`;

  // いじる 直前の すがたを おぼえて、あとで もどせるようにする
  const watch = (el) => {
    el.addEventListener('focus', () => { beforeEdit = snapshot(); });
    el.addEventListener('change', () => {
      if (beforeEdit) { undoStack.push(beforeEdit); beforeEdit = null; }
      markDirty();
    });
  };

  // --- いち。まんなかからの ずれぶんだけ、ぜんぶを うごかす ---
  const bindPos = (id, k) => {
    const el = $(id);
    watch(el);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      const now = new THREE.Vector3();
      selBounds().getCenter(now);
      const d = v - now[k];
      for (const q of selection) q.mesh.position[k] += d;
    });
  };
  bindPos('px', 'x'); bindPos('py', 'y'); bindPos('pz', 'z');

  // --- おおきさ。うった 値を ぜんぶに 入れる ---
  const bindSize = (id, k) => {
    const el = $(id);
    watch(el);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      for (const q of selection) {
        const s2 = q.mesh.userData.size;
        s2[k] = Math.max(0.05, v);
        if (q.type === 'cyl' && (k === 'x' || k === 'z')) { s2.x = s2[k]; s2.z = s2[k]; }
        rebuildGeometry(q);
      }
      refreshList();
    });
  };
  bindSize('sx', 'x'); bindSize('sy', 'y'); bindSize('sz', 'z');

  // --- むき（ど で 入れて、しまうときは ラジアン）---
  const bindRot = (id, k) => {
    const el = $(id);
    watch(el);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      for (const q of selection) q.mesh.rotation[k] = v * Math.PI / 180;
    });
  };
  bindRot('rx', 'x'); bindRot('ry', 'y'); bindRot('rz', 'z');

  // --- いろ ---
  const col = $('col');
  col.addEventListener('focus', () => { beforeEdit = snapshot(); });
  col.addEventListener('input', () => applyColor(col.value, true));
  col.addEventListener('change', () => {
    if (beforeEdit) { undoStack.push(beforeEdit); beforeEdit = null; }
    markDirty();
  });
}

/** えらんでいる 部品の いろを かえる（えらんでいなければ、つぎに 作る いろ になる） */
function applyColor(hex, quiet) {
  newColor = hex;
  if (!selection.length) { if (!quiet) toast('つぎに 作る いろに しました'); return; }
  for (const q of selection) {
    q.color = hex;
    q.mesh.material = new THREE.MeshLambertMaterial({ color: hex });
  }
  refreshList();
}

// よく つかう いろの パレット
const PALETTE = [
  ['あか', '#e5453f'], ['オレンジ', '#ff9d3c'], ['きいろ', '#ffd66e'],
  ['みどり', '#4fbf68'], ['みずいろ', '#58c8f0'], ['あお', '#3a7ad6'],
  ['むらさき', '#a06be0'], ['ピンク', '#ff8fc4'], ['ちゃいろ', '#8a5a35'],
  ['しろ', '#f2f5f8'], ['はいいろ', '#8c9baa'], ['くろ', '#232c34'],
];
{
  const pal = $('pal');
  for (const [name, hex] of PALETTE) {
    const b = document.createElement('button');
    b.style.background = hex;
    b.title = name;
    b.onclick = () => {
      if (selection.length) beginChange();
      applyColor(hex);
      syncProps();
      markDirty();
    };
    pal.appendChild(b);
  }
}

// ============================================================
//  10. ことだまで つかう / せまい画面の 引き出し / おしらせ
// ============================================================
$('use').onclick = async () => {
  saveCurrent(true);
  const code = `じぶんのモデル(0, 5, 0, "${current}")`;
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
  // どうしても コピーできない ブラウザでは、文を そのまま 出して うつしてもらう
  toast(ok ? 'コピーしました' : 'コピーできません。この文を つかってね → ' + code);
};

/** せまい画面の 引き出しの あけしめ。#app の しるしも あわせて つけかえる
    （ボタンが 引き出しに かぶらないように、CSS が しるしを 見ている） */
function syncDrawers() {
  const app = $('app');
  app.classList.toggle('leftopen', $('left').classList.contains('open'));
  app.classList.toggle('rightopen', $('right').classList.contains('open'));
}
function closeDrawers() {
  $('left').classList.remove('open');
  $('right').classList.remove('open');
  syncDrawers();
}
$('burger').onclick = () => {
  $('right').classList.remove('open');
  $('left').classList.toggle('open');
  syncDrawers();
};
$('gear').onclick = () => {
  $('left').classList.remove('open');
  $('right').classList.toggle('open');
  syncDrawers();
};

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = 0; }, 1800);
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ============================================================
//  11. まいかいの えがき
// ============================================================
let t0 = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;

  flyStep(dt);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.pos.clone().add(camDir()));

  if (selection.length) {
    // えらんでいる 部品 それぞれに わくを 出す
    selection.forEach((q, i) => {
      const b = new THREE.Box3().setFromObject(q.mesh);
      const c = new THREE.Vector3(); b.getCenter(c);
      const s = new THREE.Vector3(); b.getSize(s);
      const o = outlineAt(i);
      o.visible = true;
      o.position.copy(c);
      o.scale.set(Math.max(s.x, .002), Math.max(s.y, .002), Math.max(s.z, .002));
    });
    for (let i = selection.length; i < outlines.children.length; i++) {
      outlines.children[i].visible = false;
    }

    // やじるしは、えらんだ もの ぜんぶの まんなかに 置く
    const bb = selBounds();
    const cc = new THREE.Vector3(); bb.getCenter(cc);
    gizmo.position.copy(cc);
    gizmo.scale.setScalar(cam.pos.distanceTo(cc) * 0.34);   // 画面の 上の 大きさを 一定に

    // 地面（y=0）に かげを 出して、「モデルの 下」が わかるようにする
    const ss = new THREE.Vector3(); bb.getSize(ss);
    footprint.position.set(cc.x, 0.012, cc.z);
    footprint.scale.set(Math.max(ss.x, .05), Math.max(ss.z, .05), 1);
  }

  renderer.render(scene, camera);
}

// ============================================================
//  12. さいしょに するしごと
// ============================================================

/** 何も なければ、見本を 入れておく（まず うごくものを 見せる） */
function seed() {
  const P = (type, size, pos, rot, color) => ({ type, size, pos, rot, color });
  const D = (deg) => r4(deg * Math.PI / 180);

  works['くるま'] = { parts: [
    // しゃたい（あかい はこ）
    P('box', { x: 4, y: 1.2, z: 7 },   { x: 0, y: 1.3, z: 0 },    { x: 0, y: 0, z: 0 }, '#e5453f'),
    // うんてんせき（すこし 小さい はこ）
    P('box', { x: 3.2, y: 1.2, z: 3 }, { x: 0, y: 2.5, z: -0.4 }, { x: 0, y: 0, z: 0 }, '#58c8f0'),
    // タイヤ 4つ（えんちゅうを よこに たおす → z に 90ど まわす）
    P('cyl', { x: 1.6, y: 0.8, z: 1.6 }, { x:  2, y: 0.8, z:  2.3 }, { x: 0, y: 0, z: D(90) }, '#232c34'),
    P('cyl', { x: 1.6, y: 0.8, z: 1.6 }, { x: -2, y: 0.8, z:  2.3 }, { x: 0, y: 0, z: D(90) }, '#232c34'),
    P('cyl', { x: 1.6, y: 0.8, z: 1.6 }, { x:  2, y: 0.8, z: -2.3 }, { x: 0, y: 0, z: D(90) }, '#232c34'),
    P('cyl', { x: 1.6, y: 0.8, z: 1.6 }, { x: -2, y: 0.8, z: -2.3 }, { x: 0, y: 0, z: D(90) }, '#232c34'),
  ] };

  works['き'] = { parts: [
    // みき
    P('cyl', { x: 1, y: 4, z: 1 },       { x: 0, y: 2,   z: 0 }, { x: 0, y: 0, z: 0 },      '#8a5a35'),
    // は（下から 3だん。まんなかの だんは ななめに して もこもこに）
    P('box', { x: 4.4, y: 1.8, z: 4.4 }, { x: 0, y: 4.7, z: 0 }, { x: 0, y: 0, z: 0 },      '#3fa856'),
    P('box', { x: 3.4, y: 1.6, z: 3.4 }, { x: 0, y: 6,   z: 0 }, { x: 0, y: D(45), z: 0 },  '#4fbf68'),
    P('box', { x: 2,   y: 1.4, z: 2 },   { x: 0, y: 7.1, z: 0 }, { x: 0, y: 0, z: 0 },      '#63d47c'),
  ] };
  saveAll(works);
}

works = loadAll();
if (!Object.keys(works).length) seed();

const last = localStorage.getItem(KEY_LAST);
current = works[last] ? last : Object.keys(works)[0];

setMode('move');
resize();
openWork(current);
loop();

// ------------------------------------------------------------
//  うごきを たしかめる ための 小さな まど口（テスト用）
// ------------------------------------------------------------
window.KOTODAMA_MODEL = {
  parts: () => parts,
  works: () => works,
  current: () => current,
  selectIndex: (i, add) => select(parts[i], !!add),
  selectAll,
  setMode,
  openWork,
  save: () => saveCurrent(true),
  frame,
};
