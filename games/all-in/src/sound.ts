export type SoundName = 'chip' | 'card' | 'spin' | 'win' | 'lose' | 'jackpot' | 'tick';

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
      case 'chip':
        blip(context, 1850, t, 0.03, 0.05, 'sine', 1250);
        blip(context, 2900, t + 0.028, 0.045, 0.035, 'sine', 2100);
        blip(context, 640, t, 0.05, 0.03, 'triangle');
        break;
      case 'card':
        blip(context, 720, t, 0.055, 0.05, 'sawtooth', 240);
        blip(context, 1850, t + 0.016, 0.03, 0.02, 'sine', 960);
        break;
      case 'spin': {
        const base = 520 + Math.min(level, 6) * 40;
        for (let i = 0; i < 4; i++) blip(context, base * (1 + i * 0.2), t + i * 0.06, 0.05, 0.04, 'square');
        blip(context, base * 2.3, t + 0.26, 0.09, 0.03, 'sine');
        break;
      }
      case 'win':
        blip(context, 523, t, 0.1, 0.06, 'triangle');
        blip(context, 659, t + 0.09, 0.1, 0.06, 'triangle');
        blip(context, 784, t + 0.18, 0.16, 0.06, 'triangle');
        break;
      case 'lose':
        blip(context, 330, t, 0.12, 0.06, 'sawtooth', 240);
        blip(context, 233, t + 0.12, 0.2, 0.06, 'triangle', 158);
        break;
      case 'jackpot': {
        const notes = [523, 659, 784, 1046, 1318, 1568];
        for (let i = 0; i < notes.length; i++) blip(context, notes[i]!, t + i * 0.07, 0.12, 0.06, 'triangle');
        blip(context, 110, t, 0.3, 0.08, 'sine', 60);
        blip(context, 2093, t + 0.42, 0.3, 0.05, 'sine');
        break;
      }
      case 'tick':
        blip(context, 1600, t, 0.025, 0.04, 'square');
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

export const sound = createSound();
