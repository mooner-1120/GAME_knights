# IRON OATH — 중세 기사 1인칭 멀티플레이 대전

20개 직업 · 개인전/팀전 · 패링/반격 · 채팅/이모트 · 다국어(영어 기본) · Supabase 로그인/전적

## 폴더 구조
```
server.js  classes.js  db.js  package.json
public/    index.html  game.js  i18n.js  auth.js
supabase/  schema.sql
```
`classes.js`는 맨 위에 **하나만** 둡니다(서버·화면 공용). 직업/스킬/맵 수치는 여기서 고치고, 번역은 `public/i18n.js`에서 고칩니다.

## 실행
```bash
npm install
npm start          # http://localhost:3000
MODE=tdm npm start # 팀전으로 시작 (게임 중 방장이 Esc 메뉴에서 바꿀 수도 있음)
```
환경변수: `PORT`, `MAX_PLAYERS`(기본 16), `MODE`(ffa|tdm), `REQUIRE_LOGIN=1`(로그인 필수)

## Render 배포
GitHub에 올린 뒤 Render → New Web Service → Build `npm install` / Start `npm start` / Free.

## 로그인(선택, Supabase)
1. Supabase 프로젝트 생성 → SQL Editor에 `supabase/schema.sql` 실행
2. Authentication → Providers 에서 Google / Discord / GitHub / Kakao 중 쓸 것을 켜고, URL Configuration 의 Site URL·Redirect URL에 배포 주소 추가
3. Render Environment 에 설정
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (공개 키)
   - `SUPABASE_SERVICE_ROLE_KEY` (**비밀키 — 서버 전용, 코드/GitHub에 적지 말 것**)
설정이 없으면 게스트 전용으로 동작합니다.

## 조작법
WASD 이동 · Shift 달리기 · 좌클릭 공격 · 우클릭/F 방어(맞기 직전에 누르면 **패링** → 반격) · Q 직업 스킬 · E 발차기(쿨타임 없음)
Enter/Y 채팅 · T 팀 채팅 · V 후 1~8 이모트 · Tab 점수판 · Esc 메뉴

## 언어
English(기본) · 한국어 · 日本語 · 简体中文 · Español. 로비 오른쪽 위에서 바꿉니다. 언어를 더 넣으려면 `i18n.js`의 `LANGS`와 각 배열 끝에 번역을 추가하세요(빠진 항목은 영어로 대체됩니다).
