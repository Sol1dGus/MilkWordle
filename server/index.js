import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import {
  consistentWords,
  evaluateGuess,
  isValidWord,
  normalizeWord,
  pickWord,
} from '../src/game/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const ROUND_END_DELAY = 45000; // запасной таймер: ждем «Готов» от всех, но не вечно
const TURN_SECONDS = 60; // время на ход
const DRAW_SECONDS = 30; // время на выбор яйцо/курица
const SMK_SECONDS = 20; // время на бросок в СМК
const PICK_SECONDS = 20; // время на выбор позиции
const BLOCK_ROUNDS = 3; // порядок ходов живет 3 раунда, потом новый розыгрыш
const TOKEN_CAP = 2;
const REACTIONS = new Set(['🐮', '🥛', '👏', '😏', '🔥']);
const TOKEN_COST = { reveal: 1, swap: 1, freeze: 1, whisper: 1, check: 1 };
// Сыр-Молоко-Кувшин: что кого побеждает
const SMK_BEATS = { cheese: 'milk', milk: 'jug', jug: 'cheese' };

// ---------- карьера и ачивки (живут между матчами) ----------
const CAREER_FILE = path.join(__dirname, '..', 'data', 'career.json');
const ACHIEVEMENTS = {
  smkKing: { icon: '🧀', label: 'Сырный король: выиграл 3 молочные битвы' },
  stakhanovets: { icon: '🥛', label: 'Дояр-стахановец: 5 побед подряд' },
  iceHeart: { icon: '🧊', label: 'Ледяное сердце: заморозил будущего чемпиона' },
};
let career = {};
try {
  career = JSON.parse(readFileSync(CAREER_FILE, 'utf8'));
} catch { /* нет файла — начинаем с нуля */ }

function saveCareer() {
  try {
    mkdirSync(path.dirname(CAREER_FILE), { recursive: true });
    writeFileSync(CAREER_FILE, JSON.stringify(career, null, 1));
  } catch (e) {
    console.error('career save failed:', e.message);
  }
}

function careerOf(p) {
  if (!career[p.id]) {
    career[p.id] = { name: p.name, games: 0, wins: 0, smkWins: 0, winStreak: 0, bestStreak: 0, achievements: [] };
  }
  career[p.id].name = p.name;
  return career[p.id];
}

function grantAchievement(p, key) {
  const c = careerOf(p);
  if (c.achievements.includes(key)) return;
  c.achievements.push(key);
  saveCareer();
  const a = ACHIEVEMENTS[key];
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ t: 'toast', text: `🏆 ${p.name} получает ачивку ${a.icon} — ${a.label}` }));
    }
  }
}

// ---------- HTTP: обмен OAuth-кода на токен + статика сборки ----------
const app = express();
app.use(express.json());

app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'no code' });
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.VITE_CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await r.json();
    res.json({ access_token: data.access_token });
  } catch (e) {
    console.error('token exchange failed:', e.message);
    res.status(500).json({ error: 'token exchange failed' });
  }
});

const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

// ---------- Комната (один голосовой канал = один инстанс активности) ----------
const room = {
  phase: 'lobby', // lobby | draw | pickpos | smk | round | roundEnd | matchEnd
  settings: { pointsToWin: 3, theme: 'all', teamMode: false },
  hostId: null,
  players: new Map(), // id -> {id, name, avatar, points, tokens, order, connected, team}
  round: null, // {n, word, board, order, turnIdx, winnerId}
  order: null, // текущий порядок ходов [id по позициям]
  blockStart: null, // номер раунда, с которого действует порядок
  teams: null, // {egg: [id], hen: [id]} — командный режим
  teamPoints: { egg: 0, hen: 0 },
  frozenHistory: [], // {by, target} — для ачивки «Ледяное сердце»
  draw: null, // { votes: {id: 'egg'|'hen'} }
  smk: null, // { pool: [id], picks: {id: sym}, dropOrder: [id] }
  pickQueue: null, // [id] — очередь выбора позиции
  assigned: null, // {id: pos} — выбранные позиции (0-based)
  reveals: [], // публично открытые буквы [{pos, letter, by}]
  frozenId: null, // кто пропускает следующий ход
  swapCount: 0, // сколько раз меняли слово (клиенты по нему сбрасывают личные подсказки)
  eventSeq: 0, // счетчик изменений состояния — синхронизация реплик Зорьки
  turnStartedAt: null, // когда начался текущий ход (для таймера)
  readySet: new Set(), // кто нажал «Готов» в интерлюдии раунда
  phaseTimer: null,
  phaseSeq: 0, // защита от устаревших таймеров фаз
  hints: new Map(), // id -> [{letter, inWord}] приватные проверки букв
  whispers: new Map(), // id -> [words] приватный шепот
  championId: null,
  roundEndTimer: null,
};
let joinCounter = 0;
let roundCounter = 0;

