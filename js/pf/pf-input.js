/* pf-input.js — player input for PFLab: keyboard + touch buttons, unified
   into per-step intent objects for the character controller.
   Keyboard: A/D or arrows move, W/Up jump, J attack, K dash.
   Movement is level-triggered (held); jump/attack/dash are edge-triggered
   and consumed by snapshot() exactly once. All listeners registered through
   attach()/bindButton() are removed again by detach() — entering and
   leaving PFLab never leaks handlers. */

const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump',
  KeyJ: 'attack',
  KeyK: 'dash',
};

export class PFInput {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false };
    this.pressed = { jump: false, attack: false, dash: false };
    this._unbinds = [];
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    const down = (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault(); // keep the page from scrolling while playing
      if (k === 'left' || k === 'right') this.keys.add(k);
      else if (!e.repeat) this.pressed[k] = true;
    };
    const up = (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      if (k === 'left' || k === 'right') this.keys.delete(k);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this._unbinds.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    });
  }

  /** Bind one touch button. name: 'left'|'right' (hold) or an action (tap). */
  bindButton(el, name) {
    if (!el) return;
    const isDir = name === 'left' || name === 'right';
    const on = (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* older engines */ }
      el.classList.add('on');
      if (isDir) this.touch[name] = true;
      else this.pressed[name] = true;
    };
    const off = () => {
      el.classList.remove('on');
      if (isDir) this.touch[name] = false;
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    this._unbinds.push(() => {
      el.removeEventListener('pointerdown', on);
      el.removeEventListener('pointerup', off);
      el.removeEventListener('pointercancel', off);
      el.removeEventListener('lostpointercapture', off);
    });
  }

  detach() {
    for (const u of this._unbinds.splice(0)) u();
    this._attached = false;
    this.keys.clear();
    this.touch.left = this.touch.right = false;
    this.pressed.jump = this.pressed.attack = this.pressed.dash = false;
  }

  /** Consume the current intent for one fixed step. */
  snapshot() {
    const left = this.keys.has('left') || this.touch.left;
    const right = this.keys.has('right') || this.touch.right;
    const out = {
      move: (right ? 1 : 0) - (left ? 1 : 0),
      jump: this.pressed.jump,
      attack: this.pressed.attack,
      dash: this.pressed.dash,
    };
    this.pressed.jump = this.pressed.attack = this.pressed.dash = false;
    return out;
  }
}
