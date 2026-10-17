import {
  GROUP_SPACES,
  HOUSE_STOCK,
  HOTEL_STOCK,
  JAIL_FINE,
  JAIL_POSITION,
  RAILROAD_IDS,
  SALARY,
  SPACES,
  START_CASH,
  UTILITY_IDS,
  cardById,
  mortgageInterestOf,
  nearestOf,
  transferInterestOf,
  type Group,
} from './board';
import { mulberry32, type Rng } from './rng';

export type PlayerState = {
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  heldCards: number[];
  bankrupt: boolean;
};

export type AuctionState = {
  space: number;
  highBid: number;
  highBidder: string | null;
  passed: string[];
  order: string[];
  turn: string;
};

export type TradeOffer = {
  from: string;
  to: string;
  cash: number;
  properties: number[];
  wantCash: number;
  wantProperties: number[];
};

export type DebtState = {
  payer: string;
  amount: number;
  creditor: string | null;
  spreadTo: string[] | null;
};

export type LogEntry = { actor: string | null; text: string };

export type EndConditions = {
  bankruptcy: boolean;
  target: number | null;
  timeLimitMs: number | null;
};

export type MonoState = {
  phase: 'setup' | 'preroll' | 'buy-decision' | 'auction' | 'postroll' | 'debt' | 'results';
  players: Record<string, PlayerState>;
  order: string[];
  turn: string;
  turnStartedAt: number;
  owners: Record<string, string | null>;
  houses: Record<string, number>;
  mortgages: Record<string, boolean>;
  doubles: number;
  lastRoll: [number, number] | null;
  auction: AuctionState | null;
  auctionQueue: number[];
  auctionResume: 'preroll' | 'postroll' | 'debt';
  collection: { remaining: string[]; creditor: string; amount: number } | null;
  trade: TradeOffer | null;
  debt: DebtState | null;
  pendingMove: number | null;
  resume: 'preroll' | 'postroll';
  chanceDeck: number[];
  chestDeck: number[];
  drawnCard: { deck: 'chance' | 'chest'; id: number } | null;
  log: LogEntry[];
  winners: string[];
  bankruptcy: boolean;
  target: number | null;
  timeLimitMs: number | null;
  endsAt: number | null;
};

export type MonoAction =
  | { type: 'configure'; conditions: EndConditions }
  | { type: 'finish-time' }
  | { type: 'roll' }
  | { type: 'jail-fine' }
  | { type: 'jail-card' }
  | { type: 'jail-roll' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'bid'; amount: number }
  | { type: 'pass-bid' }
  | { type: 'build'; space: number }
  | { type: 'sell'; space: number; all?: boolean }
  | { type: 'mortgage'; space: number }
  | { type: 'unmortgage'; space: number }
  | { type: 'propose-trade'; to: string; cash: number; properties: number[]; wantCash: number; wantProperties: number[] }
  | { type: 'accept-trade' }
  | { type: 'reject-trade' }
  | { type: 'end-turn' }
  | { type: 'pay-debt' }
  | { type: 'declare-bankrupt' }
  | { type: 'timeout' };

export type MonoView = MonoState & { you: string | null };

/** Wire format for each action name sent over the party socket. */
export type MonoActionPayloads = {
  configure: EndConditions;
  'finish-time': null;
  roll: null;
  'jail-fine': null;
  'jail-card': null;
  'jail-roll': null;
  buy: null;
  decline: null;
  bid: { amount: number };
  'pass-bid': null;
  build: { space: number };
  sell: { space: number; all?: boolean };
  mortgage: { space: number };
  unmortgage: { space: number };
  'propose-trade': { to: string; cash: number; properties: number[]; wantCash: number; wantProperties: number[] };
  'accept-trade': null;
  'reject-trade': null;
  'end-turn': null;
  'pay-debt': null;
  'declare-bankrupt': null;
  timeout: null;
};

const LOG_LIMIT = 60;

function ownable(id: number): boolean {
  const kind = SPACES[id]!.kind;
  return kind === 'street' || kind === 'railroad' || kind === 'utility';
}

