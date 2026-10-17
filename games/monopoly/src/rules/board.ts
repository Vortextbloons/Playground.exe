export type Group = 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkblue';
export type SpaceKind = 'go' | 'street' | 'railroad' | 'utility' | 'chance' | 'chest' | 'tax' | 'jail' | 'parking' | 'gotojail';

export type Space = {
  id: number;
  name: string;
  kind: SpaceKind;
  group?: Group;
  price?: number;
  rent?: number[];
  houseCost?: number;
  tax?: number;
};

export const SALARY = 200;
export const START_CASH = 1500;
export const JAIL_FINE = 50;
export const JAIL_POSITION = 10;
export const HOUSE_STOCK = 32;
export const HOTEL_STOCK = 16;
export const WEALTH_TARGET = 5000;
export const TURN_MS = 90_000;
export const MORTGAGE_INTEREST = 1.1;
export const mortgageInterestOf = (price: number): number => Math.ceil(price / 2 * MORTGAGE_INTEREST - 1e-9);
export const transferInterestOf = (price: number): number => Math.ceil(price / 2 * 0.1 - 1e-9);

export const RAILROAD_IDS = [5, 15, 25, 35] as const;
export const UTILITY_IDS = [12, 28] as const;

export const GROUP_COLORS: Record<Group, string> = {
  brown: '#8d6748',
  lightblue: '#a8d8e8',
  pink: '#d46aa7',
  orange: '#f0932b',
  red: '#e0453a',
  yellow: '#f4d03f',
  green: '#27a05c',
  darkblue: '#2c5fc4',
};

export const PLAYER_COLORS = ['#e0453a', '#2c5fc4', '#27a05c', '#f0932b', '#8e5cd9', '#16a3a3', '#d46aa7', '#7a6a55'] as const;

export function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]!;
}

