import { GROUP_SPACES, JAIL_FINE, SPACES, mortgageInterestOf } from '../rules/board';
import { ownsGroup, type MonoAction, type MonoState } from '../rules/engine';
import type { Rng } from '../rules/rng';

const CASH_RESERVE = 120;
const BUILD_RESERVE = 200;

export function actorFor(state: MonoState): string {
  if (state.phase === 'auction' && state.auction) return state.auction.turn;
  if (state.trade) return state.trade.to;
  return state.turn;
}

function ownedProperties(state: MonoState, actor: string): number[] {
  return Object.keys(state.owners)
    .filter(id => state.owners[id] === actor)
    .map(Number);
}

function pickMortgage(state: MonoState, actor: string): number | null {
  const owned = ownedProperties(state, actor).filter(id => !state.mortgages[String(id)]);
  if (!owned.length) return null;
  return owned.sort((a, b) => (SPACES[a]!.price ?? 0) - (SPACES[b]!.price ?? 0))[0]!;
}

function pickSale(state: MonoState, actor: string): number | null {
  const owned = ownedProperties(state, actor);
  let best: number | null = null;
  let bestHouses = 0;
  for (const id of owned) {
    const space = SPACES[id]!;
    if (space.kind !== 'street') continue;
    const houses = state.houses[String(id)] ?? 0;
    if (!houses) continue;
    const groupMax = Math.max(...GROUP_SPACES[space.group!].map(other => state.houses[String(other)] ?? 0));
    if (houses !== groupMax) continue;
    if (houses > bestHouses) {
      bestHouses = houses;
      best = id;
    }
  }
  return best;
}

function pickBuild(state: MonoState, actor: string): number | null {
  let best: number | null = null;
  let bestCost = Infinity;
  for (const id of ownedProperties(state, actor)) {
    const space = SPACES[id]!;
    if (space.kind !== 'street') continue;
    const group = space.group!;
    if (!ownsGroup(state, group, actor)) continue;
    if (GROUP_SPACES[group].some(other => state.mortgages[String(other)])) continue;
    const houses = state.houses[String(id)] ?? 0;
    if (houses >= 5) continue;
    const min = Math.min(...GROUP_SPACES[group].map(other => state.houses[String(other)] ?? 0));
    if (houses !== min) continue;
    if (space.houseCost! < bestCost) {
      bestCost = space.houseCost!;
      best = id;
    }
  }
  return best;
}

function pickUnmortgage(state: MonoState, actor: string): number | null {
  const owned = ownedProperties(state, actor).filter(id => state.mortgages[String(id)]);
  if (!owned.length) return null;
  return owned.sort((a, b) => (SPACES[a]!.price ?? 0) - (SPACES[b]!.price ?? 0))[0]!;
}

function unmortgageCost(_state: MonoState, spaceId: number): number {
  return mortgageInterestOf(SPACES[spaceId]!.price ?? 0);
}

function tradeValue(state: MonoState, properties: number[], cash: number, actor: string): number {
  let total = cash;
  for (const id of properties) {
    const space = SPACES[id]!;
    let value = space.price ?? 0;
    const group = space.group;
    if (group && !GROUP_SPACES[group].some(other => other !== id && state.owners[String(other)] === actor)) {
      const partners = GROUP_SPACES[group].filter(other => other !== id && state.owners[String(other)] !== null && state.owners[String(other)] !== actor);
      if (partners.length === GROUP_SPACES[group].length - 1) value *= 1.5;
    }
    total += value;
  }
  return total;
}

export function botMove(state: MonoState, actor: string, rng: Rng): MonoAction | null {
  const player = state.players[actor];
  if (!player || player.bankrupt) return null;
  if (state.phase === 'results') return null;

  if (state.trade && state.trade.to === actor) {
    const trade = state.trade;
    const give = tradeValue(state, trade.wantProperties, trade.wantCash, actor);
    const get = tradeValue(state, trade.properties, trade.cash, actor);
    return get >= give + 20 ? { type: 'accept-trade' } : { type: 'reject-trade' };
  }

  switch (state.phase) {
    case 'preroll': {
      if (player.inJail) {
        if (player.heldCards.length) return { type: 'jail-card' };
        if (player.jailTurns === 0 && player.cash >= JAIL_FINE + CASH_RESERVE) return { type: 'jail-fine' };
        return { type: 'jail-roll' };
      }
      return { type: 'roll' };
    }
    case 'buy-decision': {
      const price = SPACES[player.position]!.price ?? 0;
      return price <= player.cash - CASH_RESERVE ? { type: 'buy' } : { type: 'decline' };
    }
    case 'auction': {
      const auction = state.auction;
      if (!auction) return null;
      const value = SPACES[auction.space]!.price ?? 0;
      const cap = Math.min(player.cash, Math.floor(value * (rng() < 0.25 ? 1.1 : 0.9)));
      if (auction.highBidder === actor || cap <= auction.highBid) return { type: 'pass-bid' };
      const bid = Math.min(auction.highBid + 10, cap);
      return { type: 'bid', amount: Math.max(bid, auction.highBid + 1) };
    }
    case 'debt': {
      const amount = state.debt!.amount;
      if (player.cash >= amount) return { type: 'pay-debt' };
      const mortgage = pickMortgage(state, actor);
      if (mortgage !== null) return { type: 'mortgage', space: mortgage };
      const sale = pickSale(state, actor);
      if (sale !== null) return { type: 'sell', space: sale };
      return { type: 'declare-bankrupt' };
    }
    case 'postroll': {
      const mortgage = pickUnmortgage(state, actor);
      if (mortgage !== null && player.cash - unmortgageCost(state, mortgage) >= 400) {
        return { type: 'unmortgage', space: mortgage };
      }
      const build = pickBuild(state, actor);
      if (build !== null && player.cash - SPACES[build]!.houseCost! >= BUILD_RESERVE) {
        return { type: 'build', space: build };
      }
      return { type: 'end-turn' };
    }
    default:
      return null;
  }
}