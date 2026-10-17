export type SoundName = 'move' | 'rotate' | 'lock' | 'clear' | 'level' | 'drop' | 'over' | 'start';

export interface SoundKit {
  play(name: SoundName, level?: number): void;
  unlock(): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

type Ctor = typeof AudioContext;

export function createSound(): SoundKit {
  let ctx: AudioContext | null = null;
  let enabled = true;

  function ensure(): AudioContext | null {
    if (!enabled) return null;
    if (!ctx) {
      const Ctor: Ctor | undefined = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!Ctor) return null;
      try { ctx = new Ctor(); } catch { return null; }
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function blip(context: AudioContext, freq: number, at: number, duration: number, gain: number, type: OscillatorType = 'triangle', slideTo = 0): void {
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0008, at + duration);
    osc.connect(amp).connect(context.destination);
    osc.start(at);
    osc.stop(at + duration + 0.04);
  }

  function play(name: SoundName, level = 0): void {
    const context = ensure();
    if (!context) return;
    const t = context.currentTime + 0.008;
    switch (name) {
      case 'move':
        blip(context, 320, t, 0.04, 0.03, 'sine');
        break;
      case 'rotate':
        blip(context, 480, t, 0.05, 0.04, 'sine', 640);
        break;
      case 'lock':
        blip(context, 200, t, 0.07, 0.08, 'triangle', 120);
        break;
      case 'drop':
        blip(context, 900, t, 0.09, 0.05, 'sawtooth', 180);
        blip(context, 180, t, 0.1, 0.08, 'sine', 90);
        break;
      case 'clear': {
        const base = 520 + Math.min(level, 6) * 40;
        blip(context, base, t, 0.1, 0.07, 'triangle');
        blip(context, base * 1.25, t + 0.055, 0.12, 0.07, 'triangle');
        blip(context, base * 1.5, t + 0.11, 0.14, 0.065, 'triangle');
        if (level >= 4) blip(context, base * 2, t + 0.165, 0.2, 0.06, 'sine');
        break;
      }
      case 'level':
        blip(context, 523, t, 0.09, 0.06, 'triangle');
        blip(context, 659, t + 0.08, 0.09, 0.06, 'triangle');
        blip(context, 784, t + 0.16, 0.14, 0.06, 'triangle');
        break;
      case 'over':
        blip(context, 392, t, 0.16, 0.07, 'triangle');
        blip(context, 311, t + 0.14, 0.16, 0.07, 'triangle');
        blip(context, 233, t + 0.28, 0.26, 0.075, 'triangle');
        break;
      case 'start':
        blip(context, 392, t, 0.09, 0.05, 'sine');
        blip(context, 587, t + 0.07, 0.12, 0.05, 'sine');
        break;
    }
  }

  return {
    play,
    unlock() { ensure(); },
    setEnabled(next: boolean) {
      enabled = next;
      if (!ctx) return;
      if (!next) ctx.suspend().catch(() => undefined);
      else ctx.resume().catch(() => undefined);
    },
    destroy() {
      const closing = ctx;
      ctx = null;
      if (closing) closing.close().catch(() => undefined);
    },
  };
}
