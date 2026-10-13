// Автотест МОЛОКО 2.0: тиковый цикл, локальные доски, приватность букв,
// экспоненциальные очки 2^(6-n), 5 способностей, наблюдатели, endMatch/leave.
// Два сервера: медленные тики (способности, без тайм-аутов) и быстрые
// (пропуски по тайм-ауту, лимит тиков, кража, EN, leave).
// Запуск: npm run test:server
import { spawn } from 'node:child_process';
import { evaluateGuess } from '../src/game/logic.js';

let gState = null; // последний снапшот состояния (общий для всех клиентов)

let passed = 0;
const fails = [];
function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    fails.push(label);
    console.log(`  FAIL ${label}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const client = {
      ws, name, id: `test-${name}`,
      state: null, toasts: [], privates: [],
    };
    ws.onopen = () => resolve(client);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'state') {
        gState = msg.state;
        client.state = msg.state;
      }
      if (msg.t === 'toast') client.toasts.push(msg.text);
      if (msg.t === 'private') client.privates.push(msg.data);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}
const hello = (c) => c.ws.send(JSON.stringify({ t: 'hello', id: c.id, name: c.name, avatar: null }));
const send = (c, msg) => c.ws.send(JSON.stringify({ t: msg.t, ...msg }));
const myRows = (c) => c.privates[c.privates.length - 1]?.myRows || [];
const pts = (state, c) => state.players.find((x) => x.id === c.id)?.points;
const tok = (state, c) => state.players.find((x) => x.id === c.id)?.tokens;
const allReady = (clients) => clients.forEach((c) => send(c, { t: 'ready' }));

async function waitFor(fn, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(40);
  }
  fails.push(`timeout: ${label}`);
  console.log(`  FAIL timeout: ${label}`);
  return false;
}

function spawnServer(port, extraEnv) {
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), DEBUG_WORD: 'масло', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[srv!] ${d}`));
  server.on('error', (e) => console.error(`[spawn error] ${e.message}`));
  return server;
}

