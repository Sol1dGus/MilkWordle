// Русские словари для режимов на 6 и 7 букв.
// Источник: существительные Badestrand/russian-dictionary (sg_nom),
// частотность hermitdave/FrequencyWords (ru_50k) — частые идут в ответы.
// Если сеть недоступна — запасные мини-списки (он же ответы, он же попытки).
// Запуск: npm run build:dicts-ru
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'game', 'words-ru67.js');

const NOUN_URLS = [
  'https://raw.githubusercontent.com/Badestrand/russian-dictionary/master/nouns.csv',
  'https://cdn.jsdelivr.net/gh/Badestrand/russian-dictionary@master/nouns.csv',
];
const FREQ_URLS = [
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt',
  'https://cdn.jsdelivr.net/gh/hermitdave/FrequencyWords@master/content/2018/ru/ru_50k.txt',
];

// запасные списки частых слов: он же ответы, он же разрешенные попытки
const FALLBACK_6 = [
  'верблюд', 'ворона', 'девица', 'диван6', 'жемчуг', 'забава', 'запаха', 'звезда',
  'зеркал', 'играет', 'кабина', 'камень', 'капуст', 'карета', 'кинолог', 'колесо',
  'корзин', 'король', 'кошело', 'лапушка', 'лебедь', 'лесник', 'лентяй', 'малина',
  'мастак', 'медвед', 'метель', 'мечта6', 'морков', 'наград', 'напиток', 'наука6',
].filter((w) => /^[а-я]{6}$/.test(w));
const FALLBACK_7 = [
  'автомоб', 'берлога', 'библиот', 'бурундук', 'ведро7', 'ветерина', 'виски7',
  'гребешок', 'деревня', 'десерт7', 'дятел7', 'ежевика', 'жаворон', 'желудок',
  'загадка', 'замара', 'капот7', 'коврига', 'колокол', 'корова7', 'кролик',
].filter((w) => /^[а-я]{7}$/.test(w));
const FALLBACK = { 6: FALLBACK_6, 7: FALLBACK_7 };

async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {
      /* пробуем следующий источник */
    }
  }
  return null;
}

// буква «ё» → «е», снятие ударений — как принято в русских вордлях
const clean = (s) =>
  s.toLowerCase().replace(/['\u2019\u0301]/g, '').replace(/ё/g, 'е');

const nouns = await fetchFirst(NOUN_URLS);
const freqText = await fetchFirst(FREQ_URLS);

const result = {};
if (nouns && freqText) {
  const freq = new Map(
    freqText.split('\n').map((l) => {
      const [w, c] = l.trim().split(' ');
      return [w, Number(c) || 0];
    }),
  );
  const pools = { 6: new Map(), 7: new Map() };
  for (const line of nouns.split('\n').slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 11) continue;
    const bare = cols[0] || '';
    // существительные только мн. числа (пл_only/sg_only) и имена собственные — мимо
    if (cols[8] === '1' || cols[9] === '1') continue;
    if (/[A-ZА-Я]/.test(bare[0] || '')) continue;
    const w = clean(cols[10] || '');
    if (!/^[а-я]{6,7}$/.test(w)) continue;
    if (!pools[w.length].has(w)) pools[w.length].set(w, freq.get(w) || 0);
  }
  for (const len of [6, 7]) {
    const all = [...pools[len].keys()];
    result[len] = {
      answers: all.filter((w) => pools[len].get(w) >= 10),
      extra: all,
    };
  }
}

const chunks = [
  '// Словари 6 и 7 букв. Генерируется скриптом scripts/build-dicts-ru.mjs — не править руками.',
  '// answers — частые существительные (из них загадываем), extra — все существительные (валидация попыток).',
  '// Буква «ё» заменена на «е», ударения сняты.',
];
for (const len of [6, 7]) {
  const online = result[len];
  const answers = online && online.answers.length >= 50 ? online.answers : FALLBACK[len];
  const extra = online && online.extra.length >= 200 ? online.extra : FALLBACK[len];
  if (!online || answers.length < 50) {
    chunks.push('// ВНИМАНИЕ: сеть была недоступна — использован запасной мини-список.');
  }
  chunks.push(`export const ANSWERS_${len} = ${JSON.stringify(answers)};`);
  chunks.push(
    `export const EXTRA_${len} = ${JSON.stringify([...new Set([...answers, ...extra])])};`,
  );
}
await writeFile(OUT, chunks.join('\n\n') + '\n', 'utf8');
console.log(
  'words-ru67.js:',
  [6, 7].map((l) => `${l} букв: ${result[l]?.answers?.length ?? 'fallback'}/${result[l]?.extra?.length ?? ''}`).join(', '),
);
