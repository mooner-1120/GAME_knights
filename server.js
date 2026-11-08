// IRON OATH 게임 서버
// - 방(Room) 단위로 게임이 따로 돌아갑니다. 공개 방은 판이 끝나면 투표로 다음 모드·맵을 정하고,
//   "방 만들기"로 만든 방은 방장이 직접 모드·맵을 고릅니다.
// - 명중 판정, 체력, 쿨다운, 스킬, 패링, 기절, 부활, 승패는 모두 서버가 결정합니다(치팅 방지).
// - 로그인(Supabase)은 선택: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 있으면 전적이 DB에 저장됩니다.

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  CLASSES, SKILLS, MAPS, PLAYER, MATCH, ROOM, CHAT, EMOTES, EMOTE_GAP_MS,
  PROJ, resolveCollision, lineBlocked, projBlocked,
} from './classes.js';
import { dbEnabled, verifyUser, recordMatch } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16; // 공개 방 정원
const PUBLIC_ROOMS = Math.max(1, Number(process.env.PUBLIC_ROOMS) || 1);
const DEFAULT_MODE = process.env.MODE === 'tdm' ? 'tdm' : 'ffa';
const MOVE_CHECK = process.env.NO_MOVE_CHECK !== '1';
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === '1';
const TICK_MS = 50;
const MOVE_SLACK = 2.6;
const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));
const MODES = ['ffa', 'tdm'];

/* ───────────── 정적 파일 서버 ───────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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
      if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file)); gzCache.set(key, buf); }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, Vary: 'Accept-Encoding' });
      return res.end(buf);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const httpServer = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/classes.js') return sendFile(req, res, path.join(__dirname, 'classes.js'));
  if (url === '/rooms.json') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ list: [...rooms.values()].map((r) => r.info()), maps: Object.values(MAPS).map((x) => ({ id: x.id })) }));
  }
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
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  sendFile(req, res, file);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });

/* ───────────── 공용 도우미 ───────────── */
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanText = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, n);
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const isStunned = (p) => p.stunUntil > now();
const dmgMult = (p) => (p.buffUntil > now() ? p.buffDmg : 1);

/* ───────────── 방 ───────────── */
const rooms = new Map();
let nextRoomId = 1;
let nextId = 1;
let nextProj = 1;

