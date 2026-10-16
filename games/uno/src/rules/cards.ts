/** UNO deck encoding: every card is a stable id 0–107, so states stay tiny and JSON-safe. */

export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw-two' | 'wild' | 'wild-four';

export interface Card {
  readonly id: number;
  readonly color: Color | 'wild';
  readonly kind: CardKind;
  /** Face value for numbers, otherwise the card's scoring value (20 or 50). */
  readonly value: number;
}

export const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];
export const DECK_SIZE = 108;
const CARDS_PER_COLOR = 25;
const WILD_BASE = 100;
const WILD_FOUR_BASE = 104;

export function isColor(value: unknown): value is Color {
  return value === 'red' || value === 'yellow' || value === 'green' || value === 'blue';
}

export function cardFromId(id: number): Card {
  if (!Number.isInteger(id) || id < 0 || id >= DECK_SIZE) throw new Error(`Invalid card id: ${id}`);
  if (id >= WILD_FOUR_BASE) return { id, color: 'wild', kind: 'wild-four', value: 50 };
  if (id >= WILD_BASE) return { id, color: 'wild', kind: 'wild', value: 50 };
  const color = COLORS[Math.floor(id / CARDS_PER_COLOR)]!;
  const slot = id % CARDS_PER_COLOR;
  if (slot === 0) return { id, color, kind: 'number', value: 0 };
  if (slot <= 18) return { id, color, kind: 'number', value: Math.ceil(slot / 2) };
  if (slot <= 20) return { id, color, kind: 'skip', value: 20 };
  if (slot <= 22) return { id, color, kind: 'reverse', value: 20 };
  return { id, color, kind: 'draw-two', value: 20 };
}

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'number': return String(card.value);
    case 'skip': return 'Skip';
    case 'reverse': return 'Reverse';
    case 'draw-two': return 'Draw Two';
    case 'wild': return 'Wild';
    case 'wild-four': return 'Wild Draw Four';
  }
}