const connectedPlayers = () =>
  [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.order - b.order);

const addToken = (p) => {
  p.tokens = Math.min(TOKEN_CAP, p.tokens + 1);
};

// ---------- сериализация ----------
function serialize() {
  const r = room.round;
  const base = {
    phase: room.phase,
    settings: room.settings,
    hostId: room.hostId,
    eventSeq: room.eventSeq,
    turnSeconds: TURN_SECONDS,
    teamPoints: room.teamPoints,
    players: [...room.players.values()]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        points: p.points,
        tokens: p.tokens,
        connected: p.connected,
        team: p.team || null,
        achievements: career[p.id]?.achievements || [],
      })),
    order: room.order,
    frozenId: room.frozenId,
    reveals: room.reveals,
    swapCount: room.swapCount,
    championId: room.championId,
    championTeam: room.championTeam || null,
    round: null,
  };

  // розыгрыш: выборы скрыты, показываем только кто уже проголосовал
  if (room.phase === 'draw' && room.draw) {
    base.draw = { voted: Object.keys(room.draw.votes), seconds: DRAW_SECONDS };
  }
  if (room.phase === 'smk' && room.smk) {
    base.smk = {
      pool: room.smk.pool,
      pairs: room.smk.pairs,
      bye: room.smk.bye,
      drops: [...room.smk.dropOrder],
      seconds: SMK_SECONDS,
    };
  }
  if (room.phase === 'pickpos' && room.pickQueue) {
    const taken = new Set(Object.values(room.assigned || {}));
    const total = Object.keys(room.draw?.votes || {}).length || room.players.size;
    base.pick = {
      pickerId: room.pickQueue[0],
      freePositions: [...Array(total).keys()].filter((i) => !taken.has(i)),
      seconds: PICK_SECONDS,
    };
  }
  if (room.phase === 'roundEnd') {
    base.ready = [...room.readySet];
  }

  if (r) {
    base.round = {
      n: r.n,
      board: r.board,
      order: r.order,
      turnId: r.order[r.turnIdx] ?? null,
      winnerId: r.winnerId,
      // во время раунда слово скрыто даже от клиентов
      word: room.phase === 'round' ? null : r.word,
      starterId: r.order[(r.n - room.blockStart) % r.order.length] ?? null,
      nextStarters: nextStarters(),
      turnStartedAt: room.turnStartedAt,
    };
  }
  return base;
}

// кто будет стартовать в текущем блоке раундов (для полоски порядка)
function nextStarters() {
  if (!room.order || room.blockStart == null) return [];
  return [...Array(BLOCK_ROUNDS).keys()].map((i) => {
    const rn = room.blockStart + i;
    const round = room.round;
    if (round && rn < round.n) return null; // уже сыгранные
    return room.order[(rn - room.blockStart) % room.order.length] ?? null;
  });
}

function broadcast() {
  room.eventSeq += 1;
  let msg;
  try {
    msg = JSON.stringify({ t: 'state', state: serialize() });
  } catch (e) {
    console.error('[broadcast serialize error]', e);
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function sendTo(ws, text) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'toast', text }));
}

function sendPrivate(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'private', data }));
}

// ---------- таймеры фаз: афк-игрок не блокирует игру ----------
function clearPhaseTimer() {
  room.phaseSeq += 1;
  clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
}