class Room {
  constructor({ name, custom, max, mode, mapId, password }) {
    this.id = `r${nextRoomId++}`;
    this.name = name;
    this.custom = !!custom;       // true: 방장이 설정을 정하는 방 / false: 공개 방(투표)
    this.max = max;
    this.password = password || '';
    this.mode = mode;
    this.hostId = null;
    this.players = new Map();
    this.teamScore = { 1: 0, 2: 0 };
    this.over = false;
    this.vote = null;
    this.timers = new Set();
    this.projs = [];
    this.setMap(mapId);
    this.endsAt = now() + MATCH.durationMs;
  }
  setMap(id) { this.mapId = MAPS[id] ? id : 'town'; this.map = MAPS[this.mapId]; }
  later(fn, ms) {
    const h = setTimeout(() => { this.timers.delete(h); fn(); }, ms);
    this.timers.add(h);
    return h;
  }
  destroy() { for (const h of this.timers) clearTimeout(h); this.timers.clear(); rooms.delete(this.id); }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }
  get limit() { return this.mode === 'tdm' ? MATCH.teamKills : MATCH.ffaKills; }
  isFoe(a, b) { return this.mode === 'ffa' || a.team !== b.team; }
  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, cls: p.cls, team: p.team, kills: p.kills, deaths: p.deaths, user: !!p.userId }));
  }
  matchState() {
    return {
      t: 'match', mode: this.mode, map: this.mapId, limit: this.limit, teamScore: this.teamScore, over: this.over,
      hostId: this.custom ? this.hostId : null, custom: this.custom, room: this.name,
      remainMs: this.over ? 0 : Math.max(0, this.endsAt - now()), durationMs: MATCH.durationMs,
    };
  }
  info() {
    return { id: this.id, name: this.name, custom: this.custom, mode: this.mode, map: this.mapId, count: this.players.size, max: this.max, locked: !!this.password };
  }
  assignTeam() {
    if (this.mode === 'ffa') return 0;
    let a = 0, b = 0;
    for (const p of this.players.values()) { if (p.team === 1) a++; else if (p.team === 2) b++; }
    return a <= b ? 1 : 2;
  }
  spawnFor(p) {
    const sps = this.map.spawns;
    const pool = this.mode === 'tdm' ? sps.filter((s) => s.team === p.team) : sps;
    const s = pool[Math.floor(Math.random() * pool.length)];
    const x = s.x + (Math.random() - 0.5) * 2;
    const z = s.z + (Math.random() - 0.5) * 2;
    return { x, y: 0, z, yaw: Math.atan2(x, z) };
  }
  refreshHost() {
    if (!this.custom) return;
    if (!this.players.has(this.hostId)) this.hostId = this.players.size ? Math.min(...this.players.keys()) : null;
  }
  allyTargets(p, radius) {
    const list = [p];
    if (this.mode === 'tdm' && radius) {
      for (const q of this.players.values()) {
        if (q !== p && q.alive && q.team === p.team && Math.hypot(q.x - p.x, q.z - p.z) <= radius) list.push(q);
      }
    }
    return list;
  }

  /* ── 판 진행 ── */
  resetMatch() {
    this.teamScore = { 1: 0, 2: 0 };
    this.over = false;
    this.vote = null;
    this.projs = [];
    this.endsAt = now() + MATCH.durationMs;
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0;
      respawn(this, p.id, true);
    }
    this.broadcast({ t: 'roster', list: this.roster() });
    this.broadcast(this.matchState());
  }
  // 모드/맵을 바꾸고 새 판 시작 (팀전이면 팀 균등 재배정)
  startNewMatch(mode, mapId) {
    if (mode) this.mode = mode;
    if (mapId) this.setMap(mapId);
    let i = 0;
    for (const p of this.players.values()) p.team = this.mode === 'tdm' ? (i++ % 2) + 1 : 0;
    this.resetMatch();
  }
  endMatch(winnerPlayer, winnerTeam, draw) {
    if (this.over) return;
    this.over = true;
    this.projs = [];
    const board = this.roster().sort((a, b) => b.kills - a.kills);
    const nextMs = this.custom ? MATCH.customRestartMs : MATCH.voteMs + MATCH.resultMs;
    this.broadcast({
      t: 'matchend', mode: this.mode, map: this.mapId, winnerId: winnerPlayer?.id ?? null, winnerTeam: winnerTeam ?? null,
      draw: !!draw, teamScore: this.teamScore, board, nextMs,
    });
    this.broadcast(this.matchState());
    recordMatch({
      mode: this.mode, winner_team: winnerTeam ?? null,
      rows: [...this.players.values()].map((p) => ({
        user_id: p.userId || null, name: p.name, class_id: p.cls, team: p.team, kills: p.kills, deaths: p.deaths,
        won: !draw && (this.mode === 'tdm' ? p.team === winnerTeam : p.id === winnerPlayer?.id),
      })),
    });
    if (this.custom) this.later(() => this.startNewMatch(), MATCH.customRestartMs);
    else this.startVote();
  }
  // 시간 종료: 가장 많이 처치한 사람/팀이 승리, 같으면 무승부
  timeUp() {
    if (this.mode === 'tdm') {
      const a = this.teamScore[1], b = this.teamScore[2];
      return a === b ? this.endMatch(null, null, true) : this.endMatch(null, a > b ? 1 : 2, false);
    }
    const sorted = [...this.players.values()].sort((x, y) => y.kills - x.kills);
    if (!sorted.length || sorted[0].kills === 0 || (sorted[1] && sorted[1].kills === sorted[0].kills)) return this.endMatch(null, null, true);
    return this.endMatch(sorted[0], null, false);
  }

  /* ── 투표 (공개 방) ── */
  startVote() {
    this.vote = { endsAt: now() + MATCH.voteMs, votes: new Map() };
    this.broadcast({ t: 'votestart', modes: MODES, maps: MATCH.votableMaps, ms: MATCH.voteMs, mode: this.mode, map: this.mapId });
    this.later(() => this.finishVote(), MATCH.voteMs);
  }
  voteCounts() {
    const mode = Object.fromEntries(MODES.map((m) => [m, 0]));
    const map = Object.fromEntries(MATCH.votableMaps.map((m) => [m, 0]));
    for (const v of this.vote.votes.values()) {
      if (v.mode in mode) mode[v.mode]++;
      if (v.map in map) map[v.map]++;
    }
    return { mode, map };
  }
  castVote(p, m) {
    if (!this.vote || this.vote.done || this.vote.endsAt < now()) return;
    const v = this.vote.votes.get(p.id) || {};
    if (MODES.includes(m.mode)) v.mode = m.mode;
    if (MATCH.votableMaps.includes(m.map)) v.map = m.map;
    this.vote.votes.set(p.id, v);
    this.broadcast({ t: 'votestatus', ...this.voteCounts() });
  }
  finishVote() {
    if (!this.vote || this.vote.done) return;
    const pickTop = (counts, current) => {
      const max = Math.max(0, ...Object.values(counts));
      if (max === 0) return current; // 아무도 투표하지 않으면 현재 설정 유지
      const top = Object.keys(counts).filter((k) => counts[k] === max);
      return top[Math.floor(Math.random() * top.length)];
    };
    const c = this.voteCounts();
    const mode = pickTop(c.mode, this.mode);
    const map = pickTop(c.map, MATCH.votableMaps.includes(this.mapId) ? this.mapId : MATCH.votableMaps[0]);
    this.vote.done = true;
    this.broadcast({ t: 'voteend', mode, map, counts: c, ms: MATCH.resultMs });
    this.later(() => this.startNewMatch(mode, map), MATCH.resultMs);
  }
}

