'use strict';
/* Kick The Arham — a Kick the Buddy style stress-relief game.
   Verlet ragdoll physics, weapons, bucks, unlocks, and Boodie. No dependencies. */

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
let earnFrac = 0, idleTimer = 0;
// Pain meter: fills slowly with damage to Arham; when full, bucks are doubled while it drains.
const EARN_RATE = .06, METER_RATE = .1, BONUS_TIME = 30;
let painMeter = store.get('meter', 0), bonusT = store.get('bonusT', 0), meterSaveT = 0;
let shake = 0, flash = 0, flashColor = '#fff', time = 0;
let props = [], parts = [], floorStains = [], wallMarks = [], bolts = [], fists = [];
let arham = null, boodie = null;
const bodies = () => boodie ? [arham, boodie] : [arham];
const boodieActive = () => !!boodie && !boodie.ko;

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
  { id: 'boodie', name: 'Boodie', icon: '👱‍♀️', price: 1500, spawn: true },
];

// ---------- ragdoll definition (units of u, relative to feet on floor) ----------
// 0 head,1 neck,2 shL,3 shR,4 hipL,5 hipR,6 elbL,7 elbR,8 handL,9 handR,10 kneeL,11 kneeR,12 footL,13 footR
const POSE = [[0, -4.1], [0, -3.45], [-.6, -3.3], [.6, -3.3], [-.4, -1.9], [.4, -1.9], [-.8, -2.5], [.8, -2.5],
  [-.95, -1.75], [.95, -1.75], [-.42, -.98], [.42, -.98], [-.45, -.2], [.45, -.2]];
const RAD = [.55, .15, .18, .18, .2, .2, .16, .16, .17, .17, .2, .2, .2, .2];
const MASS = [1.4, 1, 1.5, 1.5, 1.6, 1.6, .7, .7, .5, .5, .9, .9, .8, .8];
const LINKS = [[0, 1, 1], [1, 2, 1], [1, 3, 1], [2, 3, 1], [2, 4, 1], [3, 5, 1], [4, 5, 1], [2, 5, 1], [3, 4, 1],
  [2, 6, 1], [6, 8, 1], [3, 7, 1], [7, 9, 1], [4, 10, 1], [10, 12, 1], [5, 11, 1], [11, 13, 1], [0, 2, .35], [0, 3, .35]];
// limbs: a, b, thickness(u), part  -> frames 2..9
const LIMBS = [[2, 6, .36, 'shirt'], [6, 8, .3, 'skin'], [3, 7, .36, 'shirt'], [7, 9, .3, 'skin'],
  [4, 10, .46, 'pants'], [10, 12, .4, 'pants'], [5, 11, .46, 'pants'], [11, 13, .4, 'pants']];
const LOOKS = {
  arham: { scale: 1, colors: { skin: '#f2c29b', shirt: '#ff5d73', pants: '#34507a', shoe: '#222831', hair: '#2b1a10' } },
  boodie: { scale: .92, colors: { skin: '#f8d3b4', shirt: '#2ec4b6', pants: '#7b4fa8', shoe: '#e0457b', hair: '#f6cf57' } },
};
let grab = null; // {type:'pt'|'prop', ref, B}
const pointer = { x: 0, y: 0, down: false, lx: 0, ly: 0 };

function makeBody(kind, cx) {
  const look = LOOKS[kind], u = U * look.scale;
  const B = {
    kind, u, colors: look.colors, decals: [], pain: 0, char: 0, onFire: 0, zapped: 0, stand: 1, sinceHurt: 10,
    bubble: null, voiceCd: 0, blink: 0, ko: false, thrownT: 0, targets: null,
    ai: { x: cx, side: 1, cd: 1, phase: 0, atk: null },
  };
  B.P = POSE.map((q, i) => {
    const x = cx + q[0] * u, y = FLOOR + q[1] * u;
    return { x, y, px: x, py: y, r: RAD[i] * u, m: MASS[i], hitCd: 0 };
  });
  B.C = LINKS.map(([a, b, k]) => ({ a, b, k, len: Math.hypot(B.P[a].x - B.P[b].x, B.P[a].y - B.P[b].y) }));
  return B;
}
const bodyName = B => B.kind === 'arham' ? buddyName : 'Boodie';

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
  if (!arham || Math.abs(oldU - U) > 1) {
    arham = makeBody('arham', W / 2);
    if (boodie) { const ko = boodie.ko; boodie = makeBody('boodie', clamp(boodie.ai.x, U, W - U)); if (ko) { boodie.ko = true; boodie.stand = 0; } }
  } else for (const B of bodies()) for (const p of B.P) { p.x = clamp(p.x, p.r, W - p.r); p.px = p.x; }
}

function buildBg() {
  bg = document.createElement('canvas');
  bg.width = W * DPR; bg.height = H * DPR;
  const b = bg.getContext('2d');
  b.scale(DPR, DPR);
  const g = b.createLinearGradient(0, 0, 0, FLOOR);
  g.addColorStop(0, '#5b4b8a'); g.addColorStop(1, '#8e7cc3');
  b.fillStyle = g; b.fillRect(0, 0, W, FLOOR);
  b.fillStyle = 'rgba(255,255,255,.05)';
  for (let x = 0; x < W; x += 60) b.fillRect(x, 0, 30, FLOOR);
  b.fillStyle = 'rgba(255,255,255,.06)';
  for (let y = 30; y < FLOOR - 40; y += 70) for (let x = (y / 70 % 2) * 30 + 15; x < W; x += 60) {
    b.beginPath(); b.arc(x, y, 5, 0, 7); b.fill();
  }
  b.fillStyle = '#3d2f63'; b.fillRect(0, FLOOR - 22, W, 22);
  b.fillStyle = 'rgba(255,255,255,.12)'; b.fillRect(0, FLOOR - 22, W, 3);
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
  const s = clamp(strength, .2, 1.8);
  switch (kind) {
    case 'thud': tone(140, 45, .18, 'sine', .5 * s); noise(.08, .25 * s, 500); break;
    case 'punch': tone(180, 50, .15, 'sine', .7); noise(.1, .5, 1200); break;
    case 'slap': noise(.07, .7, 3500, 'highpass'); tone(900, 400, .05, 'triangle', .2); break;
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
      const base = rand(380, 620) * s;
      tone(base, base * rand(1.2, 1.8), .09, 'square', .09);
      tone(base * 1.3, base * .7, .14, 'square', .08, .09);
      break;
    }
    case 'pop': tone(600, 1200, .08, 'sine', .25); break;
    case 'spawn': [392, 523, 659, 784].forEach((f, i) => tone(f, f * 1.02, .12, 'triangle', .15, i * .06)); noise(.3, .3, 1500); break;
  }
}

