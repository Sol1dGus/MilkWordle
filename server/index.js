import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  consistentWords,
  evaluateGuess,
  getAnswerList,
  isValidWord,
  normalizeWord,
  pickWord,
  tickValue,
  WORD_LENGTHS,
} from '../src/game/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const TICK_SECONDS = Number(process.env.TICK_SECONDS) || 30; // время на ввод слова в тике
const TICK_OPTIONS = [15, 30, 45];
const MAX_ATTEMPTS = 6; // рядов на доске у каждого
const MAX_ROUND_TICKS = 6; // раунд длится ровно 6 тиков
const TICK_END_FALLBACK = Number(process.env.TICK_END_SECONDS) || 20; // запасной таймер обдумывания
const ROUND_END_DELAY = 45000; // запасной таймер интерлюдии
const TOKEN_CAP = 4;
const TOKEN_START = 2;
const TOKEN_SKIP_BONUS = 1; // компенсация за пропуск тика по тайм-ауту
const POINT_OPTIONS = [32, 48, 64, 96];
const POWER_COST = { cream: 1, sniper: 2, recon: 1, intercept: 2, steal: 3, peek: 2 };
const REACTIONS = new Set(['🐮', '🥛', '👏', '😏', '🔥']);
const LANGS = new Set(['ru', 'en']);
const WORD_LENS = new Set(WORD_LENGTHS); // 5/6/7 букв
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
const MAX_PLAYERS = 8;

const BOT_NAMES = [
  '🤖 Бычок Борька',
  '🤖 Коза Дереза',
  '🤖 Баран Толик',
  '🤖 Хряк Степан',
  '🤖 Гусь Гаврила',
  '🤖 Пеструха ИИ',
];

const ROUND_EVENTS = [
  {
    id: 'double',
    title: '🌟 Золотой надой',
    desc: 'Очки за угадывание этого слова удваиваются (×2)!',
  },
  {
    id: 'generous',
    title: '🥛 Щедрый хлев',
    desc: 'Зорька угощает: всем игрокам +2 талона на старте раунда!',
  },
  {
    id: 'firstLetter',
    title: '🔓 Парное молоко',
    desc: 'Первая буква слова сразу раскрыта всем в приватных знаниях!',
  },
];

function emptyStats() {
  return {
    fastWins: 0,
    dirtyPowers: 0,
    spyPowers: 0,
    noTokenWins: 0,
    absentTiles: 0,
  };
}

function computeAchievements(room, p) {
  const s = p.stats || emptyStats();
  const list = [];
  const all = [...room.players.values()].filter((x) => x.connected);
  const maxDirty = Math.max(0, ...all.map((x) => x.stats?.dirtyPowers || 0));
  const maxSpy = Math.max(0, ...all.map((x) => x.stats?.spyPowers || 0));
  const maxAbsent = Math.max(0, ...all.map((x) => x.stats?.absentTiles || 0));

  if (s.fastWins >= 1) {
    list.push({ icon: '🎯', title: 'Снайпер дойки', desc: 'Угадал слово за 1–2 тика' });
  }
  if (s.dirtyPowers >= 1 && s.dirtyPowers === maxDirty) {
    list.push({ icon: '🐀', title: 'Крыса хлева', desc: `Пакостей: ${s.dirtyPowers}` });
  }
  if (s.spyPowers >= 1 && s.spyPowers === maxSpy) {
    list.push({ icon: '🕵️', title: 'Главный шпион', desc: `Разведок: ${s.spyPowers}` });
  }
  if (s.noTokenWins >= 1) {
    list.push({ icon: '🕶️', title: 'Вслепую', desc: 'Взял раунд без талонов' });
  }
  if (s.absentTiles >= 5 && s.absentTiles === maxAbsent) {
    list.push({ icon: '🪣', title: 'Водовоз', desc: `Серых плиток: ${s.absentTiles}` });
  }
  return list;
}

// ---------- HTTP: обмен OAuth-кода на токен + статика сборки ----------
const app = express();
app.use(express.json());

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

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

// ---------- комнаты ----------
const rooms = new Map(); // roomId -> room
let joinCounter = 0;

function genRoomCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (![...rooms.values()].some((r) => r.id === code)) return code;
  }
  return 'R' + Date.now().toString(36).toUpperCase().slice(-4);
}

function newRoom(name, visibility, isPrivate = false) {
  const room = {
    id: genRoomCode(),
    name: String(name || '').slice(0, 30) || 'Комната без названия',
    isPrivate: Boolean(isPrivate),
    phase: 'lobby', // lobby | round | tickEnd | roundEnd | matchEnd
    // open: противники видят буквы в мини-досках; closed: только цвета
    settings: {
      pointsToWin: 48,
      lang: 'ru',
      wordLength: 5,
      visibility: visibility === 'open' ? 'open' : 'closed',
      tickSeconds: TICK_SECONDS,
      eventsEnabled: !process.env.TEST_TOKEN_GRANT && !process.env.DEBUG_WORD,
    },
    hostId: null,
    players: new Map(), // id -> {id, name, avatar, tokens, points, order, connected, isBot, stats}
    round: null,
    eventSeq: 0,
    readySet: new Set(),
    phaseTimer: null,
    botTimers: [],
    phaseSeq: 0,
    roundEndTimer: null,
    privateHints: new Map(),
    lastEvent: null,
    championId: null,
    deleteTimer: null,
    createdAt: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

function humanPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected && !p.isBot);
}

