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
let shake = 0, flash = 0, flashColor = '#fff', time = 0, hurtFx = 0;
let props = [], parts = [], floorStains = [], wallMarks = [], bolts = [], fists = [];
let arham = null, boodie = null;
let ents = [], gravDir = 1, flipT = 0, laserBeam = null, smgCd = 0;
let phasesUnlocked = store.get('phases', 1), shopPhase = 1, shopHasNew = false;
const bodies = () => boodie ? [arham, boodie] : [arham];
const boodieActive = () => !!boodie && !boodie.ko;
const BOODIE_FADE = 6; // seconds a knocked-out Boodie lies there before fading away

// phase: which shop aisle sells it. hold: fires continuously while held. spawn: summons a character.
const TOOLS = [
  // Phase 1 — Starter Stuff
  { id: 'hand', phase: 1, name: 'Hand', icon: '✋', price: 0, desc: 'Grab and fling him around.' },
  { id: 'punch', phase: 1, name: 'Punch', icon: '👊', price: 0, desc: 'A good old knuckle sandwich.' },
  { id: 'knife', phase: 1, name: 'Knife', icon: '🔪', price: 40, desc: 'Drag across him to slice.' },
  { id: 'ball', phase: 1, name: 'Bowling', icon: '🎳', price: 70, desc: 'Drop a heavy bowling ball.' },
  { id: 'pistol', phase: 1, name: 'Pistol', icon: '🔫', price: 120, desc: 'Tap to shoot.' },
  { id: 'bomb', phase: 1, name: 'Bomb', icon: '💣', price: 200, desc: 'Ticking cartoon bomb.' },
  { id: 'fire', phase: 1, name: 'Flamer', icon: '🔥', price: 320, desc: 'Hold to roast him.', hold: true },
  { id: 'anvil', phase: 1, name: 'Anvil', icon: '🪨', price: 450, desc: 'Falls from the ceiling.' },
  { id: 'lightning', phase: 1, name: 'Zeus', icon: '⚡', price: 700, desc: 'Smite him with a bolt.' },
  { id: 'boodie', phase: 1, name: 'Boodie', icon: '👱‍♀️', price: 1500, desc: 'She beats him up for you.', spawn: true },
  // Phase 2 — Inferno
  { id: 'molotov', phase: 2, name: 'Molotov', icon: '🍾', price: 180, desc: 'Shatters into a pool of fire.' },
  { id: 'firework', phase: 2, name: 'Firework', icon: '🎆', price: 220, desc: 'Launches up from the floor and bursts.' },
  { id: 'fireball', phase: 2, name: 'Fireball', icon: '☄️', price: 300, desc: 'Hurl a blazing fireball.' },
  { id: 'lava', phase: 2, name: 'Lava Rain', icon: '🌋', price: 380, desc: 'Molten lava pours from above.' },
  { id: 'napalm', phase: 2, name: 'Napalm', icon: '🛩️', price: 480, desc: 'A plane carpets the floor in fire.' },
  // Phase 3 — Warzone
  { id: 'grenade', phase: 3, name: 'Grenade', icon: '🧨', price: 260, desc: 'Pull the pin. 1.6 second fuse.' },
  { id: 'mine', phase: 3, name: 'Landmine', icon: '💥', price: 320, desc: 'Blows when he steps on it.' },
  { id: 'smg', phase: 3, name: 'SMG', icon: '🔫', price: 420, desc: 'Hold for full-auto fire.', hold: true },
  { id: 'rpg', phase: 3, name: 'Rocket', icon: '🚀', price: 520, desc: 'Rocket-propelled mayhem.' },
  { id: 'airstrike', phase: 3, name: 'Airstrike', icon: '🎯', price: 650, desc: 'Mark a spot. Bombs away.' },
  { id: 'tank', phase: 3, name: 'Tank', icon: '🪖', price: 800, desc: 'Rolls in and shells him 5 times.' },
  // Phase 4 — Cosmic
  { id: 'laser', phase: 4, name: 'Laser', icon: '🔦', price: 450, desc: 'Hold to fire a burning beam.', hold: true },
  { id: 'gravflip', phase: 4, name: 'Gravity Flip', icon: '🙃', price: 550, desc: 'Flips gravity for 5 seconds.' },
  { id: 'blackhole', phase: 4, name: 'Black Hole', icon: '🕳️', price: 700, desc: 'Sucks in everything nearby.' },
  { id: 'meteor', phase: 4, name: 'Meteor', icon: '🌑', price: 850, desc: 'Call down a flaming space rock.' },
  { id: 'ufo', phase: 4, name: 'UFO', icon: '🛸', price: 1000, desc: 'Aliens abduct him for a bit.' },
  // Phase 5 — Cartoon Chaos
  { id: 'chicken', phase: 5, name: 'Rubber Chicken', icon: '🐔', price: 300, desc: 'A squeaky, humiliating slap.' },
  { id: 'pie', phase: 5, name: 'Cream Pie', icon: '🥧', price: 350, desc: 'Right in the face.' },
  { id: 'bees', phase: 5, name: 'Bees', icon: '🐝', price: 700, desc: 'A swarm of very angry bees.' },
  { id: 'piano', phase: 5, name: 'Piano', icon: '🎹', price: 900, desc: 'Drops from the sky with a CLANG.' },
  { id: 'nuke', phase: 5, name: 'Nuke', icon: '☢️', price: 2500, desc: 'The end of everything. For him.' },
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
    bubble: null, voiceCd: 0, blink: 0, ko: false, koT: 0, bleed: 0, thrownT: 0, targets: null,
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
  const now = performance.now(), gap = { thud: 60, slash: 50, crackle: 90, voice: 0, laser: 50, buzz: 150, sizzle: 80, smg: 40 }[kind] || 20;
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
    case 'smg': noise(.08, .5, 3000); tone(250, 80, .06, 'square', .12); break;
    case 'squeak': tone(1100, 1700, .12, 'square', .12); tone(1700, 900, .15, 'square', .1, .1); break;
    case 'splat': noise(.25, .6, 700); tone(200, 60, .2, 'sine', .3); break;
    case 'glass': noise(.3, .6, 6000, 'highpass'); for (let i = 0; i < 4; i++) tone(rand(2000, 4000), rand(1500, 3000), .1, 'triangle', .05, i * .03); break;
    case 'fwoosh': noise(.5, .5, 1200, 'bandpass', .7); break;
    case 'laser': tone(rand(1200, 1400), rand(900, 1000), .06, 'sawtooth', .05); break;
    case 'siren': tone(700, 1100, .35, 'sawtooth', .15); break;
    case 'buzz': tone(220, 240, .25, 'sawtooth', .04); break;
    case 'ufo': for (let i = 0; i < 4; i++) tone(500 + i * 150, 300 + i * 200, .25, 'sine', .12, i * .12); break;
    case 'piano': [196, 233, 277, 311, 370].forEach(f => tone(f, f * .99, 1.3, 'triangle', .12)); noise(.2, .6, 400); break;
    case 'firework': noise(.4, .6, 2500); for (let i = 0; i < 6; i++) tone(rand(2000, 4000), 800, .05, 'square', .05, .1 + i * .06); break;
    case 'rocket': noise(.6, .4, 1500, 'bandpass', .8); tone(200, 800, .5, 'sawtooth', .05); break;
    case 'sizzle': noise(.3, .2, 5000, 'highpass'); break;
    case 'plane': tone(90, 110, 2, 'sawtooth', .07); noise(2, .2, 400); break;
    case 'tank': tone(60, 70, 1.5, 'sawtooth', .12); noise(1, .25, 300); break;
    case 'cannon': noise(.5, .9, 900); tone(120, 40, .4, 'sine', .7); break;
    case 'blackhole': tone(400, 40, 2, 'sine', .3); tone(80, 30, 3, 'sawtooth', .08); break;
    case 'meteor': noise(1.2, .5, 800, 'bandpass', .5); tone(300, 60, 1.2, 'sawtooth', .08); break;
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
  if (kind !== 'fire' && kind !== 'zap') B.bleed = Math.min(1, B.bleed + amount / 70);
  if (amount >= 5 && kind !== 'fire') {
    const p = B.P[(Math.random() * 14) | 0];
    wallSplat(p.x + rand(-1, 1) * B.u, p.y + rand(-1, .5) * B.u, clamp(amount / 10, .5, 2.2));
    if (B.kind === 'arham') hurtFx = Math.max(hurtFx, Math.min(.55, amount / 35));
  }
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
  if (phasesUnlocked < PHASES.length) {
    phasesUnlocked++; store.set('phases', phasesUnlocked); shopHasNew = true;
    const n = phasesUnlocked;
    setTimeout(() => toast(`🏪 Shop Phase ${n}: ${PHASES[n - 1].name} unlocked!`, 3000), 2700);
    buildTools(); if (shopOpen) renderShop();
  }
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
  blood(B.P[0].x, B.P[0].y, 18, 1.4); ring(B.P[0].x, B.P[0].y, B.u * 1.5, '#ff5d73');
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
function ring(x, y, r, color = '#fff') { parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: .35, max: .35, size: r, color }); }
function tooth(x, y) { spawn('tooth', x, y, rand(-4, 4), rand(-7, -3), 3, 4, '#fffdf5'); }
function dust(x, n = 6) { for (let i = 0; i < n; i++) spawn('smoke', x + rand(-20, 20), FLOOR - rand(0, 6), rand(-2.5, 2.5), rand(-1.2, -.2), rand(.5, .9), rand(8, 16), '#d9c9b0'); }
function wallSplat(x, y, s = 1) {
  if (y > FLOOR - 12) return;
  const blobs = Array.from({ length: 5 + (s * 4 | 0) }, () => [rand(-1, 1) * 18 * s, rand(-1, 1) * 14 * s, rand(3, 9) * s]);
  const drips = Array.from({ length: 1 + (s * 2 | 0) }, () => [rand(-12, 12) * s, rand(10, 40) * s]);
  wallMarks.push({ x, y, r: s, life: 40, blood: true, blobs, drips });
  if (wallMarks.length > 70) wallMarks.shift();
}
function popText(x, y, text, color = '#ffd84d', size = 34) { parts.push({ type: 'text', x, y, vx: rand(-1, 1), vy: -1.5, life: .9, max: .9, size, color, text, rot: rand(-.3, .3) }); }