for (let i = 1; i <= PUBLIC_ROOMS; i++) {
  const r = new Room({ name: `Arena ${i}`, custom: false, max: MAX_PLAYERS, mode: DEFAULT_MODE, mapId: 'town' });
  rooms.set(r.id, r);
}

/* ───────────── 전투 ───────────── */
function push(q, nx, nz, dist) {
  [q.x, q.z] = resolveCollision(q.x + nx * dist, q.z + nz * dist, PLAYER.radius, q.room.map);
  send(q.ws, { t: 'correct', x: q.x, y: q.y, z: q.z });
}
function stun(q, ms) {
  q.stunUntil = Math.max(q.stunUntil, now() + ms);
  q.blocking = false;
  q.room.broadcast({ t: 'stun', id: q.id, ms });
}
function heal(q, amt) {
  const before = q.hp;
  q.hp = Math.min(CLASSES[q.cls].hp, q.hp + amt);
  if (q.hp > before) q.room.broadcast({ t: 'heal', id: q.id, amt: Math.round(q.hp - before), hp: q.hp });
}

function kill(p, q) {
  const rm = p.room;
  q.alive = false; q.blocking = false; q.stunUntil = 0; q.buffUntil = 0;
  q.deaths++; p.kills++;
  if (rm.mode === 'tdm') rm.teamScore[p.team]++;
  rm.broadcast({ t: 'kill', killer: p.id, victim: q.id });
  rm.broadcast({ t: 'roster', list: rm.roster() });
  rm.broadcast(rm.matchState());
  rm.later(() => respawn(rm, q.id), PLAYER.respawnMs);
  if (rm.mode === 'tdm' ? rm.teamScore[p.team] >= rm.limit : p.kills >= rm.limit) {
    rm.endMatch(rm.mode === 'tdm' ? null : p, rm.mode === 'tdm' ? p.team : null, false);
  }
}

// o: { reach, cos, dmg, skill, ignoreBlock, knock, stun, lifesteal, selfHeal, counter, ranged, multi, proj }
// 근접은 즉시 판정, 원거리(화살·마법탄)는 launch()로 실제 투사체를 날립니다.
function strike(p, o) {
  const rm = p.room;
  if (!rm || !p.alive || rm.over) return;
  if (o.ranged) return launch(p, o);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  for (const q of rm.players.values()) {
    if (q === p || !q.alive || !rm.isFoe(p, q)) continue;
    const dx = q.x - p.x, dz = q.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > o.reach + PLAYER.radius) continue;
    if (Math.abs(q.y - p.y) > 1.8) continue;
    if (o.cos > -1 && dist > 0.6 && (dx * fx + dz * fz) / dist < o.cos) continue;
    if (lineBlocked(p.x, p.z, q.x, q.z, rm.map)) continue;
    applyHit(p, q, o, dx, dz, dist);
    if (rm.over) return;
  }
}