function solvent(state: MonoState): string[] {
  return state.order.filter(id => !state.players[id]!.bankrupt);
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

function log(state: MonoState, actor: string | null, text: string): void {
  state.log.push({ actor, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function money(amount: number): string {
  return `$${amount}`;
}

function roll2(rng: Rng): [number, number] {
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
}

export function netWorth(state: MonoState, playerId: string): number {
  const player = state.players[playerId];
  if (!player || player.bankrupt) return 0;
  let total = player.cash;
  for (const id of Object.keys(state.owners)) {
    if (state.owners[id] !== playerId) continue;
    const space = SPACES[Number(id)]!;
    const price = space.price ?? 0;
    if (state.mortgages[id]) total += Math.floor(price / 2);
    else {
      total += price;
      total += (state.houses[id] ?? 0) * (space.houseCost ?? 0);
    }
  }
  return total;
}

export function rentFor(
  state: MonoState,
  spaceId: number,
  diceTotal: number,
  opts: { utilityTimes?: number; rentMult?: number } = {},
): number {
  const space = SPACES[spaceId]!;
  const owner = state.owners[String(spaceId)];
  if (!owner) return 0;
  if (space.kind === 'street') {
    const houses = state.houses[String(spaceId)] ?? 0;
    const base = space.rent![houses]!;
    if (houses > 0) return opts.rentMult ? base * opts.rentMult : base;
    return base * (ownsGroup(state, space.group!, owner) ? 2 : 1);
  }
  if (space.kind === 'railroad') {
    const owned = RAILROAD_IDS.filter(id => state.owners[String(id)] === owner).length;
    return [0, 25, 50, 100, 200][owned]! * (opts.rentMult ?? 1);
  }
  if (space.kind === 'utility') {
    if (opts.utilityTimes) return diceTotal * opts.utilityTimes;
    const owned = UTILITY_IDS.filter(id => state.owners[String(id)] === owner).length;
    return diceTotal * (owned === 2 ? 10 : 4);
  }
  return 0;
}

export function ownsGroup(state: MonoState, group: Group, playerId: string): boolean {
  return GROUP_SPACES[group].every(id => state.owners[String(id)] === playerId);
}

function groupStreets(group: Group): number[] {
  return GROUP_SPACES[group].filter(id => SPACES[id]!.kind === 'street');
}

export function housesInPlay(state: MonoState): number {
  let total = 0;
  for (const count of Object.values(state.houses)) if (count < 5) total += count;
  return total;
}

function hotelsInPlay(state: MonoState): number {
  let total = 0;
  for (const id of Object.keys(state.houses)) if (state.houses[id] === 5) total += 1;
  return total;
}

function groupHasBuildings(state: MonoState, spaceId: number): boolean {
  const space = SPACES[spaceId]!;
  if (space.kind !== 'street') return false;
  return GROUP_SPACES[space.group!].some(id => (state.houses[String(id)] ?? 0) > 0);
}

function payOut(state: MonoState, payerId: string, amount: number, creditor: string | null, spreadTo: string[] | null): void {
  const payer = state.players[payerId]!;
  payer.cash -= amount;
  if (creditor && state.players[creditor] && !state.players[creditor]!.bankrupt) {
    state.players[creditor]!.cash += amount;
  } else if (spreadTo && spreadTo.length) {
    const share = Math.floor(amount / spreadTo.length);
    for (const id of spreadTo) {
      if (state.players[id] && !state.players[id]!.bankrupt) state.players[id]!.cash += share;
    }
  }
}

function charge(state: MonoState, payerId: string, amount: number, creditor: string | null, spreadTo: string[] | null, text: string): boolean {
  const payer = state.players[payerId]!;
  if (amount <= 0) return true;
  if (payer.cash >= amount) {
    payOut(state, payerId, amount, creditor, spreadTo);
    log(state, payerId, text);
    return true;
  }
  state.debt = { payer: payerId, amount, creditor, spreadTo };
  state.resume = state.doubles > 0 ? 'preroll' : 'postroll';
  state.phase = 'debt';
  log(state, payerId, `${text} — ${money(amount)} is owed.`);
  return false;
}

function advance(state: MonoState, playerId: string, steps: number): void {
  const player = state.players[playerId]!;
  if (player.position + steps >= 40) {
    player.cash += SALARY;
    log(state, playerId, `passes Go and collects ${money(SALARY)}.`);
  }
  player.position = (player.position + steps) % 40;
}

function sendToJail(state: MonoState, playerId: string, text: string): void {
  const player = state.players[playerId]!;
  player.position = JAIL_POSITION;
  player.inJail = true;
  player.jailTurns = 0;
  state.doubles = 0;
  log(state, playerId, text);
}

function settlePhase(state: MonoState): void {
  if (state.phase === 'debt' || state.phase === 'auction' || state.phase === 'results') return;
  state.phase = state.doubles > 0 ? 'preroll' : 'postroll';
}

function drawCard(state: MonoState, deck: 'chance' | 'chest'): number {
  const cards = deck === 'chance' ? state.chanceDeck : state.chestDeck;
  const id = cards.shift();
  if (id === undefined) throw new Error('The card deck is empty.');
  state.drawnCard = { deck, id };
  if (cardById(id).effect.kind !== 'jail-card') cards.push(id);
  return id;
}

type LandOpts = { utilityTimes?: number; rentMult?: number; depth?: number };

function land(state: MonoState, actor: string, diceTotal: number, rng: Rng, opts: LandOpts = {}): void {
  const depth = opts.depth ?? 0;
  const player = state.players[actor]!;
  const space = SPACES[player.position]!;
  switch (space.kind) {
    case 'street':
    case 'railroad':
    case 'utility': {
      const owner = state.owners[String(space.id)];
      if (owner === null || owner === undefined) {
        state.phase = 'buy-decision';
        log(state, actor, `lands on ${space.name} (${money(space.price ?? 0)}).`);
        return;
      }
      if (owner === actor || state.mortgages[String(space.id)]) {
        log(state, actor, `lands on ${space.name}.`);
        settlePhase(state);
        return;
      }
      const rent = rentFor(state, space.id, diceTotal, opts);
      const note = space.kind === 'utility' && opts.utilityTimes ? ' (card: 10× roll)' : space.kind === 'railroad' && opts.rentMult === 2 ? ' (card: double rent)' : '';
      charge(state, actor, rent, owner, null, `pays ${money(rent)} rent${note} to the owner of ${space.name}.`);
      settlePhase(state);
      return;
    }
    case 'tax': {
      charge(state, actor, space.tax!, null, null, `pays ${money(space.tax!)} for ${space.name}.`);
      settlePhase(state);
      return;
    }
    case 'chance':
    case 'chest': {
      const deck = space.kind === 'chance' ? 'chance' : 'chest';
      const id = drawCard(state, deck);
      log(state, actor, `draws ${deck === 'chance' ? 'Chance' : 'Community Chest'}: “${cardById(id).text}”`);
      applyCard(state, actor, id, diceTotal, rng, depth);
      return;
    }
    case 'gotojail': {
      sendToJail(state, actor, 'is sent directly to Jail.');
      settlePhase(state);
      return;
    }
    default: {
      log(state, actor, `lands on ${space.name}.`);
      settlePhase(state);
    }
  }
}

function applyCard(state: MonoState, actor: string, cardId: number, diceTotal: number, rng: Rng, depth: number): void {
  const card = cardById(cardId);
  const effect = card.effect;
  const player = state.players[actor]!;
  const depthNext = depth + 1;
  switch (effect.kind) {
    case 'move': {
      advance(state, actor, (effect.to - player.position + 40) % 40);
      land(state, actor, diceTotal, rng, { depth: depthNext });
      return;
    }
    case 'move-nearest': {
      const to = nearestOf(player.position, effect.to);
      advance(state, actor, (to - player.position + 40) % 40);
      if (effect.to === 'utility') {
        const [a, b] = roll2(rng);
        land(state, actor, a + b, rng, { utilityTimes: 10, depth: depthNext });
      } else {
        land(state, actor, diceTotal, rng, { rentMult: 2, depth: depthNext });
      }
      return;
    }
    case 'back': {
      player.position = (player.position - effect.steps + 40) % 40;
      land(state, actor, diceTotal, rng, { depth: depthNext });
      return;
    }
    case 'jail': {
      sendToJail(state, actor, 'is sent directly to Jail.');
      settlePhase(state);
      return;
    }
    case 'jail-card': {
      player.heldCards.push(cardId);
      log(state, actor, `keeps a Get Out of Jail Free card.`);
      settlePhase(state);
      return;
    }
    case 'cash': {
      if (effect.amount >= 0) {
        player.cash += effect.amount;
        log(state, actor, `collects ${money(effect.amount)}.`);
      } else {
        charge(state, actor, -effect.amount, null, null, `pays ${money(-effect.amount)}: ${card.text.replace(/^[^:]*:\s*/, '')}`);
      }
      settlePhase(state);
      return;
    }
    case 'collect-each': {
      state.collection = { remaining: solvent(state).filter(id => id !== actor), creditor: actor, amount: effect.amount };
      collectEach(state);
      return;
    }
    case 'pay-each': {
      const others = solvent(state).filter(id => id !== actor);
      if (!others.length) return;
      const total = effect.amount * others.length;
      charge(state, actor, total, null, others, `pays ${money(effect.amount)} to each other player.`);
      settlePhase(state);
      return;
    }
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const id of Object.keys(state.houses)) {
        if (state.owners[id] !== actor) continue;
        const count = state.houses[id]!;
        if (count === 5) hotels += 1;
        else houses += count;
      }
      const bill = houses * effect.perHouse + hotels * effect.perHotel;
      if (bill > 0) charge(state, actor, bill, null, null, `pays ${money(bill)} for repairs.`);
      settlePhase(state);
      return;
    }
  }
}

function collectEach(state: MonoState): void {
  const collection = state.collection!;
  while (collection.remaining.length) {
    const payer = collection.remaining.shift()!;
    if (state.players[payer]!.bankrupt) continue;
    if (!charge(state, payer, collection.amount, collection.creditor, null, `pays ${money(collection.amount)} to ${collection.creditor}.`)) return;
  }
  state.collection = null;
  state.phase = state.doubles > 0 ? 'preroll' : 'postroll';
}

function startAuction(state: MonoState, spaceId: number): void {
  const participants = solvent(state);
  state.auctionResume = state.phase === 'auction' ? state.auctionResume : state.phase === 'debt' ? 'debt' : state.phase === 'preroll' ? 'preroll' : state.doubles > 0 ? 'preroll' : 'postroll';
  const startIndex = participants.indexOf(state.turn);
  const order = [...participants.slice(startIndex), ...participants.slice(0, startIndex)];
  state.auction = { space: spaceId, highBid: 0, highBidder: null, passed: [], order, turn: order[0]! };
  state.phase = 'auction';
  log(state, null, `${SPACES[spaceId]!.name} goes to auction.`);
}

function auctionAdvance(state: MonoState): void {
  const auction = state.auction!;
  const active = auction.order.filter(id => !auction.passed.includes(id) && !state.players[id]!.bankrupt);
  if (!active.length) {
    closeAuction(state);
    return;
  }
  const current = active.indexOf(auction.turn);
  auction.turn = active[(current + 1) % active.length]!;
}

function closeAuction(state: MonoState): void {
  const auction = state.auction!;
  const space = SPACES[auction.space]!;
  if (auction.highBidder) {
    state.players[auction.highBidder]!.cash -= auction.highBid;
    state.owners[String(auction.space)] = auction.highBidder;
    log(state, null, `${space.name} sold at auction for ${money(auction.highBid)}.`);
  } else {
    log(state, null, `No bids — ${space.name} stays with the bank.`);
  }
  state.auction = null;
  state.phase = state.auctionResume;
  const next = state.auctionQueue.shift();
  if (next !== undefined) startAuction(state, next);
}

function endTurn(state: MonoState): void {
  state.trade = null;
  state.drawnCard = null;
  state.doubles = 0;
  state.lastRoll = null;
  const alive = solvent(state);
  if (alive.length <= 1) {
    if (alive[0]) state.turn = alive[0];
    state.phase = 'preroll';
    return;
  }
  const current = state.order.indexOf(state.turn);
  for (let step = 1; step <= state.order.length; step++) {
    const next = state.order[(current + step) % state.order.length]!;
    if (!state.players[next]!.bankrupt) {
      state.turn = next;
      break;
    }
  }
  state.phase = 'preroll';
}

function liquidateBuildings(state: MonoState, playerId: string, toCash: boolean): void {
  const player = state.players[playerId]!;
  for (const id of Object.keys(state.houses)) {
    const count = state.houses[id]!;
    if (!count || state.owners[id] !== playerId) continue;
    if (toCash) player.cash += Math.floor((SPACES[Number(id)]!.houseCost ?? 0) * count / 2);
    state.houses[id] = 0;
  }
}

function returnJailCards(state: MonoState, playerId: string): void {
  const player = state.players[playerId]!;
  for (const id of player.heldCards) {
    const deck = cardById(id).deck === 'chance' ? state.chanceDeck : state.chestDeck;
    deck.push(id);
  }
  player.heldCards = [];
}

export function removePlayer(state: MonoState, playerId: string): MonoState {
  if (state.phase === 'results' || !state.players[playerId] || state.players[playerId]!.bankrupt) return state;
  const next = structuredClone(state);
  declareBankrupt(next, playerId, null);
  return next;
}

function declareBankrupt(state: MonoState, playerId: string, creditor: string | null): void {
  const player = state.players[playerId]!;
  const creditorState = creditor !== null ? state.players[creditor] : undefined;
  const creditorAlive = !!creditorState && !creditorState.bankrupt;
  liquidateBuildings(state, playerId, creditorAlive);
  if (creditorAlive) {
    state.players[creditor!]!.cash += player.cash;
    state.players[creditor!]!.heldCards.push(...player.heldCards);
    player.heldCards = [];
    for (const id of Object.keys(state.owners)) {
      if (state.owners[id] !== playerId) continue;
      state.owners[id] = creditor;
      if (state.mortgages[id]) {
        const interest = transferInterestOf(SPACES[Number(id)]!.price ?? 0);
        state.players[creditor!]!.cash -= interest;
      }
    }
    if (state.players[creditor!]!.cash < 0) declareBankrupt(state, creditor!, null);
  } else {
    for (const id of Object.keys(state.owners)) {
      if (state.owners[id] !== playerId) continue;
      state.owners[id] = null;
      state.mortgages[id] = false;
      state.auctionQueue.push(Number(id));
    }
  }
  player.cash = 0;
  player.bankrupt = true;
  returnJailCards(state, playerId);
  state.trade = null;
  const wasDebtor = state.debt?.payer === playerId;
  if (wasDebtor) state.debt = null;
  if (state.turn === playerId) state.pendingMove = null;
  log(state, playerId, creditorAlive ? 'went bankrupt — their assets go to the creditor.' : 'went bankrupt — their properties return to the bank.');
  if (state.auction?.highBidder === playerId) {
    state.auction.highBidder = null;
    state.auction.highBid = 0;
  }
  if (state.turn === playerId) {
    endTurn(state);
    if (state.auction) {
      state.auctionResume = 'preroll';
      state.phase = 'auction';
    }
  }
  else if (wasDebtor && state.collection) collectEach(state);
  if (state.auction) auctionAdvance(state);
  checkEnd(state);
  if (state.phase !== 'results' && !state.auction && state.auctionQueue.length) startAuction(state, state.auctionQueue.shift()!);
}

function checkEnd(state: MonoState, now = 0): void {
  const alive = solvent(state);
  if (alive.length === 0 || (state.bankruptcy && alive.length === 1)) {
    state.winners = [...alive];
    state.phase = 'results';
    return;
  }
  let top = 0;
  for (const id of alive) top = Math.max(top, netWorth(state, id));
  if (state.target !== null && top >= state.target) {
    state.winners = alive.filter(id => netWorth(state, id) === top);
    state.phase = 'results';
    log(state, null, `The wealth target of ${money(state.target)} is reached.`);
  } else if (state.endsAt !== null && now >= state.endsAt) {
    state.winners = alive.filter(id => netWorth(state, id) === top);
    state.phase = 'results';
    log(state, null, 'Time is up. The highest net worth wins.');
  }
}

function setEndConditions(state: MonoState, conditions: EndConditions, now: number): void {
  if (typeof conditions.bankruptcy !== 'boolean') throw new Error('Choose whether bankruptcy ends the match.');
  if (conditions.target !== null && (!Number.isSafeInteger(conditions.target) || conditions.target <= START_CASH)) throw new Error(`Wealth target must be greater than ${money(START_CASH)}.`);
  if (conditions.timeLimitMs !== null && (!Number.isSafeInteger(conditions.timeLimitMs) || conditions.timeLimitMs < 60_000)) throw new Error('Time limit must be at least one minute.');
  if (!conditions.bankruptcy && conditions.target === null && conditions.timeLimitMs === null) throw new Error('Enable at least one end condition.');
  state.bankruptcy = conditions.bankruptcy;
  state.target = conditions.target;
  state.timeLimitMs = conditions.timeLimitMs;
  state.endsAt = conditions.timeLimitMs === null ? null : now + conditions.timeLimitMs;
}

function settleDebt(state: MonoState, rng: Rng): void {
  const debt = state.debt!;
  state.debt = null;
  payOut(state, debt.payer, debt.amount, debt.creditor, debt.spreadTo);
  state.phase = state.resume;
  if (state.collection) {
    collectEach(state);
    return;
  }
  if (state.pendingMove !== null) {
    const steps = state.pendingMove;
    state.pendingMove = null;
    advance(state, state.turn, steps);
    land(state, state.turn, state.lastRoll ? state.lastRoll[0]! + state.lastRoll[1]! : 7, rng);
    return;
  }
  state.phase = state.resume;
}

function requireTurn(state: MonoState, actor: string): void {
  if (actor !== (state.phase === 'debt' ? state.debt!.payer : state.turn)) throw new Error('It is not your turn.');
}

function requirePhase(state: MonoState, phases: MonoState['phase'][]): void {
  if (!phases.includes(state.phase)) throw new Error('That action is not available right now.');
}

function ownOrThrow(state: MonoState, actor: string, spaceId: number): void {
  if (!ownable(spaceId)) throw new Error('That space cannot be owned.');
  if (state.owners[String(spaceId)] !== actor) throw new Error('You do not own that property.');
}

function executeTrade(state: MonoState): void {
  const trade = state.trade!;
  const from = state.players[trade.from]!;
  const to = state.players[trade.to]!;
  const interest = (properties: number[]): number => properties
    .filter(id => state.mortgages[String(id)])
    .reduce((sum, id) => sum + transferInterestOf(SPACES[id]!.price ?? 0), 0);
  const toInterest = interest(trade.properties);
  const fromInterest = interest(trade.wantProperties);
  for (const [owner, properties] of [[trade.from, trade.properties], [trade.to, trade.wantProperties]] as const) {
    if (state.players[owner]!.bankrupt || properties.some(id => state.owners[String(id)] !== owner || groupHasBuildings(state, id))) throw new Error('The offered properties are no longer available to trade.');
  }
  if (to.cash + trade.cash - trade.wantCash - toInterest < 0 || from.cash + trade.wantCash - trade.cash - fromInterest < 0) throw new Error('The players can no longer cover the trade and mortgage interest.');
  from.cash -= trade.cash + fromInterest;
  to.cash += trade.cash - toInterest;
  from.cash += trade.wantCash;
  to.cash -= trade.wantCash;
  for (const id of trade.properties) state.owners[String(id)] = trade.to;
  for (const id of trade.wantProperties) state.owners[String(id)] = trade.from;
  state.trade = null;
  log(state, null, 'The trade was completed.');
  checkEnd(state);
}

export function newMatch(playerIds: readonly string[], seed: number, opts: Partial<EndConditions> & { now?: number; setup?: boolean } = {}): MonoState {
  if (playerIds.length < 2) throw new Error('Monopoly needs at least two players.');
  const rng = mulberry32(seed);
  const order = shuffle(playerIds, rng);
  const players: Record<string, PlayerState> = {};
  for (const id of order) {
    players[id] = { cash: START_CASH, position: 0, inJail: false, jailTurns: 0, heldCards: [], bankrupt: false };
  }
  const owners: Record<string, string | null> = {};
  const houses: Record<string, number> = {};
  const mortgages: Record<string, boolean> = {};
  for (const space of SPACES) {
    if (ownable(space.id)) {
      owners[String(space.id)] = null;
      houses[String(space.id)] = 0;
      mortgages[String(space.id)] = false;
    }
  }
  const state: MonoState = {
    phase: opts.setup ? 'setup' : 'preroll',
    players,
    order,
    turn: order[0]!,
    turnStartedAt: 0,
    owners,
    houses,
    mortgages,
    doubles: 0,
    lastRoll: null,
    auction: null,
    auctionQueue: [],
    auctionResume: 'postroll',
    collection: null,
    trade: null,
    debt: null,
    pendingMove: null,
    resume: 'postroll',
    chanceDeck: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rng),
    chestDeck: shuffle([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], rng),
    drawnCard: null,
    log: [{ actor: null, text: opts.setup ? `${order[0]} chooses the end conditions.` : `${order[0]} goes first.` }],
    winners: [],
    bankruptcy: true,
    target: null,
    timeLimitMs: null,
    endsAt: null,
  };
  setEndConditions(state, { bankruptcy: opts.bankruptcy ?? true, target: opts.target ?? null, timeLimitMs: opts.timeLimitMs ?? null }, opts.now ?? 0);
  return state;
}

function rollAndMove(state: MonoState, actor: string, rng: Rng): void {
  const [a, b] = roll2(rng);
  state.lastRoll = [a, b];
  const total = a + b;
  if (a === b) {
    state.doubles += 1;
    if (state.doubles >= 3) {
      sendToJail(state, actor, `rolls doubles three times and is sent to Jail.`);
      endTurn(state);
      return;
    }
    log(state, actor, `rolls ${a} + ${b} — doubles!`);
  } else {
    state.doubles = 0;
    log(state, actor, `rolls ${a} + ${b}.`);
  }
  advance(state, actor, total);
  land(state, actor, total, rng);
}

export function applyAction(raw: MonoState, actor: string, action: MonoAction, rng: Rng, now = 0): MonoState {
  const state = structuredClone(raw);
  if (state.phase === 'results') throw new Error('The match is over.');
  const player = state.players[actor];
  if (!player) throw new Error('You are not part of this match.');
  if (state.phase !== 'setup' && state.endsAt !== null && now >= state.endsAt) {
    checkEnd(state, now);
    return state;
  }
  if (state.phase === 'setup' && action.type !== 'configure') throw new Error('Choose the end conditions first.');
  if (player.bankrupt && action.type !== 'timeout') throw new Error('You are out of the match.');
  switch (action.type) {
    case 'configure': {
      requireTurn(state, actor);
      requirePhase(state, ['setup']);
      setEndConditions(state, action.conditions, now);
      state.phase = 'preroll';
      log(state, actor, 'sets the end conditions. The match begins.');
      return state;
    }
    case 'finish-time': throw new Error('There is still time left in the match.');
    case 'roll': {
      requireTurn(state, actor);
      requirePhase(state, ['preroll']);
      if (player.inJail) throw new Error('You are in Jail — pay the fine, use a card, or try to roll doubles.');
      rollAndMove(state, actor, rng);
      checkEnd(state);
      return state;
    }
    case 'jail-fine': {
      requireTurn(state, actor);
      requirePhase(state, ['preroll']);
      if (!player.inJail) throw new Error('You are not in Jail.');
      player.inJail = false;
      player.jailTurns = 0;
      state.resume = 'preroll';
      charge(state, actor, JAIL_FINE, null, null, `pays the ${money(JAIL_FINE)} fine and leaves Jail.`);
      state.resume = 'preroll';
      checkEnd(state);
      return state;
    }
    case 'jail-card': {
      requireTurn(state, actor);
      requirePhase(state, ['preroll']);
      if (!player.inJail) throw new Error('You are not in Jail.');
      const cardId = player.heldCards.pop();
      if (cardId === undefined) throw new Error('You have no Get Out of Jail Free card.');
      const deck = cardById(cardId).deck === 'chance' ? state.chanceDeck : state.chestDeck;
      deck.push(cardId);
      player.inJail = false;
      player.jailTurns = 0;
      log(state, actor, `uses a Get Out of Jail Free card.`);
      checkEnd(state);
      return state;
    }
    case 'jail-roll': {
      requireTurn(state, actor);
      requirePhase(state, ['preroll']);
      if (!player.inJail) throw new Error('You are not in Jail.');
      const [a, b] = roll2(rng);
      state.lastRoll = [a, b];
      const total = a + b;
      if (a === b) {
        player.inJail = false;
        player.jailTurns = 0;
        log(state, actor, `rolls doubles (${a} + ${b}) and leaves Jail.`);
        advance(state, actor, total);
        land(state, actor, total, rng);
      } else {
        player.jailTurns += 1;
        if (player.jailTurns >= 3) {
          log(state, actor, `fails a third time (${a} + ${b}) and must pay the fine.`);
          player.inJail = false;
          player.jailTurns = 0;
          state.pendingMove = total;
          state.resume = 'postroll';
          if (charge(state, actor, JAIL_FINE, null, null, `pays the ${money(JAIL_FINE)} fine.`)) {
            const steps = state.pendingMove!;
            state.pendingMove = null;
            advance(state, actor, steps);
            land(state, actor, total, rng);
          }
        } else {
          log(state, actor, `fails to roll doubles (${a} + ${b}).`);
          settlePhase(state);
        }
      }
      checkEnd(state);
      return state;
    }
    case 'buy': {
      requireTurn(state, actor);
      requirePhase(state, ['buy-decision']);
      const space = SPACES[player.position]!;
      if (!ownable(space.id)) throw new Error('This space cannot be bought.');
      const price = space.price!;
      if (player.cash < price) throw new Error(`You need ${money(price)} to buy ${space.name}.`);
      player.cash -= price;
      state.owners[String(space.id)] = actor;
      log(state, actor, `buys ${space.name} for ${money(price)}.`);
      settlePhase(state);
      checkEnd(state);
      return state;
    }
    case 'decline': {
      requireTurn(state, actor);
      requirePhase(state, ['buy-decision']);
      startAuction(state, player.position);
      checkEnd(state);
      return state;
    }
    case 'bid': {
      const auction = state.auction;
      if (!auction || state.phase !== 'auction') throw new Error('There is no auction.');
      if (actor !== auction.turn) throw new Error('Wait for your turn to bid.');
      const amount = action.amount;
      if (!Number.isInteger(amount) || amount <= auction.highBid) throw new Error(`Bid more than ${money(auction.highBid)}.`);
      if (amount > state.players[actor]!.cash) throw new Error('You cannot cover that bid.');
      auction.highBid = amount;
      auction.highBidder = actor;
      log(state, actor, `bids ${money(amount)} for ${SPACES[auction.space]!.name}.`);
      auctionAdvance(state);
      checkEnd(state);
      return state;
    }
    case 'pass-bid': {
      const auction = state.auction;
      if (!auction || state.phase !== 'auction') throw new Error('There is no auction.');
      if (actor !== auction.turn) throw new Error('Wait for your turn to bid.');
      auction.passed.push(actor);
      auctionAdvance(state);
      checkEnd(state);
      return state;
    }
    case 'build': {
      requirePhase(state, ['preroll', 'postroll']);
      ownOrThrow(state, actor, action.space);
      const space = SPACES[action.space]!;
      if (space.kind !== 'street') throw new Error('Only streets can be built on.');
      const group = space.group!;
      if (!ownsGroup(state, group, actor)) throw new Error('You must own the whole colour group.');
      if (GROUP_SPACES[group].some(id => state.mortgages[String(id)])) throw new Error('Mortgaged properties in the group block building.');
      const counts = groupStreets(group).map(id => state.houses[String(id)] ?? 0);
      const min = Math.min(...counts);
      if ((state.houses[String(action.space)] ?? 0) !== min) throw new Error('Build evenly across the group.');
      if (min >= 5) throw new Error('A hotel already stands here.');
      const cost = space.houseCost!;
      if (player.cash < cost) throw new Error(`A house costs ${money(cost)}.`);
      if (min === 4) {
        if (hotelsInPlay(state) >= HOTEL_STOCK) throw new Error('The bank has no hotels left.');
      } else if (housesInPlay(state) >= HOUSE_STOCK) throw new Error('The bank has no houses left.');
      player.cash -= cost;
      state.houses[String(action.space)] = min + 1;
      log(state, actor, `builds on ${space.name} for ${money(cost)}.`);
      return state;
    }
    case 'sell': {
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      ownOrThrow(state, actor, action.space);
      const space = SPACES[action.space]!;
      if (space.kind !== 'street') throw new Error('Only streets have buildings.');
      const counts = groupStreets(space.group!).map(id => state.houses[String(id)] ?? 0);
      const max = Math.max(...counts);
      if ((state.houses[String(action.space)] ?? 0) !== max) throw new Error('Sell evenly across the group.');
      if (max === 0) throw new Error('There is nothing to sell here.');
      if (action.all) {
        for (const id of groupStreets(space.group!)) {
          player.cash += (state.houses[String(id)] ?? 0) * space.houseCost! / 2;
          state.houses[String(id)] = 0;
        }
        log(state, actor, `sells all buildings in the ${space.group} group.`);
        return state;
      }
      if (max === 5 && HOUSE_STOCK - housesInPlay(state) < 4) throw new Error('The bank needs four houses to replace a hotel. Sell all buildings in the group instead.');
      state.houses[String(action.space)] = max - 1;
      const refund = Math.floor(space.houseCost! / 2);
      player.cash += refund;
      log(state, actor, `sells a building on ${space.name} for ${money(refund)}.`);
      return state;
    }
    case 'mortgage': {
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      ownOrThrow(state, actor, action.space);
      if (state.mortgages[String(action.space)]) throw new Error('Already mortgaged.');
      const space = SPACES[action.space]!;
      if (groupHasBuildings(state, action.space)) throw new Error('Sell the buildings in this group first.');
      const value = Math.floor(space.price! / 2);
      state.mortgages[String(action.space)] = true;
      player.cash += value;
      log(state, actor, `mortgages ${space.name} for ${money(value)}.`);
      return state;
    }
    case 'unmortgage': {
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      ownOrThrow(state, actor, action.space);
      if (!state.mortgages[String(action.space)]) throw new Error('That property is not mortgaged.');
      const space = SPACES[action.space]!;
      const cost = mortgageInterestOf(space.price!);
      if (player.cash < cost) throw new Error(`Lifting the mortgage costs ${money(cost)}.`);
      state.mortgages[String(action.space)] = false;
      player.cash -= cost;
      log(state, actor, `lifts the mortgage on ${space.name} for ${money(cost)}.`);
      return state;
    }
    case 'propose-trade': {
      requireTurn(state, actor);
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      if (state.trade) throw new Error('A trade is already on the table.');
      const to = action.to;
      if (to === actor) throw new Error('Trade with another player.');
      const other = state.players[to];
      if (!other || other.bankrupt) throw new Error('That player is out of the match.');
      if (!Number.isInteger(action.cash) || action.cash < 0 || action.cash > player.cash) throw new Error('Invalid cash offer.');
      if (!Number.isInteger(action.wantCash) || action.wantCash < 0 || action.wantCash > other.cash) throw new Error('Invalid cash request.');
      const properties = [...new Set(action.properties)];
      const wantProperties = [...new Set(action.wantProperties)];
      for (const id of properties) {
        if (!ownable(id) || state.owners[String(id)] !== actor) throw new Error('You do not own one of those properties.');
        if (groupHasBuildings(state, id)) throw new Error('Sell the buildings before trading that group.');
      }
      for (const id of wantProperties) {
        if (!ownable(id) || state.owners[String(id)] !== to) throw new Error('They do not own one of those properties.');
        if (groupHasBuildings(state, id)) throw new Error('They must sell buildings before trading that group.');
      }
      state.trade = { from: actor, to, cash: action.cash, properties, wantCash: action.wantCash, wantProperties };
      log(state, actor, `proposes a trade.`);
      return state;
    }
    case 'accept-trade': {
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      const trade = state.trade;
      if (!trade) throw new Error('There is no trade to accept.');
      if (actor !== trade.to) throw new Error('Only the offered player can accept.');
      executeTrade(state);
      return state;
    }
    case 'reject-trade': {
      requirePhase(state, ['preroll', 'postroll', 'debt']);
      const trade = state.trade;
      if (!trade) throw new Error('There is no trade to reject.');
      if (actor !== trade.to && actor !== trade.from) throw new Error('Only the players in the trade can respond.');
      state.trade = null;
      log(state, null, 'The trade was declined.');
      return state;
    }
    case 'end-turn': {
      requireTurn(state, actor);
      requirePhase(state, ['postroll']);
      endTurn(state);
      checkEnd(state);
      return state;
    }
    case 'pay-debt': {
      requireTurn(state, actor);
      const debt = state.debt;
      if (state.phase !== 'debt' || !debt) throw new Error('There is no debt to settle.');
      if (player.cash < debt.amount) throw new Error(`Raise ${money(debt.amount - player.cash)} more first — mortgage or sell.`);
      settleDebt(state, rng);
      checkEnd(state);
      return state;
    }
    case 'declare-bankrupt': {
      requireTurn(state, actor);
      requirePhase(state, ['debt']);
      declareBankrupt(state, actor, state.debt?.creditor ?? null);
      return state;
    }
    case 'timeout': {
      if (player.bankrupt) return state;
      if (state.phase === 'auction' && state.auction && actor === state.auction.turn) {
        state.auction.passed.push(actor);
        auctionAdvance(state);
        return state;
      }
      if (actor !== (state.phase === 'debt' ? state.debt!.payer : state.turn)) return state;
      if (state.phase === 'buy-decision') {
        startAuction(state, player.position);
        return state;
      }
      if (state.phase === 'debt') {
        declareBankrupt(state, actor, state.debt?.creditor ?? null);
        return state;
      }
      if (state.phase === 'preroll' && player.inJail) {
        return applyAction(state, actor, { type: 'jail-roll' }, rng);
      }
      if (state.phase === 'preroll' || state.phase === 'postroll') {
        endTurn(state);
        checkEnd(state);
      }
      return state;
    }
    default: {
      throw new Error('Unknown action.');
    }
  }
}

export function toView(state: MonoState, playerId: string | null): MonoView {
  return { ...state, you: playerId ?? null };
}
