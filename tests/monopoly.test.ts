import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, type Rng } from '../games/monopoly/src/rules/rng.ts';
import {
  applyAction, newMatch, netWorth, removePlayer, rentFor, toView,
  type MonoState, type PlayerState,
} from '../games/monopoly/src/rules/engine.ts';
import { actorFor, botMove } from '../games/monopoly/src/bots/bots.ts';

const PLAYERS = ['you', 'ada', 'rex'];

function playerOf(state: MonoState, id: string): PlayerState {
  const player = state.players[id];
  if (!player) throw new Error(`missing player ${id}`);
  return player;
}

/** Rng whose successive calls produce the wanted dice pips, cycling. */
const dice = (...pips: number[]): Rng => {
  let i = 0;
  return () => (pips[i++ % pips.length]! - 1 + 0.5) / 6;
};

const anyRng = mulberry32(1);

function fresh(): MonoState {
  const state = newMatch(PLAYERS, 7);
  state.turn = 'you';
  return state;
}

test('a new match deals starting cash, deterministic order and full decks', () => {
  const a = newMatch(PLAYERS, 7);
  const b = newMatch(PLAYERS, 7);
  assert.deepEqual(a.order, b.order);
  assert.equal(a.turn, a.order[0]);
  assert.equal(a.phase, 'preroll');
  for (const player of Object.values(a.players)) assert.equal(player.cash, 1500);
  assert.equal(a.chanceDeck.length, 16);
  assert.equal(a.chestDeck.length, 16);
  assert.notEqual(a.chanceDeck.join(','), '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15');
});

test('rolling pays salary past Go and buying transfers ownership', () => {
  let state = fresh();
  playerOf(state, 'you').position = 39;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').position, 1);
  assert.equal(playerOf(state, 'you').cash, 1700);
  assert.equal(state.phase, 'buy-decision');
  state = applyAction(state, 'you', { type: 'buy' }, anyRng);
  assert.equal(state.owners['1'], 'you');
  assert.equal(playerOf(state, 'you').cash, 1640);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.doubles, 1);
});

test('landing on an owned street pays rent, doubled inside the colour group', () => {
  const run = (monopoly: boolean) => {
    let state = fresh();
    playerOf(state, 'you').position = 39;
    playerOf(state, 'ada').cash = 1000;
    state.owners['6'] = 'ada';
    if (monopoly) {
      state.owners['8'] = 'ada';
      state.owners['9'] = 'ada';
    }
    state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
    return state;
  };
  const single = run(false);
  assert.equal(playerOf(single, 'you').cash, 1700 - 6);
  assert.equal(playerOf(single, 'ada').cash, 1006);
  assert.equal(single.phase, 'postroll');
  const full = run(true);
  assert.equal(playerOf(full, 'you').cash, 1700 - 12);
  assert.equal(playerOf(full, 'ada').cash, 1012);
});

test('houses raise rent by tier and hotels pay the top rate', () => {
  let state = fresh();
  playerOf(state, 'you').position = 39;
  state.owners['6'] = 'ada';
  state.houses['6'] = 1;
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  assert.equal(playerOf(state, 'you').cash, 1700 - 30);
  assert.equal(rentFor(state, 6, 0), 30);
  state.houses['6'] = 5;
  assert.equal(rentFor(state, 6, 0), 550);
});

test('railroads scale with count and utilities multiply the dice', () => {
  let state = fresh();
  state.owners['5'] = 'ada';
  playerOf(state, 'you').position = 3;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1500 - 25);
  for (const id of [15, 25, 35]) state.owners[String(id)] = 'ada';
  assert.equal(rentFor(state, 5, 0), 200);

  state = fresh();
  state.owners['12'] = 'ada';
  playerOf(state, 'you').position = 10;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1500 - 8);
  state.owners['28'] = 'ada';
  assert.equal(rentFor(state, 12, 2), 20);
  assert.equal(rentFor(state, 12, 7, { utilityTimes: 10 }), 70);
});

