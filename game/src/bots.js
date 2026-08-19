// ボット。
//
// むずかしいことはしません。
//   ・見えている敵のうち、いちばん近いやつを狙う
//   ・撃ちながら左右に動く（棒立ちだと的なので）
//   ・見えなければ、敵陣のほうへ歩いていく
//   ・弾が切れたらリロード
//
// 反応の遅さと狙いのズレをわざと入れて、強くなりすぎないようにしています。

import * as THREE from '../lib/three.module.js';
import { Body, hasLineOfSight } from './physics.js';
import { MOVEMENT } from './config.js';
import { WeaponState } from './combat.js';

const TEAM_HEX = { red: 0xff4e60, blue: 0x46a0ff };

/** 人の形。R15 っぽく、頭・胴・腕・脚のブロックで作る。 */
export function createCharacter(teamHex, isBot) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98c });
  const cloth = new THREE.MeshLambertMaterial({ color: teamHex });
  const dark = new THREE.MeshLambertMaterial({ color: isBot ? 0x363a44 : 0x2b2f38 });

  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // 足元を y=0 として積む
  g.userData.legL = add(0.9, 2.3, 1.0, -0.55, 1.15, 0, dark);
  g.userData.legR = add(0.9, 2.3, 1.0, 0.55, 1.15, 0, dark);
  add(2.2, 2.2, 1.1, 0, 3.4, 0, cloth);                    // 胴
  g.userData.armL = add(0.8, 2.1, 0.9, -1.5, 3.5, 0, cloth);
  g.userData.armR = add(0.8, 2.1, 0.9, 1.5, 3.5, 0, cloth);
  g.userData.head = add(1.5, 1.5, 1.5, 0, 5.3, 0, skin);
  add(1.6, 0.35, 1.6, 0, 6.0, 0, dark);                    // 帽子（当たり判定の目印にもなる）

  // 顔の向きが分かるように、目を前に出しておく
  const eye = new THREE.MeshBasicMaterial({ color: 0x1a1c22 });
  add(0.24, 0.24, 0.1, -0.34, 5.45, -0.78, eye);
  add(0.24, 0.24, 0.1, 0.34, 5.45, -0.78, eye);

  return g;
}

export class Bot {
  constructor(scene, world, arena, name, team, weaponName, skill = 1) {
    this.scene = scene;
    this.world = world;
    this.arena = arena;
    this.name = name;
    this.team = team;
    this.isBot = true;

    this.body = new Body(world, MOVEMENT.radius, MOVEMENT.height);
    this.maxHealth = MOVEMENT.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.yaw = 0;

    this.weapon = new WeaponState(weaponName);
    this.skill = skill;                 // 1 が標準。上げるほど強い
    this.reactAt = 0;                   // 敵を見つけてから撃ち始めるまで
    this.target = null;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeUntil = 0;
    this.jumpCooldown = 0;
    this.stuckTimer = 0;
    this.lastPos = { x: 0, z: 0 };

    this.mesh = createCharacter(TEAM_HEX[team], true);
    scene.add(this.mesh);
  }

  get eye() {
    return { x: this.body.pos.x, y: this.body.pos.y + MOVEMENT.eyeHeight, z: this.body.pos.z };
  }

