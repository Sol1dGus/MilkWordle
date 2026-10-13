import { useCallback, useEffect, useRef, useState } from 'react';

export function useParty(me) {
  const wsRef = useRef(null);
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [privateData, setPrivateData] = useState({ myRows: [], hints: [], peeks: [] });
  const [left, setLeft] = useState(false); // вышел из комнаты в меню
  const [roomList, setRoomList] = useState([]);
  const [inRoom, setInRoom] = useState(false); // мы внутри какой-то комнаты

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
      if (msg.t === 'state') {
        setState(msg.state);
        setInRoom(Boolean(msg.state.roomId));
      }
      if (msg.t === 'roomList') setRoomList(msg.rooms || []);
      if (msg.t === 'toast') pushToast(msg.text);
      if (msg.t === 'react') {
        const id = Math.random().toString(36).slice(2);
        const left = 15 + Math.floor(Math.random() * 70);
        setReactions((r) => [...r, { id, emoji: msg.emoji, from: msg.from, left }]);
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2500);
      }
      if (msg.t === 'private') {
        // переподключение в комнату по hello (refresh страницы)
        if (msg.data.rejoined) setInRoom(true);
        // подсмотренные слова (перк «Прошлые надои») — копятся карточками
        if (msg.data.peek) {
          setPrivateData((prev) => ({ ...prev, peeks: [...(prev.peeks || []), msg.data.peek] }));
        }
        if (msg.data.myRows || msg.data.hints) {
          setPrivateData((prev) => ({
            ...prev,
            myRows: msg.data.myRows ?? prev.myRows,
            hints: msg.data.hints ?? prev.hints,
          }));
        }
      }
    };
    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [me, pushToast]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const actions = {
    createRoom: (name, visibility, isPrivate = false) =>
      send({ t: 'createRoom', name, visibility, isPrivate, playerName: me?.name, avatar: me?.avatar }),
    deleteRoom: () => {
      setState(null);
      setInRoom(false);
      setPrivateData({ myRows: [], hints: [], peeks: [] });
      send({ t: 'deleteRoom' });
    },
    joinRoom: (roomId) => send({ t: 'joinRoom', roomId, playerName: me?.name, avatar: me?.avatar }),
    leaveRoom: () => send({ t: 'leaveRoom' }),
    start: () => send({ t: 'start' }),
    setPoints: (pointsToWin) => send({ t: 'settings', pointsToWin }),
    setLang: (lang) => send({ t: 'settings', lang }),
    setWordLength: (wordLength) => send({ t: 'settings', wordLength }),
    setVisibility: (visibility) => send({ t: 'settings', visibility }),
    setTickSeconds: (tickSeconds) => send({ t: 'settings', tickSeconds }),
    setEventsEnabled: (eventsEnabled) => send({ t: 'settings', eventsEnabled }),
    addBot: (difficulty = 'normal') => send({ t: 'addBot', difficulty }),
    setBotDifficulty: (botId, difficulty) => send({ t: 'setBotDifficulty', botId, difficulty }),
    removeBot: (botId) => send({ t: 'removeBot', botId }),
    guess: (word) => send({ t: 'guess', word }),
    ready: () => send({ t: 'ready' }),
    endMatch: () => send({ t: 'endMatch' }),
    rematch: () => send({ t: 'rematch' }),
    react: (emoji) => send({ t: 'react', emoji }),
    power: (kind, extra = {}) => send({ t: 'power', kind, ...extra }),
    // выход в меню: сервер сам разрулит хоста и тик; сокет оставляем жить,
    // чтобы снова создавать/искать комнаты без переподключения
    leave: () => {
      setLeft(true);
      setInRoom(false);
      setState(null);
      setPrivateData({ myRows: [], hints: [], peeks: [] });
      send({ t: 'leaveRoom' });
    },
  };

  const clearPrivate = useCallback(() => {
    setPrivateData({ myRows: [], hints: [], peeks: [] });
  }, []);

  return { state, connected, left, roomList, inRoom, toasts, reactions, privateData, clearPrivate, pushToast, actions };
}
