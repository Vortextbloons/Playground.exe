export type Card = number;

export function cardRank(card: Card): number {
  return Math.floor(card / 4) + 1;
}

export function cardSuit(card: Card): number {
  return card % 4;
}

export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, index) => index);
}

export function rankLabel(rank: number): string {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

export const SUIT_LABELS = ['♠', '♥', '♦', '♣'] as const;