// ---------- props ----------
const HEAVY = { anvil: 'clang', piano: 'piano' };
function addProp(type, x, y) {
  const d = {
    ball: { r: .36, m: 6, bounce: .35, fric: .99 },
    bomb: { r: .3, m: 2, bounce: .4, fric: .97, fuse: 2.2 },
    anvil: { r: .55, m: 30, bounce: .05, fric: .8 },
    grenade: { r: .2, m: 1.5, bounce: .5, fric: .96, fuse: 1.6 },
    piano: { r: .72, m: 40, bounce: .02, fric: .7 },
  }[type];
  const p = { type, x, y, px: x, py: y, r: d.r * U, m: d.m, bounce: d.bounce, fric: d.fric, fuse: d.fuse || 0, ang: 0, hitCd: 0 };
  props.push(p);
  if (props.length > 14) { const i = props.findIndex(q => !q.fuse); props.splice(i < 0 ? 0 : i, 1); }
  return p;
}
function explode(x, y, R, power, opts = {}) {
  const small = !!opts.small;
  sfx(opts.snd || 'boom'); shake = Math.max(shake, small ? 10 : 26); flash = Math.max(flash, small ? .3 : .8); flashColor = '#fff3c4';
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
    if (opts.fire) ignite(B, 3);
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
  for (let i = 0; i < (small ? 16 : 40); i++) spawn('spark', x, y, rand(-14, 14), rand(-16, 6), rand(.3, .8), rand(3, 6), pick(['#ffd84d', '#ff9f1c', '#ff5d2c']));
  for (let i = 0; i < (small ? 6 : 18); i++) spawn('smoke', x + rand(-20, 20), y + rand(-20, 20), rand(-2, 2), rand(-3, -.5), rand(1, 2), rand(15, 30), '#555');
  ring(x, y, Math.min(R, U * 5) * .6, '#fff3c4');
  if (!small) wallMarks.push({ x, y: Math.min(y, FLOOR - 5), r: Math.min(R * .35, U * 2), life: 30 });
  popText(x, y - 20, opts.text || 'KABOOM!', '#ff9f1c', small ? 34 : 48);
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

function doPunch(x, y, w = {}) {
  const h = hitAny(x, y);
  fists.push({ x, y, t: .25, e: w.e || '👊' });
  if (!h) { sfx('whoosh'); return; }
  const B = h.B, [cx] = bodyCenter(B);
  const dx = x < cx ? 1 : -1, f = B.u * .45 * (w.mult || 1);
  addVel(B.P[h.i], dx * f * 1.2, -f * .35);
  kickNeighbors(B, h.i, dx * f * .5, -f * .15);
  knock(B, 0);
  sfx(w.snd || 'punch'); shake = Math.max(shake, 6);
  hurt(B, w.dmg || 6);
  addDecal(B, h.f, x, y, 'bruise', 0, rand(.8, 1.2));
  if (Math.random() < .35) addDecal(B, h.f, x + rand(-6, 6), y + rand(-6, 6), 'blood', rand(0, 6), rand(.6, 1));
  blood(x, y, 8, 1.1); ring(x, y, B.u * .7);
  if (h.f === 0 && Math.random() < .35) tooth(x, y);
  popText(x, y - 10, pick(w.words || ['POW!', 'BAM!', 'WHACK!', 'SMACK!']), '#fff', 30);
  sparks(x, y, 6, '#fff');
}

function doShoot(x, y, light) {
  if (light) { sfx('smg'); shake = Math.max(shake, 3); } else { sfx('gun'); shake = Math.max(shake, 5); flash = .15; flashColor = '#fff6d0'; }
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
  blood(x, y, light ? 6 : 14, 1.4);
  if (Math.random() < .5) addDecal(B, h.f, x, y + 4, 'blood', rand(0, 6), .7);
  hurt(B, light ? 5 : 9);
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
  if (Math.random() < .4) addDecal(A, h.f, E.x, E.y, 'blood', rand(0, 6), rand(.6, 1.1));
  blood(E.x, E.y, 9, 1.2); ring(E.x, E.y, A.u * .7, '#ffd1e8');
  if (h.f === 0 && Math.random() < .3) tooth(E.x, E.y);
  popText(E.x, E.y - 12, pick(a.words), '#ffd1e8', 30);
  sparks(E.x, E.y, 8, '#fff');
}

// ---------- shop weapons (phases 2-5) ----------
function grav() { return U * .0095 * gravDir; }
function ignite(B, t = 3) { B.onFire = Math.max(B.onFire, t); if (B.kind === 'boodie') hurt(B, 1, 'fire'); }
function edgeX(x) { return x < W / 2 ? -20 : W + 20; }
// Generic projectile: moves each step, calls onHit(x, y, hit) on a body, the floor, or when its fuse runs out.
function projectile(o) {
  const p = Object.assign({ g: 0, r: 6, life: 8, age: 0, spin: 0, ang: 0 }, o);
  p.u = dt => {
    p.age += dt; p.vy += grav() * p.g; p.x += p.vx; p.y += p.vy; p.ang += p.spin;
    if (p.trail) p.trail(p);
    if (p.fuse && p.age >= p.fuse) { p.onHit(p.x, p.y, null); return false; }
    if (p.age > .05) { const h = hitAny(p.x, p.y, .05); if (h) { p.onHit(p.x, p.y, h); return false; } }
    if (p.y > FLOOR - 2) { p.onHit(p.x, FLOOR - 4, null); return false; }
    return !(p.x < -300 || p.x > W + 300 || p.y < -900 || p.age > p.life);
  };
  p.d = () => p.draw(p);
  ents.push(p);
  return p;
}
// velocity that lands a gravity projectile on (tx, ty) after T steps
function lob(x0, y0, tx, ty, T) { return { vx: (tx - x0) / T, vy: (ty - y0) / T - .5 * grav() * T }; }
function aimAt(x0, y0, tx, ty, sp) { const d = Math.hypot(tx - x0, ty - y0) || 1; return { vx: (tx - x0) / d * sp, vy: (ty - y0) / d * sp, fuse: d / sp / 60 }; }

function firePatch(x, w, dur) {
  const e = { t: dur };
  e.u = () => {
    e.t -= 1 / 60;
    if (Math.random() < .8) spawn('flame', x + rand(-w / 2, w / 2), FLOOR - rand(0, 8), rand(-.5, .5), rand(-3, -1), rand(.4, .9), rand(10, 20), '#ff9f1c');
    for (const B of bodies()) if (B.P.some(p => Math.abs(p.x - x) < w / 2 && p.y > FLOOR - B.u * .7)) ignite(B, 1.5);
    if (Math.random() < .1) sfx('crackle');
    return e.t > 0;
  };
  e.d = () => {
    ctx.globalAlpha = clamp(e.t, 0, 1) * .5;
    const g = ctx.createRadialGradient(x, FLOOR, 0, x, FLOOR, w * .7);
    g.addColorStop(0, 'rgba(255,160,40,.9)'); g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - w, FLOOR - w * .7, w * 2, w * .8); ctx.globalAlpha = 1;
  };
  ents.push(e);
}
function drawSmallBomb(p) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vx, -p.vy) + Math.PI);
  ctx.fillStyle = '#3a3f44'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 13, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e63946'; ctx.fillRect(-7, -15, 14, 4); ctx.restore();
}
function drawPlane(x, y, dir, c) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.fillStyle = c; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-30, 34); ctx.lineTo(0, 34); ctx.lineTo(20, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 0, 70, 14, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-55, -4); ctx.lineTo(-72, -30); ctx.lineTo(-60, -30); ctx.lineTo(-40, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9ad1ff'; ctx.beginPath(); ctx.ellipse(40, -5, 14, 7, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawRocket(x, y, a, c) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = c; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(8, -7); ctx.lineTo(-18, -7); ctx.lineTo(-18, 7); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.moveTo(-18, -7); ctx.lineTo(-26, -13); ctx.lineTo(-26, 13); ctx.lineTo(-18, 7); ctx.fill();
  ctx.fillStyle = '#ffb703'; ctx.beginPath(); ctx.arc(-28, 0, 4 + Math.random() * 3, 0, 7); ctx.fill();
  ctx.restore();
}

