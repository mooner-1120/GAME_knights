// 서버와 클라이언트가 함께 쓰는 설정 파일입니다.
// 기사(클래스)·스킬·맵·이모트를 추가하거나 능력치를 바꾸려면 여기만 고치면 됩니다.

/* ───────────── 맵 (4종) ─────────────
   boxes: x,z 중심 / w=x크기, d=z크기, h=높이 / style: 'house'(지붕 있는 집) | 'stone'(석벽·탑·돌덩이)
   pillars: 원형 장애물. kind: fountain | tree | well | barrel | column | dais
   spawns: 팀전은 team 1(왼쪽)·2(오른쪽)이 각자 진영에서, 개인전은 전부 사용
   모든 맵은 좌우 대칭이거나 같은 시드로 만들어져서 서버와 브라우저가 똑같은 맵을 얻습니다. */
const SIGNS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const sp = (xe, zs) => [...zs.map((z) => ({ x: -xe, z, team: 1 })), ...zs.map((z) => ({ x: xe, z, team: 2 }))];
function rng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeTown() {
  const Q = [
    { x: 14, z: 12, w: 10, d: 8, h: 6 }, { x: 30, z: 10, w: 8, d: 12, h: 7 }, { x: 16, z: 28, w: 12, d: 8, h: 5 },
    { x: 34, z: 32, w: 8, d: 8, h: 9 }, { x: 6, z: 40, w: 6, d: 4, h: 4 },
  ];
  const boxes = [], pillars = [{ x: 0, z: 0, r: 2.6, kind: 'fountain' }];
  for (const [sx, sz] of SIGNS) {
    for (const b of Q) boxes.push({ x: b.x * sx, z: b.z * sz, w: b.w, d: b.d, h: b.h, style: b.h >= 9 ? 'stone' : 'house' });
    pillars.push({ x: 22 * sx, z: 22 * sz, r: 1.2, kind: 'tree' }, { x: 40 * sx, z: 20 * sz, r: 1.4, kind: 'well' });
  }
  for (const [x, z] of [[22, 0], [-22, 0], [0, 22], [0, -22]]) pillars.push({ x, z, r: 1.0, kind: 'barrel' });
  return { id: 'town', name: '중세 마을', half: 48, theme: 'town', boxes, pillars, spawns: [...sp(42, [-8, 0, 8]), { x: -44, z: 4, team: 1 }, { x: 44, z: 4, team: 2 }] };
}

function makeFortress() { // 성채: 중앙 성 + 문 달린 성벽 + 모서리 탑 + 바깥 초소
  const boxes = [{ x: 0, z: 0, w: 12, d: 12, h: 12, style: 'stone' }], pillars = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    boxes.push({ x: sx * 11, z: sz * 18, w: 14, d: 2, h: 5, style: 'stone' }, { x: sx * 18, z: sz * 11, w: 2, d: 14, h: 5, style: 'stone' });
  }
  for (const [sx, sz] of SIGNS) {
    boxes.push({ x: sx * 18, z: sz * 18, w: 6, d: 6, h: 10, style: 'stone' }, { x: sx * 34, z: sz * 34, w: 6, d: 6, h: 6, style: 'stone' }, { x: sx * 34, z: sz * 16, w: 4, d: 4, h: 3, style: 'stone' });
  }
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + Math.PI / 8; pillars.push({ x: +(Math.cos(a) * 30).toFixed(2), z: +(Math.sin(a) * 30).toFixed(2), r: 1.2, kind: 'column' }); }
  for (const [x, z] of [[0, 12], [0, -12], [12, 0], [-12, 0]]) pillars.push({ x, z, r: 1.0, kind: 'barrel' });
  return { id: 'fortress', name: '성채', half: 48, theme: 'fortress', boxes, pillars, spawns: sp(43, [-8, 0, 8]) };
}