function schedulePhase(seconds, fn) {
  clearPhaseTimer();
  const seq = room.phaseSeq;
  room.phaseTimer = setTimeout(() => {
    if (seq === room.phaseSeq) fn();
  }, seconds * 1000);
}

// таймер хода: время вышло — ход переходит дальше
function startTurnTimer() {
  room.turnStartedAt = Date.now();
  schedulePhase(TURN_SECONDS, () => {
    if (room.phase !== 'round' || !room.round) return;
    const skipName = room.players.get(room.round.order[room.round.turnIdx])?.name || 'кто-то';
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ t: 'toast', text: `⏰ Время вышло — ${skipName} думал слишком долго` }));
      }
    }
    advanceTurn();
    startTurnTimer();
    broadcast();
  });
}

// случайный элемент, который еще не выбрал сам
function randomPick(ids, pickedMap) {
  const candidates = ids.filter((id) => !pickedMap[id]);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------- раунды и блоки порядка ----------
function newRound() {
  roundCounter += 1;
  // наблюдатели прошлого раунда вступают в игру: дописываем их в конец очереди
  const newcomers = connectedPlayers()
    .filter((p) => !room.order.includes(p.id))
    .map((p) => p.id);
  if (room.settings.teamMode && room.teams) {
    // новичок команды — в меньшую команду
    for (const id of newcomers) {
      const p = room.players.get(id);
      const team = room.teamPoints.egg <= room.teamPoints.hen ? 'egg' : 'hen';
      p.team = team;
      room.teams[team].push(id);
    }
  }
  room.order.push(...newcomers);
  const order = [...room.order];
  room.round = {
    n: roundCounter,
    word: process.env.DEBUG_WORD || pickWord(room.settings.theme),
    board: [],
    order,
    // стартующий сдвигается каждый раунд внутри блока
    turnIdx: (roundCounter - room.blockStart) % order.length,
    winnerId: null,
  };
  room.reveals = [];
  room.frozenId = null;
  room.hints.clear();
  room.whispers.clear();
  room.phase = 'round';
  startTurnTimer();
  broadcast();
}

// нужен ли новый розыгрыш порядка перед раундом n
function needDraw(n) {
  return room.order == null || (n - room.blockStart) % BLOCK_ROUNDS === 0;
}

function startMatch() {
  clearPhaseTimer();
  for (const p of room.players.values()) {
    p.points = 0;
    p.tokens = 1; // гибрид: стартовый жетон каждому
    p.team = null;
    const c = careerOf(p);
    c.games += 1;
  }
  saveCareer();
  room.championId = null;
  room.championTeam = null;
  room.teamPoints = { egg: 0, hen: 0 };
  room.frozenHistory = [];
  room.teams = null;
  roundCounter = 0;
  room.order = null;
  startDraw();
}

function startDraw() {
  clearPhaseTimer();
  // двоим Яйцо-Курица не нужно — сразу бьются в СМК
  const ids = connectedPlayers().map((p) => p.id);
  if (ids.length <= 2) {
    startSmk(ids);
    return;
  }
  room.phase = 'draw';
  room.draw = { votes: {} };
  room.smk = null;
  room.pickQueue = null;
  room.assigned = {};
  // если кто-то задумался над яйцом — выберем за него
  schedulePhase(DRAW_SECONDS, () => {
    if (room.phase !== 'draw') return;
    for (const id of ids) {
      if (!room.draw.votes[id]) room.draw.votes[id] = Math.random() < 0.5 ? 'egg' : 'hen';
    }
    resolveDraw();
    broadcast();
  });
  broadcast();
}

function startSmk(pool) {
  clearPhaseTimer();
  room.phase = 'smk';
  room.assigned = room.assigned || {};
  room.smk = { pool: [...pool], picks: {}, dropOrder: [], pairs: [], bye: null };
  pairUp();
  broadcast();
}

// разбиваем пул на пары (перемешанно); нечетный проходит дальше без боя
function pairUp() {
  const pool = [...room.smk.pool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  room.smk.pairs = [];
  room.smk.picks = {};
  room.smk.bye = null;
  while (pool.length >= 2) room.smk.pairs.push([pool.shift(), pool.shift()]);
  if (pool.length === 1) room.smk.bye = pool[0];
  schedulePhase(SMK_SECONDS, () => {
    if (room.phase !== 'smk') return;
    const inPair = room.smk.pairs.flat();
    for (const id of inPair) {
      if (!room.smk.picks[id]) {
        const syms = Object.keys(SMK_BEATS);
        room.smk.picks[id] = syms[Math.floor(Math.random() * syms.length)];
      }
    }
    resolveSmkRound();
    broadcast();
  });
  broadcast();
}

// розыгрыш завершен: собираем порядок из выбранных позиций
function finishDraw() {
  room.order = [];
  for (const [id, pos] of Object.entries(room.assigned)) {
    room.order[pos] = id;
  }
  room.blockStart = roundCounter + 1;
  room.draw = null;
  room.smk = null;
  room.pickQueue = null;
  room.assigned = null;
  newRound();
}

function resolveDraw() {
  const ids = connectedPlayers().map((p) => p.id);
  const eggs = ids.filter((id) => room.draw.votes[id] === 'egg');
  const hens = ids.filter((id) => room.draw.votes[id] === 'hen');

  // командный режим: яйцо против курицы — команды, без разбора мест
  if (room.settings.teamMode) {
    if (Math.abs(eggs.length - hens.length) > 1) {
      startDraw(); // команды не ровные — голосуем заново
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(JSON.stringify({ t: 'toast', text: 'Команды вышли неровными — голосуем заново!' }));
      }
      return;
    }
    room.teams = { egg: eggs, hen: hens };
    for (const p of room.players.values()) {
      p.team = eggs.includes(p.id) ? 'egg' : hens.includes(p.id) ? 'hen' : null;
    }
    startSmk(ids); // парный турнир определит чередование ходов
    return;
  }

  let minority;
  let majority;
  if (eggs.length === hens.length || eggs.length === 0 || hens.length === 0) {
    minority = [];
    majority = ids;
  } else if (eggs.length < hens.length) {
    minority = eggs;
    majority = hens;
  } else {
    minority = hens;
    majority = eggs;
  }

  room.assigned = {};
  if (majority.length >= 2) {
    // меньшинство выбирает позиции первым, потом СМК за право выбора остальных
    room.pickQueue = [...minority];
    room.smk = { pool: [...majority], picks: {}, dropOrder: [], pending: true };
    room.phase = 'pickpos';
    if (minority.length === 0) {
      startSmk(majority); // ничья или все выбрали одинаково — СМК для всех
      return;
    }
    schedulePickTimer();
  } else {
    // 1-2 игрока: просто выбираем позиции по очереди
    room.pickQueue = [...minority, ...majority];
    room.phase = 'pickpos';
    schedulePickTimer();
  }
  broadcast();
}

// разбираем все пары текущего тура; ничья в паре — переигровка
function resolveSmkRound() {
  const { pairs, picks, dropOrder, bye } = room.smk;
  const next = bye ? [bye] : [];
  const losers = [];
  for (const [a, b] of pairs) {
    const sa = picks[a];
    const sb = picks[b];
    if (!sa || !sb || sa === sb) {
      next.push(a, b); // кто-то не выбрал или ничья — пара играет заново
      continue;
    }
    if (SMK_BEATS[sa] === sb) {
      next.push(a);
      losers.push(b);
    } else {
      next.push(b);
      losers.push(a);
    }
  }
  dropOrder.push(...losers);

  if (next.length === 1) {
    // чемпион СМК определен — ачивка «Сырный король»
    const champ = room.players.get(next[0]);
    if (champ) {
      const c = careerOf(champ);
      c.smkWins += 1;
      if (c.smkWins >= 3) grantAchievement(champ, 'smkKing');
      saveCareer();
    }

    if (room.settings.teamMode) {
      // команды чередуются в очереди: лучший из яйца, лучший из курицы, …
      const rank = [next[0], ...[...dropOrder].reverse()];
      const egg = rank.filter((id) => room.teams?.egg.includes(id));
      const hen = rank.filter((id) => room.teams?.hen.includes(id));
      const order = [];
      while (egg.length || hen.length) {
        if (egg.length) order.push(egg.shift());
        if (hen.length) order.push(hen.shift());
      }
      room.order = order;
      room.blockStart = roundCounter + 1;
      room.smk = null;
      newRound();
      return;
    }

    room.pickQueue = [next[0], ...[...dropOrder].reverse()];
    room.phase = 'pickpos';
    room.smk = null;
    schedulePickTimer();
  } else {
    room.smk.pool = next;
    pairUp();
  }
  broadcast();
}

// таймер на выбор позиции текущим игроком
function schedulePickTimer() {
  clearPhaseTimer();
  schedulePhase(PICK_SECONDS, () => {
    if (room.phase !== 'pickpos' || !room.pickQueue?.length) return;
    const picker = room.pickQueue[0];
    const taken = new Set(Object.values(room.assigned || {}));
    const total = Object.keys(room.draw?.votes || {}).length || room.players.size;
    const free = [...Array(total).keys()].filter((i) => !taken.has(i));
    if (free.length === 0) {
      finishDraw();
      return;
    }
    room.assigned[picker] = free[Math.floor(Math.random() * free.length)];
    room.pickQueue.shift();
    const pName = room.players.get(picker)?.name || 'кто-то';
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ t: 'toast', text: `⏰ ${pName} медлил — Зорька выбрала место за него` }));
      }
    }
    if (room.pickQueue.length === 0) {
      if (room.smk && room.smk.pending) {
        startSmk(room.smk.pool);
        return;
      }
      finishDraw();
      return;
    }
    schedulePickTimer();
    broadcast();
  });
}

