// 自分の操作。
//
// 動きは元の Gun Arena に合わせています。
//   ・歩く / 走る / 構えながら歩く で速さが変わる
//   ・スライディングは地面で始まり、崖から出ても続き、着地でキャンセル
//   ・空中は「入力した向きにだけ進む」。何も押していなければ止まる
//     （元のゲームで「押してない＝進まない」に直したときと同じ考え方）

import { Body } from './physics.js';

export const State = { GROUND: 'ground', SLIDE: 'slide', AIR: 'air' };

export class Player {
  constructor(world, cfg) {
    this.cfg = cfg;
    this.body = new Body(world, cfg.radius, cfg.height);
    this.yaw = 0;
    this.pitch = 0;
    this.state = State.GROUND;

    this.health = cfg.maxHealth;
    this.maxHealth = cfg.maxHealth;
    this.alive = true;
    this.team = 'red';

    this.slideTime = 0;
    this.slideDir = { x: 0, z: 0 };
    this.slideAirborne = false;
    this.slideCooldown = 0;
    this.airSpeed = 0;          // 空中で保つ速さ
    this.lastDamageAt = -999;
    this.bob = 0;               // 歩いたときの視点のゆれ
    this.recoil = 0;            // 反動で上を向く量
    this.recoilVel = 0;
  }

  get eye() {
    return {
      x: this.body.pos.x,
      y: this.body.pos.y + this.cfg.eyeHeight + (this.state === State.SLIDE ? this.cfg.slideEyeDrop : 0),
      z: this.body.pos.z,
    };
  }

