export interface Sound {
  impacts(speeds: readonly number[]): void;
  crash(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export function createSound(): Sound {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let lastImpact = 0;
  let impactCount = 0;
  let impactWindow = 0;

  function ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(context.destination);
      const length = Math.floor(context.sampleRate * 0.6);
      noise = context.createBuffer(1, length, context.sampleRate);
      const data = noise.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < length; index++) {
        const white = Math.random() * 2 - 1;
        previous = (previous + 0.04 * white) / 1.04;
        data[index] = white * 0.7 + previous * 3.2;
      }
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  }

  function knock(level: number, delay = 0, pitch = 1): void {
    const audio = ensure();
    if (!audio || !master || !noise) return;
    const start = audio.currentTime + delay;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(Math.min(level, 0.5), start);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.085);
    const band = audio.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = (820 + Math.random() * 900) * pitch;
    band.Q.value = 1.05;
    const source = audio.createBufferSource();
    source.buffer = noise;
    source.playbackRate.value = (0.75 + Math.random() * 0.6) * pitch;
    source.connect(band).connect(gain).connect(master);
    source.start(start, Math.random() * 0.3, 0.1);
    const body = audio.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime((190 + Math.random() * 110) * pitch, start);
    body.frequency.exponentialRampToValueAtTime((90 + Math.random() * 40) * pitch, start + 0.07);
    const bodyGain = audio.createGain();
    bodyGain.gain.setValueAtTime(level * 0.55, start);
    bodyGain.gain.exponentialRampToValueAtTime(0.0006, start + 0.075);
    body.connect(bodyGain).connect(master);
    body.start(start);
    body.stop(start + 0.09);
  }

  return {
    impacts(speeds) {
      const now = performance.now();
      if (now - impactWindow > 120) { impactWindow = now; impactCount = 0; }
      if (impactCount >= 5) return;
      for (const speed of speeds) {
        if (now - lastImpact < 24) continue;
        lastImpact = now;
        impactCount++;
        knock(Math.min(0.06 + speed * 0.09, 0.34), 0, 0.85 + Math.random() * 0.35);
      }
    },
    crash() {
      const audio = ensure();
      if (!audio || !master || !noise) return;
      const start = audio.currentTime;
      const swell = audio.createBufferSource();
      swell.buffer = noise;
      swell.playbackRate.value = 0.4;
      const low = audio.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.setValueAtTime(900, start);
      low.frequency.exponentialRampToValueAtTime(180, start + 0.7);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.42, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.75);
      swell.connect(low).connect(gain).connect(master);
      swell.start(start, 0.05, 0.8);
      for (let index = 0; index < 9; index++) {
        knock(0.16 + Math.random() * 0.16, 0.04 + Math.random() * 0.42, 0.6 + Math.random() * 0.5);
      }
    },
    resume() {
      ensure();
    },
    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.85, context.currentTime, 0.02);
    },
    dispose() {
      if (context) { void context.close(); context = null; master = null; noise = null; }
    },
  };
}
