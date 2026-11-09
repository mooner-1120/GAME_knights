// Supabase 연동 (선택). 환경변수가 없으면 모든 함수가 조용히 무시되어 게스트 플레이만 됩니다.
//  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 비밀키. 절대 클라이언트/GitHub에 노출 금지
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const dbEnabled = !!(url && key);
const sb = dbEnabled ? createClient(url, key, { auth: { persistSession: false } }) : null;

// 클라이언트가 보낸 로그인 토큰(JWT)을 Supabase에 확인 → 진짜 사용자인지 검증
export async function verifyUser(token) {
  if (!dbEnabled || typeof token !== 'string' || !token || token.length > 4096) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    const u = data.user;
    const md = u.user_metadata || {};
    return { id: u.id, name: md.full_name || md.name || md.user_name || (u.email || '').split('@')[0] || null };
  } catch {
    return null;
  }
}

// 한 판이 끝나면 로그인한 플레이어들의 전적을 한 번에(원자적으로) 저장
export async function recordMatch(payload) {
  if (!dbEnabled) return;
  if (!payload.rows.some((r) => r.user_id)) return;
  try {
    const { error } = await sb.rpc('record_match', { payload });
    if (error) console.error('[db] 전적 저장 실패:', error.message);
  } catch (e) {
    console.error('[db] 전적 저장 오류:', e.message);
  }
}

/* ───────── 진행도 (레벨/코인/업적/인벤토리/직업별 전적) ─────────
   supabase/progression.sql 을 아직 실행하지 않았다면 조용히 꺼진 채로(null) 동작합니다. */
let progWarned = false;
const warnProg = (msg) => { if (!progWarned) { progWarned = true; console.error('[db] 진행도 기능 꺼짐:', msg, '(supabase/progression.sql 실행 필요)'); } };

export async function loadProgress(userId) {
  if (!dbEnabled || !userId) return null;
  try {
    let { data, error } = await sb.from('player_data').select('*').eq('user_id', userId).maybeSingle();
    if (error) return warnProg(error.message), null;
    if (!data) {
      const ins = await sb.from('player_data').upsert({ user_id: userId }, { onConflict: 'user_id' }).select().single();
      if (ins.error) return warnProg(ins.error.message), null;
      data = ins.data;
    }
    const cs = await sb.from('class_stats').select('*').eq('user_id', userId);
    if (cs.error) return warnProg(cs.error.message), null;
    const stats = {};
    for (const r of cs.data || []) stats[r.class_id] = { kills: r.kills, deaths: r.deaths, wins: r.wins, matches: r.matches };
    return {
      xp: data.xp || 0, coins: data.coins || 0, title: data.title || null, equipped: data.equipped || {},
      owned: Array.isArray(data.owned) ? data.owned : [], counters: data.counters || {}, ach: data.ach || {}, stats,
    };
  } catch (e) {
    warnProg(e.message);
    return null;
  }
}

export async function saveProgress(userId, prog, dirtyClasses = []) {
  if (!dbEnabled || !userId || !prog) return;
  try {
    const { error } = await sb.from('player_data').upsert({
      user_id: userId, xp: prog.xp, coins: prog.coins, title: prog.title, equipped: prog.equipped, owned: prog.owned,
      counters: prog.counters, ach: prog.ach, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) console.error('[db] 진행도 저장 실패:', error.message);
    if (dirtyClasses.length) {
      const rows = dirtyClasses.map((c) => ({ user_id: userId, class_id: c, ...prog.stats[c] }));
      const r2 = await sb.from('class_stats').upsert(rows, { onConflict: 'user_id,class_id' });
      if (r2.error) console.error('[db] 직업 전적 저장 실패:', r2.error.message);
    }
  } catch (e) {
    console.error('[db] 진행도 저장 오류:', e.message);
  }
}
