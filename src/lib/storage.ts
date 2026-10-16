export function readLocal<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try { const value: unknown = JSON.parse(localStorage.getItem(`arcade:${key}`) ?? 'null'); return valid(value) ? value : fallback; }
  catch { return fallback; }
}
export function writeLocal(key: string, value: unknown): void {
  try { localStorage.setItem(`arcade:${key}`, JSON.stringify(value)); } catch { /* Storage may be disabled or full. */ }
}
