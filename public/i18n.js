// 다국어 (기본 영어). 각 항목은 [en, ko, ja, zh, es] 순서입니다.
// 번역이 비어 있으면 영어로 대체됩니다. 언어를 추가하려면 LANGS 에 코드를 넣고 각 배열 끝에 번역을 이어 붙이세요.
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '简体中文' },
  { code: 'es', label: 'Español' },
];
const IDX = Object.fromEntries(LANGS.map((l, i) => [l.code, i]));

const UI = {
  // 로비
  play: ['ENTER BATTLE', '전장으로 입장', '戦場へ', '进入战场', 'ENTRAR AL COMBATE'],
  name: ['Knight name', '기사 이름', '騎士名', '骑士名称', 'Nombre del caballero'],
  settings: ['Settings', '설정', '設定', '设置', 'Ajustes'],
  subtitle: ['FIRST-PERSON MEDIEVAL ARENA', '1인칭 중세 기사 대전', '一人称 中世騎士バトル', '第一人称中世纪骑士对战', 'ARENA MEDIEVAL EN PRIMERA PERSONA'],
  nav_play: ['PLAY', '플레이', 'プレイ', '开始', 'JUGAR'],
  nav_class: ['CLASSES', '직업', 'クラス', '职业', 'CLASES'],
  nav_ranks: ['RANKS', '순위', 'ランク', '排行', 'RANGOS'],
  nav_settings: ['SETTINGS', '설정', '設定', '设置', 'AJUSTES'],
  tip: ['Press Esc in game for controls.', '게임 중 Esc를 누르면 조작법을 볼 수 있어요.', 'ゲーム中にEscで操作方法を表示します。', '游戏中按 Esc 查看操作说明。', 'Pulsa Esc en partida para ver los controles.'],
  language: ['Language', '언어', '言語', '语言', 'Idioma'],
  mode: ['Game mode', '게임 모드', 'ゲームモード', '游戏模式', 'Modo de juego'],
  mode_ffa: ['Free-for-all', '개인전', '個人戦', '个人战', 'Todos contra todos'],
  mode_tdm: ['Team Deathmatch', '팀전', 'チーム戦', '团队战', 'Combate por equipos'],
  mode_note: ['Only the room host can change the mode (in game, Esc menu).', '모드는 방장만 바꿀 수 있어요 (게임 중 Esc 메뉴).', 'モード変更はホストのみ(ゲーム中のEscメニュー)。', '只有房主可以切换模式(游戏中 Esc 菜单)。', 'Solo el anfitrión puede cambiar el modo (menú Esc).'],
  mode_set: ['Mode: {m}', '모드: {m}', 'モード: {m}', '模式: {m}', 'Modo: {m}'],
  // 계정
  signin: ['SIGN IN', '로그인', 'ログイン', '登录', 'INICIAR SESIÓN'],
  guest: ['Playing as guest', '게스트로 플레이 중', 'ゲストでプレイ中', '以游客身份游玩', 'Jugando como invitado'],
  signout: ['Sign out', '로그아웃', 'ログアウト', '退出登录', 'Cerrar sesión'],
  login_with: ['Continue with {p}', '{p}(으)로 계속하기', '{p}で続ける', '使用 {p} 继续', 'Continuar con {p}'],
  login_why: ['Sign in to save your stats and appear on the leaderboard.', '로그인하면 전적이 저장되고 순위표에 올라요.', 'ログインすると戦績が保存されランキングに載ります。', '登录后可保存战绩并进入排行榜。', 'Inicia sesión para guardar tus estadísticas y aparecer en el ranking.'],
  login_off: ['Login is not enabled on this server.', '이 서버는 로그인이 설정되지 않았어요.', 'このサーバーではログインが無効です。', '此服务器未启用登录。', 'El inicio de sesión no está activado en este servidor.'],
  stats: ['Kills {k} · Deaths {d} · Wins {w} · Matches {m}', '처치 {k} · 사망 {d} · 승리 {w} · 경기 {m}', 'キル {k} · デス {d} · 勝利 {w} · 試合 {m}', '击杀 {k} · 死亡 {d} · 胜利 {w} · 场次 {m}', 'Bajas {k} · Muertes {d} · Victorias {w} · Partidas {m}'],
  leaderboard: ['Leaderboard (top kills)', '순위표 (처치 수)', 'ランキング(キル数)', '排行榜(击杀数)', 'Ranking (bajas)'],
  lb_empty: ['No ranked players yet.', '아직 순위가 없어요.', 'まだランク入りはいません。', '暂无排名。', 'Aún no hay jugadores clasificados.'],
  // 메뉴
  paused: ['PAUSED', '일시정지', '一時停止', '暂停', 'PAUSA'],
  pausedHint: ["The battle goes on. Don't stay here long!", '전투는 계속 진행 중입니다. 오래 열어 두지 마세요!', '戦いは続いています。長居は禁物!', '战斗仍在继续,请勿停留太久!', '¡El combate continúa! No tardes.'],
  resume: ['Resume', '전투 재개', '再開', '继续战斗', 'Reanudar'],
  chooseClass: ['Choose Class', '캐릭터 선택', 'キャラ選択', '选择角色', 'Elegir clase'],
  controls: ['Controls & Skills', '조작법 · 스킬', '操作・スキル', '操作与技能', 'Controles y habilidades'],
  home: ['Back to Home', '홈으로 돌아가기', 'ホームへ戻る', '返回主页', 'Volver al inicio'],
  back: ['Back', '뒤로', '戻る', '返回', 'Atrás'],
  charHint: ['Changes apply instantly within 8 s of spawning, otherwise on your next respawn.', '부활·입장 직후 8초 안에는 바로 바뀌고, 그 외에는 다음 부활 때 적용돼요.', '出現後8秒以内は即時、それ以外は次のリスポーンで反映。', '出生后8秒内立即生效,否则下次复活时生效。', 'Se aplica al instante en los primeros 8 s; si no, en el próximo reaparecer.'],
  saved: ['Settings are saved in this browser.', '설정은 이 브라우저에 자동 저장돼요.', '設定はこのブラウザに保存されます。', '设置会保存在此浏览器中。', 'Los ajustes se guardan en este navegador.'],
  sens: ['Mouse sensitivity', '마우스 감도', 'マウス感度', '鼠标灵敏度', 'Sensibilidad del ratón'],
  fov: ['Field of view', '시야각 (FOV)', '視野角 (FOV)', '视野 (FOV)', 'Campo de visión'],
  vol: ['SFX volume', '효과음 볼륨', '効果音の音量', '音效音量', 'Volumen de efectos'],
  quality: ['Graphics quality', '그래픽 품질', 'グラフィック品質', '画质', 'Calidad gráfica'],
  q_low: ['Low (fastest)', '낮음 (가장 빠름)', '低 (最速)', '低(最快)', 'Baja (más rápida)'],
  q_mid: ['Medium', '보통', '中', '中', 'Media'],
  q_high: ['High', '높음', '高', '高', 'Alta'],
  minimap: ['Show minimap', '미니맵 표시', 'ミニマップ表示', '显示小地图', 'Mostrar minimapa'],
  netinfo: ['Show ping / FPS', '핑 / FPS 표시', 'Ping / FPS 表示', '显示延迟 / FPS', 'Mostrar ping / FPS'],
  bob: ['Head bob', '걸을 때 화면 흔들림', '歩行時の画面揺れ', '行走时画面晃动', 'Balanceo al caminar'],
  host_mode: ['Switch mode (host)', '모드 변경 (방장)', 'モード切替(ホスト)', '切换模式(房主)', 'Cambiar modo (anfitrión)'],
  // 조작법
  k_move: ['Move', '이동', '移動', '移动', 'Mover'],
  k_sprint: ['Sprint (hold, unlimited; not while blocking)', '달리기 (누르고 있기, 무제한 / 방어 중엔 불가)', 'ダッシュ(長押し・無制限/防御中不可)', '奔跑(按住,无限制;防御时不可)', 'Correr (mantener, sin límite; no al bloquear)'],
  k_crouch: ['Crouch (hold) · Slide (press while sprinting)', '웅크리기 (누르고 있기) · 슬라이딩 (달리는 중 누르기)', 'しゃがみ(長押し)・スライディング(ダッシュ中に押す)', '蹲下(按住)· 滑铲(奔跑时按下)', 'Agacharse (mantener) · Deslizarse (pulsar al correr)'],
  k_jump: ['Jump', '점프', 'ジャンプ', '跳跃', 'Saltar'],
  k_attack: ['Left click: attack', '마우스 좌클릭: 공격', '左クリック: 攻撃', '鼠标左键:攻击', 'Clic izquierdo: atacar'],
  k_block: ['Right click / F (hold): block. Tap it right before a hit to PARRY, then counter!', '우클릭 / F (누르고 있기): 방어. 맞기 직전에 눌러 패링하고 반격하세요!', '右クリック/F(長押し):防御。攻撃直前に押してパリィ→反撃!', '右键 / F(按住):防御。在被击中前按下可招架并反击!', 'Clic derecho / F (mantener): bloquear. ¡Púlsalo justo antes del golpe para parar y contraatacar!'],
  k_skill: ['Class skill', '직업 고유 스킬', 'クラス固有スキル', '职业专属技能', 'Habilidad de clase'],
  k_kick: ['Kick: no cooldown, breaks guard', '발차기: 쿨타임 없음, 방어를 깸', 'キック: クールダウンなし、ガード崩し', '踢击:无冷却,破防', 'Patada: sin enfriamiento, rompe la guardia'],
  k_score: ['Scoreboard', '점수판', 'スコアボード', '计分板', 'Marcador'],
  k_chat: ['Chat (T: team chat)', '채팅 (T: 팀 채팅)', 'チャット(T: チーム)', '聊天(T:队伍聊天)', 'Chat (T: equipo)'],
  k_emote: ['Emote (then 1-8)', '감정표현 (그다음 1~8)', 'エモート(続けて1〜8)', '表情(然后按 1-8)', 'Emote (luego 1-8)'],
  k_menu: ['This menu', '이 메뉴', 'このメニュー', '此菜单', 'Este menú'],
  // 스탯 / HUD
  s_hp: ['HP', '체력', '体力', '生命', 'Vida'],
  s_speed: ['Speed', '속도', '速度', '速度', 'Velocidad'],
  s_dmg: ['Damage', '공격력', '攻撃力', '攻击', 'Daño'],
  s_rate: ['Rate', '공속', '攻速', '攻速', 'Cadencia'],
  s_range: ['Range', '사거리', '射程', '射程', 'Alcance'],
  s_def: ['Guard', '방어', '防御', '防御', 'Guardia'],
  nocd: ['no cooldown', '쿨타임 없음', 'クールダウンなし', '无冷却', 'sin enfriamiento'],
  secs: ['{n}s', '{n}초', '{n}秒', '{n}秒', '{n}s'],
  b_name: ['Knight', '기사', '騎士', '骑士', 'Caballero'],
  b_class: ['Class', '클래스', 'クラス', '职业', 'Clase'],
  b_kills: ['Kills', '처치', 'キル', '击杀', 'Bajas'],
  b_deaths: ['Deaths', '사망', 'デス', '死亡', 'Muertes'],
  kd: ['Kills {k}  /  Deaths {d}', '처치 {k}  /  사망 {d}', 'キル {k} / デス {d}', '击杀 {k} / 死亡 {d}', 'Bajas {k} / Muertes {d}'],
  st_buff: ['✨ Buff {s}s', '✨ 강화 {s}초', '✨ 強化 {s}秒', '✨ 强化 {s}秒', '✨ Mejora {s}s'],
  st_counter: ['⚔ Counter ready!', '⚔ 반격 가능!', '⚔ 反撃可能!', '⚔ 可反击!', '⚔ ¡Contraataque!'],
  st_stun: ['💫 Stunned', '💫 기절', '💫 気絶', '💫 眩晕', '💫 Aturdido'],
  st_tired: ['😮‍💨 Tired', '😮‍💨 지침', '😮‍💨 疲労', '😮‍💨 疲惫', '😮‍💨 Cansado'],
  stunned: ['💫 STUNNED!', '💫 기절!', '💫 気絶!', '💫 眩晕!', '💫 ¡ATURDIDO!'],
  ping: ['Ping {p}ms · {f} FPS', '핑 {p}ms · {f} FPS', 'Ping {p}ms · {f} FPS', '延迟 {p}ms · {f} FPS', 'Ping {p}ms · {f} FPS'],
  counter_tag: ['Counter ', '반격 ', '反撃 ', '反击 ', 'Contra '],
  back_tag: ['Backstab ', '암습 ', '背面 ', '背刺 ', 'Por la espalda '],
  streak1: ['KILL!', '처치!', 'キル!', '击杀!', '¡BAJA!'],
  streak2: ['DOUBLE KILL!', '더블 킬!', 'ダブルキル!', '双杀!', '¡DOBLE BAJA!'],
  streak3: ['TRIPLE KILL!', '트리플 킬!', 'トリプルキル!', '三杀!', '¡TRIPLE BAJA!'],
  streak4: ['QUADRA KILL!', '쿼드라 킬!', 'クアドラキル!', '四杀!', '¡CUÁDRUPLE!'],
  streakn: ['{n} KILL STREAK!', '{n}연속 처치!', '{n}連続キル!', '{n}连杀!', '¡RACHA DE {n}!'],
  parry: ['PARRY!', '패링!', 'パリィ!', '招架!', '¡PARADA!'],
  parried: ['You were parried!', '패링당했다!', 'パリィされた!', '被招架了!', '¡Te han parado!'],
  cls_now: ['Switched to {c}!', '{c}(으)로 변경했습니다!', '{c}に変更しました!', '已切换为 {c}!', '¡Cambiado a {c}!'],
  cls_next: ['{c} — applies on next respawn.', '{c} — 다음 부활 때 적용됩니다.', '{c} — 次のリスポーンで反映されます。', '{c} — 下次复活时生效。', '{c} — se aplica al reaparecer.'],
  cls_same: ['Already selected.', '이미 선택한 기사입니다.', 'すでに選択中です。', '已选择该角色。', 'Ya seleccionado.'],
  died: ['YOU DIED', '전사했습니다', 'やられた', '你已阵亡', 'HAS MUERTO'],
  killedBy: ['Slain by {n} · respawn in {s}s', '{n}에게 쓰러졌습니다 · {s}초 후 부활', '{n}にやられた · {s}秒後に復活', '被 {n} 击败 · {s}秒后复活', 'Abatido por {n} · reaparece en {s}s'],
  // 네트워크
  connecting: ['Connecting…', '접속 중…', '接続中…', '连接中…', 'Conectando…'],
  dropped: ['Connection to the server was lost.', '서버와 연결이 끊어졌습니다.', 'サーバーとの接続が切れました。', '与服务器的连接已断开。', 'Se perdió la conexión con el servidor.'],
  failconn: ['Could not reach the server. (If it was asleep, try again in a minute.)', '서버에 연결하지 못했습니다. (서버가 잠들어 있다면 잠시 후 다시 시도해 보세요)', 'サーバーに接続できません。(スリープ中なら少し待って再試行)', '无法连接服务器。(若服务器在休眠,请稍后重试)', 'No se pudo conectar. (Si estaba dormido, reintenta en un minuto.)'],
  full: ['The server is full.', '서버가 가득 찼습니다.', 'サーバーが満員です。', '服务器已满。', 'El servidor está lleno.'],
  needlogin: ['This server requires you to sign in.', '이 서버는 로그인이 필요합니다.', 'このサーバーはログインが必要です。', '此服务器需要登录。', 'Este servidor requiere iniciar sesión.'],
  lockfail: ['Click again in a moment', '잠시 후 다시 클릭해 주세요', '少し待ってもう一度クリック', '请稍后再点击', 'Vuelve a hacer clic en un momento'],
  lockfail2: ['Mouse lock failed. Click once more.', '마우스 잠금에 실패했어요. 한 번 더 클릭해 주세요', 'マウスロックに失敗。もう一度クリック', '鼠标锁定失败,请再点一次', 'Falló el bloqueo del ratón. Haz clic otra vez.'],
  // 매치
  m_ffa: ['Free-for-all · first to {n} kills', '개인전 · 먼저 {n}킬', '個人戦 · 先に{n}キル', '个人战 · 先到 {n} 杀', 'Todos contra todos · primero a {n}'],
  m_lead: ['Leader: {n} ({k})', '선두: {n} ({k}킬)', 'トップ: {n} ({k})', '领先:{n}({k})', 'Líder: {n} ({k})'],
  m_tdm: ['First to {n} kills wins', '먼저 {n}킬 달성 시 승리', '先に{n}キルで勝利', '先达到 {n} 杀获胜', 'Gana quien llegue a {n} bajas'],
  m_myteam: ['Your team', '내 팀', 'あなたのチーム', '你的队伍', 'Tu equipo'],
  win_team: ['{t} wins!', '{t} 팀 승리!', '{t}チームの勝利!', '{t}队获胜!', '¡Gana {t}!'],
  win_player: ['{n} wins!', '{n} 승리!', '{n}の勝利!', '{n} 获胜!', '¡Gana {n}!'],
  victory: ['🏆 VICTORY', '🏆 승리!', '🏆 勝利!', '🏆 胜利!', '🏆 ¡VICTORIA!'],
  defeat: ['DEFEAT', '패배', '敗北', '失败', 'DERROTA'],
  nextmatch: ['New match in {s}s', '{s}초 뒤 새 판이 시작됩니다', '{s}秒後に次の試合', '{s}秒后开始新一局', 'Nueva partida en {s}s'],
  chatAll: ['Chat (Enter to send / Esc to cancel)', '전체 채팅 (Enter 전송 / Esc 취소)', '全体チャット(Enter送信 / Esc取消)', '全体聊天(Enter 发送 / Esc 取消)', 'Chat (Enter envía / Esc cancela)'],
  chatTeam: ['Team chat (Enter to send / Esc to cancel)', '팀 채팅 (Enter 전송 / Esc 취소)', 'チームチャット(Enter送信 / Esc取消)', '队伍聊天(Enter 发送 / Esc 取消)', 'Chat de equipo (Enter envía / Esc cancela)'],
  tag_team: ['[Team]', '[팀]', '[チーム]', '[队伍]', '[Equipo]'],
  team_1: ['Red', '레드', 'レッド', '红队', 'Rojo'],
  team_2: ['Blue', '블루', 'ブルー', '蓝队', 'Azul'],
  // 방 / 투표 / 맵 / 시간
  draw: ['DRAW', '무승부', '引き分け', '平局', 'EMPATE'],
  vote_title: ['VOTE FOR THE NEXT MATCH', '다음 판 투표', '次の試合に投票', '为下一局投票', 'VOTA LA SIGUIENTE PARTIDA'],
  vote_mode: ['Mode', '모드', 'モード', '模式', 'Modo'],
  vote_map: ['Map', '맵', 'マップ', '地图', 'Mapa'],
  vote_hint: ['Press the number keys to vote (or press Esc and click).', '숫자 키로 투표하세요 (Esc를 눌러 클릭해도 돼요).', '数字キーで投票(Escでマウスも使えます)。', '按数字键投票(也可按 Esc 后点击)。', 'Pulsa las teclas numéricas para votar (o Esc y haz clic).'],
  vote_result: ['Next: {m} · {p}', '다음 판: {m} · {p}', '次: {m} · {p}', '下一局:{m} · {p}', 'Siguiente: {m} · {p}'],
  map_town: ['Medieval Town', '중세 마을', '中世の町', '中世纪小镇', 'Pueblo medieval'],
  map_fortress: ['Fortress', '성채', '城塞', '要塞', 'Fortaleza'],
  map_forest: ['Forest Village', '숲 마을', '森の村', '森林村庄', 'Aldea del bosque'],
  map_colosseum: ['Colosseum', '투기장', '闘技場', '斗兽场', 'Coliseo'],
  nav_rooms: ['ROOMS', '방', 'ルーム', '房间', 'SALAS'],
  rooms_title: ['Rooms', '방 목록', 'ルーム一覧', '房间列表', 'Salas'],
  room_create: ['Create room', '방 만들기', 'ルームを作る', '创建房间', 'Crear sala'],
  room_name: ['Room name', '방 이름', 'ルーム名', '房间名称', 'Nombre de la sala'],
  room_pass: ['Password (optional)', '비밀번호 (선택)', 'パスワード(任意)', '密码(可选)', 'Contraseña (opcional)'],
  room_max: ['Max players', '최대 인원', '最大人数', '最大人数', 'Máx. jugadores'],
  room_refresh: ['Refresh', '새로고침', '更新', '刷新', 'Actualizar'],
  room_join: ['Join', '입장', '参加', '加入', 'Entrar'],
  room_empty: ['No rooms right now.', '지금 열린 방이 없어요.', '現在ルームはありません。', '当前没有房间。', 'No hay salas ahora.'],
  room_public: ['Public · vote', '공개 · 투표', '公開・投票', '公开·投票', 'Pública · voto'],
  room_host: ['Host room', '방장 방', 'ホストルーム', '房主房间', 'Sala del anfitrión'],
  room_pw_prompt: ['Enter the room password', '방 비밀번호를 입력하세요', 'パスワードを入力', '请输入房间密码', 'Introduce la contraseña'],
  room_hostnote: ['In a host room the creator picks the mode and map (Esc menu).', '방장 방은 만든 사람이 모드·맵을 정해요 (Esc 메뉴).', 'ホストルームは作成者がモード・マップを決めます(Escメニュー)。', '房主房间由创建者选择模式和地图(Esc 菜单)。', 'En una sala de anfitrión, el creador elige modo y mapa (menú Esc).'],
  host_map: ['Switch map (host)', '맵 변경 (방장)', 'マップ切替(ホスト)', '切换地图(房主)', 'Cambiar mapa (anfitrión)'],
  err_noroom: ['That room no longer exists.', '그 방은 사라졌어요.', 'そのルームは存在しません。', '该房间已不存在。', 'Esa sala ya no existe.'],
  err_badpass: ['Wrong password.', '비밀번호가 틀렸어요.', 'パスワードが違います。', '密码错误。', 'Contraseña incorrecta.'],
  err_toomanyrooms: ['Too many rooms. Try again later.', '방이 너무 많아요. 잠시 후 다시 시도해 주세요.', 'ルームが多すぎます。後でもう一度。', '房间太多,请稍后再试。', 'Demasiadas salas. Inténtalo luego.'],
  rotate: ['Please rotate your device to landscape.', '기기를 가로 모드로 돌려 주세요.', '端末を横向きにしてください。', '请将设备横屏。', 'Gira el dispositivo a horizontal.'],
  vote_tap: ['Tap a button to vote.', '버튼을 눌러 투표하세요.', 'ボタンをタップして投票。', '点按按钮投票。', 'Toca un botón para votar.'],
  em_wave: ['Wave', '손 흔들기', '手を振る', '挥手', 'Saludar'],
  em_bow: ['Bow', '인사', 'お辞儀', '鞠躬', 'Reverencia'],
  em_cheer: ['Cheer', '환호', '歓声', '欢呼', 'Vitorear'],
  em_laugh: ['Laugh', '웃음', '笑う', '大笑', 'Reír'],
  em_taunt: ['Taunt', '도발', '挑発', '挑衅', 'Provocar'],
  em_salute: ['Salute', '경례', '敬礼', '敬礼', 'Saludo militar'],
  em_point: ['Point', '가리키기', '指差し', '指点', 'Señalar'],
  em_cry: ['Cry', '울기', '泣く', '哭泣', 'Llorar'],
};

