import { useEffect, useState } from 'react';
import { initPlayer, isDiscord, shouldParty } from './discord/discord.js';
import SoloGame from './components/SoloGame.jsx';
import PartyGame from './components/PartyGame.jsx';
import { Splash, Denied } from './components/Splash.jsx';

export default function App() {
  const [phase, setPhase] = useState(() => (localStorage.getItem('moloko-18') ? 'game' : 'splash'));
  const [me, setMe] = useState(null);
  const [party, setParty] = useState(() => shouldParty());

  useEffect(() => {
    const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
    const timer = setInterval(ping, 4 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase === 'game' && party && !me) {
      initPlayer(true)
        .then(setMe)
        .catch(() => setMe({ id: 'anon', name: 'Анонимная корова', avatar: null }));
    }
  }, [phase, party, me]);

  const switchMode = (toParty) => {
    if (isDiscord) return;
    setParty(toParty);
    const url = new URL(window.location.href);
    if (toParty) url.searchParams.set('party', '1');
    else url.searchParams.delete('party');
    window.history.replaceState({}, '', url);
  };

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
      {phase === 'game' &&
        (party ? (
          <PartyGame me={me} onSwitchSolo={!isDiscord ? () => switchMode(false) : null} />
        ) : (
          <SoloGame onSwitchParty={!isDiscord ? () => switchMode(true) : null} />
        ))}
    </div>
  );
}