function pickPositionsDone() {
  return Object.keys(room.assigned).length >= room.players.size;
}

function nextRound() {
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  const champion = [...room.players.values()].find(
    (p) => p.points >= room.settings.pointsToWin,
  );
  const championTeam = room.settings.teamMode
    ? ['egg', 'hen'].find((t) => room.teamPoints[t] >= room.settings.pointsToWin)
    : null;
  if (champion || championTeam) {
    room.phase = 'matchEnd';
    if (champion) {
      room.championId = champion.id;
      const c = careerOf(champion);
      c.wins += 1;
      saveCareer();
    }
    if (championTeam) room.championTeam = championTeam;
    // «Ледяное сердце»: заморозил того, кто стал чемпионом
    for (const f of room.frozenHistory) {
      const champId = champion ? champion.id : room.championTeam
        ? [...room.players.values()].find((p) => p.team === room.championTeam)?.id
        : null;
      if (f.target === champId) {
        const freezer = room.players.get(f.by);
        if (freezer) grantAchievement(freezer, 'iceHeart');
      }
    }
    broadcast();
    return;
  }
  const nextN = roundCounter + 1;
  if (needDraw(nextN)) {
    startDraw();
  } else {
    newRound();
  }
}

// ---------- ходы и усиления ----------
function advanceTurn() {
  const r = room.round;
  for (let i = 1; i <= r.order.length; i++) {
    const idx = (r.turnIdx + i) % r.order.length;
    const p = room.players.get(r.order[idx]);
    if (!p || !p.connected) continue;
    if (room.frozenId === p.id) {
      room.frozenId = null;
      sendToPlayer(p.id, 'Молоко скисло — пропускаешь ход 🧊');
      continue;
    }
    r.turnIdx = idx;
    startTurnTimer();
    return;
  }
}

