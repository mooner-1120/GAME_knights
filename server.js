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
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  CLASSES, SKILLS, MAPS, PLAYER, MATCH, ROOM, CHAT, EMOTES, EMOTE_GAP_MS,
  PROJ, resolveCollision, lineBlocked, projBlocked,
  levelFor, xpForLevel, REWARD, ACH, ITEMS, ITEM_BY_ID, RARITY, GACHA,
  MODE_LIST, isTeamMode, MODE_RULES, ITEM_KINDS, ITEM_RESPAWN_MS, ITEM_PICKUP_R,
} from './classes.js';
import { dbEnabled, verifyUser, recordMatch, loadProgress, saveProgress } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16; // 공개 방 정원
const PUBLIC_ROOMS = Math.max(1, Number(process.env.PUBLIC_ROOMS) || 1);
const DEFAULT_MODE = MODE_LIST.includes(process.env.MODE) ? process.env.MODE : 'ffa';
const MOVE_CHECK = process.env.NO_MOVE_CHECK !== '1';
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === '1';
const TICK_MS = 50;
const MOVE_SLACK = 3.2; // 달리기 x 버프 x 슬라이딩 + 네트워크 오차 여유
const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));
const MODES = MODE_LIST;

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
    return res.end(JSON.stringify({ list: [...rooms.values()].filter((r) => !r.practice).map((r) => r.info()), maps: Object.values(MAPS).map((x) => ({ id: x.id })) }));
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
    this.botTarget = 0;           // 방장이 정한 AI 수
    this.botDiff = 3;             // AI 난이도 1~5
    this.practice = false;        // 연습모드(혼자 하는 비공개 방)
    this.setMap(mapId);
    this.endsAt = now() + MATCH.durationMs;
    this.initObjectives();
    if (this.round) this.startRound();
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
  get humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  get botCount() { return this.players.size - this.humans; }
  // 방장이 정한 AI 수만큼 채움 (사람이 들어오면 자리를 양보)
  syncBots() {
    const want = this.custom ? Math.min(this.botTarget, Math.max(0, this.max - this.humans)) : 0;
    const bots = [...this.players.values()].filter((p) => p.bot);
    let changed = false;
    while (bots.length > want) { this.players.delete(bots.pop().id); changed = true; }
    while (bots.length < want) { bots.push(addBot(this)); changed = true; }
    if (changed) { this.broadcast({ t: 'roster', list: this.roster() }); this.broadcast(this.matchState()); }
  }
  get teamMode() { return isTeamMode(this.mode); }
  get paused() { return !!this.round && !this.round.active; } // 라운드 사이 (공격 불가)
  get limit() {
    switch (this.mode) {
      case 'tdm': return MATCH.teamKills;
      case 'ctf': return MODE_RULES.ctf.caps;
      case 'points': return MODE_RULES.points.score;
      case 'survival': return MODE_RULES.survival.rounds;
      case 'king': return MODE_RULES.king.rounds;
      default: return MATCH.ffaKills;
    }
  }
  isFoe(a, b) { return this.mode === 'ffa' || a.team !== b.team; }
  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, cls: p.cls, team: p.team, kills: p.kills, deaths: p.deaths, user: !!p.userId, bot: !!p.bot, lv: p.prog ? levelFor(p.prog.xp) : 0, ttl: p.prog?.title || null, eq: eqOf(p) }));
  }
  matchState() {
    return {
      t: 'match', mode: this.mode, map: this.mapId, limit: this.limit, teamScore: this.teamScore, over: this.over,
      hostId: this.custom ? this.hostId : null, custom: this.custom, room: this.name,
      obj: this.objState(), roomId: this.id, bots: this.botCount, botTarget: this.botTarget, botDiff: this.botDiff, practice: this.practice,
      remainMs: this.over ? 0 : Math.max(0, this.endsAt - now()), durationMs: MATCH.durationMs,
    };
  }
  info() {
    return { id: this.id, name: this.name, custom: this.custom, mode: this.mode, map: this.mapId, count: this.humans, bots: this.botCount, botDiff: this.botDiff, max: this.max, locked: !!this.password };
  }
  assignTeam() {
    if (this.mode === 'ffa') return 0;
    let a = 0, b = 0;
    for (const p of this.players.values()) { if (p.team === 1) a++; else if (p.team === 2) b++; }
    return a <= b ? 1 : 2;
  }
  spawnFor(p) {
    const sps = this.map.spawns;
    const pool = this.teamMode ? sps.filter((s) => s.team === p.team) : sps;
    const s = pool[Math.floor(Math.random() * pool.length)];
    const x = s.x + (Math.random() - 0.5) * 2;
    const z = s.z + (Math.random() - 0.5) * 2;
    return { x, y: 0, z, yaw: Math.atan2(x, z) };
  }
  refreshHost() {
    if (!this.custom) return;
    if (!this.players.has(this.hostId) || this.players.get(this.hostId).bot) {
      const ids = [...this.players.values()].filter((p) => !p.bot).map((p) => p.id);
      this.hostId = ids.length ? Math.min(...ids) : null;
    }
  }
  allyTargets(p, radius) {
    const list = [p];
    if (this.teamMode && radius) {
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
    this.initObjectives();
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.streak = 0; p.matchStart = now(); p.king = false;
      respawn(this, p.id, true);
    }
    if (this.round) this.startRound();
    this.broadcast({ t: 'roster', list: this.roster() });
    this.broadcast(this.matchState());
  }
  // 모드/맵을 바꾸고 새 판 시작 (팀전이면 팀 균등 재배정)
  startNewMatch(mode, mapId) {
    if (mode) this.mode = mode;
    if (mapId) this.setMap(mapId);
    let i = 0;
    for (const p of this.players.values()) p.team = this.teamMode ? (i++ % 2) + 1 : 0;
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
    awardMatch(this, winnerPlayer, winnerTeam, draw);
    if (this.botCount === 0) recordMatch({ // AI가 섞인 판은 전적에 기록하지 않음(연습용)
      mode: this.mode, winner_team: winnerTeam ?? null,
      rows: [...this.players.values()].map((p) => ({
        user_id: p.userId || null, name: p.name, class_id: p.cls, team: p.team, kills: p.kills, deaths: p.deaths,
        won: !draw && (this.teamMode ? p.team === winnerTeam : p.id === winnerPlayer?.id),
      })),
    });
    if (this.custom) this.later(() => this.startNewMatch(), MATCH.customRestartMs);
    else this.startVote();
  }
  // 시간 종료: 가장 많이 처치한 사람/팀이 승리, 같으면 무승부
  timeUp() {
    if (this.teamMode) {
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
function heal(q, amt, by) {
  const before = q.hp;
  q.hp = Math.min(CLASSES[q.cls].hp, q.hp + amt);
  if (by && by !== q && q.hp > before) bump(by, 'heals', Math.round(q.hp - before));
  if (q.hp > before) q.room.broadcast({ t: 'heal', id: q.id, amt: Math.round(q.hp - before), hp: q.hp });
}

function kill(p, q, o, tag) {
  const rm = p.room;
  q.alive = false; q.blocking = false; q.stunUntil = 0; q.buffUntil = 0;
  q.deaths++; p.kills++;
  p.streak = (p.streak || 0) + 1; q.streak = 0;
  if (rm.botCount === 0) { // 성장 기록은 사람끼리의 판에서만 (AI 파밍 방지)
    if (p.prog) {
      bump(p, 'kills'); setMax(p, 'maxstreak', p.streak); stat(p, p.cls, 'kills');
      if (p.stance === 2 && !o?.ranged) bump(p, 'slidekills');
      if (tag === 'back') bump(p, 'backstabs');
      if (o?.counter) bump(p, 'counterkills');
      if (o?.ranged && Math.hypot(p.x - q.x, p.z - q.z) >= 25) bump(p, 'longshots');
      if (q.king) bump(p, 'kingkills');
      checkAch(p);
    }
    if (q.prog) stat(q, q.cls, 'deaths');
  }
  if (q.bot && Math.random() < 0.5) q.nextCls = BOT_CLASSES[Math.floor(Math.random() * BOT_CLASSES.length)];
  if (rm.mode === 'tdm') rm.teamScore[p.team]++;
  if (rm.flags) rm.dropFlagOf(q); // 깃발을 들고 있었다면 그 자리에 떨어뜨림
  rm.broadcast({ t: 'kill', killer: p.id, victim: q.id });
  {
    const lg = q.dmgLog || new Map(), me = lg.get(p.id) || { dmg: 0, hits: 0 };
    const assists = [...lg.entries()].filter(([id, e]) => id !== p.id && e.dmg >= 10).sort((a, b) => b[1].dmg - a[1].dmg).slice(0, 3)
      .map(([, e]) => ({ name: e.name, cls: e.cls, dmg: e.dmg }));
    send(q.ws, { t: 'deathinfo', by: p.id, name: p.name, cls: p.cls, hp: Math.round(p.hp), maxhp: CLASSES[p.cls].hp, dmg: me.dmg, hits: me.hits, skill: o?.skill || null, tag: o?.counter ? 'counter' : null, assists });
  }
  rm.broadcast({ t: 'roster', list: rm.roster() });
  rm.broadcast(rm.matchState());
  if (rm.mode !== 'survival') rm.later(() => respawn(rm, q.id), PLAYER.respawnMs); // 생존전은 다음 라운드까지 부활 없음
  if (rm.mode === 'king' && q.king && rm.round?.active) return rm.endRound(p.team);    // 왕이 쓰러지면 라운드 종료
  if (rm.mode === 'ffa' ? p.kills >= rm.limit : rm.mode === 'tdm' && rm.teamScore[p.team] >= rm.limit) {
    rm.endMatch(rm.mode === 'tdm' ? null : p, rm.mode === 'tdm' ? p.team : null, false);
  }
}

// o: { reach, cos, dmg, skill, ignoreBlock, knock, stun, lifesteal, selfHeal, counter, ranged, multi, proj }
// 근접은 즉시 판정, 원거리(화살·마법탄)는 launch()로 실제 투사체를 날립니다.
function strike(p, o) {
  const rm = p.room;
  if (!rm || !p.alive || rm.over || rm.paused) return;
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
    bump(q, 'parries');
    stun(p, PLAYER.parryStunMs);
    return;
  }
  let mult = 1, tag = null;
  if (o.counter) { mult *= PLAYER.counterMult; tag = 'counter'; }
  if (c.backstab && dist > 0.01 && (tfx * dx + tfz * dz) / dist > 0.5) { mult *= c.backstab; tag = 'back'; }
  const dmg = Math.max(1, Math.round(o.dmg * mult * (guarding ? 1 - qc.block : 1) * (q.king ? MODE_RULES.king.dmgTaken : 1)));

  q.hp = Math.max(0, q.hp - dmg);
  const lg = q.dmgLog || (q.dmgLog = new Map()); // 사망 요약용: 누가 얼마나 때렸는지
  const le = lg.get(p.id) || { dmg: 0, hits: 0 };
  le.dmg += dmg; le.hits++; le.name = p.name; le.cls = p.cls; le.skill = o.skill || null; le.t = t;
  lg.set(p.id, le);
  rm.broadcast({ t: 'hit', id: q.id, by: p.id, dmg, hp: q.hp, blocked: guarding, skill: o.skill || null, tag });
  if (o.skill === 'kick') bump(p, 'kicks');
  if (o.lifesteal) heal(p, dmg * o.lifesteal);
  if (o.selfHeal) heal(p, o.selfHeal);

  if (q.hp > 0) {
    if (o.knock) {
      const nx = dist > 0.01 ? dx / dist : fx, nz = dist > 0.01 ? dz / dist : fz;
      push(q, nx, nz, o.knock * (guarding ? 0.4 : 1));
    }
    if (o.stun && !guarding) stun(q, o.stun);
  } else {
    kill(p, q, o, tag);
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
        const hh = q.stance === 2 ? 0.95 : q.stance === 1 ? 1.45 : 1.95; // 웅크리면 화살이 머리 위로 지나감
        if (yy < q.y - 0.1 || yy > q.y + hh) continue;
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
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(), stance: 0, dmgLog: new Map(),
  });
  q.lastState = now();
  if (changed) rm.broadcast({ t: 'roster', list: rm.roster() });
  rm.broadcast({ t: 'respawn', id: q.id, cls: q.cls, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: q.hp });
}

