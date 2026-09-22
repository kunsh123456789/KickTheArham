'use strict';
/* Kick The Arham — a Kick the Buddy style stress-relief game.
   Verlet ragdoll physics, weapons, bucks, unlocks. No dependencies. */

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const store = {
  get(k, d) { try { const v = localStorage.getItem('kta_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kta_' + k, JSON.stringify(v)); } catch (e) {} }
};
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}

// ---------- canvas ----------
const cv = $('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, U = 60, FLOOR = 0, TOP = 0;
let bg = null;

// ---------- state ----------
let bucks = store.get('bucks', 60);
let unlocked = new Set(store.get('unlocked', ['hand', 'punch']));
let buddyName = store.get('name', 'Arham');
let muted = store.get('muted', false);
let faceImg = null;
let tool = 'hand';
let earnFrac = 0;
let pain = 0, char = 0, onFire = 0, zapped = 0, stand = 1, sinceHurt = 10, idleTimer = 0;
let shake = 0, flash = 0, flashColor = '#fff';
let bubble = null, voiceCd = 0, blink = 0, time = 0;
let decals = [], props = [], parts = [], floorStains = [], wallMarks = [], bolts = [], fists = [];

const TOOLS = [
  { id: 'hand', name: 'Hand', icon: '✋', price: 0 },
  { id: 'punch', name: 'Punch', icon: '👊', price: 0 },
  { id: 'knife', name: 'Knife', icon: '🔪', price: 40 },
  { id: 'ball', name: 'Bowling', icon: '🎳', price: 70 },
  { id: 'pistol', name: 'Pistol', icon: '🔫', price: 120 },
  { id: 'bomb', name: 'Bomb', icon: '💣', price: 200 },
  { id: 'fire', name: 'Flamer', icon: '🔥', price: 320 },
  { id: 'anvil', name: 'Anvil', icon: '🪨', price: 450 },
  { id: 'lightning', name: 'Zeus', icon: '⚡', price: 700 },
];

// ---------- ragdoll definition (units of U, relative to feet on floor) ----------
// 0 head,1 neck,2 shL,3 shR,4 hipL,5 hipR,6 elbL,7 elbR,8 handL,9 handR,10 kneeL,11 kneeR,12 footL,13 footR
const POSE = [[0, -4.1], [0, -3.45], [-.6, -3.3], [.6, -3.3], [-.4, -1.9], [.4, -1.9], [-.8, -2.5], [.8, -2.5],
  [-.95, -1.75], [.95, -1.75], [-.42, -.98], [.42, -.98], [-.45, -.2], [.45, -.2]];
const RAD = [.55, .15, .18, .18, .2, .2, .16, .16, .17, .17, .2, .2, .2, .2];
const MASS = [1.4, 1, 1.5, 1.5, 1.6, 1.6, .7, .7, .5, .5, .9, .9, .8, .8];
const LINKS = [[0, 1, 1], [1, 2, 1], [1, 3, 1], [2, 3, 1], [2, 4, 1], [3, 5, 1], [4, 5, 1], [2, 5, 1], [3, 4, 1],
  [2, 6, 1], [6, 8, 1], [3, 7, 1], [7, 9, 1], [4, 10, 1], [10, 12, 1], [5, 11, 1], [11, 13, 1], [0, 2, .35], [0, 3, .35]];
// limbs: a, b, thickness(U), part  -> frames 2..9
const LIMBS = [[2, 6, .36, 'shirt'], [6, 8, .3, 'skin'], [3, 7, .36, 'shirt'], [7, 9, .3, 'skin'],
  [4, 10, .46, 'pants'], [10, 12, .4, 'pants'], [5, 11, .46, 'pants'], [11, 13, .4, 'pants']];
const COLORS = { skin: '#f2c29b', shirt: '#ff5d73', pants: '#34507a', shoe: '#222831', hair: '#2b1a10' };
let P = [], C = [];
let grab = null; // {type:'pt'|'prop', ref}
const pointer = { x: 0, y: 0, down: false, lx: 0, ly: 0, id: null };

function buildBuddy(cx) {
  P = POSE.map((q, i) => {
    const x = cx + q[0] * U, y = FLOOR + q[1] * U;
    return { x, y, px: x, py: y, r: RAD[i] * U, m: MASS[i], hitCd: 0 };
  });
  C = LINKS.map(([a, b, k]) => ({ a, b, k, len: Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y) }));
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const oldU = U;
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  const toolsH = $('tools').offsetHeight || 90;
  TOP = 0;
  FLOOR = H - toolsH - 8;
  U = Math.max(28, Math.min((FLOOR - 70) / 5.6, W / 5.2));
  buildBg();
  if (!P.length || Math.abs(oldU - U) > 1) buildBuddy(W / 2);
  else for (const p of P) { p.x = clamp(p.x, p.r, W - p.r); p.px = p.x; }
}

function buildBg() {
  bg = document.createElement('canvas');
  bg.width = W * DPR; bg.height = H * DPR;
  const b = bg.getContext('2d');
  b.scale(DPR, DPR);
  const g = b.createLinearGradient(0, 0, 0, FLOOR);
  g.addColorStop(0, '#5b4b8a'); g.addColorStop(1, '#8e7cc3');
  b.fillStyle = g; b.fillRect(0, 0, W, FLOOR);
  // wallpaper stripes
  b.fillStyle = 'rgba(255,255,255,.05)';
  for (let x = 0; x < W; x += 60) b.fillRect(x, 0, 30, FLOOR);
  // polka dots
  b.fillStyle = 'rgba(255,255,255,.06)';
  for (let y = 30; y < FLOOR - 40; y += 70) for (let x = (y / 70 % 2) * 30 + 15; x < W; x += 60) {
    b.beginPath(); b.arc(x, y, 5, 0, 7); b.fill();
  }
  // skirting board
  b.fillStyle = '#3d2f63'; b.fillRect(0, FLOOR - 22, W, 22);
  b.fillStyle = 'rgba(255,255,255,.12)'; b.fillRect(0, FLOOR - 22, W, 3);
  // wood floor
  const fg = b.createLinearGradient(0, FLOOR, 0, H);
  fg.addColorStop(0, '#a8683a'); fg.addColorStop(1, '#6e3f1f');
  b.fillStyle = fg; b.fillRect(0, FLOOR, W, H - FLOOR);
  b.strokeStyle = 'rgba(0,0,0,.25)'; b.lineWidth = 2;
  for (let y = FLOOR + 14; y < H; y += 14) { b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke(); }
  for (let y = FLOOR, row = 0; y < H; y += 14, row++) for (let x = (row % 2) * 70; x < W; x += 140) {
    b.beginPath(); b.moveTo(x, y); b.lineTo(x, y + 14); b.stroke();
  }
  b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(0, FLOOR, W, 4);
}

