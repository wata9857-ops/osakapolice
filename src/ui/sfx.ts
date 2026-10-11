// Small synthesized console sounds (no audio files): incoming call, urgent alert, resolve, rank up.
let ctx: AudioContext | null = null;
let enabled = true;

export function setSfx(on: boolean) {
  enabled = on;
}

/** must be called from a user gesture once (iOS) */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.08) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfx(kind: 'call' | 'urgent' | 'resolve' | 'fail' | 'rank' | 'event') {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (kind) {
    case 'call': // 2-tone console chime
      tone(988, 0, 0.18, 'sine');
      tone(740, 0.2, 0.25, 'sine');
      break;
    case 'urgent': // repeated alert
      for (let i = 0; i < 3; i++) {
        tone(1320, i * 0.22, 0.12, 'square', 0.05);
        tone(990, i * 0.22 + 0.11, 0.1, 'square', 0.05);
      }
      break;
    case 'resolve':
      tone(660, 0, 0.12, 'triangle', 0.07);
      tone(880, 0.1, 0.18, 'triangle', 0.07);
      break;
    case 'fail':
      tone(330, 0, 0.3, 'sawtooth', 0.04);
      break;
    case 'rank':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.07));
      break;
    case 'event':
      tone(587, 0, 0.3, 'sine', 0.07);
      tone(587, 0.35, 0.3, 'sine', 0.07);
      break;
  }
}