function makeForest() { // 숲 마을: 나무가 빽빽한 은폐물 + 오두막 4채 + 중앙 우물
  const rand = rng(1337), boxes = [], pillars = [{ x: 0, z: 0, r: 2.0, kind: 'well' }];
  for (const [x, z] of [[-22, -14], [22, 14], [-14, 22], [14, -22]]) boxes.push({ x, z, w: 8, d: 7, h: 5, style: 'house' });
  const free = (x, z, r) => !(Math.abs(x) > 36 && Math.abs(z) < 14) && Math.hypot(x, z) > 5
    && boxes.every((b) => Math.abs(x - b.x) > b.w / 2 + r + 1 && Math.abs(z - b.z) > b.d / 2 + r + 1)
    && pillars.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + r + 2.2);
  for (let tries = 0; pillars.length < 56 && tries < 4000; tries++) {
    const x = +((rand() * 2 - 1) * 44).toFixed(2), z = +((rand() * 2 - 1) * 44).toFixed(2);
    if (free(x, z, 1.1)) pillars.push({ x, z, r: 1.1, kind: 'tree' });
  }
  return { id: 'forest', name: '숲 마을', half: 48, theme: 'forest', boxes, pillars, spawns: sp(43, [-8, 0, 8]) };
}

function makeColosseum() { // 투기장: 작고 가까운 전투. 가운데 단상 + 기둥 고리 + 돌덩이 엄폐물
  const pillars = [{ x: 0, z: 0, r: 3.2, kind: 'dais' }], boxes = [];
  for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6 + Math.PI / 12; pillars.push({ x: +(Math.cos(a) * 22).toFixed(2), z: +(Math.sin(a) * 22).toFixed(2), r: 1.3, kind: 'column' }); }
  for (const [sx, sz] of SIGNS) boxes.push({ x: sx * 11, z: sz * 11, w: 5, d: 5, h: 3, style: 'stone' });
  return { id: 'colosseum', name: '투기장', half: 36, theme: 'colosseum', boxes, pillars, spawns: sp(32, [-8, -4, 0, 4, 8]) };
}

export const MAPS = { town: makeTown(), fortress: makeFortress(), forest: makeForest(), colosseum: makeColosseum() };
// 클라이언트가 쓰는 "현재 맵". useMap(id)으로 같은 객체의 내용을 교체합니다. (서버는 방마다 맵을 따로 들고 있어서 이 객체를 쓰지 않습니다)
export const ARENA = { ...MAPS.town };
export function useMap(id) { Object.assign(ARENA, MAPS[id] || MAPS.town); }

export const TEAMS = {
  1: { id: 1, name: '레드', color: 0xc0392b },
  2: { id: 2, name: '블루', color: 0x2e6fd0 },
};

// 승리 조건: 개인전은 먼저 N킬, 팀전은 팀 합산 N킬. 끝나면 intermissionMs 후 새 판
// 한 판 3분(킬 목표를 먼저 채우면 일찍 종료). 시간 종료 시 동점은 무승부. 공개 방은 판이 끝나면 15초 투표(모드·맵) 후 3초 뒤 시작, 만든 방(방장 방)은 같은 설정으로 customRestartMs 뒤 재시작.
// votableMaps: 투표에 올릴 맵. 투표에 올릴 맵 목록입니다. 줄이거나 늘릴 수 있어요.
export const MATCH = { ffaKills: 20, teamKills: 30, durationMs: 180000, voteMs: 15000, resultMs: 3000, customRestartMs: 10000, votableMaps: ['town', 'fortress', 'forest', 'colosseum'] };
export const ROOM = { maxRooms: 30, maxCustomPlayers: 16, nameLen: 24, passLen: 16 };

