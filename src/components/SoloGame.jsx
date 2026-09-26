import { useEffect, useState } from 'react';
import { useSoloGame } from '../hooks/useSoloGame.js';
import { usePhysicalInput } from '../hooks/usePhysicalInput.js';
import Board from './Board.jsx';
import Keyboard from './Keyboard.jsx';
import Cow from './Cow.jsx';
import Toast from './Toast.jsx';

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

export default function SoloGame() {
  const g = useSoloGame();
  const [modal, setModal] = useState(null); // null | 'stats' | 'over'
  usePhysicalInput(g.pressKey, g.pressEnter, g.pressBack);

  const mood = g.status === 'won' ? 'happy' : g.status === 'lost' ? 'sad' : 'idle';

  // Открыть финальное окно, когда партия закончилась
  useEffect(() => {
    if (g.status !== 'playing') setModal('over');
  }, [g.status]);

  return (
    <div className="game">
      <header className="top">
        <button className="icon-btn" onClick={() => setModal('stats')} title="Статистика">📊</button>
        <h1 className="logo">МОЛОКО</h1>
        <span className="top-spacer" />
      </header>

      <Cow text={g.cowText} mood={mood} />

      <Board rows={g.rows} cur={g.cur} status={g.status} shake={g.shake} maxRows={g.maxRows} />

      <Keyboard marks={g.marks} onKey={g.pressKey} onEnter={g.pressEnter} onBack={g.pressBack} disabled={g.status !== 'playing'} />

      <Toast toasts={g.toast ? [g.toast] : []} />

      {modal === 'stats' && g.status === 'playing' && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Твоя история с Зорькой</h2>
            <StatsGrid stats={g.stats} />
            <button className="btn primary" onClick={() => setModal(null)}>Погнали дальше</button>
          </div>
        </div>
      )}

      {modal === 'over' && g.status !== 'playing' && (
        <div className="overlay">
          <div className="panel">
            <h2>{g.status === 'won' ? 'Зорька в восторге!' : 'Мимо вымени…'}</h2>
            {g.status === 'lost' && <p className="word-reveal">Слово было: <b>{g.answer?.toUpperCase()}</b></p>}
            <p className="over-line">{g.cowText}</p>
            <StatsGrid stats={g.stats} />
            <button className="btn primary" onClick={() => { g.restart(); setModal(null); }}>
              Играть еще
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