  /** 視線の向き（正規化ずみ） */
  get forward() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: sp, z: -Math.cos(this.yaw) * cp };
  }

  /** 水平の前向き（移動に使う） */
  get flatForward() {
    return { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) };
  }
  get flatRight() {
    return { x: Math.cos(this.yaw), y: 0, z: -Math.sin(this.yaw) };
  }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  addRecoil(amount) {
    this.recoilVel += amount;
  }

  /**
   * @param dt      経過秒
   * @param input   { f, r, jump, sprint, slide, aiming }
   */
  update(dt, input) {
    const c = this.cfg;
    const b = this.body;

    // --- 反動はバネのように戻る ---
    this.recoilVel *= Math.pow(0.02, dt);
    this.recoil += this.recoilVel * dt;
    this.recoil *= Math.pow(0.001, dt);
    this.pitch += this.recoilVel * dt;

    if (!this.alive) {
      b.vel.x = b.vel.z = 0;
      b.vel.y -= c.gravity * dt;
      b.step(dt);
      return;
    }

    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    const grounded = b.onGround || b.groundCheck();

    // --- スライディングを始める ---
    const wantSlide = input.slide && input.sprint;
    if (wantSlide && grounded && this.state !== State.SLIDE && this.slideCooldown <= 0) {
      const f = this.flatForward;
      const r = this.flatRight;
      let dx = f.x * input.f + r.x * input.r;
      let dz = f.z * input.f + r.z * input.r;
      if (Math.hypot(dx, dz) < 0.1) { dx = f.x; dz = f.z; }
      const len = Math.hypot(dx, dz) || 1;
      this.slideDir = { x: dx / len, z: dz / len };
      this.state = State.SLIDE;
      this.slideTime = c.slideDuration;
      this.slideAirborne = false;
    }

    if (this.state === State.SLIDE) {
      this._slide(dt, input, grounded);
    } else if (grounded) {
      this._walk(dt, input);
    } else {
      this._air(dt, input);
    }

    // --- 重力 ---
    b.vel.y -= c.gravity * dt;
    if (b.vel.y < -c.terminalVelocity) b.vel.y = -c.terminalVelocity;

    b.step(dt);

    // --- 体力の自然回復 ---
    const now = performance.now() / 1000;
    if (this.health < this.maxHealth && now - this.lastDamageAt > c.regenDelay) {
      this.health = Math.min(this.maxHealth, this.health + c.regenRate * dt);
    }
  }

  _walk(dt, input) {
    const c = this.cfg;
    const b = this.body;
    this.state = State.GROUND;
    this.airSpeed = 0;

    let speed = c.walkSpeed;
    if (input.aiming) speed = c.aimWalkSpeed;
    else if (input.sprint && input.f > 0.1) speed = c.sprintSpeed;

    const f = this.flatForward, r = this.flatRight;
    const wx = f.x * input.f + r.x * input.r;
    const wz = f.z * input.f + r.z * input.r;
    const len = Math.hypot(wx, wz);

    if (len > 0.001) {
      b.vel.x = (wx / len) * speed;
      b.vel.z = (wz / len) * speed;
      this.bob += dt * speed * 0.5;
    } else {
      b.vel.x = 0;
      b.vel.z = 0;
    }

    if (input.jump) {
      b.vel.y = c.jumpVelocity;
      b.onGround = false;
      this.state = State.AIR;
      this.airSpeed = Math.hypot(b.vel.x, b.vel.z);
    }
  }

  _slide(dt, input, grounded) {
    const c = this.cfg;
    const b = this.body;

    this.slideTime -= dt;

    // 崖から出ても続ける。着地したらキャンセル。
    if (!grounded) {
      this.slideAirborne = true;
    } else if (this.slideAirborne) {
      this._endSlide();
      return;
    }

    if (this.slideTime <= 0 && grounded) {
      this._endSlide();
      return;
    }

    // だんだん遅くなる
    const t = Math.max(0, this.slideTime / c.slideDuration);
    const speed = c.walkSpeed + (c.slideSpeed - c.walkSpeed) * t;
    b.vel.x = this.slideDir.x * speed;
    b.vel.z = this.slideDir.z * speed;

    // スライディング中のジャンプ。向いている方向へ飛ぶ
    if (input.jump && (grounded || !this.slideAirborne)) {
      const f = this.flatForward, r = this.flatRight;
      let dx = f.x * input.f + r.x * input.r;
      let dz = f.z * input.f + r.z * input.r;
      if (Math.hypot(dx, dz) < 0.1) { dx = this.slideDir.x; dz = this.slideDir.z; }
      const len = Math.hypot(dx, dz) || 1;
      b.vel.y = c.jumpVelocity;
      this.airSpeed = speed * c.slideJumpBoost;
      b.vel.x = (dx / len) * this.airSpeed;
      b.vel.z = (dz / len) * this.airSpeed;
      this._endSlide();
      this.state = State.AIR;
    }
  }

  _endSlide() {
    this.state = State.GROUND;
    this.slideAirborne = false;
    this.slideTime = 0;
    this.slideCooldown = this.cfg.slideCooldown;
  }

  /**
   * 空中。
   * 入力した向きにだけ進み、押していなければ止まる。
   * 速さは着地するまで保たれる。
   */
  _air(dt, input) {
    const c = this.cfg;
    const b = this.body;
    this.state = State.AIR;

    if (this.airSpeed <= 0) this.airSpeed = Math.hypot(b.vel.x, b.vel.z);

    const f = this.flatForward, r = this.flatRight;
    const wx = f.x * input.f + r.x * input.r;
    const wz = f.z * input.f + r.z * input.r;
    const len = Math.hypot(wx, wz);

    if (len > 0.001) {
      b.vel.x = (wx / len) * this.airSpeed;
      b.vel.z = (wz / len) * this.airSpeed;
    } else {
      b.vel.x = 0;
      b.vel.z = 0;
    }
  }

  damage(amount, from) {
    if (!this.alive) return false;
    this.health -= amount;
    this.lastDamageAt = performance.now() / 1000;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true; // 倒れた
    }
    return false;
  }

  respawn(x, y, z) {
    this.body.pos.x = x; this.body.pos.y = y; this.body.pos.z = z;
    this.body.vel.x = this.body.vel.y = this.body.vel.z = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.state = State.GROUND;
    this.airSpeed = 0;
    this.slideTime = 0;
    this.slideAirborne = false;
  }
}