// 직업 이름 [en, ko, ja, zh, es]
const CN = {
  knight: ['Knight', '기사', '騎士', '骑士', 'Caballero'],
  greatsword: ['Greatsword', '대검 전사', '大剣士', '大剑战士', 'Mandoble'],
  duelist: ['Duelist', '결투가', '決闘士', '决斗士', 'Duelista'],
  shield: ['Shieldbearer', '방패 기사', '盾騎士', '盾骑士', 'Escudero'],
  mage: ['Mage', '마법사', '魔法使い', '法师', 'Mago'],
  rogue: ['Rogue', '도적', '盗賊', '盗贼', 'Pícaro'],
  archer: ['Archer', '궁수', '弓使い', '弓箭手', 'Arquero'],
  cleric: ['Cleric', '성직자', '聖職者', '牧师', 'Clérigo'],
  berserker: ['Berserker', '광전사', '狂戦士', '狂战士', 'Berserker'],
  paladin: ['Paladin', '성기사', '聖騎士', '圣骑士', 'Paladín'],
  assassin: ['Assassin', '암살자', '暗殺者', '刺客', 'Asesino'],
  ranger: ['Ranger', '레인저', 'レンジャー', '游侠', 'Explorador'],
  necromancer: ['Necromancer', '강령술사', '死霊術師', '死灵法师', 'Nigromante'],
  monk: ['Monk', '수도승', '修道僧', '武僧', 'Monje'],
  spearman: ['Spearman', '창병', '槍兵', '枪兵', 'Lancero'],
  bard: ['Bard', '음유시인', '吟遊詩人', '吟游诗人', 'Bardo'],
  warlock: ['Warlock', '흑마법사', '黒魔術師', '术士', 'Brujo'],
  crossbow: ['Crossbowman', '석궁병', '弩兵', '弩手', 'Ballestero'],
  druid: ['Druid', '드루이드', 'ドルイド', '德鲁伊', 'Druida'],
  samurai: ['Samurai', '사무라이', '侍', '武士', 'Samurái'],
};
const CD_EN = {
  knight: 'Balanced longsword knight', greatsword: 'Slow, but every swing hits hard', duelist: 'Fast feet and rapid thrusts',
  shield: 'Rock-solid defense, slow movement', mage: 'Glass cannon that fires magic bolts from afar', rogue: 'Quick daggers; deadly from behind',
  archer: 'Precise long-range shooter', cleric: 'Mace-wielding priest who heals allies and self', berserker: 'Drops defense and charges in with an axe',
  paladin: 'Heavy mace and holy protection', assassin: 'Dives in for a lethal strike', ranger: 'Hunter who shoots fast and pins foes',
  necromancer: 'Dark mage who drains life', monk: 'Bare-fisted flurries and nimble footwork', spearman: 'Dominates range with a long spear',
  bard: 'Lute player who inspires allies', warlock: 'Curses that root enemies in place', crossbow: 'Slow, but one bolt really hurts',
  druid: 'Staff-wielding nature caster who outlasts foes', samurai: 'Swordmaster of the one-strike draw',
};
// 역할: classes.js 의 한국어 role 값을 키로 사용
const ROLE = {
  '근접': ['Melee', '근접', '近接', '近战', 'Cuerpo a cuerpo'], '탱커': ['Tank', '탱커', 'タンク', '坦克', 'Tanque'],
  '마법': ['Magic', '마법', '魔法', '魔法', 'Magia'], '암살': ['Stealth', '암살', '暗殺', '暗杀', 'Sigilo'],
  '원거리': ['Ranged', '원거리', '遠距離', '远程', 'A distancia'], '지원': ['Support', '지원', '支援', '辅助', 'Apoyo'],
};
const SN = {
  rally: ['Battle Cry', '전투 함성', '鬨の声', '战吼', 'Grito de guerra'], spin: ['Whirlwind', '회전 베기', '回転斬り', '旋风斩', 'Torbellino'],
  lunge: ['Lunge', '쇄도', '突進', '突进', 'Embestida'], bash: ['Shield Bash', '방패 밀치기', 'シールドバッシュ', '盾击', 'Golpe de escudo'],
  fireball: ['Fireball', '화염구', 'ファイアボール', '火球术', 'Bola de fuego'], shadowstep: ['Shadow Step', '그림자 걸음', 'シャドウステップ', '暗影步', 'Paso sombrío'],
  volley: ['Volley', '속사', '一斉射撃', '连射', 'Descarga'], heal: ['Healing Light', '치유의 빛', '癒しの光', '治愈之光', 'Luz curativa'],
  bloodrage: ['Blood Rage', '피의 분노', '血の怒り', '血之狂怒', 'Furia sangrienta'], smite: ['Holy Smite', '성스러운 일격', '聖なる一撃', '圣光打击', 'Castigo sagrado'],
  ambush: ['Ambush', '암습', '奇襲', '伏击', 'Emboscada'], snare: ['Snaring Shot', '속박 화살', '拘束の矢', '束缚之箭', 'Disparo trampa'],
  drain: ['Life Drain', '생명 흡수', '生命吸収', '生命汲取', 'Drenar vida'], palm: ['Palm Strike', '발경', '発勁', '发劲', 'Palma explosiva'],
  impale: ['Impale', '관통 찌르기', '貫通突き', '穿刺', 'Empalar'], anthem: ['Rallying Song', '응원가', '応援歌', '鼓舞之歌', 'Canción de ánimo'],
  hex: ['Hex', '저주', '呪い', '诅咒', 'Maleficio'], overcharge: ['Overcharged Shot', '과충전 사격', 'オーバーチャージ射撃', '过载射击', 'Disparo sobrecargado'],
  bloom: ['Rejuvenating Breath', '재생의 숨결', '再生の息吹', '再生之息', 'Aliento regenerador'], iaido: ['Iaido', '발도술', '居合', '居合斩', 'Iaidō'],
  kick: ['Kick', '발차기', '蹴り', '踢击', 'Patada'],
};
const SD_EN = {
  rally: '+30% damage and +20% speed for 5 s (allies within 8 m too)', spin: 'Spin and slash every enemy around you, knocking them back',
  lunge: 'Dash forward in a flash, slashing as you go', bash: 'Shove the enemy ahead and stun for 1.2 s (ignores block)',
  fireball: 'A powerful long-range fire blast', shadowstep: 'Teleport 7 m forward and stab', volley: 'Fire a fan of arrows',
  heal: 'Restore 35 HP (allies within 7 m too)', bloodrage: '+70% damage and +10% speed for 6 s', smite: 'Wide overhead strike that heals you 15 HP',
  ambush: 'Rush in for a critical strike', snare: 'Stun the target for 1 s', drain: 'Heal for 60% of the damage dealt',
  palm: 'Heavy strike that knocks back and stuns 0.6 s', impale: 'Long-reach thrust that pierces and pushes', anthem: '+20% damage and +15% speed for 6 s (allies within 10 m)',
  hex: 'Ranged curse that stuns for 0.8 s', overcharge: 'A guard-piercing super shot', bloom: 'Heal 25 HP and +20% speed for 4 s',
  iaido: 'Lightning-fast draw cut (ignores block)', kick: 'Shared by all classes. No cooldown. Ignores block and shoves enemies away',
};

