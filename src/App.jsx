import { useEffect, useState } from 'react';
import { initPlayer, shouldParty } from './discord/discord.js';
import SoloGame from './components/SoloGame.jsx';
import PartyGame from './components/PartyGame.jsx';
import { Splash, Denied } from './components/Splash.jsx';

export default function App() {
  const [phase, setPhase] = useState(() => (localStorage.getItem('moloko-18') ? 'game' : 'splash'));
  const [me, setMe] = useState(null);
  const party = shouldParty();

  useEffect(() => {
    if (phase === 'game' && party && !me) {
      initPlayer()
        .then(setMe)
        .catch(() => setMe({ id: 'anon', name: 'Анонимная корова', avatar: null }));
    }
  }, [phase, party, me]);

  return (
    <div className="app">
      {phase === 'splash' && (
        <Splash
          onAccept={() => {
            localStorage.setItem('moloko-18', '1');
            setPhase('game');
          }}
          onDecline={() => setPhase('denied')}
        />
      )}
      {phase === 'denied' && <Denied />}
      {phase === 'game' && (party ? <PartyGame me={me} /> : <SoloGame />)}
    </div>
  );
}
