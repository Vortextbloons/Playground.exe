import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { mulberry32, type Rng } from '../games/monopoly/src/rules/rng.ts';
import {
  applyAction, housesInPlay, newMatch, netWorth, removePlayer, rentFor, toView,
  type MonoState, type PlayerState,
} from '../games/monopoly/src/rules/engine.ts';
import { actorFor, botMove } from '../games/monopoly/src/bots/bots.ts';
import monopolyMultiplayer, { type MpState } from '../games/monopoly/src/multiplayer.ts';

const PLAYERS = ['you', 'ada', 'rex'];

test('multiplayer trade payloads can cross the message bridge with reactive property selections', () => {
  const component = readFileSync(new URL('../games/monopoly/src/MonopolyApp.svelte', import.meta.url), 'utf8');
  const script = component.slice(component.indexOf('>') + 1, component.indexOf('</script>'));
  const file = ts.createSourceFile('MonopolyApp.ts', script, ts.ScriptTarget.Latest, true);
  const payloadOf = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'payloadOf');
  assert.ok(payloadOf);
  const serialize = runInNewContext(ts.transpile(`${payloadOf.getText(file)}\npayloadOf;`));
  for (const [properties, wantProperties] of [[[], []], [[1], [3]]]) {
    const payload = serialize({
      type: 'propose-trade', to: 'ada', cash: 100, wantCash: 0,
      properties: new Proxy(properties!, {}), wantProperties: new Proxy(wantProperties!, {}),
    });
    assert.deepEqual(structuredClone(payload), { to: 'ada', cash: 100, wantCash: 0, properties, wantProperties });
  }
});

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

test('bankruptcy-only matches do not end at $5,000', () => {
  let state = fresh();
  playerOf(state, 'you').cash = 6000;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 2));
  assert.notEqual(state.phase, 'results');
  assert.equal(state.target, null);
});

test('disabling bankruptcy lets the survivor continue until the time limit', () => {
  let state = newMatch(['you', 'ada'], 7, { bankruptcy: false, timeLimitMs: 60_000, now: 10_000 });
  state = removePlayer(state, 'ada');
  assert.equal(state.phase, 'preroll');
  assert.equal(state.turn, 'you');
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 2), 69_999);
  assert.notEqual(state.phase, 'results');
  state = applyAction(state, 'you', { type: 'finish-time' }, anyRng, 70_000);
  assert.equal(state.phase, 'results');
  assert.deepEqual(state.winners, ['you']);
});

test('timed matches reject early finishes and rank surviving net worth at the deadline', () => {
  const state = newMatch(PLAYERS, 7, { bankruptcy: false, timeLimitMs: 60_000, now: 10_000 });
  state.owners['39'] = 'ada';
  assert.throws(() => applyAction(state, 'you', { type: 'finish-time' }, anyRng, 69_999), /still time/);
  const result = applyAction(state, 'you', { type: 'finish-time' }, anyRng, 70_000);
  assert.equal(result.phase, 'results');
  assert.deepEqual(result.winners, ['ada']);
  assert.notEqual(state.phase, 'results');
  assert.equal(state.endsAt, 70_000);
});

test('time limits share victory for tied net worth and expire before processing another move', () => {
  const state = newMatch(PLAYERS, 7, { timeLimitMs: 60_000 });
  const result = applyAction(state, state.turn, { type: 'roll' }, dice(6, 6), 60_000);
  assert.equal(result.phase, 'results');
  assert.deepEqual([...result.winners].sort(), [...PLAYERS].sort());
  assert.equal(result.lastRoll, null);
});

test('combined conditions finish on bankruptcy or wealth before the clock expires', () => {
  const bankruptcy = newMatch(['you', 'ada'], 7, { target: 5000, timeLimitMs: 60_000 });
  assert.equal(removePlayer(bankruptcy, 'ada').phase, 'results');
  const wealth = newMatch(PLAYERS, 7, { bankruptcy: false, target: 1600, timeLimitMs: 60_000 });
  wealth.turn = 'you';
  playerOf(wealth, 'you').cash = 1700;
  const result = applyAction(wealth, 'you', { type: 'roll' }, dice(1, 2), 1000);
  assert.equal(result.phase, 'results');
  assert.deepEqual(result.winners, ['you']);
});