// ---------- speech ----------
const LINES = {
  arham: {
    hurt: ['Ow!', 'Ouch!', 'Hey!', 'Not the face!', 'Why?!', 'Oof!', 'That hurts!', 'Stop it!', 'Mommy!', "I'm telling!", 'Rude!', 'Ahh!', 'My spleen!', 'Yikes!'],
    boom: ['KABOOM?!', 'My ears!!', 'Who did that?!', "I'm seeing stars..."],
    fire: ['Hot hot hot!', "I'm toast!", 'Water! WATER!', 'Crispy...'],
    zap: ['BZZZT!', 'I can taste colors!', 'Shocking!'],
    grab: ['Put me down!', 'Wheee!', 'Whoa!', 'Careful!', "I'm flying!"],
    idle: ['Is that all you got?', "I'm bored...", 'Come on, hit me!', '{n} is invincible!', 'Hello? Anyone there?', '*yawn*', "You can't hurt me!", 'Nice room, huh?'],
    up: ['Ha! Still standing!', "Can't keep me down!", 'That tickled.', "I'm fine. Totally fine."],
    boodie: ['Boodie, NO!', 'Not you again!', 'Why are you like this?!', 'Truce? TRUCE?!', 'Ow! Boodie!'],
  },
  boodie: {
    spawn: ["Boodie's here!", 'Hiii {n}!', 'Time for a beatdown!', 'Did someone call Boodie?'],
    attack: ['Take that!', 'Hi-yah!', 'Boodie smash!', 'Stay down!', 'Ha!', 'Eat this!', 'Too slow!', 'Hehe!'],
    ko: ['Owie!!', 'Not fair!', 'Hey! Rude!', 'I was winning!', 'Boodie down...'],
  },
};
function say(B, kind, force) {
  if (!force && (B.voiceCd > 0 || Math.random() > .55)) return;
  const set = LINES[B.kind][kind]; if (!set) return;
  B.bubble = { text: pick(set).replace('{n}', buddyName), t: 2.2 };
  B.voiceCd = 1.4;
  sfx('voice', B.kind === 'boodie' ? 1.6 : 1);
}

