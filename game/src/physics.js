// 当たり判定と移動。
//
// アリーナは軸に沿った箱だけでできているので、AABB どうしの判定で足ります。
// 三次元をまとめて解こうとすると壁ずりが不安定になるので、
// 軸ごとに「動かす → めり込んでいたら押し戻す」を繰り返します。

export const GRAVITY_SCALE = 0.28; // 1 スタッド ≒ 0.28 m。Roblox の数値をメートルへ

/** 軸に沿った箱。中心と半径で持つ（判定のたびに割り算しないで済むように）。 */
export class Box {
  constructor(cx, cy, cz, sx, sy, sz) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.hx = sx / 2; this.hy = sy / 2; this.hz = sz / 2;
  }
  get minX() { return this.cx - this.hx; }
  get maxX() { return this.cx + this.hx; }
  get minY() { return this.cy - this.hy; }
  get maxY() { return this.cy + this.hy; }
  get minZ() { return this.cz - this.hz; }
  get maxZ() { return this.cz + this.hz; }
}

/** 衝突する箱をまとめて持つ。ざっくり格子に分けて、近いものだけ調べる。 */
export class World {
  constructor(cellSize = 24) {
    this.boxes = [];
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  add(box) {
    this.boxes.push(box);
    const c = this.cellSize;
    const x0 = Math.floor(box.minX / c), x1 = Math.floor(box.maxX / c);
    const z0 = Math.floor(box.minZ / c), z1 = Math.floor(box.maxZ / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = x + ',' + z;
        let cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(box);
      }
    }
    return box;
  }

  /** その範囲に重なりうる箱を返す（重複あり。判定は安いので気にしない）。 */
  near(minX, maxX, minZ, maxZ) {
    const c = this.cellSize;
    const out = [];
    const seen = new Set();
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const cell = this.grid.get(x + ',' + z);
        if (!cell) continue;
        for (const b of cell) {
          if (seen.has(b)) continue;
          seen.add(b);
          out.push(b);
        }
      }
    }
    return out;
  }
}

/**
 * 人ひとつぶんの当たり判定。足元を基準にした縦長の箱として扱う。
 *
 *   pos … 足元の位置
 *   vel … 速度
 */
export class Body {
  constructor(world, radius, height) {
    this.world = world;
    this.radius = radius;
    this.height = height;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.stepHeight = 2.2; // これ以下の段差は登れる
  }

  /** いまの位置での当たり判定の箱 */
  bounds(px = this.pos.x, py = this.pos.y, pz = this.pos.z) {
    return {
      minX: px - this.radius, maxX: px + this.radius,
      minY: py, maxY: py + this.height,
      minZ: pz - this.radius, maxZ: pz + this.radius,
    };
  }

  /** 一歩ぶん動かす。壁があればそこで止める（すべりながら）。 */
  step(dt) {
    const margin = 0.001;

    // --- 横（X）---
    this._moveAxis('x', this.vel.x * dt, margin);
    // --- 横（Z）---
    this._moveAxis('z', this.vel.z * dt, margin);
    // --- 縦（Y）---
    this.onGround = false;
    this._moveAxis('y', this.vel.y * dt, margin);
  }

