/**
 * Tiny WebAudio synth for card-table feedback. No assets, no autoplay
 * violations: the context is created lazily on the first user gesture and
 * can be muted by either the in-game toggle or the host player's mute button.
 */

export type SoundName = 'play' | 'draw' | 'shuffle' | 'uno' | 'catch' | 'turn' | 'win' | 'lose';

export interface SoundKit {
  play(name: SoundName): void;
  /** Creates/resumes the audio context from inside a user gesture. */
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

  function noise(context: AudioContext, at: number, duration: number, gain: number): void {
    const frames = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = context.createBufferSource();
    const amp = context.createGain();
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(amp).connect(context.destination);
    src.start(at);
  }

  function play(name: SoundName): void {
    const context = ensure();
    if (!context) return;
    const t = context.currentTime + 0.008;
    switch (name) {
      case 'play':
        noise(context, t, 0.07, 0.05);
        blip(context, 340, t, 0.07, 0.06, 'triangle', 180);
        break;
      case 'draw':
        noise(context, t, 0.05, 0.035);
        blip(context, 520, t + 0.02, 0.06, 0.03, 'sine', 300);
        break;
      case 'shuffle':
        for (let i = 0; i < 6; i++) noise(context, t + i * 0.05, 0.06, 0.04);
        break;
      case 'uno':
        blip(context, 523, t, 0.1, 0.07, 'square');
        blip(context, 784, t + 0.1, 0.16, 0.07, 'square');
        break;
      case 'catch':
        blip(context, 220, t, 0.12, 0.08, 'sawtooth', 110);
        blip(context, 165, t + 0.12, 0.18, 0.07, 'sawtooth', 82);
        break;
      case 'turn':
        blip(context, 660, t, 0.07, 0.035, 'sine');
        break;
      case 'win':
        blip(context, 523, t, 0.12, 0.07, 'triangle');
        blip(context, 659, t + 0.12, 0.12, 0.07, 'triangle');
        blip(context, 784, t + 0.24, 0.14, 0.07, 'triangle');
        blip(context, 1047, t + 0.38, 0.24, 0.075, 'triangle');
        break;
      case 'lose':
        blip(context, 392, t, 0.16, 0.06, 'triangle');
        blip(context, 311, t + 0.15, 0.16, 0.06, 'triangle');
        blip(context, 233, t + 0.3, 0.28, 0.065, 'triangle');
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