// 맞은 한 명에 대한 처리 (패링, 방어, 피해, 흡혈, 밀치기, 기절, 처치)
function applyHit(p, q, o, dx, dz, dist) {
  const rm = p.room;
  const c = CLASSES[p.cls], qc = CLASSES[q.cls];
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const t = now();
  const tfx = -Math.sin(q.yaw), tfz = -Math.cos(q.yaw);
  const facing = dist > 0.01 ? (tfx * -dx + tfz * -dz) / dist : 1;
  const guarding = !o.ignoreBlock && q.blocking && facing > 0.3;

  // 패링: 방어를 막 올린 순간(parryMs 이내) 근접 공격을 받으면 피해 0, 공격자 기절, 반격 기회
  if (guarding && !o.ranged && t - q.blockSince <= PLAYER.parryMs) {
    q.counterUntil = t + PLAYER.counterWindowMs;
    rm.broadcast({ t: 'parry', id: q.id, by: p.id });
    stun(p, PLAYER.parryStunMs);
    return;
  }
  let mult = 1, tag = null;
  if (o.counter) { mult *= PLAYER.counterMult; tag = 'counter'; }
  if (c.backstab && dist > 0.01 && (tfx * dx + tfz * dz) / dist > 0.5) { mult *= c.backstab; tag = 'back'; }
  const dmg = Math.max(1, Math.round(o.dmg * mult * (guarding ? 1 - qc.block : 1)));

  q.hp = Math.max(0, q.hp - dmg);
  rm.broadcast({ t: 'hit', id: q.id, by: p.id, dmg, hp: q.hp, blocked: guarding, skill: o.skill || null, tag });
  if (o.lifesteal) heal(p, dmg * o.lifesteal);
  if (o.selfHeal) heal(p, o.selfHeal);

  if (q.hp > 0) {
    if (o.knock) {
      const nx = dist > 0.01 ? dx / dist : fx, nz = dist > 0.01 ? dz / dist : fz;
      push(q, nx, nz, o.knock * (guarding ? 0.4 : 1));
    }
    if (o.stun && !guarding) stun(q, o.stun);
  } else {
    kill(p, q);
  }
}

// 투사체 발사: 시선 방향(위아래 포함)으로 날아가며, 사거리(flat)까지는 직선, 그 뒤로는 중력 포물선
function launch(p, o) {
  const rm = p.room;
  const cfg = PROJ[o.proj] || PROJ.arrow;
  const n = o.multi ? 5 : 1;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  for (let i = 0; i < n; i++) {
    const a = p.yaw + (n > 1 ? (i / (n - 1) - 0.5) * 0.42 : 0);
    const dx = -Math.sin(a) * cp, dy = sp, dz = -Math.cos(a) * cp;
    const s = {
      pid: nextProj++, owner: p, o, trav: 0, flat: o.reach, max: o.reach * cfg.ext, g: cfg.grav,
      x: p.x + dx * 0.7, y: p.y + 1.45 + dy * 0.7, z: p.z + dz * 0.7,
      vx: dx * cfg.speed, vy: dy * cfg.speed, vz: dz * cfg.speed,
    };
    rm.projs.push(s);
    rm.broadcast({
      t: 'proj', pid: s.pid, by: p.id, cls: p.cls, kind: o.proj || 'arrow', skill: o.skill || null, first: i === 0,
      x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), vx: +s.vx.toFixed(2), vy: +s.vy.toFixed(2), vz: +s.vz.toFixed(2),
      flat: s.flat, max: s.max, g: s.g,
    });
  }
}