function sendToPlayer(playerId, text) {
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.playerId === playerId) {
      client.send(JSON.stringify({ t: 'toast', text }));
    }
  }
}

function spendToken(p, kind, ws) {
  if (p.tokens < TOKEN_COST[kind]) {
    sendTo(ws, 'Жетонов нет — работай мозгами 🐮');
    return false;
  }
  p.tokens -= TOKEN_COST[kind];
  return true;
}

function handleGuess(ws, msg) {
  if (room.phase !== 'round') return;
  const r = room.round;
  const p = room.players.get(ws.playerId);
  if (!p) return;

  if (!r.order.includes(ws.playerId)) {
    sendTo(ws, 'Ты вступишь с нового розыгрыша, новичок');
    return;
  }
  if (r.order[r.turnIdx] !== ws.playerId) {
    sendTo(ws, 'Не твоя попытка, жадина');
    return;
  }
  const word = normalizeWord(msg.word);
  if (word.length !== 5 || !isValidWord(word)) {
    sendTo(ws, 'Такого слова нет в моем словаре');
    return;
  }

  const marks = evaluateGuess(word, r.word);
  r.board.push({ w: word, marks, byId: p.id, byName: p.name });

  if (word === r.word) {
    r.winnerId = p.id;
    p.points += 1;
    if (room.settings.teamMode && p.team) room.teamPoints[p.team] += 1;
    room.phase = 'roundEnd';
    clearPhaseTimer(); // таймер хода больше не тикает — ждем «Готов»
    // карьера: серия побед
    const cw = careerOf(p);
    cw.wins += 1;
    cw.winStreak += 1;
    cw.bestStreak = Math.max(cw.bestStreak, cw.winStreak);
    if (cw.winStreak >= 5) grantAchievement(p, 'stakhanovets');
    for (const other of room.players.values()) {
      if (other.id !== p.id) careerOf(other).winStreak = 0;
    }
    saveCareer();
    // жетоны неугадавшим (гибрид): победителю — нет, остальным — по жетону
    for (const other of room.players.values()) {
      if (other.id !== p.id) addToken(other);
    }
    room.readySet = new Set();
    // запасной таймер: если кто-то ушел в закат, раунд продолжится сам
    room.roundEndTimer = setTimeout(() => {
      if (room.phase === 'roundEnd') nextRound();
    }, ROUND_END_DELAY);
  } else {
    advanceTurn();
  }
}