// ---------- audio ----------
let AC = null, master = null, NB = null;
const sndLast = {};
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = .5; master.connect(AC.destination);
    NB = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = NB.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(f, f2, dur, type, vol, delay = 0) {
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}
function noise(dur, vol, freq, type = 'lowpass', q = 1) {
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = NB; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * .6); s.stop(t + dur + .05);
}
function sfx(kind, strength = 1) {
  if (!AC || muted) return;
  const now = performance.now(), gap = { thud: 60, slash: 50, crackle: 90, voice: 0 }[kind] || 20;
  if (sndLast[kind] && now - sndLast[kind] < gap) return;
  sndLast[kind] = now;
  const s = clamp(strength, .2, 1.5);
  switch (kind) {
    case 'thud': tone(140, 45, .18, 'sine', .5 * s); noise(.08, .25 * s, 500); break;
    case 'punch': tone(180, 50, .15, 'sine', .7); noise(.1, .5, 1200); break;
    case 'whoosh': noise(.2, .15, 900, 'bandpass', 2); break;
    case 'slash': noise(.12, .35, 4000, 'bandpass', 3); tone(1800, 900, .08, 'triangle', .08); break;
    case 'gun': noise(.25, .9, 2500); tone(300, 60, .12, 'square', .2); break;
    case 'boom': noise(1.2, 1, 500); tone(90, 25, .8, 'sine', .9); noise(.3, .6, 2500); break;
    case 'fuse': tone(2000, 1800, .03, 'square', .04); break;
    case 'crackle': noise(.06, .18, 3000, 'highpass'); break;
    case 'zap': for (let i = 0; i < 5; i++) tone(rand(200, 1200), rand(80, 400), .12, 'sawtooth', .18, i * .05); noise(.5, .5, 3000); break;
    case 'clang': tone(900, 850, .6, 'triangle', .35); tone(1370, 1300, .5, 'sine', .2); noise(.15, .6, 800); break;
    case 'buy': [523, 659, 784, 1047].forEach((f, i) => tone(f, f, .15, 'square', .12, i * .08)); break;
    case 'deny': tone(200, 120, .25, 'square', .15); break;
    case 'voice': {
      const base = rand(380, 620);
      tone(base, base * rand(1.2, 1.8), .09, 'square', .09);
      tone(base * 1.3, base * .7, .14, 'square', .08, .09);
      break;
    }
    case 'pop': tone(600, 1200, .08, 'sine', .25); break;
  }
}

// ---------- speech ----------
const LINES = {
  hurt: ['Ow!', 'Ouch!', 'Hey!', 'Not the face!', 'Why?!', 'Oof!', 'That hurts!', 'Stop it!', 'Mommy!', "I'm telling!", 'Rude!', 'Ahh!', 'My spleen!', 'Yikes!'],
  boom: ['KABOOM?!', 'My ears!!', 'Who did that?!', "I'm seeing stars..."],
  fire: ['Hot hot hot!', "I'm toast!", 'Water! WATER!', 'Crispy...'],
  zap: ['BZZZT!', 'I can taste colors!', 'Shocking!'],
  grab: ['Put me down!', 'Wheee!', 'Whoa!', 'Careful!', "I'm flying!"],
  idle: ['Is that all you got?', "I'm bored...", 'Come on, hit me!', '{n} is invincible!', 'Hello? Anyone there?', '*yawn*', "You can't hurt me!", 'Nice room, huh?'],
  up: ['Ha! Still standing!', "Can't keep me down!", "That tickled.", "I'm fine. Totally fine."],
};
function say(kind, force) {
  if (!force && (voiceCd > 0 || Math.random() > .55)) return;
  const t = pick(LINES[kind]).replace('{n}', buddyName);
  bubble = { text: t, t: 2.2 };
  voiceCd = 1.4;
  sfx('voice');
}

// ---------- damage / money ----------
function hurt(amount, kind = 'hurt') {
  pain = Math.min(100, pain + amount);
  sinceHurt = 0; idleTimer = 0;
  earnFrac += amount * .6;
  if (earnFrac >= 1) {
    const n = Math.floor(earnFrac);
    earnFrac -= n; addBucks(n);
  }
  if (amount > 1.5) say(kind);
}
let bucksPulseT = 0;
function addBucks(n) {
  bucks += n;
  $('bucksVal').textContent = bucks;
  store.set('bucks', bucks);
  const el = $('bucks'); el.classList.add('pulse');
  clearTimeout(bucksPulseT); bucksPulseT = setTimeout(() => el.classList.remove('pulse'), 120);
  refreshAffordable();
}
function knock(k = 0) { stand = Math.min(stand, k); }

