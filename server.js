// IRON OATH 게임 서버
// - 명중 판정, 체력, 쿨다운, 스킬, 패링, 기절, 부활, 승패는 모두 서버가 결정합니다(치팅 방지).
// - 이동은 클라이언트가 보내되, 서버가 속도/경계를 검사합니다.
// - 로그인(Supabase)은 선택: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 있으면 전적이 DB에 저장됩니다.

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  CLASSES, SKILLS, ARENA, PLAYER, TEAMS, MATCH, CHAT, EMOTES, EMOTE_GAP_MS,
  resolveCollision, lineBlocked,
} from './classes.js';
import { dbEnabled, verifyUser, recordMatch } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const MOVE_CHECK = process.env.NO_MOVE_CHECK !== '1';
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === '1';
const TICK_MS = 50;
const MOVE_SLACK = 2.6;
const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));

/* ───────────── 정적 파일 서버 ───────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const gzCache = new Map();

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    const compressible = ext === '.js' || ext === '.html' || ext === '.css' || ext === '.json';
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = `${file}:${st.mtimeMs}`;
      let buf = gzCache.get(key);
      if (!buf) {
        buf = zlib.gzipSync(fs.readFileSync(file));
        gzCache.set(key, buf);
      }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, Vary: 'Accept-Encoding' });
      return res.end(buf);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const httpServer = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (url === '/') url = '/index.html';
  if (url === '/classes.js') return sendFile(req, res, path.join(__dirname, 'classes.js'));
  // 클라이언트가 로그인 설정(공개 키만)을 받아가는 곳. service role 키는 절대 노출하지 않습니다.
  if (url === '/config.json') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
      requireLogin: REQUIRE_LOGIN,
    }));
  }

  let base = path.join(__dirname, 'public');
  let rel = url;
  if (url.startsWith('/three/build/')) {
    base = path.join(__dirname, 'node_modules', 'three', 'build');
    rel = url.slice('/three/build'.length);
  }
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  sendFile(req, res, file);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });

/* ───────────── 게임 상태 ───────────── */
const players = new Map();
let nextId = 1;
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const match = {
  mode: process.env.MODE === 'tdm' ? 'tdm' : 'ffa', // ffa 개인전 / tdm 팀전
  teamScore: { 1: 0, 2: 0 },
  over: false,
  startedAt: now(),
};
const killLimit = () => (match.mode === 'tdm' ? MATCH.teamKills : MATCH.ffaKills);
const isFoe = (a, b) => match.mode === 'ffa' || a.team !== b.team;
const hostId = () => Math.min(...players.keys());

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
function roster() {
  return [...players.values()].map((p) => ({
    id: p.id, name: p.name, cls: p.cls, team: p.team, kills: p.kills, deaths: p.deaths, user: !!p.userId,
  }));
}
function matchState() {
  return {
    t: 'match', mode: match.mode, limit: killLimit(), teamScore: match.teamScore,
    over: match.over, hostId: players.size ? hostId() : null,
  };
}
function assignTeam() {
  if (match.mode === 'ffa') return 0;
  let a = 0, b = 0;
  for (const p of players.values()) { if (p.team === 1) a++; else if (p.team === 2) b++; }
  return a <= b ? 1 : 2;
}
function spawnFor(p) {
  const pool = match.mode === 'tdm' ? ARENA.spawns.filter((s) => s.team === p.team) : ARENA.spawns;
  const s = pool[Math.floor(Math.random() * pool.length)];
  const x = s.x + (Math.random() - 0.5) * 2;
  const z = s.z + (Math.random() - 0.5) * 3;
  return { x, y: 0, z, yaw: Math.atan2(x, z) }; // 중앙을 바라보게
}
const isStunned = (p) => p.stunUntil > now();
const dmgMult = (p) => (p.buffUntil > now() ? p.buffDmg : 1);

