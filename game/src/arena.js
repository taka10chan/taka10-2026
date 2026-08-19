// アリーナ。
// 元の MapBuilder.lua が作っている形を、そのまま同じ座標で組み直しています。
// 単位はスタッド（Roblox と同じ）。

import * as THREE from '../lib/three.module.js';
import { Box } from './physics.js';

export const TEAM_COLOR = { red: 0xff4e60, blue: 0x46a0ff };

const C = {
  floor:      0xc4c6cd,
  wall:       0xeef0f4,
  trim:       0x3a3e48,
  tier:       0xd2d4dc,
  gold:       0xffd678,
  ramp:       0xb2b6c0,
  pad:        0x78f5ff,
  crateA:     0xff9c3e,
  crateB:     0x40c6be,
  coverWall:  0xe2e4ea,
  redBase:    0xffafb7,
  blueBase:   0xacd4ff,
  redWall:    0xff4e60,
  blueWall:   0x46a0ff,
  redSide:    0xbf3b48,
  blueSide:   0x3578bf,
  line:       0x969ca8,
};

const FLOOR_HALF = 130;
const WALL_HEIGHT = 60;
const CATWALK_Y = 16;
const LANE_X = 104;
const BASE_Z = 108;

export class Arena {
  /**
   * @param scene  THREE.Scene
   * @param world  physics.World
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.jumpPads = [];   // { minX,maxX,minZ,maxZ, y, power }
    this.spawns = { red: [], blue: [] };
    this._mat = new Map();
    this.build();
  }

  material(hex, opts = {}) {
    const key = hex + '|' + (opts.emissive || 0) + '|' + (opts.opacity ?? 1);
    let m = this._mat.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: hex,
        emissive: opts.emissive || 0x000000,
        transparent: (opts.opacity ?? 1) < 1,
        opacity: opts.opacity ?? 1,
      });
      this._mat.set(key, m);
    }
    return m;
  }

  /**
   * 箱をひとつ置く。
   * solid が true なら当たり判定にも入れる。
   */
  box(sx, sy, sz, px, py, pz, color, { solid = true, rotY = 0, rotX = 0, emissive = 0, opacity = 1 } = {}) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, this.material(color, { emissive, opacity }));
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rotX, rotY, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    if (solid && rotX === 0) {
      // 回っていない箱は、そのまま当たり判定にできる
      const w = rotY % Math.PI === 0 ? sx : sz;
      const d = rotY % Math.PI === 0 ? sz : sx;
      this.world.add(new Box(px, py, pz, w, sy, d));
    }
    return mesh;
  }

  /**
   * 坂。見た目は傾けた板、当たり判定は細かい階段で近似する。
   * （傾いた箱をそのまま判定に使うと、AABB では表現できないため）
   */
  ramp(from, to, width, color) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const runLen = Math.hypot(dx, dz);
    const len = Math.hypot(runLen, dy);
    const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2, cz = (from.z + to.z) / 2;
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, runLen);

    const geo = new THREE.BoxGeometry(width, 1.6, len);
    const mesh = new THREE.Mesh(geo, this.material(color));
    mesh.position.set(cx, cy, cz);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw;
    mesh.rotation.x = pitch;
    this.scene.add(mesh);

    // 当たり判定は階段で
    const steps = Math.max(4, Math.round(len / 2.5));
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const mx = from.x + dx * (t0 + t1) / 2;
      const mz = from.z + dz * (t0 + t1) / 2;
      const topY = from.y + dy * t1;
      const h = Math.max(1, topY);
      this.world.add(new Box(mx, topY - h / 2, mz,
        Math.abs(dx) > Math.abs(dz) ? (runLen / steps) + 0.6 : width,
        h,
        Math.abs(dx) > Math.abs(dz) ? width : (runLen / steps) + 0.6));
    }
    return mesh;
  }

  jumpPad(px, py, pz, power) {
    this.box(11, 1, 11, px, py, pz, C.pad, { emissive: 0x1a6a72 });
    this.box(5, 1.15, 5, px, py + 0.1, pz, 0xffffff, { solid: false });
    this.jumpPads.push({
      minX: px - 5.5, maxX: px + 5.5,
      minZ: pz - 5.5, maxZ: pz + 5.5,
      y: py + 0.5, power,
    });
  }

  build() {
    const B = this.box.bind(this);

    // ---------- 床 ----------
    B(260, 2, 260, 0, 0, 0, C.floor);
    B(1.5, 2.1, 260, -52, 0.05, 0, C.line, { solid: false });
    B(1.5, 2.1, 260, 52, 0.05, 0, C.line, { solid: false });
    B(260, 2.1, 2, 0, 0.05, 0, C.gold, { solid: false });

    // ---------- 外壁 ----------
    B(260, WALL_HEIGHT, 4, 0, 30, -FLOOR_HALF, C.wall);
    B(260, WALL_HEIGHT, 4, 0, 30, FLOOR_HALF, C.wall);
    B(4, WALL_HEIGHT, 260, -FLOOR_HALF, 30, 0, C.wall);
    B(4, WALL_HEIGHT, 260, FLOOR_HALF, 30, 0, C.wall);
    B(260.6, 3, 4.6, 0, WALL_HEIGHT, -FLOOR_HALF, C.trim, { solid: false });
    B(260.6, 3, 4.6, 0, WALL_HEIGHT, FLOOR_HALF, C.trim, { solid: false });
    B(4.6, 3, 260.6, -FLOOR_HALF, WALL_HEIGHT, 0, C.trim, { solid: false });
    B(4.6, 3, 260.6, FLOOR_HALF, WALL_HEIGHT, 0, C.trim, { solid: false });

    // ---------- 中央の丘 ----------
    B(52, 6, 52, 0, 3, 0, C.tier);
    B(32, 4, 32, 0, 8, 0, C.gold);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const dir = { x: Math.sin(a), z: Math.cos(a) };
      this.ramp(
        { x: dir.x * 44, y: 1.2, z: dir.z * 44 },
        { x: dir.x * 25, y: 6.2, z: dir.z * 25 },
        16, C.ramp);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B(5, 14, 5, sx * 11, 13, sz * 11, C.trim);
    }
    this.jumpPad(0, 10.5, 0, 63);
    B(26, 1.6, 26, 0, 20.5, 0, C.gold);

    // ---------- 両サイドの高架 ----------
    for (const xs of [-1, 1]) {
      const lx = xs * LANE_X;
      B(22, 1.6, 150, lx, CATWALK_Y, 0, C.tier);
      B(1.2, 5, 150, lx + xs * 10.4, CATWALK_Y + 3.3, 0, C.trim);
      for (const z of [-46, 0, 46]) B(20, 5, 4, lx, CATWALK_Y + 3.3, z, C.coverWall);
      for (const z of [-66, -22, 22, 66]) B(4, CATWALK_Y, 4, lx, CATWALK_Y / 2, z, C.trim);
      for (const zs of [-1, 1]) {
        this.ramp(
          { x: lx, y: 1.2, z: zs * 96 },
          { x: lx, y: CATWALK_Y + 1, z: zs * 62 },
          18, C.ramp);
      }
    }

    // ---------- 遮蔽物（Z 対称に置く） ----------
    const half = [
      [10, 6, 10, -30, 3, 30, C.crateA],
      [10, 6, 10, 30, 3, 30, C.crateB],
      [14, 8, 14, -62, 4, 44, C.crateB],
      [14, 8, 14, 62, 4, 44, C.crateA],
      [24, 5, 8, 0, 2.5, 58, C.crateA],
      [8, 11, 8, -16, 5.5, 72, C.crateB],
      [8, 11, 8, 16, 5.5, 72, C.crateB],
      [26, 6, 3, -46, 3, 74, C.coverWall],
      [26, 6, 3, 46, 3, 74, C.coverWall],
      [3, 9, 34, -78, 4.5, 20, C.coverWall],
      [3, 9, 34, 78, 4.5, 20, C.coverWall],
      [46, 8, 3, 0, 4, 92, C.coverWall],
    ];
    for (const [sx, sy, sz, px, py, pz, col] of half) {
      B(sx, sy, sz, px, py, pz, col);
      B(sx, sy, sz, px, py, -pz, col);
    }
    B(12, 6, 12, -70, 3, 0, C.crateA);
    B(12, 6, 12, 70, 3, 0, C.crateA);

    for (const x of [-40, 40]) for (const z of [-40, 40]) this.jumpPad(x, 0.6, z, 74);

    // ---------- 陣地 ----------
    for (const zs of [-1, 1]) {
      const team = zs < 0 ? 'red' : 'blue';
      const bz = zs * BASE_Z;
      B(88, 1.2, 36, 0, 1.1, bz, team === 'red' ? C.redBase : C.blueBase);
      B(88, 18, 2, 0, 9, bz + zs * 18, team === 'red' ? C.redWall : C.blueWall,
        { emissive: team === 'red' ? 0x5a1218 : 0x123a5a });
      for (const xo of [-43, 43]) {
        B(2, 18, 36, xo, 9, bz, team === 'red' ? C.redSide : C.blueSide);
      }
      for (const xo of [-26, 26]) B(22, 7, 3, xo, 3.5, bz - zs * 24, C.coverWall);
      for (const xo of [-70, 70]) this.jumpPad(xo, 0.6, bz - zs * 6, 74);

      for (let i = 0; i < 5; i++) {
        const sx = -32 + i * 16;
        const sz = bz + zs * 9;
        B(6, 1, 6, sx, 2.2, sz, team === 'red' ? C.redWall : C.blueWall, { solid: false });
        this.spawns[team].push({ x: sx, y: 2.7, z: sz });
      }
    }
  }

  /** ジャンプ台の上にいるか。乗っていたら power を返す。 */
  padUnder(pos) {
    for (const p of this.jumpPads) {
      if (pos.x < p.minX || pos.x > p.maxX) continue;
      if (pos.z < p.minZ || pos.z > p.maxZ) continue;
      if (pos.y > p.y + 3 || pos.y < p.y - 2) continue;
      return p.power;
    }
    return 0;
  }

  /** チームのスポーン地点をひとつ返す */
  spawnFor(team, index) {
    const list = this.spawns[team];
    return list[index % list.length];
  }
}

/** 空と光。アリーナが明るく見えるように、影は使わず環境光を強めに。 */
export function setupLighting(scene) {
  scene.background = new THREE.Color(0xa8d8f0);
  scene.fog = new THREE.Fog(0xa8d8f0, 180, 460);

  scene.add(new THREE.AmbientLight(0xffffff, 1.35));

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.5);
  sun.position.set(90, 160, 60);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xcfe4ff, 0.55);
  fill.position.set(-80, 60, -100);
  scene.add(fill);
}