test('declining starts an auction whose winner pays the bank', () => {
  let state = fresh();
  playerOf(state, 'you').position = 39;
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  assert.equal(state.phase, 'buy-decision');
  state = applyAction(state, 'you', { type: 'decline' }, anyRng);
  assert.equal(state.phase, 'auction');
  assert.equal(state.auction!.turn, 'you');
  state = applyAction(state, 'you', { type: 'bid', amount: 60 }, anyRng);
  state = applyAction(state, 'ada', { type: 'bid', amount: 100 }, anyRng);
  state = applyAction(state, 'rex', { type: 'pass-bid' }, anyRng);
  state = applyAction(state, 'you', { type: 'pass-bid' }, anyRng);
  state = applyAction(state, 'ada', { type: 'pass-bid' }, anyRng);
  assert.equal(state.auction, null);
  assert.equal(state.owners['6'], 'ada');
  assert.equal(playerOf(state, 'ada').cash, 1400);
  assert.equal(state.phase, 'postroll');
});

test('an auction with no bids leaves the property with the bank', () => {
  let state = fresh();
  playerOf(state, 'you').position = 39;
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  state = applyAction(state, 'you', { type: 'decline' }, anyRng);
  for (const player of PLAYERS) state = applyAction(state, player, { type: 'pass-bid' }, anyRng);
  assert.equal(state.auction, null);
  assert.equal(state.owners['6'], null);
  assert.equal(state.phase, 'postroll');
});

test('building must be even across the group and mortgages block rent', () => {
  let state = fresh();
  for (const id of [16, 18, 19]) state.owners[String(id)] = 'you';
  state = applyAction(state, 'you', { type: 'build', space: 18 }, anyRng);
  assert.equal(state.houses['18'], 1);
  assert.throws(() => applyAction(state, 'you', { type: 'build', space: 18 }, anyRng), /evenly/);
  state = applyAction(state, 'you', { type: 'build', space: 16 }, anyRng);
  state = applyAction(state, 'you', { type: 'build', space: 19 }, anyRng);
  assert.deepEqual([state.houses['16'], state.houses['18'], state.houses['19']], [1, 1, 1]);
  state.houses['18'] = 5;
  assert.equal(rentFor(state, 18, 0), 950);

  state = fresh();
  state.owners['6'] = 'ada';
  state.mortgages['6'] = true;
  playerOf(state, 'you').position = 39;
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  assert.equal(playerOf(state, 'you').cash, 1700);
  state.turn = 'ada';
  state = applyAction(state, 'ada', { type: 'unmortgage', space: 6 }, anyRng);
  assert.equal(playerOf(state, 'ada').cash, 1500 - 55);
  state.turn = 'ada';
  state.owners['8'] = 'ada';
  state.owners['9'] = 'ada';
  state.houses['8'] = 1;
  assert.throws(() => applyAction(state, 'ada', { type: 'mortgage', space: 9 }, anyRng), /Sell the buildings/);
});

test('jail escapes on doubles and the third failure forces the fine', () => {
  let state = fresh();
  playerOf(state, 'you').position = 10;
  playerOf(state, 'you').inJail = true;
  state = applyAction(state, 'you', { type: 'jail-roll' }, dice(2, 2));
  assert.equal(playerOf(state, 'you').inJail, false);
  assert.equal(playerOf(state, 'you').position, 14);
  assert.equal(playerOf(state, 'you').cash, 1500);

  state = fresh();
  playerOf(state, 'you').position = 10;
  playerOf(state, 'you').inJail = true;
  playerOf(state, 'you').jailTurns = 2;
  state = applyAction(state, 'you', { type: 'jail-roll' }, dice(1, 2));
  assert.equal(playerOf(state, 'you').inJail, false);
  assert.equal(playerOf(state, 'you').cash, 1450);
  assert.equal(playerOf(state, 'you').position, 13);
  assert.equal(state.phase, 'buy-decision');
});

