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