// --- Phase 2: Inferno ---
function throwMolotov(tx, ty) {
  const x0 = tx < W / 2 ? 10 : W - 10, y0 = FLOOR - U * 2.5, v = lob(x0, y0, tx, ty, 38);
  sfx('whoosh');
  projectile({ x: x0, y: y0, ...v, g: 1, r: 8, spin: .25,
    draw: p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
      ctx.fillStyle = '#5a9e4b'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-U * .1, -U * .18, U * .2, U * .36, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eee'; ctx.fillRect(-U * .04, -U * .3, U * .08, U * .13); ctx.restore();
    },
    trail: p => spawn('flame', p.x + Math.sin(p.ang) * U * .3, p.y - Math.cos(p.ang) * U * .3, 0, -1, .3, 6, '#ff9f1c'),
    onHit: (x, y) => {
      sfx('glass'); sfx('fwoosh'); sparks(x, y, 14, '#bfe9ff');
      for (let i = 0; i < 25; i++) spawn('flame', x + rand(-20, 20), y + rand(-20, 20), rand(-4, 4), rand(-5, 0), rand(.5, 1), rand(12, 22), '#ff9f1c');
      for (const B of bodies()) if (B.P.some(p => Math.hypot(p.x - x, p.y - y) < U * 1.6)) { ignite(B, 4); hurt(B, 4, 'fire'); }
      firePatch(x, U * 2.4, 5);
      popText(x, y - 20, 'WHOOSH!', '#ff9f1c', 38);
    } });
}
function launchFirework(tx) {
  sfx('rocket');
  const hue = pick(['#ff5d9e', '#ffd84d', '#4cc9f0', '#80ed99', '#c77dff']), wob = rand(0, 6);
  projectile({ x: tx, y: FLOOR - 14, vx: rand(-1, 1), vy: -U * .22, r: 5, fuse: rand(.9, 1.3),
    draw: p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vx, -p.vy));
      ctx.fillStyle = hue; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-5, -14, 10, 24, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-5, -14); ctx.lineTo(0, -22); ctx.lineTo(5, -14); ctx.fill(); ctx.restore();
    },
    trail: p => { p.vx += Math.sin(p.age * 12 + wob) * .4; spawn('spark', p.x, p.y + 10, rand(-1, 1), rand(1, 3), .4, 2.5, '#ffd84d'); },
    onHit: (x, y) => {
      for (let i = 0; i < 60; i++) { const a = rand(0, 7), s = rand(3, 9); spawn('spark', x, y, Math.cos(a) * s, Math.sin(a) * s, rand(.6, 1.2), rand(2, 4), pick([hue, '#fff', hue])); }
      explode(x, y, U * 1.5, U * .35, { fire: true, text: pick(['BANG!', 'KAPOW!', 'WHEEE!']), snd: 'firework', small: true });
    } });
}
function castFireball(tx, ty) {
  const x0 = edgeX(tx), y0 = Math.min(ty, FLOOR - U) - U * .5;
  sfx('fwoosh');
  projectile({ x: x0, y: y0, ...aimAt(x0, y0, tx, ty, U * .3), r: U * .25,
    draw: p => {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.6);
      g.addColorStop(0, '#fff6b0'); g.addColorStop(.4, '#ff9f1c'); g.addColorStop(1, 'rgba(230,57,70,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.6, 0, 7); ctx.fill();
    },
    trail: p => spawn('flame', p.x + rand(-5, 5), p.y + rand(-5, 5), -p.vx * .1, -p.vy * .1 - .5, rand(.3, .5), rand(8, 14), '#ff9f1c'),
    onHit: (x, y) => explode(x, y, U * 1.9, U * .45, { fire: true, text: 'FWOOSH!', snd: 'fwoosh', small: true }) });
}
function lavaRain(tx) {
  const e = { t: 3, cd: 0 };
  sfx('sizzle');
  e.u = dt => {
    e.t -= dt; e.cd -= dt;
    if (e.cd <= 0 && e.t > 0) {
      e.cd = .07;
      projectile({ x: tx + rand(-1.6, 1.6) * U, y: -20, vx: 0, vy: rand(2, 5), g: 1, r: rand(5, 9),
        draw: p => {
          ctx.fillStyle = '#ff6a00'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(p.x - p.r * .3, p.y - p.r * .3, p.r * .4, 0, 7); ctx.fill();
        },
        onHit: (x, y, h) => {
          for (let i = 0; i < 4; i++) spawn('flame', x, y, rand(-2, 2), rand(-3, -1), rand(.3, .6), rand(6, 10), '#ff9f1c');
          if (h) { ignite(h.B, 2); hurt(h.B, 2.5, 'fire'); if (Math.random() < .3) addDecal(h.B, h.f, x, y, 'soot', rand(0, 6), .6); sfx('sizzle'); }
          else floorStains.push({ x, y: FLOOR + rand(2, 10), r: rand(6, 12), life: 4, c: '#ff6a00' });
        } });
    }
    return e.t > 0;
  };
  ents.push(e);
}
function napalmStrike(tx) {
  const dir = tx < W / 2 ? -1 : 1;
  const e = { x: dir > 0 ? -150 : W + 150, y: 95, drops: [-2.4, -1.2, 0, 1.2, 2.4].map(o => tx + o * U) };
  sfx('plane');
  e.u = () => {
    e.x += dir * W / 150;
    e.drops = e.drops.filter(dx => {
      if ((e.x - dx) * dir < 0) return true;
      projectile({ x: e.x, y: e.y + 20, vx: dir * 2, vy: 0, g: 1, r: 8, draw: drawSmallBomb,
        onHit: x => { explode(x, FLOOR - 10, U * 1.7, U * .5, { fire: true, text: 'NAPALM!', small: true }); firePatch(x, U * 1.6, 4); } });
      return false;
    });
    return dir > 0 ? e.x < W + 200 : e.x > -200;
  };
  e.d = () => drawPlane(e.x, e.y, dir, '#6c757d');
  ents.push(e);
}

