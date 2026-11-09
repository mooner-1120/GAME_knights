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
환경변수: `PORT`, `MAX_PLAYERS`(기본 16), `MODE`(ffa|tdm|ctf|points|survival|king), `MIN_PLAY_MS`(보상·기록 최소 플레이 시간, 기본 45000), `REQUIRE_LOGIN=1`(로그인 필수)

## Render 배포
GitHub에 올린 뒤 Render → New Web Service → Build `npm install` / Start `npm start` / Free.

## 로그인(선택, Supabase)
1. Supabase 프로젝트 생성 → SQL Editor에 `supabase/schema.sql` 실행
2. Authentication → Providers 에서 Google / Discord / GitHub / Kakao 중 쓸 것을 켜고, URL Configuration 의 Site URL·Redirect URL에 배포 주소 추가
3. Render Environment 에 설정
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (공개 키)
   - `SUPABASE_SERVICE_ROLE_KEY` (**비밀키 — 서버 전용, 코드/GitHub에 적지 말 것**)
설정이 없으면 게스트 전용으로 동작합니다.

## AI 봇 / 연습모드
- 메인 화면 **연습하기**: 혼자 AI와 대전합니다(AI 수·난이도·모드·맵 선택, 비공개 방, 전적 저장 안 함).
- 방 만들기에서 AI 수와 난이도를 정하면 빈자리를 AI("Knight")가 채웁니다. 방장은 Esc 메뉴에서 AI 추가/삭제와 난이도 변경이 가능합니다.
- 사람이 들어오면 AI가 자리를 양보하고, 사람이 나가면 다시 채워집니다. AI가 섞인 판은 DB 전적에 기록되지 않습니다.
- 난이도 5단계: 신병 / 병사 / 베테랑 / 정예 / 달인 (반응속도, 조준 오차, 이동 속도, 방어·패링 확률, 스킬 사용 빈도가 달라짐). 설정은 server.js의 `AI_LEVELS`.

## 진행도 / 상점 (Supabase 추가 설정)
레벨·경험치, 직업별 전적, 칭호·업적(19종), 코인, 외형(망토·모자) 뽑기가 들어 있습니다. **로그인한 유저만** 저장됩니다.
1. Supabase SQL Editor에서 `supabase/schema.sql` 실행 후 **`supabase/progression.sql` 도 한 번 실행**합니다.
2. 서버는 `SUPABASE_SERVICE_ROLE_KEY`(서버 전용)로 저장합니다. 안 돌리면 진행도 저장만 꺼지고 게임은 정상 동작합니다.
- 뽑기는 게임으로 번 코인만 사용(현금 결제 없음), 확률은 상점에 표시, 30회 천장, 중복은 코인으로 환급됩니다.
- AI가 섞인 방은 보상이 0.3배이며 업적 카운트·직업 전적·랭킹에는 반영되지 않습니다.

## 게임 모드
개인전 · 팀전 · **깃발 뺏기**(3회 점령) · **거점 점령**(3거점 점수) · **생존전**(리스폰 없는 라운드제) · **왕 지키기**(팀별 왕 1명, 왕이 죽으면 라운드 패배).
맵에는 체력/속도/분노 아이템이 놓이고 25초마다 다시 나타납니다. 친구 초대 링크는 방장 Esc 메뉴의 초대 버튼으로 복사합니다.

## 아직 안 들어간 것
문·부술 수 있는 장애물·고지대 같은 환경 요소는 이번에 구현하지 않았습니다.

## 조작법
WASD 이동 · Shift 달리기 · 좌클릭 공격 · 우클릭/F 방어(맞기 직전에 누르면 **패링** → 반격) · Q 직업 스킬 · E 발차기(쿨타임 없음)
Enter/Y 채팅 · T 팀 채팅 · V 후 1~8 이모트 · Tab 점수판 · Esc 메뉴

**키 설정:** 설정 → 키 설정에서 이동·달리기·점프·웅크리기·방어·스킬·발차기·감정표현·채팅·점수판 키를 바꿀 수 있습니다(브라우저에 저장). 마우스 버튼과 Esc, Enter, 숫자키는 고정입니다.

## 언어
English(기본) · 한국어 · 日本語 · 简体中文 · Español. 로비 오른쪽 위에서 바꿉니다. 언어를 더 넣으려면 `i18n.js`의 `LANGS`와 각 배열 끝에 번역을 추가하세요(빠진 항목은 영어로 대체됩니다).