Room.prototype.stepProjs = function stepProjs(h) {
  if (!this.projs.length) return;
  const dead = new Set();
  for (const s of [...this.projs]) {
    if (this.over) break;
    if (!this.players.has(s.owner.id)) { dead.add(s); this.broadcast({ t: 'projend', pid: s.pid, x: s.x, y: s.y, z: s.z, hit: false }); continue; }
    let end = null;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    const n = Math.max(1, Math.ceil((speed * h) / 0.8)), dt = h / n;
    for (let k = 0; k < n && !end; k++) {
      const ox = s.x, oy = s.y, oz = s.z;
      const sp = Math.hypot(s.vx, s.vy, s.vz);
      if (s.trav >= s.flat) s.vy -= s.g * dt; // 사거리 너머부터 낙하
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.trav += sp * dt;
      if (s.y <= 0) { end = 'ground'; break; }
      if (projBlocked(ox, oy, oz, s.x, s.y, s.z, this.map)) { end = 'wall'; break; }
      const sx = s.x - ox, sz = s.z - oz, L2 = sx * sx + sz * sz;
      for (const q of this.players.values()) {
        if (q === s.owner || !q.alive || !this.isFoe(s.owner, q)) continue;
        const t = L2 > 0 ? clamp(((q.x - ox) * sx + (q.z - oz) * sz) / L2, 0, 1) : 0;
        if (Math.hypot(ox + sx * t - q.x, oz + sz * t - q.z) > PLAYER.radius + 0.3) continue;
        const yy = oy + (s.y - oy) * t;
        if (yy < q.y - 0.1 || yy > q.y + 1.95) continue;
        const dx = q.x - s.owner.x, dz = q.z - s.owner.z;
        end = 'hit';
        applyHit(s.owner, q, s.o, dx, dz, Math.hypot(dx, dz));
        break;
      }
      if (!end && s.trav >= s.max) end = 'range';
    }
    if (end) {
      dead.add(s);
      this.broadcast({ t: 'projend', pid: s.pid, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), hit: end === 'hit' });
    }
  }
  if (dead.size) this.projs = this.projs.filter((s) => !dead.has(s));
};

function respawn(rm, id, force = false) {
  const q = rm.players.get(id);
  if (!q || (!force && q.alive)) return;
  let changed = false;
  if (q.nextCls && q.nextCls !== q.cls) { q.cls = q.nextCls; changed = true; }
  q.nextCls = null;
  const s = rm.spawnFor(q);
  Object.assign(q, {
    x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, hp: CLASSES[q.cls].hp,
    alive: true, blocking: false, blockSince: 0, stunUntil: 0, buffUntil: 0, buffDmg: 1, buffSpeed: 1,
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(),
  });
  q.lastState = now();
  if (changed) rm.broadcast({ t: 'roster', list: rm.roster() });
  rm.broadcast({ t: 'respawn', id: q.id, cls: q.cls, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: q.hp });
}