  _moveAxis(axis, delta, margin) {
    if (delta === 0) return;
    const p = this.pos;
    p[axis] += delta;

    const b = this.bounds();
    const boxes = this.world.near(b.minX, b.maxX, b.minZ, b.maxZ);

    for (const box of boxes) {
      const a = this.bounds();
      if (a.maxX <= box.minX || a.minX >= box.maxX) continue;
      if (a.maxY <= box.minY || a.minY >= box.maxY) continue;
      if (a.maxZ <= box.minZ || a.minZ >= box.maxZ) continue;

      // めり込んだので、動いてきた向きへ押し戻す
      if (axis === 'y') {
        if (delta > 0) {            // 頭をぶつけた
          p.y = box.minY - this.height - margin;
          if (this.vel.y > 0) this.vel.y = 0;
        } else {                    // 着地した
          p.y = box.maxY + margin;
          if (this.vel.y < 0) this.vel.y = 0;
          this.onGround = true;
        }
      } else {
        // 低い段差なら、乗り越えられるか試す
        const stepTop = box.maxY;
        const rise = stepTop - p.y;
        if (rise > 0 && rise <= this.stepHeight && this._fitsAt(p.x, stepTop + margin, p.z)) {
          p.y = stepTop + margin;
          continue;
        }
        if (delta > 0) p[axis] = (axis === 'x' ? box.minX : box.minZ) - this.radius - margin;
        else           p[axis] = (axis === 'x' ? box.maxX : box.maxZ) + this.radius + margin;
        this.vel[axis] = 0;
      }
    }
  }

  /** そこに立てるか（頭がつかえないか） */
  _fitsAt(px, py, pz) {
    const a = this.bounds(px, py, pz);
    const boxes = this.world.near(a.minX, a.maxX, a.minZ, a.maxZ);
    for (const box of boxes) {
      if (a.maxX <= box.minX || a.minX >= box.maxX) continue;
      if (a.maxY <= box.minY || a.minY >= box.maxY) continue;
      if (a.maxZ <= box.minZ || a.minZ >= box.maxZ) continue;
      return false;
    }
    return true;
  }

  /** 足の下に床があるか（着地判定のとりこぼしを防ぐ） */
  groundCheck() {
    const probe = 0.15;
    const a = this.bounds(this.pos.x, this.pos.y - probe, this.pos.z);
    a.maxY = this.pos.y; // 足元だけ見る
    const boxes = this.world.near(a.minX, a.maxX, a.minZ, a.maxZ);
    for (const box of boxes) {
      if (a.maxX <= box.minX || a.minX >= box.maxX) continue;
      if (a.maxZ <= box.minZ || a.minZ >= box.maxZ) continue;
      if (box.maxY <= a.minY || box.maxY > a.maxY + probe) continue;
      return true;
    }
    return false;
  }
}

/**
 * 弾の当たり判定。
 * 箱の集まりに向けてまっすぐ線を伸ばし、一番手前に当たったものを返す。
 * 返り値: { t, point, box } / 当たらなければ null
 */
export function raycast(world, origin, dir, maxDist, extraTargets = []) {
  let best = null;

  const consider = (box, isTarget) => {
    const t = rayBox(origin, dir, box);
    if (t === null || t < 0 || t > maxDist) return;
    if (!best || t < best.t) {
      best = {
        t,
        point: {
          x: origin.x + dir.x * t,
          y: origin.y + dir.y * t,
          z: origin.z + dir.z * t,
        },
        box,
        target: isTarget ? box.owner : null,
      };
    }
  };

  // 地形。線が通る範囲だけ調べる
  const ex = origin.x + dir.x * maxDist;
  const ez = origin.z + dir.z * maxDist;
  for (const box of world.near(
    Math.min(origin.x, ex), Math.max(origin.x, ex),
    Math.min(origin.z, ez), Math.max(origin.z, ez))) {
    consider(box, false);
  }

  // 人（当たり判定の箱は毎フレーム作り直されるので、外から渡す）
  for (const box of extraTargets) consider(box, true);

  return best;
}

/** 線と箱。返り値は origin からの距離。当たらなければ null。 */
function rayBox(o, d, box) {
  let tmin = -Infinity, tmax = Infinity;
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) return null;
      continue;
    }
    const inv = 1 / dd[i];
    let t1 = (lo[i] - oo[i]) * inv;
    let t2 = (hi[i] - oo[i]) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
}

/** 二点が壁ごしでないか（ボットの視線に使う） */
export function hasLineOfSight(world, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const hit = raycast(world, from, dir, dist - 0.5);
  return hit === null;
}
