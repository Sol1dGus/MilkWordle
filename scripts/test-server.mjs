// Автотест всех механик: розыгрыш порядка (яйцо/курица + СМК), ротация
// старта, жетоны, усиления, приватность подсказок.
// Запуск: npm run test:server
import { spawn } from 'node:child_process';
import { evaluateGuess } from '../src/game/logic.js';
import { VALID_WORDS } from '../src/game/words.js';

const PORT = 3098;
const URL_WS = `ws://localhost:${PORT}/ws`;

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

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_WS);
    const client = { ws, name, id: `test-${name}`, state: null, toasts: [], privates: [] };
    ws.onopen = () => resolve(client);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'state') client.state = msg.state;
      if (msg.t === 'toast') client.toasts.push(msg.text);
      if (msg.t === 'private') client.privates.push(msg.data);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}
const hello = (c) => c.ws.send(JSON.stringify({ t: 'hello', id: c.id, name: c.name, avatar: null }));
const send = (c, msg) => c.ws.send(JSON.stringify({ t: msg.t, ...msg }));

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
const pts = (state, c) => state.players.find((x) => x.id === c.id);

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DEBUG_WORD: 'масло' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[srv!] ${d}`));
server.on('error', (e) => console.error(`[spawn error] ${e.message}`));

try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(100);
    try {
      await fetch(`http://localhost:${PORT}/`);
      up = true;
    } catch { /* еще не поднялся */ }
  }
  if (!up) throw new Error('сервер не поднялся');

  console.log('== Сценарий A: розыгрыш, жетоны, усиления ==');
  const p1 = await connect('Алиса');
  const p2 = await connect('Борис');
  const p3 = await connect('Вера');
  hello(p1); hello(p2); hello(p3);
  await waitFor(() => p3.state?.players.length === 3, '3 игрока в лобби');
  send(p1, { t: 'settings', pointsToWin: 3 });

  // --- старт матча ведет в розыгрыш ---
  send(p1, { t: 'start' });
  await waitFor(() => p1.state?.phase === 'draw', 'матч начался с розыгрыша');
  assert(p1.state.players.every((x) => x.tokens === 1), 'стартовый жетон у каждого');

  // --- яйцо/курица: 2 курицы + 1 яйцо -> меньшинство (Вера) выбирает первым ---
  send(p1, { t: 'drawPick', side: 'hen' });
  send(p2, { t: 'drawPick', side: 'hen' });
  send(p3, { t: 'drawPick', side: 'egg' });
  await waitFor(() => p1.state?.phase === 'pickpos', 'меньшинство выбирает позицию');
  assert(p1.state.pick.pickerId === p3.id, 'меньшинство (Вера) выбирает первой');
  assert(p1.state.pick.freePositions.length === 3, 'все 3 позиции свободны');

  send(p3, { t: 'pickPos', pos: 2 }); // Вера берет третью позицию
  await waitFor(() => p1.state?.phase === 'smk', 'СМК между Алисой и Борисом');
  assert(p1.state.smk.pool.length === 2, 'в СМК двое большинства');

  send(p1, { t: 'smkPick', sym: 'cheese' });
  send(p2, { t: 'smkPick', sym: 'milk' }); // сыр побеждает молоко
  await waitFor(() => p1.state?.phase === 'pickpos' && p1.state.pick.pickerId === p1.id, 'победитель СМК выбирает первым');
  send(p1, { t: 'pickPos', pos: 0 });
  await waitFor(() => p1.state.pick.pickerId === p2.id, 'вторым выбирает проигравший СМК');
  send(p2, { t: 'pickPos', pos: 1 });
  await waitFor(() => p1.state?.phase === 'round', 'раунд 1 начался');

  assert(p1.state.round.order.join() === [p1.id, p2.id, p3.id].join(), 'порядок из выбранных позиций');
  assert(p1.state.round.turnId === p1.id, 'раунд 1 стартует с позиции 1');
  assert(p1.state.round.starterId === p1.id, 'стартер раунда 1 = первый в порядке');
  assert(p1.state.round.nextStarters.join() === [p1.id, p2.id, p3.id].join(), 'виден порядок стартов на весь блок');
  assert(p1.state.round.word === null, 'слово скрыто от клиентов');

  // --- проверка буквы: бесплатна по ходу, приватна, тратит жетон ---
  send(p1, { t: 'power', kind: 'check', letter: 'м' });
  await waitFor(() => p1.privates.some((x) => x.hints?.length), 'приватная проверка пришла');
  assert(p1.privates[0].hints[0].letter === 'м' && p1.privates[0].hints[0].inWord === true, '«м» есть в слове (масло)');
  assert(pts(p1.state, p1).tokens === 0, 'жетон списан');
  assert(p1.state.round.turnId === p1.id, 'ход не потрачен');
  assert(!JSON.stringify(p1.state).includes('"hints"'), 'подсказки не утекают в общий стейт');

  // --- невалидные попытки ---
  send(p2, { t: 'guess', word: 'кошка' });
  await waitFor(() => p2.toasts.some((t) => t.includes('Не твоя попытка')), 'тост не-его-хода');
  send(p1, { t: 'guess', word: 'хахах' });
  await waitFor(() => p1.toasts.some((t) => t.includes('нет в моем словаре')), 'слово не из словаря отклонено');

  // --- круг 1: Алиса и Борис раскачивают, Вера забирает ---
  send(p1, { t: 'guess', word: 'кошка' });
  await waitFor(() => p1.state.round.turnId === p2.id, 'ход у Бориса');
  send(p2, { t: 'guess', word: 'мышка' });
  await waitFor(() => p1.state.round.turnId === p3.id, 'ход у Веры');
  send(p3, { t: 'guess', word: 'масло' });
  await waitFor(() => p1.state?.phase === 'roundEnd', 'Вера угадала, раунд завершен');
  assert(p1.state.round.winnerId === p3.id, 'winnerId = Вера');
  assert(pts(p1.state, p1).tokens === 1 && pts(p1.state, p2).tokens === 2, 'жетоны неугадавшим (лимит 2 у Бориса)');
  assert(pts(p1.state, p3).tokens === 1, 'победитель без жетона');

  // --- раунд 2: старт сместился на Бориса ---
  send(p1, { t: 'next' });
  await waitFor(() => p1.state?.phase === 'round' && p1.state.round.n === 2, 'раунд 2 начался');
  assert(p1.state.round.starterId === p2.id, 'раунд 2 стартует со второй позиции');
  assert(p1.state.reveals.length === 0 && p1.state.round.board.length === 0, 'поле чистое');

  // --- заморозка с явной целью: Борис замораживает Веру ---
  send(p2, { t: 'power', kind: 'freeze', target: p3.id });
  await waitFor(() => p1.state.round.turnId === p1.id, 'замороженная Вера пропущена');
  assert(pts(p1.state, p2).tokens === 1, 'заморозка стоила жетон');
  await waitFor(() => p3.toasts.some((t) => t.includes('скисло')), 'Вера получила тост о пропуске');

  // --- открыть букву: публично ---
  send(p1, { t: 'power', kind: 'reveal', pos: 0 });
  await waitFor(() => p1.state.reveals.length === 1, 'буква раскрыта публично');
  assert(p1.state.reveals[0].pos === 0 && p1.state.reveals[0].letter === 'м', 'позиция 1 = «м»');
  assert(p1.state.round.turnId === p2.id, 'раскрытие потратило ход');
  assert(pts(p1.state, p1).tokens === 0, 'открытие стоило жетон');

  // --- Борис гадает, Вера меняет слово ---
  send(p2, { t: 'guess', word: 'мышка' });
  await waitFor(() => p1.state.round.turnId === p3.id, 'ход у Веры');
  send(p3, { t: 'power', kind: 'swap' });
  await waitFor(() => p1.state.round.board[0]?.old === true, 'старые ряды помечены');
  assert(p1.state.reveals.length === 0, 'открытые буквы сброшены при смене слова');
  assert(p3.privates.every((x) => !x.whispers?.length), 'шепот Веры пуст до запроса');
  assert(pts(p1.state, p3).tokens === 0, 'смена слова стоила жетон');

  // --- шепот Зорьки: приватные кандидаты, совместимые с данными ---
  send(p1, { t: 'guess', word: 'земля' });
  await waitFor(() => p1.state.round.turnId === p2.id, 'ход у Бориса после смены слова');
  send(p2, { t: 'power', kind: 'whisper' });
  await waitFor(() => p2.privates.some((x) => x.whispers?.length), 'шепот пришел приватно');
  const whispers = p2.privates.find((x) => x.whispers)?.whispers || [];
  assert(whispers.length === 3, 'три слова-кандидата');
  assert(whispers.every((w) => VALID_WORDS.has(w)), 'кандидаты из словаря');
  const rows = p1.state.round.board.filter((r) => !r.old);
  const consistent = whispers.every((w) =>
    rows.every((row) => evaluateGuess(w, row.w).join('') === row.marks.join('')),
  );
  assert(consistent, 'кандидаты совместимы с открытыми рядами');
  assert(!JSON.stringify(p1.state).includes('whispers'), 'шепот не утекает в общий стейт');

  // --- рвем все соединения: комната сбрасывается ---
  p1.ws.close(); p2.ws.close(); p3.ws.close();
  await sleep(300);

  console.log('== Сценарий B: матч до 1 очка, чемпион, реванш ==');
  const q1 = await connect('Алиса');
  const q2 = await connect('Борис');
  hello(q1); hello(q2);
  await waitFor(() => q1.state?.players.length >= 2 && q1.state.phase === 'lobby', 'лобби после сброса');
  send(q1, { t: 'settings', pointsToWin: 1 });
  send(q1, { t: 'start' });
  await waitFor(() => q1.state?.phase === 'smk', 'два игрока — сразу СМК без яйцо-курицы');
  assert(q1.state.smk.pairs.length === 1, 'пара из двоих');

  send(q1, { t: 'smkPick', sym: 'jug' });
  send(q2, { t: 'smkPick', sym: 'jug' }); // одинаковые -> пара играет заново
  await sleep(300);
  send(q1, { t: 'smkPick', sym: 'cheese' });
  send(q2, { t: 'smkPick', sym: 'milk' });
  await waitFor(() => q1.state?.phase === 'pickpos' && q1.state.pick.pickerId === q1.id, 'Алиса выиграла СМК');
  send(q1, { t: 'pickPos', pos: 1 }); // Алиса берет вторую позицию
  await waitFor(() => q1.state.pick.pickerId === q2.id, 'Борису остается выбор');
  send(q2, { t: 'pickPos', pos: 0 });
  await waitFor(() => q1.state?.phase === 'round' && q1.state.round.n === 1, 'раунд начался');
  assert(q1.state.round.order.join() === [q2.id, q1.id].join(), 'Алиса на позиции 2');

  send(q2, { t: 'guess', word: 'масло' }); // Борис стартует с позиции 1 и угадывает
  await waitFor(() => q1.state?.phase === 'roundEnd', 'раунд завершен');
  send(q1, { t: 'ready' });
  await waitFor(() => q1.state.ready?.length === 1, 'готов засчитан');
  send(q2, { t: 'ready' });
  await waitFor(() => q1.state?.phase === 'matchEnd', 'все нажали готов — матч завершен');
  assert(q1.state.championId === q2.id, 'чемпион — Борис');
  assert(pts(q1.state, q1).tokens === 2, 'Алиса получила жетон за поражение');

  send(q2, { t: 'rematch' });
  await waitFor(() => q1.state?.phase === 'smk', 'реванш: двое — сразу СМК');
  assert(q1.state.players.every((x) => x.points === 0 && x.tokens === 1), 'очки и жетоны сброшены');

  console.log(`\nИтог: ${passed} ok, ${fails.length} fail`);
  if (fails.length) {
    console.log('Провалено:', fails.join(' | '));
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Тест упал:', e);
  process.exitCode = 1;
} finally {
  server.kill();
}