// ---------- damage / money ----------
function hurt(B, amount, kind = 'hurt') {
  B.pain = Math.min(100, B.pain + amount);
  B.sinceHurt = 0;
  if (B.kind === 'boodie') { koBoodie(B); return; }
  idleTimer = 0;
  earnFrac += amount * EARN_RATE * (bonusT > 0 ? 2 : 1);
  if (bonusT <= 0) {
    painMeter = Math.min(100, painMeter + amount * METER_RATE);
    if (painMeter >= 100) startBonus();
  }
  if (earnFrac >= 1) { const n = Math.floor(earnFrac); earnFrac -= n; addBucks(n); }
  if (amount > 1.5) say(B, kind);
}
function startBonus() {
  bonusT = BONUS_TIME; painMeter = 100;
  sfx('buy'); toast(`Pain meter full! 2X bucks for ${BONUS_TIME} seconds! 💰💰`, 2500);
  popText(W / 2, FLOOR * .35, '2X BUCKS!', '#ffd84d', 56);
}
function updateMeter(dt) {
  if (bonusT > 0) {
    bonusT = Math.max(0, bonusT - dt);
    painMeter = 100 * bonusT / BONUS_TIME;
  }
  $('meterFill').style.width = painMeter.toFixed(1) + '%';
  const on = bonusT > 0, m = $('meter');
  if (m.classList.contains('bonus') !== on) { m.classList.toggle('bonus', on); $('meterTag').textContent = on ? '2X' : '1X'; }
  if ((meterSaveT -= dt) <= 0) { meterSaveT = 2; store.set('meter', painMeter); store.set('bonusT', bonusT); }
}
function koBoodie(B) {
  if (B.ko) return;
  B.ko = true; B.stand = 0; B.ai.atk = null; B.pain = 100;
  B.voiceCd = 0; say(B, 'ko', true);
  popText(B.P[0].x, B.P[0].y - B.u, 'K.O.!', '#ff5d73', 44);
  refreshTools();
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
function knock(B, k = 0) { B.stand = Math.min(B.stand, k); }

// ---------- geometry / frames ----------
function frame(B, f) {
  const P = B.P;
  let ox, oy, ax, ay;
  if (f === 0) { const h = P[0], n = P[1]; ox = h.x; oy = h.y; ax = h.x - n.x; ay = h.y - n.y; }
  else if (f === 1) {
    const sx = (P[2].x + P[3].x) / 2, sy = (P[2].y + P[3].y) / 2, hx = (P[4].x + P[5].x) / 2, hy = (P[4].y + P[5].y) / 2;
    ox = (sx + hx) / 2; oy = (sy + hy) / 2; ax = sx - hx; ay = sy - hy;
  } else { const L = LIMBS[f - 2], a = P[L[0]], b = P[L[1]]; ox = a.x; oy = a.y; ax = b.x - a.x; ay = b.y - a.y; }
  const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
  return { ox, oy, ax, ay, len: l, ang: Math.atan2(ax, -ay), u: B.u };
}
function toWorld(fr, lx, ly) { return [fr.ox + (fr.ax * lx - fr.ay * ly) * fr.u, fr.oy + (fr.ay * lx + fr.ax * ly) * fr.u]; }
function toLocal(fr, x, y) { const dx = x - fr.ox, dy = y - fr.oy; return [(dx * fr.ax + dy * fr.ay) / fr.u, (-dx * fr.ay + dy * fr.ax) / fr.u]; }
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
function hitTest(B, x, y, tol = .12) {
  const P = B.P, u = B.u;
  if (Math.hypot(x - P[0].x, y - P[0].y) < (RAD[0] + tol) * u) return { B, f: 0, i: 0 };
  const test = k => {
    const L = LIMBS[k], [d, t] = segDist(x, y, P[L[0]], P[L[1]]);
    return d < (L[2] / 2 + tol) * u ? { B, f: k + 2, i: t < .5 ? L[0] : L[1] } : null;
  };
  for (let k = 0; k < 4; k++) { const h = test(k); if (h) return h; }
  const quad = [P[2], P[3], P[5], P[4]];
  let near = inPoly(x, y, quad);
  if (!near) for (let i = 0; i < 4; i++) if (segDist(x, y, quad[i], quad[(i + 1) % 4])[0] < (.22 + tol) * u) { near = true; break; }
  if (near) {
    let best = 1, bd = 1e9;
    for (let i = 1; i <= 5; i++) { const d = Math.hypot(x - P[i].x, y - P[i].y); if (d < bd) { bd = d; best = i; } }
    return { B, f: 1, i: best };
  }
  for (let k = 4; k < 8; k++) { const h = test(k); if (h) return h; }
  return null;
}
// topmost body first (Boodie is drawn over Arham)
function hitAny(x, y, tol) {
  const bs = bodies();
  for (let i = bs.length - 1; i >= 0; i--) { const h = hitTest(bs[i], x, y, tol); if (h) return h; }
  return null;
}
function addDecal(B, f, x, y, kind, rot = 0, size = 1) {
  const fr = frame(B, f);
  let [lx, ly] = toLocal(fr, x, y);
  if (f === 0) { const d = Math.hypot(lx, ly), m = RAD[0] * .8; if (d > m) { lx *= m / d; ly *= m / d; } }
  else if (f >= 2) { const L = LIMBS[f - 2]; lx = clamp(lx, 0, fr.len / fr.u); ly = clamp(ly, -L[2] * .3, L[2] * .3); }
  else { lx = clamp(lx, -.65, .65); ly = clamp(ly, -.5, .5); }
  B.decals.push({ f, lx, ly, kind, rot, size });
  if (B.decals.length > 160) B.decals.shift();
}
function addVel(o, vx, vy) { o.px -= vx; o.py -= vy; }
function bodyCenter(B) { const P = B.P; return [(P[2].x + P[3].x + P[4].x + P[5].x) / 4, (P[2].y + P[3].y + P[4].y + P[5].y) / 4]; }
function kickNeighbors(B, i, vx, vy) {
  for (const c of B.C) {
    const o = c.a === i ? B.P[c.b] : c.b === i ? B.P[c.a] : null;
    if (o) addVel(o, vx, vy);
  }
}

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
  for (const B of bodies()) {
    let dmg = 0;
    for (const p of B.P) {
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < R) {
        const f = (1 - d / R) * power;
        addVel(p, dx / d * f, dy / d * f - f * .4);
        dmg += (1 - d / R) * 6;
      }
    }
    if (dmg <= 0) continue;
    hurt(B, dmg, 'boom'); knock(B, 0); B.char = Math.min(1, B.char + dmg / 200);
    for (let i = 0; i < 5; i++) {
      const p = B.P[(Math.random() * 14) | 0];
      if (Math.hypot(p.x - x, p.y - y) < R * .7) { const h = hitTest(B, p.x, p.y, .05); if (h) addDecal(B, h.f, p.x, p.y, 'soot', rand(0, 6), rand(.8, 1.5)); }
    }
    const [bx, by] = bodyCenter(B); blood(bx, by, 14, 1.6);
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
  const h = hitAny(x, y, .2);
  let tx = x, ty = FLOOR;
  if (h) { tx = h.B.P[h.i].x; ty = h.B.P[h.i].y; }
  const pts = [[tx + rand(-80, 80), 0]], steps = 14;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    pts.push([pts[0][0] + (tx - pts[0][0]) * t + rand(-30, 30), ty * t]);
  }
  pts.push([tx, ty]);
  bolts.push({ pts, life: .35 });
  sfx('zap'); flash = 1; flashColor = '#dff4ff'; shake = Math.max(shake, 14);
  sparks(tx, ty, 30, '#bfe9ff');
  if (h) {
    const B = h.B;
    B.zapped = 1.2; knock(B, 0); hurt(B, 25, 'zap'); B.char = Math.min(1, B.char + .18);
    addDecal(B, h.f, tx, ty, 'soot', rand(0, 6), 1.6);
    for (const p of B.P) addVel(p, rand(-1, 1) * B.u * .25, rand(-1, .3) * B.u * .25);
  } else {
    wallMarks.push({ x: tx, y: FLOOR - 4, r: 26, life: 20 });
  }
}

function doPunch(x, y) {
  const h = hitAny(x, y);
  fists.push({ x, y, t: .25 });
  if (!h) { sfx('whoosh'); return; }
  const B = h.B, [cx] = bodyCenter(B);
  const dx = x < cx ? 1 : -1, f = B.u * .45;
  addVel(B.P[h.i], dx * f * 1.2, -f * .35);
  kickNeighbors(B, h.i, dx * f * .5, -f * .15);
  knock(B, 0);
  sfx('punch'); shake = Math.max(shake, 6);
  hurt(B, 6);
  addDecal(B, h.f, x, y, 'bruise', 0, rand(.8, 1.2));
  popText(x, y - 10, pick(['POW!', 'BAM!', 'WHACK!', 'SMACK!']), '#fff', 30);
  sparks(x, y, 6, '#fff');
}

function doShoot(x, y) {
  sfx('gun'); shake = Math.max(shake, 5); flash = .15; flashColor = '#fff6d0';
  spawn('shell', x + 30, y - 10, rand(2, 5), rand(-7, -4), 3, 4, '#d4a017');
  const h = hitAny(x, y, .02);
  if (!h) {
    if (y < FLOOR) wallMarks.push({ x, y, r: 4, life: 25, hole: true });
    sparks(x, y, 8);
    return;
  }
  const B = h.B, p = B.P[h.i], [cx] = bodyCenter(B);
  addDecal(B, h.f, x, y, 'hole', rand(0, 6), 1);
  addVel(p, (p.x < cx ? -1 : 1) * rand(.1, .25) * B.u + rand(-3, 3), -B.u * .08);
  B.stand *= .3;
  blood(x, y, 10, 1.2);
  hurt(B, 9);
}

