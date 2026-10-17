export type MusicKit = {
  start(): void;
  stop(): void;
  setEnabled(enabled: boolean): void;
  setIntense(intense: boolean): void;
  destroy(): void;
};

const BASE_BPM = 82;
const INTENSE_BPM = 124;
const LOOKAHEAD_MS = 240;
const LOOKAHEAD_S = 0.32;
const SPARKS = [440, 493.88, 554.37, 659.25, 739.99, 880];
const MASTER_GAIN = 0.055;
const INTENSE_GAIN = 0.075;

export function createMusic(): MusicKit {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let enabled = true;
  let wanted = false;
  let intense = false;
  let step = 0;
  let nextTime = 0;
  let sparkIndex = 0;

  const resume = () => {
    if (context && context.state === 'suspended') void context.resume();
  };
  const onGesture = () => resume();
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);

  function ensure(): AudioContext {
    if (context === null) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      const frames = Math.floor(context.sampleRate * 0.1);
      noise = context.createBuffer(1, frames, context.sampleRate);
      const data = noise.getChannelData(0);
      for (let index = 0; index < frames; index += 1) data[index] = Math.random() * 2 - 1;
    }
    return context;
  }

  function tone(at: number, frequency: number, duration: number, gain: number, type: OscillatorType): void {
    const ctx = context;
    const output = master;
    if (!ctx || !output) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp);
    amp.connect(output);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  function hit(at: number, gain: number): void {
    const ctx = context;
    const output = master;
    if (!ctx || !output || !noise) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6200;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(output);
    source.start(at, 0, 0.06);
  }

  function schedule(at: number, beat: number): void {
    if (step % 4 === 0) tone(at, intense ? 92 : 82, 0.2, 0.5, 'sine');
    if (intense && step % 4 === 2) tone(at, 138, 0.09, 0.22, 'triangle');
    if (step % 2 === 1) hit(at, intense ? 0.16 : 0.1);
    if (step % 8 === 3 || (intense && step % 8 === 6)) {
      const frequency = SPARKS[sparkIndex % SPARKS.length]!;
      sparkIndex += 1;
      tone(at, frequency, 0.34, intense ? 0.16 : 0.11, 'triangle');
    }
    nextTime += beat;
  }

  function tick(): void {
    const ctx = context;
    const output = master;
    if (!ctx || !output) return;
    if (!wanted || !enabled || ctx.state === 'suspended') {
      output.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      nextTime = ctx.currentTime + 0.06;
      return;
    }
    output.gain.setTargetAtTime(intense ? INTENSE_GAIN : MASTER_GAIN, ctx.currentTime, 0.2);
    const beat = 60 / (intense ? INTENSE_BPM : BASE_BPM) / 2;
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
    const until = ctx.currentTime + LOOKAHEAD_S;
    while (nextTime < until) {
      schedule(nextTime, beat);
      step += 1;
    }
  }

  return {
    start() {
      wanted = true;
      ensure();
      resume();
      if (timer === undefined) timer = setInterval(tick, LOOKAHEAD_MS);
    },
    stop() {
      wanted = false;
    },
    setEnabled(value) {
      enabled = value;
      resume();
    },
    setIntense(value) {
      intense = value;
    },
    destroy() {
      wanted = false;
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      if (context) void context.close();
      context = null;
      master = null;
      noise = null;
    },
  };
}