// ---------- geometry / frames ----------
function frame(f) {
  let ox, oy, ax, ay;
  if (f === 0) { const h = P[0], n = P[1]; ox = h.x; oy = h.y; ax = h.x - n.x; ay = h.y - n.y; }
  else if (f === 1) {
    const sx = (P[2].x + P[3].x) / 2, sy = (P[2].y + P[3].y) / 2, hx = (P[4].x + P[5].x) / 2, hy = (P[4].y + P[5].y) / 2;
    ox = (sx + hx) / 2; oy = (sy + hy) / 2; ax = sx - hx; ay = sy - hy;
  } else { const L = LIMBS[f - 2], a = P[L[0]], b = P[L[1]]; ox = a.x; oy = a.y; ax = b.x - a.x; ay = b.y - a.y; }
  const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
  return { ox, oy, ax, ay, len: l, ang: Math.atan2(ax, -ay) };
}
function toWorld(fr, lx, ly) { return [fr.ox + (fr.ax * lx - fr.ay * ly) * U, fr.oy + (fr.ay * lx + fr.ax * ly) * U]; }
function toLocal(fr, x, y) { const dx = x - fr.ox, dy = y - fr.oy; return [(dx * fr.ax + dy * fr.ay) / U, (-dx * fr.ay + dy * fr.ax) / U]; }
function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = clamp(((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return [Math.hypot(a.x + vx * t - px, a.y + vy * t - py), t];
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function hitTest(x, y, tol = .12) {
  if (Math.hypot(x - P[0].x, y - P[0].y) < (RAD[0] + tol) * U) return { f: 0, i: 0 };
  const test = k => {
    const L = LIMBS[k], [d, t] = segDist(x, y, P[L[0]], P[L[1]]);
    return d < (L[2] / 2 + tol) * U ? { f: k + 2, i: t < .5 ? L[0] : L[1] } : null;
  };
  for (let k = 0; k < 4; k++) { const h = test(k); if (h) return h; }
  const quad = [P[2], P[3], P[5], P[4]];
  let near = inPoly(x, y, quad);
  if (!near) for (let i = 0; i < 4; i++) if (segDist(x, y, quad[i], quad[(i + 1) % 4])[0] < (.22 + tol) * U) { near = true; break; }
  if (near) {
    let best = 1, bd = 1e9;
    for (let i = 1; i <= 5; i++) { const d = Math.hypot(x - P[i].x, y - P[i].y); if (d < bd) { bd = d; best = i; } }
    return { f: 1, i: best };
  }
  for (let k = 4; k < 8; k++) { const h = test(k); if (h) return h; }
  return null;
}
function addDecal(f, x, y, kind, rot = 0, size = 1) {
  const fr = frame(f);
  let [lx, ly] = toLocal(fr, x, y);
  if (f === 0) { const d = Math.hypot(lx, ly), m = RAD[0] * .8; if (d > m) { lx *= m / d; ly *= m / d; } }
  else if (f >= 2) { const L = LIMBS[f - 2]; lx = clamp(lx, 0, fr.len / U); ly = clamp(ly, -L[2] * .3, L[2] * .3); }
  else { lx = clamp(lx, -.65, .65); ly = clamp(ly, -.5, .5); }
  decals.push({ f, lx, ly, kind, rot, size });
  if (decals.length > 160) decals.shift();
}
function addVel(o, vx, vy) { o.px -= vx; o.py -= vy; }
function bodyCenter() { return [(P[2].x + P[3].x + P[4].x + P[5].x) / 4, (P[2].y + P[3].y + P[4].y + P[5].y) / 4]; }

// ---------- particles ----------
function spawn(type, x, y, vx, vy, life, size, color) { parts.push({ type, x, y, vx, vy, life, max: life, size, color }); }
function blood(x, y, n, sp = 1) {
  for (let i = 0; i < n; i++) spawn('drop', x, y, rand(-3, 3) * sp, rand(-5, 0) * sp, rand(.6, 1.4), rand(2, 5), '#d7263d');
}
function sparks(x, y, n, col = '#ffd84d') { for (let i = 0; i < n; i++) spawn('spark', x, y, rand(-7, 7), rand(-8, 3), rand(.2, .5), rand(2, 4), col); }
function popText(x, y, text, color = '#ffd84d', size = 34) { parts.push({ type: 'text', x, y, vx: rand(-1, 1), vy: -1.5, life: .9, max: .9, size, color, text, rot: rand(-.3, .3) }); }

// ---------- props ----------
function addProp(type, x, y) {
  const d = {
    ball: { r: .36, m: 6, bounce: .35, fric: .99 },
    bomb: { r: .3, m: 2, bounce: .4, fric: .97, fuse: 2.2 },
    anvil: { r: .55, m: 30, bounce: .05, fric: .8 },
  }[type];
  const p = { type, x, y, px: x, py: y, r: d.r * U, m: d.m, bounce: d.bounce, fric: d.fric, fuse: d.fuse || 0, ang: 0, hitCd: 0 };
  props.push(p);
  if (props.length > 14) { const i = props.findIndex(q => q.type !== 'bomb'); props.splice(i < 0 ? 0 : i, 1); }
  return p;
}
function explode(x, y, R, power) {
  sfx('boom'); shake = Math.max(shake, 26); flash = .8; flashColor = '#fff3c4';
  let dmg = 0;
  for (const p of P) {
    const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
    if (d < R) {
      const f = (1 - d / R) * power;
      addVel(p, dx / d * f, dy / d * f - f * .4);
      dmg += (1 - d / R) * 6;
    }
  }
  if (dmg > 0) {
    hurt(dmg, 'boom'); knock(0); char = Math.min(1, char + dmg / 200);
    for (let i = 0; i < 5; i++) {
      const k = (Math.random() * 14) | 0, p = P[k];
      if (Math.hypot(p.x - x, p.y - y) < R * .7) { const h = hitTest(p.x, p.y, .05); if (h) addDecal(h.f, p.x, p.y, 'soot', rand(0, 6), rand(.8, 1.5)); }
    }
    const [bx, by] = bodyCenter(); blood(bx, by, 14, 1.6);
  }
  for (const q of props) {
    const dx = q.x - x, dy = q.y - y, d = Math.hypot(dx, dy) || 1;
    if (d < R && d > 1) { const f = (1 - d / R) * power * 4 / q.m; addVel(q, dx / d * f, dy / d * f - f * .3); }
  }
  for (let i = 0; i < 40; i++) spawn('spark', x, y, rand(-14, 14), rand(-16, 6), rand(.3, .8), rand(3, 6), pick(['#ffd84d', '#ff9f1c', '#ff5d2c']));
  for (let i = 0; i < 18; i++) spawn('smoke', x + rand(-20, 20), y + rand(-20, 20), rand(-2, 2), rand(-3, -.5), rand(1, 2), rand(15, 30), '#555');
  wallMarks.push({ x, y: Math.min(y, FLOOR - 5), r: R * .35, life: 30 });
  popText(x, y - 20, 'KABOOM!', '#ff9f1c', 48);
}

// ---------- tool actions ----------
function strikeLightning(x, y) {
  const h = hitTest(x, y, .2);
  let tx = x, ty = FLOOR;
  if (h) { tx = P[h.i].x; ty = P[h.i].y; }
  const pts = [[tx + rand(-80, 80), 0]];
  const steps = 14;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    pts.push([pts[0][0] + (tx - pts[0][0]) * t + rand(-30, 30), ty * t]);
  }
  pts.push([tx, ty]);
  bolts.push({ pts, life: .35 });
  sfx('zap'); flash = 1; flashColor = '#dff4ff'; shake = Math.max(shake, 14);
  sparks(tx, ty, 30, '#bfe9ff');
  if (h) {
    zapped = 1.2; knock(0); hurt(25, 'zap'); char = Math.min(1, char + .18);
    addDecal(h.f, tx, ty, 'soot', rand(0, 6), 1.6);
    for (const p of P) addVel(p, rand(-1, 1) * U * .25, rand(-1, .3) * U * .25);
  } else {
    wallMarks.push({ x: tx, y: FLOOR - 4, r: 26, life: 20 });
  }
}

function doPunch(x, y) {
  const h = hitTest(x, y);
  fists.push({ x, y, t: .25 });
  if (!h) { sfx('whoosh'); return; }
  const [cx, cy] = bodyCenter();
  let dx = cx - x, dy = cy - y; const d = Math.hypot(dx, dy);
  if (d < U * .3) { dx = Math.random() < .5 ? -1 : 1; dy = 0; } else { dx /= d; dy /= d; }
  dx = -dx; // push away from the side you hit
  dx = x < cx ? Math.abs(dx) + .4 : -(Math.abs(dx) + .4);
  const f = U * .45;
  const p = P[h.i];
  addVel(p, dx * f, -f * .35 + dy * f * .2);
  for (const c of C) {
    const o = c.a === h.i ? P[c.b] : c.b === h.i ? P[c.a] : null;
    if (o) addVel(o, dx * f * .5, -f * .15);
  }
  knock(0);
  sfx('punch'); shake = Math.max(shake, 6);
  hurt(6);
  addDecal(h.f, x, y, 'bruise', 0, rand(.8, 1.2));
  popText(x, y - 10, pick(['POW!', 'BAM!', 'WHACK!', 'SMACK!']), '#fff', 30);
  sparks(x, y, 6, '#fff');
}

function doShoot(x, y) {
  sfx('gun'); shake = Math.max(shake, 5); flash = .15; flashColor = '#fff6d0';
  spawn('shell', x + 30, y - 10, rand(2, 5), rand(-7, -4), 3, 4, '#d4a017');
  const h = hitTest(x, y, .02);
  if (!h) {
    if (y < FLOOR) wallMarks.push({ x, y, r: 4, life: 25, hole: true });
    sparks(x, y, 8);
    return;
  }
  addDecal(h.f, x, y, 'hole', rand(0, 6), 1);
  const p = P[h.i];
  const [cx] = bodyCenter();
  addVel(p, (p.x < cx ? -1 : 1) * rand(.1, .25) * U + rand(-3, 3), -U * .08);
  stand *= .3;
  blood(x, y, 10, 1.2);
  hurt(9);
}

let lastSliceT = [];
function doSlice(x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 4) return;
  const n = Math.ceil(len / 8), ang = Math.atan2(y1 - y0, x1 - x0);
  for (let s = 0; s <= n; s++) {
    const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
    const h = hitTest(x, y, 0);
    if (!h) continue;
    const now = performance.now();
    if (lastSliceT[h.f] && now - lastSliceT[h.f] < 90) continue;
    lastSliceT[h.f] = now;
    const fr = frame(h.f);
    addDecal(h.f, x, y, 'cut', ang - fr.ang + Math.PI / 2, clamp(len / 40, .6, 1.4));
    blood(x, y, 6, .8);
    sfx('slash');
    addVel(P[h.i], (x1 - x0) * .08, (y1 - y0) * .08);
    stand = Math.max(0, stand - .08);
    hurt(3.5);
  }
}

function doFire(dt) {
  const x = pointer.x, y = pointer.y;
  for (let i = 0; i < 3; i++) spawn('flame', x + rand(-8, 8), y + rand(-8, 8), rand(-1.2, 1.2), rand(-3.5, -1.5), rand(.4, .8), rand(10, 18), '#ff9f1c');
  sfx('crackle');
  let near = false;
  for (const p of P) if (Math.hypot(p.x - x, p.y - y) < p.r + U * .5) { near = true; break; }
  if (near) {
    onFire = Math.max(onFire, 2.5);
    char = Math.min(1, char + dt * .12);
  }
}

// ---------- input ----------
function localPos(e) { return [e.clientX, e.clientY]; }
cv.addEventListener('pointerdown', e => {
  initAudio();
  cv.setPointerCapture(e.pointerId);
  const [x, y] = localPos(e);
  Object.assign(pointer, { x, y, lx: x, ly: y, down: true, id: e.pointerId });
  switch (tool) {
    case 'hand': {
      for (let i = props.length - 1; i >= 0; i--) {
        const q = props[i];
        if (Math.hypot(q.x - x, q.y - y) < q.r + 8) { grab = { type: 'prop', ref: q }; return; }
      }
      const h = hitTest(x, y, .25);
      if (h) { grab = { type: 'pt', ref: P[h.i] }; knock(0); say('grab'); sfx('pop'); }
      break;
    }
    case 'punch': doPunch(x, y); break;
    case 'pistol': doShoot(x, y); break;
    case 'knife': break;
    case 'ball': addProp('ball', x, Math.min(y, FLOOR - U)); sfx('pop'); break;
    case 'bomb': addProp('bomb', x, Math.min(y, FLOOR - U)); sfx('pop'); break;
    case 'anvil': { const a = addProp('anvil', x, -U); addVel(a, 0, -U * .1); sfx('whoosh'); break; }
    case 'lightning': strikeLightning(x, y); break;
  }
});
cv.addEventListener('pointermove', e => {
  const [x, y] = localPos(e);
  pointer.lx = pointer.x; pointer.ly = pointer.y;
  pointer.x = x; pointer.y = y;
  if (pointer.down && tool === 'knife') doSlice(pointer.lx, pointer.ly, x, y);
});
function release() { pointer.down = false; grab = null; }
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());