const lastSliceT = new Map();
function doSlice(x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 4) return;
  const n = Math.ceil(len / 8), ang = Math.atan2(y1 - y0, x1 - x0);
  for (let s = 0; s <= n; s++) {
    const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
    const h = hitAny(x, y, 0);
    if (!h) continue;
    const key = h.B.kind + h.f, now = performance.now();
    if (now - (lastSliceT.get(key) || 0) < 90) continue;
    lastSliceT.set(key, now);
    const B = h.B, fr = frame(B, h.f);
    addDecal(B, h.f, x, y, 'cut', ang - fr.ang + Math.PI / 2, clamp(len / 40, .6, 1.4));
    blood(x, y, 6, .8);
    sfx('slash');
    addVel(B.P[h.i], (x1 - x0) * .08, (y1 - y0) * .08);
    B.stand = Math.max(0, B.stand - .08);
    hurt(B, 3.5);
  }
}

function doFire(dt) {
  const x = pointer.x, y = pointer.y;
  for (let i = 0; i < 3; i++) spawn('flame', x + rand(-8, 8), y + rand(-8, 8), rand(-1.2, 1.2), rand(-3.5, -1.5), rand(.4, .8), rand(10, 18), '#ff9f1c');
  sfx('crackle');
  for (const B of bodies()) {
    if (!B.P.some(p => Math.hypot(p.x - x, p.y - y) < p.r + B.u * .5)) continue;
    B.onFire = Math.max(B.onFire, 2.5);
    B.char = Math.min(1, B.char + dt * .12);
    if (B.kind === 'boodie') hurt(B, 1, 'fire');
  }
}

// ---------- Boodie ----------
function spawnBoodie() {
  const [ax] = bodyCenter(arham);
  const x = ax < W / 2 ? W - U * 1.3 : U * 1.3;
  boodie = makeBody('boodie', x);
  boodie.ai.side = ax > x ? 1 : -1;
  boodie.ai.cd = .8;
  for (let i = 0; i < 24; i++) spawn('smoke', x + rand(-U, U), FLOOR - rand(0, U * 4), rand(-2, 2), rand(-2, 0), rand(.6, 1.2), rand(15, 30), '#fff');
  sparks(x, FLOOR - U * 2, 20, '#ffd1e8');
  sfx('spawn');
  say(boodie, 'spawn', true);
  setTimeout(() => arham && boodieActive() && say(arham, 'boodie', true), 900);
  refreshTools();
}

// Each attack: which joints move, what they aim at on Arham, damage and knockback.
const ATTACKS = {
  jab: { dur: .42, limb: 'arm', near: true, aim: 'head', dmg: 6, push: .42, snd: 'punch', words: ['POW!', 'JAB!'] },
  cross: { dur: .45, limb: 'arm', near: false, aim: 'chest', dmg: 7, push: .45, snd: 'punch', words: ['BAM!', 'WHAM!'] },
  slap: { dur: .38, limb: 'arm', near: true, aim: 'head', dmg: 4, push: .3, snd: 'slap', words: ['SLAP!', 'THWACK!'] },
  kick: { dur: .6, limb: 'leg', near: true, aim: 'chest', dmg: 9, push: .6, snd: 'punch', words: ['KICK!', 'WHAM!', 'OOF!'] },
  headbutt: { dur: .55, limb: 'head', aim: 'head', dmg: 8, push: .45, snd: 'punch', words: ['BONK!', 'CRACK!'] },
  stomp: { dur: .7, limb: 'leg', near: true, aim: 'chest', dmg: 10, push: .35, snd: 'punch', words: ['STOMP!', 'CRUNCH!'] },
};
function attackJoints(side, a) {
  const r = side > 0; // limb on Arham's side
  if (a.limb === 'head') return { root: 1, mid: 1, end: 0 };
  if (a.limb === 'leg') return r === a.near ? { root: 5, mid: 11, end: 13 } : { root: 4, mid: 10, end: 12 };
  return r === a.near ? { root: 3, mid: 7, end: 9 } : { root: 2, mid: 6, end: 8 };
}
function aimPoint(type) {
  const A = arham.P;
  if (type === 'head') return [A[0].x, A[0].y];
  return bodyCenter(arham);
}
function boodieAI(B, dt) {
  const ai = B.ai, u = B.u;
  const [ax] = bodyCenter(arham);
  const aDown = arham.stand < .5 || arham.P[0].y > FLOOR - u * 2.5;
  if (!ai.atk && Math.abs(ax - ai.x) > 6) ai.side = ax > ai.x ? 1 : -1;
  const want = aDown ? u * 1.05 : u * 1.75;
  const goal = clamp(ax - ai.side * want, u * 1.2, W - u * 1.2);
  let moving = false;
  if (!ai.atk) {
    const d = goal - ai.x;
    if (Math.abs(d) > u * .12) { ai.x += clamp(d, -u * .04, u * .04); moving = true; }
  }
  if (moving) ai.phase += dt * 11; else ai.phase *= .9;
  ai.cd -= dt;

  const T = POSE.map((q, i) => [ai.x + q[0] * u, FLOOR + q[1] * u, i >= 12 ? .2 : i <= 5 ? .15 : i >= 10 ? .12 : .03]);
  // fighting stance: fists up
  const s = ai.side;
  T[8] = [ai.x + (s * .35 - .25) * u, FLOOR - 3.0 * u, .06]; T[9] = [ai.x + (s * .35 + .25) * u, FLOOR - 3.0 * u, .06];
  T[6] = [ai.x - .75 * u, FLOOR - 2.6 * u, .04]; T[7] = [ai.x + .75 * u, FLOOR - 2.6 * u, .04];
  if (moving) {
    const w = Math.sin(ai.phase);
    T[12][0] += w * .32 * u; T[13][0] -= w * .32 * u;
    T[12][1] -= Math.max(0, w) * .35 * u; T[13][1] -= Math.max(0, -w) * .35 * u;
    T[10][0] += w * .18 * u; T[11][0] -= w * .18 * u;
    for (const i of [0, 1, 2, 3, 4, 5]) T[i][1] -= Math.abs(w) * .06 * u;
  }
  // start an attack when in range
  if (!ai.atk && ai.cd <= 0 && Math.abs(goal - ai.x) < u * .35) {
    const type = pick(aDown ? ['stomp', 'stomp', 'kick', 'jab'] : ['jab', 'cross', 'slap', 'kick', 'kick', 'headbutt']);
    ai.atk = { type, t: 0, hit: false, ...ATTACKS[type] };
    if (Math.random() < .35) say(B, 'attack');
  }
  if (ai.atk) {
    const a = ai.atk, j = attackJoints(s, a), p = a.t / a.dur;
    a.t += dt;
    const [tx, ty] = aimPoint(a.aim);
    const root = B.P[j.root];
    let ex, ey;
    if (p < .4) { // wind up
      if (a.type === 'stomp') { ex = tx; ey = ty - 1.6 * u; }
      else if (a.limb === 'leg') { ex = ai.x - s * .7 * u; ey = FLOOR - .7 * u; }
      else if (a.limb === 'head') { ex = ai.x - s * .5 * u; ey = FLOOR - 3.9 * u; }
      else { ex = root.x - s * .4 * u; ey = root.y + .2 * u; }
    } else if (p < .7) { // strike (overshoot through the target)
      ex = tx + s * .35 * u; ey = a.type === 'stomp' ? ty + .3 * u : ty;
      if (a.limb === 'head') { T[1] = [ai.x + s * .5 * u, FLOOR - 3.3 * u, .3]; }
    }
    if (ex !== undefined) {
      const k = p < .4 ? .25 : .45;
      T[j.end] = [ex, ey, k];
      if (j.mid !== j.end && j.mid !== j.root) T[j.mid] = [(root.x + ex) / 2, (root.y + ey) / 2 - .25 * u, k * .7];
      if (a.type === 'stomp' && p < .7) { // hop over him
        for (const i of [0, 1, 2, 3, 4, 5]) { T[i][1] -= .3 * u; T[i][2] = .2; }
      }
    }
    if (p >= .4 && p < .75 && !a.hit) {
      const E = B.P[j.end], h = hitTest(arham, E.x, E.y, .15);
      if (h) { a.hit = true; landBlow(B, h, E, a); }
    }
    if (p >= 1) { ai.atk = null; ai.cd = rand(.35, .9); }
  }
  B.targets = T;
}
function landBlow(B, h, E, a) {
  const A = arham, s = B.ai.side, f = A.u * a.push;
  const vy = a.type === 'stomp' ? f * .5 : -f * .35;
  addVel(A.P[h.i], s * f, vy);
  kickNeighbors(A, h.i, s * f * .5, vy * .5);
  knock(A, 0);
  hurt(A, a.dmg);
  if (Math.random() < .5) say(A, 'boodie');
  sfx(a.snd); shake = Math.max(shake, a.dmg * .8);
  addDecal(A, h.f, E.x, E.y, 'bruise', 0, rand(.8, 1.3));
  popText(E.x, E.y - 12, pick(a.words), '#ffd1e8', 30);
  sparks(E.x, E.y, 8, '#fff');
}

