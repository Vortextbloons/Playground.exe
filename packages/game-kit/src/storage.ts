export function createStorage(id: string) {
  const prefix = `arcade:game:${id}:`;
  return {
    get<T>(key: string, fallback: T): T {
      try { const raw = localStorage.getItem(prefix + key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
    },
    set(key: string, value: unknown): boolean { try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key: string) { try { localStorage.removeItem(prefix + key); } catch { /* Unavailable storage. */ } },
    highScore(score: number): number {
      if (!Number.isFinite(score)) throw new Error('Score must be finite');
      const previous = this.get<unknown>('high-score', 0);
      const best = Math.max(typeof previous === 'number' && Number.isFinite(previous) ? previous : 0, score);
      this.set('high-score', best); return best;
    },
  };
}
