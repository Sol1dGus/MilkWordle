import { useCallback, useEffect, useRef, useState } from 'react';

// Клиент комнаты. Сервер — единственный источник правды: рассылает полный
// снимок состояния после каждого события, клиент только рисует.
// Приватные данные (проверки букв, шепот) приходят отдельными сообщениями
// и в общий снапшот не попадают.
export function useParty(me) {
  const wsRef = useRef(null);
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [privateData, setPrivateData] = useState({ hints: [], whispers: [] });

  const pushToast = useCallback((text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ t: 'hello', id: me.id, name: me.name, avatar: me.avatar }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'state') setState(msg.state);
      else if (msg.t === 'toast') pushToast(msg.text);
      else if (msg.t === 'private') {
        setPrivateData((prev) => ({
          hints: msg.data.hints ?? prev.hints,
          whispers: msg.data.whispers ?? prev.whispers,
        }));
      } else if (msg.t === 'react') {
        const id = Math.random().toString(36).slice(2);
        setReactions((r) => [...r, { id, emoji: msg.emoji, left: 10 + Math.random() * 70 }]);
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2600);
      }
    };
    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [me, pushToast]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const actions = {
    start: () => send({ t: 'start' }),
    setPoints: (pointsToWin) => send({ t: 'settings', pointsToWin }),
    setTheme: (theme) => send({ t: 'settings', theme }),
    setTeamMode: (teamMode) => send({ t: 'settings', teamMode }),
    guess: (word) => send({ t: 'guess', word }),
    next: () => send({ t: 'next' }),
    ready: () => send({ t: 'ready' }),
    rematch: () => send({ t: 'rematch' }),
    react: (emoji) => send({ t: 'react', emoji }),
    drawPick: (side) => send({ t: 'drawPick', side }),
    smkPick: (sym) => send({ t: 'smkPick', sym }),
    pickPos: (pos) => send({ t: 'pickPos', pos }),
    power: (kind, extra = {}) => send({ t: 'power', kind, ...extra }),
  };

  const clearPrivate = useCallback(() => {
    setPrivateData({ hints: [], whispers: [] });
  }, []);

  return { state, connected, toasts, reactions, privateData, clearPrivate, pushToast, actions };
}
