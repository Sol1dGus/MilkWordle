import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParty } from '../discord/useParty.js';
import { usePhysicalInput } from '../hooks/usePhysicalInput.js';
import Cow from './Cow.jsx';
import Keyboard from './Keyboard.jsx';
import Toast from './Toast.jsx';
import { Tile } from './Board.jsx';
import { line } from '../game/lines.js';
import { sfx } from '../game/sfx.js';
import { keyboardMarks, normalizeWord } from '../game/logic.js';
import { THEMES } from '../game/words.js';

const MARK_EMOJI = { correct: '🟫', present: '🟨', absent: '⬜' };
const POINT_OPTIONS = [1, 3, 5, 10];
const ACH_ICONS = { smkKing: '🧀', stakhanovets: '🥛', iceHeart: '🧊' };
const ACH_TITLES = {
  smkKing: 'Сырный король — выиграл 3 молочные битвы',
  stakhanovets: 'Дояр-стахановец — 5 побед подряд',
  iceHeart: 'Ледяное сердце — заморозил будущего чемпиона',
};

// текст результата для буфера обмена: доска эмодзи + заголовок
function buildResultText(state) {
  const r = state.round;
  if (!r) return '';
  const winner = state.players.find((p) => p.id === r.winnerId)?.name || 'кто-то';
  const lines = [`🥛 МОЛОКО — ${r.word?.toUpperCase()} за ${r.board.length} (${winner})`];
  if (state.settings.teamMode) lines.push(`🥚 ${state.teamPoints?.egg ?? 0} : ${state.teamPoints?.hen ?? 0} 🐔`);
  for (const row of r.board) {
    lines.push([...row.marks].map((m) => MARK_EMOJI[m]).join(''));
  }
  return lines.join('\n');
}

