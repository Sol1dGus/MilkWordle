// Английский словарь: разрешенные попытки — большой список Wordle-слов,
// ответы — курируемый список решений NYT. Если сеть недоступна —
// запасной список частых слов (он же становится списком ответов).
// Запуск: npm run build:dicts-en
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'game', 'words-en.js');

const ALLOWED_URLS = [
  'https://raw.githubusercontent.com/tabatkins/wordle-list/main/words',
  'https://cdn.jsdelivr.net/gh/tabatkins/wordle-list@main/words',
];
const ANSWERS_URLS = [
  'https://raw.githubusercontent.com/LaurentLessard/wordlesolver/main/solutions_nyt.txt',
  'https://cdn.jsdelivr.net/gh/LaurentLessard/wordlesolver@main/solutions_nyt.txt',
];

// запасной список частых слов: он же ответы, он же разрешенные попытки
const FALLBACK = [
  'about', 'above', 'abuse', 'actor', 'adapt', 'after', 'again', 'agent', 'agree', 'ahead',
  'alarm', 'album', 'alert', 'alien', 'alive', 'allow', 'alone', 'along', 'alter', 'angel',
  'anger', 'angle', 'ankle', 'apart', 'apple', 'apply', 'arena', 'argue', 'arise', 'armor',
  'aroma', 'arrow', 'aside', 'asset', 'audio', 'avoid', 'awake', 'award', 'aware', 'badly',
  'baker', 'basic', 'beach', 'beard', 'beast', 'begin', 'being', 'belly', 'below', 'bench',
  'berry', 'birth', 'black', 'blade', 'blame', 'bland', 'blank', 'blast', 'bleak', 'blend',
  'bless', 'blind', 'block', 'blood', 'bloom', 'blown', 'blues', 'blunt', 'board', 'boast',
  'bonus', 'boost', 'booth', 'bound', 'brain', 'brake', 'brand', 'brave', 'bread', 'break',
  'breed', 'brief', 'bring', 'broad', 'broke', 'brook', 'brown', 'brush', 'build', 'built',
  'bunch', 'burst', 'buyer', 'cabin', 'cable', 'candy', 'carry', 'catch', 'cause', 'chain',
  'chalk', 'charm', 'chart', 'chase', 'cheap', 'check', 'chess', 'chest', 'chief', 'child',
  'chili', 'choir', 'chose', 'chunk', 'cider', 'cigar', 'civic', 'civil', 'claim', 'clash',
  'class', 'clean', 'clear', 'clerk', 'click', 'cliff', 'climb', 'cling', 'cloak', 'clock',
  'close', 'cloth', 'cloud', 'coach', 'coast', 'cocoa', 'colon', 'color', 'comic', 'coral',
  'couch', 'could', 'count', 'court', 'cover', 'crane', 'crash', 'crazy', 'cream', 'creek',
  'crest', 'crime', 'crisp', 'cross', 'crowd', 'crown', 'crude', 'curve', 'cycle', 'daily',
  'dairy', 'dance', 'death', 'debut', 'decay', 'delay', 'depth', 'devil', 'diary', 'dirty',
  'disco', 'ditch', 'dizzy', 'dodge', 'doing', 'donor', 'dozen', 'draft', 'drain', 'drama',
  'drank', 'dream', 'dress', 'dried', 'drift', 'drink', 'drive', 'drove', 'dying', 'eager',
  'eagle', 'early', 'earth', 'eight', 'elite', 'empty', 'enemy', 'enjoy', 'enter', 'entry',
  'equal', 'equip', 'error', 'erupt', 'essay', 'event', 'every', 'exact', 'exist', 'extra',
  'faith', 'false', 'fault', 'favor', 'feast', 'fence', 'fever', 'fewer', 'fiber', 'field',
  'fifth', 'fifty', 'fight', 'final', 'first', 'flash', 'fleet', 'flesh', 'float', 'flood',
  'floor', 'flour', 'fluid', 'flute', 'focus', 'foggy', 'force', 'forge', 'forth', 'forty',
  'forum', 'found', 'frame', 'fraud', 'fresh', 'fried', 'front', 'frost', 'fruit', 'fully',
  'funny', 'gauge', 'ghost', 'giant', 'given', 'glass', 'globe', 'glory', 'glove', 'going',
  'goose', 'grace', 'grade', 'grain', 'grand', 'grant', 'grape', 'graph', 'grasp', 'grass',
  'grave', 'great', 'greed', 'green', 'greet', 'grief', 'grill', 'grind', 'groan', 'group',
  'guard', 'guess', 'guest', 'guide', 'guilt', 'happy', 'harsh', 'haste', 'hatch', 'hazel',
  'heart', 'heavy', 'hedge', 'hello', 'hence', 'horse', 'hotel', 'human', 'humor', 'hurry',
  'ideal', 'image', 'index', 'inner', 'input', 'issue', 'ivory', 'jelly', 'jewel', 'joint',
  'judge', 'juice', 'jumbo', 'kneel', 'knife', 'knock', 'known', 'label', 'labor', 'lance',
  'large', 'laser', 'later', 'laugh', 'layer', 'learn', 'lease', 'least', 'leave', 'legal',
  'lemon', 'level', 'light', 'lilac', 'limit', 'linen', 'liver', 'local', 'lodge', 'logic',
  'loose', 'lorry', 'loyal', 'lucky', 'lunar', 'lunch', 'lying', 'macro', 'magic', 'major',
  'maker', 'mango', 'maple', 'march', 'match', 'maybe', 'mayor', 'meant', 'medal', 'media',
  'melon', 'mercy', 'merge', 'merit', 'metal', 'meter', 'might', 'minor', 'minus', 'mixed',
  'model', 'moist', 'money', 'month', 'moral', 'motor', 'mount', 'mouse', 'mouth', 'movie',
  'music', 'naked', 'named', 'nasty', 'naval', 'nerve', 'never', 'newly', 'night', 'noble',
  'noise', 'north', 'noted', 'novel', 'nurse', 'occur', 'ocean', 'offer', 'often', 'olive',
  'onion', 'orbit', 'order', 'organ', 'other', 'otter', 'ought', 'outer', 'owner', 'paint',
  'panel', 'panic', 'paper', 'party', 'pasta', 'patch', 'pause', 'peace', 'pearl', 'pedal',
  'penny', 'phase', 'phone', 'photo', 'piano', 'piece', 'pilot', 'pinch', 'pitch', 'pizza',
  'place', 'plain', 'plane', 'plant', 'plate', 'plaza', 'plead', 'point', 'polar', 'porch',
  'pound', 'power', 'press', 'price', 'pride', 'prime', 'print', 'prize', 'probe', 'prone',
  'proof', 'proud', 'prove', 'pulse', 'punch', 'pupil', 'query', 'quest', 'queue', 'quick',
  'quiet', 'quilt', 'quite', 'quota', 'quote', 'radar', 'radio', 'raise', 'rally', 'ranch',
  'range', 'rapid', 'ratio', 'reach', 'react', 'ready', 'realm', 'rebel', 'refer', 'reign',
  'relax', 'relay', 'renew', 'reply', 'rider', 'ridge', 'rifle', 'right', 'rigid', 'rival',
  'river', 'roast', 'robin', 'robot', 'rocky', 'roman', 'rough', 'round', 'route', 'royal',
  'rural', 'salad', 'salon', 'sauce', 'scale', 'scare', 'scene', 'scope', 'score', 'scent',
  'scout', 'screw', 'sense', 'serve', 'seven', 'shade', 'shaft', 'shake', 'shall', 'shame',
  'shape', 'share', 'shark', 'sharp', 'sheep', 'sheet', 'shelf', 'shell', 'shift', 'shine',
  'shirt', 'shock', 'shore', 'short', 'shown', 'sight', 'silly', 'since', 'sixth', 'sixty',
  'skill', 'skirt', 'sleep', 'slice', 'slide', 'slope', 'small', 'smart', 'smell', 'smile',
  'smoke', 'snack', 'snake', 'solar', 'solid', 'solve', 'sorry', 'sound', 'south', 'space',
  'spare', 'spark', 'speak', 'speed', 'spell', 'spend', 'spice', 'spike', 'split', 'spoke',
  'sport', 'spray', 'squad', 'staff', 'stage', 'stake', 'stall', 'stamp', 'stand', 'start',
  'state', 'steak', 'steal', 'steam', 'steel', 'steep', 'steer', 'stern', 'stick', 'stiff',
  'still', 'stone', 'stood', 'store', 'storm', 'story', 'stove', 'strap', 'straw', 'strip',
  'study', 'stuff', 'style', 'sugar', 'suite', 'sunny', 'super', 'sweet', 'swept', 'swift',
  'swing', 'sword', 'table', 'taken', 'taste', 'teach', 'teeth', 'tempo', 'tenth', 'thank',
  'theft', 'their', 'theme', 'there', 'these', 'thick', 'thief', 'thigh', 'thing', 'think',
  'third', 'those', 'three', 'threw', 'throw', 'thumb', 'tiger', 'tight', 'times', 'tired',
  'title', 'toast', 'today', 'token', 'tooth', 'topic', 'total', 'touch', 'tough', 'tower',
  'toxic', 'trace', 'track', 'trade', 'trail', 'train', 'treat', 'trend', 'trial', 'tribe',
  'trick', 'tried', 'troop', 'truck', 'truly', 'trunk', 'trust', 'truth', 'tulip', 'twist',
  'ultra', 'uncle', 'under', 'union', 'unity', 'until', 'upper', 'upset', 'urban', 'urged',
  'usage', 'using', 'valid', 'value', 'video', 'viral', 'virus', 'visit', 'vital', 'vivid',
  'vocal', 'voice', 'voter', 'waste', 'watch', 'water', 'weird', 'wheel', 'where', 'which',
  'while', 'white', 'whole', 'whose', 'width', 'woman', 'world', 'worry', 'worse', 'worst',
  'worth', 'would', 'wound', 'wrist', 'write', 'wrong', 'wrote', 'young', 'youth', 'zebra',
  'zesty',
];

