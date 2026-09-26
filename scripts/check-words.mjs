import { ANSWERS, VALID_WORDS } from '../src/game/words.js';

const badLength = ANSWERS.filter((w) => w.length !== 5);
const dupes = [...new Set(ANSWERS.filter((w, i) => ANSWERS.indexOf(w) !== i))];

console.log(`Загадываемых слов: ${ANSWERS.length}`);
console.log(`Допустимых попыток: ${VALID_WORDS.size}`);
if (badLength.length) console.log('НЕ 5 БУКВ:', badLength);
if (dupes.length) console.log('ДУБЛИ:', dupes);

if (badLength.length || dupes.length) {
  console.log('Проблемы найдены!');
  process.exit(1);
}
console.log('Словарь в порядке.');
