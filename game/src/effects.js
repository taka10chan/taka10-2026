// エフェクト（視覚効果）レイヤー。
//
// ショットガンは1発の発射で9粒同時にトレーサーと着弾を出すので、
// 秒間 16 発 x 9 粒 = 最大 144 個/秒 のエフェクトが飛ぶ。毎回 new でジオメトリや
// マテリアルを作ると GC が唸ってフレームが飛ぶので、メッシュ・マテリアルは
// コンストラクタで人数分（プール数）だけ先に作っておき、使い回す。
//
// プールは「リングバッファ」方式にしている。固定長配列 + 次に使うインデックスを
// 進めるだけで、空き管理用の配列を別途持たなくて済む。プールが尽きたときは
// 単純にインデックスが一周してくるので、自動的に一番古い（=最初に確保された）
// 枠が再利用される。これが仕様で言う「pool exhausted 時は最古を再利用」にあたる。
// 生きているものだけを毎フレーム舐めるのではなく、固定長ぶんを毎回舐めているが、
// プールの数自体を小さく抑えているので実質 O(1) に近い。

import * as THREE from '../lib/three.module.js';
import { COLORS } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

// 使い回す一時オブジェクト（update() 内で new しないため）
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---- プールのサイズ ----
    this.MUZZLE_COUNT = 16;      // 発射のたびに1個。0.07秒しか生きないので少なくて十分
    this.TRACER_COUNT = 120;     // 仕様どおり
    this.IMPACT_COUNT = 60;      // 仕様どおり（壁着弾）
    this.HITSPARK_COUNT = 60;    // 人に当たったとき用（impact と同数）
    this.LIGHT_COUNT = 8;        // 仕様どおり。マズルフラッシュと爆発の光で共有する
    this.EXPLOSION_COUNT = 8;    // 同時爆発数。ライトの数と揃えておく
    this.SHARD_COUNT = this.EXPLOSION_COUNT * 10; // 爆発1回につき破片10枚
    this.MELEE_COUNT = 8;        // 近接攻撃は頻度が低いので少なめ

    this._buildMuzzlePool();
    this._buildTracerPool();
    this._buildImpactPool(); // impact と hitSpark 共通のジオメトリ・寸法を使う
    this._buildLightPool();
    this._buildExplosionPool();
    this._buildMeleePool();
  }

  // ================= マズルフラッシュ =================
  _buildMuzzlePool() {
    const geo = new THREE.SphereGeometry(0.6, 8, 6);
    const baseMat = new THREE.MeshBasicMaterial({
      color: COLORS.muzzle,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.muzzleSlots = [];
    for (let i = 0; i < this.MUZZLE_COUNT; i++) {
      const mesh = new THREE.Mesh(geo, baseMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.muzzleSlots.push({ mesh, life: 0, maxLife: 0.07, lightIndex: -1 });
    }
    this.muzzleNext = 0;
  }

  muzzleFlash(pos) {
    const slot = this.muzzleSlots[this.muzzleNext];
    this.muzzleNext = (this.muzzleNext + 1) % this.MUZZLE_COUNT;

    slot.life = slot.maxLife;
    slot.mesh.visible = true;
    slot.mesh.position.set(pos.x, pos.y, pos.z);
    slot.mesh.material.opacity = 1;
    slot.mesh.scale.setScalar(1);

    // 専用の光を1個借りる（フェードなし。寿命が尽きたらすぐ消える）
    slot.lightIndex = this._allocLight(pos, 0xffc878, 6, 14, slot.maxLife, false);
  }

  // ================= トレーサー =================
  _buildTracerPool() {
    // Y 軸方向に長さ1の細い円柱を作っておき、飛翔方向へ向けて回転・伸縮させる
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
    geo.translate(0, 0.5, 0); // 原点が「尾側」になるようにしておくと位置合わせがしやすい
    const baseMat = new THREE.MeshBasicMaterial({
      color: COLORS.tracer,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tracerSlots = [];
    for (let i = 0; i < this.TRACER_COUNT; i++) {
      const mesh = new THREE.Mesh(geo, baseMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracerSlots.push({
        mesh,
        life: 0,
        maxLife: 0,
        from: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        dist: 0,
        streakLen: 3, // 見た目上の筋の長さ（スタッド）。距離が短い時は自動で縮める
      });
    }
    this.tracerNext = 0;
  }

  tracer(from, to) {
    const slot = this.tracerSlots[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % this.TRACER_COUNT;

    _v1.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const dist = _v1.length();
    if (dist < 1e-4) return; // 実質同じ点なら描かなくてよい

    slot.dist = dist;
    slot.from.set(from.x, from.y, from.z);
    slot.dir.copy(_v1).multiplyScalar(1 / dist);
    slot.streakLen = Math.min(3, dist);

    // 仕様: distance / 1000 を 0.02〜0.4秒 にクランプ
    slot.maxLife = Math.min(0.4, Math.max(0.02, dist / 1000));
    slot.life = slot.maxLife;

    slot.mesh.visible = true;
    slot.mesh.material.opacity = 1;
    // 向きを飛翔方向に合わせる（円柱のデフォルトは +Y なので、そこから回転させる）
    _q1.setFromUnitVectors(UP, slot.dir);
    slot.mesh.quaternion.copy(_q1);
    slot.mesh.scale.set(1, slot.streakLen, 1);
    slot.mesh.position.copy(slot.from);
  }

  // ================= 着弾（壁）/ ヒットスパーク（人） =================
  // 見た目はどちらも「面の法線に揃えた立方体が縮みながらフェードする」だけで、
  // 色だけが違う。ジオメトリと更新ロジックを共通化する。
  _buildImpactPool() {
    const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);

    const impactMat = new THREE.MeshBasicMaterial({
      color: COLORS.impact,
      transparent: true,
      depthWrite: false,
    });
    this.impactSlots = this._makeSparkSlots(geo, impactMat, this.IMPACT_COUNT);
    this.impactNext = 0;

    const hitMat = new THREE.MeshBasicMaterial({
      color: COLORS.hitSpark,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // 被弾ヒットは少し光らせて視認性を上げる
    });
    this.hitSparkSlots = this._makeSparkSlots(geo, hitMat, this.HITSPARK_COUNT);
    this.hitSparkNext = 0;
  }

  _makeSparkSlots(geo, baseMat, count) {
    const slots = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, baseMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      slots.push({ mesh, life: 0, maxLife: 0.18 });
    }
    return slots;
  }

  _spawnSpark(slots, nextRef, key, pos, normal) {
    const slot = slots[this[nextRef]];
    this[nextRef] = (this[nextRef] + 1) % slots.length;

    slot.life = slot.maxLife;
    slot.mesh.visible = true;
    slot.mesh.material.opacity = 1;
    slot.mesh.scale.setScalar(1);
    slot.mesh.position.set(pos.x, pos.y, pos.z);

    if (normal) {
      _v1.set(normal.x, normal.y, normal.z);
      if (_v1.lengthSq() > 1e-6) {
        _v1.normalize();
        _q1.setFromUnitVectors(UP, _v1);
        slot.mesh.quaternion.copy(_q1);
      } else {
        slot.mesh.quaternion.identity();
      }
    } else {
      slot.mesh.quaternion.identity();
    }
  }

  impact(pos, normal) {
    this._spawnSpark(this.impactSlots, 'impactNext', 'impact', pos, normal);
  }

  hitSpark(pos) {
    this._spawnSpark(this.hitSparkSlots, 'hitSparkNext', 'hitSpark', pos, null);
  }

  // ================= 共有ライトプール =================
  // マズルフラッシュと爆発の PointLight を共有で持つ。両方が同時に多発することは
  // 稀なので、8個を共有することで「常時8灯まで」という上限を守りやすい。
  _buildLightPool() {
    this.lightSlots = [];
    for (let i = 0; i < this.LIGHT_COUNT; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1);
      light.visible = false;
      this.scene.add(light);
      this.lightSlots.push({ light, life: 0, maxLife: 0, baseIntensity: 0, fade: false });
    }
    this.lightNext = 0;
  }

  // fade=true なら life に応じて intensity を線形にフェードさせる。
  // fade=false ならマズルフラッシュのように寿命が尽きるまで一定強度。
  _allocLight(pos, color, intensity, distance, life, fade) {
    const idx = this.lightNext;
    this.lightNext = (this.lightNext + 1) % this.LIGHT_COUNT;
    const slot = this.lightSlots[idx];
    slot.light.color.setHex(color);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    slot.light.position.set(pos.x, pos.y, pos.z);
    slot.light.visible = true;
    slot.life = life;
    slot.maxLife = life;
    slot.baseIntensity = intensity;
    slot.fade = fade;
    return idx;
  }

  // ================= 爆発 =================
  _buildExplosionPool() {
    const sphereGeo = new THREE.SphereGeometry(1, 12, 8); // 半径1の単位球。scale で広げる
    const sphereMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.explosionSlots = [];
    for (let i = 0; i < this.EXPLOSION_COUNT; i++) {
      const mesh = new THREE.Mesh(sphereGeo, sphereMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.explosionSlots.push({
        mesh,
        life: 0,
        maxLife: 0.35,
        radius: 1,
        lightIndex: -1,
      });
    }
    this.explosionNext = 0;

    // 破片（シャード）。細長い箱を放射状に飛ばして縮ませる
    const shardGeo = new THREE.BoxGeometry(0.15, 0.15, 1.2);
    const shardMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shardSlots = [];
    for (let i = 0; i < this.SHARD_COUNT; i++) {
      const mesh = new THREE.Mesh(shardGeo, shardMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.shardSlots.push({
        mesh,
        life: 0,
        maxLife: 0.4,
        origin: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        speed: 0,
      });
    }
    this.shardNext = 0;
  }

  explosion(pos, colorHex, radius) {
    // 中心の膨張する球
    const eslot = this.explosionSlots[this.explosionNext];
    this.explosionNext = (this.explosionNext + 1) % this.EXPLOSION_COUNT;

    eslot.life = eslot.maxLife;
    eslot.radius = radius;
    eslot.mesh.visible = true;
    eslot.mesh.material.color.setHex(colorHex);
    eslot.mesh.material.opacity = 1;
    eslot.mesh.scale.setScalar(0.001); // 0から始めると法線計算等で潰れることがあるので極小値から
    eslot.mesh.position.set(pos.x, pos.y, pos.z);
    eslot.lightIndex = this._allocLight(pos, colorHex, 14, radius * 6, eslot.maxLife, true);

    // 破片10枚を放射状に飛ばす
    for (let i = 0; i < 10; i++) {
      const sslot = this.shardSlots[this.shardNext];
      this.shardNext = (this.shardNext + 1) % this.SHARD_COUNT;

      // 球面上にほぼ均等っぽく散らす（黄金角スパイラル。厳密な均等分布でなくても見た目上は十分）
      const t = i / 10;
      const phi = Math.acos(1 - 2 * (t + 0.5 / 10));
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      sslot.dir.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );

      sslot.life = sslot.maxLife;
      sslot.origin.set(pos.x, pos.y, pos.z);
      sslot.speed = radius * 10 + 8; // 半径が大きい爆発ほど破片も速く飛ぶ
      sslot.mesh.visible = true;
      sslot.mesh.material.color.setHex(colorHex);
      sslot.mesh.material.opacity = 1;
      sslot.mesh.scale.setScalar(1);
      sslot.mesh.position.copy(sslot.origin);
      _q1.setFromUnitVectors(UP, sslot.dir);
      sslot.mesh.quaternion.copy(_q1);
    }
  }

  // ================= 近接攻撃 =================
  _buildMeleePool() {
    // 薄い刃っぽい形。細長い箱を斜めに立てて「斬撃の残像」に見せる
    const geo = new THREE.BoxGeometry(0.06, 0.5, 2.2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe1f0ff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.meleeSlots = [];
    for (let i = 0; i < this.MELEE_COUNT; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meleeSlots.push({
        mesh,
        life: 0,
        maxLife: 0.14,
        origin: new THREE.Vector3(),
        right: new THREE.Vector3(),
        fwd: new THREE.Vector3(),
        reach: 3.4,
      });
    }
    this.meleeNext = 0;
  }

  meleeSwing(origin, dir) {
    const slot = this.meleeSlots[this.meleeNext];
    this.meleeNext = (this.meleeNext + 1) % this.MELEE_COUNT;

    slot.life = slot.maxLife;
    slot.origin.set(origin.x, origin.y, origin.z);
    slot.fwd.set(dir.x, dir.y, dir.z).normalize();
    // dir に垂直な「横」方向を作る（ワールド上向きとの外積）。dir がほぼ真上/真下の
    // ときは外積が潰れるので、その場合だけ別軸を使う
    if (Math.abs(slot.fwd.y) > 0.99) {
      slot.right.set(1, 0, 0);
    } else {
      slot.right.crossVectors(slot.fwd, UP).normalize();
    }

    slot.mesh.visible = true;
    slot.mesh.material.opacity = 1;
    // 初期姿勢（角度0 = dir 正面）はupdate側の共通処理に任せるため、ここで即座に1回分計算しておく
    this._updateMeleePose(slot, 0);
  }

  _updateMeleePose(slot, t) {
    // -55度 〜 +55度 の範囲を t(0→1) で掃く
    const angle = THREE.MathUtils.degToRad(-55 + 110 * t);
    // origin を中心に、fwd を right 軸方向へ angle だけ傾けた向きへ配置する
    _v1.copy(slot.fwd).multiplyScalar(Math.cos(angle));
    _v2.copy(slot.right).multiplyScalar(Math.sin(angle));
    _v3.addVectors(_v1, _v2); // 現在の刃の向き（正規化済みベクトルの合成なのでほぼ単位長）

    slot.mesh.position.copy(slot.origin).addScaledVector(_v3, slot.reach * 0.5);
    // 箱のローカル+Z（長辺）を _v3 方向へ向ける
    _q1.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v3);
    slot.mesh.quaternion.copy(_q1);
  }

  // ================= 毎フレーム更新 =================
  update(dt) {
    this._updateMuzzle(dt);
    this._updateTracers(dt);
    this._updateSparks(this.impactSlots, dt);
    this._updateSparks(this.hitSparkSlots, dt);
    this._updateLights(dt);
    this._updateExplosions(dt);
    this._updateShards(dt);
    this._updateMelee(dt);
  }

  _updateMuzzle(dt) {
    for (let i = 0; i < this.muzzleSlots.length; i++) {
      const s = this.muzzleSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
      }
    }
  }

  _updateTracers(dt) {
    for (let i = 0; i < this.tracerSlots.length; i++) {
      const s = this.tracerSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife; // 0(発射直後)→1(到達直前)
      // 筋の「先端」が to に着くように、原点(尾)を from から to-streakLen*dir の位置まで進める
      const travel = t * s.dist;
      const headDist = Math.min(travel, s.dist);
      const tailDist = Math.max(0, headDist - s.streakLen);
      s.mesh.position.copy(s.from).addScaledVector(s.dir, tailDist);
      s.mesh.scale.set(1, headDist - tailDist, 1);
      s.mesh.material.opacity = s.life / s.maxLife;
    }
  }

  _updateSparks(slots, dt) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const t = s.life / s.maxLife; // 1→0
      s.mesh.scale.setScalar(t);
      s.mesh.material.opacity = t;
    }
  }

  _updateLights(dt) {
    for (let i = 0; i < this.lightSlots.length; i++) {
      const s = this.lightSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.light.visible = false;
        s.light.intensity = 0;
        continue;
      }
      if (s.fade) {
        s.light.intensity = s.baseIntensity * (s.life / s.maxLife);
      }
    }
  }

  _updateExplosions(dt) {
    for (let i = 0; i < this.explosionSlots.length; i++) {
      const s = this.explosionSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife; // 0→1
      const scale = s.radius * 2 * t; // 半径0 → 2*radius まで膨張
      s.mesh.scale.setScalar(Math.max(scale, 0.001));
      s.mesh.material.opacity = 1 - t;
    }
  }

  _updateShards(dt) {
    for (let i = 0; i < this.shardSlots.length; i++) {
      const s = this.shardSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const elapsed = s.maxLife - s.life;
      s.mesh.position.copy(s.origin).addScaledVector(s.dir, s.speed * elapsed);
      const t = s.life / s.maxLife; // 1→0
      s.mesh.scale.setScalar(t);
      s.mesh.material.opacity = t;
    }
  }

  _updateMelee(dt) {
    for (let i = 0; i < this.meleeSlots.length; i++) {
      const s = this.meleeSlots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife; // 0→1 で弧を掃く
      this._updateMeleePose(s, t);
      s.mesh.material.opacity = s.life / s.maxLife;
    }
  }

  // 互換性のためのダミー。呼び出し側が何も考えず tick() を呼んでも壊れないようにする
  tick() {}
}