export const PLAYER = {
  radius: 0.5,
  eye: 1.62,
  gravity: 22,
  jump: 7.5,
  respawnMs: 3000,
  maxNameLen: 16,
  sprintMult: 1.55,
  classSwapGraceMs: 8000,
  // 패링/반격: 방어를 누른 직후 parryMs 안에 맞으면 피해 0 + 공격자 기절 → counterWindowMs 동안 반격 강화
  parryMs: 300,
  parryStunMs: 900,
  counterWindowMs: 2200,
  counterMult: 1.6,
  kickGapMs: 400, // 발차기는 쿨타임 없음(연타 도배 방지용 최소 간격만)
};

export const CHAT = { maxLen: 120, gapMs: 800 };

export const EMOTES = [
  { id: 'wave', name: '손 흔들기', icon: '👋' },
  { id: 'bow', name: '인사', icon: '🙇' },
  { id: 'cheer', name: '환호', icon: '🎉' },
  { id: 'laugh', name: '웃음', icon: '😆' },
  { id: 'taunt', name: '도발', icon: '😏' },
  { id: 'salute', name: '경례', icon: '🫡' },
  { id: 'point', name: '가리키기', icon: '👉' },
  { id: 'cry', name: '울기', icon: '😭' },
];
export const EMOTE_GAP_MS = 1500;

/* ───────────── 스킬 ─────────────
   cooldown 재사용(초) / windup 발동~타격(초) / reach 사거리(m) / reachAdd 기본 사거리에 더함 / cone 타격 각도(360=전방위)
   dmgMult 기사 공격력 배율 (dmg가 있으면 고정) / knock 밀치기(m) / stun(ms) / ignoreBlock 방어·패링 무시
   dur(ms)+dmgMult+speedMult = 버프 (radius가 있으면 팀전에서 반경 내 아군에게도)
   heal = 회복량 (radius 있으면 아군도) / selfHeal = 적중 시 본인 회복 / lifesteal = 준 피해 비율만큼 회복
   dash {speed,dur} = 돌진 / blink = 전방 순간이동(m) */
