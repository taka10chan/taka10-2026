// Gun Arena（ブラウザ版）本体。
//
// 元の Roblox 版は、サーバーが当たり判定をして、クライアントが表示していました。
// ここはひとりで遊ぶので、全部この1つの中で動きます。

import * as THREE from '../lib/three.module.js';
import { World } from './physics.js';
import { Arena, setupLighting } from './arena.js';
import { Player, State } from './player.js';
import { Bot, createCharacter } from './bots.js';
import { Input } from './input.js';
import { buildGunMesh, muzzleOf } from './gunmodels.js';
import { Hud } from './hud.js';
import { Effects } from './effects.js';
import {
  MOVEMENT, WEAPONS, GRENADES, MATCH, BASE_FOV, BOTS,
  LOADOUT_CHOICES, BOT_NAMES,
} from './config.js';
import { WeaponState, spreadDegrees, scatter, fireRay, meleeHit, explode } from './combat.js';

const TEAM_HEX = { red: 0xff4e60, blue: 0x46a0ff };

// ============================================================
//  立ち上げ
// ============================================================

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
setupLighting(scene);

const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.1, 900);

const world = new World();
const arena = new Arena(scene, world);
const effects = new Effects(scene);
const input = new Input(canvas);
const hud = new Hud(document.getElementById('hud'));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ============================================================
//  自分
// ============================================================

const player = new Player(world, MOVEMENT);
player.name = 'あなた';
player.team = 'red';
player.kills = 0;
player.deaths = 0;
player.isBot = false;

const loadout = { primary: 'AR', secondary: 'Pistol', melee: 'Knife' };
const slots = [null, new WeaponState('AR'), new WeaponState('Pistol'), new WeaponState('Knife')];
let slot = 1;
const weapon = () => slots[slot];

const grenades = { Frag: GRENADES.Frag.charges, Flash: GRENADES.Flash.charges };
let grenadeCooldown = 0;

let baseFov = BASE_FOV;
let sensitivity = 1.0;
let gunScale = 1.0;        // 武器の大きさ。設定でみんなが変えられます

// 前に使った設定を読み込む（この端末に覚えさせています）
const SETTINGS_KEY = 'gunarena-settings';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  if (isFinite(saved.sensitivity)) sensitivity = saved.sensitivity;
  if (isFinite(saved.fov)) baseFov = saved.fov;
  if (isFinite(saved.gunScale)) gunScale = saved.gunScale;
} catch {}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      sensitivity, fov: baseFov, gunScale,
    }));
  } catch {}
}

hud.onLoadoutPick = (cat, name) => {
  loadout[cat] = name;
  const idx = cat === 'primary' ? 1 : cat === 'secondary' ? 2 : 3;
  slots[idx] = new WeaponState(name);
  if (slot === idx) refreshViewmodel();
};
hud.onSensitivity = (v) => { sensitivity = v; saveSettings(); };
hud.onFov = (v) => { baseFov = v; saveSettings(); };
hud.onGunScale = (v) => { gunScale = v; refreshViewmodel(); saveSettings(); };

// ============================================================
//  一人称の武器（画面の手前に出る銃）
// ============================================================

const viewmodel = new THREE.Group();
// 大きさは武器ごとに refreshViewmodel で入れ直します
camera.add(viewmodel);
scene.add(camera);

let gunMesh = null;
let muzzleLocal = new THREE.Vector3(0, 0.06, -3);
const VM_BASE = 0.3;      // 全体の基準。武器ごとの viewScale を掛けます
const ADS = new THREE.Vector3(0, 0, -0.85);   // refreshViewmodel で高さを入れ直す

function refreshViewmodel() {
  if (gunMesh) viewmodel.remove(gunMesh);
  const def = weapon().def;
  gunMesh = buildGunMesh(def);
  viewmodel.add(gunMesh);
  muzzleLocal = muzzleOf(def, gunMesh);

  // 武器ごとの大きさ × 設定でみんなが決めた倍率
  const sc = VM_BASE * (def.viewScale || 1) * gunScale;
  viewmodel.scale.setScalar(sc);

  // 照準器がちょうど画面の中心に来る高さへ下げる。
  // こうすると「覗いた先＝弾の飛ぶ先」が一致します。
  ADS.set(0, -(gunMesh.userData.sightY || 0.46) * sc, def.scope ? -0.7 : -0.62);
}
refreshViewmodel();