test('end conditions require a valid target, duration, and at least one enabled rule', () => {
  assert.throws(() => newMatch(PLAYERS, 7, { bankruptcy: false }), /at least one/);
  assert.throws(() => newMatch(PLAYERS, 7, { target: 1500 }), /greater than/);
  assert.throws(() => newMatch(PLAYERS, 7, { target: Number.NaN }), /greater than/);
  assert.throws(() => newMatch(PLAYERS, 7, { timeLimitMs: 1 }), /at least one minute/);
});

test('party rules are chosen by the first player and the server controls the match clock', () => {
  const context = { playerIds: PLAYERS, playerId: 'you', seed: 7, now: 10_000, mode: { id: 'classic', label: 'Classic board', minPlayers: 2, maxPlayers: 8, preset: 'turn-based' as const } };
  const initial = monopolyMultiplayer.setup(context);
  const game = (initial.state as unknown as MpState).game;
  assert.equal(game.phase, 'setup');
  assert.throws(() => monopolyMultiplayer.action(initial.state, 'roll', null, context), /end conditions first/);
  const conditions = { bankruptcy: false, target: null, timeLimitMs: 60_000 };
  const other = PLAYERS.find(id => id !== game.turn)!;
  assert.throws(() => monopolyMultiplayer.action(initial.state, 'configure', conditions, { ...context, playerId: other }), /turn/);
  const started = monopolyMultiplayer.action(initial.state, 'configure', conditions, { ...context, playerId: game.turn, now: 25_000 });
  assert.equal((started.state as unknown as MpState).game.endsAt, 85_000);
  assert.throws(() => monopolyMultiplayer.action(started.state, 'configure', conditions, { ...context, playerId: game.turn }), /not available/);
  assert.throws(() => monopolyMultiplayer.action(started.state, 'finish-time', null, { ...context, now: 84_999 }), /still time/);
  const ended = monopolyMultiplayer.action(started.state, 'finish-time', null, { ...context, now: 85_000 });
  assert.equal(ended.finished, true);
  assert.equal(ended.phase, 'results');
});

test('doubles grant a bonus roll and three doubles go to Jail', () => {
  let state = fresh();
  state = applyAction(state, 'you', { type: 'roll' }, dice(2, 2));
  assert.equal(playerOf(state, 'you').position, 4);
  assert.equal(playerOf(state, 'you').cash, 1300);
  assert.equal(state.phase, 'preroll');
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 3));
  assert.equal(state.phase, 'buy-decision');
  state = applyAction(state, 'you', { type: 'buy' }, anyRng);
  assert.equal(state.phase, 'postroll');

  state = fresh();
  state = applyAction(state, 'you', { type: 'roll' }, dice(3, 3));
  assert.equal(state.phase, 'buy-decision');
  state = applyAction(state, 'you', { type: 'buy' }, anyRng);
  assert.equal(state.turn, 'you');
  assert.equal(state.phase, 'preroll');
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 2));
  assert.equal(playerOf(state, 'you').position, 9);

  state = fresh();
  state.chanceDeck = [5, ...state.chanceDeck.filter(id => id !== 5)];
  playerOf(state, 'you').position = 34;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1550);
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(playerOf(state, 'you').cash, 1450);
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

  for (const cardId of [4, 15]) {
    state = fresh();
    state.chanceDeck = [cardId, ...state.chanceDeck.filter(id => id !== cardId)];
    state.owners['15'] = 'ada';
    playerOf(state, 'you').position = 5;
    state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
    assert.equal(playerOf(state, 'you').position, 15);
    assert.equal(playerOf(state, 'you').cash, 1500 - 50);
    assert.equal(playerOf(state, 'ada').cash, 1550);
    assert.equal(state.phase, 'preroll');
    assert.equal(state.doubles, 1);
  }
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

