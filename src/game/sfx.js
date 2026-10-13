// Звуки на WebAudio — никаких аудиофайлов, всё синтезируется на лету.
// Автоплей-политика браузеров: контекст оживляется после первого клика/клавиши.
let ctx = null;
let muted = localStorage.getItem('moloko-mute') === '1';

function ac() {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// первый жест пользователя оживляет аудио
if (typeof window !== 'undefined') {
  const wake = () => ac();
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
}

function tone(freq, { at = 0, dur = 0.1, type = 'sine', vol = 0.15, slide = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  toggleMute() {
    muted = !muted;
    localStorage.setItem('moloko-mute', muted ? '1' : '0');
    return muted;
  },
  isMuted() {
    return muted;
  },
  // короткий тик переворота плитки
  flip(i = 0) {
    tone(320 + i * 60, { dur: 0.07, type: 'triangle', vol: 0.08 });
  },
  // зелёное попадание
  hit() {
    tone(660, { dur: 0.09, type: 'triangle', vol: 0.1 });
  },
  // победа в раунде — «дойка»: бодрое мычание вверх
  win() {
    tone(392, { dur: 0.16, type: 'sawtooth', vol: 0.09 });
    tone(523, { at: 0.14, dur: 0.16, type: 'sawtooth', vol: 0.09 });
    tone(659, { at: 0.28, dur: 0.3, type: 'sawtooth', vol: 0.1 });
  },
  // поражение — низкое «му-у»
  lose() {
    tone(220, { dur: 0.5, type: 'sawtooth', vol: 0.1, slide: 130 });
  },
  // заморозка — спуск вниз
  freeze() {
    tone(880, { dur: 0.45, type: 'sine', vol: 0.12, slide: 180 });
  },
  // фанфары матча
  fanfare() {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, { at: i * 0.13, dur: 0.22, type: 'square', vol: 0.08 }));
    tone(1047, { at: 0.55, dur: 0.5, type: 'square', vol: 0.09 });
  },
  // победа в СМК
  smk() {
    tone(587, { dur: 0.1, type: 'square', vol: 0.09 });
    tone(784, { at: 0.1, dur: 0.18, type: 'square', vol: 0.09 });
  },
  // тиканье таймера на последних 5 секундах
  tick(urgent = false) {
    tone(urgent ? 920 : 680, { dur: 0.05, type: 'sine', vol: urgent ? 0.09 : 0.06 });
  },
};