// 기본 공격 (사람과 AI 공용)
function doAttack(p) {
  const rm = p.room;
  if (!p.alive || isStunned(p) || rm.over || rm.paused) return false;
  const c = CLASSES[p.cls];
  const t = now();
  if (t - p.lastAttack < c.cooldown * 1000 - 30) return false;
  p.lastAttack = t;
  p.blocking = false;
  rm.broadcast({ t: 'swing', id: p.id });
  const cos = Math.cos(((c.cone ?? 50) * Math.PI) / 180);
  rm.later(() => {
    const counter = p.counterUntil > now();
    if (counter) p.counterUntil = 0;
    strike(p, { reach: c.reach, cos, ranged: !!c.ranged, proj: c.proj, counter, ignoreBlock: counter, dmg: Math.round(c.damage * dmgMult(p)) });
  }, c.windup * 1000);
  return true;
}

function useSkill(p, slot) {
  const rm = p.room;
  if (rm.over || rm.paused) return;
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
      if (def.heal) heal(q, def.heal, p);
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




/* ───────────── 게임 모드 목표물 (깃발 · 거점 · 라운드 · 아이템) ───────────── */
Room.prototype.initObjectives = function initObjectives() {
  const o = this.map.obj;
  this.flags = null; this.points = null; this.round = null; this.kings = null;
  if (this.mode === 'ctf') {
    const mk = (team) => ({ team, hx: o.flags[team].x, hz: o.flags[team].z, x: o.flags[team].x, z: o.flags[team].z, state: 'home', carrier: null, dropAt: 0 });
    this.flags = { 1: mk(1), 2: mk(2) };
  }
  if (this.mode === 'points') this.points = o.points.map((p) => ({ x: p.x, z: p.z, balance: 0, owner: 0 }));
  if (this.mode === 'survival' || this.mode === 'king') this.round = { n: 0, active: false, endsAt: 0 };
  this.items = o.items.map((it) => ({ ...it, active: true, respawnAt: 0 }));
  this.ptClock = 0;
  this.lastObj = 0;
};
Room.prototype.objState = function objState() {
  const o = { items: this.items.map((i) => (i.active ? 1 : 0)) };
  if (this.flags) o.flags = [1, 2].map((tm) => { const f = this.flags[tm]; return { s: f.state, c: f.carrier, x: +f.x.toFixed(1), z: +f.z.toFixed(1) }; });
  if (this.points) o.pts = this.points.map((p) => ({ o: p.owner, b: Math.round(p.balance) }));
  if (this.round) {
    const alive = [0, 0, 0];
    for (const p of this.players.values()) if (p.alive && p.team) alive[p.team]++;
    o.round = { n: this.round.n, active: this.round.active, remainMs: this.round.active ? Math.max(0, this.round.endsAt - now()) : 0, alive: [alive[1], alive[2]] };
  }
  if (this.kings) o.kings = [this.kings[1] ?? null, this.kings[2] ?? null];
  return o;
};
Room.prototype.objEvent = function objEvent(ev, p, team) { this.broadcast({ t: 'objevent', ev, by: p?.id ?? null, team: team ?? p?.team ?? 0 }); };
Room.prototype.dropFlagOf = function dropFlagOf(p) {
  if (!this.flags) return;
  for (const tm of [1, 2]) {
    const f = this.flags[tm];
    if (f.state === 'carried' && f.carrier === p.id) {
      f.state = 'dropped'; f.carrier = null; f.x = p.x; f.z = p.z; f.dropAt = now();
      this.objEvent('drop', p, tm);
      this.broadcast({ t: 'obj', obj: this.objState() });
    }
  }
};
Room.prototype.startRound = function startRound() {
  const r = this.round;
  r.n++; r.active = true;
  r.endsAt = now() + MODE_RULES[this.mode].roundMs;
  this.projs = [];
  this.kings = null;
  for (const p of this.players.values()) { p.king = false; respawn(this, p.id, true); }
  if (this.mode === 'king') {
    this.kings = {};
    for (const tm of [1, 2]) {
      const mem = [...this.players.values()].filter((p) => p.team === tm);
      if (mem.length) { const k = mem[Math.floor(Math.random() * mem.length)]; k.king = true; this.kings[tm] = k.id; }
    }
  }
  this.broadcast({ t: 'roundstart', n: r.n, mode: this.mode, kings: this.kings ? [this.kings[1] ?? null, this.kings[2] ?? null] : null });
  this.broadcast({ t: 'roster', list: this.roster() });
  this.broadcast(this.matchState());
};
Room.prototype.endRound = function endRound(winner) {
  const r = this.round;
  if (!r || !r.active || this.over) return;
  r.active = false;
  this.projs = [];
  const rules = MODE_RULES[this.mode];
  if (winner) {
    this.teamScore[winner]++;
    for (const p of this.players.values()) if (p.team === winner && p.prog) { bump(p, 'roundwins'); checkAch(p); }
  }
  this.broadcast({ t: 'roundend', winner: winner || 0, scores: this.teamScore, nextMs: rules.pauseMs, n: r.n });
  this.broadcast(this.matchState());
  if (winner && this.teamScore[winner] >= this.limit) return this.endMatch(null, winner, false);
  this.later(() => { if (this.round === r && !this.over) this.startRound(); }, rules.pauseMs);
};
function applyItem(rm, p, it) {
  const k = ITEM_KINDS[it.kind], t = now();
  if (it.kind === 'health') return heal(p, k.heal);
  const active = p.buffUntil > t;
  p.buffUntil = Math.max(p.buffUntil, t + k.ms);
  p.buffDmg = active ? p.buffDmg : 1;
  p.buffSpeed = active ? p.buffSpeed : 1;
  if (it.kind === 'speed') p.buffSpeed = Math.max(p.buffSpeed, k.mult);
  if (it.kind === 'rage') p.buffDmg = Math.max(p.buffDmg, k.mult);
  rm.broadcast({ t: 'buff', id: p.id, ms: k.ms, dmg: p.buffDmg, speed: p.buffSpeed });
}
Room.prototype.stepMode = function stepMode(dt) {
  if (this.over) return;
  const t = now();
  let changed = false, moving = false;
  const alive = [...this.players.values()].filter((p) => p.alive);
  // 아이템
  for (let i = 0; i < this.items.length; i++) {
    const it = this.items[i];
    if (!it.active) { if (t >= it.respawnAt) { it.active = true; changed = true; this.broadcast({ t: 'item', i, active: true }); } continue; }
    for (const p of alive) {
      if (Math.hypot(p.x - it.x, p.z - it.z) > ITEM_PICKUP_R) continue;
      if (it.kind === 'health' && p.hp >= CLASSES[p.cls].hp) continue;
      applyItem(this, p, it);
      it.active = false; it.respawnAt = t + ITEM_RESPAWN_MS; changed = true;
      this.broadcast({ t: 'item', i, active: false, by: p.id, kind: it.kind });
      break;
    }
  }
  if (!this.paused) {
    // 깃발 뺏기
    if (this.flags) {
      const rules = MODE_RULES.ctf;
      for (const tm of [1, 2]) {
        const f = this.flags[tm];
        if (f.state === 'carried') {
          const c = this.players.get(f.carrier);
          if (!c || !c.alive) this.dropFlagOf(c || { id: f.carrier, x: f.x, z: f.z });
          else { f.x = c.x; f.z = c.z; moving = true; }
        } else if (f.state === 'dropped' && t - f.dropAt >= rules.returnMs) {
          f.state = 'home'; f.x = f.hx; f.z = f.hz; changed = true; this.objEvent('return', null, tm);
        }
      }
      for (const p of alive) {
        const mine = this.flags[p.team], enemy = this.flags[3 - p.team];
        if (!mine || !enemy) continue;
        if (enemy.state !== 'carried' && Math.hypot(p.x - enemy.x, p.z - enemy.z) < rules.grab) {
          enemy.state = 'carried'; enemy.carrier = p.id; changed = true; this.objEvent('pickup', p, enemy.team);
        } else if (mine.state === 'dropped' && Math.hypot(p.x - mine.x, p.z - mine.z) < rules.grab) {
          mine.state = 'home'; mine.x = mine.hx; mine.z = mine.hz; changed = true; this.objEvent('return', p, mine.team);
        }
        if (enemy.carrier === p.id && mine.state === 'home' && Math.hypot(p.x - mine.hx, p.z - mine.hz) < rules.grab + 0.8) {
          enemy.state = 'home'; enemy.carrier = null; enemy.x = enemy.hx; enemy.z = enemy.hz;
          this.teamScore[p.team]++; bump(p, 'caps'); checkAch(p);
          this.objEvent('capture', p, p.team);
          this.broadcast(this.matchState());
          if (this.teamScore[p.team] >= this.limit) return this.endMatch(null, p.team, false);
        }
      }
    }
    // 거점 점령
    if (this.points) {
      const rules = MODE_RULES.points;
      for (const pt of this.points) {
        let c1 = 0, c2 = 0;
        for (const p of alive) if (Math.hypot(p.x - pt.x, p.z - pt.z) <= rules.radius) { if (p.team === 1) c1++; else if (p.team === 2) c2++; }
        if (c1 && !c2) { pt.balance = Math.max(-100, pt.balance - rules.rate * Math.min(c1, 3) * dt); moving = true; }
        else if (c2 && !c1) { pt.balance = Math.min(100, pt.balance + rules.rate * Math.min(c2, 3) * dt); moving = true; }
        const before = pt.owner;
        if (pt.balance <= -100) pt.owner = 1;
        else if (pt.balance >= 100) pt.owner = 2;
        else if (pt.owner === 1 && pt.balance > -50) pt.owner = 0;
        else if (pt.owner === 2 && pt.balance < 50) pt.owner = 0;
        if (pt.owner !== before) { changed = true; this.objEvent(pt.owner ? 'ptcap' : 'ptlost', null, pt.owner || before); }
      }
      this.ptClock += dt;
      if (this.ptClock >= 1) {
        this.ptClock -= 1;
        for (const pt of this.points) {
          if (!pt.owner) continue;
          this.teamScore[pt.owner]++; changed = true;
          for (const p of alive) if (p.team === pt.owner && Math.hypot(p.x - pt.x, p.z - pt.z) <= rules.radius) { bump(p, 'ptscore'); checkAch(p); }
        }
        for (const tm of [1, 2]) if (this.teamScore[tm] >= this.limit) { this.broadcast(this.matchState()); return this.endMatch(null, tm, false); }
        this.broadcast(this.matchState());
      }
    }
    // 라운드 (생존전 / 왕 지키기)
    if (this.round && this.round.active) {
      if (this.mode === 'survival') {
        const tot = [0, 0, 0], al = [0, 0, 0];
        for (const p of this.players.values()) if (p.team) { tot[p.team]++; if (p.alive) al[p.team]++; }
        if (tot[1] > 0 && tot[2] > 0 && (al[1] === 0 || al[2] === 0)) return this.endRound(al[1] > 0 ? 1 : al[2] > 0 ? 2 : 0);
      }
      if (t >= this.round.endsAt) {
        let w = 0;
        if (this.mode === 'survival') {
          const hp = [0, 0, 0], al = [0, 0, 0];
          for (const p of alive) { if (p.team) { al[p.team]++; hp[p.team] += p.hp; } }
          w = al[1] !== al[2] ? (al[1] > al[2] ? 1 : 2) : hp[1] !== hp[2] ? (hp[1] > hp[2] ? 1 : 2) : 0;
        }
        return this.endRound(w);
      }
    }
  }
  if (changed || (moving && t - this.lastObj >= 250)) { this.lastObj = t; this.broadcast({ t: 'obj', obj: this.objState() }); }
};
setInterval(() => { for (const rm of rooms.values()) if (rm.humans) rm.stepMode(0.05); }, 50); // 모드 목표물 (20Hz)

/* ───────────── 성장 (레벨 · 코인 · 업적 · 칭호 · 뽑기 · 꾸미기) ─────────────
   로그인한 사람만. 진행도는 서버 메모리에서 계산하고 Supabase 에 저장합니다(클라이언트는 수정 불가). */
const MIN_PLAY_MS = Number(process.env.MIN_PLAY_MS ?? REWARD.minPlayMs); // 이 시간 이상 뛴 사람만 보상
const PROGS = new Map();      // userId → 진행도 (그 사람이 접속해 있는 동안만 보관)
const PROG_REFS = new Map();  // userId → 이 계정을 쓰는 연결 수 (로비 연결 + 게임 연결)
const saveChain = new Map();  // userId → 진행 중인 저장 (순서 보장)
async function getProg(userId) {
  const wait = saveChain.get(userId);
  if (wait) await wait;
  if (PROGS.has(userId)) return PROGS.get(userId);
  const prog = await loadProgress(userId);
  if (!prog) return null;
  prog.dirty = new Set();
  PROGS.set(userId, prog);
  return prog;
}
async function acquireProg(ws, userId) {
  if (ws.progUser !== userId) { releaseProg(ws); ws.progUser = userId; PROG_REFS.set(userId, (PROG_REFS.get(userId) || 0) + 1); }
  ws.prog = await getProg(userId);
  return ws.prog;
}
function releaseProg(ws) {
  const id = ws.progUser;
  if (!id) return;
  ws.progUser = null; ws.prog = null;
  const n = (PROG_REFS.get(id) || 1) - 1;
  if (n <= 0) { PROG_REFS.delete(id); flushProg(id); PROGS.delete(id); } else PROG_REFS.set(id, n);
}
function flushProg(userId) {
  const prog = PROGS.get(userId);
  if (!prog) return;
  const dirty = [...prog.dirty];
  prog.dirty.clear();
  const snap = JSON.parse(JSON.stringify({ ...prog, dirty: undefined }));
  const prev = saveChain.get(userId) || Promise.resolve();
  const next = prev.then(() => saveProgress(userId, snap, dirty)).catch(() => {}).finally(() => { if (saveChain.get(userId) === next) saveChain.delete(userId); });
  saveChain.set(userId, next);
}
const eqOf = (p) => (p.bot ? p.eq || {} : p.prog?.equipped || {});
function randomBotEq() {
  const pick = (slot) => { const l = ITEMS.filter((i) => i.slot === slot && (i.rar === 'common' || i.rar === 'rare')); return l[Math.floor(Math.random() * l.length)].id; };
  const eq = {};
  if (Math.random() < 0.6) eq.cape = pick('cape');
  if (Math.random() < 0.5) eq.hat = pick('hat');
  return eq;
}
const classesWithKills = (g) => Object.values(g.stats).filter((x) => x.kills > 0).length;
function bump(p, key, n = 1) {
  if (!p.prog || (p.room && p.room.botCount)) return;
  p.prog.counters[key] = (p.prog.counters[key] || 0) + n;
}
function setMax(p, key, v) {
  if (!p.prog || (p.room && p.room.botCount)) return;
  if (v > (p.prog.counters[key] || 0)) p.prog.counters[key] = v;
}
function stat(p, cls, key) {
  const g = p.prog;
  if (!g) return;
  const st = g.stats[cls] || (g.stats[cls] = { kills: 0, deaths: 0, wins: 0, matches: 0 });
  st[key]++;
  g.dirty.add(cls);
}
function checkAch(p) {
  const g = p.prog;
  if (!g) return;
  let got = false;
  for (const a of ACH) {
    if (g.ach[a.id]) continue;
    const v = a.c === 'classes' ? classesWithKills(g) : g.counters[a.c] || 0;
    if (v >= a.goal) {
      g.ach[a.id] = Date.now();
      g.coins += a.coins;
      got = true;
      send(p.ws, { t: 'ach', id: a.id, coins: a.coins, title: !!a.title });
    }
  }
  if (got) { sendProfile(p); flushProg(p.userId); }
}
function profileOf(g) {
  const lv = levelFor(g.xp);
  return {
    t: 'profile', xp: g.xp, level: lv, curXp: xpForLevel(lv), nextXp: lv >= 50 ? null : xpForLevel(lv + 1), coins: g.coins, title: g.title,
    equipped: g.equipped, owned: g.owned, ach: g.ach, counters: { ...g.counters, classes: classesWithKills(g) }, stats: g.stats,
  };
}
function sendProfile(p) { if (p.prog) send(p.ws, profileOf(p.prog)); }

// 한 판이 끝났을 때 경험치/코인 지급
function awardMatch(rm, winnerPlayer, winnerTeam, draw) {
  const f = rm.botCount ? REWARD.botFactor : 1;
  for (const p of rm.players.values()) {
    if (p.bot || !p.prog || now() - (p.matchStart || 0) < MIN_PLAY_MS) continue;
    const g = p.prog;
    const won = !draw && (rm.mode === 'ffa' ? p.id === winnerPlayer?.id : p.team === winnerTeam);
    const xp = Math.round((REWARD.xpBase + REWARD.xpKill * p.kills + (won ? REWARD.xpWin : draw ? REWARD.xpDraw : 0)) * f);
    let coins = Math.round((REWARD.coinBase + REWARD.coinKill * p.kills + (won ? REWARD.coinWin : draw ? REWARD.coinDraw : 0)) * f);
    const before = levelFor(g.xp);
    g.xp += xp;
    const after = levelFor(g.xp);
    const lvBonus = (after - before) * REWARD.levelUpCoins;
    g.coins += coins + lvBonus;
    if (!rm.botCount) {
      bump(p, 'matches');
      if (won) bump(p, 'wins');
      stat(p, p.cls, 'matches');
      if (won) stat(p, p.cls, 'wins');
    }
    send(p.ws, { t: 'matchreward', xp, coins: coins + lvBonus, level: after, levelUp: after > before, won, draw: !!draw, practice: f < 1 });
    checkAch(p);
    sendProfile(p);
    flushProg(p.userId);
  }
}

// 뽑기: 코인으로만 (결제 없음). 확률은 RARITY 가중치, 30번째까지 에픽 이상이 없으면 확정
function pickRarity(list) {
  const tot = list.reduce((a, k) => a + RARITY[k].w, 0);
  let r = crypto.randomInt(0, tot);
  for (const k of list) { if (r < RARITY[k].w) return k; r -= RARITY[k].w; }
  return list[0];
}
function rollGacha(g) {
  g.counters.pity = (g.counters.pity || 0) + 1;
  const rar = g.counters.pity >= GACHA.pityAt ? pickRarity(['epic', 'legendary']) : pickRarity(Object.keys(RARITY));
  if (rar === 'epic' || rar === 'legendary') g.counters.pity = 0;
  const pool = ITEMS.filter((i) => i.rar === rar);
  const item = pool[crypto.randomInt(0, pool.length)];
  const dup = g.owned.includes(item.id);
  const refund = dup ? RARITY[item.rar].refund : 0;
  if (dup) g.coins += refund; else g.owned.push(item.id);
  return { id: item.id, rar: item.rar, dup, refund };
}
function handleGacha(ws, n) {
  const g = ws.prog;
  if (!g) return send(ws, { t: 'gachaerr', code: 'login' });
  n = n === 10 ? 10 : 1;
  const cost = n === 10 ? GACHA.cost10 : GACHA.cost1;
  if (g.coins < cost) return send(ws, { t: 'gachaerr', code: 'coins' });
  g.coins -= cost;
  const results = [];
  for (let i = 0; i < n; i++) results.push(rollGacha(g));
  flushProg(ws.progUser);
  send(ws, { t: 'gacharesult', items: results, coins: g.coins, pity: g.counters.pity || 0 });
  send(ws, profileOf(g));
}
function handleEquip(ws, m) {
  const g = ws.prog;
  if (!g || (m.slot !== 'cape' && m.slot !== 'hat')) return;
  if (m.id == null) delete g.equipped[m.slot];
  else {
    const it = ITEM_BY_ID[m.id];
    if (!it || it.slot !== m.slot || !g.owned.includes(it.id)) return;
    g.equipped[m.slot] = it.id;
  }
  flushProg(ws.progUser);
  send(ws, profileOf(g));
  if (ws.room) ws.room.broadcast({ t: 'roster', list: ws.room.roster() });
}
function handleTitle(ws, id) {
  const g = ws.prog;
  if (!g) return;
  if (id == null) g.title = null;
  else { const a = ACH.find((x) => x.id === id); if (!a || !a.title || !g.ach[id]) return; g.title = id; }
  flushProg(ws.progUser);
  send(ws, profileOf(g));
  if (ws.room) ws.room.broadcast({ t: 'roster', list: ws.room.roster() });
}

/* ───────────── AI 봇 ─────────────
   서버가 직접 움직이는 가짜 플레이어. 난이도 1~5:
   react 반응속도(초) / turn 회전속도(rad/s) / err 조준 오차(rad) / speed 이동 배율 /
   block 상대 공격을 보고 방어(패링)할 확률 / skill 스킬 사용 확률 / kick 발차기 확률 / strafe 좌우 움직임 */
const AI_LEVELS = [null,
  { react: 0.95, turn: 2.6, err: 0.40, speed: 0.70, block: 0.04, skill: 0.20, kick: 0.05, strafe: 0.0 },
  { react: 0.65, turn: 4.0, err: 0.26, speed: 0.80, block: 0.12, skill: 0.35, kick: 0.12, strafe: 0.3 },
  { react: 0.42, turn: 6.0, err: 0.15, speed: 0.90, block: 0.25, skill: 0.55, kick: 0.22, strafe: 0.6 },
  { react: 0.26, turn: 9.0, err: 0.075, speed: 1.00, block: 0.38, skill: 0.75, kick: 0.35, strafe: 0.85 },
  { react: 0.15, turn: 14.0, err: 0.03, speed: 1.06, block: 0.50, skill: 0.92, kick: 0.5, strafe: 1.0 },
];
const BOT_WS = { readyState: 0, close() {}, send() {} };
const BOT_CLASSES = Object.keys(CLASSES);
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function addBot(rm) {
  const id = nextId++;
  const cls = BOT_CLASSES[Math.floor(Math.random() * BOT_CLASSES.length)];
  const p = {
    id, ws: BOT_WS, room: rm, name: 'Knight', cls, team: rm.assignTeam(), userId: null, bot: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    hp: CLASSES[cls].hp, alive: true, blocking: false, blockSince: 0, kills: 0, deaths: 0, lastAttack: 0,
    lastState: now(), lastChat: 0, lastEmote: 0, stunUntil: 0, buffUntil: 0, buffDmg: 1, buffSpeed: 1,
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(), nextCls: null, stance: 0, dmgLog: new Map(), eq: randomBotEq(), matchStart: now(), streak: 0,
    ai: { obj: Math.random() < 0.65, target: null, retargetAt: 0, actAt: 0, skillAt: 0, strafe: 1, strafeAt: 0, errYaw: 0, errPitch: 0, errAt: 0, blockAt: 0, blockEnd: 0, seen: 0, dash: null, avoidUntil: 0, avoidDir: 1, lx: 0, lz: 0, lcheck: 0 },
  };
  Object.assign(p, rm.spawnFor(p));
  rm.players.set(id, p);
  return p;
}

Room.prototype.stepBots = function stepBots(dt) {
  if (this.over || this.paused) return;
  const t = now();
  for (const p of this.players.values()) if (p.bot && p.alive) botThink(this, p, dt, t);
};

function botSkill(rm, p, tg, d, los, aligned, L, t) {
  const c = CLASSES[p.cls], id = c.skill, def = SKILLS[id];
  if (!def || t < (p.cds[id] || 0)) return false;
  const a = p.ai;
  let use = false;
  const allies = rm.teamMode ? [...rm.players.values()].filter((q) => q !== p && q.alive && q.team === p.team && Math.hypot(q.x - p.x, q.z - p.z) <= (def.radius || 0)) : [];
  if (def.heal) use = p.hp < c.hp * 0.55 || allies.some((q) => q.hp < CLASSES[q.cls].hp * 0.6); // 팀전에선 다친 아군도 치유
  else if (def.dur) use = d < 16 && (allies.length > 0 || !def.radius || !rm.teamMode);       // 버프는 아군이 가까이 있을 때 (팀 전체에 적용)
  else {
    const reach = def.reach ?? c.reach + (def.reachAdd || 0);
    if (def.blink) use = los && aligned && d > 3.5 && d < def.blink + reach;
    else if (def.dash) use = aligned && d > 2.2 && d < def.dash.speed * def.dash.dur + reach * 0.8;
    else if (reach > 6) use = los && aligned && d <= reach * 0.95;
    else use = aligned && d <= reach + 0.3;
  }
  if (!use) return false;
  useSkill(p, 'q');
  if (def.dash) a.dash = { dx: -Math.sin(p.yaw), dz: -Math.cos(p.yaw), speed: def.dash.speed, end: t + def.dash.dur * 1000 };
  return true;
}


// 봇이 모드 목표를 향해 움직이게: 깃발·거점·체력 아이템
function botGoal(rm, p) {
  const c = CLASSES[p.cls];
  if (p.hp < c.hp * 0.45) { // 다쳤으면 가까운 체력 물약
    let best = null, bd = 30;
    for (const it of rm.items) if (it.active && it.kind === 'health') { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = it; } }
    if (best) return { x: best.x, z: best.z, priority: true };
  }
  if (!p.ai.obj) return null; // 일부 봇은 목표 대신 싸움에 집중
  if (rm.flags) {
    const mine = rm.flags[p.team], enemy = rm.flags[3 - p.team];
    if (!mine || !enemy) return null;
    if (enemy.carrier === p.id) return { x: mine.hx, z: mine.hz, priority: true };
    if (mine.state === 'dropped') return { x: mine.x, z: mine.z };
    if (mine.state === 'carried') return { x: mine.x, z: mine.z }; // 내 깃발을 든 적을 추격
    return { x: enemy.x, z: enemy.z };
  }
  if (rm.points) {
    let best = null, bd = Infinity;
    for (const pt of rm.points) {
      if (pt.owner === p.team) continue;
      const d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (d < bd) { bd = d; best = pt; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }
  return null;
}

function botThink(rm, p, dt, t) {
  const L = AI_LEVELS[rm.botDiff] || AI_LEVELS[3];
  const a = p.ai, c = CLASSES[p.cls];
  if (isStunned(p)) { p.blocking = false; a.dash = null; return; }

  // 돌진 중에는 그 방향으로 이동
  if (a.dash) {
    if (t >= a.dash.end) a.dash = null;
    else { [p.x, p.z] = resolveCollision(p.x + a.dash.dx * a.dash.speed * dt, p.z + a.dash.dz * a.dash.speed * dt, PLAYER.radius, rm.map); return; }
  }

  // 목표 선택: 가까운 적 (사람을 약간 우선, 시야가 막히면 불리)
  let tg = a.target && a.target.alive && rm.players.has(a.target.id) && rm.isFoe(p, a.target) ? a.target : null;
  if (!tg || t >= a.retargetAt) {
    let best = null, bs = Infinity;
    for (const q of rm.players.values()) {
      if (q === p || !q.alive || !rm.isFoe(p, q)) continue;
      const sc = Math.hypot(q.x - p.x, q.z - p.z) + (q.bot ? 0 : -5) + (lineBlocked(p.x, p.z, q.x, q.z, rm.map) ? 8 : 0)
        - (q.king ? 10 : 0) - (rm.flags && rm.flags[p.team]?.carrier === q.id ? 12 : 0); // 왕과 우리 깃발을 든 적을 우선
      if (sc < bs) { bs = sc; best = q; }
    }
    if (best !== tg) a.actAt = Math.max(a.actAt, t + L.react * 1000 * rnd(0.8, 1.3)); // 새 목표를 보고 반응하는 시간
    tg = best;
    a.target = best;
    a.retargetAt = t + rnd(900, 1800);
  }
  if (!tg) { p.blocking = false; return; }

  const dx = tg.x - p.x, dz = tg.z - p.z;
  const d = Math.hypot(dx, dz) || 0.001;
  const los = !lineBlocked(p.x, p.z, tg.x, tg.z, rm.map);

  // 조준 (회전 속도와 오차는 난이도에 따라)
  if (t >= a.errAt) { a.errYaw = rnd(-L.err, L.err); a.errPitch = rnd(-L.err, L.err) * 0.5; a.errAt = t + rnd(400, 900); }
  const goal = botGoal(rm, p);
  const useGoal = !!goal && (goal.priority || d > 12 || !los);
  const ax = useGoal ? goal.x - p.x : dx, az = useGoal ? goal.z - p.z : dz;
  const want = Math.atan2(-ax, -az) + a.errYaw;
  const diff = wrapAngle(want - p.yaw);
  p.yaw += clamp(diff, -L.turn * dt, L.turn * dt);
  const aimDiff = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - p.yaw));
  p.pitch = c.ranged ? clamp(Math.atan2(tg.y + 1.2 - (p.y + 1.45), d) + a.errPitch, -0.6, 0.6) : 0;
  const halfCone = ((c.cone ?? 50) * Math.PI) / 180;
  const aligned = c.ranged ? aimDiff < 0.12 + L.err : aimDiff < Math.min(halfCone * 0.7, 0.6);

  // 방어/패링: 상대가 막 공격을 시작한 걸 보면 (반응 시간 뒤) 방어를 올림
  if (!p.blocking && t >= a.blockAt && a.blockAt > 0) { p.blocking = true; p.blockSince = t; a.blockEnd = t + rnd(450, 800); a.blockAt = 0; }
  if (p.blocking && t >= a.blockEnd) p.blocking = false;
  if (!p.blocking && a.blockAt === 0) {
    for (const q of rm.players.values()) {
      if (q === p || !q.alive || !rm.isFoe(p, q) || q.lastAttack === a.seen) continue;
      const qc = CLASSES[q.cls];
      if (qc.ranged || t - q.lastAttack > 300 || Math.hypot(q.x - p.x, q.z - p.z) > qc.reach + 1.6) continue;
      a.seen = q.lastAttack;
      if (Math.random() < L.block) a.blockAt = t + L.react * 1000 * 0.45;
      break;
    }
  }

  // 이동
  const stuck = t >= a.lcheck;
  if (stuck) {
    if (Math.hypot(p.x - a.lx, p.z - a.lz) < 0.25 && d > 2.5) { a.avoidUntil = t + 800; a.avoidDir = Math.random() < 0.5 ? 1 : -1; }
    a.lx = p.x; a.lz = p.z; a.lcheck = t + 600;
  }
  if (t >= a.strafeAt) { a.strafe = Math.random() < 0.5 ? 1 : -1; a.strafeAt = t + rnd(1000, 2400); }
  const ux = dx / d, uz = dz / d;        // 목표 방향
  const sx = -uz * a.strafe, sz = ux * a.strafe; // 옆 방향
  const prefer = c.ranged ? Math.max(6, c.reach * 0.55) : c.reach * 0.8;
  let mx = 0, mz = 0;
  const sdef = SKILLS[c.skill];
  const support = rm.teamMode && sdef && (sdef.heal || (sdef.dur && sdef.radius));
  let buddy = null;
  if (support) { // 지원 직업: 가장 가까운(다친 쪽 우선) 아군 곁에 머무름
    let bs = Infinity;
    for (const q of rm.players.values()) {
      if (q === p || !q.alive || q.team !== p.team) continue;
      const sc = Math.hypot(q.x - p.x, q.z - p.z) - (1 - q.hp / CLASSES[q.cls].hp) * 12;
      if (sc < bs) { bs = sc; buddy = q; }
    }
  }
  if (useGoal) {
    const gl = Math.hypot(ax, az);
    if (gl > 1.4) { mx = ax / gl; mz = az / gl; }
  } else if (buddy && Math.hypot(buddy.x - p.x, buddy.z - p.z) > 6 && d > prefer * 1.2) {
    const bx = buddy.x - p.x, bz = buddy.z - p.z, bl = Math.hypot(bx, bz) || 1;
    mx = bx / bl; mz = bz / bl;
  } else if (d > prefer * (c.ranged ? 1.35 : 1) || !los) { mx = ux; mz = uz; }
  else if (c.ranged && d < prefer * 0.55) { mx = -ux * 0.8; mz = -uz * 0.8; }
  mx += sx * 0.7 * L.strafe; mz += sz * 0.7 * L.strafe;
  if (t < a.avoidUntil) { const ca = Math.cos(1.3 * a.avoidDir), sa = Math.sin(1.3 * a.avoidDir); [mx, mz] = [mx * ca - mz * sa, mx * sa + mz * ca]; }
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    const v = c.speed * L.speed * (p.buffUntil > t ? p.buffSpeed : 1) * (p.blocking ? 0.55 : 1) * (d > prefer * 1.6 && !p.blocking ? 1.35 : 1);
    [p.x, p.z] = resolveCollision(p.x + (mx / ml) * v * dt, p.z + (mz / ml) * v * dt, PLAYER.radius, rm.map);
  }

  // 공격 / 스킬 / 발차기
  if (p.blocking || t < a.actAt) return;
  if (t >= a.skillAt) {
    a.skillAt = t + rnd(600, 1400);
    if (Math.random() < L.skill && botSkill(rm, p, tg, d, los, aligned, L, t)) { a.actAt = t + 350; return; }
  }
  if (d < 2.1 && tg.blocking && Math.random() < L.kick * 0.25) { useSkill(p, 'e'); a.actAt = t + 300; return; }
  const inReach = c.ranged ? d <= c.reach * 0.95 && los : d <= c.reach + 0.3;
  if (inReach && aligned && doAttack(p)) a.actAt = t + c.cooldown * 1000 * rnd(1.0, 1.2) + L.react * 150;
}