export const SKILLS = {
  // 기존
  rally: { id: 'rally', name: '전투 함성', icon: '📣', key: 'Q', desc: '5초간 공격력 +30%, 이동속도 +20% (반경 8m 아군 포함)', cooldown: 14, dur: 5000, dmgMult: 1.3, speedMult: 1.2, radius: 8 },
  spin: { id: 'spin', name: '회전 베기', icon: '🌀', key: 'Q', desc: '한 바퀴 돌며 주변 모든 적을 베고 밀어냄', cooldown: 9, windup: 0.28, reachAdd: 0.5, cone: 360, dmgMult: 0.9, knock: 2.5 },
  lunge: { id: 'lunge', name: '쇄도', icon: '⚡', key: 'Q', desc: '전방으로 돌진하며 베기', cooldown: 7, windup: 0.3, reachAdd: 0.4, cone: 70, dmgMult: 1.2, dash: { speed: 17, dur: 0.28 } },
  bash: { id: 'bash', name: '방패 밀치기', icon: '🛡️', key: 'Q', desc: '정면의 적을 밀치고 1.2초 기절 (방어 무시)', cooldown: 10, windup: 0.22, reach: 2.7, cone: 70, dmgMult: 0.5, knock: 3.5, stun: 1200, ignoreBlock: true },
  // 신규
  fireball: { id: 'fireball', proj: 'magic', name: '화염구', icon: '🔥', key: 'Q', desc: '먼 거리의 적에게 강력한 화염 폭발', cooldown: 8, windup: 0.45, reach: 32, cone: 5, dmgMult: 2.2, knock: 1.5, ignoreBlock: true },
  shadowstep: { id: 'shadowstep', name: '그림자 걸음', icon: '🌑', key: 'Q', desc: '전방 7m 순간이동 후 급소 찌르기', cooldown: 8, windup: 0.15, blink: 7, reach: 2.6, cone: 80, dmgMult: 1.5 },
  volley: { id: 'volley', proj: 'arrow', name: '속사', icon: '🏹', key: 'Q', desc: '부채꼴로 화살을 쏟아부음', cooldown: 9, windup: 0.3, reach: 24, cone: 24, dmgMult: 1.7 },
  heal: { id: 'heal', name: '치유의 빛', icon: '✨', key: 'Q', desc: '체력 35 회복 (반경 7m 아군 포함)', cooldown: 12, heal: 35, radius: 7 },
  bloodrage: { id: 'bloodrage', name: '피의 분노', icon: '💢', key: 'Q', desc: '6초간 공격력 +70%, 이동 +10%', cooldown: 16, dur: 6000, dmgMult: 1.7, speedMult: 1.1 },
  smite: { id: 'smite', name: '성스러운 일격', icon: '☀️', key: 'Q', desc: '넓게 내려치고 체력 15 회복', cooldown: 10, windup: 0.3, reachAdd: 0.6, cone: 100, dmgMult: 1.2, knock: 2, selfHeal: 15 },
  ambush: { id: 'ambush', name: '암습', icon: '🗡️', key: 'Q', desc: '빠르게 파고들어 치명타', cooldown: 10, windup: 0.18, reachAdd: 0.5, cone: 50, dmgMult: 2.0, dash: { speed: 22, dur: 0.2 } },
  snare: { id: 'snare', proj: 'arrow', name: '속박 화살', icon: '🪢', key: 'Q', desc: '맞은 적을 1초 기절', cooldown: 11, windup: 0.3, reach: 30, cone: 6, dmgMult: 0.9, stun: 1000 },
  drain: { id: 'drain', proj: 'magic', name: '생명 흡수', icon: '💀', key: 'Q', desc: '준 피해의 60%를 회복', cooldown: 9, windup: 0.35, reach: 15, cone: 14, dmgMult: 1.5, lifesteal: 0.6, ignoreBlock: true },
  palm: { id: 'palm', name: '발경', icon: '👊', key: 'Q', desc: '강한 장타로 밀쳐내고 0.6초 기절', cooldown: 8, windup: 0.15, reach: 2.8, cone: 90, dmgMult: 1.6, knock: 3, stun: 600 },
  impale: { id: 'impale', name: '관통 찌르기', icon: '🔱', key: 'Q', desc: '긴 사거리로 꿰뚫고 밀어냄', cooldown: 8, windup: 0.3, reach: 5.2, cone: 20, dmgMult: 1.6, knock: 2 },
  anthem: { id: 'anthem', name: '응원가', icon: '🎵', key: 'Q', desc: '6초간 공격력 +20%, 이동 +15% (반경 10m 아군 포함)', cooldown: 15, dur: 6000, dmgMult: 1.2, speedMult: 1.15, radius: 10 },
  hex: { id: 'hex', proj: 'magic', name: '저주', icon: '🧿', key: 'Q', desc: '원거리 저주로 0.8초 기절', cooldown: 11, windup: 0.35, reach: 22, cone: 9, dmgMult: 1.0, stun: 800, ignoreBlock: true },
  overcharge: { id: 'overcharge', proj: 'arrow', name: '과충전 사격', icon: '🎯', key: 'Q', desc: '방어를 뚫는 초강력 한 발', cooldown: 12, windup: 0.55, reach: 42, cone: 3.5, dmgMult: 2.2, ignoreBlock: true },
  bloom: { id: 'bloom', name: '재생의 숨결', icon: '🌿', key: 'Q', desc: '체력 25 회복 + 4초간 이동 +20%', cooldown: 13, heal: 25, dur: 4000, dmgMult: 1, speedMult: 1.2 },
  iaido: { id: 'iaido', name: '발도술', icon: '🌸', key: 'Q', desc: '순식간에 뽑아 베는 일섬 (방어 무시)', cooldown: 11, windup: 0.2, reachAdd: 0.6, cone: 40, dmgMult: 2.0, dash: { speed: 20, dur: 0.2 }, ignoreBlock: true },
  // 공용 (E): 쿨타임 없음, 연타 방지 최소 간격만 PLAYER.kickGapMs
  kick: { id: 'kick', name: '발차기', icon: '🦶', key: 'E', desc: '모든 직업 공용. 쿨타임 없는 기본 공격. 방어를 무시하고 밀쳐냄', cooldown: 0, windup: 0.15, reach: 2.0, cone: 50, dmg: 6, knock: 2.8, stun: 500, ignoreBlock: true },
};