function deleteRoomIfEmpty(room) {
  if (humanPlayers(room).length > 0) return false;
  clearPhaseTimer(room);
  clearTimeout(room.roundEndTimer);
  rooms.delete(room.id);
  broadcastRoomList();
  return true;
}

function roomOf(ws) {
  return ws.roomId ? rooms.get(ws.roomId) || null : null;
}

function serializeRoomList() {
  return [...rooms.values()]
    .filter((r) => !r.isPrivate)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({
      id: r.id,
      name: r.name,
      host: r.players.get(r.hostId)?.name || '—',
      players: [...r.players.values()].filter((p) => p.connected).length,
      phase: r.phase,
      lang: r.settings.lang,
      visibility: r.settings.visibility,
    }));
}

function broadcastRoomList() {
  const msg = JSON.stringify({ t: 'roomList', rooms: serializeRoomList() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// ---------- сериализация состояния комнаты ----------
// ВАЖНО: публичные доски уходят БЕЗ букв — противники видят только цветовой
// прогресс. Свои буквы каждый получает приватным сообщением.
function serialize(room) {
  const r = room.round;
  const tickSec = room.settings.tickSeconds || TICK_SECONDS;
  const base = {
    phase: room.phase,
    roomId: room.id,
    roomName: room.name,
    isPrivate: Boolean(room.isPrivate),
    settings: room.settings,
    hostId: room.hostId,
    eventSeq: room.eventSeq,
    tickSeconds: tickSec,
    maxAttempts: MAX_ATTEMPTS,
    lastEvent: room.lastEvent,
    championId: room.championId,
    players: [...room.players.values()]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: Boolean(p.isBot),
        difficulty: p.difficulty || 'normal',
        points: Math.round(p.points * 100) / 100,
        tokens: p.tokens,
        connected: p.connected,
        achievements: room.phase === 'matchEnd' ? computeAchievements(room, p) : [],
      })),
    round: null,
  };

  if (r) {
    const boards = {};
    // открытый режим: чужие мини-доски уходят с буквами, закрытый — только цвета
    const showLetters = room.settings.visibility === 'open';
    for (const [id, rows] of Object.entries(r.boards)) {
      boards[id] = rows.map((row) => ({ marks: row.marks, old: row.old || false, ...(showLetters ? { w: row.w } : {}) }));
    }
    const revealedWords =
      room.phase === 'roundEnd' || room.phase === 'matchEnd'
        ? Object.fromEntries(
            Object.entries(r.boards).map(([id, rows]) => [id, rows.map((row) => row.w)]),
          )
        : null;
    base.round = {
      n: r.n,
      lang: r.lang,
      tick: r.tick,
      wordLength: r.word.length,
      tickStartedAt: r.tickStartedAt,
      tickShare: r.tickShare ?? null,
      event: r.event || null,
      log: r.log || [],
      boards,
      revealedWords,
      submittedIds: Object.keys(r.submissions),
      doneIds: Object.keys(r.done),
      winners: r.winners,
      word: room.phase === 'round' ? null : r.word,
    };
  }
  if (room.phase === 'roundEnd' || room.phase === 'tickEnd') {
    base.ready = [...room.readySet];
  }
  return base;
}

function broadcast(room) {
  room.eventSeq += 1;
  let msg;
  try {
    msg = JSON.stringify({ t: 'state', state: serialize(room) });
  } catch (e) {
    console.error('[broadcast serialize error]', e);
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomId === room.id) client.send(msg);
  }
}

function sendTo(ws, text) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'toast', text }));
}

function sendPrivate(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'private', data }));
}

function sendToPlayer(room, playerId, text) {
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomId === room.id && client.playerId === playerId) {
      client.send(JSON.stringify({ t: 'toast', text }));
    }
  }
}

// приватное сообщение игроку: его доска с буквами + его подсказки
function sendMyRows(room, playerId) {
  const r = room.round;
  if (!r) return;
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomId === room.id && client.playerId === playerId) {
      sendPrivate(client, {
        myRows: r.boards[playerId] || [],
        hints: room.privateHints.get(playerId) || [],
      });
    }
  }
}

// ---------- таймеры фаз ----------
function clearBotTimers(room) {
  if (room.botTimers) {
    for (const t of room.botTimers) clearTimeout(t);
    room.botTimers = [];
  }
}

function clearPhaseTimer(room) {
  room.phaseSeq += 1;
  clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  clearBotTimers(room);
}

function schedulePhase(room, seconds, fn) {
  clearPhaseTimer(room);
  const seq = room.phaseSeq;
  room.phaseTimer = setTimeout(() => {
    if (seq === room.phaseSeq && rooms.get(room.id) === room) fn();
  }, seconds * 1000);
}

// таймер тика: не отправил — пропуск попытки + талон-компенсация
function startTickTimer(room) {
  room.round.tickStartedAt = Date.now();
  const tickSec = room.settings.tickSeconds || TICK_SECONDS;
  schedulePhase(room, tickSec, () => {
    if (room.phase !== 'round' || !room.round) return;
    for (const id of activeIds(room)) {
      if (!room.round.submissions[id]) {
        const p = room.players.get(id);
        addToken(p, TOKEN_SKIP_BONUS);
        room.lastEvent = { seq: room.eventSeq + 1, type: 'skip', by: id };
        room.round.log.push({ tick: room.round.tick, type: 'skip', by: id });
        sendToPlayer(room, id, `⏰ Время вышло — попытка пропущена, +${TOKEN_SKIP_BONUS} талон 🥛`);
      }
    }
    resolveTick(room);
  });
  scheduleBotActions(room);
}