let lang = 'en';
try { const s = localStorage.getItem('ironoath_lang'); if (s && IDX[s] !== undefined) lang = s; else if (IDX[(navigator.language || '').slice(0, 2)] !== undefined) lang = (navigator.language || '').slice(0, 2); } catch {}
const subs = [];
const pick = (arr) => (arr && (arr[IDX[lang]] ?? arr[0])) ?? '';
const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : s);

export const getLang = () => lang;
export const t = (key, vars) => fill(pick(UI[key]) || key, vars);
export const cname = (c) => pick(CN[c.id]) || c.name;
export const cdesc = (c) => (lang === 'ko' ? c.desc : CD_EN[c.id] || c.desc);
export const crole = (c) => pick(ROLE[c.role]) || c.role;
export const sname = (s) => pick(SN[s.id]) || s.name;
export const sdesc = (s) => (lang === 'ko' ? s.desc : SD_EN[s.id] || s.desc);
export const onLang = (fn) => subs.push(fn);
export function setLang(code) {
  if (IDX[code] === undefined) return;
  lang = code;
  try { localStorage.setItem('ironoath_lang', code); } catch {}
  document.documentElement.lang = code;
  applyI18n();
  subs.forEach((f) => f());
}
// data-i18n="key" → 텍스트, data-i18n-ph="key" → placeholder
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
document.documentElement.lang = lang;