// 読み込んだ設定を、スライダーの見た目にも反映する
if (hud.setSettings) hud.setSettings({ sensitivity, fov: baseFov, gunScale });

// 画面のどこに銃を置くか。腰だめ / 構え / スライディング。
const HIP = new THREE.Vector3(0.62, -0.52, -1.15);
const SLIDE_POSE = new THREE.Vector3(0.5, -0.75, -1.0);
const vmPos = HIP.clone();
let vmRecoil = 0;
let reloadSpin = 0;

// ============================================================
//  試合
// ============================================================

const bots = [];
let fighters = [player];

let format = 3;                 // 3 対 3
let score = { red: 0, blue: 0 };
let phase = 'idle';             // idle | countdown | live | roundover | matchover
let phaseEnd = 0;
let countdownShown = 0;

/**
 * ボットの強さ。
 * こちらの点が入るほど強くなります。
 *   0 点 … skillStart（かなり弱い）
 *   4 点 … skillEnd  （本気）
 */
function botSkillFor(myScore) {
  const last = Math.max(1, MATCH.scoreToWin - 1);
  const t = Math.min(1, myScore / last);
  return BOTS.skillStart + (BOTS.skillEnd - BOTS.skillStart) * t;
}

/** 星いくつぶんの強さか（画面に出す用） */
function skillStars(myScore) {
  const last = Math.max(1, MATCH.scoreToWin - 1);
  const n = Math.round(Math.min(1, myScore / last) * 4) + 1;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function makeBots() {
  for (const b of bots) scene.remove(b.mesh);
  bots.length = 0;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let n = 0;
  for (const team of ['red', 'blue']) {
    const count = team === 'red' ? format - 1 : format;   // 自分が赤に入る
    for (let i = 0; i < count; i++) {
      const w = Math.random() < 0.7
        ? pick(LOADOUT_CHOICES.primary)
        : pick(LOADOUT_CHOICES.secondary);
      bots.push(new Bot(scene, world, arena, BOT_NAMES[n++ % BOT_NAMES.length], team, w, BOTS.skill));
    }
  }
  fighters = [player, ...bots];
}

function startRound() {
  let ri = 0, bi = 0;
  const sp = arena.spawnFor('red', ri++);
  player.respawn(sp.x, sp.y, sp.z);
  player.yaw = player.team === 'red' ? Math.PI : 0;   // 赤は +Z（中央）を向く
  player.pitch = 0;
  for (const s of slots) if (s) s.refill();
  grenades.Frag = GRENADES.Frag.charges;
  grenades.Flash = GRENADES.Flash.charges;

  const skill = botSkillFor(score[player.team]);
  for (const b of bots) {
    const p = arena.spawnFor(b.team, b.team === 'red' ? ri++ : bi++);
    b.respawn(p);
    b.skill = skill;                       // 点が進むほど強くなる
    b.yaw = b.team === 'red' ? Math.PI : 0;
  }
  phase = 'countdown';
  phaseEnd = now() + MATCH.countdownTime;
  countdownShown = 0;
}

function startMatch() {
  score.red = 0; score.blue = 0;
  makeBots();
  startRound();
}

function now() { return performance.now() / 1000; }

function aliveCount(team) {
  return fighters.filter((f) => f.team === team && f.alive).length;
}

// ============================================================
//  撃つ
// ============================================================

function applyDamage(attacker, victim, amount, part, point) {
  const died = victim.damage(amount, attacker);
  if (victim === player) {
    // 自分が撃たれた
  } else {
    effects.hitSpark(point);
  }
  if (attacker === player) {
    hud.hitMarker(died);
    hud.damageNumber(Math.round(amount), part === 'head');
  }
  if (died) {
    attacker.kills = (attacker.kills || 0) + 1;
    const wname = attacker.weapon ? attacker.weapon.def.display : (weapon().def.display);
    const tint = attacker.team === 'red' ? '#ff4e60' : '#46a0ff';
    hud.killFeed(`${attacker.name} → ${victim.name}${part === 'head' ? ' ★' : ''}`, tint);
    if (victim === player) hud.announce(`${attacker.name} に倒された`, 2.5);
  }
}

function shootHitscan(shooter, origin, dir, def) {
  const points = [];
  const pellets = def.pellets || 1;
  const moving = shooter === player
    ? Math.hypot(player.body.vel.x, player.body.vel.z) > 2
    : true;
  const sp = spreadDegrees(def, moving, shooter === player ? aiming : false);

  for (let i = 0; i < pellets; i++) {
    const d = scatter(dir, sp);
    const r = fireRay(world, fighters, shooter, origin, d, def);
    points.push(r.point);
    if (r.hit) applyDamage(shooter, r.victim, r.damage, r.part, r.point);
    else if (r.wall) effects.impact(r.point, { x: -d.x, y: -d.y, z: -d.z });
  }

  effects.muzzleFlash(origin);
  for (const p of points) effects.tracer(origin, p);
}

function playerShoot() {
  const w = weapon();
  const def = w.def;
  const t = now();
  if (!w.canFire(t) || !player.alive || phase !== 'live') return;

  if (def.melee) {
    w.consume(t);
    effects.meleeSwing(player.eye, player.forward);
    const hit = meleeHit(fighters, player, def);
    if (hit) applyDamage(player, hit.victim, hit.damage, 'body', hit.point);
    return;
  }

  w.consume(t);
  const muzzle = viewmodel.localToWorld(muzzleLocal.clone());
  camera.getWorldPosition(new THREE.Vector3());
  // 弾は必ず画面の中心から出す（元のゲームでスナイパーが右から出た問題への対処）
  const origin = player.eye;
  shootHitscan(player, origin, player.forward, def);
  player.addRecoil(def.recoil * 0.011);
  vmRecoil = Math.min(0.34, vmRecoil + def.recoil * 0.035);
  effects.muzzleFlash({ x: muzzle.x, y: muzzle.y, z: muzzle.z });
}

// ============================================================
//  グレネード
// ============================================================

const liveGrenades = [];

function throwGrenade(kind) {
  const g = GRENADES[kind];
  if (grenades[kind] <= 0 || grenadeCooldown > 0 || !player.alive || phase !== 'live') return;
  grenades[kind] -= 1;
  grenadeCooldown = g.cooldown;

  const geo = new THREE.SphereGeometry(0.5, 8, 6);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: g.color }));
  const e = player.eye, f = player.forward;
  mesh.position.set(e.x, e.y, e.z);
  scene.add(mesh);

  liveGrenades.push({
    kind, mesh, g,
    vel: { x: f.x * g.throwSpeed, y: f.y * g.throwSpeed + 14, z: f.z * g.throwSpeed },
    pos: { x: e.x, y: e.y, z: e.z },
    at: now() + g.fuse,
  });
}