// ---------- physics ----------
const ITER = 10;
function step(dt) {
  time += dt;
  const G = U * .0095, MAXV = U * .6;
  voiceCd -= dt; sinceHurt += dt; idleTimer += dt;
  pain = Math.max(0, pain - dt * (pain > 70 ? 6 : 10));
  zapped = Math.max(0, zapped - dt);
  if (bubble && (bubble.t -= dt) <= 0) bubble = null;
  if (idleTimer > 7) { idleTimer = 0; say('idle', true); }

  if (pointer.down && tool === 'fire') doFire(dt);
  if (onFire > 0) {
    onFire -= dt;
    const p = P[(Math.random() * 14) | 0];
    spawn('flame', p.x + rand(-6, 6), p.y + rand(-6, 6), rand(-1, 1), rand(-3, -1), rand(.3, .7), rand(8, 16), '#ff9f1c');
    hurt(dt * 22, 'fire');
    if (Math.random() < .3) sfx('crackle');
    if (Math.random() < .02) say('fire');
    knock(0);
  }
  if (zapped > 0) for (const p of P) addVel(p, rand(-1, 1) * U * .02, rand(-1, 1) * U * .02);

  // getting back up
  const wasDown = stand < .5;
  if (!grab && sinceHurt > 1.3 && pain < 70 && onFire <= 0 && zapped <= 0) stand = Math.min(1, stand + dt * .6);
  if (wasDown && stand >= .5 && Math.random() < .5) say('up');

  // integrate (muscles counter gravity while standing)
  const g = G * (1 - .9 * stand * stand);
  for (const p of P) {
    let vx = (p.x - p.px) * .995, vy = (p.y - p.py) * .995;
    const v = Math.hypot(vx, vy); if (v > MAXV) { vx *= MAXV / v; vy *= MAXV / v; }
    p.px = p.x; p.py = p.y;
    p.x += vx; p.y += vy + g;
    p.hitCd -= dt;
  }
  // balance "puppet strings"
  if (stand > 0.01) {
    const s = stand * stand;
    const cx = clamp((P[4].x + P[5].x) / 2, U * 1.2, W - U * 1.2);
    const sway = Math.sin(time * 1.3) * U * .06;
    for (let i = 0; i < 14; i++) {
      const k = (i >= 12 ? .2 : i <= 5 ? .15 : i >= 10 ? .12 : .02) * s;
      const tx = cx + POSE[i][0] * U + (i <= 1 ? sway : 0), ty = FLOOR + POSE[i][1] * U;
      const p = P[i], dx = (tx - p.x) * k, dy = (ty - p.y) * k;
      p.x += dx; p.y += dy; p.px += dx * .85; p.py += dy * .85;
      p.px += (p.x - p.px) * .08 * s; // damp sideways drift
    }
  }
  // solve
  for (let it = 0; it < ITER; it++) {
    for (const c of C) {
      const a = P[c.a], b = P[c.b];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .001;
      const wa = 1 / a.m, wb = 1 / b.m, diff = (d - c.len) / d / (wa + wb) * c.k;
      a.x += dx * diff * wa; a.y += dy * diff * wa;
      b.x -= dx * diff * wb; b.y -= dy * diff * wb;
    }
    if (grab && grab.type === 'pt') {
      const p = grab.ref; p.x += (pointer.x - p.x) * .3; p.y += (pointer.y - p.y) * .3;
    }
    for (const p of P) collideWalls(p, it === 0);
  }
  // props
  for (const q of props) {
    let vx = (q.x - q.px), vy = (q.y - q.py);
    const v = Math.hypot(vx, vy), mv = U * .9; if (v > mv) { vx *= mv / v; vy *= mv / v; }
    q.px = q.x; q.py = q.y; q.x += vx * .998; q.y += vy * .998 + G;
    q.hitCd -= dt;
    if (grab && grab.ref === q) { q.x += (pointer.x - q.x) * .3; q.y += (pointer.y - q.y) * .3; }
    // floor/walls
    if (q.y + q.r > FLOOR) {
      const vy2 = q.y - q.py;
      if (vy2 > U * .15 && q.hitCd <= 0) {
        q.hitCd = .2;
        if (q.type === 'anvil') { sfx('clang'); shake = Math.max(shake, 12); } else sfx('thud', vy2 / U);
      }
      q.y = FLOOR - q.r; q.py = q.y + vy2 * q.bounce;
      q.px = q.x - (q.x - q.px) * q.fric;
    }
    if (q.x - q.r < 0) { const vx2 = q.x - q.px; q.x = q.r; q.px = q.x + vx2 * .5; }
    if (q.x + q.r > W) { const vx2 = q.x - q.px; q.x = W - q.r; q.px = q.x + vx2 * .5; }
    q.ang += (q.x - q.px) / q.r * (q.type === 'anvil' ? .1 : 1);
    if (q.type === 'anvil') q.ang *= .9;
    if (q.type === 'bomb') {
      q.fuse -= dt;
      if (Math.random() < .5) spawn('spark', q.x + Math.sin(q.ang - .6) * q.r * 1.3, q.y - Math.cos(q.ang - .6) * q.r * 1.3, rand(-2, 2), rand(-3, 0), .2, 2, '#ffd84d');
      if ((q.fuse * 8 | 0) % 2 === 0) sfx('fuse');
    }
  }
  for (let i = props.length - 1; i >= 0; i--) {
    const q = props[i];
    if (q.type === 'bomb' && q.fuse <= 0) { props.splice(i, 1); if (grab && grab.ref === q) grab = null; explode(q.x, q.y, U * 3.2, U * .75); }
  }
  // prop vs body
  for (const q of props) for (let i = 0; i < 14; i++) {
    const p = P[i], dx = p.x - q.x, dy = p.y - q.y, rs = p.r + q.r, d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) continue;
    const d = Math.sqrt(d2) || .001, nx = dx / d, ny = dy / d, pen = rs - d;
    const rel = ((q.x - q.px) - (p.x - p.px)) * nx + ((q.y - q.py) - (p.y - p.py)) * ny;
    const wp = 1 / p.m, wq = 1 / q.m, tot = wp + wq;
    p.x += nx * pen * wp / tot; p.y += ny * pen * wp / tot;
    q.x -= nx * pen * wq / tot; q.y -= ny * pen * wq / tot;
    if (rel > U * .12 && q.hitCd <= 0) {
      q.hitCd = .15;
      const dmg = rel / U * q.m * 1.6;
      if (q.type === 'anvil') { sfx('clang'); shake = Math.max(shake, 16); popText(p.x, p.y - 20, 'CLANG!', '#ddd', 40); blood(p.x, p.y, 16, 1.5); }
      else { sfx('thud', rel / U * 2); sparks(p.x, p.y, 4, '#fff'); }
      addVel(p, nx * rel * .6, ny * rel * .6);
      knock(0); hurt(Math.min(dmg, 40));
      const h = hitTest(p.x - nx * p.r * .5, p.y - ny * p.r * .5, .1);
      if (h) addDecal(h.f, p.x - nx * p.r * .5, p.y - ny * p.r * .5, 'bruise', 0, clamp(q.r / U * 2.5, .8, 2));
    }
  }
  // prop vs prop
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const a = props[i], b = props[j], dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r, d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) continue;
    const d = Math.sqrt(d2) || .001, pen = rs - d, wa = 1 / a.m, wb = 1 / b.m, tot = wa + wb;
    a.x -= dx / d * pen * wa / tot; a.y -= dy / d * pen * wa / tot;
    b.x += dx / d * pen * wb / tot; b.y += dy / d * pen * wb / tot;
  }

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    q.x += q.vx; q.y += q.vy;
    if (q.type === 'drop' || q.type === 'spark' || q.type === 'shell') q.vy += G * 1.1;
    if (q.type === 'flame') { q.vy -= .05; q.size *= .985; }
    if (q.type === 'smoke') { q.size *= 1.01; q.vx *= .98; }
    if (q.type === 'drop' && q.y > FLOOR) {
      floorStains.push({ x: q.x, y: FLOOR + rand(2, 10), r: q.size * rand(1.2, 2.5), life: 25 });
      if (floorStains.length > 80) floorStains.shift();
      q.life = 0;
    }
    if (q.type === 'shell' && q.y > FLOOR - 3) { q.y = FLOOR - 3; q.vy *= -.4; q.vx *= .7; }
    if (q.life <= 0) parts.splice(i, 1);
  }
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const s of floorStains) s.life -= dt;
  floorStains = floorStains.filter(s => s.life > 0);
  for (const m of wallMarks) m.life -= dt;
  wallMarks = wallMarks.filter(m => m.life > 0);
  for (const b of bolts) b.life -= dt;
  bolts = bolts.filter(b => b.life > 0);
  for (const f of fists) f.t -= dt;
  fists = fists.filter(f => f.t > 0);
  shake *= .88; flash = Math.max(0, flash - dt * 3);
  blink -= dt; if (blink < -3.5 - Math.random() * 3) blink = .12;
}