async function copyResult(state, pushToast) {
  const text = buildResultText(state);
  try {
    await navigator.clipboard.writeText(text);
    pushToast('Скопировано — кидай в чат!');
  } catch {
    // Discord-iframe может резать clipboard API — запасной путь
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
const REACTIONS = ['🐮', '🥛', '👏', '😏', '🔥'];
const LETTERS = [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'];
const SMK = [
  { sym: 'cheese', label: '🧀 Сыр' },
  { sym: 'milk', label: '🥛 Молоко' },
  { sym: 'jug', label: '🫗 Кувшин' },
];

function Avatar({ player, size = 34 }) {
  return player?.avatar ? (
    <img className="avatar" src={player.avatar} alt="" width={size} height={size} />
  ) : (
    <span className="avatar cow-fallback" style={{ width: size, height: size }} aria-hidden>
      🐮
    </span>
  );
}

// ушедшие игроки из списков убираются (очки сохраняются на случай реванша)
const alive = (state) => state.players.filter((p) => p.connected);

function Scoreboard({ state, meId }) {
  const sorted = alive(state).sort((a, b) => b.points - a.points);
  const teamMode = state.settings.teamMode;
  return (
    <div className="scoreboard">
      {sorted.map((p) => {
        const isSpec = state.round && !state.round.order.includes(p.id);
        return (
          <div
            key={p.id}
            className={`chip ${p.id === state.round?.turnId ? 'turn' : ''} ${p.id === meId ? 'me' : ''}`}
          >
            <Avatar player={p} />
            {teamMode && p.team && <span>{p.team === 'egg' ? '🥚' : '🐔'}</span>}
            <span className="chip-name">{p.name}</span>
            {isSpec && <span className="spec-tag">набл.</span>}
            {p.tokens > 0 && !isSpec && <span className="chip-tokens">🪙{p.tokens}</span>}
            <span className="chip-pts">
              {teamMode ? (state.teamPoints?.[p.team] ?? 0) : `${p.points}/${maxPtsOf(state)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function maxPtsOf(state) {
  return state.settings.pointsToWin;
}

function TurnTimer({ startedAt, seconds }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const left = Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000));
  return <span className={`turn-timer ${left <= 10 ? 'urgent' : ''}`}>⏱ {left}с</span>;
}

// Полоска порядка ходов: позиции и кто стартует по раундам блока
function OrderStrip({ state, nameOf }) {
  const r = state.round;
  if (!state.order || !r?.nextStarters) return null;
  const starters = r.nextStarters.filter(Boolean);
  return (
    <div className="order-strip">
      <span className="order-label">места:</span>
      {state.order.map((id, i) => (
        <span key={id} className={`order-chip ${id === r.turnId ? 'now' : ''} ${id === r.starterId ? 'starter' : ''}`}>
          {i + 1}. {nameOf(id)}
        </span>
      ))}
      {starters.length > 0 && (
        <>
          <span className="order-label">старты:</span>
          {starters.map((id, i) => (
            <span key={i} className="order-start">{nameOf(id)}</span>
          ))}
        </>
      )}
    </div>
  );
}

// Личная панель подсказок — видна только тебе
function HintsPanel({ privateData }) {
  if (!privateData.hints.length && !privateData.whispers.length) return null;
  return (
    <div className="hints-panel">
      {privateData.hints.map((h, i) => (
        <span key={`h${i}`} className="hint-chip">
          🤫 {h.letter.toUpperCase()} — {h.inWord ? 'есть' : 'нет'}
        </span>
      ))}
      {privateData.whispers.length > 0 && (
        <span className="hint-chip whisper">👂 {privateData.whispers.map((w) => w.toUpperCase()).join(', ')}</span>
      )}
    </div>
  );
}

function WaitingRow({ name }) {
  return (
    <div className="row wait-row">
      <div className="wait-label">{name} думает<span className="dots"><i>.</i><i>.</i><i>.</i></span></div>
      {[...Array(5)].map((_, i) => (
        <Tile key={i} i={i} />
      ))}
    </div>
  );
}

// Правила молочной битвы — одинаково показываются во всех оверлеях розыгрыша
function SmkRules() {
  return (
    <div className="smk-rules">
      <div>🧀 Сыр затыкает 🫗 Кувшин</div>
      <div>🫗 Кувшин наливает 🥛 Молоко</div>
      <div>🥛 Молоко створаживается в 🧀 Сыр</div>
    </div>
  );
}

function DrawOverlay({ state, meId, actions }) {
  const voted = state.draw?.voted || [];
  const iVoted = voted.includes(meId);
  const total = alive(state).length;
  const teamMode = state.settings.teamMode;
  const cowText = useMemo(() => line('drawStart', {}, `draw${state.eventSeq}`), [state.eventSeq]);
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{teamMode ? 'Делимся на команды!' : 'Раздаем места!'}</h2>
        <Cow text={cowText} mood="wink" />
        {teamMode ? (
          <>
            <div className="smk-rules">
              <div>1. Голосуй за команду: 🥚 Яйцо или 🐔 Курица</div>
              <div>2. Команды должны выйти ровными — иначе переголосуем</div>
              <div>3. Затем битва в Сыр-Молоко-Кувшин расставит чередование ходов</div>
              <div>4. Угадал игрок — очко летит КОМАНДЕ</div>
            </div>
          </>
        ) : (
          <div className="smk-rules">
            <div>1. Голосуй за 🥚 или 🐔 — голоса скрыты до конца</div>
            <div>2. Меньшие в меньшинстве — они первыми разбирают места</div>
            <div>3. Остальные бьются парами в Сыр-Молоко-Кувшин</div>
            <div>4. С победителя и вниз выбираются позиции в очереди</div>
          </div>
        )}
        <p className="hint">⏱ {state.draw?.seconds}с — кто медлит, за того голосует Зорька</p>
        {iVoted ? (
          <p className="hint">Выбор сделан. Ждем остальных… ({voted.length}/{total})</p>
        ) : (
          <div className="draw-btns">
            <button className="btn ghost draw-btn" onClick={() => actions.drawPick('egg')}>🥚 Яйцо</button>
            <button className="btn ghost draw-btn" onClick={() => actions.drawPick('hen')}>🐔 Курица</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PickPosOverlay({ state, meId, actions }) {
  const isMe = state.pick.pickerId === meId;
  const pickerName = state.players.find((p) => p.id === state.pick.pickerId)?.name || 'кто-то';
  const cowText = useMemo(
    () => (isMe ? line('drawMinority', {}, `pick${state.eventSeq}`) : `Тише… ${pickerName} выбирает место в очереди.`),
    [isMe, pickerName, state.eventSeq],
  );
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{isMe ? 'Твое место!' : `${pickerName} выбирает место`}</h2>
        <Cow text={cowText} mood={isMe ? 'happy' : 'idle'} />
        <p className="hint">Позиция 1 — открываешь слово. Последняя — крадешь победу. ⏱ {state.pick?.seconds}с</p>
        {isMe ? (
          <div className="pos-btns">
            {state.pick.freePositions.map((i) => (
              <button key={i} className="pos-btn" onClick={() => actions.pickPos(i)}>{i + 1}</button>
            ))}
          </div>
        ) : (
          <p className="hint">Ждем выбора…</p>
        )}
      </div>
    </div>
  );
}

function SmkOverlay({ state, meId, actions }) {
  const smk = state.smk;
  const myPair = smk.pairs.find(([a, b]) => a === meId || b === meId);
  const opponentId = myPair ? (myPair[0] === meId ? myPair[1] : myPair[0]) : null;
  const opponent = state.players.find((p) => p.id === opponentId)?.name || null;
  const iAmBye = smk.bye === meId;
  const drops = smk.drops.map((id) => state.players.find((p) => p.id === id)?.name).join(', ');
  const cowText = useMemo(() => line('smkStart', {}, `smk${state.eventSeq}`), [state.eventSeq]);
  const [myPick, setMyPick] = useState(null);
  useEffect(() => setMyPick(null), [state.phase, smk.pairs]);
  return (
    <div className="overlay">
      <div className="panel">
        <h2>Сыр-Молоко-Кувшин</h2>
        <Cow text={cowText} mood="idle" />
        <SmkRules />
        {drops && <p className="hint">Выбыли: {drops}</p>}
        {myPair && !myPick ? (
          <>
            <p className="hint">Твоя пара: <b>{opponent}</b>. ⏱ {smk.seconds}с</p>
            <div className="draw-btns">
              {SMK.map((s) => (
                <button key={s.sym} className="btn ghost draw-btn" onClick={() => { setMyPick(s.sym); actions.smkPick(s.sym); }}>
                  {s.label}
                </button>
              ))}
            </div>
          </>
        ) : iAmBye ? (
          <p className="hint">Нечетное число — ты без пары и проходишь дальше! 😏</p>
        ) : myPair ? (
          <p className="hint">Ход сделан… ждем {opponent}</p>
        ) : (
          <p className="hint">Бьются пары, жди своей очереди…</p>
        )}
      </div>
    </div>
  );
}

// Меню усилений: тратим жетон, часть усилений требует твоего хода
function PowerOverlay({ state, meId, menu, setMenu, actions, nameOf }) {
  const me = state.players.find((p) => p.id === meId);
  const myTurn = state.round?.turnId === meId;
  const close = () => setMenu(null);

  // кандидаты для заморозки: все живые, кроме тебя
  const freezeTargets = state.round
    ? state.round.order
        .filter((id) => id !== meId)
        .map((id) => state.players.find((p) => p.id === id))
        .filter((p) => p && p.connected)
    : [];

  if (menu === 'menu') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>Усиления 🧪 (жетонов: {me.tokens})</h2>
          <div className="power-list">
            <button className="power-item" disabled={!myTurn} onClick={() => setMenu('reveal')}>
              <b>📍 Открыть букву</b><span>публично раскрыть букву на позиции</span>
            </button>
            <button className="power-item" disabled={!myTurn} onClick={() => setMenu('swap')}>
              <b>🔄 Сменить слово</b><span>новое слово всем, старые данные помечаются</span>
            </button>
            <button className="power-item" disabled={!myTurn} onClick={() => setMenu('freeze')}>
              <b>🧊 Заморозка</b><span>любой игрок пропустит свой следующий ход</span>
            </button>
            <button className="power-item" disabled={!myTurn} onClick={() => setMenu('whisper')}>
              <b>👂 Шепот Зорьки</b><span>3 приватных слова-кандидата</span>
            </button>
          </div>
          {!myTurn && <p className="hint">Эти усиления тратят твой ход — жди очереди</p>}
          <button className="btn ghost" onClick={close}>Закрыть</button>
        </div>
      </div>
    );
  }

  if (menu === 'reveal') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>📍 Открыть букву</h2>
          <p className="hint">Выбери позицию — ее буква станет видна всем (за твой ход).</p>
          <div className="pos-btns">
            {[0, 1, 2, 3, 4].map((i) => (
              <button key={i} className="pos-btn" onClick={() => { actions.power('reveal', { pos: i }); close(); }}>
                {i + 1}
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={close}>Назад</button>
        </div>
      </div>
    );
  }

  if (menu === 'freeze') {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>🧊 Заморозка</h2>
          <p className="hint">Кого отправить в молочный лед? Пропустит свой следующий ход.</p>
          <div className="power-list">
            {freezeTargets.map((p) => (
              <button
                key={p.id}
                className="power-item freeze-target"
                onClick={() => { actions.power('freeze', { target: p.id }); close(); }}
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

  const confirmKind = { swap: '🔄 Сменить слово', whisper: '👂 Шепот Зорьки' }[menu];
  if (confirmKind) {
    return (
      <div className="overlay" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>{confirmKind}</h2>
          {menu === 'swap' && <p className="hint">Слово сменится для всех. Старые попытки останутся с пометкой «старое слово», личные подсказки сгорят.</p>}
          {menu === 'whisper' && <p className="hint">Зорька приватно подскажет 3 слова, совместимых с открытыми данными.</p>}
          <button className="btn primary" onClick={() => { actions.power(menu); close(); }}>
            Тратить жетон 🪙
          </button>
          <button className="btn ghost" onClick={close}>Назад</button>
        </div>
      </div>
    );
  }
  return null;
}

// Сетка для проверки буквы (приватно, в любой момент раунда)
function CheckOverlay({ setMenu, actions }) {
  return (
    <div className="overlay" onClick={() => setMenu(null)}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>🤫 Проверить букву</h2>
        <p className="hint">Ответ увидишь только ты. Жетон тратится, ход — нет.</p>
        <div className="letter-grid">
          {LETTERS.map((ch) => (
            <button key={ch} className="letter-btn" onClick={() => { actions.power('check', { letter: ch }); setMenu(null); }}>
              {ch.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setMenu(null)}>Закрыть</button>
      </div>
    </div>
  );
}

export default function PartyGame({ me }) {
  const { state, connected, toasts, reactions, privateData, clearPrivate, pushToast, actions } = useParty(me);
  const [cur, setCur] = useState('');
  const [cowText, setCowText] = useState('Приветик… Зорька уже налила. Зови народ!');
  const [menu, setMenu] = useState(null); // null | menu | reveal | swap | freeze | whisper | check
  const [muted, setMuted] = useState(sfx.isMuted());
  const prev = useRef({ boardLen: 0, turnId: null, reveals: 0, frozenId: null, swapCount: 0, phase: null, roundN: null });

  const myTurn = Boolean(me && state?.phase === 'round' && state.round?.turnId === me.id);
  const myTokens = state?.players.find((p) => p.id === me?.id)?.tokens ?? 0;
  const nameOf = (id) => state?.players.find((p) => p.id === id)?.name || 'кто-то';

  // Реплики Зорьки: seed = номер события на сервере, поэтому фраза
  // у всех игроков в комнате одинаковая в один и тот же момент
  useEffect(() => {
    if (!state) return;
    const pv = prev.current;
    const r = state.round;
    const seed = state.eventSeq;

    if (state.phase === 'round' && r) {
      if (r.board.length > pv.boardLen && r.board.length > 0) {
        const last = r.board[r.board.length - 1];
        // звук переворота — тик на каждую букву с задержкой анимации
        [...last.marks].forEach((m, i) => setTimeout(() => sfx.flip(i), i * 280));
        if (last.marks.some((m) => m === 'correct')) setTimeout(() => sfx.hit(), 1450);
        if (r.winnerId) {
          sfx.win();
          setCowText(line('point', { NAME: last.byName }, seed));
        } else {
          const juicy = last.marks.filter((m) => m !== 'absent').length >= 2;
          setCowText(line(juicy ? 'partyGood' : 'partyBad', {}, seed));
        }
      }
      if (pv.turnId !== null && r.turnId !== pv.turnId) {
        // одна фраза на всех: обращаемся к текущему игроку в третьем лице
        setCowText(line('otherTurn', { NAME: nameOf(r.turnId) }, `turn:${seed}`));
      }
      if (state.reveals.length > pv.reveals) {
        setCowText(line('revealUsed', { NAME: state.reveals[state.reveals.length - 1].by }, seed));
      }
      if (state.frozenId && state.frozenId !== pv.frozenId) {
        sfx.freeze();
        setCowText(
          state.frozenId === me?.id
            ? line('frozenVictim', {}, seed)
            : line('freezeUsed', { NAME: nameOf(pv.turnId), TARGET: nameOf(state.frozenId) }, `fz:${seed}`),
        );
      }
      if (state.swapCount > pv.swapCount) {
        setCowText(line('swapUsed', { NAME: nameOf(pv.turnId) }, seed));
      }
    }
    if (state.phase === 'draw' && pv.phase !== 'draw' && pv.phase !== null) setCowText(line('drawStart', {}, `dr:${seed}`));
    if (state.phase === 'smk' && pv.phase === 'pickpos') setCowText(line('drawTie', {}, `sm:${seed}`));
    if (state.phase === 'smk' && pv.phase !== 'smk' && pv.phase !== 'pickpos' && pv.phase !== null) setCowText(line('smkStart', {}, `sm:${seed}`));
    if (state.phase === 'pickpos' && pv.phase === 'smk') {
      sfx.smk();
      const winner = state.pick?.pickerId;
      setCowText(line(winner === me?.id ? 'smkWin' : 'smkLose', { NAME: nameOf(winner) }, seed));
    }
    if (state.phase === 'matchEnd' && pv.phase !== 'matchEnd') sfx.fanfare();
    if (state.phase === 'round' && pv.phase === 'pickpos') setCowText(line('orderSet', {}, seed));

    // новый раунд или смена слова — личные подсказки сгорают
    if ((r?.n ?? null) !== pv.roundN || state.swapCount !== pv.swapCount) clearPrivate();

    prev.current = {
      boardLen: r?.board.length ?? 0,
      turnId: r?.turnId ?? null,
      reveals: state.reveals.length,
      frozenId: state.frozenId,
      swapCount: state.swapCount,
      phase: state.phase,
      roundN: r?.n ?? null,
    };
  }, [state, me, clearPrivate]); // eslint-disable-line react-hooks/exhaustive-deps

  // каждый новый ход начинается с чистого поля ввода
  useEffect(() => {
    setCur('');
  }, [state?.round?.turnId, state?.round?.n]);

  const pressKey = (ch) => {
    if (!myTurn) return;
    setCur((c) => (c.length < 5 ? c + ch : c));
  };
  const pressBack = () => {
    if (!myTurn) return;
    setCur((c) => c.slice(0, -1));
  };
  const pressEnter = () => {
    if (!myTurn) return;
    const word = normalizeWord(cur);
    if (word.length < 5) {
      pushToast('Слово из 5 букв, солнышко');
      return;
    }
    actions.guess(word);
    setCur('');
  };
  usePhysicalInput(pressKey, pressEnter, pressBack);

  if (!me || !connected) {
    return (
      <div className="game">
        <h1 className="logo">МОЛОКО</h1>
        <Cow text={me ? 'Связываюсь с хлевом…' : 'Доим Discord…'} mood="idle" />
      </div>
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

  const marks = keyboardMarks((state.round?.board || []).filter((row) => !row.old));
  const iAmChampion = state.championId === me.id;
  const readyCount = state.ready?.length || 0;
  const isSpectator = Boolean(state.round && !state.round.order.includes(me.id));
  const rotationAlive = state.round
    ? state.round.order.filter((id) => state.players.find((p) => p.id === id)?.connected).length
    : 0;
  const iAmReady = state.ready?.includes(me.id);

  return (
    <div className="game party">
      <header className="top">
        <span className="round-badge">
          {state.phase === 'lobby' ? 'лобби' : state.phase === 'draw' ? 'розыгрыш' : `слово №${state.round?.n ?? '—'}`}
        </span>
        <h1 className="logo">МОЛОКО</h1>
        <button
          className="icon-btn"
          title={muted ? 'Включить звуки' : 'Выключить звуки'}
          onClick={() => setMuted(sfx.toggleMute())}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <span className="to-win">
          {state.settings.teamMode
            ? `🥚 ${state.teamPoints?.egg ?? 0} : ${state.teamPoints?.hen ?? 0} 🐔`
            : `до ${state.settings.pointsToWin} очк.`}
        </span>
      </header>

      <div className="party-body">
        <aside className="side">
          <Scoreboard state={state} meId={me.id} />
          {state.phase === 'round' && (
            <TurnTimer startedAt={state.round?.turnStartedAt} seconds={state.turnSeconds} />
          )}
          <HintsPanel privateData={privateData} />
        </aside>

        <div className="main-col">
          {state.phase === 'lobby' && (
            <div className="panel lobby">
              <Cow text={alive(state).length < 2 ? 'Один в хлеву скучно. Зови друзей!' : 'Народ собирается…'} mood="wink" />
              <div className="lobby-list">
                {alive(state).map((p) => (
                  <div className="lobby-player" key={p.id}>
                    <Avatar player={p} />
                    <div className="lobby-name">
                      <span>{p.name}</span>
                      {(p.achievements?.length || 0) > 0 && (
                        <span className="ach-row">
                          {p.achievements.map((a) => (
                            <span key={a} className="ach-badge" title={ACH_TITLES[a] || a}>
                              {ACH_ICONS[a] || '🏆'}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {state.settings.teamMode && p.team && (
                      <span className="team-tag">{p.team === 'egg' ? '🥚' : '🐔'}</span>
                    )}
                    {p.id === state.hostId && <span className="host-tag">хост</span>}
                  </div>
                ))}
              </div>
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
                <span>Тема:</span>
                {Object.entries(THEMES).map(([key, t]) => (
                  <button
                    key={key}
                    className={`chip-btn ${state.settings.theme === key ? 'on' : ''}`}
                    disabled={!isHost(state, me)}
                    title={t.label}
                    onClick={() => actions.setTheme(key)}
                  >
                    {t.icon}
                  </button>
                ))}
              </div>
              <div className="points-picker">
                <span>Команды 2×{Math.max(2, Math.floor(alive(state).length / 2))}:</span>
                <button
                  className={`chip-btn ${state.settings.teamMode ? 'on' : ''}`}
                  disabled={!isHost(state, me)}
                  onClick={() => actions.setTeamMode(!state.settings.teamMode)}
                >
                  {state.settings.teamMode ? '🥚 VS 🐔 вкл' : 'выкл'}
                </button>
              </div>
              <button className="btn primary" onClick={actions.start}>Начать матч</button>
              <p className="hint small">Перед матчем разыгрываем порядок ходов. Угадал — очко. Ходы по кругу, стартующий сдвигается.</p>
            </div>
          )}

          {state.phase === 'draw' && <DrawOverlay state={state} meId={me.id} actions={actions} />}
          {state.phase === 'pickpos' && <PickPosOverlay state={state} meId={me.id} actions={actions} />}
          {state.phase === 'smk' && <SmkOverlay state={state} meId={me.id} actions={actions} />}

          {(state.phase === 'round' || state.phase === 'roundEnd') && (
            <>
              <Cow text={cowText} mood={state.round?.winnerId ? 'happy' : 'idle'} />
              <OrderStrip state={state} nameOf={nameOf} />
              {isSpectator && state.phase === 'round' && (
                <div className="spectator-banner">👀 Ты наблюдатель — вступишь в игру, когда кто-то выиграет</div>
              )}
              {state.reveals.length > 0 && (
                <div className="reveals">
                  {state.reveals.map((rv, i) => (
                    <span key={i} className="reveal-badge">П{rv.pos + 1}: {rv.letter.toUpperCase()}</span>
                  ))}
                </div>
              )}
              <div className="board shared">
                {state.round.board.map((row, ri) => {
                  const firstNew = state.round.board.findIndex((x) => !x.old);
                  return (
                    <Fragment key={ri}>
                      {ri === firstNew && firstNew > 0 && <div className="swap-divider">— слово сменили —</div>}
                      <div className={`row ${row.old ? 'old' : ''}`}>
                        {[...row.w].map((ch, i) => (
                          <div key={i} className={`tile reveal s-${row.marks[i]}`} style={{ '--i': i }}>
                            {ch}
                          </div>
                        ))}
                      </div>
                    </Fragment>
                  );
                })}
                {state.phase === 'round' && (
                  myTurn ? (
                    <div className="row">
                      {[...Array(5)].map((_, i) => (
                        <Tile key={i} i={i} ch={cur[i]} active={Boolean(cur[i])} cursor={i === cur.length} />
                      ))}
                    </div>
                  ) : (
                    <WaitingRow name={nameOf(state.round.turnId)} />
                  )
                )}
              </div>

              {state.phase === 'round' && (
                <>
                  <div className="power-row">
                    <button className="power-btn" onClick={() => setMenu('check')} disabled={myTokens === 0}>
                      🤫 Проверить букву (🪙{myTokens})
                    </button>
                    <button className="power-btn" onClick={() => setMenu('menu')} disabled={myTokens === 0}>
                      🧪 Усиления (🪙{myTokens})
                    </button>
                  </div>
                  <div className="reactions">
                    {REACTIONS.map((e) => (
                      <button key={e} className="react-btn" onClick={() => actions.react(e)}>{e}</button>
                    ))}
                  </div>
                  <Keyboard marks={marks} onKey={pressKey} onEnter={pressEnter} onBack={pressBack} disabled={!myTurn} />
                </>
              )}

              {state.phase === 'roundEnd' && (
                <div className="overlay">
                  <div className="panel">
                    <h2>Слово было: {state.round.word?.toUpperCase()}</h2>
                    <p className="over-line">
                      Очко забирает <b>{nameOf(state.round.winnerId)}</b> за{' '}
                      {state.round.board.length} {state.round.board.length === 1 ? 'попытку' : 'попыток'}
                    </p>
                    {isSpectator ? (
                      <p className="hint">👀 Ты наблюдатель — вступишь в игру со следующего слова</p>
                    ) : (
                      <button className="btn primary" onClick={actions.ready} disabled={iAmReady}>
                        {iAmReady ? `Готов ✓ (${readyCount}/${rotationAlive})` : `Готов (${readyCount}/${rotationAlive})`}
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => copyResult(state, pushToast)}>
                      📋 Скопировать результат
                    </button>
                    <p className="hint small">Следующее слово нальется, когда все игроки нажмут «Готов»</p>
                  </div>
                </div>
              )}
            </>
          )}

          {state.phase === 'matchEnd' && (
            <div className="overlay">
              <div className="panel">
                <h2>
                  {state.settings.teamMode
                    ? state.championTeam === me.team
                      ? 'Твоя команда — король хлева!'
                      : 'Матч окончен'
                    : iAmChampion
                      ? 'Ты король хлева!'
                      : 'Матч окончен'}
                </h2>
                <Cow
                  text={line(
                    state.settings.teamMode
                      ? state.championTeam === me.team ? 'matchWin' : 'matchLose'
                      : iAmChampion ? 'matchWin' : 'matchLose',
                    {},
                    `champ${state.eventSeq}`,
                  )}
                  mood={(!state.settings.teamMode && iAmChampion) || (state.settings.teamMode && state.championTeam === me.team) ? 'happy' : 'sad'}
                />
                {state.settings.teamMode ? (
                  <div className="podium">
                    {['egg', 'hen'].map((t) => (
                      <div className={`podium-row ${state.championTeam === t ? 'winner-team' : ''}`} key={t}>
                        <span className="team-tag big">{t === 'egg' ? '🥚' : '🐔'}</span>
                        <b className="podium-pts">{state.teamPoints?.[t] ?? 0}</b>
                        <span className="podium-name">
                          {alive(state).filter((p) => p.team === t).map((p) => p.name).join(', ') || '—'}
                        </span>
                        {state.championTeam === t && <span>👑</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="podium">
                    {[...alive(state)]
                      .sort((a, b) => b.points - a.points)
                      .map((p, i) => (
                        <div className="podium-row" key={p.id}>
                          <span className="podium-place">{i + 1}</span>
                          <Avatar player={p} />
                          <span className="podium-name">{p.name}</span>
                          {(p.achievements?.length || 0) > 0 && (
                            <span className="ach-row">
                              {p.achievements.map((a) => (
                                <span key={a} className="ach-badge" title={ACH_TITLES[a] || a}>
                                  {ACH_ICONS[a] || '🏆'}
                                </span>
                              ))}
                            </span>
                          )}
                          <b className="podium-pts">{p.points}</b>
                          {p.id === state.championId && <span>👑</span>}
                        </div>
                      ))}
                  </div>
                )}
                <button className="btn primary" onClick={actions.rematch}>Реванш!</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {menu && state.phase === 'round' && (
        <PowerOverlay state={state} meId={me.id} menu={menu} setMenu={setMenu} actions={actions} nameOf={nameOf} />
      )}
      {menu === 'check' && state.phase === 'round' && <CheckOverlay setMenu={setMenu} actions={actions} />}

      <div className="reaction-layer">
        {reactions.map((r) => (
          <span className="reaction-float" key={r.id} style={{ left: `${r.left}%` }}>
            {r.emoji}
          </span>
        ))}
      </div>

      <Toast toasts={toasts} />
    </div>
  );
}

// хост нужен только для настроек лобби (очки до победы)
function isHost(state, me) {
  return state.hostId === me?.id;
}