function push(q, nx, nz, dist) {
  [q.x, q.z] = resolveCollision(q.x + nx * dist, q.z + nz * dist);
  send(q.ws, { t: 'correct', x: q.x, y: q.y, z: q.z });
}
function stun(q, ms) {
  q.stunUntil = Math.max(q.stunUntil, now() + ms);
  q.blocking = false;
  broadcast({ t: 'stun', id: q.id, ms });
}
function heal(q, amt) {
  const max = CLASSES[q.cls].hp;
  const before = q.hp;
  q.hp = Math.min(max, q.hp + amt);
  if (q.hp > before) broadcast({ t: 'heal', id: q.id, amt: Math.round(q.hp - before), hp: q.hp });
}
// 스킬 대상: 본인 + (팀전이고 radius가 있으면) 반경 내 아군
function allyTargets(p, radius) {
  const list = [p];
  if (match.mode === 'tdm' && radius) {
    for (const q of players.values()) {
      if (q !== p && q.alive && q.team === p.team && Math.hypot(q.x - p.x, q.z - p.z) <= radius) list.push(q);
    }
  }
  return list;
}

/* ───────────── 매치 진행 ───────────── */
function resetMatch() {
  match.teamScore = { 1: 0, 2: 0 };
  match.over = false;
  match.startedAt = now();
  for (const p of players.values()) {
    p.kills = 0;
    p.deaths = 0;
    respawn(p.id, true);
  }
  broadcast({ t: 'roster', list: roster() });
  broadcast(matchState());
}

function endMatch(winnerPlayer, winnerTeam) {
  if (match.over) return;
  match.over = true;
  const board = roster().sort((a, b) => b.kills - a.kills);
  broadcast({
    t: 'matchend', mode: match.mode, winnerId: winnerPlayer?.id ?? null, winnerTeam: winnerTeam ?? null,
    teamScore: match.teamScore, board, nextMs: MATCH.intermissionMs,
  });
  broadcast(matchState());
  // 로그인한 플레이어의 전적을 DB에 저장
  recordMatch({
    mode: match.mode,
    winner_team: winnerTeam ?? null,
    rows: [...players.values()].map((p) => ({
      user_id: p.userId || null, name: p.name, class_id: p.cls, team: p.team,
      kills: p.kills, deaths: p.deaths,
      won: match.mode === 'tdm' ? p.team === winnerTeam : p.id === winnerPlayer?.id,
    })),
  });
  setTimeout(resetMatch, MATCH.intermissionMs);
}

function kill(p, q) {
  q.alive = false;
  q.blocking = false;
  q.stunUntil = 0;
  q.buffUntil = 0;
  q.deaths++;
  p.kills++;
  if (match.mode === 'tdm') match.teamScore[p.team]++;
  broadcast({ t: 'kill', killer: p.id, victim: q.id });
  broadcast({ t: 'roster', list: roster() });
  broadcast(matchState());
  setTimeout(() => respawn(q.id), PLAYER.respawnMs);
  if (match.mode === 'tdm' ? match.teamScore[p.team] >= killLimit() : p.kills >= killLimit()) {
    endMatch(p, match.mode === 'tdm' ? p.team : null);
  }
}

/* ───────────── 공격 판정 ─────────────
   o: { reach, cos, dmg, skill, ignoreBlock, knock, stun, lifesteal, selfHeal, counter, ranged } */
