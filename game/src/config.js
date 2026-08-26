// 元の GunConfig.lua から、数値をそのまま持ってきたもの。
// ここをいじればバランスを変えられます（元のゲームと同じ考え方）。

export const SPREAD_SCALE = 0.35;   // ばらつきの全体倍率
export const BASE_FOV = 80;

export const MOVEMENT = {
  walkSpeed: 19,
  sprintSpeed: 26,
  aimWalkSpeed: 11,
  slideSpeed: 54,
  slideDuration: 1.2,
  slideCooldown: 0.85,
  slideMinSpeed: 13,       // これより遅いと滑り出せない（元の SlideMinSpeed）
  slideJumpBoost: 1.0,
  slideEyeDrop: -1.7,      // スライディング中は視点が下がる
  gravity: 110,
  jumpVelocity: 50,
  terminalVelocity: 250,

  // 体の大きさ（スタッド）。R15 に合わせています
  radius: 1.6,
  height: 5.7,
  eyeHeight: 4.9,

  maxHealth: 200,
  regenDelay: 5.0,
  regenRate: 22,
};

// 当たり判定。足元からの高さで持つ。
// 体の上端と頭の下端がぴったり合っていないと、頭に当たらなくなります。
export const HITBOX = {
  body: { w: 7.0, h: 4.6, d: 4.2, bottom: -0.5 },  // -0.5 〜 4.1
  head: { w: 3.0, h: 2.2, d: 3.0, bottom: 4.1 },   //  4.1 〜 6.3
};

/**
 * ボットの強さ。ここだけいじれば調整できます。
 * skill を上げるほど強くなります（1.0 が元の強さ）。
 */
export const BOTS = {
  skill: 0.8,             // 下の skillStart / skillEnd を使うので、いまは予備

  /**
   * 点が入るごとに、だんだん強くなります。
   *   0 点  … skillStart（かなり弱い。まず勝てる）
   *   4 点  … skillEnd  （本気。あと1点が遠い）
   * 数字を上げるほど強くなります。
   */
  skillStart: 0.32,
  skillEnd: 1.25,

  reactionBase: 0.55,      // 見つけてから撃ち始めるまで（秒）。大きいほど弱い
  reactionJitterMin: 0.7,  // その何倍か（下限）
  reactionJitterMax: 1.7,  // その何倍か（上限）

  aimError: 0.048,         // 狙いのズレ。大きいほど当たらない
  aimErrorRange: 90,       // 何スタッドごとにズレが倍になるか。小さいほど遠距離が下手

  burstMin: 3,             // 何発か撃ったら、いったん指を離す
  burstMax: 7,
  burstPauseMin: 0.30,     // その休みの長さ（秒）
  burstPauseMax: 0.85,

  maxEngageRange: 200,     // これより遠い相手は狙わない（武器の射程より優先）
  loseTargetTime: 0.6,     // 見失ってから狙いをやめるまで
};

export const MATCH = {
  scoreToWin: 5,
  countdownTime: 3,
  roundResetTime: 2,
  matchOverTime: 6,
};

export const COLORS = {
  accent:      '#ffd66e',
  danger:      '#ff6060',
  healthHigh:  '#5ae182',
  healthLow:   '#e14646',
  slideCyan:   '#78dcff',
  slideCharge: '#5a6e82',
  trackDark:   '#16171b',
  tracer:      0xffe082,
  muzzle:      0xffcd78,
  impact:      0xfff0c8,
  hitSpark:    0xfff5dc,
  red:         '#ff4e60',
  blue:        '#46a0ff',
};

/**
 * 武器。
 *   rate       … 1秒あたりの発射数
 *   spread     … 静止時のばらつき（度）。実際は SPREAD_SCALE を掛ける
 *   moveSpread … 動いているときに足されるばらつき（度）
 *   recoil     … 1発ごとに上を向く量
 */