// случайное слово из базы текущего языка и длины
function randomWord(lang, length) {
  return pickWord(lang, length);
}

// ---------- игроки комнаты ----------
function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.order - b.order);
}

// игрок, участвующий в текущем раунде (у него есть доска и он не угадал)
function roundPlayer(room, id) {
  return room.round && room.round.boards[id] && !room.round.done[id]
    ? room.players.get(id)
    : null;
}

// доска игрока заполнена — он выпадает из тиков до конца раунда
function activeIds(room) {
  return connectedPlayers(room)
    .filter((p) => roundPlayer(room, p.id))
    .map((p) => p.id);
}

const addToken = (p, n = 1) => {
  p.tokens = Math.min(TOKEN_CAP, p.tokens + n);
};

function autoReadyBots(room) {
  for (const p of connectedPlayers(room)) {
    if (p.isBot) room.readySet.add(p.id);
  }
}

function scheduleBotActions(room) {
  clearBotTimers(room);
  const r = room.round;
  if (!r || room.phase !== 'round') return;
  const tickSec = room.settings.tickSeconds || TICK_SECONDS;
  const bots = connectedPlayers(room).filter((p) => p.isBot && roundPlayer(room, p.id));

  for (const bot of bots) {
    const diff = bot.difficulty || 'normal'; // 'easy' | 'normal' | 'hard'
    const baseDelay = Math.min(2000, Math.max(350, tickSec * 220));
    const delay = baseDelay + Math.floor(Math.random() * 650);
    const timer = setTimeout(() => {
      if (room.phase !== 'round' || room.round !== r) return;
      if (r.submissions[bot.id] !== undefined || r.done[bot.id]) return;

      // ИИ-способности для Дояра (normal) и Кибер-коровы (hard)
      if (diff !== 'easy' && r.tick >= 2) {
        // Кибер-корова может перехватить ход лидера по очкам
        if (diff === 'hard' && bot.tokens >= POWER_COST.intercept && Math.random() < 0.35) {
          const rivals = connectedPlayers(room)
            .filter((p) => p.id !== bot.id && roundPlayer(room, p.id))
            .sort((a, b) => b.points - a.points);
          const leader = rivals[0];
          if (leader && (leader.points >= bot.points || (r.boards[leader.id]?.length ?? 0) >= 2)) {
            if (spendToken(bot, 'intercept', r)) {
              const w = randomWord(r.lang, r.word.length);
              r.submissions[leader.id] = { w };
              sendToPlayer(room, leader.id, `🐄 ${bot.name} перехватил твою попытку — отправлено случайное слово!`);
              r.submissions[bot.id] = { w: null };
              room.lastEvent = { seq: room.eventSeq + 1, type: 'intercept', by: bot.id, target: leader.id };
              r.log.push({ tick: r.tick, type: 'intercept', by: bot.id, target: leader.id });
              if (allSubmitted(room)) resolveTick(room);
              else broadcast(room);
              return;
            }
          }
        }

        // Разведка букв через «Первые сливки» (не тратит ход)
        const creamChance = diff === 'hard' ? 0.55 : 0.22;
        if (bot.tokens >= POWER_COST.cream && Math.random() < creamChance) {
          const hints = room.privateHints.get(bot.id) || [];
          const knownLetters = new Set([
            ...hints.map((h) => h.letter),
            ...(r.boards[bot.id] || []).flatMap((row) => [...row.w]),
          ]);
          const alphabet = r.lang === 'en' ? 'etaoinshrdlcumwfgypbvkjxqz' : 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэCфъ';
          const probe = [...alphabet].find((ch) => !knownLetters.has(ch));
          if (probe && spendToken(bot, 'cream', r)) {
            hints.push({ letter: probe, inWord: r.word.includes(probe) });
            room.privateHints.set(bot.id, hints);
            room.lastEvent = { seq: room.eventSeq + 1, type: 'cream', by: bot.id };
            r.log.push({ tick: r.tick, type: 'cream', by: bot.id });
          }
        }
      }

      const myRows = r.boards[bot.id] || [];
      const myHints = room.privateHints.get(bot.id) || [];
      const used = new Set(myRows.map((row) => row.w));
      const allAnswers = getAnswerList(r.lang, r.word.length);

      const accuracy = diff === 'hard' ? 0.96 : diff === 'easy' ? 0.35 : 0.78;
      const safeTicks = diff === 'hard' ? 1 : diff === 'easy' ? 3 : 2;

      let chosen = null;
      if (myRows.length === 0 && myHints.length === 0) {
        // Первый тик: случайное стартовое слово (не угадываем с 1-го тика вслепую)
        const pool = allAnswers.filter((w) => w !== r.word);
        chosen = (pool.length ? pool : allAnswers)[Math.floor(Math.random() * (pool.length || allAnswers.length))];
      } else {
        const candidates = consistentWords(myRows, myHints, used, r.lang, r.word.length);
        if (candidates.length > 0 && Math.random() < accuracy) {
          const nonWin = candidates.filter((w) => w !== r.word);
          const pickPool = r.tick <= safeTicks && nonWin.length > 0 ? nonWin : candidates;
          chosen = pickPool[Math.floor(Math.random() * pickPool.length)];
        } else {
          const fallback = allAnswers.filter((w) => !used.has(w) && w !== r.word);
          const pool = fallback.length ? fallback : allAnswers;
          chosen = pool[Math.floor(Math.random() * pool.length)];
        }
      }

      if (!chosen) chosen = r.word;
      r.submissions[bot.id] = { w: chosen };
      if (allSubmitted(room)) resolveTick(room);
      else broadcast(room);
    }, delay);
    room.botTimers.push(timer);
  }
}