function strike(p, o) {
  if (!p.alive || match.over) return;
  const c = CLASSES[p.cls];
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const t = now();

  for (const q of players.values()) {
    if (q === p || !q.alive || !isFoe(p, q)) continue;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > o.reach + PLAYER.radius) continue;
    if (Math.abs(q.y - p.y) > 1.8) continue;
    if (o.cos > -1 && dist > 0.6 && (dx * fx + dz * fz) / dist < o.cos) continue;
    if (lineBlocked(p.x, p.z, q.x, q.z)) continue; // 건물·기둥 뒤는 맞지 않음

    const qc = CLASSES[q.cls];
    const tfx = -Math.sin(q.yaw);
    const tfz = -Math.cos(q.yaw);
    const facing = dist > 0.01 ? (tfx * -dx + tfz * -dz) / dist : 1;
    const guarding = !o.ignoreBlock && q.blocking && facing > 0.3;

    // 패링: 방어를 막 올린 순간(parryMs 이내) 근접 공격을 받으면 피해 0, 공격자 기절, 반격 기회
    if (guarding && !o.ranged && t - q.blockSince <= PLAYER.parryMs) {
      q.counterUntil = t + PLAYER.counterWindowMs;
      broadcast({ t: 'parry', id: q.id, by: p.id });
      stun(p, PLAYER.parryStunMs);
      continue;
    }

    let mult = 1;
    let tag = null;
    if (o.counter) { mult *= PLAYER.counterMult; tag = 'counter'; }
    if (c.backstab && dist > 0.01 && (tfx * dx + tfz * dz) / dist > 0.5) { mult *= c.backstab; tag = 'back'; }
    const dmg = Math.max(1, Math.round(o.dmg * mult * (guarding ? 1 - qc.block : 1)));

    q.hp = Math.max(0, q.hp - dmg);
    broadcast({ t: 'hit', id: q.id, by: p.id, dmg, hp: q.hp, blocked: guarding, skill: o.skill || null, tag });
    if (o.lifesteal) heal(p, dmg * o.lifesteal);
    if (o.selfHeal) heal(p, o.selfHeal);

    if (q.hp > 0) {
      if (o.knock) {
        const nx = dist > 0.01 ? dx / dist : fx;
        const nz = dist > 0.01 ? dz / dist : fz;
        push(q, nx, nz, o.knock * (guarding ? 0.4 : 1));
      }
      if (o.stun && !guarding) stun(q, o.stun);
    } else {
      kill(p, q);
      if (match.over) return;
    }
  }
}

function respawn(id, force = false) {
  const q = players.get(id);
  if (!q || (!force && q.alive)) return;
  let changed = false;
  if (q.nextCls && q.nextCls !== q.cls) {
    q.cls = q.nextCls;
    changed = true;
  }
  q.nextCls = null;
  const s = spawnFor(q);
  Object.assign(q, {
    x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, hp: CLASSES[q.cls].hp,
    alive: true, blocking: false, blockSince: 0, stunUntil: 0, buffUntil: 0, buffDmg: 1, buffSpeed: 1,
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(),
  });
  q.lastState = now();
  if (changed) broadcast({ t: 'roster', list: roster() });
  broadcast({ t: 'respawn', id: q.id, cls: q.cls, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: q.hp });
}

function useSkill(p, slot) {
  const c = CLASSES[p.cls];
  const id = slot === 'e' ? 'kick' : c.skill;
  const def = SKILLS[id];
  if (!def) return;
  const t = now();
  if (t < (p.cds[id] || 0) - 80) return;
  // 발차기는 쿨타임이 없다. 연타 도배만 막는 최소 간격
  p.cds[id] = t + (id === 'kick' ? PLAYER.kickGapMs : def.cooldown * 1000);
  p.blocking = false;
  broadcast({ t: 'skill', id: p.id, skill: id });

  // 회복 / 버프 (공격이 없는 스킬)
  if (def.heal || def.dur) {
    for (const q of allyTargets(p, def.radius)) {
      if (def.heal) heal(q, def.heal);
      if (def.dur) {
        q.buffUntil = t + def.dur;
        q.buffDmg = def.dmgMult || 1;
        q.buffSpeed = def.speedMult || 1;
        broadcast({ t: 'buff', id: q.id, ms: def.dur, dmg: q.buffDmg, speed: q.buffSpeed });
      }
    }
    return;
  }

  if (def.dash) p.dashUntil = t + def.dash.dur * 1000 + 300;
  if (def.blink) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let bx = p.x, bz = p.z;
    for (let d = 0.5; d <= def.blink; d += 0.5) {
      const tx = p.x + fx * d, tz = p.z + fz * d;
      const [rx, rz] = resolveCollision(tx, tz);
      if (Math.hypot(rx - tx, rz - tz) > 0.05) break; // 벽에 막히면 거기까지
      bx = rx; bz = rz;
    }
    p.x = bx; p.z = bz;
    send(p.ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
  }

  const reach = def.reach ?? c.reach + (def.reachAdd || 0);
  const cos = def.cone >= 360 ? -2 : Math.cos((def.cone * Math.PI) / 180);
  setTimeout(() => {
    if (!p.alive) return;
    strike(p, {
      reach, cos, skill: id, ranged: reach > 5,
      dmg: def.dmg ?? c.damage * def.dmgMult * dmgMult(p),
      ignoreBlock: !!def.ignoreBlock, knock: def.knock || 0, stun: def.stun || 0,
      lifesteal: def.lifesteal || 0, selfHeal: def.selfHeal || 0,
    });
  }, def.windup * 1000);
}

