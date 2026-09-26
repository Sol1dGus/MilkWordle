// Соло-статистика в localStorage. Партийные очки живут на сервере,
// это только личная история против Зорьки.
const KEY = 'moloko-stats';

const empty = () => ({ played: 0, wins: 0, streak: 0, bestStreak: 0, dist: [0, 0, 0, 0, 0, 0] });

export function loadStats() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return empty();
  }
}

export function recordResult(won, attempts) {
  const s = loadStats();
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.dist[attempts - 1] += 1;
  } else {
    s.streak = 0;
  }
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