/* hp 체력 / speed 이동속도 / damage 공격력 / cooldown 공격 간격(초) / reach 사거리 / windup 선딜(초)
   block 방어 피해감소(0~1) / cone 일반공격 각도(기본 50) / ranged 원거리(패링 불가) / backstab 등 뒤 공격 배율
   role 역할 / skill Q 스킬 */
export const CLASSES = {
  knight:      { id: 'knight', name: '기사', role: '근접', desc: '균형 잡힌 롱소드 기사', hp: 100, speed: 5.2, damage: 22, cooldown: 0.7, reach: 2.6, windup: 0.18, block: 0.6, skill: 'rally', color: 0x4a6fa5 },
  greatsword:  { id: 'greatsword', name: '대검 전사', role: '근접', desc: '느리지만 한 방이 묵직하다', hp: 120, speed: 4.2, damage: 40, cooldown: 1.2, reach: 3.2, windup: 0.35, block: 0.4, skill: 'spin', color: 0x8b2f2f },
  duelist:     { id: 'duelist', name: '결투가', role: '근접', desc: '빠른 발과 연속 찌르기', hp: 80, speed: 6.4, damage: 13, cooldown: 0.38, reach: 2.3, windup: 0.1, block: 0.35, skill: 'lunge', color: 0x3f8f5a },
  shield:      { id: 'shield', name: '방패 기사', role: '탱커', desc: '단단한 방어, 느린 움직임', hp: 150, speed: 3.8, damage: 17, cooldown: 0.85, reach: 2.3, windup: 0.2, block: 0.85, skill: 'bash', color: 0xb08d2a },
  mage:        { id: 'mage', name: '마법사', role: '마법', desc: '멀리서 마법탄을 쏘는 유리대포', hp: 70, speed: 4.9, damage: 26, cooldown: 1.1, reach: 22, windup: 0.4, block: 0.1, cone: 8, ranged: true, proj: 'magic', skill: 'fireball', color: 0x7a4fd0 },
  rogue:       { id: 'rogue', name: '도적', role: '암살', desc: '빠른 단검질, 등 뒤를 노리면 강하다', hp: 75, speed: 6.8, damage: 11, cooldown: 0.3, reach: 2.0, windup: 0.08, block: 0.25, backstab: 1.5, skill: 'shadowstep', color: 0x4a4a55 },
  archer:      { id: 'archer', name: '궁수', role: '원거리', desc: '긴 사거리의 정밀 사격', hp: 80, speed: 5.4, damage: 16, cooldown: 0.9, reach: 30, windup: 0.45, block: 0.15, cone: 5, ranged: true, proj: 'arrow', skill: 'volley', color: 0x5f9a3c },
  cleric:      { id: 'cleric', name: '성직자', role: '지원', desc: '아군과 자신을 치유하는 메이스 사제', hp: 95, speed: 4.8, damage: 14, cooldown: 0.8, reach: 2.4, windup: 0.2, block: 0.5, skill: 'heal', color: 0xf0e6b0 },
  berserker:   { id: 'berserker', name: '광전사', role: '근접', desc: '방어는 버리고 도끼로 밀어붙인다', hp: 130, speed: 5.6, damage: 28, cooldown: 0.9, reach: 2.5, windup: 0.2, block: 0.1, skill: 'bloodrage', color: 0x9c3b1b },
  paladin:     { id: 'paladin', name: '성기사', role: '탱커', desc: '묵직한 메이스와 신성한 가호', hp: 125, speed: 4.4, damage: 24, cooldown: 0.9, reach: 2.6, windup: 0.22, block: 0.75, skill: 'smite', color: 0xe8d36a },
  assassin:    { id: 'assassin', name: '암살자', role: '암살', desc: '한 번에 파고들어 치명타', hp: 70, speed: 6.6, damage: 20, cooldown: 0.55, reach: 2.1, windup: 0.12, block: 0.2, backstab: 1.6, skill: 'ambush', color: 0x2a2a3a },
  ranger:      { id: 'ranger', name: '레인저', role: '원거리', desc: '빠르게 쏘고 발을 묶는 사냥꾼', hp: 85, speed: 5.8, damage: 14, cooldown: 0.7, reach: 28, windup: 0.35, block: 0.2, cone: 5, ranged: true, proj: 'arrow', skill: 'snare', color: 0x3d6b4a },
  necromancer: { id: 'necromancer', name: '강령술사', role: '마법', desc: '생명력을 빨아들이는 어둠의 마법사', hp: 85, speed: 4.6, damage: 15, cooldown: 0.9, reach: 16, windup: 0.4, block: 0.15, cone: 10, ranged: true, proj: 'magic', skill: 'drain', color: 0x5a2d6e },
  monk:        { id: 'monk', name: '수도승', role: '근접', desc: '맨손 연타와 빠른 몸놀림', hp: 100, speed: 6.0, damage: 12, cooldown: 0.35, reach: 2.0, windup: 0.1, block: 0.45, skill: 'palm', color: 0xd98c3a },
  spearman:    { id: 'spearman', name: '창병', role: '근접', desc: '긴 창으로 거리를 지배한다', hp: 105, speed: 4.8, damage: 21, cooldown: 0.95, reach: 4.0, windup: 0.3, block: 0.45, cone: 30, skill: 'impale', color: 0x6a7f8f },
  bard:        { id: 'bard', name: '음유시인', role: '지원', desc: '노래로 아군을 북돋는 류트 연주자', hp: 85, speed: 5.3, damage: 12, cooldown: 0.8, reach: 2.4, windup: 0.2, block: 0.3, skill: 'anthem', color: 0xc05a8a },
  warlock:     { id: 'warlock', name: '흑마법사', role: '마법', desc: '저주로 적의 발을 묶는다', hp: 80, speed: 4.7, damage: 18, cooldown: 1.0, reach: 20, windup: 0.4, block: 0.2, cone: 9, ranged: true, proj: 'magic', skill: 'hex', color: 0x7b1f4f },
  crossbow:    { id: 'crossbow', name: '석궁병', role: '원거리', desc: '느리지만 한 발이 아프다', hp: 90, speed: 4.6, damage: 34, cooldown: 1.6, reach: 36, windup: 0.5, block: 0.3, cone: 3.5, ranged: true, proj: 'arrow', skill: 'overcharge', color: 0x8a6b3d },
  druid:       { id: 'druid', name: '드루이드', role: '지원', desc: '자연의 힘으로 버티는 지팡이 술사', hp: 110, speed: 5.0, damage: 16, cooldown: 0.8, reach: 2.5, windup: 0.2, block: 0.4, skill: 'bloom', color: 0x2f7a52 },
  samurai:     { id: 'samurai', name: '사무라이', role: '근접', desc: '일격필살 발도술의 검객', hp: 100, speed: 5.8, damage: 25, cooldown: 0.75, reach: 2.8, windup: 0.15, block: 0.5, skill: 'iaido', color: 0xb23a48 },
};