// ---------- раунды и тики ----------
function startRound(room) {
  room.roundCounter = (room.roundCounter || 0) + 1;
  const players = connectedPlayers(room);
  const boards = {};
  for (const p of players) boards[p.id] = [];

  const word = process.env.DEBUG_WORD || pickWord(room.settings.lang, room.settings.wordLength);
  let event = null;
  if (room.settings.eventsEnabled && room.roundCounter >= 2) {
    event = ROUND_EVENTS[Math.floor(Math.random() * ROUND_EVENTS.length)];
  }

  room.privateHints.clear();
  if (event?.id === 'generous') {
    for (const p of players) addToken(p, 2);
  } else if (event?.id === 'firstLetter') {
    for (const p of players) {
      room.privateHints.set(p.id, [{ type: 'pos', letter: word[0], pos: 0, atPos: true }]);
    }
  }

  const initialLog = [];
  if (event) {
    initialLog.push({ tick: 1, type: 'roundEvent', title: event.title });
  }

  room.round = {
    n: room.roundCounter,
    word,
    lang: room.settings.lang,
    tick: 1,
    tickStartedAt: null,
    event,
    log: initialLog,
    submissions: {}, // id -> {w: слово | null = попытка потрачена на способность}
    tokensSpent: {},
    boards,
    done: {}, // id -> 'guessed'
    winners: [],
    pendingSteal: false,
  };
  if (event) {
    room.lastEvent = { seq: room.eventSeq + 1, type: 'roundEvent', eventId: event.id };
  }
  room.readySet = new Set();
  room.phase = 'round';
  startTickTimer(room);
  broadcast(room);
  for (const p of players) sendMyRows(room, p.id);
}

function startMatch(room) {
  clearPhaseTimer(room);
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  for (const p of room.players.values()) {
    p.points = 0;
    p.tokens = p.testGrant ? TOKEN_CAP : TOKEN_START;
    p.stats = emptyStats();
  }
  room.championId = null;
  room.roundCounter = 0;
  startRound(room);
}

// все активные игроки что-то отправили (слово или потраченную попытку)?
function allSubmitted(room) {
  return activeIds(room).every((id) => room.round.submissions[id] !== undefined);
}

function resolveTick(room) {
  const r = room.round;
  clearPhaseTimer(room);

  // оценка отправленных слов и дополнение локальных досок
  for (const [id, sub] of Object.entries(r.submissions)) {
    if (sub.w == null) continue; // попытка потрачена на способность
    const marks = evaluateGuess(sub.w, r.word);
    r.boards[id].push({ w: sub.w, marks });
    const p = room.players.get(id);
    if (p) {
      if (!p.stats) p.stats = emptyStats();
      p.stats.absentTiles += marks.filter((m) => m === 'absent').length;
    }
    if (sub.w === r.word) {
      r.winners.push(id);
      r.done[id] = 'guessed';
    }
  }

  // деревенская кража: полный рестарт раунда посреди игры
  if (r.pendingSteal) {
    const thief = room.players.get(r.stealBy);
    if (r.winners.length > 0) {
      // кто-то успел угадать — сброс не срабатывает, талон возвращается
      if (thief) addToken(thief, POWER_COST.steal);
      sendToPlayer(room, r.stealBy, 'Кто-то угадал раньше — кража не удалась, талон вернули 🐄');
      r.pendingSteal = false;
      r.stealBy = null;
    } else {
      // слово меняется на месте: ряды остаются, помечаются старыми
      r.word = pickWord(r.lang, room.settings.wordLength);
      for (const board of Object.values(r.boards)) {
        for (const row of board) row.old = true;
      }
      r.log.push({ tick: r.tick, type: 'stealDone', by: r.stealBy });
      r.pendingSteal = false;
      r.stealBy = null;
    }
  }

  for (const p of connectedPlayers(room)) sendMyRows(room, p.id);

  if (r.winners.length > 0) {
    // очки делятся между угадавшими один тик (с учетом события «Золотой надой»)
    const mult = r.event?.id === 'double' ? 2 : 1;
    const share = Math.round(((tickValue(r.tick) * mult) / r.winners.length) * 100) / 100;
    for (const id of r.winners) {
      const p = room.players.get(id);
      if (p) {
        p.points = Math.round((p.points + share) * 100) / 100;
        if (!p.stats) p.stats = emptyStats();
        if (r.tick <= 2) p.stats.fastWins += 1;
        if (!r.tokensSpent?.[id]) p.stats.noTokenWins += 1;
      }
    }
    r.tickShare = share;
    // талоны не-победителям (гибрид)
    for (const other of connectedPlayers(room)) {
      if (!r.winners.includes(other.id)) addToken(other, 1);
    }
    room.lastEvent = { seq: room.eventSeq + 1, type: 'win', winners: [...r.winners], pts: share, tick: r.tick };
    r.log.push({ tick: r.tick, type: 'win', winners: [...r.winners], pts: share });
    room.phase = 'roundEnd';
    room.readySet = new Set();
    autoReadyBots(room);
    room.roundEndTimer = setTimeout(() => {
      if (room.phase === 'roundEnd') nextRound(room);
    }, ROUND_END_DELAY);
    broadcast(room);
    return;
  }

  const connected = connectedPlayers(room);
  // раунд заканчивается ТОЛЬКО по лимиту тиков (угадавшие закрывают раунд раньше,
  // через ветку winners выше) — заполнение доски рядами на это не влияет
  if (r.tick >= MAX_ROUND_TICKS) {
    for (const p of connected) addToken(p, 1); // раунд без победителя — всем по талону
    room.lastEvent = { seq: room.eventSeq + 1, type: 'noWinner', word: r.word };
    room.phase = 'roundEnd';
    room.readySet = new Set();
    autoReadyBots(room);
    room.roundEndTimer = setTimeout(() => {
      if (room.phase === 'roundEnd') nextRound(room);
    }, ROUND_END_DELAY);
    broadcast(room);
    return;
  }

  // иначе — фаза обдумывания: следующий тик после «Готов» от всех
  room.phase = 'tickEnd';
  room.readySet = new Set();
  autoReadyBots(room);
  schedulePhase(room, TICK_END_FALLBACK, () => {
    if (room.phase === 'tickEnd') nextTick(room);
  });
  broadcast(room);
}

