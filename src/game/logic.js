import { VALID_WORDS, VALID_ANSWERS, THEME_ANSWERS } from './words.js';

export const WORD_LENGTH = 5;

// Приводим введенное слово к каноническому виду: нижний регистр, ё -> е
export function normalizeWord(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я]/g, '')
    .slice(0, WORD_LENGTH);
}

export function isValidWord(word) {
  return VALID_WORDS.has(normalizeWord(word));
}

// Загадываем только частые слова — дичь из расширенного списка не пойдет.
// theme — ключ из THEMES ('all' | 'food' | ...); при бедном наборе фолбэк на все
export function pickWord(theme = 'all') {
  const themed = THEME_ANSWERS[theme];
  const pool = theme !== 'all' && Array.isArray(themed) && themed.length >= 10
    ? themed
    : [...VALID_ANSWERS];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Слова-кандидаты, совместимые со всеми открытыми данными (для «Шепота Зорьки»):
// для каждого ряда попытки повторная оценка кандидата против слова из ряда
// должна дать те же метки; открытые позиции обязаны совпадать
export function consistentWords(rows, reveals, exclude = new Set()) {
  const result = [];
  for (const w of VALID_WORDS) {
    if (exclude.has(w)) continue;
    if (reveals.some((r) => w[r.pos] !== r.letter)) continue;
    if (rows.some((row) => {
      const marks = evaluateGuess(w, row.w);
      return marks.join('') !== row.marks.join('');
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
  const marks = new Array(WORD_LENGTH).fill('absent');
  const guessLetters = [...guess];
  const answerLetters = [...answer];
  const leftover = [];

  for (let i = 0; i < WORD_LENGTH; i++) {
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
