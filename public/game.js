// IRON OATH 클라이언트 (Three.js)
// 구성: 설정 → 렌더러/월드 → 블록형 기사 모델·애니메이션 → 1인칭 → 사운드 → 네트워크 → 메뉴/HUD → 입력 → 메인 루프

import * as THREE from 'three';
import { CLASSES, SKILLS, ARENA, PLAYER, TEAMS, EMOTES, MAPS, PROJ, resolveCollision, lineBlocked, projBlocked, useMap } from '/classes.js';
import { t, cname, cdesc, crole, sname, sdesc, setLang, getLang, onLang, applyI18n, LANGS } from './i18n.js';

const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const lerpAngle = (a, b, k) => {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * k;
};

/* ═════════════ 설정 (브라우저에 저장) ═════════════ */
const IS_TOUCH = matchMedia('(pointer: coarse)').matches; // 휴대폰/태블릿: 터치 조작 UI 사용
const QUALITY = {
  low: { ratio: 0.7, shadow: 0 },
  mid: { ratio: 1, shadow: 1024 },
  high: { ratio: Math.min(window.devicePixelRatio || 1, 1.5), shadow: 2048 },
};
const DEFAULTS = { sens: 1, fov: 75, vol: 0.7, quality: IS_TOUCH ? 'low' : 'mid', minimap: true, netinfo: false, bob: true };
const S = { ...DEFAULTS };
try {
  const raw = JSON.parse(localStorage.getItem('ironoath_settings') || '{}');
  for (const k in DEFAULTS) if (typeof raw[k] === typeof DEFAULTS[k]) S[k] = raw[k];
} catch {}
S.sens = clamp(S.sens, 0.3, 3);
S.fov = clamp(S.fov, 60, 110);
S.vol = clamp(S.vol, 0, 1);
if (!QUALITY[S.quality]) S.quality = 'mid';
const saveSettings = () => { try { localStorage.setItem('ironoath_settings', JSON.stringify(S)); } catch {} };

/* ═════════════ 렌더러 / 장면 ═════════════ */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x86b4e6);
scene.fog = new THREE.Fog(0x9cc2ee, 35, 130);

const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a6a55, 2.3));
const sun = new THREE.DirectionalLight(0xfff1d0, 2.6);
sun.position.set(30, 50, 20);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
scene.add(sun);