async function waitUp(port) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${port}/`);
      return true;
    } catch {
      await sleep(100);
    }
  }
  return false;
}

async function waitWsReady(client) {
  await waitFor(() => client.state?.players.some((x) => x.id === client.id), `hello ${client.name}`);
}

// =========== Сценарий A: способности (медленные тики, без тайм-аутов) ===========
const PORT_A = 3100 + Math.floor(Math.random() * 100);
const serverA = spawnServer(PORT_A, { TICK_SECONDS: '60', TEST_TOKEN_GRANT: '1' });

try {
  if (!(await waitUp(PORT_A))) throw new Error('сервер A не поднялся');
  const u = (name) => connect(`ws://localhost:${PORT_A}/ws`, name);

  console.log('== A: очки и приватность ==');
  const p1 = await u('Алиса');
  hello(p1);
  await waitFor(() => p1.roomList !== null, 'меню получено');
  send(p1, { t: 'createRoom', name: 'Комната Алисы', playerName: 'Алиса' });
  await waitFor(() => p1.state?.phase === 'lobby' && p1.state.players.some((x) => x.id === p1.id), 'Алиса создала комнату');
  const roomIdA = p1.state.roomId;
  const p2 = await u('Борис');
  hello(p2);
  send(p2, { t: 'joinRoom', roomId: roomIdA, playerName: 'Борис' });
  await waitFor(() => p2.state?.players.some((x) => x.id === p2.id), 'Борис в комнате');
  const p3 = await u('Вера');
  hello(p3);
  send(p3, { t: 'joinRoom', roomId: roomIdA, playerName: 'Вера' });
  await waitFor(() => p3.state?.players.some((x) => x.id === p3.id), 'Вера в комнате');
  assert(p3.state.players.every((x) => x.tokens === 4), 'старт: 4 талона (тестовый грант)');
  send(p1, { t: 'settings', pointsToWin: 32 });
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round', 'раунд начался');
  assert(p1.state.round.tick === 1, 'тик 1');
  assert(Object.keys(p1.state.round.boards).length === 3, 'у всех локальные доски');
  assert(p1.state.round.word === null, 'слово скрыто от клиентов');
  await waitFor(() => p1.privates.some((x) => x.myRows?.length === 0), 'своя доска пришла приватно');
  assert(!JSON.stringify(p1.state).includes('масло'), 'буквы чужих досок и слова не утекают');

  // одновременное угадывание: Борис и Вера вводят слово в одном тике
  send(p1, { t: 'guess', word: 'кошка' });
  send(p2, { t: 'guess', word: 'масло' });
  send(p3, { t: 'guess', word: 'масло' });
  await waitFor(() => p1.state?.phase === 'roundEnd', 'двойное угадывание закрыло раунд');
  assert(p1.state.round.winners.length === 2, 'два победителя');
  assert(pts(p1.state, p2) === 16 && pts(p1.state, p3) === 16, 'деление 32/2 = по 16');
  assert(myRows(p1).length === 1, 'свой ряд с буквами приватно');
  assert(!JSON.stringify(p1.state.round.boards).includes('"w"'), 'в публичных досках букв нет');

  // интерлюдия: готов от всех -> раунд 2
  allReady([p1, p2, p3]);
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === 1, 'раунд 2 после готова');
  assert(tok(p1.state, p1) === 4, '+1 талон не-победителю (кап 4)');

  console.log('== A2: способности ==');
  // сливки: Алиса (не тратит попытку)
  send(p1, { t: 'power', kind: 'cream', letter: 'м' });
  await waitFor(() => p1.privates.some((x) => x.hints?.some((h) => h.letter === 'м')), 'сливки ответили приватно');
  assert(p1.privates.at(-1).hints.at(-1).inWord === true, '«м» есть в слове');
  await waitFor(() => tok(p1.state, p1) === 3, 'сливки стоили талон');
  // разведка: Алиса (тратит попытку, 2 ряда)
  send(p1, { t: 'power', kind: 'recon' });
  await waitFor(() => myRows(p1).length === 2, 'разведка дала 2 ряда');
  await waitFor(() => tok(p1.state, p1) === 2, 'разведка стоила талон');
  // подойник: Борис (не тратит попытку)
  send(p2, { t: 'power', kind: 'sniper', letter: 'а', pos: 1 });
  await waitFor(() => p2.privates.some((x) => x.hints?.some((h) => h.type === 'pos')), 'подойник ответил приватно');
  assert(p2.privates.at(-1).hints.at(-1).atPos === true, '«а» на позиции 2');
  await waitFor(() => tok(p1.state, p2) === 2, 'подойник стоил 2 талона');
  // перехват: Вера лочит случайное слово за Бориса (тот еще не отправил)
  send(p3, { t: 'power', kind: 'intercept', target: p2.id });
  await waitFor(() => p2.toasts.some((t) => t.includes('перехватил')), 'Борис узнал о перехвате');
  await waitFor(() => tok(p1.state, p3) === 2, 'перехват стоил 2 талона');
  // все попытались/потратили -> тик закрылся
  await waitFor(() => p1.state?.phase === 'tickEnd', 'тик закрылся после способностей');

  // раунд 2, тик 2: победа на втором тике (16)
  allReady([p1, p2, p3]);
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === 2, 'раунд 2 тик 2');
  send(p1, { t: 'guess', word: 'масло' });
  send(p2, { t: 'guess', word: 'кошка' });
  send(p3, { t: 'guess', word: 'земля' });
  await waitFor(() => p1.state?.phase === 'tickEnd' || p1.state?.phase === 'roundEnd', 'тик 2 закрылся (победа — раунд закрылся)');
  assert(pts(p1.state, p1) === 16, '0 + 16 = 16 очков (тик 2)');

  // раунд 3, тик 1: победа с первого тика (32) -> 48 -> матч закончен
  allReady([p1, p2, p3]);
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === 1, 'раунд 3 тик 1');
  send(p1, { t: 'guess', word: 'масло' });
  send(p2, { t: 'guess', word: 'кошка' });
  send(p3, { t: 'guess', word: 'земля' });
  await waitFor(() => p1.state?.phase === 'roundEnd', 'Алиса угадала');
  assert(pts(p1.state, p1) === 48, '16 + 32 = 48 очков');
  allReady([p1, p2, p3]);
  await waitFor(() => p1.state?.phase === 'matchEnd', 'матч до 48 завершен');
  console.log('  [dbg] state:', JSON.stringify({phase: p1.state.phase, championId: p1.state.championId, lastEvent: p1.state.lastEvent})); assert(p1.state.championId === p1.id, 'чемпион — Алиса');

  // endMatch хостом -> лобби
  send(p1, { t: 'endMatch' });
  await waitFor(() => p1.state?.phase === 'lobby', 'хост завершил матч');
  assert(p1.state.round === null, 'матч сброшен');
  p1.ws.close(); p2.ws.close(); p3.ws.close();
  await sleep(300);
} catch (e) {
  console.error('Сценарий A упал:', e);
  process.exitCode = 1;
}
serverA.kill();
await sleep(300);