export const SPACES: Space[] = [
  { id: 0, name: 'Go', kind: 'go' },
  { id: 1, name: 'Mediterranean Avenue', kind: 'street', group: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50 },
  { id: 2, name: 'Community Chest', kind: 'chest' },
  { id: 3, name: 'Baltic Avenue', kind: 'street', group: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], houseCost: 50 },
  { id: 4, name: 'Income Tax', kind: 'tax', tax: 200 },
  { id: 5, name: 'Reading Railroad', kind: 'railroad', price: 200 },
  { id: 6, name: 'Oriental Avenue', kind: 'street', group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
  { id: 7, name: 'Chance', kind: 'chance' },
  { id: 8, name: 'Vermont Avenue', kind: 'street', group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
  { id: 9, name: 'Connecticut Avenue', kind: 'street', group: 'lightblue', price: 120, rent: [8, 40, 100, 300, 450, 600], houseCost: 50 },
  { id: 10, name: 'Jail', kind: 'jail' },
  { id: 11, name: 'St. Charles Place', kind: 'street', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
  { id: 12, name: 'Electric Company', kind: 'utility', price: 150 },
  { id: 13, name: 'States Avenue', kind: 'street', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
  { id: 14, name: 'Virginia Avenue', kind: 'street', group: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100 },
  { id: 15, name: 'Pennsylvania Railroad', kind: 'railroad', price: 200 },
  { id: 16, name: 'St. James Place', kind: 'street', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
  { id: 17, name: 'Community Chest', kind: 'chest' },
  { id: 18, name: 'Tennessee Avenue', kind: 'street', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
  { id: 19, name: 'New York Avenue', kind: 'street', group: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 100 },
  { id: 20, name: 'Free Parking', kind: 'parking' },
  { id: 21, name: 'Kentucky Avenue', kind: 'street', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
  { id: 22, name: 'Chance', kind: 'chance' },
  { id: 23, name: 'Indiana Avenue', kind: 'street', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
  { id: 24, name: 'Illinois Avenue', kind: 'street', group: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100], houseCost: 150 },
  { id: 25, name: 'B. & O. Railroad', kind: 'railroad', price: 200 },
  { id: 26, name: 'Atlantic Avenue', kind: 'street', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
  { id: 27, name: 'Ventnor Avenue', kind: 'street', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
  { id: 28, name: 'Water Works', kind: 'utility', price: 150 },
  { id: 29, name: 'Marvin Gardens', kind: 'street', group: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200], houseCost: 150 },
  { id: 30, name: 'Go To Jail', kind: 'gotojail' },
  { id: 31, name: 'Pacific Avenue', kind: 'street', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
  { id: 32, name: 'North Carolina Avenue', kind: 'street', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
  { id: 33, name: 'Community Chest', kind: 'chest' },
  { id: 34, name: 'Pennsylvania Avenue', kind: 'street', group: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], houseCost: 200 },
  { id: 35, name: 'Short Line', kind: 'railroad', price: 200 },
  { id: 36, name: 'Chance', kind: 'chance' },
  { id: 37, name: 'Park Place', kind: 'street', group: 'darkblue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], houseCost: 200 },
  { id: 38, name: 'Luxury Tax', kind: 'tax', tax: 100 },
  { id: 39, name: 'Boardwalk', kind: 'street', group: 'darkblue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], houseCost: 200 },
];

export const GROUP_SPACES: Record<Group, number[]> = {
  brown: [1, 3],
  lightblue: [6, 8, 9],
  pink: [11, 13, 14],
  orange: [16, 18, 19],
  red: [21, 23, 24],
  yellow: [26, 27, 29],
  green: [31, 32, 34],
  darkblue: [37, 39],
};

export type CardEffect =
  | { kind: 'move'; to: number }
  | { kind: 'move-nearest'; to: 'railroad' | 'utility' }
  | { kind: 'back'; steps: number }
  | { kind: 'jail' }
  | { kind: 'jail-card' }
  | { kind: 'cash'; amount: number }
  | { kind: 'collect-each'; amount: number }
  | { kind: 'pay-each'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number };

export type CardDef = { id: number; deck: 'chance' | 'chest'; text: string; effect: CardEffect };

const chance = (id: number, text: string, effect: CardEffect): CardDef => ({ id, deck: 'chance', text, effect });
const chest = (id: number, text: string, effect: CardEffect): CardDef => ({ id, deck: 'chest', text, effect });

export const CHANCE_CARDS: CardDef[] = [
  chance(0, 'Advance to Go. Collect $200.', { kind: 'move', to: 0 }),
  chance(1, 'Advance to Illinois Avenue.', { kind: 'move', to: 24 }),
  chance(2, 'Advance to St. Charles Place.', { kind: 'move', to: 11 }),
  chance(3, 'Advance to the nearest Utility. If owned, pay 10 times the dice roll.', { kind: 'move-nearest', to: 'utility' }),
  chance(4, 'Advance to the nearest Railroad. Pay the owner double rent.', { kind: 'move-nearest', to: 'railroad' }),
  chance(5, 'The bank pays you a dividend of $50.', { kind: 'cash', amount: 50 }),
  chance(6, 'Get Out of Jail Free. Keep this card until needed.', { kind: 'jail-card' }),
  chance(7, 'Go back three spaces.', { kind: 'back', steps: 3 }),
  chance(8, 'Go directly to Jail. Do not pass Go.', { kind: 'jail' }),
  chance(9, 'Make general repairs: pay $25 per house and $100 per hotel.', { kind: 'repairs', perHouse: 25, perHotel: 100 }),
  chance(10, 'Caught speeding: pay a $15 fine.', { kind: 'cash', amount: -15 }),
  chance(11, 'Take a trip to Reading Railroad.', { kind: 'move', to: 5 }),
  chance(12, 'Take a walk on the Boardwalk.', { kind: 'move', to: 39 }),
  chance(13, 'You have been elected chairman: pay each player $50.', { kind: 'pay-each', amount: 50 }),
  chance(14, 'Your building loan matures: collect $150.', { kind: 'cash', amount: 150 }),
  chance(15, 'You have won a crossword competition: collect $100.', { kind: 'cash', amount: 100 }),
];

export const CHEST_CARDS: CardDef[] = [
  chest(16, 'Advance to Go. Collect $200.', { kind: 'move', to: 0 }),
  chest(17, 'Bank error in your favor: collect $200.', { kind: 'cash', amount: 200 }),
  chest(18, "Doctor's fee: pay $50.", { kind: 'cash', amount: -50 }),
  chest(19, 'From the sale of stock you get $50.', { kind: 'cash', amount: 50 }),
  chest(20, 'Get Out of Jail Free. Keep this card until needed.', { kind: 'jail-card' }),
  chest(21, 'Go directly to Jail. Do not pass Go.', { kind: 'jail' }),
  chest(22, 'Your holiday fund matures: receive $100.', { kind: 'cash', amount: 100 }),
  chest(23, 'Income tax refund: collect $20.', { kind: 'cash', amount: 20 }),
  chest(24, 'It is your birthday: collect $10 from every player.', { kind: 'collect-each', amount: 10 }),
  chest(25, 'Your life insurance matures: collect $100.', { kind: 'cash', amount: 100 }),
  chest(26, 'Hospital fees: pay $100.', { kind: 'cash', amount: -100 }),
  chest(27, 'School fees: pay $50.', { kind: 'cash', amount: -50 }),
  chest(28, 'Receive a $25 consultancy fee.', { kind: 'cash', amount: 25 }),
  chest(29, 'Street repairs: pay $40 per house and $115 per hotel.', { kind: 'repairs', perHouse: 40, perHotel: 115 }),
  chest(30, 'You have won second prize in a beauty contest: collect $10.', { kind: 'cash', amount: 10 }),
  chest(31, 'You inherit $100.', { kind: 'cash', amount: 100 }),
];

export const ALL_CARDS: CardDef[] = [...CHANCE_CARDS, ...CHEST_CARDS];

export function cardById(id: number): CardDef {
  const card = ALL_CARDS.find(card => card.id === id);
  if (!card) throw new Error(`Unknown card ${id}.`);
  return card;
}

export function nearestOf(from: number, kind: 'railroad' | 'utility'): number {
  for (let step = 1; step <= 40; step++) {
    const id = (from + step) % 40;
    if (SPACES[id]!.kind === kind) return id;
  }
  throw new Error(`No ${kind} on the board.`);
}