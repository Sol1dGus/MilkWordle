import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParty } from '../discord/useParty.js';
import { usePhysicalInput } from '../hooks/usePhysicalInput.js';
import Cow from './Cow.jsx';
import Keyboard from './Keyboard.jsx';
import Toast from './Toast.jsx';
import { Tile } from './Board.jsx';
import { line } from '../game/lines.js';
import { sfx } from '../game/sfx.js';
import { keyboardMarks, LANGS, normalizeWord } from '../game/logic.js';

const MARK_EMOJI = { correct: '🟫', present: '🟨', absent: '⬜' };
const POINT_OPTIONS = [32, 48, 64, 96];
const TICK_OPTIONS = [
  { sec: 15, label: '15с' },
  { sec: 30, label: '30с' },
  { sec: 45, label: '45с' },
];
const BOT_DIFFS = {
  easy: { next: 'normal', label: '🌱 Телёнок', icon: '🌱', title: 'Лёгкий ИИ: часто ошибается, не тратит талоны (нажми для смены)' },
  normal: { next: 'hard', label: '🥛 Дояр', icon: '🥛', title: 'Средний ИИ: сужает словарь, иногда берёт сливки (нажми для смены)' },
  hard: { next: 'easy', label: '🔥 Кибер-корова', icon: '🔥', title: 'Сложный ИИ: почти не ошибается и кидает перехваты в лидера! (нажми для смены)' },
};

const fmtPts = (x) => (Number.isFinite(Number(x)) ? String(Math.round(Number(x) * 100) / 100) : '—');

// текст результата для буфера обмена: своя доска эмодзи + заголовок
function buildResultText(state, myRows) {
  const r = state.round;
  if (!r) return '';
  const winners = r.winners.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean);
  const lines = [`🥛 МОЛОКО — ${r.word?.toUpperCase()} (тик ${r.tick})`];
  lines.push(winners.length ? `🏆 ${winners.join(' + ')}` : '😐 никто не угадал');
  for (const row of myRows) {
    lines.push([...row.marks].map((m) => MARK_EMOJI[m]).join(''));
  }
  return lines.join('\n');
}

async function copyResult(text, pushToast) {
  try {
    await navigator.clipboard.writeText(text);
    pushToast('Скопировано — кидай в чат!');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      pushToast('Скопировано — кидай в чат!');
    } catch {
      pushToast('Не вышло скопировать 😿');
    }
    ta.remove();
  }
}

function Avatar({ player, size = 34 }) {
  return player?.avatar ? (
    <img className="avatar" src={player.avatar} alt="" width={size} height={size} />
  ) : (
    <span className="avatar cow-fallback" style={{ width: size, height: size }} aria-hidden>
      {player?.isBot ? '🤖' : '🐮'}
    </span>
  );
}