function applyQuality() {
  const q = QUALITY[S.quality];
  renderer.setPixelRatio(q.ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  const wasShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = q.shadow > 0;
  sun.castShadow = q.shadow > 0;
  if (q.shadow && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  if (wasShadow !== renderer.shadowMap.enabled) {
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  }
}
function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

/* ═════════════ 픽셀 텍스처 도구 ═════════════ */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const k = f >= 0 ? 255 : 0, a = Math.abs(f);
  r = Math.round(r + (k - r) * a); g = Math.round(g + (k - g) * a); b = Math.round(b + (k - b) * a);
  return `rgb(${r},${g},${b})`;
}
function noise(g, x, y, w, h, base, amt = 0.12) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    g.fillStyle = shade(base, (Math.random() - 0.5) * 2 * amt);
    g.fillRect(x + i, y + j, 1, 1);
  }
}
const px = (g, x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
function pixTex(w, h, paint, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  paint(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const lamCache = {};
const lam = (color) => (lamCache[color] ??= new THREE.MeshLambertMaterial({ color }));
const texMat = (tex) => new THREE.MeshLambertMaterial({ map: tex });
const geoCache = new Map();
const BOX = (w, h, d) => {
  const k = `${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
};

/* ═════════════ 월드 (맵마다 다시 만들 수 있음) ═════════════ */
const THEMES = {
  town:      { grass: ['#5b9a3a', '#3f7a2a'], stone: ['#8a8780', '#5d5b56'], dirt: '#7f6647', dirtR: 15, streets: true, sky: ['#86b4e6', '#9cc2ee'] },
  fortress:  { grass: ['#5a8a45', '#3f6a2f'], stone: ['#7a7a82', '#4d4d55'], dirt: '#6f5a40', dirtR: 0, courtyard: 36, sky: ['#9aa9bd', '#b4bfcc'] },
  forest:    { grass: ['#3f7d2e', '#2c5f1f'], stone: ['#7d8077', '#555850'], dirt: '#6a5238', dirtR: 9, sky: ['#8fbf9a', '#a9d0a8'] },
  colosseum: { grass: ['#d7c08a', '#b89f66'], stone: ['#c9b27a', '#9c8855'], dirt: '#d2b97c', dirtR: 34, sky: ['#f0b87a', '#f5cf9e'] },
};
let worldObjs = [];
let currentMap = 'town';
function clearWorld() {
  for (const o of worldObjs) {
    scene.remove(o);
    o.traverse?.((n) => { n.geometry?.dispose?.(); if (n.material && !Array.isArray(n.material)) n.material.dispose?.(); });
  }
  worldObjs = [];
}
function applyMap(id) {
  if (!MAPS[id] || id === currentMap) return;
  currentMap = id;
  useMap(id);
  buildWorld();
}
function buildWorld() {
  clearWorld();
  const _add = scene.add.bind(scene);
  scene.add = (...o) => { worldObjs.push(...o); return _add(...o); };
  const TH = THEMES[ARENA.theme] || THEMES.town;
  scene.background = new THREE.Color(TH.sky[0]);
  scene.fog = new THREE.Fog(TH.sky[1], 35, 130);
  const grass = pixTex(16, 16, (g) => {
    noise(g, 0, 0, 16, 16, TH.grass[0], 0.16);
    for (let i = 0; i < 16; i++) px(g, (Math.random() * 16) | 0, (Math.random() * 16) | 0, TH.grass[1]);
  }, true);
  grass.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.half * 2, ARENA.half * 2), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const dirtTex = pixTex(16, 16, (g) => {
    noise(g, 0, 0, 16, 16, TH.dirt, 0.14);
    for (let i = 0; i < 12; i++) px(g, (Math.random() * 16) | 0, (Math.random() * 16) | 0, '#5d4a31');
  }, true);
  dirtTex.repeat.set(8, 8);
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(Math.max(TH.dirtR, 0.01), 48), new THREE.MeshLambertMaterial({ map: dirtTex }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.01;
  dirt.receiveShadow = true;
  dirt.visible = TH.dirtR > 0;
  scene.add(dirt);

  const stoneTex = pixTex(16, 16, (g) => {
    noise(g, 0, 0, 16, 16, TH.stone[0], 0.1);
    px(g, 0, 7, TH.stone[1], 16, 1); px(g, 0, 15, TH.stone[1], 16, 1);
    px(g, 3, 0, TH.stone[1], 1, 7); px(g, 11, 8, TH.stone[1], 1, 7);
  }, true);
  const stoneMat = (rx, ry) => {
    const t = stoneTex.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t });
  };

  const h = ARENA.half, len = h * 2 + 4;
  const walls = [[0, -h - 1, len, 2], [0, h + 1, len, 2], [-h - 1, 0, 2, len], [h + 1, 0, 2, len]];
  const merlonMat = stoneMat(1, 1);
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), stoneMat(Math.max(w, d) / 2, 3));
    m.position.set(x, 3, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const horizontal = w > d;
    for (let i = -h; i <= h; i += 4) {
      const b = new THREE.Mesh(BOX(horizontal ? 2 : 2.2, 1.2, horizontal ? 2.2 : 2), merlonMat);
      b.position.set(horizontal ? i : x, 6.6, horizontal ? z : i);
      b.castShadow = true;
      scene.add(b);
    }
  }
  const tiled = (tex, rx, ry) => { const t = tex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return new THREE.MeshLambertMaterial({ map: t }); };
  const plasterTex = pixTex(16, 16, (g) => { noise(g, 0, 0, 16, 16, '#d8c9a4', 0.08); px(g, 0, 0, '#5a4128', 16, 1); px(g, 0, 8, '#5a4128', 16, 1); px(g, 0, 0, '#5a4128', 1, 16); px(g, 8, 0, '#5a4128', 1, 8); }, true);
  const roofTex = pixTex(16, 16, (g) => { noise(g, 0, 0, 16, 16, '#9a3b2a', 0.12); for (let i = 3; i < 16; i += 4) px(g, 0, i, '#6e271b', 16, 1); }, true);
  const woodTex = pixTex(16, 16, (g) => { noise(g, 0, 0, 16, 16, '#7a5a36', 0.12); for (let i = 0; i < 16; i += 4) px(g, 0, i, '#4e3820', 16, 1); }, true);
  const cobTex = pixTex(16, 16, (g) => { noise(g, 0, 0, 16, 16, '#9b958a', 0.1); px(g, 0, 7, '#6d6a62', 16, 1); px(g, 0, 15, '#6d6a62', 16, 1); px(g, 4, 0, '#6d6a62', 1, 7); px(g, 12, 8, '#6d6a62', 1, 7); }, true);
  // 십자 대로 + 중앙 광장 (돌바닥)
  if (TH.streets) for (const [w, d] of [[ARENA.half * 2, 8], [8, ARENA.half * 2]]) {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tiled(cobTex, w / 2, d / 2));
    st.rotation.x = -Math.PI / 2; st.position.y = 0.02; st.receiveShadow = true; scene.add(st);
  }
  if (TH.courtyard) { const cy = new THREE.Mesh(new THREE.PlaneGeometry(TH.courtyard, TH.courtyard), tiled(cobTex, TH.courtyard / 2, TH.courtyard / 2)); cy.rotation.x = -Math.PI / 2; cy.position.y = 0.03; cy.receiveShadow = true; scene.add(cy); }
  if (TH.streets) { const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 32), tiled(cobTex, 5, 5));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.03; plaza.receiveShadow = true; scene.add(plaza); }

  const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const windowMat = lam(0x2a3a4a), doorMat = lam(0x3a2412), leafMat = lam(0x3f8a34), trunkMat = lam(0x5a3d22), waterMat = new THREE.MeshLambertMaterial({ color: 0x3d7fd0 });
  // 건물
  for (const b of ARENA.boxes) {
    const stoneBox = b.style === 'stone', tower = stoneBox && b.h >= 9;
    mk(new THREE.BoxGeometry(b.w, b.h, b.d), stoneBox ? stoneMat(Math.max(b.w, b.d) / 2, b.h / 2) : tiled(plasterTex, b.w / 3, b.h / 3), b.x, b.h / 2, b.z);
    if (tower) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mk(BOX(1.4, 1.4, 1.4), merlonMat, b.x + dx * (b.w / 2 - 0.7), b.h + 0.7, b.z + dz * (b.d / 2 - 0.7));
    } else if (!stoneBox) {
      mk(new THREE.BoxGeometry(b.w + 1, 0.7, b.d + 1), tiled(roofTex, b.w / 2, 1), b.x, b.h + 0.35, b.z);
      mk(new THREE.BoxGeometry(b.w - 0.6, 0.7, b.d - 0.6), tiled(roofTex, b.w / 2, 1), b.x, b.h + 1.05, b.z);
      mk(new THREE.BoxGeometry(b.w - 2.2, 0.7, b.d - 2.2), tiled(roofTex, b.w / 3, 1), b.x, b.h + 1.75, b.z);
    }
    if (stoneBox) continue;
    const zs = b.z > 0 ? -1 : 1; // 가운데 대로를 향한 면에 문과 창
    mk(BOX(1.3, 2.2, 0.15), doorMat, b.x, 1.1, b.z + zs * (b.d / 2 + 0.03));
    for (const wx of [-b.w / 4, b.w / 4]) mk(BOX(0.9, 1.0, 0.12), windowMat, b.x + wx, Math.min(b.h - 1, 3.6), b.z + zs * (b.d / 2 + 0.03));
  }
  // 소품: 분수 / 나무 / 우물 / 통
  for (const p of ARENA.pillars) {
    if (p.kind === 'fountain') {
      mk(new THREE.CylinderGeometry(p.r, p.r * 1.1, 0.9, 20), merlonMat, p.x, 0.45, p.z);
      mk(new THREE.CylinderGeometry(p.r - 0.25, p.r - 0.25, 0.92, 20), waterMat, p.x, 0.46, p.z);
      mk(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 10), merlonMat, p.x, 1.2, p.z);
      mk(new THREE.CylinderGeometry(0.8, 0.5, 0.35, 12), merlonMat, p.x, 2.5, p.z);
    } else if (p.kind === 'tree') {
      mk(new THREE.CylinderGeometry(0.3, 0.4, 3.2, 8), trunkMat, p.x, 1.6, p.z);
      mk(BOX(3.2, 2, 3.2), leafMat, p.x, 4, p.z);
      mk(BOX(2.2, 1.6, 2.2), leafMat, p.x, 5.5, p.z);
    } else if (p.kind === 'well') {
      mk(new THREE.CylinderGeometry(p.r, p.r, 1.1, 14), stoneMat(3, 1), p.x, 0.55, p.z);
      mk(new THREE.CylinderGeometry(p.r - 0.25, p.r - 0.25, 1.12, 14), waterMat, p.x, 0.56, p.z);
      mk(BOX(0.12, 2.2, 0.12), trunkMat, p.x - p.r + 0.1, 1.9, p.z);
      mk(BOX(0.12, 2.2, 0.12), trunkMat, p.x + p.r - 0.1, 1.9, p.z);
      mk(BOX(p.r * 2.6, 0.2, 1.4), tiled(roofTex, 2, 1), p.x, 3.1, p.z);
    } else if (p.kind === 'column') {
      mk(new THREE.CylinderGeometry(p.r * 0.8, p.r, 6.5, 12), merlonMat, p.x, 3.25, p.z);
      mk(BOX(p.r * 2.4, 0.5, p.r * 2.4), merlonMat, p.x, 6.7, p.z);
    } else if (p.kind === 'dais') {
      mk(new THREE.CylinderGeometry(p.r + 0.5, p.r + 0.9, 0.5, 28), merlonMat, p.x, 0.25, p.z);
      mk(new THREE.CylinderGeometry(p.r - 0.6, p.r - 0.6, 1.0, 28), merlonMat, p.x, 0.5, p.z);
    } else {
      mk(new THREE.CylinderGeometry(p.r * 0.9, p.r, 1.2, 12), tiled(woodTex, 2, 1), p.x, 0.6, p.z);
    }
  }

  // 블록 구름
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 18; i++) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(rand(14, 32), 3, rand(8, 18)), cloudMat);
    const a = rand(0, TAU), r = rand(60, 200);
    cl.position.set(Math.cos(a) * r, rand(48, 75), Math.sin(a) * r);
    scene.add(cl);
  }
  scene.add = _add;
}
buildWorld();

/* ═════════════ 기사 모델 (마인크래프트 비율: 머리 8 · 몸통 12 · 팔다리 12 픽셀 = 키 1.8m) ═════════════ */
const U = 0.225; // 4픽셀
const LOOKS = {
  knight:     { cloth: '#3e63a8', cloth2: '#2b4a85', metal: '#b8bec7', metal2: '#7d848e', trim: '#e3b94b', skin: '#d6a67e', helm: 'full',   plume: '#2f63e0', pants: '#3a3f4c', cover: 7, belt: 7, armMetal: true,  greaves: true,  glove: '#4a4f58' },
  greatsword: { cloth: '#8d2b2b', cloth2: '#5c1b1b', metal: '#5a5e67', metal2: '#32353c', trim: '#bdbdbd', skin: '#c88f68', helm: 'horns',  plume: '#b01e1e', pants: '#2b2325', cover: 6, belt: 6, armMetal: true,  greaves: true,  glove: '#2a2c30' },
  duelist:    { cloth: '#2f8a55', cloth2: '#1f5e39', metal: '#b9b3a2', metal2: '#8a8576', trim: '#efe5b0', skin: '#e2b68e', helm: 'hood',   plume: '#f4f1e6', pants: '#2d3a30', cover: 3, belt: 8, armMetal: false, greaves: false, glove: '#3a2a1a' },
  shield:     { cloth: '#b88b2a', cloth2: '#7e5c17', metal: '#c9cdd3', metal2: '#8d939b', trim: '#f3d46c', skin: '#d0a279', helm: 'bucket', plume: null,      pants: '#3d3322', cover: 8, belt: 8, armMetal: true,  greaves: true,  glove: '#4a4f58' },
  mage:        { cloth: '#5a38b0', cloth2: '#3b2480', metal: '#b8a6e8', metal2: '#7a66b8', trim: '#f2d66b', skin: '#e0b48c', helm: 'hat', plume: '#7a4fd0', pants: '#2a2250', cover: 0, belt: 8, armMetal: false, greaves: false, glove: '#3b2480', weapon: 'staff' },
  rogue:       { cloth: '#3a3d46', cloth2: '#24262c', metal: '#8a8d96', metal2: '#5a5d66', trim: '#9c9c9c', skin: '#d0a279', helm: 'hood', plume: '#24262c', pants: '#22242a', cover: 0, belt: 7, armMetal: false, greaves: false, glove: '#1a1a1d', weapon: 'dagger' },
  archer:      { cloth: '#4f7f35', cloth2: '#35591f', metal: '#9a8a62', metal2: '#6f6240', trim: '#d8c070', skin: '#e2b68e', helm: 'hood', plume: '#d8c070', pants: '#4a3a22', cover: 0, belt: 7, armMetal: false, greaves: false, glove: '#5a3b1f', weapon: 'bow' },
  cleric:      { cloth: '#efe7cf', cloth2: '#cfc4a0', metal: '#e8e8e8', metal2: '#b0b0b0', trim: '#e3b94b', skin: '#e0b48c', helm: 'bare', hair: '#6b4a2a', plume: '#e3b94b', pants: '#a89a78', cover: 4, belt: 8, armMetal: false, greaves: false, glove: '#8a7a58', weapon: 'mace' },
  berserker:   { cloth: '#7a3a1a', cloth2: '#4d230d', metal: '#6a5a50', metal2: '#3d332d', trim: '#b0b0b0', skin: '#c07a58', helm: 'horns', plume: '#7a1a1a', pants: '#3a2a20', cover: 0, belt: 8, armMetal: false, greaves: false, glove: '#2a1a10', weapon: 'axe' },
  paladin:     { cloth: '#f0e6b0', cloth2: '#c8bc82', metal: '#e8e2c8', metal2: '#b0a880', trim: '#f3d46c', skin: '#d6a67e', helm: 'full', plume: '#f3d46c', pants: '#8a7f5a', cover: 8, belt: 8, armMetal: true, greaves: true, glove: '#8a7f5a', weapon: 'mace' },
  assassin:    { cloth: '#22222e', cloth2: '#14141c', metal: '#5a5a6a', metal2: '#34343f', trim: '#7a1a2a', skin: '#c8a07a', helm: 'hood', plume: '#7a1a2a', pants: '#14141a', cover: 0, belt: 7, armMetal: false, greaves: false, glove: '#0d0d10', weapon: 'dagger' },
  ranger:      { cloth: '#3d6b4a', cloth2: '#274a31', metal: '#8a9a6a', metal2: '#5a6a45', trim: '#c8b070', skin: '#d6a67e', helm: 'hood', plume: '#5a8a3a', pants: '#4a3a28', cover: 3, belt: 7, armMetal: false, greaves: false, glove: '#4a3a28', weapon: 'bow' },
  necromancer: { cloth: '#4a2a5a', cloth2: '#2e1a3a', metal: '#b8b8a0', metal2: '#7a7a68', trim: '#7fe0a0', skin: '#b8b0a0', helm: 'hat', plume: '#7fe0a0', pants: '#201428', cover: 0, belt: 8, armMetal: false, greaves: false, glove: '#2e1a3a', weapon: 'staff' },
  monk:        { cloth: '#d98c3a', cloth2: '#a86a22', metal: '#c8c0a8', metal2: '#8a8470', trim: '#f0e0a0', skin: '#d0a279', helm: 'bare', hair: '#2a1a10', plume: '#f0e0a0', pants: '#8a5a22', cover: 0, belt: 7, armMetal: false, greaves: false, glove: '#d0a279', weapon: 'fist' },
  spearman:    { cloth: '#6a7f8f', cloth2: '#465a68', metal: '#b8bec7', metal2: '#7d848e', trim: '#d8d8d8', skin: '#d6a67e', helm: 'bucket', plume: null, pants: '#3a3f4c', cover: 6, belt: 7, armMetal: true, greaves: true, glove: '#4a4f58', weapon: 'spear' },
  bard:        { cloth: '#c05a8a', cloth2: '#8a3a62', metal: '#e0c070', metal2: '#a08840', trim: '#f4e08a', skin: '#e2b68e', helm: 'hat', plume: '#f4e08a', pants: '#3a2a4a', cover: 0, belt: 8, armMetal: false, greaves: false, glove: '#6a3a4a', weapon: 'lute' },
  warlock:     { cloth: '#7b1f4f', cloth2: '#4d1030', metal: '#6a4a5a', metal2: '#3a2a33', trim: '#e04a8a', skin: '#c8b0a0', helm: 'hat', plume: '#e04a8a', pants: '#2a1020', cover: 0, belt: 8, armMetal: false, greaves: false, glove: '#2a1020', weapon: 'staff' },
  crossbow:    { cloth: '#8a6b3d', cloth2: '#5a4426', metal: '#9a9a9a', metal2: '#686868', trim: '#d8c070', skin: '#d6a67e', helm: 'bucket', plume: null, pants: '#3a3022', cover: 7, belt: 7, armMetal: true, greaves: true, glove: '#4a3a22', weapon: 'crossbow' },
  druid:       { cloth: '#2f7a52', cloth2: '#1f5236', metal: '#8a6a3a', metal2: '#5a4426', trim: '#9ad06a', skin: '#d0a279', helm: 'bare', hair: '#5a3a1a', plume: '#9ad06a', pants: '#4a3a22', cover: 0, belt: 7, armMetal: false, greaves: false, glove: '#4a3a22', weapon: 'staff' },
  samurai:     { cloth: '#b23a48', cloth2: '#7a2430', metal: '#3a3a44', metal2: '#22222a', trim: '#e0c060', skin: '#d6a67e', helm: 'bare', hair: '#14100e', plume: '#e0c060', pants: '#22222a', cover: 7, belt: 8, armMetal: true, greaves: false, glove: '#22222a', weapon: 'katana' },
};
const weaponOf = (id) => getLook(id).weapon || 'sword';
const isBowCls = (id) => { const w = weaponOf(id); return w === 'bow' || w === 'crossbow'; };
const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');
function getLook(id) {
  return LOOKS[id] || { ...LOOKS.knight, cloth: hexStr(CLASSES[id]?.color ?? 0x4a6fa5), cloth2: shade(hexStr(CLASSES[id]?.color ?? 0x4a6fa5), -0.3) };
}

function paintHead(g, face, L) {
  if (L.helm === 'full' || L.helm === 'bucket') {
    noise(g, 0, 0, 8, 8, L.metal, 0.1);
    px(g, 0, 7, L.metal2, 8, 1);
    if (face === 'front') {
      if (L.helm === 'full') { px(g, 1, 3, '#12151a', 6, 2); px(g, 3, 1, L.metal2, 2, 2); px(g, 2, 6, L.metal2, 4, 1); }
      else { px(g, 3, 0, '#12151a', 2, 7); px(g, 1, 3, '#12151a', 6, 2); px(g, 0, 0, L.trim, 8, 1); }
    } else if (face === 'side') {
      px(g, 1, 1, L.metal2); px(g, 6, 5, L.metal2);
      if (L.helm === 'bucket') px(g, 0, 0, L.trim, 8, 1);
    } else if (face === 'top') px(g, 3, 0, L.metal2, 2, 8);
  } else if (L.helm === 'horns') {
    if (face === 'top') { noise(g, 0, 0, 8, 8, L.metal, 0.1); px(g, 3, 0, L.plume, 2, 8); return; }
    if (face === 'bottom') { noise(g, 0, 0, 8, 8, L.skin, 0.08); return; }
    noise(g, 0, 0, 8, 3, L.metal, 0.1);
    px(g, 0, 2, L.metal2, 8, 1);
    if (face === 'front') {
      noise(g, 0, 3, 8, 5, L.skin, 0.08);
      px(g, 1, 4, '#2a1a14', 2, 1); px(g, 5, 4, '#2a1a14', 2, 1);
      px(g, 1, 6, '#5a3320', 6, 2); px(g, 3, 5, '#b57a58', 2, 1);
    } else if (face === 'back') noise(g, 0, 3, 8, 5, L.metal2, 0.1);
    else noise(g, 0, 3, 8, 5, L.skin, 0.08);
  } else if (L.helm === 'bare' || L.helm === 'hat') {
    const hat = L.helm === 'hat';
    if (face === 'top') { noise(g, 0, 0, 8, 8, hat ? L.cloth : (L.hair || '#4a3020'), 0.1); return; }
    noise(g, 0, 0, 8, 8, L.skin, 0.08);
    if (face === 'bottom') return;
    const hair = hat ? L.cloth2 : (L.hair || '#4a3020');
    if (face === 'back') { noise(g, 0, 0, 8, 8, hair, 0.1); return; }
    noise(g, 0, 0, 8, face === 'front' ? 2 : 4, hair, 0.1);
    if (face === 'front') { px(g, 1, 4, '#23211f', 2, 1); px(g, 5, 4, '#23211f', 2, 1); px(g, 3, 6, '#a45a48', 2, 1); }
  } else { // hood
    noise(g, 0, 0, 8, 8, face === 'bottom' ? L.cloth2 : L.cloth, 0.1);
    px(g, 0, 7, L.cloth2, 8, 1);
    if (face === 'front') {
      noise(g, 1, 2, 6, 5, L.skin, 0.06);
      px(g, 2, 4, '#23211f'); px(g, 5, 4, '#23211f'); px(g, 3, 6, '#a45a48', 2, 1);
      px(g, 0, 0, L.cloth2, 8, 1);
    }
  }
}
function paintTorso(g, face, L, w) {
  if (face === 'back') {
    noise(g, 0, 0, w, 12, L.cloth2, 0.1);
    px(g, 0, 0, L.trim, w, 1); px(g, 0, 11, L.trim, w, 1);
    return;
  }
  noise(g, 0, 0, w, 12, L.cloth, 0.1);
  if (L.cover > 0) {
    noise(g, 0, 0, w, L.cover, L.metal, 0.1);
    px(g, 0, L.cover - 1, L.metal2, w, 1);
    px(g, 0, 0, L.trim, w, 1);
    if (face === 'front') px(g, w / 2 - 1, 1, L.metal2, 2, L.cover - 2);
  }
  px(g, 0, L.belt, '#3a2a1a', w, 2);
  if (face === 'front') px(g, 3, L.belt, L.trim, 2, 2);
  px(g, 0, 11, L.trim, w, 1);
}
function paintArm(g, L) {
  noise(g, 0, 0, 4, 5, L.armMetal ? L.metal : L.cloth, 0.1);
  noise(g, 0, 5, 4, 4, L.armMetal ? L.metal2 : L.cloth2, 0.1);
  px(g, 0, 5, L.trim, 4, 1);
  noise(g, 0, 9, 4, 3, L.glove, 0.1);
}
function paintLeg(g, L) {
  noise(g, 0, 0, 4, 8, L.pants, 0.1);
  if (L.greaves) { noise(g, 0, 4, 4, 3, L.metal2, 0.1); px(g, 0, 4, L.trim, 4, 1); }
  noise(g, 0, 8, 4, 4, '#2e2118', 0.1);
  px(g, 0, 8, '#4a3626', 4, 1);
}

const matCache = {};
function getMats(id) {
  if (matCache[id]) return matCache[id];
  const L = getLook(id);
  const mh = (f) => texMat(pixTex(8, 8, (g) => paintHead(g, f, L)));
  const head = [mh('side'), mh('side'), mh('top'), mh('bottom'), mh('back'), mh('front')];
  const mt = (f, w) => texMat(pixTex(w, 12, (g) => paintTorso(g, f, L, w)));
  const tcap = texMat(pixTex(8, 4, (g) => noise(g, 0, 0, 8, 4, L.metal2, 0.1)));
  const torso = [mt('side', 4), mt('side', 4), tcap, tcap, mt('back', 8), mt('front', 8)];
  const arm = texMat(pixTex(4, 12, (g) => paintArm(g, L)));
  const leg = texMat(pixTex(4, 12, (g) => paintLeg(g, L)));
  const pauld = texMat(pixTex(4, 4, (g) => { noise(g, 0, 0, 4, 4, L.armMetal ? L.metal : L.cloth2, 0.1); px(g, 0, 3, L.trim, 4, 1); }));
  return (matCache[id] = { head, torso, arm, leg, pauld });
}

function makeSword(len, wide = 1, trim = '#c79a3a') {
  const g = new THREE.Group();
  const steel = lam(0xdfe5ec), steel2 = lam(0xa4aeba), gold = lam(parseInt(trim.slice(1), 16)), leather = lam(0x3b2a1a);
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; g.add(m); };
  add(BOX(0.065 * wide, len, 0.02), steel, 0.14 + len / 2);
  add(BOX(0.02 * wide, len * 0.78, 0.024), steel2, 0.14 + len * 0.42);
  add(BOX(0.04 * wide, 0.1, 0.018), steel, 0.14 + len + 0.05);
  add(BOX(0.28 * Math.sqrt(wide), 0.05, 0.075), gold, 0.115);
  add(BOX(0.045, 0.2, 0.045), leather, 0);
  add(BOX(0.075, 0.06, 0.075), gold, -0.13);
  return g;
}
const swordLen = (c) => 1.0 * (c.reach / 2.6);
const swordWide = (c) => (c.id === 'greatsword' ? 1.7 : 1);

function makeWeapon(W, c, L) {
  const g = new THREE.Group();
  const col = (h) => lam(parseInt(h.slice(1), 16));
  const add = (geo, mat, x, y, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const wood = lam(0x6b4a2a), steel = lam(0xdfe5ec), dark = lam(0x3b2a1a), gold = col(L.trim);
  switch (W) {
    case 'dagger': return makeSword(0.38, 0.9, L.trim);
    case 'katana': return makeSword(1.05, 0.75, L.trim);
    case 'mace':
      add(BOX(0.05, 0.62, 0.05), wood, 0, 0.28); add(BOX(0.17, 0.17, 0.17), col(L.metal), 0, 0.68);
      add(BOX(0.3, 0.05, 0.05), col(L.metal2), 0, 0.68); add(BOX(0.05, 0.05, 0.3), col(L.metal2), 0, 0.68); break;
    case 'axe':
      add(BOX(0.05, 0.95, 0.05), wood, 0, 0.4); add(BOX(0.34, 0.3, 0.05), steel, 0.16, 0.78); add(BOX(0.08, 0.36, 0.07), col(L.metal2), 0, 0.78); break;
    case 'spear':
      add(BOX(0.045, 2.0, 0.045), wood, 0, 0.7); add(BOX(0.08, 0.32, 0.03), steel, 0, 1.82); add(BOX(0.1, 0.04, 0.04), gold, 0, 1.64); break;
    case 'staff':
      add(BOX(0.05, 1.5, 0.05), wood, 0, 0.5);
      add(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: parseInt((L.plume || L.trim).slice(1), 16) }), 0, 1.35);
      add(BOX(0.12, 0.05, 0.12), gold, 0, 1.22); break;
    case 'lute':
      add(BOX(0.22, 0.3, 0.1), wood, 0, 0.15); add(BOX(0.05, 0.5, 0.04), dark, 0, 0.55); add(BOX(0.12, 0.08, 0.04), gold, 0, 0.82); break;
    case 'fist':
      add(BOX(0.13, 0.13, 0.13), col(L.glove), 0, 0.02); break;
    default: return makeSword(swordLen(c), swordWide(c), L.trim);
  }
  return g;
}
// 활/석궁: 손잡이가 원점. 활은 몸통이 Z축(세로), 앞(표적 쪽)이 -Y, 시위가 +Y. 석궁은 개머리판이 Y축, 활대가 X축.
// userData.stat = 시위/화살처럼 "당기지 않았을 때만" 보이는 정지 부품 (당기는 동안은 시위·화살이 양손을 따라 움직임)
function makeBow(W, L) {
  const g = new THREE.Group();
  const wood = lam(0x6b4a2a), dark = lam(0x3b2a1a), steel = lam(0xdfe5ec), str = lam(0xeeeeee);
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  g.userData.stat = [];
  if (W === 'crossbow') {
    add(BOX(0.07, 0.85, 0.09), dark, 0, -0.125, 0);          // 개머리판
    add(BOX(0.05, 0.14, 0.05), dark, 0, 0.1, -0.09);          // 방아쇠 손잡이
    add(BOX(0.86, 0.05, 0.05), wood, 0, -0.5, 0);             // 활대
    add(BOX(0.1, 0.05, 0.05), wood, 0.45, -0.46, 0);
    add(BOX(0.1, 0.05, 0.05), wood, -0.45, -0.46, 0);
    add(BOX(0.84, 0.012, 0.012), str, 0, -0.36, 0.03);       // 시위
    add(BOX(0.018, 0.62, 0.018), steel, 0, -0.2, 0.06);      // 장전된 볼트
  } else {
    add(BOX(0.05, 0.07, 0.18), dark, 0, 0, 0);                // 손잡이
    add(BOX(0.045, 0.04, 0.54), wood, 0, 0.129, 0.327, -0.5); // 위쪽 활대: 끝이 궁수(+Y) 쪽으로 휘어 D자 모양
    add(BOX(0.045, 0.04, 0.54), wood, 0, 0.129, -0.327, 0.5); // 아래쪽 활대
    add(BOX(0.06, 0.05, 0.05), wood, 0, 0.26, 0.58, 0); add(BOX(0.06, 0.05, 0.05), wood, 0, 0.26, -0.58, 0); // 시위가 걸리는 끝
    g.userData.stat.push(add(BOX(0.012, 0.012, 1.13), str, 0, 0.26, 0)); // 시위
    g.userData.stat.push(add(BOX(0.016, 0.9, 0.016), wood, 0, -0.19, 0)); // 화살대
    g.userData.stat.push(add(BOX(0.045, 0.1, 0.02), steel, 0, -0.62, 0)); // 화살촉
  }
  return g;
}

function makeShield(L) {
  const front = pixTex(12, 16, (g) => {
    noise(g, 0, 0, 12, 16, L.cloth, 0.08);
    px(g, 0, 0, L.metal, 12, 1); px(g, 0, 15, L.metal, 12, 1); px(g, 0, 0, L.metal, 1, 16); px(g, 11, 0, L.metal, 1, 16);
    px(g, 5, 1, L.trim, 2, 14); px(g, 1, 6, L.trim, 10, 2); px(g, 5, 6, L.metal2, 2, 2);
  });
  const back = pixTex(12, 16, (g) => { noise(g, 0, 0, 12, 16, '#5a3b1f', 0.1); px(g, 1, 4, '#2a1a0c', 10, 1); px(g, 1, 11, '#2a1a0c', 10, 1); });
  const edge = new THREE.MeshLambertMaterial({ color: parseInt(L.metal2.slice(1), 16) });
  const m = new THREE.Mesh(BOX(0.5, 0.62, 0.07), [edge, edge, edge, edge, texMat(back), texMat(front)]);
  m.castShadow = true;
  return m;
}

function nameSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 30px Georgia, "Noto Serif KR", serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color;
  g.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.8, 0.45, 1);
  s.position.y = 2.3;
  return s;
}

// 한 명의 기사를 이루는 관절 구조
//   root ─ legR, legL (엉덩이 관절)
//        └ upper(허리 관절) ─ torso, head(목 관절), armR, armL(어깨 관절), shield
function makeRig(clsId, name, team = 0) {
  const c = CLASSES[clsId], L = getLook(clsId), M = getMats(clsId);
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const add = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const legR = new THREE.Group(); legR.position.set(0.1125, 0.675, 0); add(BOX(U, 0.675, U), M.leg, 0, -0.3375, 0, legR);
  const legL = new THREE.Group(); legL.position.set(-0.1125, 0.675, 0); add(BOX(U, 0.675, U), M.leg, 0, -0.3375, 0, legL);
  root.add(legR, legL);

  const upper = new THREE.Group(); upper.position.y = 0.675; root.add(upper);
  add(BOX(0.45, 0.675, U), M.torso, 0, 0.3375, 0, upper);

  const head = new THREE.Group(); head.position.y = 0.675; upper.add(head);
  add(BOX(0.45, 0.45, 0.45), M.head, 0, 0.225, 0, head);
  if (L.helm === 'full') add(BOX(0.08, 0.14, 0.42), lam(parseInt(L.plume.slice(1), 16)), 0, 0.52, 0, head);
  if (L.helm === 'horns') {
    add(BOX(0.07, 0.1, 0.4), lam(parseInt(L.plume.slice(1), 16)), 0, 0.5, 0, head);
    const hornMat = lam(0xe8e2cf);
    add(BOX(0.09, 0.26, 0.09), hornMat, 0.27, 0.42, 0, head).rotation.z = -0.55;
    add(BOX(0.09, 0.26, 0.09), hornMat, -0.27, 0.42, 0, head).rotation.z = 0.55;
  }
  if (L.helm === 'hood') {
    const f = add(BOX(0.05, 0.32, 0.1), lam(parseInt(L.plume.slice(1), 16)), 0.16, 0.56, 0.1, head);
    f.rotation.z = -0.4; f.rotation.x = 0.35;
  }
  if (L.helm === 'bucket') add(BOX(0.48, 0.05, 0.48), lam(parseInt(L.trim.slice(1), 16)), 0, 0.47, 0, head);
  if (L.helm === 'hat') {
    const hc = lam(parseInt(L.cloth.slice(1), 16)), hc2 = lam(parseInt(L.cloth2.slice(1), 16)), ht = lam(parseInt(L.trim.slice(1), 16));
    add(BOX(0.74, 0.05, 0.74), hc2, 0, 0.47, 0, head);
    add(BOX(0.44, 0.22, 0.44), hc, 0, 0.6, 0, head);
    add(BOX(0.3, 0.22, 0.3), hc, 0.02, 0.8, 0, head);
    add(BOX(0.15, 0.2, 0.15), hc, 0.06, 0.98, 0, head).rotation.z = -0.3;
    add(BOX(0.46, 0.05, 0.46), ht, 0, 0.52, 0, head);
  }

  const armR = new THREE.Group(); armR.position.set(0.3375, 0.675, 0); upper.add(armR);
  add(BOX(U, 0.675, U), M.arm, 0, -0.3375, 0, armR);
  add(BOX(0.28, 0.1, 0.28), M.pauld, 0, 0, 0, armR);
  const armL = new THREE.Group(); armL.position.set(-0.3375, 0.675, 0); upper.add(armL);
  add(BOX(U, 0.675, U), M.arm, 0, -0.3375, 0, armL);
  add(BOX(0.28, 0.1, 0.28), M.pauld, 0, 0, 0, armL);

  const W = L.weapon || 'sword';
  const sword = isBowCls(clsId) ? new THREE.Group() : makeWeapon(W, c, L);
  sword.position.set(0, -0.62, 0);
  sword.rotation.x = -Math.PI / 2;
  armR.add(sword);
  let bowPivot = null, bowModel = null, bowFx = null;
  if (isBowCls(clsId)) {
    bowPivot = new THREE.Group();
    bowPivot.position.set(0, -0.62, 0);
    bowModel = makeBow(W, L);
    bowPivot.add(bowModel);
    armL.add(bowPivot);
    if (W === 'bow') { // 당기는 동안 양손을 따라 움직이는 시위 2줄 + 화살
      bowFx = new THREE.Group();
      bowFx.visible = false;
      for (const [n, th, col] of [['s1', 0.012, 0xeeeeee], ['s2', 0.012, 0xeeeeee], ['ar', 0.018, 0xd8c8a0]]) {
        const m = new THREE.Mesh(BOX(th, th, 1), lam(col));
        bowFx[n] = m;
        bowFx.add(m);
      }
      upper.add(bowFx);
    }
  }
  if (team && TEAMS[team]) add(BOX(0.34, 0.55, 0.03), lam(TEAMS[team].color), 0, 0.3, 0.14, upper); // 팀 색 망토

  let shield = null;
  if (clsId === 'shield') { shield = makeShield(L); upper.add(shield); }

  const label = nameSprite(name, team ? TEAM_CSS[team] : '#ffe9a8');
  root.add(label);

  const stars = new THREE.Group();
  stars.position.y = 2.15;
  stars.visible = false;
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(BOX(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    s.position.set(Math.cos((i * TAU) / 3) * 0.35, 0, Math.sin((i * TAU) / 3) * 0.35);
    stars.add(s);
  }
  root.add(stars);
  scene.add(root);
  return { root, upper, head, armR, armL, legR, legL, sword, shield, label, stars, bowPivot, bowModel, bowFx, xbow: W === 'crossbow', spear: W === 'spear', team, bubble: null, combo: 0, phase: 0, stepIdx: 0, block: 0, fall: 0, act: null, spinT: 0 };
}
function removeRig(r) {
  scene.remove(r.root);
  r.label.material.map.dispose();
  r.label.material.dispose();
}

/* ═════════════ 전신 애니메이션 ═════════════ */
// 휘두르기: 아이들 → 뒤로 젖힘(raised) → 내려침(end) → 복귀. 팔뿐 아니라 허리 비틀기·몸 기울기·다리 내딛기까지 함께 움직임
// 롱소드(독일식) 자세: 아이들=Pflug(낮은 보호 자세) → Vom Tag(어깨 위로 들어올림) → Zornhau(사선 베기, 몸통 회전+전진). 번갈아 반대쪽 사선으로 베어 연속기처럼 이어짐
const P3 = {
  idle:   { arm: 0.85, wr: 0.5,  tw: 0,    ln: -0.04, st: 0,    al: 0,    rz: 0.06 },
  raised: { arm: 2.6,  wr: 0.0,  tw: -0.6, ln: 0.18,  st: -0.3, al: 0.7,  rz: 0.35 },
  end:    { arm: 1.45, wr: -1.9, tw: 0.55, ln: -0.42, st: 0.65, al: -0.7, rz: -0.4 },
};
// 마법사/지팡이: 지팡이를 높이 들었다가 앞으로 내지르며 시전
const CAST = {
  idle:   P3.idle,
  raised: { arm: 2.5, wr: 0.2,  tw: -0.25, ln: 0.12,  st: -0.2, al: 2.3, rz: 0.2 },
  end:    { arm: 1.5, wr: -1.5, tw: 0.3,   ln: -0.25, st: 0.4,  al: 1.5, rz: -0.1 },
};
// 창: 양손으로 잡고 낮게 자세를 잡았다가(뒤로 젖힘) 앞으로 내지르는 찌르기
const SPEAR = {
  idle:   { arm: 0.85, wr: 0.5,  tw: 0,    ln: -0.04, st: 0,    al: 0, rz: -0.5 },
  raised: { arm: 1.1,  wr: -1.0, tw: -0.4, ln: 0.1,   st: -0.3, al: 0, rz: -0.5 },
  end:    { arm: 1.55, wr: -1.55, tw: 0.35, ln: -0.3, st: 0.7,  al: 0, rz: -0.4 },
};
const drawAmt = (u, uh) => (u < uh ? easeOut(u / uh) : 1 - easeInOut(Math.min(1, (u - uh) / Math.max(0.15, (1 - uh) * 0.8))));
// 활: 옆으로 선 자세(왼쪽 어깨가 표적), 왼팔 쭉 뻗고 오른팔로 시위를 끝까지 당김 → 릴리즈
function drawPose(u, uh, crossbow) {
  const d = drawAmt(u, uh);
  const tw = (crossbow ? -0.25 : -1.45) * d; // 활: 옆으로 서서 왼쪽 어깨가 표적, 석궁: 거의 정면
  return { tw, hy: -tw * 0.5, ln: -0.04, st: 0, wr: 0.5, al: lerp(1.0, 1.57, d), lz: lerp(-0.3, crossbow ? 0.4 : -1.19, d), bw: d };
}
function castPose(u, uh) {
  const a = Math.min(uh * 0.6, 0.4);
  if (u < a) return mixP(CAST.idle, CAST.raised, easeOut(u / a));
  if (u < uh) return mixP(CAST.raised, CAST.end, (u - a) / Math.max(0.01, uh - a));
  return mixP(CAST.end, CAST.idle, easeInOut(Math.min(1, (u - uh) / Math.max(0.15, (1 - uh) * 0.8))));
}
const RANGED_SK = { fireball: 1, volley: 1, snare: 1, drain: 1, hex: 1, overcharge: 1 };
const POSE_OF = { ambush: 'lunge', iaido: 'lunge', shadowstep: 'lunge', impale: 'lunge', palm: 'bash', smite: 'bash', anthem: 'rally', bloodrage: 'rally', heal: 'rally', bloom: 'rally' };
function emotePose(id, t, u) {
  const e = Math.min(1, u * 6) * Math.min(1, (1 - u) * 6);
  switch (id) {
    case 'wave': return { arm: lerp(0.85, 2.9, e), wr: 0, rz: 0.3 + Math.sin(t * 10) * 0.35 * e };
    case 'bow': return { ln: 0.9 * e, arm: 0.6, al: 0.4, hx: -0.3 * e };
    case 'cheer': return { arm: lerp(0.85, 3.0, e), al: lerp(0, 3.0, e), rz: 0.3 * e, lz: -0.3 * e, ln: Math.sin(t * 14) * 0.08 * e, wr: 0 };
    case 'laugh': return { ln: 0.25 * e * Math.abs(Math.sin(t * 9)), hx: -0.3 * e, tw: Math.sin(t * 9) * 0.08 * e };
    case 'taunt': return { arm: lerp(0.85, 1.6, e), wr: 0.1, al: 0.4 * e, ln: -0.25 * e, tw: 0.2 * e, rz: 0.06 + Math.sin(t * 12) * 0.2 * e };
    case 'salute': return { arm: lerp(0.85, 2.4, e), wr: -0.5, rz: -0.3 * e };
    case 'point': return { arm: lerp(0.85, 1.5, e), wr: lerp(0.5, -0.1, e), tw: -0.2 * e };
    case 'cry': return { ln: 0.45 * e, hx: 0.3 * e, arm: lerp(0.85, 2.0, e), al: lerp(0, 2.0, e), tw: Math.sin(t * 16) * 0.05 * e };
  }
  return null;
}
const mixP = (a, b, u) => { const o = {}; for (const k in a) o[k] = lerp(a[k], b[k], u); return o; };
function swingParams(c) {
  // 타격 순간이 서버의 windup(명중 판정 시점)과 맞도록 구성
  const raise = Math.max(c.windup * 0.62, 0.05);
  const strike = Math.max(c.windup * 0.38, 0.05);
  const rec = Math.max(0.14, c.cooldown - raise - strike);
  return { raise, strike, rec, total: raise + strike + rec };
}
function swingKeys(t, c) {
  const s = swingParams(c);
  if (t < s.raise) return ['idle', 'raised', easeOut(t / s.raise)];
  if (t < s.raise + s.strike) return ['raised', 'end', (t - s.raise) / s.strike];
  if (t < s.total) return ['end', 'idle', easeInOut((t - s.raise - s.strike) / s.rec)];
  return null;
}
const SKILL_DUR = { spin: 0.5, lunge: 0.45, bash: 0.45, rally: 0.8, kick: 0.45, ambush: 0.4, iaido: 0.4, shadowstep: 0.4 };
const SKILL_FREE = { rally: true, anthem: true, bloodrage: true, heal: true, bloom: true }; // 시전 중에도 움직이고 공격할 수 있는 스킬
const skillDur = (id) => SKILL_DUR[id] || (SKILLS[id]?.windup ? SKILLS[id].windup + 0.4 : 0.8);

function actionPose(a, c) {
  const u = a.t / a.dur;
  if (a.kind === 'emote') return emotePose(a.id, a.t, u);
  if (a.kind === 'swing') {
    if (isBowCls(c.id)) return drawPose(u, c.windup / a.dur, weaponOf(c.id) === 'crossbow');
    const k = swingKeys(a.t, c);
    if (!k) return null;
    const T = c.ranged ? CAST : weaponOf(c.id) === 'spear' ? SPEAR : P3;
    const p = mixP(T[k[0]], T[k[1]], k[2]);
    if (a.mirror && !c.ranged && weaponOf(c.id) !== 'spear') { p.tw = -p.tw; p.rz = -p.rz; p.al = -p.al * 0.5; }
    return p;
  }
  if (RANGED_SK[a.id]) {
    const sk = SKILLS[a.id];
    return isBowCls(c.id) ? drawPose(u, sk.windup / a.dur, weaponOf(c.id) === 'crossbow') : castPose(u, sk.windup / a.dur);
  }
  switch (POSE_OF[a.id] || a.id) {
    case 'spin': return { arm: 1.55, wr: -1.55, al: 1.3, ln: -0.1, tw: 0, spin: easeInOut(u) * TAU, st: 0.3 };
    case 'lunge': { const k = Math.min(1, u / 0.3); return { arm: lerp(0.9, 1.55, k), wr: lerp(0.5, -1.55, k), al: -0.8 * k, ln: -0.6 * k, tw: 0.25 * k, st: 0.95 * k }; }
    case 'bash': { const b = Math.sin(Math.min(1, u) * Math.PI); return { arm: 1.0, wr: 0.3, al: lerp(0.5, 1.75, b), ln: -0.35 * b, tw: 0.15 * b, st: 0.5 * b, sp: b }; }
    case 'rally': { const e = Math.min(1, u * 5) * Math.min(1, (1 - u) * 5); return { arm: lerp(0.85, 2.9, e), wr: lerp(0.5, -1.35, e), al: lerp(0, 2.9, e), ln: 0.15 * e, hx: 0.4 * e }; }
    case 'kick': { const b = Math.sin(Math.min(1, u / 0.66) * Math.PI); return { legR: 1.6 * b, arm: 0.5, al: 0.2, wr: 0.5, ln: 0.25 * b, tw: 0 }; }
  }
  return null;
}

function startAct(r, kind, id) {
  const c = CLASSES[r.cls];
  r.act = { kind, id, t: 0, dur: kind === 'emote' ? 2.2 : kind === 'swing' ? swingParams(c).total : skillDur(id), free: !!SKILL_FREE[id] || kind === 'emote', mirror: kind === 'swing' && ((r.combo ^= 1) === 1) };
}

// 어깨에서 (dx,dy,dz) 방향을 가리키는 팔 각도 (팔은 아래(-Y)로 늘어진 상태가 기준, x축 회전 a, z축 회전 c)
function solveArm(dx, dy, dz) {
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  return { c: Math.asin(clamp(dx, -1, 1)), a: Math.atan2(-dz, -dy) };
}
const _seg = new THREE.Vector3();
const _Zaxis = new THREE.Vector3(0, 0, 1);
function seg(m, a, b) { // 길이 1짜리 가는 막대를 두 점 사이에 맞춰 늘림
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.scale.z = len;
  m.quaternion.setFromUnitVectors(_Zaxis, _seg.set(dx / len, dy / len, dz / len));
}
function animateRig(r, dt, o) {
  const c = CLASSES[r.cls];
  r.phase += o.v * dt * 2.4 * (o.sprint ? 0.85 : 1);
  const amp = o.air ? 0.3 : clamp(o.v / 4.5, 0, 1) * 0.7 + (o.sprint ? 0.3 : 0);
  const s = Math.sin(r.phase);
  let legR = s * amp, legL = -s * amp;
  let armL = -s * amp * 0.9;
  let armR = P3.idle.arm + s * amp * 0.15, wr = P3.idle.wr;
  let tw = s * 0.1 * amp;
  let ln = o.sprint ? -0.3 : o.v > 0.5 ? -0.07 : -0.04;
  let spin = 0, hx = 0, sp = 0, rz = 0.06, lz = -0.06, bw = 0, hy = 0;
  if (r.bowPivot) { armL = 1.0; lz = -0.3; }
  if (r.spear) rz = -0.5;

  r.block = lerp(r.block, o.blocking ? 1 : 0, Math.min(1, dt * 14));
  const b = r.block;
  if (b > 0.01) {
    armR = lerp(armR, 1.5, b); wr = lerp(wr, 0.1, b); armL = lerp(armL, 1.3, b);
    tw = lerp(tw, 0.35, b); ln = lerp(ln, -0.12, b);
  }

  let P = null;
  if (r.act) {
    r.act.t += dt;
    if (r.act.t >= r.act.dur) r.act = null;
    else P = actionPose(r.act, c);
  }
  if (P) {
    if (P.arm !== undefined) armR = P.arm;
    if (P.wr !== undefined) wr = P.wr;
    if (P.al !== undefined) armL = P.al;
    if (P.tw !== undefined) tw = P.tw;
    if (P.ln !== undefined) ln = P.ln;
    if (P.st !== undefined) { legR = -P.st * 0.8; legL = P.st; }
    if (P.legR !== undefined) legR = P.legR;
    spin = P.spin || 0; hx = P.hx || 0; sp = P.sp || 0; hy = P.hy || 0; bw = P.bw || 0;
    if (P.rz !== undefined) rz = P.rz;
    if (P.lz !== undefined) lz = P.lz;
  }

  // ── 두 손 처리 ──
  const SH = 0.3375, SY = 0.675;
  if (r.bowPivot) {
    // 활/석궁: 왼손이 무기를 쥐고, 오른손은 시위(활) / 방아쇠 쪽(석궁)을 잡는다
    const xb = r.xbow;
    const delta = (xb ? -lz : -Math.PI / 2 - lz) * bw; // 활이 표적 방향(활: 몸 옆선, 석궁: 정면)을 가리키게 회전
    r.bowPivot.rotation.set(0, 0, delta);
    if (bw > 0.02) {
      const c2 = lz + delta, ca = Math.cos(armL), sa = Math.sin(armL);
      const f = { x: Math.sin(c2), y: -Math.cos(c2) * ca, z: -Math.cos(c2) * sa };               // 무기가 향하는 방향
      const G = { x: -SH + 0.62 * Math.sin(lz), y: SY - 0.62 * Math.cos(lz) * ca, z: -0.62 * Math.cos(lz) * sa }; // 왼손 위치
      const dd = xb ? 0.3 : lerp(0.26, 0.75, bw);                                                   // 오른손이 왼손에서 뒤로 물러난 거리
      const N = { x: G.x - f.x * dd, y: G.y - f.y * dd - (xb ? 0.04 : 0), z: G.z - f.z * dd };
      const sv = solveArm(N.x - SH, N.y - SY, N.z);
      const wgt = Math.min(1, bw * 2);
      armR = lerp(armR, sv.a, wgt);
      rz = lerp(rz, sv.c, wgt);
      if (r.bowFx) {
        const uv = { y: -sa, z: ca }; // 활이 서 있는 방향(세로)
        const tip = (s) => ({ x: G.x - f.x * 0.26, y: G.y - f.y * 0.26 + s * 0.58 * uv.y, z: G.z - f.z * 0.26 + s * 0.58 * uv.z });
        seg(r.bowFx.s1, tip(1), N);
        seg(r.bowFx.s2, tip(-1), N);
        seg(r.bowFx.ar, N, { x: G.x + f.x * 0.5, y: G.y + f.y * 0.5, z: G.z + f.z * 0.5 });
      }
    }
    if (r.bowFx) r.bowFx.visible = bw > 0.02;
    for (const m of r.bowModel.userData.stat) m.visible = bw <= 0.02;
  }
  if (r.spear) {
    // 창: 오른손 자루 위치에서 창이 향한 방향으로 조금 앞을 왼손이 받쳐 잡는다
    const sa = Math.sin(armR), ca = Math.cos(armR), sr = Math.sin(rz), cr = Math.cos(rz);
    const H = { x: SH + 0.62 * sr, y: SY - 0.62 * cr * ca, z: -0.62 * cr * sa };
    const wx = -sr * Math.sin(wr), wy = cr * Math.sin(wr), wz = -Math.cos(wr);
    const w = { x: wx, y: wy * ca - wz * sa, z: wy * sa + wz * ca };
    const sv = solveArm(H.x + w.x * 0.38 + SH, H.y + w.y * 0.38 - SY, H.z + w.z * 0.38);
    armL = sv.a;
    lz = sv.c;
  }

  // 웅크리기 / 슬라이딩 자세 (부드럽게 전환): 엉덩이를 낮추고 다리를 앞으로 뻗음
  r.crK = lerp(r.crK || 0, o.stance === 1 ? 1 : 0, Math.min(1, dt * 12));
  r.slK = lerp(r.slK || 0, o.stance === 2 ? 1 : 0, Math.min(1, dt * 12));
  let hipY = 0.675;
  if (r.crK > 0.01 || r.slK > 0.01) {
    legR = lerp(legR, 0.85, r.crK); legL = lerp(legL, 0.6, r.crK); ln = lerp(ln, -0.25, r.crK);
    legR = lerp(legR, 1.35, r.slK); legL = lerp(legL, 1.35, r.slK); ln = lerp(ln, 0.95, r.slK);
    hipY = lerp(lerp(0.675, 0.47, r.crK), 0.2, r.slK);
  }
  r.legR.position.y = r.legL.position.y = hipY;
  r.legR.rotation.x = legR;
  r.legL.rotation.x = legL;
  r.upper.rotation.set(ln, tw + spin, 0);
  r.upper.position.y = hipY + (o.air || hipY < 0.6 ? 0 : Math.abs(Math.cos(r.phase)) * 0.02 * amp);
  r.armR.rotation.set(armR, 0, rz);
  r.armL.rotation.set(armL, 0, lz);
  r.sword.rotation.x = -Math.PI / 2 + wr;
  r.head.rotation.set(clamp(o.pitch, -1.2, 1.2) * 0.8 - ln * 0.5 + hx, -tw * 0.5 + hy, 0);
  if (r.shield) {
    r.shield.position.set(lerp(-0.44, -0.12, b), lerp(0.4, 0.52, b), lerp(-0.16, -0.42, b) - 0.3 * sp);
  }

  const idx = Math.floor(r.phase / Math.PI);
  if (idx !== r.stepIdx) {
    r.stepIdx = idx;
    if (amp > 0.25 && !o.air && o.onStep) o.onStep();
  }
}

/* ═════════════ 이펙트 ═════════════ */
const fx = [];
const parts = [];
const ringGeo = new THREE.RingGeometry(0.88, 1, 40);
ringGeo.rotateX(-Math.PI / 2);
function ring(x, z, color, maxR, dur) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, 0.07, z);
  scene.add(m);
  fx.push({ m, t: 0, dur, maxR });
}
const sparkMats = {};
function burst(x, y, z, color, n = 8) {
  if (parts.length > 160) return;
  const mat = (sparkMats[color] ??= new THREE.MeshBasicMaterial({ color }));
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(BOX(0.08, 0.08, 0.08), mat);
    m.position.set(x, y, z);
    scene.add(m);
    parts.push({ m, vx: rand(-3, 3), vy: rand(1, 5), vz: rand(-3, 3), t: 0, life: rand(0.35, 0.6) });
  }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const u = f.t / f.dur;
    f.m.scale.setScalar(lerp(0.3, f.maxR, easeOut(Math.min(u, 1))));
    f.m.material.opacity = 0.9 * (1 - Math.min(u, 1));
    if (u >= 1) { scene.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    p.vy -= 14 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    if (p.t > p.life || p.m.position.y < 0.03) { scene.remove(p.m); parts.splice(i, 1); }
  }
}

/* ═════════════ 상태 ═════════════ */
const me = {
  id: null, cls: 'knight', x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0,
  hp: 100, alive: false, blocking: false, lastAtk: 0, onGround: true,
  sprinting: false,
  sprintB: 0, slide: null, crouching: false, slideCd: 0, eyeH: PLAYER.eye, slideTilt: 0, blockB: 0, act: null, dash: null, stunUntil: 0, buffUntil: 0, buffSpeed: 1, counterUntil: 0, team: 0, cd: {},
  bobPhase: 0, mv: 0, stepIdx: 0, kick: 0, roll: 0, shake: 0, fovK: 0, pendingCls: null,
  streak: 0, ping: 0, debugCam: false,
};
let joined = false;
let roster = [];
const remotes = new Map();
let selectedCls = 'knight';
let deadUntil = 0;
let killerName = '';
let mouseR = false;
let pendingJoin = {};
let crouchPress = false;
let touchPaused = false;
let vote = null;
let chatOpen = false, chatTeam = false, emoteOpen = false, emoteTimer = 0, endTimer = 0;
let matchInfo = { mode: 'ffa', limit: 20, teamScore: { 1: 0, 2: 0 }, over: false, hostId: null };
const TEAM_CSS = { 1: '#ff8c7a', 2: '#8ab8ff' };
const keys = {};

/* ═════════════ 1인칭 팔 / 칼 ═════════════ */
const vm = new THREE.Group();
camera.add(vm);
let fp = null;
const FP_PIVOT = { x: 0.34, y: -0.25, z: -0.24 }; // 1인칭 오른쪽 어깨 위치
function buildViewmodel() {
  vm.clear();
  const c = CLASSES[me.cls], L = getLook(me.cls), M = getMats(me.cls);
  const arm = new THREE.Group();
  arm.rotation.order = 'YXZ';
  arm.position.set(FP_PIVOT.x, FP_PIVOT.y, FP_PIVOT.z);
  vm.add(arm);
  const am = new THREE.Mesh(BOX(0.11, 0.42, 0.11), M.arm);
  am.position.y = -0.21;
  arm.add(am);
  const W = L.weapon || 'sword';
  const isB = isBowCls(me.cls);
  const sword = isB ? new THREE.Group() : W === 'sword' ? makeSword(swordLen(c) * 0.7, swordWide(c), L.trim) : makeWeapon(W, c, L);
  if (!isB && W !== 'sword') sword.scale.setScalar(0.7);
  sword.traverse((o) => { o.castShadow = false; });
  sword.position.y = -0.4;
  sword.rotation.x = -Math.PI / 2;
  arm.add(sword);
  let shield = null;
  if (me.cls === 'shield') {
    shield = makeShield(L);
    shield.castShadow = false;
    shield.rotation.y = Math.PI; // 바깥 무늬가 카메라 쪽을 보게
    shield.scale.setScalar(0.72);
    vm.add(shield);
  }
  const boot = new THREE.Mesh(BOX(0.2, 0.2, 0.55), M.leg);
  boot.visible = false;
  vm.add(boot);
  let bowG = null;
  if (isB) {
    bowG = makeBow(W, L);
    if (W === 'crossbow') { bowG.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); bowG.position.set(-0.06, -0.3, -0.6); }
    else { bowG.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 1).normalize(), Math.PI); bowG.position.set(-0.2, -0.3, -0.7); }
    bowG.scale.setScalar(0.75);
    bowG.traverse((o) => { o.castShadow = false; });
    vm.add(bowG);
  }
  fp = { arm, sword, shield, boot, bow: bowG };
}
const PF = {
  idle:   { a: 1.3, w: -0.35, yw: 0.12 },
  raised: { a: 2.6, w: -0.2,  yw: -0.3 },
  end:    { a: 1.5, w: -1.8,  yw: 0.7 },
};
function updateViewmodel(dt) {
  if (!fp) return;
  const c = CLASSES[me.cls];
  me.sprintB = lerp(me.sprintB, me.sprinting ? 1 : 0, Math.min(1, dt * 9));
  me.blockB = lerp(me.blockB, me.blocking ? 1 : 0, Math.min(1, dt * 14));

  let a = lerp(PF.idle.a, 0.8, me.sprintB), w = lerp(PF.idle.w, 0.05, me.sprintB), yw = lerp(PF.idle.yw, 0.35, me.sprintB);
  a = lerp(a, 1.45, me.blockB); w = lerp(w, -0.2, me.blockB); yw = lerp(yw, 0.55, me.blockB);
  let ox = 0, oy = 0, oz = 0, shieldPush = 0, bootB = 0;

  if (me.act) {
    me.act.t += dt;
    const ac = me.act;
    if (ac.t >= ac.dur) me.act = null;
    else {
      const u = ac.t / ac.dur;
      if (ac.kind === 'swing') {
        if (fp.bow) {
          const d = drawAmt(u, c.windup / ac.dur);
          a = lerp(1.2, 1.95, d); yw = lerp(0.15, 0.55, d); w = 0;
        } else {
          const k = swingKeys(ac.t, c);
          if (k) {
            const A = PF[k[0]], B = PF[k[1]];
            a = lerp(A.a, B.a, k[2]); w = lerp(A.w, B.w, k[2]); yw = lerp(A.yw, B.yw, k[2]);
            if (ac.mirror) yw = -yw * 0.8;
          }
        }
      } else if (ac.id === 'spin') {
        a = 1.5; w = -1.5; yw = lerp(-0.9, 1.5, easeInOut(u)); me.roll = Math.sin(u * TAU) * 0.05;
      } else if (ac.id === 'lunge') {
        const k = Math.min(1, u / 0.25);
        a = lerp(1.3, 1.55, k); w = lerp(-0.35, -1.55, k); yw = 0.35; oz = -0.25 * Math.sin(Math.min(1, u * 2) * Math.PI);
      } else if (ac.id === 'bash') {
        a = 1.2; shieldPush = Math.sin(Math.min(1, u) * Math.PI);
        if (!fp.shield) { a = 1.3; w = -0.8; oz = -0.2 * shieldPush; }
      } else if (ac.id === 'rally') {
        const e = Math.min(1, u * 5) * Math.min(1, (1 - u) * 5);
        a = lerp(a, 2.9, e); w = lerp(w, -1.35, e); yw = lerp(yw, 0, e);
      } else if (ac.id === 'kick') {
        a = 0.7; bootB = Math.sin(Math.min(1, u / 0.66) * Math.PI);
      }
    }
  }
  if (S.bob) {
    ox += Math.sin(me.bobPhase) * 0.012 * me.mv;
    oy += Math.abs(Math.cos(me.bobPhase)) * 0.016 * me.mv;
  }
  fp.arm.position.set(FP_PIVOT.x + ox, FP_PIVOT.y + oy, FP_PIVOT.z + oz);
  fp.arm.rotation.set(a, yw, 0);
  fp.sword.rotation.x = -Math.PI / 2 + w;
  if (fp.shield) {
    const bl = Math.max(me.blockB, shieldPush * 0.6);
    fp.shield.position.set(lerp(-0.4, -0.08, bl) + ox, lerp(-0.38, -0.18, bl) + oy, lerp(-0.62, -0.56, bl) - 0.3 * shieldPush);
    fp.shield.rotation.x = 0;
    fp.shield.rotation.z = lerp(0.08, 0, bl);
  }
  fp.boot.visible = bootB > 0.01;
  if (fp.boot.visible) {
    fp.boot.position.set(0.12, lerp(-0.85, -0.4, bootB), lerp(-0.1, -0.8, bootB));
    fp.boot.rotation.x = -0.35 * bootB;
  }
  vm.visible = me.alive;
}

/* ═════════════ 사운드 (WebAudio) ═════════════
   귀가 아프지 않게: 모든 소리가 저역 통과 필터와 컴프레서를 거치고, 시작을 부드럽게(어택) 하며, 약한 울림(리버브)을 섞습니다. */
let ac, master;
function makeImpulse(a, sec, decay) {
  const len = Math.floor(a.sampleRate * sec), buf = a.createBuffer(2, len, a.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function actx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = S.vol;
    const trim = ac.createGain(); trim.gain.value = 0.55;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5; // 날카로운 고음을 깎음
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -22; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25; // 큰 소리를 눌러 줌
    master.connect(trim).connect(lp).connect(comp).connect(ac.destination);
    try {
      const verb = ac.createConvolver(); verb.buffer = makeImpulse(ac, 0.9, 2.8);
      const vg = ac.createGain(); vg.gain.value = 0.22;
      lp.connect(verb).connect(vg).connect(comp);
    } catch {}
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
const out = () => { actx(); return master; };
// 부드러운 시작(attack)과 자연스러운 감쇠를 가진 톤
function tone(type, f0, f1, dur, vol, atk = 0.006, cut = 0) {
  const a = actx(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.85);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  let node = o;
  if (cut) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; o.connect(f); node = f; }
  node.connect(g).connect(out());
  o.start(t); o.stop(t + dur + 0.03);
}
function noiseBurst(dur, f0, f1, vol, type = 'bandpass', q = 0.9, atk = 0.012) {
  const a = actx(), t = a.currentTime;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = last * 0.72 + (Math.random() * 2 - 1) * 0.28; d[i] = last * 3; } // 약하게 걸러 거친 "치지직" 소리를 줄임
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(atk, dur * 0.4));
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(out());
  src.start(t);
}
function safe(fn) { return (...args) => { try { fn(...args); } catch {} }; }
// 칼이 부딪히는 소리: 날카로운 삼각파 대신 낮은 금속 배음 + 짧은 "챙" 잡음
const clang = safe((vol = 0.3) => {
  const j = 0.97 + Math.random() * 0.06;
  [[610, 1], [1480, 0.55], [2410, 0.3]].forEach(([f, k]) => tone('sine', f * j, f * j * 0.985, 0.55, vol * 0.7 * k, 0.003, 4200));
  noiseBurst(0.06, 3200, 1600, vol * 0.5, 'bandpass', 1.2, 0.002);
});
const thud = safe((vol = 0.4) => { tone('sine', 130, 48, 0.26, vol * 0.9, 0.004); noiseBurst(0.08, 600, 180, vol * 0.25, 'lowpass', 0.7); });
const whoosh = safe((vol = 0.15, hi = 2200) => noiseBurst(0.28, 380, Math.min(1500, hi * 0.5), vol * 0.9, 'bandpass', 0.7, 0.07));
const horn = safe((vol = 0.25) => { tone('triangle', 150, 175, 0.7, vol * 0.5, 0.06, 900); tone('sine', 75, 88, 0.7, vol * 0.6, 0.06); });
const stepSnd = safe((vol = 0.1) => noiseBurst(0.09, 420, 130, vol * 0.8, 'lowpass', 0.6, 0.01));
const bowShot = safe((vol = 0.2) => { // 활시위 튕김 + 화살이 공기를 가르는 소리
  tone('triangle', 260, 120, 0.22, vol * 0.8, 0.003, 1400);
  noiseBurst(0.18, 700, 2200, vol * 0.5, 'bandpass', 1.3, 0.03);
});
const slideSnd = safe((vol = 0.2) => { noiseBurst(0.55, 1100, 260, vol * 0.8, 'bandpass', 0.8, 0.05); tone('sine', 110, 70, 0.3, vol * 0.4, 0.02); });
const spellCast = safe((vol = 0.2) => { // 부드러운 마법 시전음
  tone('sine', 360, 820, 0.4, vol * 0.7, 0.05);
  tone('sine', 540, 1230, 0.4, vol * 0.35, 0.06, 3000);
  noiseBurst(0.35, 500, 1400, vol * 0.25, 'bandpass', 1.5, 0.08);
});
function volFor(id, base) {
  if (id === me.id) return base;
  const r = remotes.get(id);
  if (!r) return 0;
  const d = Math.hypot(r.root.position.x - me.x, r.root.position.z - me.z);
  return base * clamp(1 - d / 40, 0, 1);
}

/* ═════════════ UI: 캐릭터 카드 ═════════════ */
const STATS = [
  ['s_hp', (c) => c.hp / 150], ['s_speed', (c) => c.speed / 6.5], ['s_dmg', (c) => c.damage / 40],
  ['s_rate', (c) => 1 / c.cooldown / 2.7], ['s_range', (c) => Math.min(1, (c.ranged ? c.reach * (PROJ[c.proj]?.ext || 1) / 110 : c.reach / 5))], ['s_def', (c) => c.block],
];
function buildCards(container, selectedId, onPick) {
  container.textContent = '';
  for (const c of Object.values(CLASSES)) {
    const sk = SKILLS[c.skill];
    const el = document.createElement('div');
    el.className = 'card' + (c.id === selectedId ? ' sel' : '');
    el.innerHTML = '<h3></h3><p class="d"></p>'
      + STATS.map(([n, f]) => `<div class="stat"><span>${t(n)}</span><div class="bar"><i style="width:${Math.round(clamp(f(c), 0.05, 1) * 100)}%"></i></div></div>`).join('')
      + `<div class="skl"><b>Q</b> ${sk.icon} <em>${sname(sk)}</em> (${t('secs', { n: sk.cooldown })})</div>`
      + `<div class="skl" style="border:0;margin:0;padding:0"><b>E</b> 🦶 <em>${sname(SKILLS.kick)}</em> (${t('nocd')})</div>`;
    el.querySelector('h3').textContent = `${cname(c)} · ${crole(c)}`;
    el.querySelector('.d').textContent = cdesc(c);
    el.onclick = () => {
      container.querySelectorAll('.card').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      onPick(c.id);
    };
    container.appendChild(el);
  }
}
const pickLobby = (id) => { selectedCls = id; setPreviewClass(id); };
buildCards($('cards'), selectedCls, pickLobby);
$('name').value = (() => { try { return localStorage.getItem('ironoath_name') || ''; } catch { return ''; } })();
function renderHelp() {
  $('help-skills').innerHTML = Object.values(CLASSES).map((c) => {
    const sk = SKILLS[c.skill];
    return `<div style="margin:6px 0"><b>Q</b> ${sk.icon} <em>${sname(sk)}</em> <span style="opacity:.7">(${cname(c)})</span> — ${sdesc(sk)}</div>`;
  }).join('') + `<div style="margin:6px 0"><b>E</b> 🦶 <em>${sname(SKILLS.kick)}</em> — ${sdesc(SKILLS.kick)}</div>`;
}
renderHelp();

/* ═════════════ HUD 보조 ═════════════ */
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
function banner(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}
function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 6000);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
}
function dmgNumber(x, y, z, text, cls) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  if (v.z > 1 || v.z < -1) return;
  const el = document.createElement('div');
  el.className = 'dn ' + cls;
  el.textContent = text;
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function updateHud() {
  const c = CLASSES[me.cls];
  $('clsname').textContent = cname(c);
  $('hpfill').style.width = `${clamp((me.hp / c.hp) * 100, 0, 100)}%`;
  $('hptext').textContent = `${Math.ceil(me.hp)} / ${c.hp}`;
  $('lowhp').classList.toggle('on', me.alive && me.hp / c.hp < 0.3);
}
function renderBoard() {
  const body = $('boardbody');
  body.textContent = '';
  const rows = [...roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.id === me.id) tr.className = 'me';
    if (matchInfo.mode === 'tdm' && TEAM_CSS[r.team]) tr.style.color = TEAM_CSS[r.team];
    for (const [txt, cls] of [[r.name, ''], [CLASSES[r.cls] ? cname(CLASSES[r.cls]) : r.cls, ''], [r.kills, 'n'], [r.deaths, 'n']]) {
      const td = document.createElement('td');
      td.textContent = txt;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  const mine = roster.find((r) => r.id === me.id);
  $('kd').textContent = mine ? t('kd', { k: mine.kills, d: mine.deaths }) : '';
  updateMatchHud();
}
const nameOf = (id) => roster.find((r) => r.id === id)?.name ?? '???';

// 스킬 슬롯, 스태미나, 상태 아이콘
const slotEls = ['q', 'e'].map((k) => {
  const el = $('slot-' + k);
  return { k, el, ic: el.querySelector('.ic'), nm: el.querySelector('.nm'), fill: el.querySelector('.cdfill'), txt: el.querySelector('.cdtxt'), id: null, last: '' };
});
let hudTick = 0;
function updateHudFrame(nowMs, dt) {
  for (const s of slotEls) {
    const id = s.k === 'q' ? CLASSES[me.cls].skill : 'kick';
    const def = SKILLS[id];
    if (s.id !== id) { s.id = id; s.ic.textContent = def.icon; s.nm.textContent = sname(def); }
    const cdMs = def.cooldown * 1000 || PLAYER.kickGapMs;
    const rem = Math.max(0, (me.cd[id] || 0) - nowMs);
    const key = rem <= 0 ? 'r' : `${Math.round((rem / cdMs) * 100)}|${(rem / 1000).toFixed(rem < 10000 ? 1 : 0)}`;
    if (key !== s.last) {
      s.last = key;
      s.fill.style.height = rem <= 0 ? '0%' : `${(rem / cdMs) * 100}%`;
      s.txt.textContent = rem <= 0 ? '' : (rem / 1000).toFixed(rem < 10000 ? 1 : 0);
      s.el.classList.toggle('ready', rem <= 0);
    }
  }

  hudTick += dt;
  if (hudTick > 0.15) {
    hudTick = 0;
    const st = $('status');
    const items = [];
    if (nowMs < me.buffUntil) items.push(t('st_buff', { s: ((me.buffUntil - nowMs) / 1000).toFixed(1) }));
    if (nowMs < me.counterUntil) items.push(t('st_counter'));
    if (nowMs < me.stunUntil) items.push(t('st_stun'));
    if (st.dataset.k !== items.join('|')) {
      st.dataset.k = items.join('|');
      st.textContent = '';
      for (const t of items) { const d = document.createElement('div'); d.textContent = t; st.appendChild(d); }
    }
    $('stunned').style.display = nowMs < me.stunUntil && me.alive ? 'block' : 'none';
    if (S.netinfo) $('netinfo').textContent = t('ping', { p: me.ping, f: fps });
  }
}

// 미니맵: 내가 항상 위쪽을 보는 회전식 레이더
const mm = $('minimap'), mg = mm.getContext('2d');
const MM_RANGE = 30;
function drawMinimap() {
  const W = mm.width, s = W / 2 / MM_RANGE;
  mg.clearRect(0, 0, W, W);
  mg.save();
  mg.translate(W / 2, W / 2);
  mg.rotate(me.yaw);
  mg.translate(-me.x * s, -me.z * s);
  mg.fillStyle = 'rgba(80,125,55,.6)';
  mg.fillRect(-ARENA.half * s, -ARENA.half * s, ARENA.half * 2 * s, ARENA.half * 2 * s);
  mg.strokeStyle = '#d8d2c0';
  mg.lineWidth = 3;
  mg.strokeRect(-ARENA.half * s, -ARENA.half * s, ARENA.half * 2 * s, ARENA.half * 2 * s);
  mg.fillStyle = '#9c9a93';
  for (const p of ARENA.pillars) { mg.beginPath(); mg.arc(p.x * s, p.z * s, p.r * s, 0, TAU); mg.fill(); }
  mg.fillStyle = '#b9a98a';
  for (const b of ARENA.boxes) mg.fillRect((b.x - b.w / 2) * s, (b.z - b.d / 2) * s, b.w * s, b.d * s);
  mg.fillStyle = '#9c9a93';
  for (const r of remotes.values()) {
    if (!r.alive) continue;
    mg.fillStyle = matchInfo.mode === 'tdm' && r.team === me.team ? '#5ab0ff' : '#ff5a4a';
    mg.beginPath(); mg.arc(r.root.position.x * s, r.root.position.z * s, 4.5, 0, TAU); mg.fill();
    mg.strokeStyle = '#2a0805'; mg.lineWidth = 1.5; mg.stroke();
  }
  mg.restore();
  mg.fillStyle = '#ffe27a';
  mg.strokeStyle = '#3a2a05';
  mg.lineWidth = 1.5;
  mg.beginPath();
  mg.moveTo(W / 2, W / 2 - 8); mg.lineTo(W / 2 + 6, W / 2 + 6); mg.lineTo(W / 2, W / 2 + 2); mg.lineTo(W / 2 - 6, W / 2 + 6);
  mg.closePath(); mg.fill(); mg.stroke();
}

function applyHudSettings() {
  $('minimap').style.display = S.minimap ? 'block' : 'none';
  $('netinfo').style.display = S.netinfo ? 'block' : 'none';
  if (!S.netinfo) $('netinfo').textContent = '';
}

/* ═════════════ 네트워크 ═════════════ */
let ws = null;
let pingTimer = 0;
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  const name = $('name').value.trim() || 'Knight';
  try { localStorage.setItem('ironoath_name', name); } catch {}
  $('join').disabled = true;
  $('lobmsg').textContent = t('connecting');
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws = sock;
  sock.onopen = () => { send({ t: 'join', name, cls: selectedCls, token: window.ironToken || null, ...pendingJoin }); pendingJoin = {}; };
  sock.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  sock.onerror = () => {};
  sock.onclose = () => {
    if (ws !== sock) return; // 우리가 직접 나간 경우
    ws = null;
    const wasJoined = joined;
    goLobby(wasJoined ? t('dropped') : t('failconn'));
  };
}
$('join').onclick = () => {
  if (IS_TOUCH) { // 전체화면 + 가로 고정 시도 (지원하지 않는 기기에서는 조용히 무시)
    (document.documentElement.requestFullscreen?.() || Promise.resolve()).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  actx();
  connect();
  tryLock();
};

function syncRemotes() {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, r] of remotes) {
    const p = roster.find((x) => x.id === id);
    if (!p || p.cls !== r.cls || p.name !== r.name || (p.team || 0) !== (r.team || 0)) { removeRig(r); remotes.delete(id); }
  }
  for (const p of roster) {
    if (p.id === me.id || remotes.has(p.id)) continue;
    const rig = makeRig(p.cls, p.name, p.team || 0);
    remotes.set(p.id, {
      id: p.id, cls: p.cls, name: p.name, ...rig,
      yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, pitch: 0, px: 0, pz: 0, v: 0,
      blocking: false, alive: true, init: false, stunUntil: 0,
    });
  }
  void ids;
  renderBoard();
}

function actorPos(id) {
  if (id === me.id) return { x: me.x, y: me.y, z: me.z };
  const r = remotes.get(id);
  return r ? { x: r.root.position.x, y: r.root.position.y, z: r.root.position.z } : null;
}

function resetLocal() {
  Object.assign(me, {
    vy: 0, blocking: false, sprinting: false,
    sprintB: 0, slide: null, crouching: false, slideCd: 0, eyeH: PLAYER.eye, slideTilt: 0, blockB: 0, act: null, dash: null, stunUntil: 0, buffUntil: 0, cd: {}, kick: 0, roll: 0, shake: 0, fovK: 0, pendingCls: null,
  });
}

function handle(m) {
  switch (m.t) {
    case 'full':
      $('lobmsg').textContent = t('full');
      $('join').disabled = false;
      ws?.close();
      ws = null;
      break;
    case 'welcome':
      resetLocal();
      me.streak = 0;
      Object.assign(me, { team: m.team || 0, id: m.id, cls: m.cls, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, hp: m.hp, alive: true });
      roster = m.roster;
      applyMap(m.map || 'town');
      joined = true;
      buildViewmodel();
      syncRemotes();
      updateHud();
      $('lobby').style.display = 'none';
      $('hud').style.display = 'block';
      $('death').style.display = 'none';
      applyHudSettings();
      showView('main');
      refreshMenu();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);
      break;
    case 'roster':
      roster = m.list;
      syncRemotes();
      break;
    case 'pong':
      me.ping = Math.round(performance.now() - m.ts);
      break;
    case 'snap':
      for (const p of m.p) {
        if (p.id === me.id) {
          if (p.hp !== me.hp) { me.hp = p.hp; updateHud(); }
          continue;
        }
        const r = remotes.get(p.id);
        if (!r) continue;
        r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw; r.tpitch = p.pitch; if ((p.c || 0) === 2 && r.stance !== 2) slideSnd(volFor(p.id, 0.2));
        r.stance = p.c || 0; r.blocking = p.b; r.alive = p.alive;
        const pos = r.root.position;
        if (!r.init || Math.hypot(pos.x - p.x, pos.z - p.z) > 6) {
          pos.set(p.x, p.y, p.z); r.yaw = p.yaw; r.pitch = p.pitch; r.px = p.x; r.pz = p.z; r.init = true;
        }
      }
      break;
    case 'swing': {
      if (m.id === me.id) break;
      const r = remotes.get(m.id);
      if (r) startAct(r, 'swing');
      whoosh(volFor(m.id, 0.15));
      break;
    }
    case 'skill': {
      const r = remotes.get(m.id);
      if (m.id !== me.id && r) startAct(r, 'skill', m.skill);
      skillFx(m.id, m.skill);
      break;
    }
    case 'buff':
      if (m.id === me.id) { me.buffUntil = performance.now() + m.ms; me.buffSpeed = m.speed || 1; }
      break;
    case 'stun': {
      const until = performance.now() + m.ms;
      if (m.id === me.id) { me.stunUntil = until; me.dash = null; me.blocking = false; me.act = null; }
      else { const r = remotes.get(m.id); if (r) { r.stunUntil = until; r.act = null; } }
      break;
    }
    case 'hit': {
      const pos = actorPos(m.id);
      if (m.id === me.id) {
        me.hp = m.hp;
        updateHud();
        $('dmg').style.opacity = m.blocked ? 0.25 : 0.8;
        setTimeout(() => ($('dmg').style.opacity = 0), 120);
        me.kick += m.blocked ? 0.02 : 0.05;
        me.shake = Math.max(me.shake, m.blocked ? 0.25 : 0.6);
      }
      if (pos) burst(pos.x, pos.y + 1.1, pos.z, m.blocked ? 0xcfd8e8 : 0xc23b2e, m.blocked ? 5 : 9);
      if (m.by === me.id && m.id !== me.id) {
        const h = $('hitmark');
        h.className = m.blocked ? 'blocked' : '';
        h.style.opacity = 1;
        setTimeout(() => (h.style.opacity = 0), 150);
        if (pos) dmgNumber(pos.x, pos.y + 2.1, pos.z, (m.tag === 'counter' ? t('counter_tag') : m.tag === 'back' ? t('back_tag') : '') + m.dmg, m.blocked ? 'blocked' : m.skill || m.tag ? 'skill' : '');
      }
      m.blocked ? clang(volFor(m.id, 0.35)) : thud(volFor(m.id, 0.5));
      break;
    }
    case 'kill':
      feed(`${nameOf(m.killer)}  ⚔  ${nameOf(m.victim)}`);
      if (m.killer === me.id) {
        me.streak++;
        banner(me.streak >= 1 && me.streak <= 4 ? t('streak' + me.streak) : me.streak > 4 ? t('streakn', { n: me.streak }) : '');
      }
      if (m.victim === me.id) {
        me.alive = false;
        me.blocking = false;
        me.streak = 0;
        me.act = null; me.dash = null;
        killerName = nameOf(m.killer);
        deadUntil = performance.now() + PLAYER.respawnMs;
        $('death').style.display = 'block';
        updateHud();
      }
      break;
    case 'respawn':
      if (m.id === me.id) {
        const changed = m.cls !== me.cls;
        resetLocal();
        Object.assign(me, { cls: m.cls, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, hp: m.hp, alive: true });
        if (changed) buildViewmodel();
        $('death').style.display = 'none';
        updateHud();
        buildCards($('menu-cards'), me.cls, pickClass);
      } else {
        const r = remotes.get(m.id);
        if (r) { r.act = null; r.stunUntil = 0; }
      }
      break;
    case 'correct':
      me.x = m.x; me.y = m.y; me.z = m.z;
      me.dash = null;
      break;
    case 'error':
      $('lobmsg').textContent = t('err_' + m.code);
      $('join').disabled = false;
      ws?.close();
      ws = null;
      break;
    case 'votestart':
      vote = { modes: m.modes, maps: m.maps, myMode: null, myMap: null, counts: null, done: false };
      if ($('x-end').style.display === 'none') { $('x-end').innerHTML = '<div id="x-vote"></div><div id="x-endcd"></div>'; $('x-end').style.display = 'block'; startEndCountdown(m.ms + 3000); }
      renderVote();
      break;
    case 'votestatus':
      if (vote) { vote.counts = m; renderVote(); }
      break;
    case 'voteend':
      if (vote) {
        vote.done = true;
        renderVote();
        const box = $('x-vote');
        if (box) box.insertAdjacentHTML('beforeend', `<div style="margin-top:10px;color:#ffd24a">${esc(t('vote_result', { m: t('mode_' + m.mode), p: t('map_' + m.map) }))}</div>`);
      }
      break;
    case 'proj':
      spawnProj(m);
      break;
    case 'projend': {
      const i = shots.findIndex((x) => x.pid === m.pid);
      if (i >= 0) endShot(i, m.x, m.y, m.z);
      break;
    }
    case 'authrequired':
      $('lobmsg').textContent = t('needlogin');
      $('join').disabled = false;
      ws?.close();
      ws = null;
      break;
    case 'match':
      matchInfo = { mode: m.mode, limit: m.limit, teamScore: m.teamScore, over: m.over, hostId: m.hostId, map: m.map, custom: m.custom, room: m.room, remainMs: m.remainMs, at: performance.now() };
      applyMap(m.map);
      if (!m.over) { vote = null; clearInterval(endTimer); $('x-end').style.display = 'none'; }
      updateMatchHud();
      break;
    case 'matchend':
      showMatchEnd(m);
      break;
    case 'parry': {
      const pos = actorPos(m.id);
      if (pos) { ring(pos.x, pos.z, 0xfff2a0, 3, 0.35); burst(pos.x, pos.y + 1.3, pos.z, 0xffe27a, 14); }
      clang(volFor(m.id, 0.6));
      if (m.id === me.id) { me.counterUntil = performance.now() + PLAYER.counterWindowMs; banner(t('parry')); me.shake = Math.max(me.shake, 0.5); }
      if (m.by === me.id) banner(t('parried'));
      break;
    }
    case 'heal': {
      const pos = actorPos(m.id);
      if (m.id === me.id) { me.hp = m.hp; updateHud(); }
      if (pos) { burst(pos.x, pos.y + 1.2, pos.z, 0x7dffa0, 8); dmgNumber(pos.x, pos.y + 2.1, pos.z, '+' + m.amt, 'skill'); }
      break;
    }
    case 'chat':
      addChat(m);
      break;
    case 'emote': {
      const r = remotes.get(m.id), em = EMOTES.find((x) => x.id === m.e);
      if (r && em) { startAct(r, 'emote', m.e); showBubble(r, em.icon, 2200, true); }
      break;
    }
    case 'classqueued':
      me.pendingCls = m.immediate ? null : m.cls;
      $('menu-note').textContent = t(m.immediate ? 'cls_now' : 'cls_next', { c: cname(CLASSES[m.cls]) });
      if (!m.immediate) toast(t('cls_next', { c: cname(CLASSES[m.cls]) }));
      buildCards($('menu-cards'), me.pendingCls || me.cls, pickClass);
      break;
  }
}

function skillFx(id, skill) {
  const p = actorPos(id);
  if (!p) return;
  const v = (b) => volFor(id, b);
  if (skill === 'rally') { ring(p.x, p.z, 0xffd45a, 4.5, 0.7); horn(v(0.3)); }
  else if (skill === 'spin') { ring(p.x, p.z, 0xe9eef5, 4.2, 0.45); whoosh(v(0.3), 3000); }
  else if (skill === 'bash') { thud(v(0.45)); whoosh(v(0.12), 1200); }
  else if (skill === 'lunge') { whoosh(v(0.28), 4000); }
  else if (skill === 'kick') { whoosh(v(0.2), 1500); }
  else { const f = SKFX[skill]; if (f) ring(p.x, p.z, f[0], f[1], 0.6); whoosh(v(0.25), 2500); }
}

/* ═════════════ 메뉴 (ESC) ═════════════ */
let lobbySettings = false;
const locked = IS_TOUCH ? () => joined && !touchPaused && !chatOpen : () => document.pointerLockElement === canvas;
function showView(v) {
  document.querySelectorAll('.mview').forEach((el) => el.classList.toggle('on', el.id === 'mv-' + v));
  document.querySelector('#menu .mpanel').classList.toggle('wide', v === 'chars');
  if (v === 'chars') {
    $('menu-note').textContent = '';
    buildCards($('menu-cards'), me.pendingCls || me.cls, pickClass);
  }
}
function refreshMenu() {
  $('menu').style.display = (joined && !locked() && !chatOpen) || lobbySettings ? 'flex' : 'none';
}
function tryLock() {
  if (IS_TOUCH) { touchPaused = false; refreshMenu(); return; }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => toast(t('lockfail')));
  } catch {}
}
function resetInput() {
  for (const k in keys) keys[k] = false;
  mouseR = false;
  me.blocking = false;
}
function pickClass(id) {
  if (!joined) return;
  if (id === me.cls && !me.pendingCls) { $('menu-note').textContent = t('cls_same'); return; }
  send({ t: 'setclass', cls: id });
}
document.addEventListener('pointerlockchange', () => {
  if (!locked()) {
    resetInput();
    if (joined && !chatOpen) showView('main');
  } else {
    document.activeElement?.blur?.();
  }
  refreshMenu();
});
document.addEventListener('pointerlockerror', () => toast(t('lockfail2')));

document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
$('m-resume').onclick = () => tryLock();
$('m-home').onclick = () => leaveGame();
$('lobby-settings').onclick = () => { lobbySettings = true; showView('settings'); refreshMenu(); };
$('set-back').onclick = () => {
  if (joined) showView('main');
  else { lobbySettings = false; showView('main'); refreshMenu(); }
};

function goLobby(msg = '') {
  clearInterval(pingTimer);
  for (const r of remotes.values()) removeRig(r);
  remotes.clear();
  roster = [];
  joined = false;
  me.alive = false;
  me.id = null;
  $('feed').textContent = '';
  $('floaters').textContent = '';
  $('hud').style.display = 'none';
  vote = null; clearInterval(endTimer); applyMap('town');
  $('x-match').style.display = 'none'; $('x-end').style.display = 'none'; $('x-chatlog').textContent = '';
  $('death').style.display = 'none';
  $('lobby').style.display = 'flex';
  $('join').disabled = false;
  $('lobmsg').textContent = msg;
  lobbySettings = false;
  showView('main');
  if (locked()) document.exitPointerLock?.();
  refreshMenu();
}
function leaveGame() {
  const sock = ws;
  ws = null; // onclose가 '연결 끊김'으로 오해하지 않게
  try { sock?.close(); } catch {}
  goLobby('');
}

// 설정 UI
const setBinds = [
  ['sens', 'set-sens', 'o-sens', (v) => (+v).toFixed(2)],
  ['fov', 'set-fov', 'o-fov', (v) => `${v}°`],
  ['vol', 'set-vol', 'o-vol', (v) => `${Math.round(v * 100)}%`],
];
for (const [key, id, oid, fmt] of setBinds) {
  const el = $(id);
  el.value = S[key];
  $(oid).textContent = fmt(S[key]);
  el.oninput = () => {
    S[key] = +el.value;
    $(oid).textContent = fmt(S[key]);
    if (key === 'vol' && master) master.gain.value = S.vol;
    if (key === 'fov') { camera.fov = S.fov; camera.updateProjectionMatrix(); }
    saveSettings();
  };
}
$('set-quality').value = S.quality;
$('set-quality').onchange = (e) => { S.quality = e.target.value; applyQuality(); saveSettings(); };
for (const [key, id] of [['minimap', 'set-minimap'], ['netinfo', 'set-netinfo'], ['bob', 'set-bob']]) {
  const el = $(id);
  el.checked = S[key];
  el.onchange = () => { S[key] = el.checked; applyHudSettings(); saveSettings(); };
}

/* ═════════════ 입력 ═════════════ */
const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA');
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); if (joined) $('board').style.display = 'block'; }
  if (typing(e)) return;
  if (joined && locked() && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat || !joined || !locked()) return;
  if (e.code === 'KeyC') crouchPress = true;
  if (e.code === 'KeyQ') useSkill('q');
  if (e.code === 'KeyE') useSkill('e');
  if (emoteOpen) {
    const n = parseInt(e.code.replace('Digit', ''), 10);
    openEmoteList(false);
    if (n >= 1 && n <= EMOTES.length) sendEmote(n - 1);
    return;
  }
  if (vote && !vote.done) {
    const k = parseInt(e.code.replace('Digit', ''), 10) - 1;
    if (k >= 0 && k < vote.modes.length) castVote('mode', vote.modes[k]);
    else if (vote.maps.length > 1 && k >= vote.modes.length && k - vote.modes.length < vote.maps.length) castVote('map', vote.maps[k - vote.modes.length]);
    return;
  }
  if (e.code === 'KeyV') openEmoteList(true);
  if (e.code === 'Enter' || e.code === 'KeyY') { e.preventDefault(); openChat(false); }
  if (e.code === 'KeyT') { e.preventDefault(); openChat(true); }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') $('board').style.display = 'none';
  keys[e.code] = false;
});
addEventListener('blur', () => resetInput());
addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('mousemove', (e) => {
  if (IS_TOUCH || !locked() || !me.alive) return;
  const k = 0.0022 * S.sens;
  me.yaw -= e.movementX * k;
  me.pitch = clamp(me.pitch - e.movementY * k, -1.45, 1.45);
});
addEventListener('mousedown', (e) => {
  if (IS_TOUCH || !locked() || !joined) return;
  if (e.button === 0) tryAttack();
  if (e.button === 2) mouseR = true;
});
addEventListener('mouseup', (e) => { if (e.button === 2) mouseR = false; });

function startMeAct(kind, id) {
  const c = CLASSES[me.cls];
  me.act = { kind, id, t: 0, dur: kind === 'swing' ? swingParams(c).total : skillDur(id), free: !!SKILL_FREE[id], mirror: kind === 'swing' && ((me.combo = (me.combo || 0) ^ 1) === 1) };
}
const stunnedNow = () => performance.now() < me.stunUntil;
const busy = () => me.act && me.act.kind === 'skill' && !me.act.free;

function tryAttack() {
  if (!me.alive || stunnedNow() || busy()) return;
  const c = CLASSES[me.cls];
  const t = performance.now();
  if (t - me.lastAtk < c.cooldown * 1000) return;
  me.lastAtk = t;
  startMeAct('swing');
  me.blocking = false;
  send({ t: 'attack' });
  whoosh(0.18);
}
function useSkill(slot) {
  if (!me.alive || stunnedNow() || busy()) return;
  const id = slot === 'e' ? 'kick' : CLASSES[me.cls].skill;
  const def = SKILLS[id];
  const t = performance.now();
  if (t < (me.cd[id] || 0)) return;
  me.cd[id] = t + (id === 'kick' ? PLAYER.kickGapMs : def.cooldown * 1000);
  me.blocking = false;
  startMeAct('skill', id);
  send({ t: 'skill', slot });
  if (def.dash) me.dash = { t: 0, dur: def.dash.dur, speed: def.dash.speed, dx: -Math.sin(me.yaw), dz: -Math.cos(me.yaw) };
  if (def.dur) { me.buffUntil = t + def.dur; me.buffSpeed = def.speedMult || 1; }
  if (def.dash) me.fovK = 14;
  if (id === 'bash' || id === 'kick') me.shake = Math.max(me.shake, 0.3);
  skillFx(me.id, id);
}

/* ═════════════ 신규: 매치 HUD / 채팅 / 이모트 / 투사체 ═════════════ */
const SKFX = {
  heal: [0x7dffa0, 6], bloom: [0x7dffa0, 4], anthem: [0xff8ad0, 9], bloodrage: [0xff4a2a, 3.5], smite: [0xffe27a, 4.5],
  palm: [0xffffff, 3], impale: [0xdfe5ec, 3], ambush: [0x555577, 3], shadowstep: [0x6a4aa0, 3], iaido: [0xffb0c0, 4.5],
  fireball: [0xff8a2a, 2], volley: [0xc8e08a, 3], snare: [0x7fbf7f, 2.5], drain: [0x9a4ac0, 3], hex: [0xe04a8a, 3], overcharge: [0xffe27a, 2],
};
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

(function injectUi() {
  const st = document.createElement('style');
  st.textContent = `
  #x-match{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:20;display:none;pointer-events:none;text-align:center;
    background:rgba(15,12,8,.72);border:2px solid #6b5a3a;padding:6px 18px;color:#f3e7c4;font:bold 20px var(--font);text-shadow:0 2px 0 #000}
  #x-match small{display:block;font-size:12px;opacity:.75;font-weight:normal}
  #x-chatlog{position:fixed;left:14px;bottom:200px;width:360px;max-height:170px;overflow:hidden;z-index:20;pointer-events:none;
    font:14px/1.35 var(--font);color:#fff;text-shadow:0 1px 2px #000}
  #x-chatlog div{background:rgba(0,0,0,.38);padding:2px 8px;margin-top:2px;word-break:break-all}
  #x-chatin{position:fixed;left:14px;bottom:170px;width:360px;z-index:30;display:none;box-sizing:border-box;padding:6px 10px;font:14px var(--font);
    background:rgba(0,0,0,.75);border:2px solid #c9a24a;color:#fff;outline:none}
  #x-emotes{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:25;display:none;background:rgba(15,12,8,.82);border:2px solid #c9a24a;
    padding:12px 18px;color:#f3e7c4;font:16px var(--font);display:none;columns:2;column-gap:28px}
  #x-emotes div{margin:4px 0}#x-emotes b{color:#ffd45a}
  #x-end{position:fixed;inset:0;z-index:26;display:none;background:rgba(0,0,0,.55);color:#f3e7c4;font-family:var(--font);text-align:center;padding-top:12vh}
  #x-end h1{font-size:46px;margin:0 0 6px;text-shadow:0 3px 0 #000}
  #x-end table{margin:18px auto;border-collapse:collapse;font:16px var(--font);min-width:360px}
  #x-end td,#x-end th{padding:4px 14px;border-bottom:1px solid #5a4a2a}
  #x-vote{margin:10px auto;max-width:640px}#x-vote .vrow{margin:8px 0}#x-vote .vbtn{margin:3px;font-family:var(--font);font-size:13px}#x-vote .vbtn.sel{outline:3px solid #4db2ff;background:#26324a}#x-vote i{font-style:normal;color:#ffd24a;margin-left:6px}#x-vote .note{color:#8fa3c0;font-size:12px;margin-top:6px}`;
  document.head.appendChild(st);
  const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
  mk('x-match'); mk('x-chatlog'); mk('x-end');
  const em = mk('x-emotes');
  renderEmotes();
  const inp = document.createElement('input');
  inp.id = 'x-chatin'; inp.maxLength = 120; inp.autocomplete = 'off';
  document.body.appendChild(inp);
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = inp.value.trim();
      if (text) send({ t: 'chat', text, team: chatTeam });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  });
})();