/* ───────────── 충돌 (서버·클라이언트 공용) ───────────── */
// 원(반지름 r)을 기둥·건물 밖으로 밀어내고 경기장 안으로 제한
export function resolveCollision(x, z, r = PLAYER.radius, map = ARENA) {
  for (let pass = 0; pass < 2; pass++) {
    for (const pl of map.pillars) {
      const ex = x - pl.x, ez = z - pl.z;
      const d = Math.hypot(ex, ez), min = pl.r + r;
      if (d < min) {
        if (d > 1e-4) { x = pl.x + (ex / d) * min; z = pl.z + (ez / d) * min; }
        else x = pl.x + min;
      }
    }
    for (const b of map.boxes) {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
      const cx = Math.max(x0, Math.min(x1, x)), cz = Math.max(z0, Math.min(z1, z));
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-4) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
        else { // 중심이 건물 안: 가장 가까운 면으로 탈출
          const o = [x - x0, x1 - x, z - z0, z1 - z];
          const m = Math.min(...o);
          if (m === o[0]) x = x0 - r; else if (m === o[1]) x = x1 + r; else if (m === o[2]) z = z0 - r; else z = z1 + r;
        }
      }
    }
  }
  const lim = map.half - r;
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}

// 두 점 사이를 건물·기둥이 가로막는지 (공격·원거리 사격 시야 판정)
export function lineBlocked(ax, az, bx, bz, map = ARENA) {
  const dx = bx - ax, dz = bz - az;
  for (const b of map.boxes) {
    const lo = [b.x - b.w / 2, b.z - b.d / 2], hi = [b.x + b.w / 2, b.z + b.d / 2];
    const p = [ax, az], d = [dx, dz];
    let t0 = 0, t1 = 1, hit = true;
    for (let i = 0; i < 2 && hit; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) hit = false; }
      else {
        let a = (lo[i] - p[i]) / d[i], c = (hi[i] - p[i]) / d[i];
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) hit = false;
      }
    }
    if (hit) return true;
  }
  const L2 = dx * dx + dz * dz;
  for (const pl of map.pillars) {
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((pl.x - ax) * dx + (pl.z - az) * dz) / L2)) : 0;
    if (Math.hypot(ax + dx * t - pl.x, az + dz * t - pl.z) < pl.r) return true;
  }
  return false;
}

