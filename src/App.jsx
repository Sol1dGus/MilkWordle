import { useEffect, useState } from 'react';
import { initPlayer, isDiscord, shouldParty } from './discord/discord.js';
import SoloGame from './components/SoloGame.jsx';
import PartyGame from './components/PartyGame.jsx';

export default function App() {
  const [me, setMe] = useState(null);
  const [party, setParty] = useState(() => shouldParty());

  useEffect(() => {
    const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
    const timer = setInterval(ping, 4 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (party && !me) {
      initPlayer(true)
        .then(setMe)
        .catch(() => setMe({ id: 'anon', name: 'Фермер', avatar: null }));
    }
  }, [party, me]);

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
      {party ? (
        <PartyGame me={me} onSwitchSolo={!isDiscord ? () => switchMode(false) : null} />
      ) : (
        <SoloGame onSwitchParty={!isDiscord ? () => switchMode(true) : null} />
      )}
    </div>
  );
}