// «Готов» в интерлюдии: когда нажали все игроки текущего раунда — следующий.
// Наблюдатели (вступают после этого слова) в готов не играют.
function handleReady(ws) {
  if (room.phase !== 'roundEnd') return;
  const p = room.players.get(ws.playerId);
  if (!p || !room.round?.order.includes(p.id)) return;
  room.readySet.add(p.id);
  const rotation = connectedPlayers().filter((x) => room.round.order.includes(x.id));
  if (rotation.every((x) => room.readySet.has(x.id))) {
    clearTimeout(room.roundEndTimer);
    room.roundEndTimer = null;
    nextRound();
  } else {
    broadcast();
  }
}

function handlePower(ws, msg) {
  const p = room.players.get(ws.playerId);
  if (!p) return;

  // 🤫 Проверка буквы: жетон, но ход не тратим и доступна в любой момент раунда
  if (msg.kind === 'check') {
    if (room.phase !== 'round') {
      sendTo(ws, 'Проверка работает только во время раунда');
      return;
    }
    const letter = normalizeWord(msg.letter);
    if (letter.length !== 1) return;
    if (!spendToken(p, 'check', ws)) return;
    const hints = room.hints.get(p.id) || [];
    hints.push({ letter, inWord: room.round.word.includes(letter) });
    room.hints.set(p.id, hints);
    sendPrivate(ws, { hints });
    broadcast();
    return;
  }

  // остальные усиления тратят ход
  if (room.phase !== 'round') return;
  const r = room.round;
  if (r.order[r.turnIdx] !== ws.playerId) {
    sendTo(ws, 'Усиления — вместо твоей попытки. Сейчас не твой ход');
    return;
  }
  if (!spendToken(p, msg.kind, ws)) return;

  if (msg.kind === 'reveal') {
    const pos = Math.min(4, Math.max(0, Number(msg.pos) || 0));
    room.reveals.push({ pos, letter: r.word[pos], by: p.name });
    advanceTurn();
  } else if (msg.kind === 'swap') {
    for (const row of r.board) row.old = true;
    room.reveals = [];
    room.hints.clear();
    room.whispers.clear();
    room.swapCount += 1;
    let fresh = pickWord(room.settings.theme);
    while (fresh === r.word) fresh = pickWord(room.settings.theme);
    r.word = fresh;
    advanceTurn();
  } else if (msg.kind === 'freeze') {
    // заморозить можно любого игрока в очереди (кроме себя)
    let target = typeof msg.target === 'string' ? msg.target : null;
    const valid =
      target &&
      target !== p.id &&
      r.order.includes(target) &&
      room.players.get(target)?.connected;
    if (!valid) {
      // цель не указана или невалидна — замораживаем следующего по очереди
      const nextIdx = (r.turnIdx + 1) % r.order.length;
      target = r.order[nextIdx];
    }
    room.frozenId = target;
    room.frozenHistory.push({ by: p.id, target });
    advanceTurn();
  } else if (msg.kind === 'whisper') {
    const exclude = new Set(r.board.filter((row) => !row.old).map((row) => row.w));
    const candidates = consistentWords(
      r.board.filter((row) => !row.old),
      room.reveals,
      exclude,
    );
    const picked = [];
    while (picked.length < 3 && candidates.length > 0) {
      picked.push(...candidates.splice(Math.floor(Math.random() * candidates.length), 1));
    }
    room.whispers.set(p.id, picked);
    sendPrivate(ws, { whispers: picked });
    advanceTurn();
  }
  broadcast();
}