/* ───────────── 투사체 (화살·마법탄) ─────────────
   사거리(reach)까지는 직선으로 날아가고(flat), 그 너머부터 중력이 작용해 포물선을 그리며 최대 reach * ext 까지 날아갑니다.
   서버가 이 값으로 실제 비행을 계산하고, 브라우저는 같은 값으로 똑같이 그립니다. */
export const PROJ = {
  arrow: { speed: 75, ext: 2.6, grav: 14 },
  magic: { speed: 45, ext: 1.7, grav: 8 },
};
const PILLAR_H = { fountain: 2.6, tree: 6, well: 3, barrel: 1.2, column: 6.7, dais: 1.2 };
// 선분(투사체 한 걸음)이 건물·기둥에 막히는지. 높이를 고려해서 건물 위로 쏜 화살은 지나갑니다.
export function projBlocked(ax, ay, az, bx, by, bz, map = ARENA) {
  const dx = bx - ax, dz = bz - az;
  for (const b of map.boxes) {
    const lo = [b.x - b.w / 2, b.z - b.d / 2], hi = [b.x + b.w / 2, b.z + b.d / 2];
    const p = [ax, az], d = [dx, dz];
    let t0 = 0, t1 = 1, hit = true;
    for (let i = 0; i < 2 && hit; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) hit = false; }
      else {
        let a = (lo[i] - p[i]) / d[i], c = (hi[i] - p[i]) / d[i];
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) hit = false;
      }
    }
    if (hit && ay + (by - ay) * t0 < b.h) return true;
  }
  const L2 = dx * dx + dz * dz;
  for (const pl of map.pillars) {
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((pl.x - ax) * dx + (pl.z - az) * dz) / L2)) : 0;
    if (Math.hypot(ax + dx * t - pl.x, az + dz * t - pl.z) < pl.r && ay + (by - ay) * t < (PILLAR_H[pl.kind] || 3)) return true;
  }
  return false;
}