// мини-доска противника: в закрытом режиме только цвета, в открытом или в конце раунда — буквы
function MiniBoard({ marks, maxRows, cols, lettered, revealedWords }) {
  return (
    <div className="mini-board">
      {Array.from({ length: maxRows }).map((_, ri) => (
        <div className="mini-row" key={ri}>
          {Array.from({ length: cols }).map((_, ci) => {
            const row = marks[ri];
            const m = row ? row.marks[ci] : null;
            const ch = (lettered && row?.w ? row.w[ci] : '') || (revealedWords?.[ri]?.[ci] ?? '');
            return (
              <span key={ci} className={`mini-tile ${m ? `s-${m}` : ''} ${row?.old ? 'old' : ''}`}>
                {ch}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// левая колонка: все игроки (включая себя), отсортированные по очкам
function PlayerList({ state, meId, myRows, maxAttempts, wordLen }) {
  const r = state.round;
  const lettered = state.settings.visibility === 'open';
  const sortedPlayers = [...state.players]
    .filter((p) => p.connected)
    .sort((a, b) => b.points - a.points);
  const topPts = sortedPlayers[0]?.points ?? 0;

  return (
    <div className="player-list">
      {sortedPlayers.map((p, idx) => {
        const isMe = p.id === meId;
        const rows = isMe && myRows?.length ? myRows : r?.boards[p.id] || [];
        const revealed = r?.revealedWords?.[p.id] || null;
        const isSpec = r && !r.boards[p.id];
        const submitted = r?.submittedIds.includes(p.id);
        const done = r?.doneIds.includes(p.id);
        const won = r?.winners.includes(p.id);
        const isLeader = topPts > 0 && p.points === topPts;
        const status = won
          ? '🏆'
          : done
            ? '—'
            : isSpec
              ? '👀'
              : submitted
                ? '✓'
                : '…';
        const botDiff = p.isBot ? BOT_DIFFS[p.difficulty || 'normal'] : null;
        return (
          <div
            key={p.id}
            className={`player-card ${isMe ? 'me' : ''} ${isLeader ? 'leader' : ''}`}
          >
            <div className="player-head">
              <span className={`player-rank ${idx === 0 && topPts > 0 ? 'first' : ''}`}>
                #{idx + 1}
              </span>
              <Avatar player={p} size={24} />
              <span className="player-name" title={p.name}>
                {botDiff ? `${botDiff.icon} ` : ''}
                {p.name}
              </span>
              {isMe && <span className="me-tag">ты</span>}
              <span className="player-status">{status}</span>
              <span className="chip-tokens">🪙{p.tokens}</span>
            </div>
            {!isSpec && (
              <MiniBoard
                marks={rows}
                maxRows={Math.max(rows.length, maxAttempts)}
                cols={wordLen}
                lettered={lettered || isMe}
                revealedWords={revealed}
              />
            )}
            <div className="player-foot">
              <span className="player-pts">
                {isLeader ? '👑 ' : ''}
                {fmtPts(p.points)} очк.
              </span>
              {isMe && <span className="player-place-label">{idx + 1}-е место</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TickTimer({ startedAt, seconds, soundActive = false }) {
  const [, force] = useState(0);
  const lastBeepRef = useRef(null);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  const left = startedAt ? Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000)) : 0;
  useEffect(() => {
    if (!startedAt || !soundActive) return;
    if (left >= 1 && left <= 5 && lastBeepRef.current !== left) {
      lastBeepRef.current = left;
      sfx.tick(left <= 2);
    }
  }, [left, startedAt, soundActive]);
  if (!startedAt) return null;
  return <span className={`turn-timer ${left <= 10 ? 'urgent' : ''}`}>⏱ {left}с</span>;
}

function formatLogItem(item, nameOf) {
  switch (item.type) {
    case 'roundEvent':
      return { icon: '🎲', text: `Событие: ${item.title}` };
    case 'cream':
      return { icon: '🥛', text: `${nameOf(item.by)} проверил букву («Первые сливки»)` };
    case 'sniper':
      return { icon: '🎯', text: `${nameOf(item.by)} пробил позицию («Подойник»)` };
    case 'peek':
      return { icon: '🕵️', text: `${nameOf(item.by)} подсмотрел слова ${nameOf(item.target)}` };
    case 'recon':
      return { icon: '👀', text: `${nameOf(item.by)} залил 2 слова («Разведка»)` };
    case 'intercept':
      return { icon: '🐄', text: `${nameOf(item.by)} перехватил ход ${nameOf(item.target)}!`, dirty: true };
    case 'steal':
      return { icon: '🕵️', text: `${nameOf(item.by)} затеял Деревенскую кражу!`, dirty: true };
    case 'stealDone':
      return { icon: '🔄', text: `Слово раунда сменилось по краже ${nameOf(item.by)}!`, dirty: true };
    case 'skip':
      return { icon: '⏰', text: `${nameOf(item.by)} проспал тик (+1 талон)` };
    case 'win':
      return { icon: '🏆', text: `${(item.winners || []).map(nameOf).join(', ')} угадал (+${fmtPts(item.pts)} очк.)` };
    default:
      return { icon: '🥛', text: 'Движение в хлеву' };
  }
}

// правая колонка: приватные знания + лента событий раунда
function HintCards({ privateData, roundLog = [], nameOf }) {
  const hints = privateData.hints || [];
  const peeks = privateData.peeks || [];
  if (!hints.length && !peeks.length && !roundLog.length) return null;
  return (
    <aside className="hints-col">
      <div className="hints-list">
        {(hints.length > 0 || peeks.length > 0) && (
          <>
            <div className="hints-title">Приватные знания ({hints.length + peeks.length})</div>
            {hints.map((h, i) =>
              h.type === 'pos' ? (
                <div key={`p${i}`} className={`hint-card ${h.atPos ? 'sniper-hit' : 'sniper-miss'}`}>
                  <span className="hint-card-head">🎯 Снайперский подойник</span>
                  <span className="hint-card-body">
                    Позиция {h.pos + 1} — <b>{h.letter.toUpperCase()}</b> {h.atPos ? '— точное попадание ✓' : '— мимо этой позиции'}
                  </span>
                </div>
              ) : (
                <div key={`c${i}`} className="hint-card">
                  <span className="hint-card-head">🥛 Первые сливки</span>
                  <span className="hint-card-body">
                    Буква <b>{h.letter.toUpperCase()}</b> — {h.inWord ? 'есть в слове' : 'нет в слове'}
                  </span>
                </div>
              ),
            )}
            {peeks.map((pk, i) => (
              <div key={`k${i}`} className="hint-card peek-card">
                <span className="hint-card-head">🕵️ Прошлые надои — {nameOf(pk.target)}</span>
                <span className="hint-card-body">Порядок перемешан:</span>
                <span className="peek-words">
                  {pk.words.map((w, wi) => (
                    <span key={wi} className="peek-word">{w.toUpperCase()}</span>
                  ))}
                </span>
              </div>
            ))}
          </>
        )}

        {roundLog.length > 0 && (
          <>
            <div className="hints-title log-title">📜 Лента хлева ({roundLog.length})</div>
            {[...roundLog].reverse().map((item, idx) => {
              const info = formatLogItem(item, nameOf);
              return (
                <div key={`log-${roundLog.length - idx}`} className={`hint-card log-card ${info.dirty ? 'dirty-log' : ''}`}>
                  <div className="log-card-row">
                    <span className="log-tick-badge">Тик {item.tick}</span>
                    <span className="log-card-text">
                      {info.icon} {info.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

function LetterGrid({ onPick, lang = 'ru' }) {
  const LETTERS = lang === 'en'
    ? [...'abcdefghijklmnopqrstuvwxyz']
    : [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'];
  return (
    <div className="letter-grid">
      {LETTERS.map((ch) => (
        <button key={ch} className="letter-btn" onClick={() => onPick(ch)}>
          {ch.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// меню способностей: две секции — тратящие попытку и нет
function PowerOverlay({ state, meId, myRows, menu, setMenu, actions }) {
  const me = state.players.find((p) => p.id === meId);
  const r = state.round;
  const submitted = r.submittedIds.includes(meId);
  const done = r.doneIds.includes(meId);
  const close = () => setMenu(null);
  const canFree = !submitted && !done; // сливки/подойник/прошлые надои
  const canSpend = canFree; // способности за попытку: доска не ограничена

  const targets = Object.keys(r.boards)
    .filter((id) => id !== meId && !r.doneIds.includes(id))
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean);

  // «Прошлые надои»: подсматривать можно у тех, кто уже налил хоть ряд
  const peekTargets = Object.keys(r.boards)
    .filter((id) => id !== meId && (r.boards[id]?.length ?? 0) > 0)
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean);

  if (menu === 'menu') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>Талоны 🥛 (осталось: {me.tokens})</h2>
          <div className="power-section">Не тратят попытку:</div>
          <div className="power-list">
            <button className="power-item" disabled={!canFree || me.tokens < 1} onClick={() => setMenu('cream')}>
              <b>🥛 Первые сливки — 1</b>
              <span>есть ли буква в слове? Ответ видишь только ты</span>
            </button>
            <button className="power-item" disabled={!canFree || me.tokens < 2} onClick={() => setMenu('sniper')}>
              <b>🎯 Снайперский подойник — 2</b>
              <span>буква на конкретной позиции — приватно</span>
            </button>
          </div>
          <div className="power-section">Тратят попытку:</div>
          <div className="power-list">
            <button className="power-item" disabled={!canFree || me.tokens < 2 || peekTargets.length === 0} onClick={() => setMenu('peek')}>
              <b>🕵️ Прошлые надои — 2</b>
              <span>подсмотреть написанные слова соперника — порядок перемешан</span>
            </button>
            <button className="power-item" disabled={!canSpend || me.tokens < 1} onClick={() => setMenu('recon')}>
              <b>👀 Сексуальная разведка — 1</b>
              <span>2 случайных слова из базы лягут на твою доску</span>
            </button>
            <button className="power-item" disabled={!canSpend || me.tokens < 2 || targets.length === 0} onClick={() => setMenu('intercept')}>
              <b>🐄 Белковый перехват — 2</b>
              <span>подменить написанное слово противника случайным</span>
            </button>
            <button className="power-item" disabled={!canSpend || me.tokens < 3} onClick={() => setMenu('steal')}>
              <b>🕵️ Деревенская кража — 3</b>
              <span>сменить общее слово: чужие ряды помечаются старыми</span>
            </button>
          </div>
          {submitted && <p className="hint">В этом тике ты уже отправил слово — способности сливают до отправки</p>}
          <button className="btn ghost" onClick={close}>Закрыть</button>
        </div>
      </div>
    );
  }

  if (menu === 'cream') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🥛 Первые сливки</h2>
          <p className="hint">Проверь, есть ли буква в слове. Увидишь только ты. Попытку не тратит.</p>
          <LetterGrid lang={state.round?.lang} onPick={(ch) => { actions.power('cream', { letter: ch }); close(); }} />
          <button className="btn ghost" onClick={close}>Закрыть</button>
        </div>
      </div>
    );
  }

  if (menu === 'sniper') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🎯 Снайперский подойник</h2>
          <p className="hint">Выбери букву, потом позицию. Увидишь только ты. Попытку не тратит.</p>
          <LetterGrid lang={state.round?.lang} onPick={(ch) => { setMenu(`sniper-pos:${ch}`); }} />
          <button className="btn ghost" onClick={() => setMenu('menu')}>Назад</button>
        </div>
      </div>
    );
  }

  if (menu?.startsWith('sniper-pos:')) {
    const ch = menu.split(':')[1];
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🎯 Позиция для «{ch.toUpperCase()}»</h2>
          <div className="pos-btns">
            {Array.from({ length: state.round?.wordLength || state.settings.wordLength || 5 }).map((_, i) => (
              <button key={i} className="pos-btn" onClick={() => { actions.power('sniper', { letter: ch, pos: i }); close(); }}>
                {i + 1}
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setMenu('sniper')}>Назад</button>
        </div>
      </div>
    );
  }

  if (menu === 'peek') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🕵️ Прошлые надои</h2>
          <p className="hint">Чьи налитые слова подсмотреть? Порядок слов перемешается — сопоставляй с плитками сам. Попытку не тратит.</p>
          <div className="power-list">
            {peekTargets.map((p) => (
              <button
                key={p.id}
                className="power-item freeze-target"
                onClick={() => { actions.power('peek', { target: p.id }); close(); }}
              >
                <Avatar player={p} size={26} />
                <b>{p.name}</b>
                <span>({r.boards[p.id].length} рядов)</span>
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setMenu('menu')}>Назад</button>
        </div>
      </div>
    );
  }

  if (menu === 'intercept') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🐄 Белковый перехват</h2>
          <p className="hint">Чье слово подменить случайным? Жертва узнает.</p>
          <div className="power-list">
            {targets.map((p) => (
              <button
                key={p.id}
                className="power-item freeze-target"
                onClick={() => { actions.power('intercept', { target: p.id }); close(); }}
              >
                <Avatar player={p} size={26} />
                <b>{p.name}</b>
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setMenu('menu')}>Назад</button>
        </div>
      </div>
    );
  }

  const confirmKind = { recon: ['👀 Сексуальная разведка', '2 случайных слова лягут на твою доску и займут 2 ряда.'], steal: ['🕵️ Деревенская кража', 'Общее слово сменится. Все чужие ряды (и твои) помечаются старыми.'] }[menu];
  if (confirmKind) {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>{confirmKind[0]}</h2>
          <p className="hint">{confirmKind[1]}</p>
          <button className="btn primary" onClick={() => { actions.power(menu); close(); }}>
            Тратить талон 🥛
          </button>
          <button className="btn ghost" onClick={() => setMenu('menu')}>Назад</button>
        </div>
      </div>
    );
  }
  return null;
}

// меню: создать комнату или присоединиться к чужой
function MenuScreen({ me, roomList, connected, actions, muted, setMuted, onSwitchSolo }) {
  const rooms = roomList || [];
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const create = () => {
    const name = roomName.trim() || `Комната ${me.name}`;
    actions.createRoom(name, 'closed', isPrivate);
    setRoomName('');
  };

  const joinByCode = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    actions.joinRoom(code);
    setJoinCode('');
  };

  return (
    <div className="game menu">
      <header className="top">
        <div className="top-group">
          <span className="round-badge">меню</span>
          {onSwitchSolo && (
            <button className="mode-pill-btn" onClick={onSwitchSolo} title="Вернуться в соло-игру">
              🎯 Соло
            </button>
          )}
        </div>
        <h1 className="logo">МОЛОКО</h1>
        <button
          className="icon-btn"
          title={muted ? 'Включить звуки' : 'Выключить звуки'}
          onClick={() => setMuted(sfx.toggleMute())}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>
      <Cow text={me ? `Привет, ${me.name}! Создай комнату для своей группы или заходи к чужим дояркам.` : 'Доим Discord…'} mood="wink" />
      <input
        className="room-name-input"
        placeholder={`Название комнаты (по умолчанию: Комната ${me.name})`}
        maxLength={30}
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <div className="menu-row">
        <button
          type="button"
          className={`chip-btn wide-chip ${isPrivate ? 'on' : ''}`}
          onClick={() => setIsPrivate((v) => !v)}
          title="Скрытая комната не отображается в общем списке — вход только по 4-буквенному коду"
        >
          {isPrivate ? '🕵️ Скрытая (по коду)' : '🌐 Публичная комната'}
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={!connected || !me}
          onClick={create}
        >
          🐄 Создать комнату
        </button>
      </div>

      <div className="join-code-row">
        <input
          className="room-name-input code-input"
          placeholder="Код (4 симв.)"
          maxLength={6}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && joinByCode()}
        />
        <button
          className="btn ghost"
          disabled={!connected || !me || !joinCode.trim()}
          onClick={joinByCode}
        >
          🔑 Войти по коду
        </button>
      </div>

      <div className="menu-section">Открытые комнаты в хлеву:</div>
      <div className="room-list">
        {rooms.map((r) => (
          <button key={r.id} className="room-item" onClick={() => actions.joinRoom(r.id)}>
            <span className="room-name">{r.visibility === 'open' ? '🔓' : '🔒'} {r.name}</span>
            <span className="room-meta">
              👤 {r.players}/8 · {r.lang === 'en' ? '🇬🇧' : '🇷🇺'} ·{' '}
              {r.phase === 'lobby' ? 'ждут' : r.phase === 'round' ? 'играют' : 'пауза'}
            </span>
            <span className="room-code">{r.id}</span>
          </button>
        ))}
        {rooms.length === 0 && <div className="hint">Пока пусто — создай первую комнату или введи код!</div>}
      </div>
      {!connected && <p className="hint">Связываюсь с сервером…</p>}
      <p className="hint small">Игроки в одной комнате мешают друг другу как хотят. Талоны, шпионаж и доение прилагаются.</p>
    </div>
  );
}

export default function PartyGame({ me, onSwitchSolo }) {
  const { state, connected, inRoom, roomList, toasts, reactions, privateData, clearPrivate, pushToast, actions } = useParty(me);
  const [cells, setCells] = useState(['', '', '', '', '']);
  const [cursorPos, setCursorPos] = useState(0);
  const [cowText, setCowText] = useState('Приветик… Зорька уже налила. Зови народ!');
  const [menu, setMenu] = useState(null);
  const [muted, setMuted] = useState(sfx.isMuted());
  const [armed, setArmed] = useState(null);
  const prev = useRef({ myRowsLen: 0, tick: 0, lastSeq: 0, phase: null, roundN: null, winnersLen: -1 });

  const r = state?.round;
  const lang = r?.lang || state?.settings.lang || 'ru';
  const wordLen = r?.wordLength || state?.settings.wordLength || 5;
  const myRows = privateData.myRows || [];
  const hints = privateData.hints || [];
  const roundLog = r?.log || [];

  const submitted = Boolean(r && r.submittedIds.includes(me?.id));
  const done = Boolean(r && r.doneIds.includes(me?.id));
  const isSpectator = Boolean(r && r.boards && !r.boards[me?.id]);
  const canSubmit = state?.phase === 'round' && !submitted && !done && !isSpectator;
  const myTokens = state?.players.find((p) => p.id === me?.id)?.tokens ?? 0;
  const nameOf = (id) => state?.players.find((p) => p.id === id)?.name || 'кто-то';

  // клавиатура: метки своих рядов + приватные знания сливок и подойника
  const marks = useMemo(() => {
    const m = keyboardMarks(myRows);
    for (const h of hints) {
      if (h.type === 'pos' && h.atPos) m[h.letter] = 'correct';
      else if (h.inWord === true && (!m[h.letter] || m[h.letter] === 'absent')) m[h.letter] = 'present';
      else if (h.inWord === false && !m[h.letter]) m[h.letter] = 'absent';
    }
    return m;
  }, [myRows, hints]);
  const knownPos = useMemo(() => {
    const kp = {};
    for (const h of hints) if (h.type === 'pos' && h.atPos) kp[h.letter] = h.pos;
    return kp;
  }, [hints]);

  // события комнаты: реплики Зорьки синхронны (seed = номер события) + звуки
  useEffect(() => {
    if (!state) return;
    const pv = prev.current;
    const seed = state.eventSeq;

    if (myRows.length > pv.myRowsLen) {
      const newCount = myRows.length - pv.myRowsLen;
      const fresh = myRows.slice(-newCount);
      fresh.forEach((row, i) => setTimeout(() => sfx.flip(i), i * 280));
      if (fresh.some((row) => row.marks.some((m) => m === 'correct'))) {
        setTimeout(() => sfx.hit(), newCount * 280);
      }
    }
    if (state.lastEvent && state.lastEvent.seq !== pv.lastSeq) {
      const ev = state.lastEvent;
      if (ev.type === 'intercept') {
        sfx.freeze();
        setCowText(line('interceptUsed', { NAME: nameOf(ev.by), TARGET: nameOf(ev.target) }, seed));
      } else if (ev.type === 'steal') setCowText(line('stealUsed', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'recon') setCowText(line('reconUsed', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'cream') setCowText(line('creamUsed', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'sniper') setCowText(line('sniperUsed', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'peek') setCowText(line('peekUsed', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'skip') setCowText(line('skipTimeout', { NAME: nameOf(ev.by) }, seed));
      else if (ev.type === 'roundEvent') {
        if (ev.eventId === 'double') setCowText(line('eventDouble', {}, seed));
        else if (ev.eventId === 'generous') setCowText(line('eventGenerous', {}, seed));
        else if (ev.eventId === 'firstLetter') setCowText(line('eventFirstLetter', {}, seed));
      } else if (ev.type === 'win') {
        sfx.win();
        if (ev.winners.length === 1) {
          setCowText(line('point', { NAME: nameOf(ev.winners[0]), PTS: fmtPts(ev.pts), TICK: ev.tick }, seed));
        } else {
          setCowText(
            line('pointSplit', { NAMES: ev.winners.map(nameOf).join(' и '), PTS: fmtPts(ev.pts) }, seed),
          );
        }
      } else if (ev.type === 'noWinner') {
        sfx.lose();
        setCowText(line('noWinner', { WORD: ev.word?.toUpperCase() }, seed));
      }
    }

    if ((r?.n ?? null) !== pv.roundN) clearPrivate();

    prev.current = {
      myRowsLen: myRows.length,
      tick: r?.tick ?? 0,
      lastSeq: state.lastEvent?.seq ?? pv.lastSeq,
      phase: state.phase,
      roundN: r?.n ?? null,
      winnersLen: r?.winners?.length ?? 0,
    };
  }, [state, me, myRows, hints, clearPrivate]); // eslint-disable-line react-hooks/exhaustive-deps

  // каждый новый раунд или тик начинается с чистого поля ввода
  useEffect(() => {
    setCells(Array(wordLen).fill(''));
    setCursorPos(0);
  }, [state?.round?.n, state?.round?.tick, wordLen]);

  // двухшаговое подтверждение кнопок: сброс через 3 секунды
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const selectCell = (idx) => {
    if (!canSubmit) return;
    if (idx >= 0 && idx < wordLen) setCursorPos(idx);
  };

  const moveCursor = (delta) => {
    if (!canSubmit) return;
    setCursorPos((p) => Math.max(0, Math.min(wordLen - 1, p + delta)));
  };

  const pressKey = (ch) => {
    if (!canSubmit) return;
    setCells((prevCells) => {
      const next = prevCells.length === wordLen ? [...prevCells] : Array(wordLen).fill('');
      const pos = Math.min(wordLen - 1, Math.max(0, cursorPos));
      next[pos] = ch;
      let nextPos = pos;
      const emptyAfter = next.findIndex((c, i) => i > pos && !c);
      if (emptyAfter !== -1) nextPos = emptyAfter;
      else if (pos < wordLen - 1) nextPos = pos + 1;
      setCursorPos(nextPos);
      return next;
    });
  };
  const pressBack = () => {
    if (!canSubmit) return;
    setCells((prevCells) => {
      const next = prevCells.length === wordLen ? [...prevCells] : Array(wordLen).fill('');
      const pos = Math.min(wordLen - 1, Math.max(0, cursorPos));
      if (next[pos]) {
        next[pos] = '';
      } else if (pos > 0) {
        next[pos - 1] = '';
        setCursorPos(pos - 1);
      }
      return next;
    });
  };
  const pressEnter = () => {
    if (!canSubmit) return;
    if (cells.length !== wordLen || cells.some((c) => !c)) {
      pushToast(
        lang === 'en'
          ? `Type a ${wordLen}-letter word, sweetie`
          : `Слово из ${wordLen} букв, солнышко`,
      );
      return;
    }
    const word = normalizeWord(cells.join(''), lang, wordLen);
    if (word.length < wordLen) {
      pushToast(
        lang === 'en'
          ? `Type a ${wordLen}-letter word, sweetie`
          : `Слово из ${wordLen} букв, солнышко`,
      );
      return;
    }
    actions.guess(word);
    setCells(Array(wordLen).fill(''));
    setCursorPos(0);
  };
  usePhysicalInput(pressKey, pressEnter, pressBack, lang, moveCursor);

  if (!me || !connected) {
    return (
      <div className="game">
        <h1 className="logo">МОЛОКО</h1>
        <Cow text={me ? 'Связываюсь с хлевом…' : 'Доим Discord…'} mood="idle" />
      </div>
    );
  }

  if (!inRoom) {
    return (
      <MenuScreen
        me={me}
        roomList={roomList}
        connected={connected}
        actions={actions}
        muted={muted}
        setMuted={setMuted}
        onSwitchSolo={onSwitchSolo}
      />
    );
  }

  if (!state) {
    return (
      <div className="game">
        <h1 className="logo">МОЛОКО</h1>
        <Cow text="Заходим в комнату…" mood="idle" />
      </div>
    );
  }

  const iAmChampion = state.championId === me.id;
  const readyCount = state.ready?.length || 0;
  const aliveCount = state.players.filter((p) => p.connected).length;
  const iAmReady = state.ready?.includes(me.id);
  const waiting = r
    ? Object.keys(r.boards)
        .filter((id) => id !== me?.id && !r.submittedIds.includes(id) && !r.doneIds.includes(id))
        .map(nameOf)
    : [];

  return (
    <div className="game party">
      <header className="top">
        <span className="round-badge">
          {state.phase === 'lobby'
            ? `лобби · ${state.roomId}`
            : state.phase === 'round'
              ? `слово №${r.n} · тик ${r.tick}/6`
              : `слово №${r?.n ?? '—'}`}
        </span>
        <h1 className="logo">МОЛОКО</h1>
        <button
          className="icon-btn"
          title={muted ? 'Включить звуки' : 'Выключить звуки'}
          onClick={() => setMuted(sfx.toggleMute())}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <span className="to-win">до {state.settings.pointsToWin} очк.</span>
      </header>

      <div className="party-body">
        <aside className="side">
          <PlayerList state={state} meId={me.id} myRows={myRows} maxAttempts={state.maxAttempts} wordLen={wordLen} />
          {state.phase === 'round' && !isSpectator && (
            <TickTimer startedAt={r.tickStartedAt} seconds={state.tickSeconds} />
          )}
          <div className="side-actions">
            {state.hostId === me.id && ['round', 'roundEnd'].includes(state.phase) && (
              <button
                className={`side-btn ${armed === 'end' ? 'danger' : ''}`}
                onClick={() => (armed === 'end' ? (actions.endMatch(), setArmed(null)) : setArmed('end'))}
              >
                {armed === 'end' ? 'Точно завершить?' : 'Завершить матч'}
              </button>
            )}
            {state.hostId === me.id && (
              <button
                className={`side-btn ${armed === 'delete' ? 'danger' : ''}`}
                onClick={() => (armed === 'delete' ? (actions.deleteRoom(), setArmed(null)) : setArmed('delete'))}
              >
                {armed === 'delete' ? 'Точно распустить?' : 'Распустить комнату'}
              </button>
            )}
            <button
              className="side-btn"
              onClick={() => (armed === 'leave' ? actions.leave() : setArmed('leave'))}
            >
              {armed === 'leave' ? 'Точно выйти?' : 'Выйти из комнаты'}
            </button>
          </div>
        </aside>

        <div className="main-col">
          {state.phase === 'lobby' && (
            <div className="panel lobby">
              <div className="room-code-bar">
                <span>Код комнаты: <b>{state.roomId}</b></span>
                {state.isPrivate && <span className="host-tag">🕵️ скрытая</span>}
                <button
                  type="button"
                  className="chip-btn wide-chip"
                  onClick={() => copyResult(state.roomId, pushToast)}
                  title="Скопировать код комнаты"
                >
                  📋 Код
                </button>
              </div>
              <Cow text={state.players.filter((p) => p.connected).length < 2 ? 'Один в хлеву скучно. Зови друзей или добавь бота!' : 'Народ собирается…'} mood="wink" />
              <div className="lobby-list">
                {state.players.filter((p) => p.connected).map((p) => {
                  const botDiff = p.isBot ? BOT_DIFFS[p.difficulty || 'normal'] : null;
                  return (
                    <div className="lobby-player" key={p.id}>
                      <Avatar player={p} />
                      <span>{p.name}</span>
                      {p.id === state.hostId && <span className="host-tag">хост</span>}
                      {p.isBot && botDiff && (
                        <button
                          type="button"
                          className={`bot-diff-btn diff-${p.difficulty || 'normal'}`}
                          disabled={!isHost(state, me)}
                          title={botDiff.title}
                          onClick={() => actions.setBotDifficulty(p.id, botDiff.next)}
                        >
                          {botDiff.label}
                        </button>
                      )}
                      {p.isBot && isHost(state, me) && (
                        <button
                          type="button"
                          className="bot-remove-btn"
                          onClick={() => actions.removeBot(p.id)}
                          title="Убрать бота"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {isHost(state, me) && state.players.filter((p) => p.connected).length < 8 && (
                <button type="button" className="btn ghost small-btn" onClick={() => actions.addBot('normal')}>
                  + 🤖 Добавить бота
                </button>
              )}
              <div className="points-picker">
                <span>Играем до:</span>
                {POINT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={`chip-btn ${state.settings.pointsToWin === n ? 'on' : ''}`}
                    disabled={!isHost(state, me)}
                    onClick={() => actions.setPoints(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="points-picker">
                <span>Язык:</span>
                {Object.entries(LANGS).map(([key]) => (
                  <button
                    key={key}
                    className={`chip-btn ${state.settings.lang === key ? 'on' : ''}`}
                    disabled={!isHost(state, me)}
                    onClick={() => actions.setLang(key)}
                  >
                    {key === 'ru' ? '🇷🇺' : '🇬🇧'}
                  </button>
                ))}
                <span style={{ marginLeft: 8 }}>Букв:</span>
                {[5, 6, 7].map((n) => (
                  <button
                    key={n}
                    className={`chip-btn ${state.settings.wordLength === n ? 'on' : ''}`}
                    disabled={!isHost(state, me)}
                    title={`Слова на ${n} букв`}
                    onClick={() => actions.setWordLength(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="points-picker">
                <span>Темп тика:</span>
                {TICK_OPTIONS.map(({ sec, label }) => (
                  <button
                    key={sec}
                    className={`chip-btn wide-chip ${(state.settings.tickSeconds || state.tickSeconds) === sec ? 'on' : ''}`}
                    disabled={!isHost(state, me)}
                    onClick={() => actions.setTickSeconds(sec)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="points-picker">
                <span>Режим:</span>
                <button
                  className={`chip-btn wide-chip ${state.settings.visibility === 'closed' ? 'on' : ''}`}
                  disabled={!isHost(state, me)}
                  title="Соперники видят только цвета твоих плиток (буквы раскроются в конце раунда)"
                  onClick={() => actions.setVisibility('closed')}
                >
                  🔒 Закрытый
                </button>
                <button
                  className={`chip-btn wide-chip ${state.settings.visibility === 'open' ? 'on' : ''}`}
                  disabled={!isHost(state, me)}
                  title="Соперники сразу видят буквы твоих рядов"
                  onClick={() => actions.setVisibility('open')}
                >
                  🔓 Открытый
                </button>
              </div>
              <div className="points-picker">
                <span>События Зорьки:</span>
                <button
                  className={`chip-btn wide-chip ${state.settings.eventsEnabled ? 'on' : ''}`}
                  disabled={!isHost(state, me)}
                  title="Случайные бонусные модификаторы со 2-го раунда (Золотой надой ×2, Щедрый хлев +2 талона, Парное молоко)"
                  onClick={() => actions.setEventsEnabled(!state.settings.eventsEnabled)}
                >
                  {state.settings.eventsEnabled ? '🎲 Вкл' : 'Выкл'}
                </button>
              </div>
              <button
                className="btn primary"
                onClick={actions.start}
                disabled={!isHost(state, me)}
                title={isHost(state, me) ? '' : 'Матч запускает хост'}
              >
                Начать матч
              </button>
              {!isHost(state, me) && <p className="hint small">Матч запускает хост 🐄</p>}
              <p className="hint small">Все отгадывают одно слово одновременно, у каждого своя доска. Угадал раньше — больше очков. Талоны крадут чужую инфу.</p>
            </div>
          )}

          {(state.phase === 'round' || state.phase === 'tickEnd' || state.phase === 'roundEnd') && (
            <>
              <Cow text={cowText} mood={r?.winners.length ? 'happy' : 'idle'} />
              {r?.event && (
                <div className="event-banner">
                  <b>{r.event.title}</b> — {r.event.desc}
                </div>
              )}
              {isSpectator && (state.phase === 'round' || state.phase === 'tickEnd') && (
                <div className="spectator-banner">👀 Ты наблюдатель — вступишь в игру со следующего слова</div>
              )}
              {state.settings.lang === 'en' && (
                <div className="spectator-banner lang-banner">🇬🇧 Раунд на английском</div>
              )}

              {/* своя доска: ряды с буквами из приватных данных */}
              <div className="board">
                {myRows.map((row, ri) => (
                  <Fragment key={ri}>
                    {row.old && (ri === 0 || !myRows[ri - 1].old) && (
                      <div className="swap-divider">— слово сменили —</div>
                    )}
                    <div className={`row ${row.old ? 'old' : ''}`}>
                      {[...row.w].map((ch, ci) => (
                        <div key={ci} className={`tile reveal s-${row.marks[ci]}`} style={{ '--i': ci }}>
                          {ch}
                        </div>
                      ))}
                    </div>
                  </Fragment>
                ))}
                {state.phase === 'round' &&
                  (canSubmit ? (
                    <div className="row">
                      {[...Array(wordLen)].map((_, i) => (
                        <Tile
                          key={i}
                          i={i}
                          ch={cells[i]}
                          active={Boolean(cells[i])}
                          cursor={i === cursorPos}
                          onClick={() => selectCell(i)}
                        />
                      ))}
                    </div>
                  ) : !done ? (
                    <div className="wait-row-line">
                      {submitted ? 'Слово отправлено — ждем остальных…' : 'Ждем закрытия тика…'}
                    </div>
                  ) : null)}
              </div>

              {state.phase === 'round' && (
                <>
                  <div className="tick-status">
                    {done
                      ? 'Ты закончил этот раунд'
                      : submitted
                        ? 'Слово отправлено — ждем остальных…'
                        : waiting.length > 0
                          ? `Ждём: ${waiting.join(', ')}`
                          : 'Отправляй слово!'}
                    <TickTimer startedAt={r.tickStartedAt} seconds={state.tickSeconds} soundActive={canSubmit} />
                  </div>
                  <div className="power-row">
                    <button className="power-btn" onClick={() => setMenu('menu')} disabled={!canSubmit && !canFreePowers(state, me)}>
                      🧪 Способности (🥛{myTokens})
                    </button>
                  </div>
                  <div className="reactions">
                    {['🐮', '🥛', '👏', '😏', '🔥'].map((e) => (
                      <button key={e} className="react-btn" onClick={() => actions.react(e)}>{e}</button>
                    ))}
                  </div>
                  <Keyboard
                    lang={lang}
                    marks={marks}
                    knownPos={knownPos}
                    resetKey={r?.n}
                    onKey={pressKey}
                    onEnter={pressEnter}
                    onBack={pressBack}
                    disabled={!canSubmit}
                  />
                </>
              )}

              {state.phase === 'tickEnd' && (
                <div className="panel tick-end">
                  <h3>Тик {r.tick} закрыт — обдумайте следующий ход</h3>
                  <p className="hint">Всем раздали ряды. Совещайтесь, считайте талоны, стройте план 🐄</p>
                  <button className="btn primary" onClick={actions.ready} disabled={iAmReady}>
                    {iAmReady ? `Готов ✓ (${readyCount}/${aliveCount})` : `Готов (${readyCount}/${aliveCount})`}
                  </button>
                  <p className="hint small">Следующий тик нальется, когда все нажмут «Готов» (или через 20 секунд)</p>
                </div>
              )}

              {state.phase === 'roundEnd' && (
                <div className="overlay">
                  <div className="panel">
                    <h2>Слово было: {r.word?.toUpperCase()}</h2>
                    {r.winners.length > 0 ? (
                      <p className="over-line">
                        {r.winners.map(nameOf).join(' и ')}{' '}
                        {r.winners.length > 1 ? `делят тик ${r.tick} — по ${fmtPts(r.tickShare)}` : `+${fmtPts(r.tickShare)}`} очк.
                      </p>
                    ) : (
                      <p className="over-line">Никто не угадал 😿</p>
                    )}

                    {r.revealedWords && (
                      <div className="round-words-reveal">
                        <div className="power-section">Кто что наливал в раунде:</div>
                        {state.players
                          .filter((p) => p.connected && r.revealedWords[p.id]?.length)
                          .map((p) => (
                            <div key={p.id} className="reveal-player-row">
                              <b>{p.name}:</b>{' '}
                              <span className="peek-words">
                                {r.revealedWords[p.id].map((w, wi) => (
                                  <span key={wi} className="peek-word">{w.toUpperCase()}</span>
                                ))}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                    {isSpectator ? (
                      <p className="hint">👀 Ты наблюдатель — вступишь со следующего слова</p>
                    ) : (
                      <button className="btn primary" onClick={actions.ready} disabled={iAmReady}>
                        {iAmReady ? `Готов ✓ (${readyCount}/${aliveCount})` : `Готов (${readyCount}/${aliveCount})`}
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => copyResult(buildResultText(state, myRows), pushToast)}>
                      📋 Скопировать результат
                    </button>
                    <p className="hint small">Следующее слово нальется, когда все нажмут «Готов»</p>
                  </div>
                </div>
              )}
            </>
          )}

          {state.phase === 'matchEnd' && (
            <div className="overlay">
              <div className="panel">
                <h2>{iAmChampion ? 'Ты король хлева!' : 'Матч окончен'}</h2>
                <Cow
                  text={line(iAmChampion ? 'matchWin' : 'matchLose', {}, `champ${state.eventSeq}`)}
                  mood={iAmChampion ? 'happy' : 'sad'}
                />
                <div className="podium">
                  {state.players
                    .filter((p) => p.connected)
                    .sort((a, b) => b.points - a.points)
                    .map((p, i) => (
                      <div className="podium-row" key={p.id}>
                        <span className="podium-place">{i + 1}</span>
                        <Avatar player={p} />
                        <div className="podium-info">
                          <span className="podium-name">{p.name}</span>
                          {p.achievements?.length > 0 && (
                            <div className="ach-list">
                              {p.achievements.map((a, ai) => (
                                <span key={ai} className="ach-pill" title={a.desc}>
                                  {a.icon} {a.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <b className="podium-pts">{fmtPts(p.points)}</b>
                        {p.id === state.championId && <span>👑</span>}
                      </div>
                    ))}
                </div>
                <button className="btn primary" onClick={actions.rematch} disabled={!isHost(state, me)}>
                  {isHost(state, me) ? 'Реванш!' : 'Реванш объявит хост'}
                </button>
              </div>
            </div>
          )}
        </div>

        {(privateData.hints?.length || privateData.peeks?.length || roundLog.length) ? (
          <HintCards privateData={privateData} roundLog={roundLog} nameOf={nameOf} />
        ) : null}
      </div>

      {menu && state.phase === 'round' && (
        <PowerOverlay
          state={state}
          meId={me.id}
          myRows={myRows}
          menu={menu}
          setMenu={setMenu}
          actions={actions}
        />
      )}

      <div className="reaction-layer">
        {reactions.map((rr) => (
          <span className="reaction-float" key={rr.id} style={{ left: `${rr.left}%` }}>
            {rr.emoji}
          </span>
        ))}
      </div>

      <Toast toasts={toasts} />
    </div>
  );
}

function isHost(state, me) {
  return state.hostId === me?.id;
}

function canFreePowers(state, me) {
  const r = state.round;
  return r && !r.submittedIds.includes(me?.id) && !r.doneIds.includes(me?.id);
}