// ---------- розыгрыш и выбор позиций ----------
function handleDrawPick(ws, msg) {
  if (room.phase !== 'draw') return;
  const p = room.players.get(ws.playerId);
  if (!p || !p.connected) return;
  if (msg.side !== 'egg' && msg.side !== 'hen') return;
  room.draw.votes[p.id] = msg.side;
  if (connectedPlayers().every((x) => room.draw.votes[x.id])) resolveDraw();
  broadcast();
}

function handleSmkPick(ws, msg) {
  if (room.phase !== 'smk') return;
  const p = room.players.get(ws.playerId);
  if (!p || !room.smk.pairs.flat().includes(p.id)) return;
  if (!SMK_BEATS[msg.sym]) return;
  room.smk.picks[p.id] = msg.sym;
  if (room.smk.pairs.flat().every((id) => room.smk.picks[id])) resolveSmkRound();
  broadcast();
}

function handlePickPos(ws, msg) {
  if (room.phase !== 'pickpos') return;
  const p = room.players.get(ws.playerId);
  if (!p || room.pickQueue[0] !== p.id) return;
  const pos = Number(msg.pos);
  const taken = new Set(Object.values(room.assigned || {}));
  const maxPos = Object.keys(room.draw?.votes || {}).length || room.players.size;
  if (!Number.isInteger(pos) || pos < 0 || pos >= maxPos || taken.has(pos)) {
    sendTo(ws, 'Эта позиция уже занята');
    return;
  }
  room.assigned[p.id] = pos;
  room.pickQueue.shift();

  if (room.pickQueue.length === 0) {
    if (room.smk && room.smk.pending) {
      startSmk(room.smk.pool); // меньшинство выбрало — теперь СМК за остальные места
      return;
    }
    finishDraw();
    return;
  }
  schedulePickTimer(); // у следующего игрока свои PICK_SECONDS
  broadcast();
}

function migrateHost() {
  if (room.hostId && room.players.get(room.hostId)?.connected) return;
  room.hostId = connectedPlayers()[0]?.id ?? null;
}

// все разом ушли — комната на ноль, сброс
function resetIfEmpty() {
  if (connectedPlayers().length > 0) return false;
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  clearPhaseTimer();
  room.phase = 'lobby';
  room.round = null;
  room.order = null;
  room.blockStart = null;
  room.draw = null;
  room.smk = null;
  room.pickQueue = null;
  room.assigned = null;
  room.reveals = [];
  room.frozenId = null;
  room.hints.clear();
  room.whispers.clear();
  room.championId = null;
  room.championTeam = null;
  room.teamPoints = { egg: 0, hen: 0 };
  room.teams = null;
  room.frozenHistory = [];
  for (const p of room.players.values()) {
    p.points = 0;
    p.tokens = 0;
    p.team = null;
  }
  return true;
}

