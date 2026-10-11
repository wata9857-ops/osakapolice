// WebAudio synthesis: Japanese police siren (slow rising/falling wail) and engine hum.
export class DriveAudio {
  ctx: AudioContext | null = null;
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  private ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  startEngine() {
    const ctx = this.ensure();
    if (!ctx || this.engine) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 38;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 19;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(ctx.destination);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, filter };
  }

  setEngine(speed: number, throttle: number) {
    if (!this.engine || !this.ctx) return;
    const rpm = 750 + (speed * 3.6 * 38) % 2400 + throttle * 500;
    const f = rpm / 20;
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(f / 2, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + throttle * 0.03, t, 0.1);
  }

  setSiren(on: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (on && !this.siren) {
      // ウー… : sine-ish tone sweeping ~650 → 1250 Hz with a slow period
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 900;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.32;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 300;
      lfo.connect(lfoGain).connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(this.muted ? 0 : 0.07, ctx.currentTime, 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      lfo.start();
      this.siren = { osc, lfo, gain };
    } else if (!on && this.siren) {
      const s = this.siren;
      s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => {
        s.osc.stop();
        s.lfo.stop();
      }, 600);
      this.siren = null;
    }
  }

  dispose() {
    this.setSiren(false);
    if (this.engine) {
      this.engine.osc.stop();
      this.engine.osc2.stop();
      this.engine = null;
    }
    setTimeout(() => this.ctx?.close(), 700);
  }
}
