// One-off particles and achievement toasts: DOM elements animated in CSS, removed when done.

const layer = document.getElementById('fx');
const toasts = document.getElementById('toasts');
const MAX_TOASTS = 3;

const rand = (min, max) => min + Math.random() * (max - min);

function particle(className, text, { x, y }, delayMs = 0) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  if (delayMs) el.style.animationDelay = `${delayMs}ms`;
  el.addEventListener('animationend', () => el.remove(), { once: true });
  layer.append(el);
  return el;
}

export function heart(point) {
  particle('heart', '♥', point);
}

export function heartBurst({ x, y }, count = 5) {
  for (let i = 0; i < count; i++) particle('heart', '♥', { x: x + rand(-25, 25), y: y + rand(0, 15) }, i * 90);
}

export function giggle({ x, y }) {
  for (let i = 0; i < 2; i++) particle('giggle', 'ha', { x: x + rand(-20, 20), y: y + rand(-5, 10) }, i * 120);
}

// Shown while eating when the sprite sheet has no "eat" animation of its own.
export function food(point, durationMs) {
  particle('food', '\u{1F356}', point).style.animationDuration = `${durationMs}ms`;
}

export function poof({ x, y }) {
  for (let i = 0; i < 7; i++) {
    const puff = particle('puff', '', { x: x + rand(-18, 18), y: y + rand(-14, 14) }, i * 25);
    puff.style.setProperty('--size', `${Math.round(rand(14, 26))}px`);
  }
}

export function sparkles({ x, y }, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const spark = particle('sparkle', '✦', { x, y }, i * 20);
    spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * rand(30, 55))}px`);
    spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * rand(30, 55))}px`);
  }
}

const CONFETTI_COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff6b9d'];

export function confetti(width, count = 70) {
  for (let i = 0; i < count; i++) {
    const piece = particle('confetti', '', { x: rand(0, width), y: -20 }, rand(0, 900));
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.setProperty('--drift', `${Math.round(rand(-120, 120))}px`);
    piece.style.setProperty('--spin', `${Math.round(rand(-720, 720))}deg`);
    piece.style.animationDuration = `${rand(2.5, 4.5).toFixed(2)}s`;
  }
}

export function toast({ icon, kicker, title, description }) {
  const card = document.createElement('div');
  card.className = 'toast';
  const iconEl = Object.assign(document.createElement('span'), { className: 'toast-icon', textContent: icon });
  const body = document.createElement('div');
  body.append(
    Object.assign(document.createElement('small'), { textContent: kicker }),
    Object.assign(document.createElement('strong'), { textContent: title }),
    Object.assign(document.createElement('span'), { textContent: description }),
  );
  card.append(iconEl, body);
  toasts.append(card);
  while (toasts.children.length > MAX_TOASTS) toasts.firstElementChild.remove();
  setTimeout(() => {
    card.classList.add('leaving');
    card.addEventListener('animationend', () => card.remove(), { once: true });
  }, 5500);
}