function stepGrenades(dt) {
  for (let i = liveGrenades.length - 1; i >= 0; i--) {
    const gr = liveGrenades[i];
    gr.vel.y -= MOVEMENT.gravity * dt;
    gr.pos.x += gr.vel.x * dt;
    gr.pos.y += gr.vel.y * dt;
    gr.pos.z += gr.vel.z * dt;
    if (gr.pos.y < 1) { gr.pos.y = 1; gr.vel.y *= -0.35; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
    gr.mesh.position.set(gr.pos.x, gr.pos.y, gr.pos.z);

    if (now() >= gr.at) {
      scene.remove(gr.mesh);
      effects.explosion(gr.pos, gr.g.color, gr.kind === 'Frag' ? 26 : 16);
      if (gr.kind === 'Frag') {
        for (const r of explode(fighters, gr.pos, gr.g, player)) {
          applyDamage(player, r.victim, r.damage, 'body', r.victim.body.pos);
        }
      } else {
        const d = Math.hypot(player.body.pos.x - gr.pos.x, player.body.pos.z - gr.pos.z);
        if (d < gr.g.radius) hud.flash(1 - d / gr.g.radius, gr.g.duration * 0.5);
      }
      liveGrenades.splice(i, 1);
    }
  }
}

// ============================================================
//  ループ
// ============================================================

let aiming = false;
let spectateAt = 0;       // いま誰を見ているか（生きている味方の何番目か）
let wasAlive = true;
let last = performance.now();
let scoreboardOpen = false;
let loadoutOpen = false;
let settingsOpen = false;
let started = false;

input.onLockChange = (locked) => {
  if (input.touch) return;                // タッチ操作のときは関係ない
  document.getElementById('start').style.display = locked ? 'none' : 'flex';
  if (locked && !started) { started = true; startMatch(); }
};

function handleKeys() {
  const t = now();

  if (input.hit('Tab')) { scoreboardOpen = !scoreboardOpen; hud.toggleScoreboard(); }
  if (input.hit('KeyL')) { loadoutOpen = !loadoutOpen; hud.setLoadoutOpen(loadoutOpen); }
  if (input.hit('KeyO')) { settingsOpen = !settingsOpen; hud.setSettingsOpen(settingsOpen); }

  if (input.hit('Digit1') && slot !== 1) { slot = 1; refreshViewmodel(); }
  if (input.hit('Digit2') && slot !== 2) { slot = 2; refreshViewmodel(); }
  if (input.hit('Digit3') && slot !== 3) { slot = 3; refreshViewmodel(); }
  if (input.hit('KeyV') && slot !== 3) { slot = 3; refreshViewmodel(); }
  if (input.wheel !== 0) {
    slot = ((slot - 1 + input.wheel + 3) % 3) + 1;
    refreshViewmodel();
  }

  if (input.hit('KeyR')) weapon().startReload(t);
  if (input.hit('KeyG')) throwGrenade('Frag');
  if (input.hit('KeyF')) throwGrenade('Flash');
}

function frame() {
  requestAnimationFrame(frame);

  const nowMs = performance.now();
  let dt = (nowMs - last) / 1000;
  last = nowMs;
  if (dt > 0.05) dt = 0.05;      // タブを切り替えたあとに吹き飛ばないように
  const t = now();

  if (input.locked) {
    handleKeys();
    player.look(input.mouse.dx, input.mouse.dy, sensitivity * input.sensitivity * (aiming ? 0.55 : 1));
  }

  // --- 構える ---
  const w = weapon();
  aiming = input.locked && input.mouse.right && !w.def.melee && player.alive;

  // --- 撃つ ---
  if (input.locked && player.alive && phase === 'live') {
    if (w.def.auto ? input.mouse.left : input.mouse.leftEdge) playerShoot();
  }
  w.tick(t);
  if (grenadeCooldown > 0) grenadeCooldown -= dt;

  // --- 自分を動かす ---
  const mv = input.moveAxis();
  const canMove = phase === 'live' && player.alive && input.locked;
  player.update(dt, {
    f: canMove ? mv.f : 0,
    r: canMove ? mv.r : 0,
    jump: canMove && input.hit('Space'),
    sprint: input.down('ShiftLeft'),
    slide: input.down('ControlLeft') || input.down('KeyC'),
    aiming,
  });

  // ジャンプ台
  if (player.alive) {
    const power = arena.padUnder(player.body.pos);
    if (power > 0 && player.body.vel.y <= 1) {
      player.body.vel.y = power;
      player.airSpeed = Math.max(player.airSpeed, Math.hypot(player.body.vel.x, player.body.vel.z));
    }
  }

  // 落下死
  if (player.alive && player.body.pos.y < -30) {
    player.alive = false;
    player.deaths += 1;
    hud.killFeed(`${player.name} が 落下`, '#ffffff');
  }

  // --- ボット ---
  if (phase === 'live') {
    for (const b of bots) {
      b.update({
        dt, now: t, fighters,
        onShoot: (bot, o, d) => shootHitscan(bot, o, d, bot.weapon.def),
        onMelee: (bot) => {
          effects.meleeSwing(bot.eye, bot.forward);
          const h = meleeHit(fighters, bot, bot.weapon.def);
          if (h) applyDamage(bot, h.victim, h.damage, 'body', h.point);
        },
      });
      const power = arena.padUnder(b.body.pos);
      if (power > 0 && b.body.vel.y <= 1) b.body.vel.y = power;
    }
  }

  stepGrenades(dt);
  effects.update(dt);

  // --- 試合の進行 ---
  stepMatch(t);

  // --- カメラ ---
  camera.rotation.order = 'YXZ';

  // 生きている味方（自分が死んだときに見る相手）
  const mates = fighters.filter((f) => f !== player && f.team === player.team && f.alive);

  if (player.alive) {
    wasAlive = true;
    const eye = player.eye;
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  } else if (mates.length > 0) {
    // 倒れた直後は先頭から見る
    if (wasAlive) { spectateAt = 0; wasAlive = false; }
    if (input.locked && (input.mouse.leftEdge || input.hit('Space'))) {
      spectateAt = (spectateAt + 1) % mates.length;
    }
    const tgt = mates[spectateAt % mates.length];

    // 相手の斜め後ろ上から見る
    const back = 11, up = 6.5;
    const bx = Math.sin(tgt.yaw) * back;
    const bz = Math.cos(tgt.yaw) * back;
    const want = new THREE.Vector3(
      tgt.body.pos.x + bx,
      tgt.body.pos.y + up,
      tgt.body.pos.z + bz);
    camera.position.lerp(want, Math.min(1, dt * 6));
    camera.lookAt(tgt.body.pos.x, tgt.body.pos.y + 3.6, tgt.body.pos.z);
  } else {
    // 味方が全員やられた。自分の倒れた場所を上から見る
    const e = player.eye;
    camera.position.lerp(new THREE.Vector3(e.x, e.y + 9, e.z + 11), Math.min(1, dt * 4));
    camera.lookAt(e.x, e.y, e.z);
  }

  const wantFov = aiming ? w.def.adsFov : baseFov + (player.state === State.SLIDE ? 9 : 0);
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  // --- 一人称の銃の位置 ---
  const target = !player.alive ? new THREE.Vector3(0.62, -2.2, -1.15)
    : aiming ? ADS
    : player.state === State.SLIDE ? SLIDE_POSE
    : HIP;
  vmPos.lerp(target, Math.min(1, dt * 14));
  vmRecoil *= Math.pow(0.0015, dt);
  const bob = player.state === State.GROUND && Math.hypot(player.body.vel.x, player.body.vel.z) > 2
    ? Math.sin(player.bob * 2) * 0.012 : 0;
  viewmodel.position.set(vmPos.x, vmPos.y + bob, vmPos.z + vmRecoil * 0.5);
  viewmodel.rotation.set(-vmRecoil, 0, 0);

  // リロード中はくるっと回す（元のゲームのリロードモーションのかわり）
  if (w.reloading) {
    reloadSpin += dt * 7;
    viewmodel.rotation.x += Math.sin(reloadSpin) * 0.5 - 0.35;
    viewmodel.position.y -= 0.18;
  } else {
    reloadSpin = 0;
  }
  viewmodel.visible = player.alive;

  // --- HUD ---
  hud.update({
    health: player.health, maxHealth: player.maxHealth,
    ammo: w.melee ? -1 : w.ammo,
    reserve: w.melee ? -1 : w.reserve,
    reloading: w.reloading,
    weaponName: w.def.display,
    slot,
    spreadDeg: spreadDegrees(w.def, Math.hypot(player.body.vel.x, player.body.vel.z) > 2, aiming),
    slideReady: player.slideCooldown > 0 ? 1 - player.slideCooldown / MOVEMENT.slideCooldown : 1,
    grenades,
    redScore: score.red, blueScore: score.blue,
    phase: phaseText(t),
    countdown: phase === 'countdown' ? Math.max(1, Math.ceil(phaseEnd - t)) : 0,
    aiming,
    roster: fighters.map((f) => ({
      name: f.name, team: f.team, alive: f.alive, self: f === player,
    })),
    scoreboard: fighters.map((f) => ({
      name: f.name, team: f.team, kills: f.kills || 0, deaths: f.deaths || 0,
    })),
    dead: !player.alive,
  });
  hud.setScope(aiming && !!w.def.scope);

  renderer.render(scene, camera);
  input.endFrame();
}

function phaseText(t) {
  const lv = 'ボット ' + skillStars(score[player.team]);
  if (phase === 'countdown') return 'まもなく開始　' + lv;
  if (phase === 'roundover') return `次のラウンドまで ${Math.max(0, Math.ceil(phaseEnd - t))}`;
  if (phase === 'matchover') return score.red > score.blue ? 'RED の勝ち' : 'BLUE の勝ち';
  if (phase === 'live' && player.alive) return lv;
  if (!player.alive) {
    const mates = fighters.filter((f) => f !== player && f.team === player.team && f.alive);
    if (mates.length === 0) return '全滅…';
    const tgt = mates[spectateAt % mates.length];
    return `観戦中: ${tgt.name}　（左クリック / Space で切り替え）`;
  }
  return '';
}

function stepMatch(t) {
  if (phase === 'idle') return;   // まだクリックされていない

  if (phase === 'countdown') {
    const left = Math.ceil(phaseEnd - t);
    if (left !== countdownShown) countdownShown = left;
    if (t >= phaseEnd) { phase = 'live'; hud.announce('スタート！', 1.2); }
    return;
  }

  if (phase === 'live') {
    const red = aliveCount('red'), blue = aliveCount('blue');
    if (red === 0 || blue === 0) {
      const winner = red === 0 ? 'blue' : 'red';
      score[winner] += 1;
      hud.announce(winner === 'red' ? 'RED がラウンドを取った' : 'BLUE がラウンドを取った', 2.2);
      if (score[winner] >= MATCH.scoreToWin) {
        phase = 'matchover';
        phaseEnd = t + MATCH.matchOverTime;
        hud.announce(winner === (player.team) ? '勝ちました！' : '負けました…', 4);
      } else {
        phase = 'roundover';
        phaseEnd = t + MATCH.roundResetTime;
      }
    }
    return;
  }

  if (phase === 'roundover' && t >= phaseEnd) { startRound(); return; }
  if (phase === 'matchover' && t >= phaseEnd) { startMatch(); return; }
}

// 対戦形式のボタン
for (const el of document.querySelectorAll('[data-format]')) {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    format = parseInt(el.dataset.format, 10);
    for (const o of document.querySelectorAll('[data-format]')) o.classList.toggle('on', o === el);
    if (started) startMatch();
  });
}

