import { cardRank, cardSuit } from '../core/cards';

export const CATEGORY_NAMES: readonly string[] = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

export const VIDEO_PAYTABLE: readonly number[] = [0, 1, 2, 3, 4, 6, 9, 25, 50];

export const ROYAL_MULTIPLIER = 250;

const CATEGORY_SIZE = 1 << 20;
const TOP_SHIFT = 1 << 16;

function rankValue(rank: number): number {
  return rank === 1 ? 14 : rank;
}

function scoreOf(category: number, kickers: readonly number[]): number {
  let packed = 0;
  for (let index = 0; index < 5; index += 1) packed = packed * 16 + (kickers[index] ?? 0);
  return category * CATEGORY_SIZE + packed;
}

function straightTop(values: readonly number[]): number {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! >= values[index - 1]!) return 0;
  }
  if (values[0]! - values[4]! === 4) return values[0]!;
  if (values[0] === 14 && values[1] === 5) return 5;
  return 0;
}

export function evaluate5(cards: readonly number[]): number {
  if (cards.length !== 5) throw new Error('Exactly five cards are required.');
  const values = cards.map(card => rankValue(cardRank(card))).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].map(([value, count]) => ({ value, count }));
  groups.sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every(card => cardSuit(card) === cardSuit(cards[0]!));
  const top = straightTop(values);
  if (top > 0 && flush) return scoreOf(8, [top]);
  if (groups[0]!.count === 4) return scoreOf(7, [groups[0]!.value, groups[1]!.value]);
  if (groups[0]!.count === 3 && groups[1]!.count === 2) return scoreOf(6, [groups[0]!.value, groups[1]!.value]);
  if (flush) return scoreOf(5, values);
  if (top > 0) return scoreOf(4, [top]);
  if (groups[0]!.count === 3) return scoreOf(3, [groups[0]!.value, groups[1]!.value, groups[2]!.value]);
  if (groups[0]!.count === 2 && groups[1]!.count === 2) return scoreOf(2, [groups[0]!.value, groups[1]!.value, groups[2]!.value]);
  if (groups[0]!.count === 2) return scoreOf(1, [groups[0]!.value, groups[1]!.value, groups[2]!.value, groups[3]!.value]);
  return scoreOf(0, values);
}

export function handCategory(score: number): number {
  return Math.floor(score / CATEGORY_SIZE);
}

function topValue(score: number): number {
  return Math.floor((score % CATEGORY_SIZE) / TOP_SHIFT);
}

export function videoCoinWin(cards: readonly number[], coins: number): number {
  const score = evaluate5(cards);
  const category = handCategory(score);
  if (category === 8) return (topValue(score) === 14 ? ROYAL_MULTIPLIER : VIDEO_PAYTABLE[8]!) * coins;
  if (category === 1 && topValue(score) < 11) return 0;
  return VIDEO_PAYTABLE[category]! * coins;
}
