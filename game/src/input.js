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
    this.touch = false;
    this.vDown = new Set();    // 画面ボタンで押しっぱなしにしているもの
    this.vHit = new Set();     // 画面ボタンで、いま押された瞬間のもの
    this.stick = { id: null, dx: 0, dy: 0 };
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

  down(code) { return this.keys.has(code) || this.vDown.has(code); }
  hit(code) { return this.pressed.has(code) || this.vHit.has(code); }

  // ============================================================
  //  タッチ操作（学校のタブレットなど、マウスが無いとき）
  //
  //   画面の左半分 … 指を置くとスティックが出て、動かすと歩く
  //   画面の右半分 … なぞると視点が回る
  //   ボタン       … 撃つ・ジャンプ・しゃがみ など
  // ============================================================
  enableTouch(stickEl, knobEl) {
    this.touch = true;
    this.vDown = this.vDown || new Set();
    this.vHit = this.vHit || new Set();
    this.stick = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
    this.lookId = null;
    this.lookX = 0; this.lookY = 0;
    this.stickEl = stickEl;
    this.knobEl = knobEl;
    const R = 58;   // スティックの動く半径（px）

    const showStick = (on, x, y) => {
      if (!stickEl) return;
      stickEl.style.display = on ? 'block' : 'none';
      if (on) { stickEl.style.left = x + 'px'; stickEl.style.top = y + 'px'; }
      if (knobEl && !on) knobEl.style.transform = 'translate(-50%,-50%)';
    };

    const onStart = (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.stick.id === null) {
          this.stick.id = t.identifier;
          this.stick.cx = t.clientX; this.stick.cy = t.clientY;
          this.stick.dx = this.stick.dy = 0;
          showStick(true, t.clientX, t.clientY);
        } else if (this.lookId === null && t.clientX >= innerWidth * 0.45) {
          this.lookId = t.identifier;
          this.lookX = t.clientX; this.lookY = t.clientY;
        }
      }
      e.preventDefault();
    };

    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.cx;
          let dy = t.clientY - this.stick.cy;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx = dx / len * R; dy = dy / len * R; }
          this.stick.dx = dx / R; this.stick.dy = dy / R;
          if (knobEl) knobEl.style.transform =
            'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
        } else if (t.identifier === this.lookId) {
          // マウスを動かしたのと同じ扱いにする
          this.mouse.dx += (t.clientX - this.lookX) * 2.1;
          this.mouse.dy += (t.clientY - this.lookY) * 2.1;
          this.lookX = t.clientX; this.lookY = t.clientY;
        }
      }
      e.preventDefault();
    };

    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.id = null; this.stick.dx = this.stick.dy = 0;
          showStick(false);
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };

    const c = this.canvas;
    c.addEventListener('touchstart', onStart, { passive: false });
    c.addEventListener('touchmove', onMove, { passive: false });
    addEventListener('touchend', onEnd);
    addEventListener('touchcancel', onEnd);
  }

  /**
   * 画面のボタンを登録する。
   * code に 'FIRE' / 'AIM' を渡すと、左クリック / 右クリックの扱いになります。
   */
  bindButton(el, code, hold = true) {
    if (!el) return;
    const press = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (code === 'FIRE') { this.mouse.left = true; this.mouse.leftEdge = true; }
      else if (code === 'AIM') { this.mouse.right = !this.mouse.right; el.classList.toggle('on', this.mouse.right); }
      else {
        this.vHit.add(code);
        if (hold) this.vDown.add(code);
      }
      el.classList.add('press');
    };
    const release = (e) => {
      if (e) e.preventDefault();
      if (code === 'FIRE') this.mouse.left = false;
      else if (code !== 'AIM') this.vDown.delete(code);
      el.classList.remove('press');
    };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release);
    el.addEventListener('touchcancel', release);
    el.addEventListener('mousedown', press);
    addEventListener('mouseup', release);
  }

  /** 毎フレームの最後に呼ぶ。「押された瞬間」を消す。 */
  endFrame() {
    this.vHit.clear();
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.leftEdge = false;
    this.mouse.rightEdge = false;
    this.wheel = 0;
  }

  /** WASD を、正規化した前後左右に直す */
  moveAxis() {
    // 指のスティックが出ているときは、そちらを使う
    if (this.touch && this.stick.id !== null) {
      return { f: -this.stick.dy, r: this.stick.dx };
    }
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