function collideWalls(p, detect) {
  if (p.y + p.r > FLOOR) {
    const vy = p.y - p.py;
    if (detect && vy > U * .22 && p.hitCd <= 0) {
      p.hitCd = .25;
      const dmg = (vy / U - .2) * 14;
      sfx('thud', vy / U * 1.5);
      if (dmg > 3) { hurt(dmg); shake = Math.max(shake, dmg * .6); sparks(p.x, FLOOR, 5, '#fff'); knock(0); }
    }
    p.y = FLOOR - p.r;
    p.py = p.y + vy * .25;
    p.px = p.x - (p.x - p.px) * .75;
  }
  if (p.y - p.r < TOP) {
    const vy = p.y - p.py; p.y = TOP + p.r; p.py = p.y + vy * .3;
    if (detect && -vy > U * .25 && p.hitCd <= 0) { p.hitCd = .25; sfx('thud'); hurt(-vy / U * 8); }
  }
  for (const [edge, s] of [[p.r, 1], [W - p.r, -1]]) {
    if ((p.x - edge) * s < 0) {
      const vx = p.x - p.px;
      if (detect && Math.abs(vx) > U * .25 && p.hitCd <= 0) {
        p.hitCd = .25; sfx('thud', Math.abs(vx) / U); hurt(Math.abs(vx) / U * 10);
        shake = Math.max(shake, 6); knock(0);
      }
      p.x = edge; p.px = p.x + vx * .3;
    }
  }
}

