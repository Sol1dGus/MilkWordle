import { useCallback, useEffect, useRef, useState } from 'react';
import {
  evaluateGuess,
  getTodayKey,
  isValidWord,
  keyboardMarks,
  normalizeWord,
  pickDailyWord,
  pickWord,
} from '../game/logic.js';
import { line, soloLineFor } from '../game/lines.js';
import { sfx } from '../game/sfx.js';
import { loadStats, recordResult } from '../stats.js';

const MAX_ROWS = 6;

function dailyStorageKey(lang, wordLen, dateKey = getTodayKey()) {
  return `moloko-daily:${dateKey}:${lang}:${wordLen}`;
}

function loadDailyState(lang, wordLen) {
  try {
    const raw = localStorage.getItem(dailyStorageKey(lang, wordLen));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.rows) && parsed.status) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function saveDailyState(lang, wordLen, data) {
  try {
    localStorage.setItem(dailyStorageKey(lang, wordLen), JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function useSoloGame(lang = 'ru', wordLen = 5, mode = 'endless') {
  const answerRef = useRef(
    mode === 'daily' ? pickDailyWord(lang, wordLen) : pickWord(lang, wordLen),
  );
  const [rows, setRows] = useState([]);
  const [cells, setCells] = useState(() => Array(wordLen).fill(''));
  const [cursorPos, setCursorPos] = useState(0);
  const [status, setStatus] = useState('playing'); // playing | won | lost
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState(null);
  const [cowText, setCowText] = useState(() => line('soloStart'));
  const [stats, setStats] = useState(loadStats);
  const [gameSeq, setGameSeq] = useState(0);
  const revealingRef = useRef(false);

  const pushToast = useCallback((text) => {
    setToast({ id: Date.now() + Math.random(), text });
  }, []);

  // смена языка, длины или режима (обычный / слово дня)
  useEffect(() => {
    revealingRef.current = false;
    setCells(Array(wordLen).fill(''));
    setCursorPos(0);
    setGameSeq((s) => s + 1);
    if (mode === 'daily') {
      answerRef.current = pickDailyWord(lang, wordLen);
      const saved = loadDailyState(lang, wordLen);
      if (saved) {
        setRows(saved.rows);
        setStatus(saved.status);
        setCowText(saved.cowText || line('soloStart'));
        return;
      }
    } else {
      answerRef.current = pickWord(lang, wordLen);
    }
    setRows([]);
    setStatus('playing');
    setCowText(line('soloStart'));
  }, [lang, wordLen, mode]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const selectCell = useCallback(
    (idx) => {
      if (revealingRef.current || status !== 'playing') return;
      if (idx >= 0 && idx < wordLen) setCursorPos(idx);
    },
    [status, wordLen],
  );

  const moveCursor = useCallback(
    (delta) => {
      if (revealingRef.current || status !== 'playing') return;
      setCursorPos((p) => Math.max(0, Math.min(wordLen - 1, p + delta)));
    },
    [status, wordLen],
  );

  const pressKey = useCallback(
    (ch) => {
      if (revealingRef.current || status !== 'playing') return;
      setCells((prev) => {
        const next = [...prev];
        const pos = Math.min(wordLen - 1, Math.max(0, cursorPos));
        next[pos] = ch;
        let nextPos = pos;
        const emptyAfter = next.findIndex((c, i) => i > pos && !c);
        if (emptyAfter !== -1) nextPos = emptyAfter;
        else if (pos < wordLen - 1) nextPos = pos + 1;
        setCursorPos(nextPos);
        return next;
      });
    },
    [status, wordLen, cursorPos],
  );

  const pressBack = useCallback(() => {
    if (revealingRef.current || status !== 'playing') return;
    setCells((prev) => {
      const next = [...prev];
      const pos = Math.min(wordLen - 1, Math.max(0, cursorPos));
      if (next[pos]) {
        next[pos] = '';
      } else if (pos > 0) {
        next[pos - 1] = '';
        setCursorPos(pos - 1);
      }
      return next;
    });
  }, [status, wordLen, cursorPos]);

  const pressEnter = useCallback(() => {
    if (revealingRef.current || status !== 'playing') return;
    if (cells.some((c) => !c)) {
      setShake((s) => s + 1);
      pushToast(
        lang === 'en'
          ? `Type a ${wordLen}-letter word, sweetie`
          : `Слово из ${wordLen} букв, солнышко`,
      );
      return;
    }
    const word = normalizeWord(cells.join(''), lang, wordLen);
    if (word.length < wordLen) {
      setShake((s) => s + 1);
      pushToast(
        lang === 'en'
          ? `Type a ${wordLen}-letter word, sweetie`
          : `Слово из ${wordLen} букв, солнышко`,
      );
      return;
    }
    if (!isValidWord(word, lang, wordLen)) {
      setShake((s) => s + 1);
      const l = lang === 'en' ? "I don't know this word, weirdo." : line('invalidWord');
      pushToast(l);
      setCowText(l);
      return;
    }

    revealingRef.current = true;
    const marks = evaluateGuess(word, answerRef.current);
    const nextRows = [...rows, { w: word, marks }];
    setRows(nextRows);
    setCells(Array(wordLen).fill(''));
    setCursorPos(0);

    for (let i = 0; i < wordLen; i++) {
      setTimeout(() => sfx.flip(i), i * 240);
    }
    if (marks.some((m) => m === 'correct')) {
      setTimeout(() => sfx.hit(), wordLen * 240);
    }

    const flipMs = wordLen * 260 + 350;
    setTimeout(() => {
      revealingRef.current = false;
      const attempts = nextRows.length;
      let nextStatus = 'playing';
      let nextCow = cowText;
      if (word === answerRef.current) {
        sfx.win();
        nextStatus = 'won';
        nextCow = line('win');
        setStatus('won');
        setCowText(nextCow);
        setStats(recordResult(true, attempts));
      } else if (attempts >= MAX_ROWS) {
        sfx.lose();
        nextStatus = 'lost';
        nextCow = line('lose', { WORD: answerRef.current.toUpperCase() });
        setStatus('lost');
        setCowText(nextCow);
        setStats(recordResult(false));
      } else {
        nextCow = line(soloLineFor(marks));
        setCowText(nextCow);
      }
      if (mode === 'daily') {
        saveDailyState(lang, wordLen, { rows: nextRows, status: nextStatus, cowText: nextCow });
      }
    }, flipMs);
  }, [cells, rows, status, lang, wordLen, mode, cowText, pushToast]);

  const restart = useCallback(() => {
    revealingRef.current = false;
    answerRef.current = pickWord(lang, wordLen);
    setRows([]);
    setCells(Array(wordLen).fill(''));
    setCursorPos(0);
    setGameSeq((s) => s + 1);
    setStatus('playing');
    setCowText(line('soloStart'));
  }, [lang, wordLen]);

  return {
    lang,
    wordLen,
    mode,
    rows,
    cur: cells.join(''),
    cells,
    cursorPos,
    selectCell,
    moveCursor,
    gameSeq,
    status,
    shake,
    toast,
    pushToast,
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