// кто-то отвалился посреди розыгрыша — разаем места сами
function abortDraw() {
  room.order = connectedPlayers().map((p) => p.id);
  room.blockStart = roundCounter + 1;
  room.draw = null;
  room.smk = null;
  room.pickQueue = null;
  room.assigned = null;
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ t: 'toast', text: 'Зорька раздала места сама — кто-то сбежал' }));
  }
  newRound();
}

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'hello': {
        if (!msg.id) return;
        ws.playerId = msg.id;
        let p = room.players.get(msg.id);
        if (!p) {
          p = {
            id: msg.id,
            name: String(msg.name || 'Гость').slice(0, 24),
            avatar: msg.avatar || null,
            points: 0,
            tokens: 0,
            order: ++joinCounter,
            connected: true,
          };
          room.players.set(msg.id, p);
        } else {
          p.connected = true;
          p.name = String(msg.name || p.name).slice(0, 24);
          p.avatar = msg.avatar || p.avatar;
        }
        migrateHost();
        broadcast();
        break;
      }

      case 'settings': {
        if (
          ws.playerId === room.hostId &&
          room.phase === 'lobby'
        ) {
          let changed = false;
          if ([1, 3, 5, 10].includes(msg.pointsToWin) && msg.pointsToWin !== room.settings.pointsToWin) {
            room.settings.pointsToWin = msg.pointsToWin;
            changed = true;
          }
          if (['all', 'food', 'animals', 'home'].includes(msg.theme) && msg.theme !== room.settings.theme) {
            room.settings.theme = msg.theme;
            changed = true;
          }
          if (typeof msg.teamMode === 'boolean' && msg.teamMode !== room.settings.teamMode) {
            room.settings.teamMode = msg.teamMode;
            changed = true;
          }
          if (changed) broadcast();
        }
        break;
      }

      case 'start': {
        // запустить может любой участник — хост нужен только для настроек лобби
        if (room.phase === 'lobby' && connectedPlayers().length >= 1) startMatch();
        break;
      }

      case 'guess':
        handleGuess(ws, msg);
        broadcast();
        break;

      case 'power':
        handlePower(ws, msg);
        broadcast();
        break;

      case 'drawPick':
        handleDrawPick(ws, msg);
        break;

      case 'smkPick':
        handleSmkPick(ws, msg);
        break;

      case 'pickPos':
        handlePickPos(ws, msg);
        break;

      case 'next': {
        if (room.phase === 'roundEnd') nextRound();
        break;
      }

      case 'ready':
        handleReady(ws);
        broadcast();
        break;

      case 'rematch': {
        if (room.phase === 'matchEnd') startMatch();
        break;
      }

      case 'react': {
        const emoji = String(msg.emoji || '');
        if (!REACTIONS.has(emoji)) return;
        const from = room.players.get(ws.playerId)?.name;
        const out = JSON.stringify({ t: 'react', emoji, from });
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(out);
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const p = room.players.get(ws.playerId);
    if (p) p.connected = false;
    if (room.phase === 'round' && room.round?.order[room.round.turnIdx] === ws.playerId) {
      advanceTurn();
    }
    if (['draw', 'smk', 'pickpos'].includes(room.phase) && connectedPlayers().length > 0) {
      abortDraw();
    }
    // ушедший мог быть последним неготовым — проверяем готов-флоу заново
    if (room.phase === 'roundEnd') {
      const rotation = connectedPlayers().filter((x) => room.round?.order.includes(x.id));
      if (rotation.length > 0 && rotation.every((x) => room.readySet.has(x.id))) {
        clearTimeout(room.roundEndTimer);
        room.roundEndTimer = null;
        nextRound();
      }
    }
    migrateHost();
    resetIfEmpty();
    broadcast();
  });
});

setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`🥛 Сервер МОЛОКО на порту ${PORT}`);
  if (process.env.DEBUG_WORD) console.log(`-debug: слово раунда: ${process.env.DEBUG_WORD}`);
});