test('a fine you cannot pay becomes debt that ends in bankruptcy', () => {
  let state = fresh();
  playerOf(state, 'you').position = 10;
  playerOf(state, 'you').inJail = true;
  playerOf(state, 'you').jailTurns = 2;
  playerOf(state, 'you').cash = 10;
  state = applyAction(state, 'you', { type: 'jail-roll' }, dice(1, 2));
  assert.equal(state.phase, 'debt');
  assert.equal(state.debt!.amount, 50);
  state = applyAction(state, 'you', { type: 'declare-bankrupt' }, anyRng);
  assert.equal(playerOf(state, 'you').bankrupt, true);
  assert.equal(playerOf(state, 'you').cash, 0);
  assert.equal(state.phase, 'preroll');
  assert.notEqual(state.turn, 'you');
});

test('going bankrupt to a player hands over cash and mortgaged deeds', () => {
  let state = fresh();
  state.owners['39'] = 'ada';
  state.houses['39'] = 5;
  state.owners['6'] = 'you';
  state.mortgages['6'] = true;
  playerOf(state, 'you').position = 37;
  playerOf(state, 'you').cash = 100;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(state.phase, 'debt');
  assert.equal(state.debt!.amount, 2000);
  assert.equal(state.debt!.creditor, 'ada');
  state = applyAction(state, 'you', { type: 'declare-bankrupt' }, anyRng);
  assert.equal(playerOf(state, 'you').bankrupt, true);
  assert.equal(playerOf(state, 'ada').cash, 1595);
  assert.equal(state.owners['6'], 'ada');
  assert.equal(state.mortgages['6'], true);
  assert.equal(state.phase, 'preroll');
  state = removePlayer(state, 'rex');
  assert.equal(state.phase, 'results');
  assert.deepEqual(state.winners, ['ada']);
});

test('the wealth target ends the match with the richest player winning', () => {
  let state = newMatch(PLAYERS, 7, { target: 1510 });
  state.turn = 'you';
  playerOf(state, 'you').position = 39;
  for (const id of [6, 8, 9]) state.owners[String(id)] = 'ada';
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  assert.equal(state.phase, 'results');
  assert.deepEqual(state.winners, ['ada']);
  assert.equal(netWorth(state, 'ada'), 1832);
});

test('doubles grant a bonus roll and three doubles go to Jail', () => {
  let state = fresh();
  state = applyAction(state, 'you', { type: 'roll' }, dice(2, 2));
  assert.equal(playerOf(state, 'you').position, 4);
  assert.equal(playerOf(state, 'you').cash, 1300);
  assert.equal(state.phase, 'preroll');
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 3));
  assert.equal(state.phase, 'buy-decision');

  state = fresh();
  state.chanceDeck = [15, ...state.chanceDeck.filter(id => id !== 15)];
  playerOf(state, 'you').position = 34;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1600);
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1500);
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').inJail, true);
  assert.equal(playerOf(state, 'you').position, 10);
  assert.notEqual(state.turn, 'you');
  assert.equal(state.phase, 'preroll');
});

test('chance cards move the player and charge card rents', () => {
  let state = fresh();
  state.chanceDeck = [7, ...state.chanceDeck.filter(id => id !== 7)];
  playerOf(state, 'you').position = 20;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').position, 19);
  assert.equal(state.phase, 'buy-decision');

  state = fresh();
  state.chanceDeck = [4, ...state.chanceDeck.filter(id => id !== 4)];
  state.owners['15'] = 'ada';
  playerOf(state, 'you').position = 5;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').position, 15);
  assert.equal(playerOf(state, 'you').cash, 1500 - 50);
  assert.equal(playerOf(state, 'ada').cash, 1550);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.doubles, 1);
});

