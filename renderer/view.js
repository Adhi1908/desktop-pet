// The DOM for one pet. A wrapper element carries the pet's position, rotation and facing; the
// sprite canvas and the hat sit inside it, so they turn and flip together. The speech bubble,
// name tag and sleep "z"s live in a separate layer and follow the pet's head.

import { drawFrame } from './sprite.js';
import { HATS, renderPixelArt, hatAnchor } from './pixelart.js';

const el = (tag, className) => Object.assign(document.createElement(tag), { className });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class PetView {
  constructor(petLayer, overlayLayer, sheet) {
    this.sheet = sheet;
    this.root = el('div', 'pet');
    this.sprite = el('canvas', 'sprite');
    this.hat = el('canvas', 'hat');
    this.hat.hidden = true;
    this.root.append(this.sprite, this.hat);
    petLayer.append(this.root);
    this.ctx = this.sprite.getContext('2d');

    this.zzz = el('div', 'zzz');
    for (const letter of ['z', 'z', 'Z']) this.zzz.append(Object.assign(el('span', ''), { textContent: letter }));
    this.tag = el('div', 'tag');
    this.bubble = el('div', 'bubble');
    this.sign = el('div', 'sign');
    this.signText = el('p', 'sign-text');
    this.signDone = Object.assign(el('button', ''), { type: 'button', textContent: 'Done ✓' });
    this.signSnooze = Object.assign(el('button', 'secondary'), { type: 'button', textContent: 'Snooze 10 min' });
    const actions = el('div', 'sign-actions');
    actions.append(this.signDone, this.signSnooze);
    this.sign.append(Object.assign(el('small', ''), { textContent: 'Reminder' }), this.signText, actions);
    for (const node of [this.zzz, this.tag, this.bubble, this.sign]) node.hidden = true;
    overlayLayer.append(this.zzz, this.tag, this.sign, this.bubble);

    this.profile = null;
    this.night = false;
    this.drawnKey = '';
    this.lastTransform = '';
    this.hatId = null;
    this.hatKey = '';
    this.hatSize = null;
    this.bubblePriority = -1;
    this.bubbleTimer = null;
    this.bubbleSize = { w: 0, h: 0 };
    this.tagSize = { w: 0, h: 0 };
    this.signSize = { w: 0, h: 0 };
  }

  // Nightcaps on at night, whatever hat was chosen.
  setNight(night) {
    if (night === this.night) return;
    this.night = night;
    this.hatId = null;
  }

  setup(config, pet) {
    this.config = config;
    const dpr = window.devicePixelRatio || 1;
    for (const node of [this.root, this.sprite]) {
      node.style.width = `${pet.w}px`;
      node.style.height = `${pet.h}px`;
    }
    this.sprite.width = Math.round(pet.w * dpr);
    this.sprite.height = Math.round(pet.h * dpr);
    this.ctx.imageSmoothingEnabled = false; // resizing a canvas resets this
    this.drawnKey = '';
    this.hatId = null; // redraw at the new size
  }

  setProfile(profile) {
    this.profile = profile;
    this.sprite.style.filter = profile.hue ? `hue-rotate(${profile.hue}deg)` : '';
    this.tag.textContent = `${profile.name} · Lv ${profile.level}`;
    if (!this.tag.hidden) this.tagSize = { w: this.tag.offsetWidth, h: this.tag.offsetHeight };
  }

  render(pet, viewportWidth) {
    const key = `${pet.animKey}:${pet.frame}`;
    if (key !== this.drawnKey && pet.anim) {
      drawFrame(this.ctx, this.sheet, this.config.sprite, pet.anim, pet.frame);
      this.drawnKey = key;
    }
    this.renderHat(pet);

    const native = this.config.sprite.facing === 'left' ? -1 : 1;
    const { rotate, scaleX, offsetY, flip } = pet.motion;
    const facing = flip ?? (pet.dir === native ? 1 : -1);
    const transform =
      `translate(${Math.round(pet.x)}px, ${Math.round(pet.y + offsetY)}px) ` +
      `rotate(${rotate.toFixed(1)}deg) scaleX(${(facing * scaleX).toFixed(3)})`;
    if (transform !== this.lastTransform) {
      this.root.style.transform = transform;
      this.lastTransform = transform;
    }

    // Stacked above the head: name tag, then a reminder sign, then the speech bubble.
    const head = pet.headPoint();
    if (!this.zzz.hidden) this.zzz.style.transform = `translate(${Math.round(head.x)}px, ${Math.round(head.y) - 10}px)`;
    let bottom = head.y - 10;
    const stack = (node, { w, h }) => {
      const left = clamp(head.x - w / 2, 4, viewportWidth - w - 4);
      node.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, bottom - h))}px)`;
      bottom -= h + 6;
      return left;
    };
    if (!this.tag.hidden) stack(this.tag, this.tagSize);
    if (!this.sign.hidden) stack(this.sign, this.signSize);
    if (!this.bubble.hidden) {
      const left = stack(this.bubble, this.bubbleSize);
      this.bubble.style.setProperty('--tail-x', `${Math.round(clamp(head.x - left, 14, this.bubbleSize.w - 14))}px`);
    }
  }

  renderHat(pet) {
    const hatId = this.night ? 'nightcap' : (this.profile?.hat ?? 'none');
    const art = HATS[hatId];
    if (hatId !== this.hatId) {
      this.hatId = hatId;
      this.hatKey = '';
      this.hat.hidden = !art;
      if (art) {
        this.hatSize = renderPixelArt(this.hat, art, this.config.scale, {
          mirror: this.config.sprite.facing === 'left',
        });
      }
    }
    if (!art) return;
    const anchor = hatAnchor(this.config.sprite, pet.animKey);
    const key = `${anchor.x},${anchor.y}`;
    if (key === this.hatKey) return;
    this.hatKey = key;
    const s = this.config.scale;
    this.hat.style.left = `${anchor.x * s - this.hatSize.width / 2}px`;
    this.hat.style.top = `${(anchor.y + 1) * s - this.hatSize.height}px`;
  }

  // Higher-priority bubbles (reminders) aren't replaced by lower ones (chatter) while visible.
  say(text, { priority = 1, ms = 3500 } = {}) {
    if (!this.bubble.hidden && priority < this.bubblePriority) return false;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubble.classList.remove('pop');
    this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight }; // also restarts the pop
    this.bubble.classList.add('pop');
    this.bubblePriority = priority;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      this.bubble.hidden = true;
      this.bubblePriority = -1;
    }, ms);
    return true;
  }

  showTag(visible) {
    this.tag.hidden = !visible;
    if (visible) this.tagSize = { w: this.tag.offsetWidth, h: this.tag.offsetHeight };
  }

  showZzz(visible) {
    this.zzz.hidden = !visible;
  }

  // A reminder sign the pet holds up until you click Done or Snooze.
  showSign(text, { onDone, onSnooze }) {
    this.signText.textContent = text;
    this.signDone.onclick = onDone;
    this.signSnooze.onclick = onSnooze;
    this.sign.hidden = false;
    this.signSize = { w: this.sign.offsetWidth, h: this.sign.offsetHeight };
  }

  hideSign() {
    this.sign.hidden = true;
  }

  // The sign has buttons, so the window has to take the mouse while the cursor is over it (with a
  // margin, so it already does by the time the cursor reaches a button).
  signContains(x, y, margin = 16) {
    if (this.sign.hidden) return false;
    const box = this.sign.getBoundingClientRect();
    return x >= box.left - margin && x <= box.right + margin && y >= box.top - margin && y <= box.bottom + margin;
  }

  destroy() {
    clearTimeout(this.bubbleTimer);
    for (const node of [this.root, this.zzz, this.tag, this.sign, this.bubble]) node.remove();
  }
}