export const WEAPONS = {
  AR: {
    name: 'AR', display: 'アサルトライフル', slot: 1,
    damage: 21, headMult: 1.9, rate: 10, mag: 30, reserve: 180, reload: 2.0,
    spread: 0.9, moveSpread: 1.5, range: 420, auto: true, pellets: 1,
    recoil: 0.5, adsFov: 58, body: 0x30343c, accent: 0xff962d, length: 3.4,
    // 一人称で画面に出るときの大きさ。実寸モデルは小さく見えるので少し大きく。
    viewScale: 1.30,
  },
  SMG: {
    name: 'SMG', display: 'サブマシンガン', slot: 1,
    damage: 17, headMult: 1.6, rate: 14.5, mag: 32, reserve: 224, reload: 1.6,
    spread: 1.6, moveSpread: 1.1, range: 220, auto: true, pellets: 1,
    recoil: 0.38, adsFov: 66, body: 0x282c34, accent: 0x5adcff, length: 2.6,
  },
  Shotgun: {
    name: 'Shotgun', display: 'ショットガン', slot: 1,
    damage: 12, headMult: 1.35, rate: 1.5, mag: 6, reserve: 48, reload: 2.8,
    spread: 5.2, moveSpread: 0.9, range: 140, auto: false, pellets: 9,
    recoil: 2.4, adsFov: 68, body: 0x563426, accent: 0xf0c35a, length: 3.6,
  },
  Sniper: {
    name: 'Sniper', display: 'スナイパーライフル', slot: 1,
    damage: 85, headMult: 2.4, rate: 0.85, mag: 5, reserve: 30, reload: 3.1,
    spread: 0.05, moveSpread: 3.5, range: 900, auto: false, pellets: 1,
    recoil: 3.4, adsFov: 20, scope: true, body: 0x262a30, accent: 0x96eba0, length: 4.7,
    headBox: { w: 4.5, h: 2.6, d: 4.5 },   // 胴に当たっても頭の近くなら頭扱い
    viewScale: 0.95,        // もともと長いので、少しだけ小さく
  },
  Marksman: {
    name: 'Marksman', display: 'マークスマンライフル', slot: 1,
    damage: 40, headMult: 2.2, rate: 3.8, mag: 12, reserve: 84, reload: 2.3,
    spread: 0.35, moveSpread: 2.6, range: 700, auto: false, pellets: 1,
    recoil: 1.7, adsFov: 40, body: 0x342e2a, accent: 0xffd278, length: 4.0,
  },
  LMG: {
    name: 'LMG', display: '軽機関銃', slot: 1,
    damage: 22, headMult: 1.7, rate: 8.5, mag: 75, reserve: 225, reload: 4.2,
    spread: 1.5, moveSpread: 2.4, range: 450, auto: true, pellets: 1,
    recoil: 0.8, adsFov: 62, body: 0x2c302c, accent: 0xb4ff78, length: 4.2,
  },

  Pistol: {
    name: 'Pistol', display: 'ピストル', slot: 2,
    damage: 28, headMult: 2.0, rate: 6.5, mag: 15, reserve: 120, reload: 1.2,
    spread: 0.8, moveSpread: 1.3, range: 260, auto: false, pellets: 1,
    recoil: 0.9, adsFov: 62, body: 0x2c2e36, accent: 0xd2d7e1, length: 1.8,
    viewScale: 2.10,        // 拳銃は実寸だと小さすぎるので大きめに
  },
  Revolver: {
    name: 'Revolver', display: 'リボルバー', slot: 2,
    damage: 56, headMult: 2.0, rate: 2.2, mag: 6, reserve: 42, reload: 2.4,
    spread: 0.6, moveSpread: 2.2, range: 400, auto: false, pellets: 1,
    recoil: 2.6, adsFov: 55, body: 0x463c34, accent: 0xf5e1a0, length: 2.2,
  },
  MachinePistol: {
    name: 'MachinePistol', display: 'マシンピストル', slot: 2,
    damage: 14, headMult: 1.5, rate: 16, mag: 24, reserve: 168, reload: 1.4,
    spread: 2.2, moveSpread: 1.0, range: 160, auto: true, pellets: 1,
    recoil: 0.45, adsFov: 68, body: 0x282a32, accent: 0xc878ff, length: 1.9,
  },

  Knife: {
    name: 'Knife', display: 'ナイフ', slot: 3, melee: true,
    damage: 58, backstab: 125, rate: 2.0, range: 11, swingTime: 0.16,
    body: 0x26282e, accent: 0xe1ebf5, length: 1.6,
  },
  Katana: {
    name: 'Katana', display: '刀', slot: 3, melee: true,
    damage: 72, backstab: 140, rate: 1.5, range: 14, swingTime: 0.2,
    ability: 'Reflect', reflectDuration: 2.0, reflectCooldown: 3.2, reflectMult: 2.2,
    body: 0x181a20, accent: 0xe1ebf5, length: 3.4,
  },
  Scythe: {
    name: 'Scythe', display: '鎌', slot: 3, melee: true,
    damage: 66, backstab: 132, rate: 1.6, range: 13, swingTime: 0.22,
    ability: 'Dash', dashSpeed: 96, dashDuration: 0.26, dashCooldown: 3.6,
    body: 0x2e221c, accent: 0xc8dceb, length: 3.8,
  },
};

export const GRENADES = {
  Frag: {
    display: 'グレネード', key: 'KeyG', color: 0x5acd6e,
    maxDamage: 118, minDamage: 16, radius: 26, fuse: 2.4,
    charges: 2, cooldown: 1.0, throwSpeed: 82, selfScale: 0.55,
  },
  Flash: {
    display: 'フラッシュ', key: 'KeyF', color: 0xf0f0fa,
    radius: 38, duration: 5.0, fuse: 1.7,
    charges: 1, cooldown: 1.0, throwSpeed: 88,
  },
};

export const LOADOUT_CHOICES = {
  primary:   ['AR', 'SMG', 'Shotgun', 'Sniper', 'Marksman', 'LMG'],
  secondary: ['Pistol', 'Revolver', 'MachinePistol'],
  melee:     ['Knife', 'Katana', 'Scythe'],
};

/** 名前のリストからボットの名前を作る */
export const BOT_NAMES = [
  'BOT-01', 'BOT-02', 'BOT-03', 'BOT-04', 'BOT-05',
  'BOT-06', 'BOT-07', 'BOT-08', 'BOT-09',
];