function timeHtml() {
  if (matchInfo.over || matchInfo.remainMs == null) return '';
  const left = Math.max(0, matchInfo.remainMs - (performance.now() - matchInfo.at));
  const s = Math.ceil(left / 1000);
  return `<div style="font:22px var(--px);color:${s <= 30 ? '#ff6a5a' : '#fff'}">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</div>`;
}
function updateMatchHud() {
  const el = $('x-match');
  if (!joined) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const tm = timeHtml();
  if (matchInfo.mode === 'tdm') {
    const mine = me.team ? `${esc(t('m_myteam'))}: <span style="color:${TEAM_CSS[me.team]}">${esc(t('team_' + me.team))}</span> · ` : '';
    el.innerHTML = tm + `<span style="color:${TEAM_CSS[1]}">${esc(t('team_1'))} ${matchInfo.teamScore[1]}</span> <b>:</b> <span style="color:${TEAM_CSS[2]}">${matchInfo.teamScore[2]} ${esc(t('team_2'))}</span><small>${mine}${esc(t('m_tdm', { n: matchInfo.limit }))}</small>`;
  } else {
    const top = [...roster].sort((a, b) => b.kills - a.kills)[0];
    el.innerHTML = tm + `${esc(t('m_ffa', { n: matchInfo.limit }))}<small>${top ? esc(t('m_lead', { n: top.name, k: top.kills })) : ''}</small>`;
  }
}

