import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';

export function asRecord(value: Json): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action.');
  return value as Record<string, Json>;
}

export function readInt(record: Record<string, Json>, key: string, min: number, max: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}.`);
  return value;
}

export function readBool(record: Record<string, Json>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key}.`);
  return value;
}

export function readChoice<T extends string>(record: Record<string, Json>, key: string, options: readonly T[]): T {
  const value = record[key];
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(`Invalid ${key}.`);
  return value as T;
}

export function readList(record: Record<string, Json>, key: string, max: number): Json[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${key}.`);
  return value;
}