/* ───────────── 입장 / 방 관리 ───────────── */
function sanitizeCreate(cr) {
  const name = cleanText(cr?.name, ROOM.nameLen) || 'Custom Room';
  const mode = MODES.includes(cr?.mode) ? cr.mode : 'ffa';
  const mapId = MAPS[cr?.map] ? cr.map : 'town';
  let max = clamp(Math.floor(Number(cr?.max) || 8), 2, ROOM.maxCustomPlayers);
  if (cr?.practice) max = clamp(Math.floor(Number(cr?.bots) || 5) + 1, 2, ROOM.maxCustomPlayers);
  const password = cr?.practice ? Math.random().toString(36).slice(2, 10) : cleanText(cr?.password, ROOM.passLen); // 연습방은 비공개
  const practice = !!cr?.practice;
  const bots = clamp(Math.floor(Number(cr?.bots) || 0), practice ? 1 : 0, max - 1);
  const botDiff = clamp(Math.floor(Number(cr?.botDiff) || 3), 1, 5);
  return { name, mode, mapId, max, password, practice, bots, botDiff };
}

function joinRoom(ws, user, m, prog) {
  let room;
  if (m.create) {
    if (rooms.size >= ROOM.maxRooms) return send(ws, { t: 'error', code: 'toomanyrooms' });
    const cfg = sanitizeCreate(m.create);
    room = new Room({ ...cfg, custom: true });
    room.practice = cfg.practice;
    room.botTarget = cfg.bots;
    room.botDiff = cfg.botDiff;
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
  if (room && room.players.size >= room.max && room.humans < room.max) { // 자리가 없으면 AI가 양보
    const bot = [...room.players.values()].find((x) => x.bot);
    if (bot) room.players.delete(bot.id);
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
    counterUntil: 0, dashUntil: 0, cds: {}, spawnAt: now(), nextCls: null, dmgLog: new Map(), prog: prog || null, matchStart: now(), streak: 0,
  };
  Object.assign(p, room.spawnFor(p));
  if (room.mode === 'survival' && room.round?.active) p.alive = false; // 생존전 도중에 들어오면 다음 라운드부터
  room.players.set(id, p);
  ws.pid = id;
  ws.room = room;
  if (room.custom && room.hostId == null) room.hostId = id; // 방을 만든 사람이 방장
  room.syncBots();
  send(ws, {
    t: 'welcome', id, cls, team: p.team, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp, alive: p.alive,
    roster: room.roster(), authed: !!user, prog: !!prog, db: dbEnabled, room: room.info(), map: room.mapId,
  });
  sendProfile(p);
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
      return send(ws, { t: 'roomlist', list: [...rooms.values()].filter((r) => !r.practice).map((r) => r.info()), maps: Object.values(MAPS).map((x) => ({ id: x.id, name: x.name })) });
    }

    if (m.t === 'join') {
      if (ws.pid || ws.joining) return;
      ws.joining = true;
      const user = await verifyUser(m.token);
      const prog = user ? await acquireProg(ws, user.id) : null;
      ws.joining = false;
      if (ws.readyState !== 1 || ws.pid) return;
      if (REQUIRE_LOGIN && !user) return send(ws, { t: 'authrequired' });
      return joinRoom(ws, user, m, prog);
    }

    // 로비에서도 쓰는 성장 메시지 (방에 들어가기 전에도 프로필/상점 사용 가능)
    if (m.t === 'getprofile') {
      if (ws.profPending) return;
      ws.profPending = true;
      const user = await verifyUser(m.token);
      ws.profPending = false;
      if (!user) { releaseProg(ws); return send(ws, { t: 'profile', guest: true }); }
      const prog = await acquireProg(ws, user.id);
      return send(ws, prog ? profileOf(prog) : { t: 'profile', guest: true, off: true });
    }
    if (m.t === 'gacha') return handleGacha(ws, Number(m.n));
    if (m.t === 'equip') return handleEquip(ws, m);
    if (m.t === 'settitle') return handleTitle(ws, m.id == null ? null : String(m.id));

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
      p.stance = m.c === 1 || m.c === 2 ? m.c : 0; // 0 서기 / 1 웅크리기 / 2 슬라이딩
    } else if (m.t === 'attack') {
      doAttack(p);
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
      const teamOnly = !!m.team && rm.teamMode;
      const msg = { t: 'chat', id: p.id, name: p.name, team: p.team, text, teamOnly };
      for (const q of rm.players.values()) if (!teamOnly || q.team === p.team) send(q.ws, msg);
    } else if (m.t === 'emote') {
      const t = now();
      if (!EMOTE_IDS.has(m.e) || t - p.lastEmote < EMOTE_GAP_MS) return;
      p.lastEmote = t;
      rm.broadcast({ t: 'emote', id: p.id, e: m.e });
    } else if (m.t === 'vote') {
      rm.castVote(p, m);
    } else if (m.t === 'invite') {
      if (!rm.custom || rm.practice || p.id !== rm.hostId) return;
      send(ws, { t: 'invite', room: rm.id, pw: rm.password || '' });
    } else if (m.t === 'setbots') {
      if (!rm.custom || p.id !== rm.hostId) return;
      if (Number.isFinite(Number(m.count))) rm.botTarget = clamp(Math.floor(Number(m.count)), rm.practice ? 1 : 0, rm.max - 1);
      if (Number.isFinite(Number(m.diff))) rm.botDiff = clamp(Math.floor(Number(m.diff)), 1, 5);
      rm.syncBots();
      rm.broadcast(rm.matchState());
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
    if (!p) { releaseProg(ws); return; }
    if (rm.flags) rm.dropFlagOf(p);
    if (rm.mode === 'king' && p.king && rm.round?.active) rm.endRound(3 - p.team);
    rm.players.delete(p.id);
    if (p.userId && p.prog) flushProg(p.userId); // 나가면 진행도 저장
    releaseProg(ws);
    if (rm.vote) rm.vote.votes.delete(p.id);
    rm.refreshHost();
    if (rm.humans) rm.syncBots();
    if (rm.custom && !rm.humans) { rm.destroy(); console.log(`[x] 방 삭제: ${rm.name}`); }
    else { rm.broadcast({ t: 'roster', list: rm.roster() }); rm.broadcast(rm.matchState()); }
    console.log(`[-] ${p.name} 퇴장 (${rm.name}) — ${rm.players.size}명`);
  });
});