// マウスが無い端末（学校のタブレットなど）はタッチで操作します
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

function beginTouchGame() {
  input.enableTouch(document.getElementById('stick'), document.getElementById('knob'));
  for (const [id, code] of [
    ['btFire', 'FIRE'], ['btAim', 'AIM'], ['btJump', 'Space'],
    ['btSlide', 'ControlLeft'], ['btRun', 'ShiftLeft'], ['btReload', 'KeyR'],
    ['btW1', 'Digit1'], ['btW2', 'Digit2'], ['btW3', 'Digit3'],
    ['btNade', 'KeyG'], ['btLoad', 'KeyL'], ['btOpt', 'KeyO'],
  ]) input.bindButton(document.getElementById(id), code);

  document.getElementById('touch').style.display = 'block';
  document.getElementById('start').style.display = 'none';
  input.locked = true;                    // タッチではマウス固定を使わない
  if (!started) { started = true; startMatch(); }
}

document.getElementById('start').addEventListener('click', () => {
  if (IS_TOUCH) beginTouchGame();
  else canvas.requestPointerLock();
});

// 自動で分からなかったとき用。押せば必ずタッチ操作になります。
const forceBtn = document.getElementById('forceTouch');
if (forceBtn) forceBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  beginTouchGame();
});

// クリックする前の眺め。アリーナ全体が見える高さに置いておく。
player.respawn(0, 26, 132);
player.yaw = Math.PI;
player.pitch = -0.22;
frame();