// ---------- input ----------
cv.addEventListener('pointerdown', e => {
  initAudio();
  cv.setPointerCapture(e.pointerId);
  const x = e.clientX, y = e.clientY;
  Object.assign(pointer, { x, y, lx: x, ly: y, down: true });
  switch (tool) {
    case 'hand': {
      for (let i = props.length - 1; i >= 0; i--) {
        const q = props[i];
        if (Math.hypot(q.x - x, q.y - y) < q.r + 8) { grab = { type: 'prop', ref: q }; return; }
      }
      const h = hitAny(x, y, .25);
      if (h) {
        grab = { type: 'pt', ref: h.B.P[h.i], B: h.B }; knock(h.B, 0); sfx('pop');
        if (h.B.kind === 'boodie') hurt(h.B, 1); else say(h.B, 'grab');
      }
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
  pointer.lx = pointer.x; pointer.ly = pointer.y;
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (pointer.down && tool === 'knife') doSlice(pointer.lx, pointer.ly, pointer.x, pointer.y);
});
function release() {
  if (grab && grab.B) grab.B.thrownT = 1.5;
  pointer.down = false; grab = null;
}
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());

// ---------- physics ----------
const ITER = 10;
function stepBody(B, dt, G) {
  const u = B.u, P = B.P, MAXV = u * .6;
  B.voiceCd -= dt; B.sinceHurt += dt; B.thrownT -= dt;
  if (!B.ko || B.kind === 'arham') B.pain = Math.max(0, B.pain - dt * (B.pain > 70 ? 6 : 10));
  B.zapped = Math.max(0, B.zapped - dt);
  if (B.bubble && (B.bubble.t -= dt) <= 0) B.bubble = null;
  B.blink -= dt; if (B.blink < -3.5 - Math.random() * 3) B.blink = .12;

  if (B.onFire > 0) {
    B.onFire -= dt;
    const p = P[(Math.random() * 14) | 0];
    spawn('flame', p.x + rand(-6, 6), p.y + rand(-6, 6), rand(-1, 1), rand(-3, -1), rand(.3, .7), rand(8, 16), '#ff9f1c');
    hurt(B, dt * 22, 'fire');
    if (Math.random() < .3) sfx('crackle');
    if (Math.random() < .02) say(B, 'fire');
    knock(B, 0);
  }
  if (B.zapped > 0) for (const p of P) addVel(p, rand(-1, 1) * u * .02, rand(-1, 1) * u * .02);

  B.targets = null;
  if (B.kind === 'boodie') {
    if (!B.ko) { B.stand = 1; boodieAI(B, dt); }
  } else {
    const wasDown = B.stand < .5;
    if (!(grab && grab.B === B) && B.sinceHurt > 1.3 && B.pain < 70 && B.onFire <= 0 && B.zapped <= 0) B.stand = Math.min(1, B.stand + dt * .6);
    if (wasDown && B.stand >= .5 && Math.random() < .5) say(B, 'up');
    if (B.stand > .01) {
      const cx = clamp((P[4].x + P[5].x) / 2, u * 1.2, W - u * 1.2), sway = Math.sin(time * 1.3) * u * .06;
      B.targets = POSE.map((q, i) => [cx + q[0] * u + (i <= 1 ? sway : 0), FLOOR + q[1] * u, i >= 12 ? .2 : i <= 5 ? .15 : i >= 10 ? .12 : .02]);
    }
  }

  // integrate (muscles counter gravity while standing)
  const g = G * (1 - .9 * B.stand * B.stand);
  for (const p of P) {
    let vx = (p.x - p.px) * .995, vy = (p.y - p.py) * .995;
    const v = Math.hypot(vx, vy); if (v > MAXV) { vx *= MAXV / v; vy *= MAXV / v; }
    p.px = p.x; p.py = p.y;
    p.x += vx; p.y += vy + g;
    p.hitCd -= dt;
  }
  // balance "puppet strings"
  if (B.targets && B.stand > .01) {
    const s = B.stand * B.stand;
    for (let i = 0; i < 14; i++) {
      const [tx, ty, kk] = B.targets[i], k = kk * s, p = P[i];
      const dx = (tx - p.x) * k, dy = (ty - p.y) * k;
      p.x += dx; p.y += dy; p.px += dx * .85; p.py += dy * .85;
      p.px += (p.x - p.px) * .08 * s; // damp sideways drift
    }
  }
}
function solveBody(B, it) {
  const P = B.P;
  for (const c of B.C) {
    const a = P[c.a], b = P[c.b];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .001;
    const wa = 1 / a.m, wb = 1 / b.m, diff = (d - c.len) / d / (wa + wb) * c.k;
    a.x += dx * diff * wa; a.y += dy * diff * wa;
    b.x -= dx * diff * wb; b.y -= dy * diff * wb;
  }
  if (grab && grab.B === B) { const p = grab.ref; p.x += (pointer.x - p.x) * .3; p.y += (pointer.y - p.y) * .3; }
  for (const p of P) collideWalls(B, p, it === 0);
}
function collideBodies(A, B) {
  for (const p of A.P) for (const q of B.P) {
    const dx = q.x - p.x, dy = q.y - p.y, rs = (p.r + q.r) * .85, d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) continue;
    const d = Math.sqrt(d2) || .001, pen = (rs - d) * .5, nx = dx / d, ny = dy / d;
    const wp = 1 / p.m, wq = 1 / q.m, tot = wp + wq;
    p.x -= nx * pen * wp / tot; p.y -= ny * pen * wp / tot;
    q.x += nx * pen * wq / tot; q.y += ny * pen * wq / tot;
    // Arham thrown into Boodie knocks her out
    if (A.thrownT > 0 && !B.ko && Math.hypot(p.x - p.px, p.y - p.py) > A.u * .25) {
      sfx('punch'); popText(q.x, q.y - 10, 'THUD!', '#fff', 30); hurt(B, 10);
    }
  }
}

