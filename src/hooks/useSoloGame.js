import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateGuess, isValidWord, keyboardMarks, normalizeWord, pickWord } from '../game/logic.js';
import { line, soloLineFor } from '../game/lines.js';
import { loadStats, recordResult } from '../stats.js';

const MAX_ROWS = 6;
const FLIP_MS = 5 * 280 + 400; // длительность анимации раскрытия ряда

export function useSoloGame() {
  const answerRef = useRef(pickWord());
  const [rows, setRows] = useState([]);
  const [cur, setCur] = useState('');
  const [status, setStatus] = useState('playing'); // playing | won | lost
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState(null);
  const [cowText, setCowText] = useState(() => line('soloStart'));
  const [stats, setStats] = useState(loadStats);
  const revealingRef = useRef(false);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const pressKey = useCallback(
    (ch) => {
      if (revealingRef.current || status !== 'playing') return;
      setCur((c) => (c.length < 5 ? c + ch : c));
    },
    [status],
  );

  const pressBack = useCallback(() => {
    if (revealingRef.current || status !== 'playing') return;
    setCur((c) => c.slice(0, -1));
  }, [status]);

  const pressEnter = useCallback(() => {
    if (revealingRef.current || status !== 'playing') return;
    const word = normalizeWord(cur);
    if (word.length < 5) {
      setShake((s) => s + 1);
      setToast({ id: Date.now(), text: 'Слово из 5 букв, солнышко' });
      return;
    }
    if (!isValidWord(word)) {
      setShake((s) => s + 1);
      const l = line('invalidWord');
      setToast({ id: Date.now(), text: l });
      setCowText(l);
      return;
    }

    revealingRef.current = true;
    const marks = evaluateGuess(word, answerRef.current);
    setRows((r) => [...r, { w: word, marks }]);
    setCur('');

    setTimeout(() => {
      revealingRef.current = false;
      const attempts = rows.length + 1;
      if (word === answerRef.current) {
        setStatus('won');
        setCowText(line('win'));
        setStats(recordResult(true, attempts));
      } else if (attempts >= MAX_ROWS) {
        setStatus('lost');
        setCowText(line('lose', { WORD: answerRef.current.toUpperCase() }));
        setStats(recordResult(false));
      } else {
        setCowText(line(soloLineFor(marks)));
      }
    }, FLIP_MS);
  }, [cur, rows, status]);

  const restart = useCallback(() => {
    revealingRef.current = false;
    answerRef.current = pickWord();
    setRows([]);
    setCur('');
    setStatus('playing');
    setCowText(line('soloStart'));
  }, []);

  return {
    rows,
    cur,
    status,
    shake,
    toast,
    cowText,
    stats,
    maxRows: MAX_ROWS,
    answer: status === 'playing' ? null : answerRef.current,
    marks: keyboardMarks(rows),
    pressKey,
    pressBack,
    pressEnter,
    restart,
  };
}