function showMatchEnd(m) {
  const el = $('x-end');
  const title = esc(m.draw ? t('draw') : m.mode === 'tdm' ? t('win_team', { t: t('team_' + m.winnerTeam) }) : t('win_player', { n: nameOf(m.winnerId) }));
  const mineWon = !m.draw && (m.mode === 'tdm' ? m.winnerTeam === me.team : m.winnerId === me.id);
  const rows = m.board.slice(0, 8).map((r) => `<tr style="color:${m.mode === 'tdm' ? TEAM_CSS[r.team] : '#f3e7c4'}"><td>${esc(r.name)}</td><td>${esc(CLASSES[r.cls] ? cname(CLASSES[r.cls]) : r.cls)}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('');
  el.innerHTML = `<h1>${title}</h1><div>${m.draw ? '' : esc(mineWon ? t('victory') : t('defeat'))}</div><table><tr><th>${esc(t('b_name'))}</th><th>${esc(t('b_class'))}</th><th>${esc(t('b_kills'))}</th><th>${esc(t('b_deaths'))}</th></tr>${rows}</table><div id="x-vote"></div><div id="x-endcd"></div>`;
  el.style.display = 'block';
  startEndCountdown(m.nextMs);
}
function startEndCountdown(ms) {
  const until = performance.now() + ms;
  clearInterval(endTimer);
  endTimer = setInterval(() => {
    const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
    const cd = $('x-endcd');
    if (cd) cd.textContent = t('nextmatch', { s: left });
  }, 250);
}
function renderVote() {
  const el = $('x-vote');
  if (!el || !vote) return;
  let n = 0;
  const row = (key, opts, label) => `<div class="vrow"><b>${esc(t(key === 'mode' ? 'vote_mode' : 'vote_map'))}</b> ` + opts.map((o) => `<button class="btn2 vbtn${vote[key === 'mode' ? 'myMode' : 'myMap'] === o ? ' sel' : ''}" data-k="${key}" data-v="${o}">[${++n}] ${esc(label(o))} <i>${vote.counts?.[key]?.[o] ?? 0}</i></button>`).join(' ') + '</div>';
  el.innerHTML = `<h3 style="margin:14px 0 4px">${esc(t('vote_title'))}</h3>` + row('mode', vote.modes, (o) => t('mode_' + o)) + (vote.maps.length > 1 ? row('map', vote.maps, (o) => t('map_' + o)) : '') + `<div class="note">${esc(t(IS_TOUCH ? 'vote_tap' : 'vote_hint'))}</div>`;
  if (!vote.done) el.querySelectorAll('.vbtn').forEach((b) => { b.onclick = () => castVote(b.dataset.k, b.dataset.v); });
}
function castVote(key, val) {
  if (!vote || vote.done) return;
  vote[key === 'mode' ? 'myMode' : 'myMap'] = val;
  send({ t: 'vote', [key]: val });
  renderVote();
}

// 말풍선 (채팅/이모트)
function clearBubble(r) {
  if (!r.bubble) return;
  r.root.remove(r.bubble.s);
  r.bubble.s.material.map.dispose();
  r.bubble.s.material.dispose();
  r.bubble = null;
}
function showBubble(r, text, ms = 3500, big = false) {
  clearBubble(r);
  const s = nameSprite(text.length > 18 ? text.slice(0, 17) + '…' : text, big ? '#ffffff' : '#fff7d6');
  s.position.y = 2.75;
  if (big) s.scale.set(2.4, 0.6, 1);
  r.root.add(s);
  r.bubble = { s, until: performance.now() + ms };
}

// 채팅
function addChat(m) {
  const log = $('x-chatlog');
  const d = document.createElement('div');
  const col = matchInfo.mode === 'tdm' && TEAM_CSS[m.team] ? TEAM_CSS[m.team] : '#ffe9a8';
  d.innerHTML = `${m.teamOnly ? '<b style="color:#8fe08f">' + esc(t('tag_team')) + '</b> ' : ''}<b style="color:${col}">${esc(m.name)}</b>: ${esc(m.text)}`;
  log.appendChild(d);
  setTimeout(() => d.remove(), 12000);
  while (log.children.length > 7) log.firstChild.remove();
  const r = remotes.get(m.id);
  if (r) showBubble(r, m.text, 4000, false);
}
function openChat(team) {
  if (!joined) return;
  chatTeam = team && matchInfo.mode === 'tdm';
  chatOpen = true;
  const inp = $('x-chatin');
  inp.value = '';
  inp.placeholder = chatTeam ? t('chatTeam') : t('chatAll');
  inp.style.display = 'block';
  document.exitPointerLock?.();
  setTimeout(() => inp.focus(), 30);
}
function closeChat() {
  chatOpen = false;
  const inp = $('x-chatin');
  inp.style.display = 'none';
  inp.blur();
  refreshMenu();
  tryLock();
}

// 이모트 (V → 숫자 1~8)
function openEmoteList(on) {
  clearTimeout(emoteTimer);
  emoteOpen = on;
  $('x-emotes').style.display = on ? 'block' : 'none';
  if (on) emoteTimer = setTimeout(() => openEmoteList(false), 3500);
}
function sendEmote(i) {
  const e = EMOTES[i];
  if (!e) return;
  send({ t: 'emote', e: e.id });
  toast(`${e.icon} ${t('em_' + e.id)}`);
}

// 원거리 투사체 (화살 / 마법탄): 서버가 보낸 출발점·속도·중력 값으로 서버와 똑같이 날립니다.
// 사거리(flat)까지는 직선, 그 너머는 중력으로 포물선. 맞았는지는 서버가 정하고 'projend'로 알려 줍니다.
const shots = [];
const shotMats = {};
const shotMat = (color) => (shotMats[color] ??= new THREE.MeshBasicMaterial({ color }));
function spawnProj(m) {
  const arrow = m.kind === 'arrow';
  const color = arrow ? 0xd8c8a0 : (SKFX[m.skill]?.[0] ?? CLASSES[m.cls]?.color ?? 0xffffff);
  const big = !!m.skill;
  const mesh = new THREE.Mesh(arrow ? BOX(0.03, 0.03, 0.7) : BOX(big ? 0.4 : 0.26, big ? 0.4 : 0.26, big ? 0.4 : 0.26), shotMat(color));
  mesh.position.set(m.x, m.y, m.z);
  const vel = new THREE.Vector3(m.vx, m.vy, m.vz);
  if (arrow) mesh.lookAt(mesh.position.clone().add(vel));
  scene.add(mesh);
  shots.push({ m: mesh, vel, trav: 0, flat: m.flat, max: m.max, g: m.g, arrow, color, pid: m.pid, age: 0 });
  if (m.first) (arrow ? bowShot : spellCast)(volFor(m.by, arrow ? 0.22 : 0.2));
}
function endShot(i, x, y, z) {
  const s = shots[i];
  if (!s.arrow) burst(x, y, z, s.color, 8);
  scene.remove(s.m);
  shots.splice(i, 1);
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.age += dt;
    const speed = s.vel.length();
    const n = Math.max(1, Math.ceil((speed * dt) / 0.8)), h = dt / n;
    let done = s.age > 6;
    for (let k = 0; k < n && !done; k++) {
      const p = s.m.position, ox = p.x, oy = p.y, oz = p.z;
      const sp = s.vel.length();
      if (s.trav >= s.flat) s.vel.y -= s.g * h;
      p.addScaledVector(s.vel, h);
      s.trav += sp * h;
      if (p.y <= 0 || s.trav >= s.max || projBlocked(ox, oy, oz, p.x, p.y, p.z)) done = true;
    }
    if (s.arrow) s.m.lookAt(s.m.position.clone().add(s.vel)); // 화살촉이 날아가는 방향을 따라 기울어짐
    else { s.m.rotation.z += dt * 10; s.m.rotation.x += dt * 7; }
    if (done) endShot(i, s.m.position.x, s.m.position.y, s.m.position.z);
  }
}

/* ═════════════ 로비: 3D 캐릭터 미리보기 / 탭 / 언어 / 방장 모드 ═════════════ */
function renderEmotes() {
  const box = $('x-emotes');
  if (box) {
    box.innerHTML = EMOTES.map((e, i) => `<div><b>${i + 1}</b> ${e.icon} ${esc(t('em_' + e.id))}</div>`).join('');
    box.querySelectorAll('div').forEach((d, i) => { d.style.cursor = 'pointer'; d.onclick = () => { openEmoteList(false); sendEmote(i); }; }); // 터치/클릭으로 선택
  }
}
let pv = null;
function initPreview() {
  const cv = $('pv');
  if (!cv) return;
  const rend = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true });
  rend.setPixelRatio(1);
  const sc = new THREE.Scene();
  sc.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 1.1);
  dl.position.set(3, 5, 4);
  sc.add(dl);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(0, 1.15, 4.4);
  cam.lookAt(0, 0.95, 0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 20), new THREE.MeshLambertMaterial({ color: 0x2a3550 }));
  base.position.y = -0.04;
  sc.add(base);
  pv = { rend, sc, cam, rig: null, next: 1.2 };
}
function setPreviewClass(id) {
  if (!pv) return;
  if (pv.rig) pv.sc.remove(pv.rig.root);
  const rig = makeRig(id, '', 0);
  scene.remove(rig.root); // makeRig 는 게임 장면에 넣어 버리므로 미리보기 장면으로 옮김
  rig.label.visible = false;
  rig.cls = id;
  rig.root.rotation.y = 0.5;
  pv.sc.add(rig.root);
  pv.rig = rig;
  pv.next = 1.0;
  updatePreviewInfo();
}
function updatePreviewInfo() {
  const c = CLASSES[selectedCls];
  if (!c || !$('pv-name')) return;
  const sk = SKILLS[c.skill];
  $('pv-name').textContent = cname(c);
  $('pv-role').textContent = crole(c);
  $('pv-desc').textContent = cdesc(c);
  $('pv-stats').innerHTML = STATS.map(([n, f]) => `<div class="stat"><span>${esc(t(n))}</span><div class="bar"><i style="width:${Math.round(clamp(f(c), 0.05, 1) * 100)}%"></i></div></div>`).join('');
  $('pv-skill').innerHTML = `<b>Q</b> ${sk.icon} <em>${esc(sname(sk))}</em> — ${esc(sdesc(sk))} (${esc(t('secs', { n: sk.cooldown }))})<br><b>E</b> 🦶 <em>${esc(sname(SKILLS.kick))}</em> (${esc(t('nocd'))})`;
}
function renderPreview(dt) {
  if (!pv || $('lobby').style.display === 'none') return;
  const cv = pv.rend.domElement;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { pv.rend.setSize(w, h, false); pv.cam.aspect = w / h; pv.cam.updateProjectionMatrix(); }
  const r = pv.rig;
  if (r) {
    pv.next -= dt;
    r.root.rotation.y += dt * 0.7;
    if (pv.next <= 0) { startAct(r, 'swing'); pv.next = 2.4; } // 2.4초마다 공격 동작 시연
    animateRig(r, dt, { v: 0, air: false, sprint: false, blocking: false, pitch: 0, onStep() {} });
  }
  pv.rend.render(pv.sc, pv.cam);
}

document.querySelectorAll('[data-tab]').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.tab === 'settings') { $('lobby-settings').click(); return; }
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
    $('lobby').classList.toggle('wide', b.dataset.tab === 'ranks');
  };
});
for (const id of ['lang', 'set-lang']) {
  const s = $(id);
  if (!s) continue;
  s.innerHTML = LANGS.map((l) => `<option value="${l.code}">${l.label}</option>`).join('');
  s.value = getLang();
  s.onchange = () => setLang(s.value);
}
onLang(() => {
  for (const id of ['lang', 'set-lang']) if ($(id)) $(id).value = getLang();
  buildCards($('cards'), selectedCls, pickLobby);
  renderHelp();
  updatePreviewInfo();
  renderEmotes();
  updateMatchHud();
});
const MAP_IDS = Object.keys(MAPS);
function updateModeBtn() {
  const b = $('m-mode'), mb = $('m-map');
  if (!b) return;
  const host = joined && me.id != null && matchInfo.hostId === me.id;
  b.style.display = host ? '' : 'none';
  mb.style.display = host ? '' : 'none';
  if (host) {
    b.textContent = `${t('host_mode')} → ${t(matchInfo.mode === 'tdm' ? 'mode_ffa' : 'mode_tdm')}`;
    mb.textContent = `${t('host_map')} → ${t('map_' + MAP_IDS[(MAP_IDS.indexOf(matchInfo.map) + 1) % MAP_IDS.length])}`;
  }
}
$('m-map').onclick = () => send({ t: 'setroom', map: MAP_IDS[(MAP_IDS.indexOf(matchInfo.map) + 1) % MAP_IDS.length] });
setInterval(updateMatchHud, 500);
setInterval(updateModeBtn, 500);
$('m-mode').onclick = () => send({ t: 'setmode', mode: matchInfo.mode === 'tdm' ? 'ffa' : 'tdm' });
/* ── 방 목록 / 방 만들기 ── */
function fillRoomForm() {
  $('rc-mode').innerHTML = ['ffa', 'tdm'].map((x) => `<option value="${x}">${esc(t('mode_' + x))}</option>`).join('');
  $('rc-map').innerHTML = MAP_IDS.map((x) => `<option value="${x}">${esc(t('map_' + x))}</option>`).join('');
  $('rc-max').innerHTML = [2, 4, 6, 8, 10, 12, 16].map((n) => `<option value="${n}"${n === 8 ? ' selected' : ''}>${esc(t('room_max'))}: ${n}</option>`).join('');
}
async function refreshRooms() {
  let data;
  try { data = await (await fetch('/rooms.json', { cache: 'no-store' })).json(); } catch { return; }
  const box = $('roomlist');
  box.textContent = '';
  $('roomempty').textContent = data.list.length ? '' : t('room_empty');
  for (const r of data.list) {
    const row = document.createElement('div');
    row.className = 'rrow';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = `${r.locked ? '🔒 ' : ''}${r.name}`;
    const sm = document.createElement('small');
    sm.textContent = `${t(r.custom ? 'room_host' : 'room_public')} · ${t('mode_' + r.mode)} · ${t('map_' + r.map)} · ${r.count}/${r.max}`;
    nm.appendChild(sm);
    const btn = document.createElement('button');
    btn.className = 'btn2';
    btn.textContent = t('room_join');
    btn.disabled = r.count >= r.max;
    btn.onclick = () => {
      let password = '';
      if (r.locked) { password = window.prompt(t('room_pw_prompt')) ?? null; if (password === null) return; }
      pendingJoin = { room: r.id, password };
      $('join').click();
    };
    row.append(nm, btn);
    box.appendChild(row);
  }
}
$('room-refresh').onclick = refreshRooms;
$('rc-go').onclick = () => {
  pendingJoin = { create: { name: $('rc-name').value, password: $('rc-pass').value, mode: $('rc-mode').value, map: $('rc-map').value, max: Number($('rc-max').value) } };
  $('join').click();
};
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab === 'rooms') refreshRooms(); }));
setInterval(() => { if ($('tab-rooms').classList.contains('on') && $('lobby').style.display !== 'none') refreshRooms(); }, 5000);
fillRoomForm();
onLang(() => { fillRoomForm(); refreshRooms(); });
applyI18n();
initPreview();
setPreviewClass(selectedCls);

/* ═════════════ 모바일 터치 조작 (가로 모드 · 작은 버튼) ═════════════
   왼쪽: 떠다니는 조이스틱(끝까지 밀면 달리기) / 오른쪽 빈 곳: 드래그로 시점 / 오른쪽 아래: 공격·방어·점프·Q·E / 오른쪽 위: 메뉴·채팅·이모트·점수판
   버튼 위치·크기는 아래 BTN 표에서 바꿀 수 있습니다. (나중에 사용자 설정 화면으로 확장 가능) */
function openTouchMenu() {
  if (!joined) return;
  touchPaused = true;
  resetInput();
  showView('main');
  refreshMenu();
}
const BTN = {
  attack: { label: '⚔', size: 54, right: 20, bottom: 62 },
  block:  { label: '🛡', size: 44, right: 88, bottom: 28 },
  jump:   { label: '⤒', size: 40, right: 22, bottom: 128 },
  skill:  { label: 'Q', size: 40, right: 92, bottom: 86 },
  kick:   { label: 'E', size: 36, right: 148, bottom: 44 },
  crouch: { label: '⬇', size: 34, right: 150, bottom: 92 },
  menu:   { label: '☰', size: 34, right: 8, top: 8 },
  chat:   { label: '💬', size: 34, right: 8, top: 48 },
  emote:  { label: '😀', size: 34, right: 8, top: 88 },
  score:  { label: '📋', size: 34, right: 8, top: 128 },
};
function initTouch() {
  const st = document.createElement('style');
  st.textContent = `
  #tc{position:fixed;inset:0;z-index:8;display:none;pointer-events:none;touch-action:none}
  #tc .zone{position:absolute;pointer-events:auto;touch-action:none}
  #tc .b{position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;border-radius:50%;
    background:rgba(20,28,44,.5);border:2px solid rgba(255,255,255,.55);color:#fff;font:700 14px var(--px);user-select:none;-webkit-user-select:none}
  #tc .b.on{background:rgba(77,178,255,.7)}
  #tj-base{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);display:none;pointer-events:none}
  #tj-knob{position:absolute;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;background:rgba(255,255,255,.5);display:none;pointer-events:none}`;
  document.head.appendChild(st);
  const tc = document.createElement('div');
  tc.id = 'tc';
  document.body.appendChild(tc);

  // 시점: 오른쪽 넓은 영역 드래그
  const look = document.createElement('div');
  look.className = 'zone';
  look.style.cssText = 'right:0;top:0;width:62%;height:100%';
  tc.appendChild(look);
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => { e.preventDefault(); look.setPointerCapture?.(e.pointerId); lookId = e.pointerId; lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId || !me.alive) return;
    const k = 0.0042 * S.sens;
    me.yaw -= (e.clientX - lx) * k;
    me.pitch = clamp(me.pitch - (e.clientY - ly) * k, -1.45, 1.45);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', endLook);
  look.addEventListener('pointercancel', endLook);

  // 이동: 왼쪽 아래 떠다니는 조이스틱
  const zone = document.createElement('div');
  zone.className = 'zone';
  zone.style.cssText = 'left:0;bottom:0;width:38%;height:75%';
  tc.appendChild(zone);
  const base = document.createElement('div'); base.id = 'tj-base'; tc.appendChild(base);
  const knob = document.createElement('div'); knob.id = 'tj-knob'; tc.appendChild(knob);
  let jId = null, jx = 0, jy = 0;
  const R = 52;
  const setKeys = (vx, vy, full) => {
    keys.KeyD = vx > 0.3; keys.KeyA = vx < -0.3; keys.KeyS = vy > 0.3; keys.KeyW = vy < -0.3;
    keys.ShiftLeft = full && vy < -0.5; // 끝까지 앞으로 밀면 달리기
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault(); zone.setPointerCapture?.(e.pointerId);
    jId = e.pointerId; jx = e.clientX; jy = e.clientY;
    for (const el of [base, knob]) { el.style.display = 'block'; el.style.left = jx + 'px'; el.style.top = jy + 'px'; }
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== jId) return;
    let dx = e.clientX - jx, dy = e.clientY - jy;
    const d = Math.hypot(dx, dy), full = d >= R;
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.left = jx + dx + 'px'; knob.style.top = jy + dy + 'px';
    setKeys(dx / R, dy / R, full);
  });
  const endJoy = (e) => {
    if (e.pointerId !== jId) return;
    jId = null; base.style.display = knob.style.display = 'none';
    setKeys(0, 0, false);
  };
  zone.addEventListener('pointerup', endJoy);
  zone.addEventListener('pointercancel', endJoy);

  // 버튼
  const mkb = (def, down, up) => {
    const b = document.createElement('div');
    b.className = 'b';
    b.textContent = def.label;
    const pos = ['right', 'bottom', 'top', 'left'].filter((k) => def[k] != null).map((k) => `${k}:${def[k]}px`).join(';');
    b.style.cssText = `${pos};width:${def.size}px;height:${def.size}px`;
    tc.appendChild(b);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); down?.(); });
    const end = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); up?.(); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    return b;
  };
  let atkIv = 0;
  mkb(BTN.attack, () => { tryAttack(); atkIv = setInterval(tryAttack, 90); }, () => clearInterval(atkIv)); // 누르고 있으면 연속 공격
  mkb(BTN.block, () => { mouseR = true; }, () => { mouseR = false; });                                    // 누르는 순간 = 패링 타이밍
  mkb(BTN.jump, () => { keys.Space = true; }, () => { keys.Space = false; });
  mkb(BTN.skill, () => useSkill('q'));
  mkb(BTN.kick, () => useSkill('e'));
  mkb(BTN.crouch, () => { keys.KeyC = true; crouchPress = true; }, () => { keys.KeyC = false; }); // 누르고 있으면 웅크리기, 달리는 중 누르면 슬라이딩
  mkb(BTN.menu, () => openTouchMenu());
  mkb(BTN.chat, () => openChat(false));
  mkb(BTN.emote, () => openEmoteList(true));
  mkb(BTN.score, () => { const b = $('board'); b.style.display = b.style.display === 'block' ? 'none' : 'block'; });

  // 채팅 입력창 바깥을 누르면 닫기 (모바일 키보드는 Esc가 없으므로)
  $('x-chatin').addEventListener('blur', () => setTimeout(() => { if (chatOpen) closeChat(); }, 200));
  // 조작 UI는 게임 중에만 표시
  setInterval(() => { tc.style.display = joined && !touchPaused && !chatOpen && !matchInfo.over ? 'block' : 'none'; }, 150);
}
if (IS_TOUCH) initTouch();