  get forward() {
    return { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) };
  }

  respawn(p) {
    this.body.pos.x = p.x; this.body.pos.y = p.y; this.body.pos.z = p.z;
    this.body.vel.x = this.body.vel.y = this.body.vel.z = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.weapon.refill();
    this.target = null;
    this.mesh.visible = true;
  }

  damage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths += 1;
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  /**
   * @param ctx { dt, now, fighters, onShoot(bot, origin, dir), onMelee(bot) }
   */
  update(ctx) {
    const { dt, now, fighters } = ctx;
    if (!this.alive) return;

    this.weapon.tick(now);
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;

    // --- 相手をさがす ---
    const eye = this.eye;
    let best = null, bestDist = Infinity;
    for (const f of fighters) {
      if (f === this || !f.alive || f.team === this.team) continue;
      const p = f.body.pos;
      const d = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (d > this.weapon.def.range) continue;
      const targetEye = { x: p.x, y: p.y + 4.0, z: p.z };
      if (!hasLineOfSight(this.world, eye, targetEye)) continue;
      if (d < bestDist) { bestDist = d; best = f; }
    }

    if (best && best !== this.target) {
      // 見つけた瞬間はすぐ撃たない。人間らしい反応の遅れ。
      this.reactAt = now + (0.34 / this.skill) * (0.6 + Math.random() * 0.8);
    }
    this.target = best;

    let moveX = 0, moveZ = 0;

    if (best) {
      const p = best.body.pos;
      const dx = p.x - this.body.pos.x, dz = p.z - this.body.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz);

      // 近すぎず遠すぎない距離を保つ
      const want = this.weapon.melee ? 0 : Math.min(60, this.weapon.def.range * 0.35);
      const towards = dist > want + 8 ? 1 : (dist < want - 8 ? -1 : 0);
      moveX += (dx / dist) * towards;
      moveZ += (dz / dist) * towards;

      // 横に動きつづける
      if (now > this.strafeUntil) {
        this.strafe = Math.random() < 0.5 ? 1 : -1;
        this.strafeUntil = now + 0.6 + Math.random() * 1.1;
      }
      moveX += (-dz / dist) * this.strafe * 0.9;
      moveZ += (dx / dist) * this.strafe * 0.9;

      // --- 撃つ ---
      if (now >= this.reactAt) {
        if (this.weapon.melee) {
          if (dist <= this.weapon.def.range && this.weapon.canFire(now)) {
            this.weapon.consume(now);
            ctx.onMelee(this);
          }
        } else if (this.weapon.ammo <= 0) {
          this.weapon.startReload(now);
        } else if (this.weapon.canFire(now)) {
          this.weapon.consume(now);
          // 狙いをわざと少しずらす。遠いほど大きく外す。
          const err = (0.026 / this.skill) * (1 + dist / 140);
          const aim = {
            x: p.x + (Math.random() - 0.5) * dist * err * 2,
            y: p.y + 3.4 + (Math.random() - 0.5) * dist * err,
            z: p.z + (Math.random() - 0.5) * dist * err * 2,
          };
          const ax = aim.x - eye.x, ay = aim.y - eye.y, az = aim.z - eye.z;
          const al = Math.hypot(ax, ay, az) || 1;
          ctx.onShoot(this, eye, { x: ax / al, y: ay / al, z: az / al });
        }
      }
    } else {
      // 敵が見えない。相手の陣地のほうへ向かう。
      const goalZ = this.team === 'red' ? 60 : -60;
      const dx = (Math.random() - 0.5) * 20 - this.body.pos.x * 0.35;
      const dz = goalZ - this.body.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      moveX = dx / l; moveZ = dz / l;
      this.yaw = Math.atan2(-moveX, -moveZ);
      if (this.weapon.ammo < this.weapon.def.mag * 0.4) this.weapon.startReload(now);
    }

    // --- 動かす ---
    const len = Math.hypot(moveX, moveZ);
    const speed = best ? MOVEMENT.walkSpeed : MOVEMENT.sprintSpeed;
    if (len > 0.01) {
      this.body.vel.x = (moveX / len) * speed;
      this.body.vel.z = (moveZ / len) * speed;
    } else {
      this.body.vel.x = this.body.vel.z = 0;
    }

    // 壁に引っかかったらジャンプしてみる
    const moved = Math.hypot(this.body.pos.x - this.lastPos.x, this.body.pos.z - this.lastPos.z);
    this.lastPos.x = this.body.pos.x; this.lastPos.z = this.body.pos.z;
    if (moved < 0.05 * speed * dt * 10 && len > 0.01) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.35 && this.jumpCooldown <= 0 && (this.body.onGround || this.body.groundCheck())) {
        this.body.vel.y = MOVEMENT.jumpVelocity;
        this.jumpCooldown = 0.8;
        this.stuckTimer = 0;
        this.strafe *= -1;
      }
    } else {
      this.stuckTimer = 0;
    }

    this.body.vel.y -= MOVEMENT.gravity * dt;
    if (this.body.vel.y < -MOVEMENT.terminalVelocity) this.body.vel.y = -MOVEMENT.terminalVelocity;
    this.body.step(dt);

    // 穴に落ちたら戻す（元のゲームでもよくあった事故なので）
    if (this.body.pos.y < -30) this.alive = false;

    // --- 見た目 ---
    this.mesh.position.set(this.body.pos.x, this.body.pos.y, this.body.pos.z);
    this.mesh.rotation.y = this.yaw;
    const walking = Math.hypot(this.body.vel.x, this.body.vel.z) > 1;
    const t = walking ? now * 9 : 0;
    const sw = Math.sin(t) * 0.5;
    if (this.mesh.userData.legL) {
      this.mesh.userData.legL.rotation.x = sw;
      this.mesh.userData.legR.rotation.x = -sw;
      this.mesh.userData.armL.rotation.x = -sw * 0.6;
      this.mesh.userData.armR.rotation.x = sw * 0.6;
    }
  }
}
