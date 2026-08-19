// 撃つ・当てる・ダメージを与える。
//
// 元のゲームと同じで、当たり判定は「見えない線をまっすぐ飛ばす」方式です。
// 画面に見えている弾は、当たったあとから追いかけて飛んでいるだけの飾りです。

import { SPREAD_SCALE, HITBOX, WEAPONS } from './config.js';
import { Box, raycast } from './physics.js';

/** 武器ごとの、いま何発あるかなどの状態 */
export class WeaponState {
  constructor(defName) {
    this.set(defName);
  }

  set(defName) {
    const def = WEAPONS[defName];
    this.def = def;
    this.name = defName;
    this.melee = !!def.melee;
    this.ammo = this.melee ? -1 : def.mag;
    this.reserve = this.melee ? -1 : def.reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShot = 0;
    this.abilityReadyAt = 0;
  }

  refill() {
    if (this.melee) return;
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.reloading = false;
  }

  get interval() { return 1 / this.def.rate; }

  canFire(now) {
    if (this.reloading) return false;
    if (now < this.nextShot) return false;
    if (!this.melee && this.ammo <= 0) return false;
    return true;
  }

  consume(now) {
    this.nextShot = now + this.interval;
    if (!this.melee) this.ammo -= 1;
  }

  startReload(now) {
    if (this.melee || this.reloading) return false;
    if (this.ammo >= this.def.mag || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadEnd = now + this.def.reload;
    return true;
  }

  tick(now) {
    if (this.reloading && now >= this.reloadEnd) {
      const need = this.def.mag - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
    }
  }
}

/** いまのばらつき（度）。動いていると広がる。 */
export function spreadDegrees(def, moving, aiming) {
  if (def.melee) return 0;
  let s = def.spread + (moving ? def.moveSpread : 0);
  if (aiming) s *= 0.35;
  return s * SPREAD_SCALE;
}

/** 向きを、円錐の中でばらつかせる */
export function scatter(dir, degrees) {
  if (degrees <= 0) return { ...dir };
  const rad = degrees * Math.PI / 180;
  // 適当な直交ベクトルを2本つくる
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dir.y) > 0.9) { ux = 1; uy = 0; }
  let rx = uy * dir.z - uz * dir.y;
  let ry = uz * dir.x - ux * dir.z;
  let rz = ux * dir.y - uy * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const bx = dir.y * rz - dir.z * ry;
  const by = dir.z * rx - dir.x * rz;
  const bz = dir.x * ry - dir.y * rx;

  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * Math.tan(rad);
  const ox = (rx * Math.cos(a) + bx * Math.sin(a)) * r;
  const oy = (ry * Math.cos(a) + by * Math.sin(a)) * r;
  const oz = (rz * Math.cos(a) + bz * Math.sin(a)) * r;

  const nx = dir.x + ox, ny = dir.y + oy, nz = dir.z + oz;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / nl, y: ny / nl, z: nz / nl };
}

/** その人の当たり判定の箱をつくる（胴と頭） */
export function hitboxesOf(fighter) {
  const p = fighter.body.pos;
  const b = HITBOX.body, h = HITBOX.head;
  const bodyBox = new Box(p.x, p.y + b.bottom + b.h / 2, p.z, b.w, b.h, b.d);
  const headBox = new Box(p.x, p.y + h.bottom + h.h / 2, p.z, h.w, h.h, h.d);
  bodyBox.owner = fighter; bodyBox.part = 'body';
  headBox.owner = fighter; headBox.part = 'head';
  return [bodyBox, headBox];
}

/**
 * 1発ぶんの判定。
 * @returns { hit, point, victim, part, damage } / 外れたら { hit:false, point }
 */
export function fireRay(world, fighters, shooter, origin, dir, def) {
  const targets = [];
  for (const f of fighters) {
    if (f === shooter || !f.alive) continue;
    if (f.team === shooter.team) continue;  // 味方には当たらない
    targets.push(...hitboxesOf(f));
  }

  const hit = raycast(world, origin, dir, def.range, targets);
  if (!hit) {
    return {
      hit: false,
      point: {
        x: origin.x + dir.x * def.range,
        y: origin.y + dir.y * def.range,
        z: origin.z + dir.z * def.range,
      },
    };
  }

  if (!hit.box.owner) {
    return { hit: false, point: hit.point, wall: true };
  }

  const victim = hit.box.owner;
  let part = hit.box.part;

  // スナイパーは、頭の近くに当たれば頭あつかいにする（元のゲームと同じ）
  if (part === 'body' && def.headBox) {
    const p = victim.body.pos;
    const hb = def.headBox;
    const cy = p.y + HITBOX.head.bottom + HITBOX.head.h / 2;
    if (Math.abs(hit.point.x - p.x) <= hb.w / 2 &&
        Math.abs(hit.point.z - p.z) <= hb.d / 2 &&
        Math.abs(hit.point.y - cy) <= hb.h / 2) {
      part = 'head';
    }
  }

  const damage = part === 'head' ? def.damage * (def.headMult || 1) : def.damage;
  return { hit: true, point: hit.point, victim, part, damage };
}

/**
 * 近接攻撃。前方の扇の中にいる、いちばん近い敵に当たる。
 * 背中側から当てると大ダメージ（バックスタブ）。
 */
export function meleeHit(fighters, attacker, def) {
  const eye = attacker.eye;
  const fwd = attacker.forward;
  let best = null, bestDist = Infinity;

  for (const f of fighters) {
    if (f === attacker || !f.alive || f.team === attacker.team) continue;
    const p = f.body.pos;
    const dx = p.x - eye.x, dy = (p.y + 2.5) - eye.y, dz = p.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > def.range) continue;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (dist || 1);
    if (dot < 0.35) continue;   // 正面 70 度くらいの範囲
    if (dist < bestDist) { bestDist = dist; best = f; }
  }
  if (!best) return null;

  // 相手の背中側から当てたか
  const vf = best.forward || { x: 0, y: 0, z: 1 };
  const toVictim = { x: best.body.pos.x - attacker.body.pos.x, z: best.body.pos.z - attacker.body.pos.z };
  const tl = Math.hypot(toVictim.x, toVictim.z) || 1;
  const behind = (vf.x * toVictim.x / tl + vf.z * toVictim.z / tl) > 0.34;

  return {
    victim: best,
    damage: behind ? (def.backstab || def.damage) : def.damage,
    backstab: behind,
    point: { x: best.body.pos.x, y: best.body.pos.y + 3, z: best.body.pos.z },
  };
}

/** 爆発。距離に応じてダメージが減る。 */
export function explode(fighters, center, g, source) {
  const out = [];
  for (const f of fighters) {
    if (!f.alive) continue;
    const p = f.body.pos;
    const d = Math.hypot(p.x - center.x, (p.y + 2.5) - center.y, p.z - center.z);
    if (d > g.radius) continue;
    const t = 1 - d / g.radius;
    let dmg = g.minDamage + (g.maxDamage - g.minDamage) * t;
    if (f === source) dmg *= g.selfScale;
    else if (f.team === source.team) continue;   // 味方には当たらない
    out.push({ victim: f, damage: dmg });
  }
  return out;
}