function useSkill(p, slot) {
  const rm = p.room;
  const c = CLASSES[p.cls];
  const id = slot === 'e' ? 'kick' : c.skill;
  const def = SKILLS[id];
  if (!def) return;
  const t = now();
  if (t < (p.cds[id] || 0) - 80) return;
  p.cds[id] = t + (id === 'kick' ? PLAYER.kickGapMs : def.cooldown * 1000);
  p.blocking = false;
  rm.broadcast({ t: 'skill', id: p.id, skill: id });

  if (def.heal || def.dur) {
    for (const q of rm.allyTargets(p, def.radius)) {
      if (def.heal) heal(q, def.heal);
      if (def.dur) {
        q.buffUntil = t + def.dur; q.buffDmg = def.dmgMult || 1; q.buffSpeed = def.speedMult || 1;
        rm.broadcast({ t: 'buff', id: q.id, ms: def.dur, dmg: q.buffDmg, speed: q.buffSpeed });
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
      const [rx, rz] = resolveCollision(tx, tz, PLAYER.radius, rm.map);
      if (Math.hypot(rx - tx, rz - tz) > 0.05) break;
      bx = rx; bz = rz;
    }
    p.x = bx; p.z = bz;
    send(p.ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
  }
  const reach = def.reach ?? c.reach + (def.reachAdd || 0);
  const cos = def.cone >= 360 ? -2 : Math.cos((def.cone * Math.PI) / 180);
  rm.later(() => {
    if (!p.alive) return;
    strike(p, {
      reach, cos, skill: id, ranged: reach > 6, proj: def.proj, multi: id === 'volley',
      dmg: def.dmg ?? c.damage * def.dmgMult * dmgMult(p),
      ignoreBlock: !!def.ignoreBlock, knock: def.knock || 0, stun: def.stun || 0,
      lifesteal: def.lifesteal || 0, selfHeal: def.selfHeal || 0,
    });
  }, def.windup * 1000);
}

/* ───────────── 입장 / 방 관리 ───────────── */
function sanitizeCreate(cr) {
  const name = cleanText(cr?.name, ROOM.nameLen) || 'Custom Room';
  const mode = MODES.includes(cr?.mode) ? cr.mode : 'ffa';
  const mapId = MAPS[cr?.map] ? cr.map : 'town';
  const max = clamp(Math.floor(Number(cr?.max) || 8), 2, ROOM.maxCustomPlayers);
  const password = cleanText(cr?.password, ROOM.passLen);
  return { name, mode, mapId, max, password };
}

function joinRoom(ws, user, m) {
  let room;
  if (m.create) {
    if (rooms.size >= ROOM.maxRooms) return send(ws, { t: 'error', code: 'toomanyrooms' });
    room = new Room({ ...sanitizeCreate(m.create), custom: true });
    rooms.set(room.id, room);
  } else if (m.room) {
    room = rooms.get(String(m.room));
    if (!room) return send(ws, { t: 'error', code: 'noroom' });
    if (room.password && room.password !== cleanText(m.password, ROOM.passLen)) return send(ws, { t: 'error', code: 'badpass' });
  } else {
    // 방을 지정하지 않으면 자리가 있는 공개 방 중 사람이 가장 많은 곳
    const open = [...rooms.values()].filter((r) => !r.custom && r.players.size < r.max).sort((a, b) => b.players.size - a.players.size);
    room = open[0];
  }
  if (!room || room.players.size >= room.max) return send(ws, { t: 'full' });
  if (user) for (const r of rooms.values()) for (const o of r.players.values()) if (o.userId === user.id) o.ws.close();

  const id = nextId++;
  const cls = CLASSES[m.cls] ? m.cls : 'knight';
  const name = cleanText(m.name || user?.name, PLAYER.maxNameLen) || `Knight${id}`;
  const p = {
    id, ws, room, name, cls, team: room.assignTeam(), userId: user?.id || null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    hp: CLASSES[cls].hp, alive: true, blocking: false, blockSince: 0, kills: 0, deaths: 0, lastAttack: 0,
    lastState: now(), lastChat: 0, lastEmote: 0, stunUntil: 0, buffUntil: 0, buffDmg: 1, buffSpeed: 1,
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(), nextCls: null,
  };
  Object.assign(p, room.spawnFor(p));
  room.players.set(id, p);
  ws.pid = id;
  ws.room = room;
  if (room.custom && room.hostId == null) room.hostId = id; // 방을 만든 사람이 방장
  send(ws, {
    t: 'welcome', id, cls, team: p.team, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp,
    roster: room.roster(), authed: !!user, db: dbEnabled, room: room.info(), map: room.mapId,
  });
  room.broadcast({ t: 'roster', list: room.roster() });
  room.broadcast(room.matchState());
  if (room.vote && !room.vote.done) send(ws, { t: 'votestart', modes: MODES, maps: MATCH.votableMaps, ms: Math.max(0, room.vote.endsAt - now()), mode: room.mode, map: room.mapId });
  console.log(`[+] ${name} (${cls}${user ? ', 로그인' : ''}) → ${room.name} — ${room.players.size}명`);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', async (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'rooms') {
      return send(ws, { t: 'roomlist', list: [...rooms.values()].map((r) => r.info()), maps: Object.values(MAPS).map((x) => ({ id: x.id, name: x.name })) });
    }

    if (m.t === 'join') {
      if (ws.pid || ws.joining) return;
      ws.joining = true;
      const user = await verifyUser(m.token);
      ws.joining = false;
      if (ws.readyState !== 1 || ws.pid) return;
      if (REQUIRE_LOGIN && !user) return send(ws, { t: 'authrequired' });
      return joinRoom(ws, user, m);
    }

    const rm = ws.room;
    const p = rm?.players.get(ws.pid);
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
      if (MOVE_CHECK && Math.hypot(x - p.x, z - p.z) > maxDist) return send(ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
      [p.x, p.z] = resolveCollision(x, z, PLAYER.radius, rm.map);
      p.y = clamp(y, 0, 20);
      p.yaw = yaw;
      p.pitch = clamp(pitch, -1.6, 1.6);
      const wantBlock = !!m.b && !isStunned(p);
      if (wantBlock && !p.blocking) p.blockSince = t;
      p.blocking = wantBlock;
    } else if (m.t === 'attack') {
      if (!p.alive || isStunned(p) || rm.over) return;
      const c = CLASSES[p.cls];
      const t = now();
      if (t - p.lastAttack < c.cooldown * 1000 - 30) return;
      p.lastAttack = t;
      p.blocking = false;
      rm.broadcast({ t: 'swing', id: p.id });
      const cos = Math.cos(((c.cone ?? 50) * Math.PI) / 180);
      rm.later(() => {
        const counter = p.counterUntil > now();
        if (counter) p.counterUntil = 0;
        strike(p, { reach: c.reach, cos, ranged: !!c.ranged, proj: c.proj, counter, ignoreBlock: counter, dmg: Math.round(c.damage * dmgMult(p)) });
      }, c.windup * 1000);
    } else if (m.t === 'skill') {
      if (!p.alive || isStunned(p) || rm.over) return;
      if (m.slot !== 'q' && m.slot !== 'e') return;
      useSkill(p, m.slot);
    } else if (m.t === 'setclass') {
      if (!CLASSES[m.cls] || m.cls === p.cls) return;
      const inGrace = p.alive && now() - p.spawnAt < PLAYER.classSwapGraceMs;
      p.nextCls = m.cls;
      if (inGrace) { respawn(rm, p.id, true); send(ws, { t: 'classqueued', cls: m.cls, immediate: true }); }
      else send(ws, { t: 'classqueued', cls: m.cls, immediate: false });
    } else if (m.t === 'chat') {
      const t = now();
      if (t - p.lastChat < CHAT.gapMs) return;
      const text = String(m.text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, CHAT.maxLen);
      if (!text) return;
      p.lastChat = t;
      const teamOnly = !!m.team && rm.mode === 'tdm';
      const msg = { t: 'chat', id: p.id, name: p.name, team: p.team, text, teamOnly };
      for (const q of rm.players.values()) if (!teamOnly || q.team === p.team) send(q.ws, msg);
    } else if (m.t === 'emote') {
      const t = now();
      if (!EMOTE_IDS.has(m.e) || t - p.lastEmote < EMOTE_GAP_MS) return;
      p.lastEmote = t;
      rm.broadcast({ t: 'emote', id: p.id, e: m.e });
    } else if (m.t === 'vote') {
      rm.castVote(p, m);
    } else if (m.t === 'setmode' || m.t === 'setroom') {
      // 방장 방에서만, 방장만 모드·맵을 바꿀 수 있음 (공개 방은 투표로만 바뀜)
      if (!rm.custom || p.id !== rm.hostId) return;
      const mode = MODES.includes(m.mode) ? m.mode : rm.mode;
      const mapId = MAPS[m.map] ? m.map : rm.mapId;
      if (mode === rm.mode && mapId === rm.mapId) return;
      rm.startNewMatch(mode, mapId);
    }
  });

  ws.on('close', () => {
    const rm = ws.room;
    const p = rm?.players.get(ws.pid);
    if (!p) return;
    rm.players.delete(p.id);
    if (rm.vote) rm.vote.votes.delete(p.id);
    rm.refreshHost();
    if (rm.custom && !rm.players.size) { rm.destroy(); console.log(`[x] 방 삭제: ${rm.name}`); }
    else { rm.broadcast({ t: 'roster', list: rm.roster() }); rm.broadcast(rm.matchState()); }
    console.log(`[-] ${p.name} 퇴장 (${rm.name}) — ${rm.players.size}명`);
  });
});