// следующий тик после обдумывания
function nextTick(room) {
  clearPhaseTimer(room);
  if (room.phase !== 'tickEnd' || !room.round) return;
  room.round.tick += 1;
  room.round.submissions = {};
  room.phase = 'round';
  startTickTimer(room);
  broadcast(room);
}

function nextRound(room) {
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  const champion = [...room.players.values()].find(
    (p) => p.points >= room.settings.pointsToWin,
  );
  if (champion) {
    room.championId = champion.id;
    room.phase = 'matchEnd';
    broadcast(room);
    return;
  }
  startRound(room);
}

// «Готов» в обдумывании и интерлюдии: когда нажали все подключенные
function handleReady(room, ws) {
  if (room.phase !== 'tickEnd' && room.phase !== 'roundEnd') return;
  const p = room.players.get(ws.playerId);
  if (!p) return;
  room.readySet.add(p.id);
  autoReadyBots(room);
  const alive = connectedPlayers(room).map((x) => x.id);
  if (alive.every((id) => room.readySet.has(id))) {
    clearTimeout(room.roundEndTimer);
    room.roundEndTimer = null;
    if (room.phase === 'tickEnd') nextTick(room);
    else nextRound(room);
  } else {
    broadcast(room);
  }
}

// ---------- попытки и способности ----------
function handleGuess(room, ws, msg) {
  if (room.phase !== 'round') return;
  const p = roundPlayer(room, ws.playerId);
  if (!p) {
    sendTo(ws, 'Ты наблюдатель — вступишь со следующего слова');
    return;
  }
  const r = room.round;
  if (r.submissions[ws.playerId] !== undefined) {
    sendTo(ws, 'В этом тике ты уже отправил слово');
    return;
  }
  const lang = r.lang;
  const word = normalizeWord(msg.word, lang, r.word.length);
  if (word.length !== r.word.length || !isValidWord(word, lang, r.word.length)) {
    sendTo(ws, lang === 'en' ? 'Not in my word list' : 'Такого слова нет в моем словаре');
    return;
  }
  r.submissions[ws.playerId] = { w: word };
  // тик закрывается, когда все отправили (победители определятся на закрытии)
  if (allSubmitted(room)) resolveTick(room);
  else broadcast(room);
}

function spendToken(p, kind, round) {
  if (p.tokens < POWER_COST[kind]) {
    return false;
  }
  p.tokens -= POWER_COST[kind];
  if (round) {
    round.tokensSpent[p.id] = (round.tokensSpent[p.id] || 0) + POWER_COST[kind];
  }
  if (!p.stats) p.stats = emptyStats();
  if (kind === 'intercept' || kind === 'steal') {
    p.stats.dirtyPowers += 1;
  } else {
    p.stats.spyPowers += 1;
  }
  return true;
}

