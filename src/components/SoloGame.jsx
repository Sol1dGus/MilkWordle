import { useEffect, useState } from 'react';
import { useSoloGame } from '../hooks/useSoloGame.js';
import { usePhysicalInput } from '../hooks/usePhysicalInput.js';
import { getTodayKey } from '../game/logic.js';
import { sfx } from '../game/sfx.js';
import Board from './Board.jsx';
import Keyboard from './Keyboard.jsx';
import Cow from './Cow.jsx';
import Toast from './Toast.jsx';

const MARK_EMOJI = { correct: '🟫', present: '🟨', absent: '⬜' };

function buildSoloResultText(g, mode) {
  const score = g.status === 'won' ? `${g.rows.length}/${g.maxRows}` : `X/${g.maxRows}`;
  const modeLabel = mode === 'daily' ? `Слово дня ${getTodayKey()}` : 'Соло';
  const lines = [`🥛 MilkWordle (${modeLabel} · ${g.wordLen} букв) — ${score}`];
  for (const row of g.rows) {
    lines.push(row.marks.map((m) => MARK_EMOJI[m]).join(''));
  }
  return lines.join('\n');
}

async function copySoloResult(text, pushToast) {
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

function StatsGrid({ stats }) {
  const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const maxDist = Math.max(1, ...stats.dist);
  return (
    <div className="stats">
      <div className="stats-row">
        <div><b>{stats.played}</b><span>игр</span></div>
        <div><b>{winPct}%</b><span>побед</span></div>
        <div><b>{stats.streak}</b><span>серия</span></div>
        <div><b>{stats.bestStreak}</b><span>рекорд</span></div>
      </div>
      <div className="dist">
        {stats.dist.map((n, i) => (
          <div className="dist-row" key={i}>
            <span className="dist-label">{i + 1}</span>
            <span className="dist-bar" style={{ '--w': `${(n / maxDist) * 100}%` }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SoloGame({ onSwitchParty }) {
  const [lang, setLang] = useState(() => localStorage.getItem('moloko-lang') || 'ru');
  const [wordLen, setWordLen] = useState(() => Number(localStorage.getItem('moloko-wordlen')) || 5);
  const [mode, setMode] = useState(() => localStorage.getItem('moloko-solo-mode') || 'endless');
  const [muted, setMuted] = useState(sfx.isMuted());
  const g = useSoloGame(lang, wordLen, mode);
  const [modal, setModal] = useState(null); // null | 'stats' | 'over'
  usePhysicalInput(g.pressKey, g.pressEnter, g.pressBack, lang, g.moveCursor);

  const mood = g.status === 'won' ? 'happy' : g.status === 'lost' ? 'sad' : 'idle';

  const toggleLang = () => {
    const next = lang === 'ru' ? 'en' : 'ru';
    localStorage.setItem('moloko-lang', next);
    setLang(next);
  };

  const changeLen = (n) => {
    localStorage.setItem('moloko-wordlen', String(n));
    setWordLen(n);
  };

  const changeMode = (m) => {
    localStorage.setItem('moloko-solo-mode', m);
    setMode(m);
  };

  // Открыть финальное окно, когда партия закончилась
  useEffect(() => {
    if (g.status !== 'playing') setModal('over');
    else setModal(null);
  }, [g.status, lang, wordLen, mode]);

  return (
    <div className="game">
      <header className="top">
        <div className="top-group">
          <button className="icon-btn" onClick={() => setModal('stats')} title="Статистика">📊</button>
          <button
            className="icon-btn"
            onClick={() => setMuted(sfx.toggleMute())}
            title={muted ? 'Включить звуки' : 'Выключить звуки'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
        <h1 className="logo">MilkWordle</h1>
        <div className="top-group">
          <button className="icon-btn" onClick={toggleLang} title="Язык слов">
            {lang === 'ru' ? '🇷🇺' : '🇬🇧'}
          </button>
          {onSwitchParty && (
            <button className="mode-pill-btn" onClick={onSwitchParty} title="Играть с друзьями в комнате">
              🐄 Комната
            </button>
          )}
        </div>
      </header>

      <Cow text={g.cowText} mood={mood} />

      <div className="solo-controls">
        <div className="points-picker solo-mode-picker">
          <button
            className={`chip-btn wide-chip ${mode === 'daily' ? 'on' : ''}`}
            onClick={() => changeMode('daily')}
            title="Одно общее слово в сутки для всех"
          >
            📅 Слово дня
          </button>
          <button
            className={`chip-btn wide-chip ${mode === 'endless' ? 'on' : ''}`}
            onClick={() => changeMode('endless')}
            title="Бесконечный режим со случайными словами"
          >
            ♾️ Обычный
          </button>
        </div>

        <div className="points-picker solo-len">
          <span>Букв:</span>
          {[5, 6, 7].map((n) => (
            <button
              key={n}
              className={`chip-btn ${wordLen === n ? 'on' : ''}`}
              title={`${n} букв`}
              onClick={() => changeLen(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <Board
        rows={g.rows}
        cur={g.cur}
        cells={g.cells}
        cursorPos={g.cursorPos}
        onSelectCell={g.selectCell}
        status={g.status}
        shake={g.shake}
        maxRows={g.maxRows}
        cols={wordLen}
      />

      <Keyboard
        lang={lang}
        marks={g.marks}
        resetKey={g.gameSeq}
        onKey={g.pressKey}
        onEnter={g.pressEnter}
        onBack={g.pressBack}
        disabled={g.status !== 'playing'}
      />

      <Toast toasts={g.toast ? [g.toast] : []} />

      {modal === 'stats' && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Твоя история с Зорькой</h2>
            <StatsGrid stats={g.stats} />
            <button className="btn primary" onClick={() => setModal(null)}>Погнали дальше</button>
          </div>
        </div>
      )}

      {modal === 'over' && g.status !== 'playing' && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>{g.status === 'won' ? 'Зорька в восторге!' : 'Мимо бидона…'}</h2>
            <p className="word-reveal">Слово: <b>{g.answer?.toUpperCase()}</b></p>
            <p className="over-line">{g.cowText}</p>
            <StatsGrid stats={g.stats} />
            <button
              className="btn ghost"
              onClick={() => copySoloResult(buildSoloResultText(g, mode), g.pushToast)}
            >
              📋 Скопировать результат
            </button>
            {mode === 'daily' ? (
              <>
                <p className="hint small">Слово дня на {wordLen} букв пройдено! Новое появится завтра.</p>
                <button className="btn primary" onClick={() => { changeMode('endless'); setModal(null); }}>
                  Перейти в бесконечный режим
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => { g.restart(); setModal(null); }}>
                Играть еще
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