test('bots drive a wealth-target match to a result', () => {
  let state = newMatch(PLAYERS, 123, { target: 5000 });
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

test('a non-double after doubles ends the bonus rolls after resolving the space', () => {
  let state = fresh();
  state = applyAction(state, 'you', { type: 'roll' }, dice(2, 2));
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 3));
  state = applyAction(state, 'you', { type: 'buy' }, anyRng);
  assert.equal(state.phase, 'postroll');
  assert.equal(state.doubles, 0);
  assert.throws(() => applyAction(state, 'you', { type: 'roll' }, anyRng), /not available/);
});

test('trade acceptance rechecks available cash and developed properties', () => {
  let state = fresh();
  for (const id of [1, 3]) state.owners[String(id)] = 'you';
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 1500, properties: [], wantCash: 0, wantProperties: [] }, anyRng);
  state = applyAction(state, 'you', { type: 'build', space: 1 }, anyRng);
  assert.throws(() => applyAction(state, 'ada', { type: 'accept-trade' }, anyRng), /cover the trade/);
  state = applyAction(state, 'you', { type: 'reject-trade' }, anyRng);
  state = applyAction(state, 'you', { type: 'sell', space: 1 }, anyRng);
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 0, properties: [1], wantCash: 0, wantProperties: [] }, anyRng);
  state = applyAction(state, 'you', { type: 'build', space: 3 }, anyRng);
  assert.throws(() => applyAction(state, 'ada', { type: 'accept-trade' }, anyRng), /no longer available/);
  assert.equal(state.owners['1'], 'you');
});

test('birthday payments require each debtor to raise the full amount before continuing', () => {
  let state = fresh();
  state.order = [...PLAYERS];
  state.chestDeck = [24];
  state.players.ada!.cash = 3;
  state.players.rex!.cash = 2;
  state.owners['1'] = 'ada';
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  assert.equal(state.phase, 'debt');
  assert.equal(actorFor(state), 'ada');
  assert.equal(state.debt!.amount, 10);
  assert.equal(state.players.you!.cash, 1500);
  assert.throws(() => applyAction(state, 'you', { type: 'pay-debt' }, anyRng), /not your turn/);
  state = applyAction(state, 'ada', { type: 'mortgage', space: 1 }, anyRng);
  state = applyAction(state, 'ada', { type: 'pay-debt' }, anyRng);
  assert.equal(state.players.ada!.cash, 23);
  assert.equal(actorFor(state), 'rex');
  state = applyAction(state, 'rex', { type: 'declare-bankrupt' }, anyRng);
  assert.equal(state.players.you!.cash, 1512);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.turn, 'you');
  assert.equal(state.collection, null);
});

test('hotels return their four houses and cannot be downgraded without bank stock', () => {
  let state = fresh();
  for (const id of [1, 3]) {
    state.owners[String(id)] = 'you';
    state.houses[String(id)] = 4;
  }
  for (const id of [6, 8, 9, 11, 13, 14]) state.houses[String(id)] = 4;
  assert.equal(housesInPlay(state), 32);
  state = applyAction(state, 'you', { type: 'build', space: 1 }, anyRng);
  assert.equal(housesInPlay(state), 28);
  state.owners['16'] = state.owners['18'] = state.owners['19'] = 'ada';
  state = applyAction(state, 'ada', { type: 'build', space: 16 }, anyRng);
  assert.equal(housesInPlay(state), 29);
  assert.throws(() => applyAction(state, 'you', { type: 'sell', space: 1 }, anyRng), /four houses/);
  const cash = state.players.you!.cash;
  state = applyAction(state, 'you', { type: 'sell', space: 1, all: true }, anyRng);
  assert.equal(state.houses['1'], 0);
  assert.equal(state.houses['3'], 0);
  assert.equal(state.players.you!.cash, cash + 225);
});

test('the thirteenth hotel cannot be built', () => {
  const state = fresh();
  for (const id of [1, 3]) {
    state.owners[String(id)] = 'you';
    state.houses[String(id)] = 4;
  }
  for (const id of [6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24]) state.houses[String(id)] = 5;
  assert.throws(() => applyAction(state, 'you', { type: 'build', space: 1 }, anyRng), /no hotels/);
});