/* ═════════════ 메인 루프 ═════════════ */
const clock = new THREE.Clock();
let sendTimer = 0;
let fps = 0, fpsAcc = 0, fpsN = 0;
let mmTick = 0;

const endSlide = (nowMs) => { me.slide = null; me.slideCd = nowMs + 600; };
function update(dt, nowMs) {
  const c = CLASSES[me.cls];
  const stunned = nowMs < me.stunUntil;
  const buffed = nowMs < me.buffUntil;
  let speedH = 0;

  if (joined && me.alive) {
    const wasBlock = me.blocking;
    me.blocking = !stunned && locked() && (mouseR || keys.KeyF === true) && !me.act && !me.slide;
    if (me.blocking && !wasBlock) sendTimer = 1; // 패링 타이밍을 위해 방어 시작을 즉시 전송
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);

    // 달리기 (Shift): 앞으로 갈 때만, 방어 중엔 불가. 체력(스태미나) 소모 없이 계속 달릴 수 있음
    const wantSprint = !!(keys.ShiftLeft || keys.ShiftRight) && f > 0 && !me.blocking && !stunned && locked();
    // 웅크리기: C를 누르고 있는 동안 / 슬라이딩: 달리는 중에 C를 누르는 순간
    if (crouchPress) {
      crouchPress = false;
      if (wantSprint && me.onGround && !me.slide && !me.dash && nowMs >= me.slideCd) {
        const flen = Math.hypot(f, s);
        const fxx = -Math.sin(me.yaw), fzz = -Math.cos(me.yaw), rxx = Math.cos(me.yaw), rzz = -Math.sin(me.yaw);
        me.slide = { t: 0, dur: 0.85, dx: (fxx * f + rxx * s) / flen, dz: (fzz * f + rzz * s) / flen, v0: c.speed * PLAYER.sprintMult * 1.45, fx: 0 };
        me.fovK = Math.max(me.fovK, 10);
        slideSnd(0.25);
      }
    }
    if (me.slide && (stunned || me.dash)) endSlide(nowMs);
    me.crouching = !!keys.KeyC && !me.slide && !stunned && locked();
    const sprinting = wantSprint && !me.crouching && !me.slide;
    me.sprinting = sprinting;

    let vx = 0, vz = 0;
    if (me.dash) {
      me.dash.t += dt;
      vx = me.dash.dx * me.dash.speed;
      vz = me.dash.dz * me.dash.speed;
      if (me.dash.t >= me.dash.dur) me.dash = null;
    } else if (me.slide) {
      const sl = me.slide;
      sl.t += dt;
      const k = Math.min(1, sl.t / sl.dur);
      const v = c.speed * 0.5 + (sl.v0 - c.speed * 0.5) * Math.pow(1 - k, 1.6); // 처음엔 빠르게, 점점 느려짐
      vx = sl.dx * v;
      vz = sl.dz * v;
      sl.fx -= dt;
      if (sl.fx <= 0) { sl.fx = 0.07; burst(me.x, me.y + 0.1, me.z, 0xd8ccb0, 2); }
      if (k >= 1) endSlide(nowMs);
    } else if (!stunned && (f || s)) {
      const len = Math.hypot(f, s);
      const sp = c.speed
        * (sprinting ? PLAYER.sprintMult : 1)
        * (me.blocking ? 0.55 : 1)
        * (me.crouching ? 0.5 : 1)
        * (me.act && me.act.kind === 'swing' ? 0.8 : 1)
        * (buffed ? me.buffSpeed : 1);
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
      vx = ((fx * f + rx * s) / len) * sp;
      vz = ((fz * f + rz * s) / len) * sp;
    }
    me.x += vx * dt;
    me.z += vz * dt;
    speedH = Math.hypot(vx, vz);

    if (keys.Space && me.onGround && !stunned && locked()) { if (me.slide) endSlide(nowMs); me.vy = PLAYER.jump; me.onGround = false; }
    me.vy -= PLAYER.gravity * dt;
    me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }

    [me.x, me.z] = resolveCollision(me.x, me.z);

    sendTimer += dt;
    if (sendTimer >= 0.05) {
      sendTimer = 0;
      send({ t: 'state', x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, b: me.blocking, c: me.slide ? 2 : me.crouching ? 1 : 0 });
    }
  } else {
    me.sprinting = false;
    me.blocking = false;
    me.slide = null;
    me.crouching = false;
  }

  // 걷기 흔들림 / 발소리
  me.mv = lerp(me.mv, me.onGround ? clamp(speedH / c.speed, 0, 1.6) : 0, Math.min(1, dt * 10));
  me.bobPhase += speedH * dt * 1.9;
  const stepIdx = Math.floor(me.bobPhase / Math.PI);
  if (stepIdx !== me.stepIdx) { me.stepIdx = stepIdx; if (me.mv > 0.4 && me.onGround) stepSnd(0.07); }

  // 카메라
  me.kick = lerp(me.kick, 0, Math.min(1, dt * 9));
  me.shake = lerp(me.shake, 0, Math.min(1, dt * 7));
  me.roll = lerp(me.roll, 0, Math.min(1, dt * 6));
  me.fovK = lerp(me.fovK, 0, Math.min(1, dt * 6));
  me.eyeH = lerp(me.eyeH, me.slide ? 0.75 : me.crouching ? 1.15 : PLAYER.eye, Math.min(1, dt * 14)); // 눈높이: 서기 / 웅크리기 / 슬라이딩
  me.slideTilt = lerp(me.slideTilt, me.slide ? 0.07 : 0, Math.min(1, dt * 10));
  const dead = joined && !me.alive;
  if (!me.debugCam) {
    const bob = S.bob ? Math.abs(Math.cos(me.bobPhase)) * 0.035 * me.mv : 0;
    const sh = me.shake * 0.02;
    camera.position.set(me.x + rand(-sh, sh), me.y + (dead ? 0.35 : me.eyeH + bob), me.z + rand(-sh, sh));
    const wob = stunned ? Math.sin(nowMs * 0.012) * 0.04 : 0;
    camera.rotation.set(
      dead ? -0.2 : me.pitch - me.kick,
      me.yaw + wob,
      dead ? 0.5 : me.roll + me.slideTilt + (S.bob ? Math.sin(me.bobPhase) * 0.004 * me.mv : 0),
    );
  }
  const targetFov = S.fov + (me.sprinting ? 8 : 0) + me.fovK + (nowMs < me.buffUntil ? 3 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 8)); camera.updateProjectionMatrix(); }

  updateViewmodel(dt);

  // 다른 기사들
  const k = 1 - Math.exp(-14 * dt);
  for (const r of remotes.values()) {
    const pos = r.root.position;
    pos.x = lerp(pos.x, r.tx, k);
    pos.z = lerp(pos.z, r.tz, k);
    pos.y = lerp(pos.y, r.ty, k);
    const dx = pos.x - r.px, dz = pos.z - r.pz;
    r.px = pos.x; r.pz = pos.z;
    r.v = lerp(r.v, Math.min(Math.hypot(dx, dz) / Math.max(dt, 0.001), 12), Math.min(1, dt * 10));
    r.yaw = lerpAngle(r.yaw, r.tyaw, k);
    r.pitch = lerp(r.pitch, r.tpitch, k);
    r.root.rotation.y = r.yaw;
    const rs = nowMs < r.stunUntil;
    animateRig(r, dt, {
      stance: r.stance || 0,
      v: r.v, air: pos.y > 0.08, sprint: r.v > CLASSES[r.cls].speed * 1.25,
      blocking: r.blocking && r.alive && !rs, pitch: r.pitch,
      onStep: () => stepSnd(volFor(r.id, 0.08)),
    });
    r.fall = lerp(r.fall, r.alive ? 0 : 1, Math.min(1, dt * 8));
    r.root.rotation.x = r.fall * (Math.PI / 2);
    r.label.visible = r.alive;
    if (r.bubble && nowMs > r.bubble.until) clearBubble(r);
    r.stars.visible = rs && r.alive;
    if (r.stars.visible) r.stars.rotation.y += dt * 5;
  }
  updateFx(dt);
  updateShots(dt);

  if (joined) {
    updateHudFrame(nowMs, dt);
    mmTick = (mmTick + 1) % 2;
    if (S.minimap && mmTick === 0) drawMinimap();
    if (dead) {
      const left = Math.max(0, Math.ceil((deadUntil - nowMs) / 1000));
      $('death').innerHTML = esc(t('died')) + '<small></small>';
      $('death').querySelector('small').textContent = t('killedBy', { n: killerName, s: left });
    }
  }
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  update(dt, performance.now());
  camera.children.forEach((o) => { o.visible = joined; });
  if (!joined) { const a = now / 9000; camera.position.set(Math.cos(a) * ARENA.half * 1.35, 26, Math.sin(a) * ARENA.half * 1.35); camera.lookAt(0, 3, 0); }
  renderer.render(scene, camera);
  renderPreview(dt);
}

applyQuality();
onResize();
applyHudSettings();
requestAnimationFrame(frame);

// 개발용: 주소 끝에 #debug 를 붙였을 때만 열리는 점검 도구
if (location.hash === '#debug') window.__game = { me, remotes, camera, scene, THREE, S, send, startAct, makeRig, animateRig, swingParams };