/* ───────────── 접속 처리 ───────────── */
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', async (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });

    if (m.t === 'join') {
      if (ws.pid || ws.joining) return;
      ws.joining = true;
      const user = await verifyUser(m.token); // 게스트/미설정이면 null
      ws.joining = false;
      if (ws.readyState !== 1 || ws.pid) return;
      if (REQUIRE_LOGIN && !user) return send(ws, { t: 'authrequired' });
      if (players.size >= MAX_PLAYERS) return send(ws, { t: 'full' });
      // 같은 계정으로 중복 접속하면 이전 접속을 내보냄
      if (user) for (const o of players.values()) if (o.userId === user.id) o.ws.close();

      const id = nextId++;
      const cls = CLASSES[m.cls] ? m.cls : 'knight';
      const rawName = m.name || user?.name || '';
      const name = String(rawName).replace(/[<>&"'`]/g, '').trim().slice(0, PLAYER.maxNameLen) || `Knight${id}`;
      const team = assignTeam();
      const p = {
        id, ws, name, cls, team, userId: user?.id || null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
        hp: CLASSES[cls].hp, alive: true, blocking: false, blockSince: 0,
        kills: 0, deaths: 0, lastAttack: 0, lastState: now(), lastChat: 0, lastEmote: 0,
        stunUntil: 0, buffUntil: 0, buffDmg: 1, buffSpeed: 1, counterUntil: 0, dashUntil: 0,
        cds: {}, spawnAt: now(), nextCls: null,
      };
      Object.assign(p, spawnFor(p));
      players.set(id, p);
      ws.pid = id;
      send(ws, {
        t: 'welcome', id, cls, team, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp,
        roster: roster(), authed: !!user, db: dbEnabled,
      });
      broadcast({ t: 'roster', list: roster() });
      broadcast(matchState());
      console.log(`[+] ${name} (${cls}${user ? ', 로그인' : ''}) 입장 — 현재 ${players.size}명`);
      return;
    }

    const p = players.get(ws.pid);
    if (!p) return;

    if (m.t === 'state') {
      if (!p.alive) return;
      const { x, y, z, yaw, pitch } = m;
      if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
      const t = now();
      const dt = Math.min((t - p.lastState) / 1000, 0.5);
      p.lastState = t;
      let maxDist = CLASSES[p.cls].speed * MOVE_SLACK * dt + 0.6;
      if (p.dashUntil > t) maxDist += 22 * dt;
      if (MOVE_CHECK && Math.hypot(x - p.x, z - p.z) > maxDist) {
        return send(ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
      }
      const [cx, cz] = resolveCollision(x, z);
      p.x = cx;
      p.z = cz;
      p.y = clamp(y, 0, 20);
      p.yaw = yaw;
      p.pitch = clamp(pitch, -1.6, 1.6);
      const wantBlock = !!m.b && !isStunned(p);
      if (wantBlock && !p.blocking) p.blockSince = t; // 방어를 올린 순간 = 패링 윈도우 시작
      p.blocking = wantBlock;
    } else if (m.t === 'attack') {
      if (!p.alive || isStunned(p) || match.over) return;
      const c = CLASSES[p.cls];
      const t = now();
      if (t - p.lastAttack < c.cooldown * 1000 - 30) return;
      p.lastAttack = t;
      p.blocking = false;
      broadcast({ t: 'swing', id: p.id });
      const cos = Math.cos((((c.cone ?? 50)) * Math.PI) / 180);
      setTimeout(() => {
        // 패링 성공 직후의 첫 공격은 반격: 피해 증가 + 방어 무시
        const counter = p.counterUntil > now();
        if (counter) p.counterUntil = 0;
        strike(p, {
          reach: c.reach, cos, ranged: !!c.ranged, counter, ignoreBlock: counter,
          dmg: Math.round(c.damage * dmgMult(p)),
        });
      }, c.windup * 1000);
    } else if (m.t === 'skill') {
      if (!p.alive || isStunned(p) || match.over) return;
      if (m.slot !== 'q' && m.slot !== 'e') return;
      useSkill(p, m.slot);
    } else if (m.t === 'setclass') {
      if (!CLASSES[m.cls] || m.cls === p.cls) return;
      const inGrace = p.alive && now() - p.spawnAt < PLAYER.classSwapGraceMs;
      p.nextCls = m.cls;
      if (inGrace) {
        respawn(p.id, true);
        send(ws, { t: 'classqueued', cls: m.cls, immediate: true });
      } else {
        send(ws, { t: 'classqueued', cls: m.cls, immediate: false });
      }
    } else if (m.t === 'chat') {
      const t = now();
      if (t - p.lastChat < CHAT.gapMs) return;
      const text = String(m.text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, CHAT.maxLen);
      if (!text) return;
      p.lastChat = t;
      const teamOnly = !!m.team && match.mode === 'tdm';
      const msg = { t: 'chat', id: p.id, name: p.name, team: p.team, text, teamOnly };
      for (const q of players.values()) if (!teamOnly || q.team === p.team) send(q.ws, msg);
    } else if (m.t === 'emote') {
      const t = now();
      if (!EMOTE_IDS.has(m.e) || t - p.lastEmote < EMOTE_GAP_MS) return;
      p.lastEmote = t;
      broadcast({ t: 'emote', id: p.id, e: m.e });
    } else if (m.t === 'setmode') {
      // 방장(가장 먼저 들어온 사람)만 모드 변경 가능
      if (p.id !== hostId() || (m.mode !== 'ffa' && m.mode !== 'tdm') || m.mode === match.mode) return;
      match.mode = m.mode;
      let i = 0;
      for (const q of players.values()) q.team = match.mode === 'tdm' ? (i++ % 2) + 1 : 0;
      resetMatch();
    }
  });

  ws.on('close', () => {
    const p = players.get(ws.pid);
    if (!p) return;
    players.delete(p.id);
    broadcast({ t: 'roster', list: roster() });
    if (players.size) broadcast(matchState());
    console.log(`[-] ${p.name} 퇴장 — 현재 ${players.size}명`);
  });
});

setInterval(() => {
  if (!players.size) return;
  broadcast({
    t: 'snap',
    p: [...players.values()].map((p) => ({
      id: p.id,
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      b: p.blocking, hp: p.hp, alive: p.alive,
    })),
  });
}, TICK_MS);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n⚔  IRON OATH 서버가 열렸습니다!');
  console.log(`   이 컴퓨터:        http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`   같은 와이파이/LAN: http://${i.address}:${PORT}`);
    }
  }
  console.log(`   최대 인원: ${MAX_PLAYERS}명 / 모드: ${match.mode} / 로그인 DB: ${dbEnabled ? '켜짐' : '꺼짐(게스트만)'}\n`);
});
