// 로그인 / 프로필 / 실시간 순위표 (Supabase). 서버의 /config.json 에 공개 키가 없으면 게스트 전용으로 동작합니다.
import { t, onLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
// Supabase 대시보드 → Authentication → Providers 에서 켠 것만 실제로 동작합니다.
const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
  { id: 'kakao', label: 'Kakao' },
];

let sb = null;
let user = null;
let profile = null;
window.ironToken = null; // game.js 가 입장할 때 서버로 보내 계정을 확인받습니다

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}

function render() {
  const box = $('acct');
  if (!box) return;
  box.textContent = '';
  if (!sb) {
    box.append(el('div', { textContent: t('guest') }));
    renderLeaderboard([]);
    return;
  }
  if (!user) {
    box.append(el('div', {}, el('div', { textContent: t('guest') })));
    box.append(el('button', { className: 'btn2', textContent: t('signin'), onclick: openLogin }));
    return;
  }
  const name = profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || '';
  const avatar = profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture;
  if (avatar) box.append(el('img', { src: avatar, alt: '', referrerPolicy: 'no-referrer' }));
  const info = el('div', {}, el('div', { textContent: name }));
  if (profile) info.append(el('small', { textContent: t('stats', { k: profile.kills, d: profile.deaths, w: profile.wins, m: profile.matches }) }));
  box.append(info);
  box.append(el('button', { className: 'btn2', textContent: t('signout'), onclick: () => sb.auth.signOut() }));
  const nameInput = $('name');
  if (nameInput && !nameInput.value && name) nameInput.value = name.slice(0, 16);
}

function openLogin() {
  const list = $('login-providers');
  list.textContent = '';
  for (const p of PROVIDERS) {
    list.append(el('button', {
      className: 'btn2', textContent: t('login_with', { p: p.label }),
      onclick: () => sb.auth.signInWithOAuth({ provider: p.id, options: { redirectTo: location.origin } }),
    }));
  }
  $('login-modal').style.display = 'flex';
}
$('login-close').onclick = () => { $('login-modal').style.display = 'none'; };

async function loadProfile() {
  profile = null;
  if (sb && user) {
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = data || null;
  }
  render();
}

function renderLeaderboard(rows) {
  const body = $('lbbody');
  if (!body) return;
  body.textContent = '';
  rows.forEach((r, i) => {
    const tr = el('tr');
    const nameTd = el('td');
    if (r.avatar_url) nameTd.append(el('img', { src: r.avatar_url, alt: '', referrerPolicy: 'no-referrer' }));
    nameTd.append(r.display_name || '???');
    tr.append(el('td', { textContent: String(i + 1) }), nameTd, el('td', { textContent: String(r.kills) }), el('td', { textContent: String(r.deaths) }), el('td', { textContent: String(r.wins) }));
    body.append(tr);
  });
  $('lbempty').textContent = !sb ? t('login_off') : rows.length ? '' : t('lb_empty');
}

async function loadLeaderboard() {
  if (!sb) return renderLeaderboard([]);
  const { data } = await sb.from('profiles').select('display_name,avatar_url,kills,deaths,wins').order('kills', { ascending: false }).limit(10);
  renderLeaderboard(data || []);
}

function setSession(s) {
  window.ironToken = s?.access_token || null;
  user = s?.user || null;
  $('login-modal').style.display = 'none';
  loadProfile();
}

onLang(() => { render(); loadLeaderboard(); });

(async function init() {
  let cfg = {};
  try { cfg = await (await fetch('/config.json')).json(); } catch {}
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { render(); renderLeaderboard([]); return; }
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch {
    render();
    return;
  }
  const { data } = await sb.auth.getSession();
  setSession(data.session);
  // 로그인/로그아웃/토큰 갱신 때마다 토큰을 최신으로 유지
  sb.auth.onAuthStateChange((_event, session) => setSession(session));
  loadLeaderboard();
  // 실시간: 누군가의 전적이 바뀌면 순위표와 내 전적을 자동 갱신
  sb.channel('profiles-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { loadLeaderboard(); if (user) loadProfile(); })
    .subscribe();
})();