/* ───────────── 주기 작업 ───────────── */
setInterval(() => { for (const rm of rooms.values()) rm.stepProjs(0.025); }, 25); // 투사체 비행 계산 (40Hz)

setInterval(() => { // 20Hz 스냅샷
  for (const rm of rooms.values()) {
    if (!rm.players.size) continue;
    rm.broadcast({
      t: 'snap',
      p: [...rm.players.values()].map((p) => ({
        id: p.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), b: p.blocking, hp: p.hp, alive: p.alive,
      })),
    });
  }
}, TICK_MS);

let tickCount = 0;
setInterval(() => { // 0.25초마다 시간 종료 확인, 5초마다 남은 시간 동기화
  tickCount++;
  for (const rm of rooms.values()) {
    if (rm.over) continue;
    if (!rm.players.size) { rm.endsAt = now() + MATCH.durationMs; continue; } // 빈 방은 시간이 흐르지 않음
    if (now() >= rm.endsAt) rm.timeUp();
    else if (tickCount % 20 === 0) rm.broadcast(rm.matchState());
  }
}, 250);

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
  console.log(`   공개 방 ${PUBLIC_ROOMS}개 · 정원 ${MAX_PLAYERS}명 · 기본 모드 ${DEFAULT_MODE} · 한 판 ${MATCH.durationMs / 1000}초 · 로그인 DB: ${dbEnabled ? '켜짐' : '꺼짐(게스트만)'}\n`);
});