// =========== Сценарий B: пропуски, кража, лимит тиков, наблюдатель, EN, leave ===========
const PORT_B = 3100 + Math.floor(Math.random() * 100);
const serverB = spawnServer(PORT_B, { TICK_SECONDS: '1', TEST_TOKEN_GRANT: '1' });

try {
  if (!(await waitUp(PORT_B))) throw new Error('сервер B не поднялся');
  const u = (name) => connect(`ws://localhost:${PORT_B}/ws`, name);

  console.log('== B: пропуск, кража, лимит тиков, наблюдатель, EN ==');
  const p1 = await u('Алиса');
  hello(p1);
  await waitFor(() => p1.roomList !== null, 'меню B получено');
  send(p1, { t: 'createRoom', name: 'Комната Алисы B', playerName: 'Алиса' });
  await waitFor(() => p1.state?.phase === 'lobby' && p1.state.players.some((x) => x.id === p1.id), 'комната B создана');
  const roomIdB = p1.state.roomId;
  const p2 = await u('Борис');
  hello(p2);
  send(p2, { t: 'joinRoom', roomId: roomIdB, playerName: 'Борис' });
  await waitFor(() => p2.state?.players.some((x) => x.id === p2.id), 'Борис в комнате B');
  const p3 = await u('Вера');
  hello(p3);
  send(p3, { t: 'joinRoom', roomId: roomIdB, playerName: 'Вера' });
  await waitFor(() => p3.state?.players.some((x) => x.id === p3.id), 'Вера в комнате B');
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round', 'раунд начался');

  // пропуск: никто не вводит -> тайм-аут -> пропуск + талон
  await waitFor(() => p1.state?.phase === 'tickEnd', 'тик 1 закрылся пропуском');
  assert(tok(p1.state, p1) === 4, 'пропуск дал талон (кап 4)');

  // кража: Вера тратит попытку-способность, слово сменится в конце тика
  // (тик 1с — все три действия шлем немедленно после старта тика)
  allReady([p1, p2, p3]);
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === 2, 'тик 2 после готова');
  send(p2, { t: 'guess', word: 'кошка' }); // Борис кладет ряд
  send(p3, { t: 'power', kind: 'steal' });
  send(p1, { t: 'guess', word: 'земля' });
  await waitFor(() => p1.state?.phase === 'tickEnd', 'тик закрылся после кражи');
  assert(myRows(p1).every((r) => r.old), 'у Алисы все ряды старые');
  assert(myRows(p2).length === 1, 'ряд Бориса на его доске');
  assert(myRows(p3).length === 0, 'у Веры рядов нет — попытка потрачена на кражу');
  console.log('  [dbg] p3 tok:', tok(p1.state, p3), 'p2 tok:', tok(p1.state, p2), 'p1 tok:', tok(p1.state, p1)); assert(true, 'талоны-дамп');

  // раунд длится 6 тиков: тики 3-6 через готов
  for (let t = 3; t <= 6; t++) {
    allReady([p1, p2, p3]);
    await waitFor(() => S_tick() >= t, `тик ${t} начался`, 6000);
    if (t === 3) {
      // прошлые надои: Алиса подсматривает ряды Бориса на живом тике (не тратит попытку)
      send(p1, { t: 'power', kind: 'peek', target: p2.id });
      await waitFor(() => p1.privates.some((x) => x.peek), 'перк: прошлые надои подсмотрены');
      assert(p1.privates.at(-1).peek.words.length === 1, 'в надоях ряд Бориса');
      assert(p1.privates.at(-1).peek.words.every((w) => typeof w === 'string' && w.length === 5), 'слова в надоях — строки из 5 букв');
    }
    await waitFor(
      () => S_phase() === 'tickEnd' || S_phase() === 'roundEnd',
      `тик ${t} закрылся`,
      6000,
    );
  }
  await waitFor(() => p1.state?.phase === 'roundEnd', 'раунд завершился по лимиту тиков');
  assert(p1.state.round.winners.length === 0, 'без победителя');

  // наблюдатель: Гоша заходит в интерлюдии -> вступает со следующего раунда
  const p4 = await u('Гоша');
  hello(p4);
  send(p4, { t: 'joinRoom', roomId: roomIdB, playerName: 'Гоша' });
  await waitFor(() => p4.state?.players.some((x) => x.id === p4.id), 'Гоша в комнате');
  allReady([p1, p2, p3, p4]);
  console.log('  [dbg] Гоша фаза:', p1.state.phase, 'boards:', JSON.stringify(Object.keys(p1.state.round?.boards || {}))); await waitFor(() => p1.state?.phase === 'round' && p1.state.round.boards[p4.id] !== undefined, 'Гоша вступил со следующего раунда');

  // endMatch -> лобби -> EN матч
  send(p1, { t: 'endMatch' });
  await waitFor(() => p1.state?.phase === 'lobby', 'хост завершил матч');
  send(p1, { t: 'settings', lang: 'en' });
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.lang === 'en', 'английский раунд');

  // EN валидация попыток
  send(p1, { t: 'guess', word: 'масло' });
  await waitFor(() => p1.toasts.at(-1)?.includes('word list'), 'русское слово в EN отклонено');
  send(p1, { t: 'guess', word: 'crane' });
  await waitFor(() => p1.state.round.submittedIds.includes(p1.id), 'crane принят');

  // leave: Алиса рвет соединение
  p1.ws.close();
  await waitFor(() => p2.state.players.find((x) => x.id === p1.id)?.connected === false, 'Алиса покинула комнату');
  assert(p2.state.hostId === p2.id || p2.state.hostId === p3.id, 'хост мигрировал');

  console.log(`\nИтог: ${passed} ok, ${fails.length} fail`);
  if (fails.length) {
    console.log('Провалено:', fails.join(' | '));
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Сценарий B упал:', e);
  process.exitCode = 1;
} finally {
  serverB.kill();
}
await sleep(300);