async function fetchList(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = (await r.text()).toLowerCase();
      // источники бывают построчные и JSON-подобные ("cigar", "rebut") —
      // вынимаем все буквенные токены и фильтруем длину
      const words = [...new Set(
        (text.match(/[a-z]+/g) || []).filter((w) => w.length === 5),
      )].sort();
      if (words.length > 100) return words;
      throw new Error('список подозрительно мал');
    } catch (e) {
      console.log(`Не вышло (${url}): ${e.message}`);
    }
  }
  return null;
}

// все списки строго валидируем — только 5 латинских букв
const fallbackClean = [...new Set(FALLBACK)].filter((w) => /^[a-z]{5}$/).sort();
const allowedFetched = await fetchList(ALLOWED_URLS);
const answersFetched = await fetchList(ANSWERS_URLS);

const answersList = answersFetched || fallbackClean;
const allowedSet = [...new Set([...(allowedFetched || []), ...fallbackClean, ...answersList])]
  .filter((w) => /^[a-z]{5}$/)
  .sort();

await writeFile(
  OUT,
  `// Автогенерируется scripts/build-dicts-en.mjs (Wordle lists). Не править руками.\n` +
  `export const ANSWERS_EN = ${JSON.stringify(answersList)};\n` +
  `export const EXTRA_EN = ${JSON.stringify(allowedSet.filter((w) => !answersList.includes(w)))};\n`,
  'utf8',
);
console.log(
  `EN словарь: ответов ${answersList.length}, допустимых всего ${allowedSet.length}` +
  (answersFetched ? '' : ' (ответы — fallback)'),
  allowedFetched ? '' : '(разрешенные — fallback)',
);
