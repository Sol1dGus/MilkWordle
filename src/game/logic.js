import { VALID_WORDS, VALID_ANSWERS } from './words.js';
import { ANSWERS_EN, EXTRA_EN } from './words-en.js';
import { ANSWERS_EN_6, EXTRA_EN_6, ANSWERS_EN_7, EXTRA_EN_7 } from './words-en67.js';
import { ANSWERS_6, EXTRA_6, ANSWERS_7, EXTRA_7 } from './words-ru67.js';

export const LANGS = { ru: 'Русский', en: 'English' };
export const WORD_LENGTHS = [5, 6, 7];

// RU словари по длинам: 5 — курированный список, 6/7 — сгенерированные
const ANSWERS_RU = { 5: [...VALID_ANSWERS], 6: ANSWERS_6, 7: ANSWERS_7 };
const GUESS_RU = {
  5: [...VALID_WORDS],
  6: [...new Set([...ANSWERS_6, ...EXTRA_6])],
  7: [...new Set([...ANSWERS_7, ...EXTRA_7])],
};
const VALID_ANSWERS_RU = {};
const VALID_WORDS_RU = {};
for (const len of WORD_LENGTHS) {
  VALID_ANSWERS_RU[len] = new Set(ANSWERS_RU[len].filter((w) => w.length === len));
  VALID_WORDS_RU[len] = new Set(GUESS_RU[len].filter((w) => w.length === len));
}

// EN словари по длинам: 5 — официальный Wordle, 6/7 — сгенерированные (частые + полный словарь)
const ANSWERS_EN_BY_LEN = { 5: ANSWERS_EN, 6: ANSWERS_EN_6, 7: ANSWERS_EN_7 };
const GUESS_EN_BY_LEN = {
  5: [...new Set([...ANSWERS_EN, ...EXTRA_EN])],
  6: [...new Set([...ANSWERS_EN_6, ...EXTRA_EN_6])],
  7: [...new Set([...ANSWERS_EN_7, ...EXTRA_EN_7])],
};
const VALID_ANSWERS_EN_LEN = {};
const VALID_WORDS_EN_LEN = {};
for (const len of WORD_LENGTHS) {
  VALID_ANSWERS_EN_LEN[len] = new Set(ANSWERS_EN_BY_LEN[len].filter((w) => w.length === len));
  VALID_WORDS_EN_LEN[len] = new Set(GUESS_EN_BY_LEN[len].filter((w) => w.length === len));
}

// Приводим введенное слово к каноническому виду по языку
export function normalizeWord(raw, lang = 'ru', length = 5) {
  const s = String(raw || '').toLowerCase();
  if (lang === 'en') return s.replace(/[^a-z]/g, '').slice(0, length);
  return s.replace(/ё/g, 'е').replace(/[^а-я]/g, '').slice(0, length);
}

export function isValidWord(word, lang = 'ru', length = 5) {
  const w = normalizeWord(word, lang, length);
  if (w.length !== length) return false;
  return lang === 'en'
    ? VALID_WORDS_EN_LEN[length]?.has(w) ?? false
    : VALID_WORDS_RU[length]?.has(w) ?? false;
}

export function getAnswerList(lang = 'ru', length = 5) {
  if (lang === 'en') {
    const pool = [...(VALID_ANSWERS_EN_LEN[length] ?? [])];
    return pool.length >= 10 ? pool : [...(VALID_WORDS_EN_LEN[length] ?? [])];
  }
  const pool = [...(VALID_ANSWERS_RU[length] ?? [])];
  return pool.length >= 10 ? pool : [...(VALID_WORDS_RU[length] ?? [])];
}

// Загадываем случайное слово по языку и длине (поддерживает вызов pickWord(lang, len) и старый pickWord(lang, _, len))
export function pickWord(lang = 'ru', lengthOrLegacy = 5, maybeLength = 5) {
  const length = typeof lengthOrLegacy === 'number' ? lengthOrLegacy : maybeLength;
  const list = getAnswerList(lang, length);
  return list[Math.floor(Math.random() * list.length)];
}

// Ключ сегодняшнего дня YYYY-MM-DD (по локальному времени)
export function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Детерминированное «Слово дня» по дате, языку и длине слова
export function pickDailyWord(lang = 'ru', length = 5, dateKey = getTodayKey()) {
  const list = getAnswerList(lang, length);
  const seedStr = `moloko-daily:${dateKey}:${lang}:${length}`;
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return list[h % list.length];
}

// Ценность тика: угадал на 1-м тике — 32 очка, на 6-м — 1
export function tickValue(tick) {
  return 2 ** (6 - Math.min(6, Math.max(1, tick)));
}

// Слова-кандидаты, совместимые со всеми открытыми данными (для ботов и подсказок)
export function consistentWords(rows = [], reveals = [], exclude = new Set(), lang = 'ru', length = 5) {
  const pool = getAnswerList(lang, length);
  const result = [];
  for (const w of pool) {
    if (exclude.has(w)) continue;
    if (reveals.some((r) => (r.atPos === false ? w[r.pos] === r.letter : r.pos !== undefined ? w[r.pos] !== r.letter : r.inWord === true ? !w.includes(r.letter) : r.inWord === false ? w.includes(r.letter) : false))) continue;
    if (rows.some((row) => {
      if (row.old) return false;
      const marks = evaluateGuess(w, row.w);
      // внимание: evaluateGuess(guess, answer) — первым аргументом идет догадка row.w, вторым кандидат w!
      const candidateMarks = evaluateGuess(row.w, w);
      return candidateMarks.join('') !== row.marks.join('');
    })) continue;
    result.push(w);
    if (result.length >= 400) break;
  }
  return result;
}

// Оценка попытки с честным учетом повторяющихся букв:
// 1) сначала помечаем все зеленые (буква на своем месте) и "расходуем" буквы ответа
// 2) оставшиеся буквы попытки ищем в остатке ответа — желтые
// Возвращает массив меток: 'correct' | 'present' | 'absent'
export function evaluateGuess(guess, answer) {
  const len = answer.length;
  const marks = new Array(len).fill('absent');
  const guessLetters = [...guess];
  const answerLetters = [...answer];
  const leftover = [];

  for (let i = 0; i < len; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      marks[i] = 'correct';
      answerLetters[i] = null;
    } else {
      leftover.push(i);
    }
  }
  for (const i of leftover) {
    const idx = answerLetters.indexOf(guessLetters[i]);
    if (idx !== -1) {
      marks[i] = 'present';
      answerLetters[idx] = null;
    }
  }
  return marks;
}

// Сводка по клавиатуре: лучшая метка для каждой буквы из всех попыток
export function keyboardMarks(rows) {
  const rank = { absent: 0, present: 1, correct: 2 };
  const best = {};
  for (const row of rows) {
    [...row.w].forEach((ch, i) => {
      const m = row.marks[i];
      if (!best[ch] || rank[m] > rank[best[ch]]) best[ch] = m;
    });
  }
  return best;
}