// ---------- rendering ----------
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(bg, 0, 0, W, H);
  ctx.save();
  if (shake > .5) ctx.translate(rand(-shake, shake) * .6, rand(-shake, shake) * .6);

  // wall & floor marks
  for (const m of wallMarks) {
    ctx.globalAlpha = clamp(m.life / 5, 0, 1);
    if (m.hole) {
      ctx.fillStyle = '#1a1325'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 3, 0, 7); ctx.stroke();
    } else {
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 2);
      g.addColorStop(0, 'rgba(20,10,10,.85)'); g.addColorStop(1, 'rgba(20,10,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2, 0, 7); ctx.fill();
    }
  }
  for (const s of floorStains) {
    ctx.globalAlpha = clamp(s.life / 5, 0, 1) * .8;
    ctx.fillStyle = '#9b1b2c';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * .35, 0, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // shadow
  const [bcx] = bodyCenter();
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(bcx, FLOOR + 4, U * 1.1, U * .15, 0, 0, 7); ctx.fill();

  drawBuddy();
  for (const q of props) drawProp(q);

  // particles
  for (const q of parts) {
    const a = clamp(q.life / q.max, 0, 1);
    ctx.globalAlpha = q.type === 'smoke' ? a * .5 : q.type === 'text' ? Math.min(1, a * 2) : a;
    if (q.type === 'text') {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.font = `900 ${q.size}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(q.text, 0, 0);
      ctx.fillStyle = q.color; ctx.fillText(q.text, 0, 0); ctx.restore();
    } else if (q.type === 'flame') {
      ctx.fillStyle = a > .6 ? '#ffe066' : a > .3 ? '#ff9f1c' : '#e63946';
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (.5 + a * .5), 0, 7); ctx.fill();
    } else if (q.type === 'shell') {
      ctx.fillStyle = q.color; ctx.fillRect(q.x - 2, q.y - 4, 4, 8);
    } else {
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, 7); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // lightning
  for (const b of bolts) {
    ctx.globalAlpha = clamp(b.life / .35, 0, 1);
    for (const [w, col] of [[14, 'rgba(120,200,255,.4)'], [6, '#bfe9ff'], [2.5, '#fff']]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath();
      b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // fists
  for (const f of fists) {
    ctx.save(); ctx.globalAlpha = clamp(f.t / .25, 0, 1);
    ctx.font = `${40 + (1 - f.t / .25) * 30}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('👊', f.x, f.y); ctx.restore();
  }

  drawBubble();
  ctx.restore();

  // cursor hint for tools
  if (tool === 'fire' && pointer.down) {
    ctx.font = '36px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔥', pointer.x, pointer.y + 26);
  }
  if (flash > 0) { ctx.globalAlpha = Math.min(flash, .85); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

function col(part) {
  const base = COLORS[part];
  const zap = zapped > 0 && (time * 20 | 0) % 2 === 0;
  if (zap) return part === 'skin' ? '#fffbe0' : '#1a1a1a';
  return char > 0 ? mix(base, '#2a1d15', char * .75) : base;
}
function limb(k) {
  const [a, b, w, part] = LIMBS[k], A = P[a], B = P[b];
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = w * U + 5;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  ctx.strokeStyle = col(part); ctx.lineWidth = w * U;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
}
function ball(p, r, c) {
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, 7); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
}
function drawDecals(filter) {
  for (const d of decals) {
    if (!filter(d.f)) continue;
    const fr = frame(d.f), [x, y] = toWorld(fr, d.lx, d.ly);
    ctx.save(); ctx.translate(x, y); ctx.rotate(fr.ang + d.rot); ctx.scale(d.size, d.size);
    const s = U / 60;
    switch (d.kind) {
      case 'hole':
        ctx.fillStyle = '#8b0f1f'; ctx.beginPath(); ctx.arc(0, 0, 6 * s, 0, 7); ctx.fill();
        ctx.fillStyle = '#2a0005'; ctx.beginPath(); ctx.arc(0, 0, 3.5 * s, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(160,15,30,.8)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(0, 3 * s); ctx.lineTo(1 * s, 12 * s); ctx.stroke();
        break;
      case 'cut':
        ctx.strokeStyle = '#8b0f1f'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -10 * s); ctx.lineTo(0, 10 * s); ctx.stroke();
        ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 1.5 * s; ctx.stroke();
        break;
      case 'bruise':
        ctx.fillStyle = 'rgba(110,40,140,.35)'; ctx.beginPath(); ctx.arc(0, 0, 11 * s, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(80,20,110,.3)'; ctx.beginPath(); ctx.arc(1 * s, -1 * s, 6 * s, 0, 7); ctx.fill();
        break;
      case 'soot':
        ctx.fillStyle = 'rgba(20,15,10,.45)'; ctx.beginPath(); ctx.ellipse(0, 0, 16 * s, 11 * s, 0, 0, 7); ctx.fill();
        break;
    }
    ctx.restore();
  }
}
function drawBuddy() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs
  for (let k = 4; k < 8; k++) limb(k);
  ball(P[12], U * .2, col('shoe')); ball(P[13], U * .2, col('shoe'));
  drawDecals(f => f >= 6);
  // torso
  const q = [P[2], P[3], P[5], P[4]];
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = U * .5 + 5; ctx.fillStyle = col('shirt');
  const tp = () => { ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
  tp(); ctx.stroke(); ctx.fill();
  ctx.strokeStyle = col('shirt'); ctx.lineWidth = U * .5; tp(); ctx.stroke();
  // belt
  ctx.strokeStyle = col('pants'); ctx.lineWidth = U * .32;
  ctx.beginPath(); ctx.moveTo(P[4].x, P[4].y); ctx.lineTo(P[5].x, P[5].y); ctx.stroke();
  // shirt name
  const tf = frame(1);
  ctx.save(); ctx.translate(tf.ox, tf.oy); ctx.rotate(tf.ang);
  ctx.font = `900 ${Math.round(U * .28)}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(buddyName.toUpperCase().slice(0, 8), 0, -U * .15, U * .95);
  ctx.restore();
  drawDecals(f => f === 1);
  // arms
  for (let k = 0; k < 4; k++) limb(k);
  ball(P[8], U * .17, col('skin')); ball(P[9], U * .17, col('skin'));
  drawDecals(f => f >= 2 && f <= 5);
  // neck
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = U * .22 + 5;
  ctx.beginPath(); ctx.moveTo(P[1].x, P[1].y); ctx.lineTo(P[0].x, P[0].y); ctx.stroke();
  ctx.strokeStyle = col('skin'); ctx.lineWidth = U * .22; ctx.stroke();
  drawHead();
}
function drawHead() {
  const h = P[0], fr = frame(0), R = RAD[0] * U;
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(fr.ang);
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, R + 3, 0, 7); ctx.fill();
  if (faceImg) {
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
    ctx.drawImage(faceImg, -R, -R, R * 2, R * 2);
    if (zapped > 0 && (time * 20 | 0) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,220,.7)'; ctx.fillRect(-R, -R, R * 2, R * 2); }
    ctx.fillStyle = `rgba(200,0,20,${pain / 250})`; ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.fillStyle = `rgba(30,20,10,${char * .7})`; ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = col('skin'); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    // hair
    ctx.fillStyle = col('hair');
    ctx.beginPath(); ctx.arc(0, 0, R, Math.PI * 1.05, Math.PI * 1.95); ctx.quadraticCurveTo(R * .3, -R * .55, -R * .95, -R * .25); ctx.fill();
    // ears
    ctx.fillStyle = col('skin');
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * R * .98, R * .05, R * .14, R * .2, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.stroke(); }
    drawFace(R);
  }
  ctx.restore();
  drawDecals(f => f === 0);
  // dizzy stars
  if (pain > 70 || zapped > 0) {
    for (let i = 0; i < 3; i++) {
      const a = time * 4 + i * 2.1;
      ctx.font = `${U * .3}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⭐', h.x + Math.cos(a) * R * 1.2, h.y - R * 1.1 + Math.sin(a) * R * .3);
    }
  }
}
function drawFace(R) {
  ctx.strokeStyle = '#1a1a1a'; ctx.fillStyle = '#1a1a1a'; ctx.lineCap = 'round';
  const ex = R * .36, ey = -R * .02, lw = Math.max(2, R * .09);
  ctx.lineWidth = lw;
  const dizzy = pain > 70 || (zapped > 0 && (time * 10 | 0) % 2);
  // look toward pointer
  const fr = frame(0);
  let lx = pointer.x - P[0].x, ly = pointer.y - P[0].y; const ld = Math.hypot(lx, ly) || 1;
  const c = Math.cos(-fr.ang), s = Math.sin(-fr.ang);
  const rx = (lx * c - ly * s) / ld, ry = (lx * s + ly * c) / ld;
  if (dizzy) {
    for (const sx of [-1, 1]) {
      const x = sx * ex, e = R * .13;
      ctx.beginPath(); ctx.moveTo(x - e, ey - e); ctx.lineTo(x + e, ey + e); ctx.moveTo(x + e, ey - e); ctx.lineTo(x - e, ey + e); ctx.stroke();
    }
  } else if (pain > 40) {
    for (const sx of [-1, 1]) {
      const x = sx * ex, e = R * .13;
      ctx.beginPath(); ctx.moveTo(x - sx * e, ey - e); ctx.lineTo(x + sx * e, ey); ctx.lineTo(x - sx * e, ey + e); ctx.stroke();
    }
  } else {
    for (const sx of [-1, 1]) {
      const x = sx * ex;
      if (blink > 0) { ctx.beginPath(); ctx.moveTo(x - R * .12, ey); ctx.lineTo(x + R * .12, ey); ctx.stroke(); continue; }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, ey, R * .16, R * .2, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(x + rx * R * .06, ey + ry * R * .08, R * .08, 0, 7); ctx.fill();
      if (pain > 12) { // worried brows
        ctx.beginPath(); ctx.moveTo(x - sx * R * .18, ey - R * .22); ctx.lineTo(x + sx * R * .14, ey - R * .34); ctx.stroke();
      }
    }
  }
  // cheeks / tears
  if (pain > 40) {
    ctx.fillStyle = 'rgba(80,170,255,.85)';
    for (const sx of [-1, 1]) { const ty = ey + R * .2 + ((time * 60 + sx * 20) % 30) / 30 * R * .4; ctx.beginPath(); ctx.arc(sx * ex, ty, R * .06, 0, 7); ctx.fill(); }
  } else if (pain < 12) {
    ctx.fillStyle = 'rgba(255,90,110,.3)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * R * .55, R * .25, R * .12, 0, 7); ctx.fill(); }
  }
  // mouth
  const my = R * .42;
  ctx.fillStyle = '#6b1020';
  if (dizzy) {
    ctx.beginPath(); ctx.moveTo(-R * .3, my);
    for (let i = 1; i <= 6; i++) ctx.lineTo(-R * .3 + i * R * .1, my + (i % 2 ? -1 : 1) * R * .07);
    ctx.stroke();
  } else if (pain > 40) {
    ctx.beginPath(); ctx.ellipse(0, my, R * .2, R * .17 + Math.sin(time * 30) * R * .02, 0, 0, 7); ctx.fill(); ctx.stroke();
  } else if (pain > 12) {
    ctx.beginPath(); ctx.moveTo(-R * .2, my + R * .03); ctx.quadraticCurveTo(0, my - R * .08, R * .2, my + R * .03); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(0, my - R * .15, R * .28, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
  }
}
function drawProp(q) {
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.ang);
  const r = q.r;
  ctx.lineWidth = 3; ctx.strokeStyle = '#111';
  if (q.type === 'ball') {
    const g = ctx.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
    g.addColorStop(0, '#4b6cff'); g.addColorStop(1, '#10206b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#050a25';
    for (const [x, y] of [[-.2, -.35], [.15, -.4], [0, -.12]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * .1, 0, 7); ctx.fill(); }
  } else if (q.type === 'bomb') {
    const hot = q.fuse < .8 && (q.fuse * 10 | 0) % 2 === 0;
    ctx.strokeStyle = '#8a6d3b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(r * .5, -r * .7); ctx.quadraticCurveTo(r * .9, -r * 1.3, r * .7, -r * 1.4); ctx.stroke();
    ctx.fillStyle = '#444'; ctx.fillRect(r * .25, -r * 1.0, r * .5, r * .4);
    ctx.fillStyle = hot ? '#e63946' : '#222'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(-r * .35, -r * .35, r * .22, 0, 7); ctx.fill();
  } else if (q.type === 'anvil') {
    ctx.fillStyle = '#5c6570';
    ctx.beginPath();
    ctx.moveTo(-r * 1.4, -r * .7); ctx.lineTo(r * 1.1, -r * .7); ctx.quadraticCurveTo(r * 1.1, -r * .1, r * .45, -r * .1);
    ctx.lineTo(r * .35, r * .45); ctx.lineTo(r * .8, r * .9); ctx.lineTo(-r * .8, r * .9); ctx.lineTo(-r * .35, r * .45);
    ctx.lineTo(-r * .45, -r * .1); ctx.quadraticCurveTo(-r * 1.1, -r * .2, -r * 1.4, -r * .7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-r * 1.2, -r * .65, r * 2.1, r * .12);
  }
  ctx.restore();
}
function drawBubble() {
  if (!bubble) return;
  const h = P[0], R = RAD[0] * U;
  ctx.font = `800 ${Math.max(14, U * .26)}px "Trebuchet MS", sans-serif`;
  const tw = ctx.measureText(bubble.text).width + 24, th = Math.max(14, U * .26) + 18;
  let x = clamp(h.x - tw / 2, 6, W - tw - 6), y = Math.max(60, h.y - R - th - 24);
  ctx.globalAlpha = clamp(bubble.t * 3, 0, 1);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, y, tw, th, 12); ctx.fill(); ctx.stroke();
  const tx = clamp(h.x, x + 14, x + tw - 14);
  ctx.beginPath(); ctx.moveTo(tx - 8, y + th - 1); ctx.lineTo(tx, y + th + 12); ctx.lineTo(tx + 8, y + th - 1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(tx - 8, y + th); ctx.lineTo(tx, y + th + 12); ctx.lineTo(tx + 8, y + th); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(bubble.text, x + tw / 2, y + th / 2 + 1);
  ctx.globalAlpha = 1;
}

// ---------- UI ----------
let toastT = 0;
function toast(msg, ms = 1800) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function buildTools() {
  const box = $('tools'); box.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('div');
    b.className = 'tool'; b.dataset.id = t.id;
    b.innerHTML = `<div class="ic">${t.icon}</div><div>${t.name}</div>` + (t.price ? `<div class="price">$${t.price}</div>` : '');
    b.addEventListener('click', () => selectTool(t));
    box.appendChild(b);
  }
  refreshTools();
}
function refreshTools() {
  for (const el of document.querySelectorAll('.tool')) {
    const t = TOOLS.find(x => x.id === el.dataset.id), owned = unlocked.has(t.id);
    el.classList.toggle('locked', !owned);
    el.classList.toggle('active', t.id === tool);
    const pr = el.querySelector('.price'); if (pr) pr.style.display = owned ? 'none' : '';
  }
  refreshAffordable();
}
function refreshAffordable() {
  for (const el of document.querySelectorAll('.tool')) {
    const t = TOOLS.find(x => x.id === el.dataset.id);
    el.classList.toggle('affordable', !unlocked.has(t.id) && bucks >= t.price);
  }
}
function selectTool(t) {
  initAudio();
  if (!unlocked.has(t.id)) {
    if (bucks < t.price) { sfx('deny'); toast(`Need $${t.price} for the ${t.name}. Keep hitting ${buddyName}!`); return; }
    bucks -= t.price; unlocked.add(t.id);
    store.set('unlocked', [...unlocked]); store.set('bucks', bucks);
    $('bucksVal').textContent = bucks;
    sfx('buy'); toast(`Unlocked the ${t.name}! ${t.icon}`);
  }
  tool = t.id;
  refreshTools();
}
function setName(n) {
  buddyName = (n || 'Arham').trim().slice(0, 16) || 'Arham';
  $('nameLabel').textContent = buddyName;
  document.title = `Kick The ${buddyName}`;
  store.set('name', buddyName);
}
function loadFace(src) {
  if (!src) { faceImg = null; $('btnNoFace').hidden = true; return; }
  const img = new Image();
  img.onload = () => { faceImg = img; $('btnNoFace').hidden = false; };
  img.src = src;
}
$('btnName').onclick = () => { $('nameField').value = buddyName; $('nameBox').hidden = false; $('nameField').focus(); $('nameField').select(); };
$('nameCancel').onclick = () => { $('nameBox').hidden = true; };
$('nameBox').onsubmit = e => { e.preventDefault(); setName($('nameField').value); $('nameBox').hidden = true; };
$('btnFace').onclick = () => $('faceInput').click();
$('faceInput').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const m = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
    const url = c.toDataURL('image/jpeg', .85);
    store.set('face', url); loadFace(url); URL.revokeObjectURL(img.src);
    toast('New face applied! 😈');
  };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
};
$('btnNoFace').onclick = () => { store.set('face', null); loadFace(null); };
$('btnMute').onclick = () => { muted = !muted; store.set('muted', muted); $('btnMute').textContent = muted ? '🔇' : '🔊'; initAudio(); };
$('btnClear').onclick = () => { props = []; decals = []; floorStains = []; wallMarks = []; parts = []; grab = null; };
$('btnReset').onclick = () => {
  buildBuddy(W / 2); decals = []; props = []; parts = []; floorStains = []; wallMarks = [];
  pain = 0; char = 0; onFire = 0; zapped = 0; stand = 1; grab = null;
  say('up', true);
};

// ---------- boot ----------
window.addEventListener('resize', resize);
$('bucksVal').textContent = bucks;
$('btnMute').textContent = muted ? '🔇' : '🔊';
setName(buddyName);
loadFace(store.get('face', null));
buildTools();
resize();
setTimeout(() => toast(`Grab, fling & wreck ${buddyName} to earn 💰 and unlock weapons!`, 3500), 300);

let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(.1, (now - last) / 1000); last = now;
  const DT = 1 / 60;
  while (acc >= DT) { step(DT); acc -= DT; }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug/testing hook
window.KTA = { get P() { return P; }, get props() { return props; }, step, addBucks, explode, get pain() { return pain; } };