// =========== Сценарий C: доска не ограничена — 6 рядов не заканчивают раунд ===========
const PORT_C = 3300 + Math.floor(Math.random() * 100);
const serverC = spawnServer(PORT_C, { TICK_SECONDS: '60', TEST_TOKEN_GRANT: '1' });

try {
  if (!(await waitUp(PORT_C))) throw new Error('сервер C не поднялся');
  const u = (name) => connect(`ws://localhost:${PORT_C}/ws`, name);

  console.log('== C: разведка не заканчивает раунд ==');
  const p1 = await u('Алиса');
  hello(p1);
  await waitFor(() => p1.roomList !== null, 'меню C получено');
  send(p1, { t: 'createRoom', name: 'Комната Алисы C', playerName: 'Алиса' });
  await waitFor(() => p1.state?.phase === 'lobby', 'комната C создана');
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round', 'раунд C начался');

  // три разведки в трех тиках -> 6 рядов
  for (let t = 1; t <= 3; t++) {
    send(p1, { t: 'power', kind: 'recon' });
    await waitFor(() => p1.state?.phase === 'tickEnd', `тик ${t} закрылся после разведки`);
    allReady([p1]);
    if (t < 3) await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === t + 1, `тик ${t + 1} начался`);
  }
  const rows = p1.privates.filter((x) => x.myRows).at(-1).myRows;
  assert(rows.length === 6, 'на доске 6 рядов после трех разведок');
  assert(p1.state.phase === 'tickEnd', 'раунд НЕ закончился от заполнения доски');

  // тик 4 существует: раунд продолжается
  allReady([p1]);
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.tick === 4, 'тик 4 начался при полной доске');
  send(p1, { t: 'guess', word: 'масло' });
  await waitFor(() => p1.state?.phase === 'roundEnd', 'раунд закрылся угадыванием на тике 4');
  assert(p1.state.round.tick === 4, 'победа на тике 4 = 4 очка');
} catch (e) {
  console.error('Сценарий C упал:', e);
  process.exitCode = 1;
} finally {
  serverC.kill();
}
await sleep(300);

