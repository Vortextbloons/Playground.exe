export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBelow(entropy: () => number, max: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new Error('Invalid random range.');
  const limit = Math.floor(4294967296 / max) * max;
  let value = entropy() >>> 0;
  while (value >= limit) value = entropy() >>> 0;
  return value % max;
}

export function shuffled<T>(items: readonly T[], entropy: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomBelow(entropy, i + 1);
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

export function cryptoEntropy(): () => number {
  const buffer = new Uint32Array(1);
  return () => {
    crypto.getRandomValues(buffer);
    return buffer[0]!;
  };
}