test('bankruptcy transfers jail cards to the player creditor', () => {
  let state = fresh();
  state.players.you!.heldCards = [6, 20];
  state.chanceDeck = state.chanceDeck.filter(id => id !== 6);
  state.chestDeck = state.chestDeck.filter(id => id !== 20);
  state.players.you!.position = 37;
  state.players.you!.cash = 0;
  state.owners['39'] = 'ada';
  state.houses['39'] = 5;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 1));
  state = applyAction(state, 'you', { type: 'declare-bankrupt' }, anyRng);
  assert.deepEqual(state.players.ada!.heldCards, [6, 20]);
  assert.deepEqual(state.players.you!.heldCards, []);
  assert.ok(!state.chanceDeck.includes(6));
  assert.ok(!state.chestDeck.includes(20));
});

test('bankruptcy to the bank auctions every deed before the next player rolls', () => {
  let state = fresh();
  state.order = [...PLAYERS];
  state.owners['1'] = state.owners['3'] = 'you';
  state.mortgages['1'] = true;
  state.players.you!.cash = 0;
  state.players.you!.position = 1;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 2));
  state = applyAction(state, 'you', { type: 'declare-bankrupt' }, anyRng);
  assert.equal(state.phase, 'auction');
  assert.equal(state.auction!.space, 1);
  assert.equal(state.mortgages['1'], false);
  state = applyAction(state, state.auction!.turn, { type: 'bid', amount: 10 }, anyRng);
  const winner = state.auction!.highBidder;
  while (state.auction?.space === 1) state = applyAction(state, state.auction.turn, { type: 'pass-bid' }, anyRng);
  assert.equal(state.owners['1'], winner);
  assert.equal(state.auction!.space, 3);
  while (state.auction) state = applyAction(state, state.auction.turn, { type: 'pass-bid' }, anyRng);
  assert.equal(state.owners['3'], null);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.turn, 'ada');
});

test('players can develop outside their turn and trade to raise cash during debt', () => {
  let state = fresh();
  state.owners['1'] = state.owners['3'] = 'ada';
  state = applyAction(state, 'ada', { type: 'build', space: 1 }, anyRng);
  assert.equal(state.turn, 'you');
  assert.equal(state.houses['1'], 1);
  state.owners['6'] = 'you';
  state.players.you!.position = 1;
  state.players.you!.cash = 0;
  state = applyAction(state, 'you', { type: 'roll' }, dice(1, 2));
  state = applyAction(state, 'you', { type: 'propose-trade', to: 'ada', cash: 0, properties: [6], wantCash: 200, wantProperties: [] }, anyRng);
  state = applyAction(state, 'ada', { type: 'accept-trade' }, anyRng);
  assert.equal(state.phase, 'debt');
  state = applyAction(state, 'you', { type: 'pay-debt' }, anyRng);
  assert.equal(state.phase, 'postroll');
  assert.equal(state.players.you!.cash, 0);
});

test('settling a forced jail fine resolves the pending landing and its rent debt', () => {
  let state = fresh();
  state.players.you!.position = 10;
  state.players.you!.inJail = true;
  state.players.you!.jailTurns = 2;
  state.players.you!.cash = 0;
  state.owners['1'] = state.owners['3'] = 'you';
  state.owners['15'] = 'ada';
  state = applyAction(state, 'you', { type: 'jail-roll' }, dice(1, 4));
  for (const id of [1, 3]) state = applyAction(state, 'you', { type: 'mortgage', space: id }, anyRng);
  state = applyAction(state, 'you', { type: 'pay-debt' }, dice(1, 2));
  assert.equal(state.players.you!.position, 15);
  assert.equal(state.phase, 'debt');
  assert.equal(state.debt!.amount, 25);
  assert.equal(state.debt!.creditor, 'ada');
});

test('a bankrupt middle player passes the turn to the next surviving seat', () => {
  let state = fresh();
  state.order = [...PLAYERS];
  state.turn = 'ada';
  state.owners['1'] = 'ada';
  state = removePlayer(state, 'ada');
  assert.equal(state.turn, 'rex');
  assert.equal(state.phase, 'auction');
  while (state.auction) state = applyAction(state, state.auction.turn, { type: 'pass-bid' }, anyRng);
  assert.equal(state.phase, 'preroll');
  assert.equal(state.turn, 'rex');
});