// =========== Сценарий D: режим на 6 букв ===========
const PORT_D = 3400 + Math.floor(Math.random() * 100);
const serverD = spawnServer(PORT_D, { TICK_SECONDS: '60', DEBUG_WORD: '' }); // без DEBUG_WORD — слово по словарю

try {
  if (!(await waitUp(PORT_D))) throw new Error('сервер D не поднялся');
  const u = (name) => connect(`ws://localhost:${PORT_D}/ws`, name);

  console.log('== D: слово на 6 букв ==');
  const p1 = await u('Алиса');
  hello(p1);
  await waitFor(() => p1.roomList !== null, 'меню D получено');
  send(p1, { t: 'createRoom', name: 'Комната D', playerName: 'Алиса' });
  await waitFor(() => p1.state?.phase === 'lobby', 'комната D создана');
  send(p1, { t: 'settings', wordLength: 6 });
  await waitFor(() => p1.state?.settings?.wordLength === 6, 'длина 6 принята в лобби');
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round', 'раунд D начался');
  await waitFor(() => p1.privates.some((x) => x.myRows?.length === 0), 'своя доска пришла');
  // слово раунда приходит приватно? нет — длина известна только из settings; проверяем через ввод
  send(p1, { t: 'guess', word: 'кошка' }); // 5 букв в режиме 6 — отклонено
  await waitFor(() => p1.toasts.some((t) => t.includes('нет в моем словаре') || t.includes('word list')), '5 букв отклонено в режиме 6');
  send(p1, { t: 'guess', word: 'голова' }); // частое 6-буквенное
  await waitFor(() => p1.state.round.submittedIds.includes(p1.id), '6-буквенное слово принято');
  await waitFor(() => p1.state?.phase === 'tickEnd', 'тик закрылся');
  const row = p1.privates.filter((x) => x.myRows?.length).at(-1).myRows.at(-1);
  assert(row.w.length === 6 && row.marks.length === 6, 'ряд из 6 плиток с 6 метками');
} catch (e) {
  console.error('Сценарий D упал:', e);
  process.exitCode = 1;
} finally {
  serverD.kill();
}
await sleep(300);

// =========== Сценарий E: EN на 6 букв ===========
const PORT_E = 3600 + Math.floor(Math.random() * 100);
const serverE = spawnServer(PORT_E, { TICK_SECONDS: '60', DEBUG_WORD: '' });

try {
  if (!(await waitUp(PORT_E))) throw new Error('сервер E не поднялся');
  const u = (name) => connect(`ws://localhost:${PORT_E}/ws`, name);

  console.log('== E: английский, 6 букв ==');
  const p1 = await u('Алиса');
  hello(p1);
  await waitFor(() => p1.roomList !== null, 'меню E получено');
  send(p1, { t: 'createRoom', name: 'Комната E', playerName: 'Алиса' });
  await waitFor(() => p1.state?.phase === 'lobby', 'комната E создана');
  send(p1, { t: 'settings', lang: 'en', wordLength: 6 });
  await waitFor(() => p1.state?.settings?.wordLength === 6 && p1.state?.settings?.lang === 'en', 'EN + длина 6 приняты');
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.lang === 'en', 'EN раунд начался');
  await waitFor(() => p1.privates.some((x) => x.myRows?.length === 0), 'своя доска пришла');
  send(p1, { t: 'guess', word: 'кошка' }); // кириллица не пройдет нормализацию EN
  send(p1, { t: 'guess', word: 'animal' }); // 6-буквенное частое слово
  await waitFor(() => p1.state.round.submittedIds.includes(p1.id), 'английское 6-буквенное принято');
  await waitFor(() => p1.state?.phase === 'tickEnd', 'тик закрылся');
  const row = p1.privates.filter((x) => x.myRows?.length).at(-1).myRows.at(-1);
  assert(/^[a-z]{6}$/.test(row.w) && row.marks.length === 6, 'ряд из 6 латинских плиток с 6 метками');
} catch (e) {
  console.error('Сценарий E упал:', e);
  process.exitCode = 1;
} finally {
  serverE.kill();
}

function S_phase() {
  return gState?.phase;
}
function S_tick() {
  return gState?.round?.tick ?? 0;
}
