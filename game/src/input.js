// キーボードとマウス。
// 画面をクリックするとマウスが固定されて、視点を回せるようになります。

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // このフレームで押された瞬間だけ true
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftEdge: false, rightEdge: false };
    this.wheel = 0;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      // ブラウザの既定動作（スクロールや検索）を止める
      if (['Space', 'Tab', 'KeyR', 'ShiftLeft', 'ControlLeft'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { canvas.requestPointerLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftEdge = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightEdge = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });

    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** 毎フレームの最後に呼ぶ。「押された瞬間」を消す。 */
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.leftEdge = false;
    this.mouse.rightEdge = false;
    this.wheel = 0;
  }

  /** WASD を、正規化した前後左右に直す */
  moveAxis() {
    let f = 0, r = 0;
    if (this.down('KeyW')) f += 1;
    if (this.down('KeyS')) f -= 1;
    if (this.down('KeyD')) r += 1;
    if (this.down('KeyA')) r -= 1;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    return { f, r };
  }
}