function handlePower(room, ws, msg) {
  if (room.phase !== 'round') return;
  const kind = msg.kind;
  if (!POWER_COST[kind]) return;
  const r = room.round;
  const p = roundPlayer(room, ws.playerId);
  if (!p) {
    sendTo(ws, 'Наблюдатели без способностей 😏');
    return;
  }

  // --- способности, НЕ тратящие попытку (нельзя только угадавшим) ---
  if (kind === 'cream' || kind === 'sniper') {
    if (r.done[ws.playerId]) {
      sendTo(ws, 'Ты уже угадал — отдыхай 😏');
      return;
    }
    const letter = normalizeWord(msg.letter, r.lang);
    if (letter.length !== 1) return;
    if (!spendToken(p, kind, r)) return;
    const hints = room.privateHints.get(ws.playerId) || [];
    if (kind === 'cream') {
      hints.push({ letter, inWord: r.word.includes(letter) });
      room.lastEvent = { seq: room.eventSeq + 1, type: 'cream', by: ws.playerId };
      r.log.push({ tick: r.tick, type: 'cream', by: ws.playerId });
    } else {
      const pos = Math.min(r.word.length - 1, Math.max(0, Number(msg.pos) || 0));
      hints.push({ type: 'pos', letter, pos, atPos: r.word[pos] === letter });
      room.lastEvent = { seq: room.eventSeq + 1, type: 'sniper', by: ws.playerId };
      r.log.push({ tick: r.tick, type: 'sniper', by: ws.playerId });
    }
    room.privateHints.set(ws.playerId, hints);
    sendMyRows(room, ws.playerId);
    broadcast(room);
    return;
  }

  // --- прошлые надои: подсмотреть написанные слова цели, порядок перемешан ---
  if (kind === 'peek') {
    if (r.done[ws.playerId]) {
      sendTo(ws, 'Ты уже угадал — отдыхай 😏');
      return;
    }
    const candidates = Object.keys(r.boards).filter(
      (id) => id !== ws.playerId && (r.boards[id]?.length ?? 0) > 0,
    );
    if (candidates.length === 0) {
      sendTo(ws, 'Никто еще ничего не наливал — смотреть нечего');
      return;
    }
    const target = candidates.includes(msg.target)
      ? msg.target
      : candidates[Math.floor(Math.random() * candidates.length)];
    if (!spendToken(p, kind, r)) return;
    const words = r.boards[target].map((row) => row.w);
    // перемешиваем: сопоставлять с плитками придется самому
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    sendPrivate(ws, { peek: { target, words } });
    sendTo(ws, `🕵️ Подсмотрел прошлые надои ${room.players.get(target)?.name ?? 'кого-то'} — но порядок перемешан!`);
    room.lastEvent = { seq: room.eventSeq + 1, type: 'peek', by: ws.playerId };
    r.log.push({ tick: r.tick, type: 'peek', by: ws.playerId, target });
    broadcast(room); // талоны обновились у всех
    return;
  }

  // --- способности ЗА попытку: только если еще не отправил в этом тике ---
  if (r.submissions[ws.playerId] !== undefined) {
    sendTo(ws, 'Ты уже отправил слово в этом тике');
    return;
  }
  if (!spendToken(p, kind, r)) return;

  if (kind === 'recon') {
    // сексуальная разведка: 2 случайных слова на свою доску (доска не ограничена)
    for (let i = 0; i < 2; i++) {
      const w = randomWord(r.lang, r.word.length);
      const marks = evaluateGuess(w, r.word);
      r.boards[ws.playerId].push({ w, marks });
      if (w === r.word) {
        r.winners.push(ws.playerId); // разведка может случайно угадать!
        r.done[ws.playerId] = 'guessed';
      }
    }
    r.submissions[ws.playerId] = { w: null };
    room.lastEvent = { seq: room.eventSeq + 1, type: 'recon', by: ws.playerId };
    r.log.push({ tick: r.tick, type: 'recon', by: ws.playerId });
    sendMyRows(room, ws.playerId);
  } else if (kind === 'intercept') {
    // белковый перехват: подменяем слово цели в этом тике
    const target = roundPlayer(room, msg.target);
    if (!target || target.id === ws.playerId) {
      p.tokens += POWER_COST[kind]; // возврат
      p.stats.dirtyPowers = Math.max(0, (p.stats.dirtyPowers || 1) - 1);
      sendTo(ws, 'Цель недоступна — талон вернули');
      broadcast(room);
      return;
    }
    const w = randomWord(r.lang, r.word.length);
    if (r.submissions[target.id] !== undefined && r.submissions[target.id].w != null) {
      r.submissions[target.id] = { w }; // подмена уже написанного
    } else if (r.submissions[target.id] === undefined) {
      r.submissions[target.id] = { w }; // лочим случайное за цель
    }
    sendToPlayer(room, target.id, `🐄 ${p.name} перехватил твою попытку — отправлено случайное слово!`);
    r.submissions[ws.playerId] = { w: null };
    room.lastEvent = { seq: room.eventSeq + 1, type: 'intercept', by: ws.playerId, target: target.id };
    r.log.push({ tick: r.tick, type: 'intercept', by: ws.playerId, target: target.id });
  } else if (kind === 'steal') {
    // деревенская кража: раунд перезапустится в конце тика (см. resolveTick)
    r.pendingSteal = true;
    r.stealBy = ws.playerId;
    r.submissions[ws.playerId] = { w: null };
    room.lastEvent = { seq: room.eventSeq + 1, type: 'steal', by: ws.playerId };
    r.log.push({ tick: r.tick, type: 'steal', by: ws.playerId });
  }

  if (allSubmitted(room)) resolveTick(room);
  else broadcast(room);
}

function migrateHost(room) {
  const currentHost = room.hostId ? room.players.get(room.hostId) : null;
  if (currentHost && currentHost.connected && !currentHost.isBot) return;
  room.hostId = humanPlayers(room)[0]?.id ?? null;
}

// хост завершает матч: все возвращаются в лобби с чистого листа
function endMatch(room) {
  clearPhaseTimer(room);
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  room.phase = 'lobby';
  room.round = null;
  room.privateHints.clear();
  room.championId = null;
  for (const p of room.players.values()) {
    p.points = 0;
    p.stats = emptyStats();
  }
}

function resetIfEmpty(room) {
  if (humanPlayers(room).length > 0) return false;
  clearPhaseTimer(room);
  clearTimeout(room.roundEndTimer);
  room.roundEndTimer = null;
  room.phase = 'lobby';
  room.round = null;
  room.championId = null;
  // комната дышит еще минуту: вдруг кто-то обновит страницу и вернется.
  // вешаем на deleteTimer — hello при переподключении его снимает
  clearTimeout(room.deleteTimer);
  room.deleteTimer = setTimeout(() => {
    if (humanPlayers(room).length === 0) {
      rooms.delete(room.id);
      broadcastRoomList();
    }
  }, 60000);
  for (const p of room.players.values()) {
    p.points = 0;
    p.tokens = 0;
  }
  return true;
}