// --- Phase 3: Warzone ---
function placeMine(x) {
  const e = { x, arm: .7, blink: 0 };
  sfx('pop');
  const boom = () => explode(e.x, FLOOR - 10, U * 2.8, U, { text: 'KABLAM!' });
  e.u = dt => {
    e.arm -= dt; e.blink += dt;
    if (e.arm > 0) return true;
    for (const B of bodies()) for (const p of B.P) if (Math.abs(p.x - e.x) < U * .45 && p.y > FLOOR - U * .7) { boom(); return false; }
    for (const q of props) if (Math.abs(q.x - e.x) < U * .45 + q.r && q.y > FLOOR - q.r - U * .3) { boom(); return false; }
    return true;
  };
  e.d = () => {
    ctx.fillStyle = '#4a5240'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(e.x, FLOOR, U * .4, U * .16, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = e.arm > 0 ? '#80ed99' : ((e.blink * 3 | 0) % 2 ? '#ff2b2b' : '#5a0000');
    ctx.beginPath(); ctx.arc(e.x, FLOOR - U * .16, U * .06, 0, 7); ctx.fill();
  };
  ents.push(e);
}
function fireRPG(tx, ty) {
  const x0 = edgeX(tx), y0 = FLOOR - U * 1.5;
  sfx('rocket');
  projectile({ x: x0, y: y0, ...aimAt(x0, y0, tx, ty, U * .4), r: 8,
    draw: p => drawRocket(p.x, p.y, Math.atan2(p.vy, p.vx), '#556b2f'),
    trail: p => spawn('smoke', p.x - p.vx, p.y - p.vy, rand(-.5, .5), rand(-.5, .5), rand(.4, .8), rand(5, 9), '#888'),
    onHit: (x, y) => explode(x, y, U * 3, U * .85, { text: 'BOOM!' }) });
}
function callAirstrike(tx) {
  const e = { t: 1.3, px: tx < W / 2 ? W + 150 : -150, launched: false };
  const dir = e.px < 0 ? 1 : -1;
  sfx('plane'); sfx('siren');
  e.u = dt => {
    e.t -= dt; e.px += dir * W / 80;
    if (e.t <= 0 && !e.launched) {
      e.launched = true;
      for (let i = 0; i < 5; i++) projectile({ x: tx + (i - 2) * U * .9 + rand(-10, 10), y: -40 - i * 70, vx: 0, vy: U * .2, g: 1, r: 8, draw: drawSmallBomb,
        onHit: (x, y) => explode(x, y, U * 2.1, U * .6, { text: pick(['BOOM!', 'BLAM!']), small: i % 2 === 1 }) });
    }
    return !e.launched || (e.px > -200 && e.px < W + 200);
  };
  e.d = () => {
    if (!e.launched) {
      ctx.strokeStyle = (e.t * 6 | 0) % 2 ? '#ff2b2b' : '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(tx, FLOOR, U * 2.2, U * .3, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx - U * .4, FLOOR); ctx.lineTo(tx + U * .4, FLOOR); ctx.moveTo(tx, FLOOR - U * .15); ctx.lineTo(tx, FLOOR + U * .15); ctx.stroke();
    }
    drawPlane(e.px, 80, dir, '#4b5320');
  };
  ents.push(e);
}
function sendTank() {
  const [ax] = bodyCenter(arham), fromRight = ax < W / 2, dir = fromRight ? -1 : 1;
  const e = { x: fromRight ? W + U * 2 : -U * 2, stop: fromRight ? W - U * 1.6 : U * 1.6, state: 'in', t: 0, shots: 0, ang: fromRight ? Math.PI : 0, recoil: 0 };
  sfx('tank');
  e.u = dt => {
    e.recoil *= .85;
    if (e.state === 'in') {
      e.x += dir * U * .05;
      if ((e.x - e.stop) * dir >= 0) { e.state = 'fire'; e.t = .6; }
    } else if (e.state === 'fire') {
      const ty0 = FLOOR - U, [cx, cy] = bodyCenter(arham), want = Math.atan2(cy - ty0, cx - e.x);
      e.ang += (((want - e.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * .1;
      e.t -= dt;
      if (e.t <= 0 && e.shots < 5) {
        e.t = 1.3; e.shots++; e.recoil = 1; sfx('cannon'); shake = Math.max(shake, 8);
        const bx = e.x + Math.cos(e.ang) * U * 1.3, by = ty0 + Math.sin(e.ang) * U * 1.3;
        for (let i = 0; i < 8; i++) spawn('smoke', bx, by, Math.cos(e.ang) * rand(1, 3), Math.sin(e.ang) * rand(1, 3) - .5, rand(.4, .8), rand(8, 14), '#999');
        projectile({ x: bx, y: by, vx: Math.cos(e.ang) * U * .45, vy: Math.sin(e.ang) * U * .45, g: .15, r: 6,
          draw: p => { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill(); },
          onHit: (x, y) => explode(x, y, U * 2.2, U * .7, { text: 'BLAM!' }) });
      }
      if (e.shots >= 5 && e.t < .6) e.state = 'out';
    } else {
      e.x -= dir * U * .06;
      if (e.x < -U * 3 || e.x > W + U * 3) return false;
    }
    return true;
  };
  e.d = () => {
    const x = e.x, y = FLOOR, u = U;
    ctx.lineWidth = 3; ctx.strokeStyle = '#111';
    ctx.save(); ctx.translate(x, y - u); ctx.rotate(e.ang);
    ctx.fillStyle = '#3f4a2e'; ctx.fillRect(u * .2 - e.recoil * u * .2, -u * .09, u * 1.1, u * .18); ctx.strokeRect(u * .2 - e.recoil * u * .2, -u * .09, u * 1.1, u * .18);
    ctx.restore();
    ctx.fillStyle = '#5b6b3c'; ctx.beginPath(); ctx.arc(x, y - u * .95, u * .42, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b7d45'; ctx.beginPath(); ctx.roundRect(x - u * 1.2, y - u * .95, u * 2.4, u * .5, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.roundRect(x - u * 1.35, y - u * .5, u * 2.7, u * .5, u * .25); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#777';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + (i - 2) * u * .5, y - u * .25, u * .15, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.font = `bold ${u * .3}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', x, y - u * .7);
  };
  ents.push(e);
}

// --- Phase 4: Cosmic ---
function doLaser(dt) {
  const ox = pointer.x < W / 2 ? W - 20 : 20, oy = 90, tx = pointer.x, ty = pointer.y;
  const d = Math.hypot(tx - ox, ty - oy) || 1, n = Math.ceil(d / 6);
  let ex = tx, ey = ty, hit = null;
  for (let i = 1; i <= n; i++) {
    const x = ox + (tx - ox) * i / n, y = oy + (ty - oy) * i / n, h = hitAny(x, y, 0);
    if (h) { ex = x; ey = y; hit = h; break; }
  }
  laserBeam = { ox, oy, ex, ey };
  sfx('laser');
  spawn('spark', ex, ey, rand(-3, 3), rand(-3, 1), .2, 2.5, '#ff4d6d');
  if (hit) {
    const B = hit.B;
    hurt(B, dt * 30, 'fire'); B.char = Math.min(1, B.char + dt * .08); knock(B, 0);
    addVel(B.P[hit.i], (tx - ox) / d * .8, (ty - oy) / d * .8);
    if (Math.random() < dt * 4) addDecal(B, hit.f, ex, ey, 'soot', rand(0, 6), .5);
    if (Math.random() < .3) spawn('smoke', ex, ey, rand(-.5, .5), -1, .6, 6, '#444');
    if (Math.random() < .25) blood(ex, ey, 1, .6);
  }
}
function flipGravity() {
  gravDir = -1; flipT = 5;
  knock(arham, 0); if (boodieActive()) hurt(boodie, 1);
  for (const q of props) addVel(q, 0, -2);
  sfx('ufo'); flash = .4; flashColor = '#c77dff';
  popText(W / 2, FLOOR * .4, 'GRAVITY FLIP!', '#c77dff', 46);
}
function spawnBlackHole(x, y) {
  const e = { x, y: Math.min(y, FLOOR - U), t: 0, dur: 4 };
  sfx('blackhole');
  e.u = dt => {
    e.t += dt;
    const pull = U * .045 * Math.min(1, e.t * 2), force = d => pull * clamp(2.5 * U / (d + U), 0, 2);
    for (const B of bodies()) {
      let near = false, inRange = false;
      for (const p of B.P) {
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, f = force(d);
        addVel(p, dx / d * f, dy / d * f);
        if (d < U * .6) near = true; if (d < U * 3) inRange = true;
      }
      if (inRange) { knock(B, 0); if (B.kind === 'boodie') hurt(B, 1); }
      if (near) { hurt(B, dt * 12); if (Math.random() < .2) blood(e.x, e.y, 1, .5); }
    }
    for (const q of props) { const dx = e.x - q.x, dy = e.y - q.y, d = Math.hypot(dx, dy) || 1, f = force(d); addVel(q, dx / d * f, dy / d * f); }
    if (Math.random() < .6) {
      const a = rand(0, 7), r = U * rand(1.2, 2);
      spawn('spark', e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, -Math.cos(a) * 3 - Math.sin(a) * 3, -Math.sin(a) * 3 + Math.cos(a) * 3, .5, 2.5, '#c77dff');
    }
    if (e.t >= e.dur) { explode(e.x, e.y, U * 2.2, U * .6, { text: 'POP!', small: true, snd: 'pop' }); return false; }
    return true;
  };
  e.d = () => {
    const r = Math.max(1, U * .45 * Math.min(1, e.t * 3) * (e.t > e.dur - .2 ? (e.dur - e.t) / .2 : 1));
    const g = ctx.createRadialGradient(e.x, e.y, r * .6, e.x, e.y, r * 2.6);
    g.addColorStop(0, 'rgba(160,80,255,.8)'); g.addColorStop(1, 'rgba(60,0,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, r * 2.6, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.t * 6); ctx.strokeStyle = '#e0aaff'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, r * (1.3 + i * .35), i * 2, i * 2 + 2.2); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, 7); ctx.fill();
  };
  ents.push(e);
}
function dropMeteor(tx, ty) {
  const x0 = tx + (tx < W / 2 ? 1 : -1) * U * 5, y0 = -U * 2;
  sfx('meteor');
  projectile({ x: x0, y: y0, ...aimAt(x0, y0, tx, ty, U * .5), r: U * .5, spin: .08,
    draw: p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
      ctx.fillStyle = '#6b4f3a'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, rr = p.r * (i % 2 ? .85 : 1); i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(rr, 0); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a3627'; ctx.beginPath(); ctx.arc(p.r * .3, -p.r * .2, p.r * .22, 0, 7); ctx.fill(); ctx.restore();
    },
    trail: p => { for (let i = 0; i < 3; i++) spawn('flame', p.x + rand(-p.r, p.r) * .6, p.y + rand(-p.r, p.r) * .6, -p.vx * .15, -p.vy * .15, rand(.3, .6), rand(12, 22), '#ff9f1c'); },
    onHit: (x, y) => { explode(x, y, U * 3.6, U * 1.05, { fire: true, text: 'IMPACT!' }); shake = 40; } });
}
function summonUFO() {
  const [ax] = bodyCenter(arham);
  const e = { x: ax > W / 2 ? -U * 2 : W + U * 2, y: 110, state: 'in', t: 0 };
  sfx('ufo');
  e.u = dt => {
    e.t += dt;
    const [cx] = bodyCenter(arham);
    if (e.state === 'in') {
      e.x += clamp(cx - e.x, -U * .08, U * .08);
      if (Math.abs(cx - e.x) < U * .2) { e.state = 'beam'; e.bt = 0; sfx('ufo'); }
    } else if (e.state === 'beam') {
      e.bt += dt; e.x += clamp(cx - e.x, -U * .02, U * .02);
      for (const B of bodies()) {
        const [bx] = bodyCenter(B); if (Math.abs(bx - e.x) > U * 1.3) continue;
        knock(B, 0); hurt(B, B.kind === 'boodie' ? 1 : dt * 6);
        for (const p of B.P) {
          const vy = p.y - p.py, want = p.y > e.y + U * 1.2 ? -U * .06 : 0;
          addVel(p, (e.x - p.x) * .003, (want - vy) * .2 - grav());
        }
      }
      if (e.bt > 3) { e.state = 'out'; popText(e.x, e.y + 40, 'BYE!', '#80ed99', 32); }
    } else { e.y -= U * .08; e.x += U * .05; if (e.y < -U * 2) return false; }
    return true;
  };
  e.d = () => {
    const y = e.y + Math.sin(e.t * 3) * 6, u = U;
    if (e.state === 'beam') {
      ctx.fillStyle = `rgba(180,255,150,${.2 + .08 * Math.sin(e.t * 20)})`;
      ctx.beginPath(); ctx.moveTo(e.x - u * .5, y + 10); ctx.lineTo(e.x + u * .5, y + 10); ctx.lineTo(e.x + u * 1.4, FLOOR); ctx.lineTo(e.x - u * 1.4, FLOOR); ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 3; ctx.strokeStyle = '#111';
    ctx.fillStyle = 'rgba(150,230,255,.85)'; ctx.beginPath(); ctx.ellipse(e.x, y - u * .15, u * .5, u * .4, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#80ed99'; ctx.beginPath(); ctx.arc(e.x, y - u * .25, u * .16, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(e.x - u * .06, y - u * .27, u * .04, u * .06, 0, 0, 7); ctx.ellipse(e.x + u * .06, y - u * .27, u * .04, u * .06, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#9aa5b1'; ctx.beginPath(); ctx.ellipse(e.x, y, u * 1.2, u * .3, 0, 0, 7); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 5; i++) { ctx.fillStyle = ((e.t * 8 | 0) + i) % 2 ? '#ffd84d' : '#ff5d9e'; ctx.beginPath(); ctx.arc(e.x + (i - 2) * u * .42, y + u * .05, u * .07, 0, 7); ctx.fill(); }
  };
  ents.push(e);
}

// --- Phase 5: Cartoon Chaos ---
function throwPie(tx, ty) {
  const x0 = tx < W / 2 ? 10 : W - 10, y0 = FLOOR - U, v = lob(x0, y0, tx, ty, 34);
  sfx('whoosh');
  projectile({ x: x0, y: y0, ...v, g: 1, r: 10, spin: .15,
    draw: p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.fillStyle = '#d4a373'; ctx.beginPath(); ctx.ellipse(0, 4, 16, 6, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 7, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(0, -7, 3, 0, 7); ctx.fill(); ctx.restore();
    },
    onHit: (x, y, h) => {
      sfx('splat');
      for (let i = 0; i < 14; i++) spawn('drop', x, y, rand(-4, 4), rand(-5, 1), rand(.5, 1), rand(3, 6), '#fffaf0');
      popText(x, y - 14, 'SPLAT!', '#fff', 34);
      if (h) { addDecal(h.B, h.f, x, y, 'pie', rand(-.4, .4), 1.2); addVel(h.B.P[h.i], v.vx * .3, -2); hurt(h.B, 3); }
    } });
}
function releaseBees(x, y) {
  const e = { t: 10, bees: Array.from({ length: 14 }, () => ({ x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-3, 3), vy: rand(-3, 3), cd: rand(0, 1), tgt: (Math.random() * 14) | 0 })) };
  e.u = dt => {
    e.t -= dt;
    if (Math.random() < .08) sfx('buzz');
    for (const b of e.bees) {
      b.cd -= dt;
      const p = arham.P[b.tgt], tx = e.t > 0 ? p.x : b.x + b.vx * 10, ty = e.t > 0 ? p.y : -300;
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
      b.vx += dx / d * .7 + rand(-1.2, 1.2); b.vy += dy / d * .7 + rand(-1.2, 1.2);
      const sp = Math.hypot(b.vx, b.vy), mx = U * .11; if (sp > mx) { b.vx *= mx / sp; b.vy *= mx / sp; }
      b.x += b.vx; b.y += b.vy;
      if (e.t > 0 && d < p.r + 6 && b.cd <= 0) {
        b.cd = rand(.6, 1.1); b.tgt = (Math.random() * 14) | 0;
        hurt(arham, 1.5); addVel(p, rand(-2, 2), rand(-2, 0)); arham.stand = Math.max(0, arham.stand - .05);
        blood(b.x, b.y, 2, .5);
        if (Math.random() < .15) popText(b.x, b.y - 10, 'STING!', '#ffd84d', 22);
      }
    }
    return e.t > -3;
  };
  e.d = () => {
    for (const b of e.bees) {
      const f = Math.abs(Math.sin(time * 60 + b.x)) * 3;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.ellipse(b.x - 2, b.y - 5, 4, 2 + f, -.5, 0, 7); ctx.ellipse(b.x + 2, b.y - 5, 4, 2 + f, .5, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd60a'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 6, 4.5, Math.atan2(b.vy, b.vx), 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillRect(b.x - 1.5, b.y - 4, 3, 8);
    }
  };
  ents.push(e);
}
function launchNuke(tx) {
  const e = { t: 2.2, s: -1 };
  e.u = dt => {
    e.t -= dt;
    const beat = e.t * 2.5 | 0; if (beat !== e.s) { e.s = beat; sfx('siren'); }
    if (e.t <= 0) {
      projectile({ x: tx, y: -U * 2, vx: 0, vy: U * .15, g: 1, r: U * .35, draw: drawNukeBomb, onHit: (x, y) => nukeBlast(x, y) });
      return false;
    }
    return true;
  };
  e.d = () => {
    ctx.fillStyle = `rgba(255,0,0,${.12 + .1 * Math.sin(time * 12)})`; ctx.fillRect(-60, -60, W + 120, H + 120);
    if ((e.t * 5 | 0) % 2) {
      ctx.save(); ctx.font = `900 ${Math.min(56, W / 12)}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ff2b2b';
      ctx.strokeText('☢ NUKE INCOMING ☢', W / 2, FLOOR * .35); ctx.fillText('☢ NUKE INCOMING ☢', W / 2, FLOOR * .35); ctx.restore();
    }
  };
  ents.push(e);
}
function drawNukeBomb(p) {
  const r = p.r;
  ctx.save(); ctx.translate(p.x, p.y); ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.fillStyle = '#555'; ctx.fillRect(-r * .8, -r * 1.9, r * 1.6, r * .45); ctx.strokeRect(-r * .8, -r * 1.9, r * 1.6, r * .45);
  ctx.fillStyle = '#3d5a3d'; ctx.beginPath(); ctx.ellipse(0, 0, r * .8, r * 1.5, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(0, 0, r * .45, 0, 7); ctx.fill();
  ctx.fillStyle = '#111'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * .4, i * 2.09 - .5, i * 2.09 + .5); ctx.fill(); }
  ctx.restore();
}
function nukeBlast(x, y) {
  explode(x, y, Math.max(W, H) * 1.2, U * 1.5, { fire: true, text: '☢ NUKED ☢' });
  flash = 1.6; flashColor = '#ffffff'; shake = 60;
  for (const B of bodies()) B.char = Math.min(1, B.char + .5);
  for (let i = 0; i < 70; i++) {
    const cap = i < 45;
    spawn('smoke', x + rand(-1, 1) * (cap ? U * 2.2 : U * .5), cap ? FLOOR - U * rand(4, 5.5) : FLOOR - U * rand(0, 4), rand(-1.5, 1.5), rand(-1.2, -.2), rand(2, 3.5), rand(25, 50), pick(['#6b5b4e', '#8d6e63', '#ff9f1c', '#4e4039']));
  }
  setTimeout(() => sfx('boom'), 180);
}

// click actions per tool (hand and knife are handled by the pointer code)
const ACTIONS = {
  punch: (x, y) => doPunch(x, y),
  pistol: (x, y) => doShoot(x, y),
  ball: (x, y) => { addProp('ball', x, Math.min(y, FLOOR - U)); sfx('pop'); },
  bomb: (x, y) => { addProp('bomb', x, Math.min(y, FLOOR - U)); sfx('pop'); },
  anvil: x => { const a = addProp('anvil', x, -U); addVel(a, 0, -U * .1); sfx('whoosh'); },
  lightning: (x, y) => strikeLightning(x, y),
  molotov: throwMolotov, firework: x => launchFirework(x), fireball: castFireball, lava: x => lavaRain(x), napalm: x => napalmStrike(x),
  grenade: (x, y) => { const g = addProp('grenade', x, Math.min(y, FLOOR - U)); addVel(g, rand(-2, 2), -4); sfx('pop'); },
  mine: x => placeMine(x), rpg: fireRPG, airstrike: x => callAirstrike(x), tank: () => sendTank(),
  gravflip: () => flipGravity(), blackhole: spawnBlackHole, meteor: dropMeteor, ufo: () => summonUFO(),
  chicken: (x, y) => doPunch(x, y, { e: '🐔', mult: 1.7, dmg: 8, snd: 'squeak', words: ['BONK!', 'SQUAWK!', 'BAWK!'] }),
  pie: throwPie, bees: releaseBees, nuke: x => launchNuke(x),
  piano: x => { const a = addProp('piano', x, -U * 1.5); addVel(a, 0, -U * .1); sfx('whoosh'); },
};
// hold-to-use tools, run every step while the pointer is down
const HOLD = {
  fire: dt => doFire(dt),
  laser: doLaser,
  smg: dt => { smgCd -= dt; if (smgCd <= 0) { smgCd = .075; doShoot(pointer.x + rand(-8, 8), pointer.y + rand(-8, 8), true); } },
};

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
    default: if (ACTIONS[tool]) ACTIONS[tool](x, y);
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
  if (B.ko) B.koT += dt;
  // open wounds keep dripping
  B.bleed = Math.max(0, B.bleed - dt * .025);
  if (B.bleed > .02 && Math.random() < B.bleed * .6) {
    const d = B.decals.length ? B.decals[(Math.random() * B.decals.length) | 0] : null;
    let x, y;
    if (d && d.kind !== 'soot' && d.kind !== 'pie') [x, y] = toWorld(frame(B, d.f), d.lx, d.ly);
    else { const q = P[(Math.random() * 14) | 0]; x = q.x; y = q.y; }
    spawn('drop', x, y, rand(-.4, .4), rand(0, 1), rand(.6, 1.2), rand(1.5, 3), '#d7263d');
  }

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
    if (!(grab && grab.B === B) && gravDir > 0 && B.sinceHurt > 1.3 && B.pain < 70 && B.onFire <= 0 && B.zapped <= 0) B.stand = Math.min(1, B.stand + dt * .6);
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
  const G = grav();
  updateMeter(dt);
  if (flipT > 0) { flipT -= dt; knock(arham, 0); if (flipT <= 0) { gravDir = 1; popText(W / 2, FLOOR * .4, 'Gravity restored', '#c77dff', 30); } }
  if (laserBeam) laserBeam = null;
  idleTimer += dt;
  if (idleTimer > 7) { idleTimer = 0; if (!boodieActive()) say(arham, 'idle', true); }
  if (pointer.down && HOLD[tool]) HOLD[tool](dt);

  if (boodie && boodie.koT > BOODIE_FADE + 1) {
    const [x, y] = bodyCenter(boodie);
    for (let i = 0; i < 20; i++) spawn('smoke', x + rand(-U, U), y + rand(-U * 1.5, U), rand(-1.5, 1.5), rand(-2, 0), rand(.6, 1.1), rand(14, 26), '#fff');
    sfx('pop'); boodie = null; if (grab && grab.B && grab.B.kind === 'boodie') grab = null;
    refreshTools();
  }
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
        if (HEAVY[q.type]) { sfx(HEAVY[q.type]); shake = Math.max(shake, 12); } else sfx('thud', vy2 / U);
      }
      q.y = FLOOR - q.r; q.py = q.y + vy2 * q.bounce;
      q.px = q.x - (q.x - q.px) * q.fric;
    }
    if (q.x - q.r < 0) { const vx2 = q.x - q.px; q.x = q.r; q.px = q.x + vx2 * .5; }
    if (q.x + q.r > W) { const vx2 = q.x - q.px; q.x = W - q.r; q.px = q.x + vx2 * .5; }
    q.ang += (q.x - q.px) / q.r * (HEAVY[q.type] ? .1 : 1);
    if (HEAVY[q.type]) q.ang *= .9;
    if (q.fuse > 0) {
      q.fuse -= dt;
      if (Math.random() < .5) spawn('spark', q.x + Math.sin(q.ang - .6) * q.r * 1.3, q.y - Math.cos(q.ang - .6) * q.r * 1.3, rand(-2, 2), rand(-3, 0), .2, 2, '#ffd84d');
      if ((q.fuse * 8 | 0) % 2 === 0) sfx('fuse');
    }
  }
  for (let i = props.length - 1; i >= 0; i--) {
    const q = props[i];
    if (q.fuse && q.fuse <= 0) {
      props.splice(i, 1); if (grab && grab.ref === q) grab = null;
      if (q.type === 'grenade') { explode(q.x, q.y, U * 2.4, U * .65, { text: 'FRAG!' }); for (let k = 0; k < 20; k++) spawn('spark', q.x, q.y, rand(-18, 18), rand(-18, 8), rand(.2, .4), 2, '#ccc'); }
      else explode(q.x, q.y, U * 3.2, U * .75);
    }
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
      if (HEAVY[q.type]) { sfx(HEAVY[q.type]); shake = Math.max(shake, 16); popText(p.x, p.y - 20, q.type === 'piano' ? 'PLONK!' : 'CLANG!', '#ddd', 40); blood(p.x, p.y, 16, 1.5); }
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

  // entities (projectiles, vehicles, swarms…); new ones pushed mid-loop run next step
  for (let i = ents.length - 1; i >= 0; i--) if (!ents[i].u(dt)) ents.splice(i, 1);

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    q.x += q.vx; q.y += q.vy;
    if (q.type === 'drop' || q.type === 'spark' || q.type === 'shell' || q.type === 'tooth') q.vy += G * 1.1;
    if (q.type === 'flame') { q.vy -= .05; q.size *= .985; }
    if (q.type === 'smoke') { q.size *= 1.01; q.vx *= .98; }
    if (q.type === 'drop' && q.y > FLOOR) {
      floorStains.push({ x: q.x, y: FLOOR + rand(2, 10), r: q.size * rand(1.5, 3.2), life: 35, c: q.color === '#d7263d' ? null : q.color });
      if (floorStains.length > 140) floorStains.shift();
      q.life = 0;
    }
    if ((q.type === 'shell' || q.type === 'tooth') && q.y > FLOOR - 3) { q.y = FLOOR - 3; q.vy *= -.4; q.vx *= .7; }
    if (q.type === 'drop' && (q.x < 2 || q.x > W - 2)) { wallSplat(clamp(q.x, 8, W - 8), q.y, .3); q.life = 0; }
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
  shake *= .88; flash = Math.max(0, flash - dt * 3); hurtFx = Math.max(0, hurtFx - dt * 1.2);
}