/* ───────────── 주기 작업 ───────────── */
setInterval(() => { for (const rm of rooms.values()) rm.stepProjs(0.025); }, 25);
setInterval(() => { for (const rm of rooms.values()) if (rm.humans && rm.botCount) rm.stepBots(0.05); }, 50); // AI 판단 (20Hz) // 투사체 비행 계산 (40Hz)

setInterval(() => { // 20Hz 스냅샷
  for (const rm of rooms.values()) {
    if (!rm.humans) continue;
    rm.broadcast({
      t: 'snap',
      p: [...rm.players.values()].map((p) => ({
        id: p.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), b: p.blocking, c: p.stance || 0, hp: p.hp, alive: p.alive,
      })),
    });
  }
}, TICK_MS);

let tickCount = 0;
setInterval(() => { // 0.25초마다 시간 종료 확인, 5초마다 남은 시간 동기화
  tickCount++;
  for (const rm of rooms.values()) {
    if (rm.over) continue;
    if (!rm.humans) { // 빈 방은 시간이 흐르지 않음
      rm.endsAt = now() + MATCH.durationMs;
      if (rm.round?.active) rm.round.endsAt = now() + MODE_RULES[rm.mode].roundMs;
      continue;
    }
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

/* ───────────── 공개 방 생성 (모든 메서드가 정의된 뒤에) ───────────── */
globalThis.__rooms = rooms; // (테스트용)
for (let i = 1; i <= PUBLIC_ROOMS; i++) {
  const r = new Room({ name: `Arena ${i}`, custom: false, max: MAX_PLAYERS, mode: DEFAULT_MODE, mapId: 'town' });
  rooms.set(r.id, r);
}

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