// игрок покинул комнату (вернулся в меню) — запись удаляется
function leaveRoom(ws) {
  const room = roomOf(ws);
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (p) room.players.delete(ws.playerId);
  if (room.phase === 'round' && room.round?.submissions[ws.playerId] !== undefined) {
    delete room.round.submissions[ws.playerId];
    if (allSubmitted(room)) resolveTick(room);
  }
  if (room.phase === 'tickEnd' || room.phase === 'roundEnd') {
    autoReadyBots(room);
    const alive = connectedPlayers(room).map((x) => x.id);
    if (alive.length > 0 && alive.every((id) => room.readySet.has(id))) {
      clearTimeout(room.roundEndTimer);
      room.roundEndTimer = null;
      if (room.phase === 'tickEnd') nextTick(room);
      else nextRound(room);
    }
  }
  migrateHost(room);
  ws.roomId = null;
  resetIfEmpty(room);
  broadcastRoomList();
  broadcast(room);
}

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomId = null;
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
        // автопереподключение: если игрок уже был в комнате — возвращаем
        let rejoined = null;
        for (const room of rooms.values()) {
          const p = room.players.get(msg.id);
          if (p) {
            p.connected = true;
            p.name = String(msg.name || p.name).slice(0, 24);
            p.avatar = msg.avatar || p.avatar;
            rejoined = room;
            break;
          }
        }
        if (rejoined) {
          clearTimeout(rejoined.deleteTimer);
          rejoined.deleteTimer = null;
          ws.roomId = rejoined.id;
          migrateHost(rejoined);
        }
        // тестовый грант: полный кошелек сразу (для автотестов способностей)
        if (process.env.TEST_TOKEN_GRANT && rejoined) {
          const p = rejoined.players.get(msg.id);
          if (p) {
            p.tokens = TOKEN_CAP;
            p.testGrant = true;
          }
        }
        sendPrivate(ws, { rejoined: rejoined ? rejoined.id : null });
        ws.send(JSON.stringify({ t: 'roomList', rooms: serializeRoomList() }));
        if (rejoined) {
          broadcast(rejoined);
          if (rejoined.round) sendMyRows(rejoined, msg.id);
        }
        break;
      }

      case 'roomList': {
        ws.send(JSON.stringify({ t: 'roomList', rooms: serializeRoomList() }));
        break;
      }

      case 'createRoom': {
        if (ws.roomId) break; // уже в комнате
        const room = newRoom(String(msg.name || '').slice(0, 30), msg.visibility, msg.isPrivate);
        ws.roomId = room.id;
        const pid = ws.playerId;
        room.players.set(pid, {
          id: pid,
          name: String(msg.playerName || 'Гость').slice(0, 24),
          avatar: msg.avatar || null,
          points: 0,
          tokens: process.env.TEST_TOKEN_GRANT ? TOKEN_CAP : TOKEN_START,
          order: ++joinCounter,
          connected: true,
          isBot: false,
          stats: emptyStats(),
          testGrant: Boolean(process.env.TEST_TOKEN_GRANT),
        });
        room.hostId = pid;
        broadcastRoomList();
        broadcast(room);
        break;
      }

      case 'joinRoom': {
        if (ws.roomId) break;
        const room = rooms.get(String(msg.roomId || '').trim().toUpperCase());
        if (!room) {
          sendTo(ws, 'Комната не найдена 🐮');
          break;
        }
        if (connectedPlayers(room).length >= MAX_PLAYERS) {
          sendTo(ws, 'В комнате уже восемь дояров — тесно!');
          break;
        }
        ws.roomId = room.id;
        const pid = ws.playerId;
        let p = room.players.get(pid);
        if (!p) {
          p = {
            id: pid,
            name: String(msg.playerName || 'Гость').slice(0, 24),
            avatar: msg.avatar || null,
            points: 0,
            tokens: process.env.TEST_TOKEN_GRANT ? TOKEN_CAP : TOKEN_START,
            order: ++joinCounter,
            connected: true,
            isBot: false,
            stats: emptyStats(),
            testGrant: Boolean(process.env.TEST_TOKEN_GRANT),
          };
          room.players.set(pid, p);
        } else {
          p.connected = true;
        }
        migrateHost(room);
        broadcastRoomList();
        broadcast(room);
        break;
      }

      case 'addBot': {
        const room = roomOf(ws);
        if (!room || room.phase !== 'lobby' || ws.playerId !== room.hostId) break;
        if (connectedPlayers(room).length >= MAX_PLAYERS) {
          sendTo(ws, 'В хлеву максимум 8 мест!');
          break;
        }
        const existingNames = new Set([...room.players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !existingNames.has(n)) || `🤖 Бот #${room.players.size + 1}`;
        const botId = `bot-${ ++joinCounter }-${Math.random().toString(36).slice(2, 6)}`;
        const diff = ['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal';
        room.players.set(botId, {
          id: botId,
          name,
          avatar: null,
          points: 0,
          tokens: TOKEN_START,
          order: joinCounter,
          connected: true,
          isBot: true,
          difficulty: diff,
          stats: emptyStats(),
          testGrant: false,
        });
        broadcastRoomList();
        broadcast(room);
        break;
      }

      case 'setBotDifficulty': {
        const room = roomOf(ws);
        if (!room || room.phase !== 'lobby' || ws.playerId !== room.hostId) break;
        const target = room.players.get(msg.botId);
        if (target && target.isBot && ['easy', 'normal', 'hard'].includes(msg.difficulty)) {
          target.difficulty = msg.difficulty;
          broadcast(room);
        }
        break;
      }

      case 'removeBot': {
        const room = roomOf(ws);
        if (!room || room.phase !== 'lobby' || ws.playerId !== room.hostId) break;
        const target = room.players.get(msg.botId);
        if (target && target.isBot) {
          room.players.delete(msg.botId);
          broadcastRoomList();
          broadcast(room);
        }
        break;
      }

      case 'leaveRoom': {
        leaveRoom(ws);
        break;
      }

      case 'deleteRoom': {
        const room = roomOf(ws);
        if (!room) break;
        if (ws.playerId !== room.hostId) {
          sendTo(ws, 'Удалить комнату может только хост 🐄');
          break;
        }
        // распускаем: всем игрокам назад в меню
        clearPhaseTimer(room);
        clearTimeout(room.roundEndTimer);
        clearTimeout(room.deleteTimer);
        rooms.delete(room.id);
        for (const client of wss.clients) {
          if (client.readyState !== 1 || client.roomId !== room.id) continue;
          client.roomId = null;
          client.send(JSON.stringify({ t: 'toast', text: 'Хост распустил комнату 🐄' }));
          // пустое состояние возвращает клиент в меню
          client.send(JSON.stringify({ t: 'state', state: { phase: 'lobby', roomId: null, settings: {}, players: [], round: null } }));
        }
        broadcastRoomList();
        break;
      }

      case 'settings': {
        const room = roomOf(ws);
        if (room && ws.playerId === room.hostId && room.phase === 'lobby') {
          let changed = false;
          if (POINT_OPTIONS.includes(msg.pointsToWin) && msg.pointsToWin !== room.settings.pointsToWin) {
            room.settings.pointsToWin = msg.pointsToWin;
            changed = true;
          }
          if (LANGS.has(msg.lang) && msg.lang !== room.settings.lang) {
            room.settings.lang = msg.lang;
            changed = true;
          }
          if (WORD_LENS.has(msg.wordLength) && msg.wordLength !== room.settings.wordLength) {
            room.settings.wordLength = msg.wordLength;
            changed = true;
          }
          if ((msg.visibility === 'open' || msg.visibility === 'closed') && msg.visibility !== room.settings.visibility) {
            room.settings.visibility = msg.visibility;
            changed = true;
          }
          if (TICK_OPTIONS.includes(msg.tickSeconds) && msg.tickSeconds !== room.settings.tickSeconds) {
            room.settings.tickSeconds = msg.tickSeconds;
            changed = true;
          }
          if (typeof msg.eventsEnabled === 'boolean' && msg.eventsEnabled !== room.settings.eventsEnabled) {
            room.settings.eventsEnabled = msg.eventsEnabled;
            changed = true;
          }
          if (changed) {
            broadcastRoomList();
            broadcast(room);
          }
        }
        break;
      }

      case 'start': {
        const room = roomOf(ws);
        if (!room || room.phase !== 'lobby' || connectedPlayers(room).length < 1) break;
        if (ws.playerId !== room.hostId) {
          sendTo(ws, 'Начать матч может только хост 🐄');
          break;
        }
        startMatch(room);
        break;
      }

      case 'rematch': {
        const room = roomOf(ws);
        if (!room || room.phase !== 'matchEnd') break;
        if (ws.playerId !== room.hostId) {
          sendTo(ws, 'Реванш объявляет только хост 🐄');
          break;
        }
        endMatch(room);
        startMatch(room);
        break;
      }

      case 'guess':
      case 'power': {
        const room = roomOf(ws);
        if (!room) break;
        if (msg.t === 'guess') handleGuess(room, ws, msg);
        else handlePower(room, ws, msg);
        break;
      }

      case 'ready': {
        const room = roomOf(ws);
        if (room) handleReady(room, ws);
        break;
      }

      case 'endMatch': {
        const room = roomOf(ws);
        if (
          room &&
          ws.playerId === room.hostId &&
          ['round', 'roundEnd', 'matchEnd'].includes(room.phase)
        ) {
          endMatch(room);
          broadcast(room);
          for (const client of wss.clients) {
            if (client.readyState === 1 && client.roomId === room.id) {
              client.send(JSON.stringify({ t: 'toast', text: 'Хост завершил матч — все в лобби 🐮' }));
            }
          }
        }
        break;
      }

      case 'react': {
        const room = roomOf(ws);
        if (!room) break;
        const emoji = String(msg.emoji || '');
        if (!REACTIONS.has(emoji)) return;
        const from = room.players.get(ws.playerId)?.name;
        const out = JSON.stringify({ t: 'react', emoji, from });
        for (const client of wss.clients) {
          if (client.readyState === 1 && client.roomId === room.id) client.send(out);
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const room = roomOf(ws);
    if (!room) return;
    const p = room.players.get(ws.playerId);
    if (p) p.connected = false;
    // ушедший мог быть последним неготовым — проверяем готов-флоу заново
    if (room.phase === 'tickEnd' || room.phase === 'roundEnd') {
      autoReadyBots(room);
      const alive = connectedPlayers(room).map((x) => x.id);
      if (alive.length > 0 && alive.every((id) => room.readySet.has(id))) {
        clearTimeout(room.roundEndTimer);
        room.roundEndTimer = null;
        if (room.phase === 'tickEnd') nextTick(room);
        else nextRound(room);
      }
    }
    if (room.phase === 'round' && room.round?.submissions[ws.playerId] !== undefined) {
      delete room.round.submissions[ws.playerId];
      if (allSubmitted(room)) resolveTick(room);
    }
    migrateHost(room);
    broadcast(room);
    // последний ушел — комната дышит еще минуту на случай переподключения
    resetIfEmpty(room);
    broadcastRoomList();
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
  console.log(`🥛 Сервер МОЛОКО 2.0 на порту ${PORT} — комнат: ${rooms.size}`);
  if (process.env.DEBUG_WORD) console.log(`-debug: слово раунда: ${process.env.DEBUG_WORD}`);
});