function step(dt) {
  time += dt;
  const G = U * .0095;
  updateMeter(dt);
  idleTimer += dt;
  if (idleTimer > 7) { idleTimer = 0; if (!boodieActive()) say(arham, 'idle', true); }
  if (pointer.down && tool === 'fire') doFire(dt);

  const bs = bodies();
  for (const B of bs) stepBody(B, dt, G);
  for (let it = 0; it < ITER; it++) {
    for (const B of bs) solveBody(B, it);
    if (boodie && it % 3 === 0) collideBodies(arham, boodie);
  }
  // props
  for (const q of props) {
    let vx = (q.x - q.px), vy = (q.y - q.py);
    const v = Math.hypot(vx, vy), mv = U * .9; if (v > mv) { vx *= mv / v; vy *= mv / v; }
    q.px = q.x; q.py = q.y; q.x += vx * .998; q.y += vy * .998 + G;
    q.hitCd -= dt;
    if (grab && grab.ref === q) { q.x += (pointer.x - q.x) * .3; q.y += (pointer.y - q.y) * .3; }
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
  for (const B of bs) for (const q of props) for (let i = 0; i < 14; i++) {
    const p = B.P[i], dx = p.x - q.x, dy = p.y - q.y, rs = p.r + q.r, d2 = dx * dx + dy * dy;
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
      knock(B, 0); hurt(B, Math.min(dmg, 40));
      const hx = p.x - nx * p.r * .5, hy = p.y - ny * p.r * .5, h = hitTest(B, hx, hy, .1);
      if (h) addDecal(B, h.f, hx, hy, 'bruise', 0, clamp(q.r / U * 2.5, .8, 2));
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
}

function collideWalls(B, p, detect) {
  const u = B.u;
  if (p.y + p.r > FLOOR) {
    const vy = p.y - p.py;
    if (detect && vy > u * .22 && p.hitCd <= 0) {
      p.hitCd = .25;
      const dmg = (vy / u - .2) * 14;
      sfx('thud', vy / u * 1.5);
      if (dmg > 3) { hurt(B, dmg); shake = Math.max(shake, dmg * .6); sparks(p.x, FLOOR, 5, '#fff'); knock(B, 0); }
    }
    p.y = FLOOR - p.r;
    p.py = p.y + vy * .25;
    p.px = p.x - (p.x - p.px) * .75;
  }
  if (p.y - p.r < TOP) {
    const vy = p.y - p.py; p.y = TOP + p.r; p.py = p.y + vy * .3;
    if (detect && -vy > u * .25 && p.hitCd <= 0) { p.hitCd = .25; sfx('thud'); hurt(B, -vy / u * 8); }
  }
  for (const [edge, s] of [[p.r, 1], [W - p.r, -1]]) {
    if ((p.x - edge) * s < 0) {
      const vx = p.x - p.px;
      if (detect && Math.abs(vx) > u * .25 && p.hitCd <= 0) {
        p.hitCd = .25; sfx('thud', Math.abs(vx) / u); hurt(B, Math.abs(vx) / u * 10);
        shake = Math.max(shake, 6); knock(B, 0);
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

  for (const B of bodies()) {
    const [bcx] = bodyCenter(B);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(bcx, FLOOR + 4, B.u * 1.1, B.u * .15, 0, 0, 7); ctx.fill();
  }
  for (const B of bodies()) drawBuddy(B);
  for (const q of props) drawProp(q);

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

  for (const b of bolts) {
    ctx.globalAlpha = clamp(b.life / .35, 0, 1);
    for (const [w, c] of [[14, 'rgba(120,200,255,.4)'], [6, '#bfe9ff'], [2.5, '#fff']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath();
      b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  for (const f of fists) {
    ctx.save(); ctx.globalAlpha = clamp(f.t / .25, 0, 1);
    ctx.font = `${40 + (1 - f.t / .25) * 30}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('👊', f.x, f.y); ctx.restore();
  }

  for (const B of bodies()) drawBubble(B);
  ctx.restore();

  if (tool === 'fire' && pointer.down) {
    ctx.font = '36px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔥', pointer.x, pointer.y + 26);
  }
  if (flash > 0) { ctx.globalAlpha = Math.min(flash, .85); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

function col(B, part) {
  const base = B.colors[part];
  if (B.zapped > 0 && (time * 20 | 0) % 2 === 0) return part === 'skin' ? '#fffbe0' : '#1a1a1a';
  return B.char > 0 ? mix(base, '#2a1d15', B.char * .75) : base;
}
function limb(B, k) {
  const [a, b, w, part] = LIMBS[k], A = B.P[a], Bp = B.P[b];
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = w * B.u + 5;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bp.x, Bp.y); ctx.stroke();
  ctx.strokeStyle = col(B, part); ctx.lineWidth = w * B.u;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bp.x, Bp.y); ctx.stroke();
}
function ball(p, r, c) {
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, 7); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
}
function drawDecals(B, filter) {
  for (const d of B.decals) {
    if (!filter(d.f)) continue;
    const fr = frame(B, d.f), [x, y] = toWorld(fr, d.lx, d.ly);
    ctx.save(); ctx.translate(x, y); ctx.rotate(fr.ang + d.rot); ctx.scale(d.size, d.size);
    const s = B.u / 60;
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
function drawBuddy(B) {
  const P = B.P, u = B.u;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let k = 4; k < 8; k++) limb(B, k);
  ball(P[12], u * .2, col(B, 'shoe')); ball(P[13], u * .2, col(B, 'shoe'));
  drawDecals(B, f => f >= 6);
  // torso
  const q = [P[2], P[3], P[5], P[4]];
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = u * .5 + 5; ctx.fillStyle = col(B, 'shirt');
  const tp = () => { ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
  tp(); ctx.stroke(); ctx.fill();
  ctx.strokeStyle = col(B, 'shirt'); ctx.lineWidth = u * .5; tp(); ctx.stroke();
  const tf = frame(B, 1);
  ctx.save(); ctx.translate(tf.ox, tf.oy); ctx.rotate(tf.ang);
  if (B.kind === 'boodie') {
    // skirt
    ctx.fillStyle = col(B, 'pants'); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-.62 * u, .45 * u); ctx.lineTo(.62 * u, .45 * u); ctx.lineTo(.9 * u, 1.25 * u);
    ctx.quadraticCurveTo(0, 1.4 * u, -.9 * u, 1.25 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2;
    for (const x of [-.4, 0, .4]) { ctx.beginPath(); ctx.moveTo(x * u, .5 * u); ctx.lineTo(x * 1.4 * u, 1.3 * u); ctx.stroke(); }
    // heart on shirt
    ctx.fillStyle = '#ff5d9e';
    ctx.beginPath(); ctx.moveTo(0, -.02 * u);
    ctx.bezierCurveTo(-.28 * u, -.25 * u, -.12 * u, -.45 * u, 0, -.3 * u);
    ctx.bezierCurveTo(.12 * u, -.45 * u, .28 * u, -.25 * u, 0, -.02 * u); ctx.fill();
  } else {
    ctx.strokeStyle = col(B, 'pants'); ctx.lineWidth = u * .32;
    ctx.beginPath(); ctx.moveTo(-.45 * u, .55 * u); ctx.lineTo(.45 * u, .55 * u); ctx.stroke();
  }
  ctx.font = `900 ${Math.round(u * .24)}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText(bodyName(B).toUpperCase().slice(0, 8), 0, B.kind === 'boodie' ? .2 * u : -.15 * u, u * .95);
  ctx.restore();
  drawDecals(B, f => f === 1);
  for (let k = 0; k < 4; k++) limb(B, k);
  ball(P[8], u * .17, col(B, 'skin')); ball(P[9], u * .17, col(B, 'skin'));
  drawDecals(B, f => f >= 2 && f <= 5);
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = u * .22 + 5;
  ctx.beginPath(); ctx.moveTo(P[1].x, P[1].y); ctx.lineTo(P[0].x, P[0].y); ctx.stroke();
  ctx.strokeStyle = col(B, 'skin'); ctx.lineWidth = u * .22; ctx.stroke();
  drawHead(B);
}
function drawHead(B) {
  const h = B.P[0], fr = frame(B, 0), R = RAD[0] * B.u;
  const girl = B.kind === 'boodie';
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(fr.ang);
  if (girl) { // long hair behind the head
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.roundRect(-R * 1.2, -R * 1.05, R * 2.4, R * 2.55, [R * 1.1, R * 1.1, R * .5, R * .5]); ctx.fill();
    ctx.fillStyle = col(B, 'hair');
    ctx.beginPath(); ctx.roundRect(-R * 1.13, -R * 1.0, R * 2.26, R * 2.45, [R * 1.05, R * 1.05, R * .45, R * .45]); ctx.fill();
  }
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, R + 3, 0, 7); ctx.fill();
  if (faceImg && !girl) {
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
    ctx.drawImage(faceImg, -R, -R, R * 2, R * 2);
    if (B.zapped > 0 && (time * 20 | 0) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,220,.7)'; ctx.fillRect(-R, -R, R * 2, R * 2); }
    ctx.fillStyle = `rgba(200,0,20,${B.pain / 250})`; ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.fillStyle = `rgba(30,20,10,${B.char * .7})`; ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = col(B, 'skin'); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    ctx.fillStyle = col(B, 'hair');
    if (girl) { // bangs + bow
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI, Math.PI * 2);
      for (let i = 4; i >= 0; i--) { const x = -R + (i + .5) * R * .4; ctx.quadraticCurveTo(x + R * .2, -R * .5, x, -R * .3); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff5d9e'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5;
      const bx = R * .55, by = -R * .8;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + sx * R * .38, by - R * .2); ctx.lineTo(bx + sx * R * .38, by + R * .22); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(bx, by, R * .1, 0, 7); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI * 1.05, Math.PI * 1.95); ctx.quadraticCurveTo(R * .3, -R * .55, -R * .95, -R * .25); ctx.fill();
      ctx.fillStyle = col(B, 'skin');
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * R * .98, R * .05, R * .14, R * .2, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    drawFace(B, R);
  }
  ctx.restore();
  drawDecals(B, f => f === 0);
  if (B.pain > 70 || B.zapped > 0 || B.ko) {
    for (let i = 0; i < 3; i++) {
      const a = time * 4 + i * 2.1;
      ctx.font = `${B.u * .3}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⭐', h.x + Math.cos(a) * R * 1.2, h.y - R * 1.1 + Math.sin(a) * R * .3);
    }
  }
}
function drawFace(B, R) {
  const girl = B.kind === 'boodie', pain = B.pain;
  ctx.strokeStyle = '#1a1a1a'; ctx.fillStyle = '#1a1a1a'; ctx.lineCap = 'round';
  const ex = R * .36, ey = -R * .02, lw = Math.max(2, R * .09);
  ctx.lineWidth = lw;
  const dizzy = B.ko || pain > 70 || (B.zapped > 0 && (time * 10 | 0) % 2);
  const fighting = girl && !B.ko;
  // look toward the pointer (Arham) or toward Arham (Boodie)
  const fr = frame(B, 0), look = girl ? arham.P[0] : pointer;
  const lx = look.x - B.P[0].x, ly = look.y - B.P[0].y, ld = Math.hypot(lx, ly) || 1;
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
      if (B.blink > 0) { ctx.beginPath(); ctx.moveTo(x - R * .12, ey); ctx.lineTo(x + R * .12, ey); ctx.stroke(); continue; }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, ey, R * .16, R * .2, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = girl ? '#2f7de1' : '#1a1a1a'; ctx.beginPath(); ctx.arc(x + rx * R * .06, ey + ry * R * .08, R * .08, 0, 7); ctx.fill();
      if (girl) { // lashes
        ctx.beginPath();
        for (const k of [0, 1, 2]) { const a = -Math.PI / 2 + sx * (.5 + k * .35); ctx.moveTo(x + Math.cos(a) * R * .17, ey + Math.sin(a) * R * .21); ctx.lineTo(x + Math.cos(a) * R * .28, ey + Math.sin(a) * R * .3); }
        ctx.stroke();
      }
      if (fighting) { // angry brows
        ctx.beginPath(); ctx.moveTo(x - sx * R * .2, ey - R * .36); ctx.lineTo(x + sx * R * .14, ey - R * .24); ctx.stroke();
      } else if (pain > 12) {
        ctx.beginPath(); ctx.moveTo(x - sx * R * .18, ey - R * .22); ctx.lineTo(x + sx * R * .14, ey - R * .34); ctx.stroke();
      }
    }
  }
  if (pain > 40 && !fighting) {
    ctx.fillStyle = 'rgba(80,170,255,.85)';
    for (const sx of [-1, 1]) { const ty = ey + R * .2 + ((time * 60 + sx * 20) % 30) / 30 * R * .4; ctx.beginPath(); ctx.arc(sx * ex, ty, R * .06, 0, 7); ctx.fill(); }
  } else if (pain < 12 || fighting) {
    ctx.fillStyle = girl ? 'rgba(255,90,140,.4)' : 'rgba(255,90,110,.3)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * R * .55, R * .25, R * .12, 0, 7); ctx.fill(); }
  }
  const my = R * .42;
  ctx.fillStyle = '#6b1020';
  if (dizzy) {
    ctx.beginPath(); ctx.moveTo(-R * .3, my);
    for (let i = 1; i <= 6; i++) ctx.lineTo(-R * .3 + i * R * .1, my + (i % 2 ? -1 : 1) * R * .07);
    ctx.stroke();
  } else if (fighting) { // gritted grin
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect(-R * .24, my - R * .1, R * .48, R * .18, R * .06); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-R * .24, my - R * .01); ctx.lineTo(R * .24, my - R * .01); ctx.stroke();
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
function drawBubble(B) {
  if (!B.bubble) return;
  const h = B.P[0], R = RAD[0] * B.u, fs = Math.max(14, B.u * .26);
  ctx.font = `800 ${fs}px "Trebuchet MS", sans-serif`;
  const tw = ctx.measureText(B.bubble.text).width + 24, th = fs + 18;
  const x = clamp(h.x - tw / 2, 6, W - tw - 6), y = Math.max(60, h.y - R - th - 24);
  ctx.globalAlpha = clamp(B.bubble.t * 3, 0, 1);
  ctx.fillStyle = B.kind === 'boodie' ? '#ffe3f0' : '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, y, tw, th, 12); ctx.fill(); ctx.stroke();
  const tx = clamp(h.x, x + 14, x + tw - 14);
  ctx.beginPath(); ctx.moveTo(tx - 8, y + th - 1); ctx.lineTo(tx, y + th + 12); ctx.lineTo(tx + 8, y + th - 1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(tx - 8, y + th); ctx.lineTo(tx, y + th + 12); ctx.lineTo(tx + 8, y + th); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(B.bubble.text, x + tw / 2, y + th / 2 + 1);
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
    b.className = 'tool' + (t.spawn ? ' spawner' : ''); b.dataset.id = t.id;
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
    el.classList.toggle('busy', !!t.spawn && owned && boodieActive());
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
    if (bucks < t.price) { sfx('deny'); toast(`Need $${t.price} for ${t.name}. Keep hitting ${buddyName}!`); return; }
    bucks -= t.price; unlocked.add(t.id);
    store.set('unlocked', [...unlocked]); store.set('bucks', bucks);
    $('bucksVal').textContent = bucks;
    sfx('buy'); toast(`Unlocked ${t.name}! ${t.icon}`);
  }
  if (t.spawn) {
    if (boodieActive()) { sfx('deny'); toast('Boodie is still fighting! Knock her out to spawn a new one.'); return; }
    spawnBoodie();
    return;
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
$('btnClear').onclick = () => { props = []; for (const B of bodies()) B.decals = []; floorStains = []; wallMarks = []; parts = []; grab = null; };
$('btnReset').onclick = () => {
  arham = makeBody('arham', W / 2); boodie = null;
  props = []; parts = []; floorStains = []; wallMarks = []; grab = null;
  say(arham, 'up', true);
  refreshTools();
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
window.KTA = { get arham() { return arham; }, get boodie() { return boodie; }, get props() { return props; }, addBucks, explode, spawnBoodie };
