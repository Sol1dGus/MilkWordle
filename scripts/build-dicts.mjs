// Расширяет словарь допустимых попыток: скачивает открытый список русских
// существительных (Harrix/Russian-Nouns), фильтрует 5-буквенные и пишет
// src/game/words-extra.json. Если сети нет — просто оставляет старый файл.
// Запуск: npm run build:dicts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'game', 'words-extra.js');
const URLS = [
  'https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt',
  'https://cdn.jsdelivr.net/gh/Harrix/Russian-Nouns@main/dist/russian_nouns.txt',
];

const norm = (w) => w.toLowerCase().replace(/ё/g, 'е').trim();

let raw = null;
for (const url of URLS) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    raw = await r.text();
    console.log(`Скачано с ${url}`);
    break;
  } catch (e) {
    console.log(`Не вышло (${url}): ${e.message}`);
  }
}

if (!raw) {
  console.log('Сеть недоступна — существующий words-extra.json не трогаем.');
  process.exit(0);
}

const words = [
  ...new Set(
    raw
      .split(/\r?\n/)
      .map(norm)
      .filter((w) => /^[а-я]{5}$/.test(w)),
  ),
].sort();

// Пишем JS-модуль: его одинаково понимают Vite и Node (JSON-импорт в Node
// требует атрибутов, не хочу зависимости от версии)
await writeFile(
  OUT,
  `// Автогенерируется scripts/build-dicts.mjs (Harrix/Russian-Nouns). Не править руками.\nexport default ${JSON.stringify(words)};\n`,
  'utf8',
);
console.log(`Сохранено 5-буквенных слов: ${words.length} -> ${OUT}`);