function collideWalls(B, p, detect) {
  const u = B.u;
  if (p.y + p.r > FLOOR) {
    const vy = p.y - p.py;
    if (detect && vy > u * .22 && p.hitCd <= 0) {
      p.hitCd = .25;
      const dmg = (vy / u - .2) * 14;
      sfx('thud', vy / u * 1.5);
      if (dmg > 3) { hurt(B, dmg); shake = Math.max(shake, dmg * .6); sparks(p.x, FLOOR, 5, '#fff'); knock(B, 0); dust(p.x, 8); if (dmg > 6) { blood(p.x, FLOOR - 5, 6, 1); ring(p.x, FLOOR - 4, u * .8); } }
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
    if (m.blood) {
      ctx.fillStyle = '#8f1424';
      for (const [bx, by, br] of m.blobs) { ctx.beginPath(); ctx.arc(m.x + bx, m.y + by, br, 0, 7); ctx.fill(); }
      ctx.strokeStyle = '#8f1424'; ctx.lineCap = 'round'; ctx.lineWidth = 3 * m.r;
      for (const [dx, len] of m.drips) { const grow = Math.min(1, (40 - m.life) / 3); ctx.beginPath(); ctx.moveTo(m.x + dx, m.y); ctx.lineTo(m.x + dx, m.y + len * grow); ctx.stroke(); }
    } else if (m.hole) {
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
    ctx.fillStyle = s.c || '#9b1b2c';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * .35, 0, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const B of bodies()) {
    const [bcx] = bodyCenter(B);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(bcx, FLOOR + 4, B.u * 1.1, B.u * .15, 0, 0, 7); ctx.fill();
  }
  for (const B of bodies()) {
    ctx.globalAlpha = B.ko ? clamp(BOODIE_FADE + 1 - B.koT, 0, 1) : 1;
    drawBuddy(B);
    ctx.globalAlpha = 1;
  }
  for (const q of props) drawProp(q);
  for (const e of ents) if (e.d) e.d();
  if (laserBeam) {
    for (const [w, c] of [[16, 'rgba(255,40,90,.25)'], [7, '#ff4d6d'], [2.5, '#fff']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(laserBeam.ox, laserBeam.oy); ctx.lineTo(laserBeam.ex, laserBeam.ey); ctx.stroke();
    }
    ctx.fillStyle = '#9aa5b1'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(laserBeam.ox, laserBeam.oy, 16, 0, 7); ctx.fill(); ctx.stroke();
  }

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
    } else if (q.type === 'drop') {
      ctx.strokeStyle = q.color; ctx.lineWidth = q.size * 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * .8, q.y - q.vy * .8); ctx.stroke();
    } else if (q.type === 'ring') {
      ctx.strokeStyle = q.color; ctx.lineWidth = 4 * a;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.3 - a), 0, 7); ctx.stroke();
    } else if (q.type === 'tooth') {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.life * 8); ctx.fillStyle = q.color; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(-4, -5, 8, 10, [2, 2, 4, 4]); ctx.fill(); ctx.stroke(); ctx.restore();
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
    ctx.fillText(f.e, f.x, f.y); ctx.restore();
  }

  for (const B of bodies()) drawBubble(B);
  ctx.restore();

  if (flipT > 0) {
    ctx.font = '900 22px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.fillStyle = '#e0aaff';
    const t = `🙃 GRAVITY FLIPPED ${flipT.toFixed(1)}s`; ctx.strokeText(t, W / 2, 110); ctx.fillText(t, W / 2, 110);
  }
  if (tool === 'fire' && pointer.down) {
    ctx.font = '36px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔥', pointer.x, pointer.y + 26);
  }
  if (hurtFx > .01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75);
    g.addColorStop(0, 'rgba(170,0,20,0)'); g.addColorStop(1, `rgba(170,0,20,${hurtFx})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
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
      case 'pie':
        ctx.fillStyle = 'rgba(255,250,240,.96)'; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.arc(0, 0, 13 * s, 0, 7); ctx.arc(-10 * s, 5 * s, 8 * s, 0, 7); ctx.arc(10 * s, 4 * s, 7 * s, 0, 7); ctx.arc(3 * s, -9 * s, 7 * s, 0, 7); ctx.fill();
        ctx.fillRect(-7 * s, 8 * s, 4 * s, 10 * s); ctx.fillRect(5 * s, 8 * s, 3 * s, 7 * s);
        ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(2 * s, -4 * s, 3.5 * s, 0, 7); ctx.fill();
        break;
      case 'blood':
        ctx.fillStyle = 'rgba(160,15,30,.85)';
        ctx.beginPath(); ctx.arc(0, 0, 6 * s, 0, 7); ctx.arc(5 * s, 3 * s, 3.5 * s, 0, 7); ctx.arc(-4 * s, 4 * s, 3 * s, 0, 7); ctx.arc(2 * s, -5 * s, 2.5 * s, 0, 7); ctx.fill();
        ctx.fillRect(-1.5 * s, 3 * s, 3 * s, 10 * s); ctx.beginPath(); ctx.arc(0, 13 * s, 2.2 * s, 0, 7); ctx.fill();
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
  } else if (q.type === 'grenade') {
    ctx.fillStyle = '#556b2f'; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.2, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
    for (const k of [-.4, 0, .4]) { ctx.beginPath(); ctx.moveTo(-r, k * r); ctx.lineTo(r, k * r); ctx.stroke(); }
    ctx.fillStyle = '#999'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.fillRect(-r * .35, -r * 1.55, r * .7, r * .4); ctx.strokeRect(-r * .35, -r * 1.55, r * .7, r * .4);
    if ((q.fuse * 8 | 0) % 2 === 0) { ctx.fillStyle = '#ff2b2b'; ctx.beginPath(); ctx.arc(0, -r * 1.35, r * .15, 0, 7); ctx.fill(); }
  } else if (q.type === 'piano') {
    ctx.fillStyle = '#1d1d1d'; ctx.beginPath(); ctx.roundRect(-r * 1.1, -r, r * 2.2, r * 1.75, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-r * 1.2, -r * 1.1, r * 2.4, r * .2); ctx.strokeRect(-r * 1.2, -r * 1.1, r * 2.4, r * .2);
    ctx.fillStyle = '#fff'; ctx.fillRect(-r, -r * .05, r * 2, r * .32); ctx.strokeRect(-r, -r * .05, r * 2, r * .32);
    ctx.fillStyle = '#111'; for (let k = 0; k < 11; k++) if (k % 7 !== 2 && k % 7 !== 6) ctx.fillRect(-r + (k + .7) * r * 2 / 12, -r * .05, r * .08, r * .19);
    ctx.fillStyle = '#1d1d1d'; ctx.fillRect(-r * .95, r * .75, r * .15, r * .25); ctx.fillRect(r * .8, r * .75, r * .15, r * .25);
    ctx.fillStyle = '#d4af37'; ctx.font = `bold ${r * .25}px serif`; ctx.textAlign = 'center'; ctx.fillText('♫', 0, -r * .45);
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
// ---------- shop ----------
const PHASES = [
  { name: 'Starter Stuff', desc: 'The classics. Every stress-relief journey starts here.' },
  { name: 'Inferno', desc: 'Everything in this aisle is on fire. Please do not touch.' },
  { name: 'Warzone', desc: 'Army surplus. No questions asked.' },
  { name: 'Cosmic', desc: 'Imported from outer space. Warranty void on Earth.' },
  { name: 'Cartoon Chaos', desc: 'Physics has left the building.' },
];
// The shopkeeper. Change anything here to restyle or rename him.
const SHOPKEEPER = {
  name: 'Gus',
  title: 'Proprietor of Pain',
  skin: '#c98b5b', hair: '#2d1b10', shirt: '#f4a261', apron: '#264653',
  mustache: true, glasses: true, beard: false,
  hats: ['cap', 'fire', 'army', 'space', 'clown'], // one per shop phase: cap | fire | army | space | clown | none
  lines: {
    hello: ["Welcome, welcome! Everything's for sale.", 'Back again? {n} still standing?', 'Hurt him a little, earn a little.', 'Browse all you like. Touching costs extra.'],
    buy: ['Pleasure doing business!', 'No refunds!', 'Ooh, {n} is gonna feel that.', 'Excellent choice.', 'Enjoy responsibly. Or not.'],
    broke: ['Come back with more bucks, friend.', 'Credit? Ha! Cash only.', "Hit {n} a bit more and we'll talk."],
    locked: ["That aisle's locked. Fill the pain meter!", 'Not yet! Max out the pain meter first.'],
    busy: ["Boodie's still out there swinging!", 'One Boodie at a time, please.'],
  },
};
let shopOpen = false, keeperTalk = 0, keeperBlink = 0;

function keeperSay(kind) {
  $('keeperSay').textContent = pick(SHOPKEEPER.lines[kind]).replace('{n}', buddyName);
  keeperTalk = 1.4;
}
function openShop(on) {
  shopOpen = on;
  $('shop').classList.toggle('open', on);
  $('shopScrim').hidden = !on;
  if (on) {
    if (shopHasNew) { shopHasNew = false; shopPhase = phasesUnlocked; }
    keeperSay('hello'); renderShop(); buildTools();
  }
}
function renderShop() {
  const tabs = $('phaseTabs'); tabs.innerHTML = '';
  PHASES.forEach((ph, i) => {
    const n = i + 1, locked = n > phasesUnlocked, b = document.createElement('button');
    b.className = 'ptab' + (n === shopPhase ? ' on' : '') + (locked ? ' locked' : '');
    b.textContent = locked ? `🔒${n}` : n; b.title = locked ? 'Fill the pain meter to unlock' : ph.name;
    b.onclick = () => { if (locked) { sfx('deny'); keeperSay('locked'); return; } shopPhase = n; renderShop(); };
    tabs.appendChild(b);
  });
  const ph = PHASES[shopPhase - 1];
  $('shop').className = (shopOpen ? 'open ' : '') + 'ph' + shopPhase;
  $('phaseName').textContent = `Phase ${shopPhase}: ${ph.name}`;
  $('phaseDesc').textContent = ph.desc;
  const grid = $('shopGrid'); grid.innerHTML = '';
  for (const t of TOOLS.filter(t => t.phase === shopPhase)) {
    const owned = unlocked.has(t.id), card = document.createElement('div');
    card.className = 'item' + (owned ? ' owned' : '');
    card.dataset.price = t.price;
    const label = owned ? (t.spawn ? (boodieActive() ? 'Fighting…' : 'Spawn') : tool === t.id ? 'Equipped ✓' : 'Equip') : `$${t.price}`;
    card.innerHTML = `<div class="iic">${t.icon}</div><div class="inm">${t.name}</div><div class="ids">${t.desc}</div><button class="ibuy">${label}</button>`;
    card.querySelector('button').onclick = () => buyOrEquip(t);
    grid.appendChild(card);
  }
  refreshAffordable();
}
function buyOrEquip(t) {
  initAudio();
  if (!unlocked.has(t.id)) {
    if (bucks < t.price) { sfx('deny'); keeperSay('broke'); return; }
    bucks -= t.price; unlocked.add(t.id);
    store.set('unlocked', [...unlocked]); store.set('bucks', bucks);
    $('bucksVal').textContent = bucks;
    sfx('buy'); keeperSay('buy');
    if (!t.spawn) { tool = t.id; }
    buildTools(); renderShop();
    return;
  }
  if (t.spawn) {
    if (boodieActive()) { sfx('deny'); keeperSay('busy'); return; }
    spawnBoodie(); openShop(false); return;
  }
  tool = t.id; buildTools(); openShop(false);
}

// ---------- toolbar ----------
function buildTools() {
  const box = $('tools'); box.innerHTML = '';
  const shop = document.createElement('div');
  shop.className = 'tool shopbtn';
  shop.innerHTML = `<div class="ic">🏪</div><div>Shop</div>` + (shopHasNew ? '<i>NEW</i>' : '');
  shop.addEventListener('click', () => { initAudio(); openShop(!shopOpen); });
  box.appendChild(shop);
  for (const t of TOOLS) {
    if (!unlocked.has(t.id)) continue;
    const b = document.createElement('div');
    b.className = 'tool'; b.dataset.id = t.id;
    b.innerHTML = `<div class="ic">${t.icon}</div><div>${t.name}</div>`;
    b.addEventListener('click', () => selectTool(t));
    box.appendChild(b);
  }
  refreshTools();
}
function refreshTools() {
  for (const el of document.querySelectorAll('.tool[data-id]')) {
    const t = TOOLS.find(x => x.id === el.dataset.id);
    el.classList.toggle('active', t.id === tool);
    el.classList.toggle('busy', !!t.spawn && boodieActive());
  }
  if (shopOpen) for (const b of document.querySelectorAll('#shopGrid .item.owned .ibuy')) if (b.textContent === 'Fighting…' || b.textContent === 'Spawn') b.textContent = boodieActive() ? 'Fighting…' : 'Spawn';
  refreshAffordable();
}
function refreshAffordable() {
  const any = TOOLS.some(t => t.phase <= phasesUnlocked && !unlocked.has(t.id) && bucks >= t.price);
  const s = document.querySelector('.tool.shopbtn'); if (s) s.classList.toggle('affordable', any);
  for (const c of document.querySelectorAll('#shopGrid .item:not(.owned)')) c.classList.toggle('can', bucks >= +c.dataset.price);
}
function selectTool(t) {
  initAudio();
  if (t.spawn) {
    if (boodieActive()) { sfx('deny'); toast('Boodie is still fighting! Knock her out to spawn a new one.'); return; }
    spawnBoodie();
    return;
  }
  tool = t.id;
  refreshTools();
}

// ---------- shopkeeper portrait ----------
function drawKeeper(dt) {
  const c = $('keeperCv'), k = c.getContext('2d'), S = c.width, K = SHOPKEEPER;
  keeperTalk -= dt; keeperBlink -= dt; if (keeperBlink < -3 - Math.random() * 2) keeperBlink = .12;
  const hat = K.hats[shopPhase - 1] || 'none';
  const bob = Math.sin(time * 2) * 3, cx = S / 2, hy = S * .44 + bob, R = S * .21;
  k.clearRect(0, 0, S, S);
  k.lineWidth = 5; k.strokeStyle = '#1a1a1a'; k.lineJoin = 'round'; k.lineCap = 'round';
  // body + apron
  k.fillStyle = K.shirt; k.beginPath(); k.roundRect(cx - S * .34, S * .72 + bob, S * .68, S * .5, S * .15); k.fill(); k.stroke();
  k.fillStyle = K.apron; k.beginPath(); k.roundRect(cx - S * .2, S * .78 + bob, S * .4, S * .4, 10); k.fill(); k.stroke();
  k.fillStyle = '#ffd84d'; k.font = `900 ${S * .11}px "Trebuchet MS", sans-serif`; k.textAlign = 'center'; k.textBaseline = 'middle';
  k.fillText('$', cx, S * .9 + bob);
  // neck, ears, head
  k.fillStyle = K.skin; k.fillRect(cx - S * .06, hy + R * .75, S * .12, S * .12);
  for (const s of [-1, 1]) { k.beginPath(); k.ellipse(cx + s * R * .98, hy + R * .08, R * .16, R * .22, 0, 0, 7); k.fill(); k.stroke(); }
  k.beginPath(); k.arc(cx, hy, R, 0, 7); k.fill(); k.stroke();
  if (hat !== 'space' && hat !== 'clown') { // side hair
    k.fillStyle = K.hair;
    for (const s of [-1, 1]) { k.beginPath(); k.ellipse(cx + s * R * .8, hy - R * .3, R * .22, R * .35, s * .3, 0, 7); k.fill(); }
  }
  if (hat === 'clown') {
    for (const [i, col] of ['#ff5d9e', '#ffd84d', '#4cc9f0', '#80ed99'].entries()) for (const s of [-1, 1]) {
      k.fillStyle = col; k.beginPath(); k.arc(cx + s * R * (1.05 + (i % 2) * .15), hy - R * .5 + i * R * .25, R * .22, 0, 7); k.fill();
    }
  }
  // eyes
  k.fillStyle = '#1a1a1a';
  for (const s of [-1, 1]) {
    const ex = cx + s * R * .38, ey = hy - R * .08;
    if (keeperBlink > 0) { k.beginPath(); k.moveTo(ex - R * .12, ey); k.lineTo(ex + R * .12, ey); k.stroke(); }
    else { k.beginPath(); k.arc(ex, ey, R * .1, 0, 7); k.fill(); }
  }
  if (K.glasses) {
    k.lineWidth = 4;
    for (const s of [-1, 1]) { k.beginPath(); k.arc(cx + s * R * .38, hy - R * .08, R * .24, 0, 7); k.stroke(); }
    k.beginPath(); k.moveTo(cx - R * .14, hy - R * .1); k.lineTo(cx + R * .14, hy - R * .1); k.stroke();
    k.lineWidth = 5;
  }
  // nose
  if (hat === 'clown') { k.fillStyle = '#ff2b2b'; k.beginPath(); k.arc(cx, hy + R * .18, R * .17, 0, 7); k.fill(); k.stroke(); }
  else { k.beginPath(); k.arc(cx, hy + R * .15, R * .12, .3, Math.PI - .3); k.stroke(); }
  // mouth (talks while speaking)
  const my = hy + R * .52;
  if (keeperTalk > 0) {
    k.fillStyle = '#6b1020'; k.beginPath(); k.ellipse(cx, my, R * .2, R * (.06 + .1 * Math.abs(Math.sin(time * 22))), 0, 0, 7); k.fill(); k.stroke();
  } else { k.beginPath(); k.arc(cx, my - R * .15, R * .28, .2 * Math.PI, .8 * Math.PI); k.stroke(); }
  if (K.beard) { k.fillStyle = K.hair; k.beginPath(); k.arc(cx, hy + R * .35, R * .75, .1 * Math.PI, .9 * Math.PI); k.fill(); }
  if (K.mustache) {
    k.fillStyle = K.hair; k.beginPath();
    k.moveTo(cx, my - R * .2);
    k.bezierCurveTo(cx - R * .25, my - R * .38, cx - R * .55, my - R * .25, cx - R * .6, my - R * .05);
    k.bezierCurveTo(cx - R * .4, my - R * .15, cx - R * .2, my - R * .1, cx, my - R * .12);
    k.bezierCurveTo(cx + R * .2, my - R * .1, cx + R * .4, my - R * .15, cx + R * .6, my - R * .05);
    k.bezierCurveTo(cx + R * .55, my - R * .25, cx + R * .25, my - R * .38, cx, my - R * .2);
    k.fill();
  }
  // hats per phase
  const top = hy - R * .35;
  k.lineWidth = 5; k.strokeStyle = '#1a1a1a';
  if (hat === 'cap') {
    k.fillStyle = '#e63946'; k.beginPath(); k.arc(cx, top, R * .95, Math.PI, 0); k.closePath(); k.fill(); k.stroke();
    k.beginPath(); k.ellipse(cx + R * .75, top, R * .6, R * .13, 0, 0, 7); k.fill(); k.stroke();
    k.fillStyle = '#fff'; k.font = `900 ${R * .45}px "Trebuchet MS", sans-serif`; k.fillText('G', cx, top - R * .45);
  } else if (hat === 'fire') {
    k.fillStyle = '#d62828'; k.beginPath(); k.ellipse(cx, top + R * .05, R * 1.4, R * .24, 0, 0, 7); k.fill(); k.stroke();
    k.beginPath(); k.arc(cx, top, R * .95, Math.PI, 0); k.closePath(); k.fill(); k.stroke();
    k.fillStyle = '#ffd84d'; k.beginPath(); k.moveTo(cx, top - R * .85); k.lineTo(cx + R * .3, top - R * .55); k.lineTo(cx, top - R * .15); k.lineTo(cx - R * .3, top - R * .55); k.closePath(); k.fill(); k.stroke();
  } else if (hat === 'army') {
    k.beginPath(); k.moveTo(cx - R * .9, top + R * .1); k.lineTo(cx - R * .75, hy + R * .75); k.moveTo(cx + R * .9, top + R * .1); k.lineTo(cx + R * .75, hy + R * .75); k.stroke();
    k.fillStyle = '#4b5320'; k.beginPath(); k.arc(cx, top + R * .1, R * 1.08, Math.PI, 0); k.closePath(); k.fill(); k.stroke();
    k.fillStyle = 'rgba(0,0,0,.25)'; for (const [x, y] of [[-.4, -.5], [.3, -.3], [.1, -.8]]) { k.beginPath(); k.arc(cx + x * R, top + y * R, R * .15, 0, 7); k.fill(); }
  } else if (hat === 'space') {
    k.fillStyle = '#ddd'; k.beginPath(); k.roundRect(cx - R * 1.1, hy + R * .9, R * 2.2, R * .35, 8); k.fill(); k.stroke();
    k.fillStyle = 'rgba(180,230,255,.25)'; k.strokeStyle = '#9ad1ff'; k.lineWidth = 6;
    k.beginPath(); k.arc(cx, hy, R * 1.45, 0, 7); k.fill(); k.stroke();
    k.strokeStyle = 'rgba(255,255,255,.8)'; k.lineWidth = 5; k.beginPath(); k.arc(cx, hy, R * 1.2, 3.6, 4.4); k.stroke();
    k.strokeStyle = '#1a1a1a'; k.lineWidth = 4; k.beginPath(); k.moveTo(cx, hy - R * 1.45); k.lineTo(cx, hy - R * 1.8); k.stroke();
    k.fillStyle = (time * 3 | 0) % 2 ? '#ff2b2b' : '#ffd84d'; k.beginPath(); k.arc(cx, hy - R * 1.85, R * .12, 0, 7); k.fill(); k.stroke();
  } else if (hat === 'clown') {
    k.save(); k.beginPath(); k.moveTo(cx - R * .5, top - R * .2); k.lineTo(cx + R * .5, top - R * .2); k.lineTo(cx + R * .1, top - R * 1.5); k.closePath();
    k.fillStyle = '#7b2cbf'; k.fill(); k.clip();
    k.fillStyle = '#ffd84d'; for (let i = 0; i < 5; i++) k.fillRect(cx - R, top - R * (.35 + i * .3), R * 2, R * .12);
    k.restore(); k.beginPath(); k.moveTo(cx - R * .5, top - R * .2); k.lineTo(cx + R * .5, top - R * .2); k.lineTo(cx + R * .1, top - R * 1.5); k.closePath(); k.stroke();
    k.fillStyle = '#fff'; k.beginPath(); k.arc(cx + R * .1, top - R * 1.55, R * .14, 0, 7); k.fill(); k.stroke();
  }
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
$('shopClose').onclick = () => openShop(false);
$('shopScrim').onclick = () => openShop(false);
$('keeperName').textContent = `${SHOPKEEPER.name}, ${SHOPKEEPER.title}`;
$('btnNoFace').onclick = () => { store.set('face', null); loadFace(null); };
$('btnMute').onclick = () => { muted = !muted; store.set('muted', muted); $('btnMute').textContent = muted ? '🔇' : '🔊'; initAudio(); };
$('btnClear').onclick = () => { props = []; ents = []; gravDir = 1; flipT = 0; boodie = null; refreshTools(); for (const B of bodies()) { B.decals = []; B.bleed = 0; } floorStains = []; wallMarks = []; parts = []; grab = null; };
$('btnReset').onclick = () => {
  arham = makeBody('arham', W / 2); boodie = null;
  props = []; ents = []; gravDir = 1; flipT = 0; parts = []; floorStains = []; wallMarks = []; grab = null;
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
  if (shopOpen) drawKeeper(DT);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// debug/testing hook
window.KTA = { get ents() { return ents; }, unlockAll() { phasesUnlocked = 5; TOOLS.forEach(t => unlocked.add(t.id)); buildTools(); }, set tool(t) { tool = t; }, openShop, get arham() { return arham; }, get boodie() { return boodie; }, get props() { return props; }, addBucks, explode, spawnBoodie };