test('debts are raised by mortgaging and settled with pay-debt', () => {
  let state = fresh();
  state.owners['39'] = 'ada';
  state.houses['39'] = 5;
  playerOf(state, 'you').position = 37;
  for (const id of [6, 8, 9, 5, 15, 25, 35]) state.owners[String(id)] = 'you';
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(state.phase, 'debt');
  assert.equal(state.debt!.amount, 2000);
  assert.throws(() => applyAction(state, 'you', { type: 'pay-debt' }, anyRng), /Raise/);
  for (const id of [6, 8, 9, 5, 15, 25, 35]) {
    state = applyAction(state, 'you', { type: 'mortgage', space: id }, anyRng);
  }
  assert.equal(playerOf(state, 'you').cash, 2060);
  state = applyAction(state, 'you', { type: 'pay-debt' }, anyRng);
  assert.equal(playerOf(state, 'you').cash, 60);
  assert.equal(playerOf(state, 'ada').cash, 3500);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.doubles, 1);
});

test('trades transfer deeds and cash, with interest on mortgaged deeds', () => {
  let state = fresh();
  state.owners['1'] = 'you';
  state.owners['3'] = 'ada';
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 100, properties: [1], wantCash: 0, wantProperties: [3] }, anyRng);
  assert.equal(state.trade!.to, 'ada');
  state = applyAction(state, 'ada', { type: 'accept-trade' }, anyRng);
  assert.equal(state.trade, null);
  assert.equal(state.owners['1'], 'ada');
  assert.equal(state.owners['3'], 'you');
  assert.equal(playerOf(state, 'you').cash, 1400);
  assert.equal(playerOf(state, 'ada').cash, 1600);

  state.houses['3'] = 1;
  assert.throws(() => applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 0, properties: [3], wantCash: 0, wantProperties: [] }, anyRng), /Sell the buildings/);
  state.houses['3'] = 0;
  state.houses['1'] = 1;
  assert.throws(() => applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 0, properties: [], wantCash: 0, wantProperties: [1] }, anyRng), /They must sell buildings/);
  state.houses['1'] = 0;
  state.mortgages['1'] = true;
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 100, properties: [], wantCash: 0, wantProperties: [1] }, anyRng);
  state = applyAction(state, 'ada', { type: 'reject-trade' }, anyRng);
  assert.equal(state.trade, null);
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 100, properties: [], wantCash: 0, wantProperties: [1] }, anyRng);
  state = applyAction(state, 'ada', { type: 'accept-trade' }, anyRng);
  assert.equal(state.owners['1'], 'you');
  assert.equal(playerOf(state, 'you').cash, 1297);
  assert.equal(state.mortgages['1'], true);
});

test('timeout forces the stalled phase forward', () => {
  let state = fresh();
  state = applyAction(state, 'you', { type: 'timeout' }, anyRng);
  assert.notEqual(state.turn, 'you');
  assert.equal(state.phase, 'preroll');

  state = fresh();
  playerOf(state, 'you').position = 39;
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 4));
  state = applyAction(state, 'you', { type: 'timeout' }, anyRng);
  assert.equal(state.phase, 'auction');
});

test('removing a player releases their deeds to the bank', () => {
  let state = fresh();
  state.owners['6'] = 'rex';
  state.owners['5'] = 'rex';
  playerOf(state, 'rex').cash = 300;
  state = removePlayer(state, 'rex');
  assert.equal(playerOf(state, 'rex').bankrupt, true);
  assert.equal(playerOf(state, 'rex').cash, 0);
  assert.equal(state.owners['6'], null);
  assert.equal(state.owners['5'], null);
});

test('views tag the spectator and the acting player', () => {
  const state = fresh();
  assert.equal(toView(state, null).you, null);
  assert.equal(toView(state, 'ada').you, 'ada');
});

test('bots drive a complete match to a result', () => {
  let state = newMatch(PLAYERS, 123);
  const rng = mulberry32(7);
  let steps = 0;
  while (state.phase !== 'results' && steps < 20_000) {
    const action = botMove(state, actorFor(state), rng);
    if (!action) break;
    state = applyAction(state, actorFor(state), action, rng);
    steps++;
  }
  assert.equal(state.phase, 'results');
  assert.equal(state.winners.length, 1);
  assert.ok(steps > 10);
});