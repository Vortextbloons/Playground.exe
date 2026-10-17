import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, DECK_SIZE, cardFromId, cardLabel, type Color } from '../games/uno/src/rules/cards.ts';
import { mulberry32, type Rng } from '../games/uno/src/rules/rng.ts';
import {
  applyAction, canPlayCard, dealRound, DEFAULT_MATCH_TARGET, handOf, handPoints, newMatch, nextRound,
  playableCards, removePlayerFromMatch, toView, type UnoState,
} from '../games/uno/src/rules/engine.ts';
import { botMove } from '../games/uno/src/bots/bots.ts';

const rngFrom = (seed: number): Rng => mulberry32(seed);
const PLAYERS = ['you', 'ada', 'rex', 'mia'];

/** Card ids are stable: color block × 25, then a fixed slot layout. */
const num = (color: Color, value: number, copy = 1): number => COLORS.indexOf(color) * 25 + (value === 0 ? 0 : (value - 1) * 2 + copy);
const action = (color: Color, kind: 'skip' | 'reverse' | 'draw-two', copy = 1): number => COLORS.indexOf(color) * 25 + (kind === 'skip' ? 18 + copy : kind === 'reverse' ? 20 + copy : 22 + copy);
const wild = (copy = 1): number => 99 + copy;
const wildFour = (copy = 1): number => 103 + copy;

/** Finds a deal whose flipped starting card has the wanted kind, starting at players[0]. */
function dealWith(kind: string, players: readonly string[] = PLAYERS): UnoState {
  for (let seed = 1; seed < 4000; seed++) {
    const state = dealRound(players, {}, 0, 0, players[0]!, rngFrom(seed));
    if (kindOf(state.discardPile[0]!) === kind) return state;
  }
  throw new Error(`no seed produced a ${kind} flip`);
}

const kindOf = (id: number) => cardFromId(id).kind;

/** Overwrites hands with exact cards, swapping those ids out of every other hand and the draw pile. */
function withHands(state: UnoState, hands: Record<string, number[]>): UnoState {
  const next = structuredClone(state);
  for (const id of new Set(Object.values(hands).flat())) {
    for (const player of next.players) {
      const hand = next.hands[player] ?? [];
      const at = hand.indexOf(id);
      if (at !== -1) hand.splice(at, 1);
    }
    const inPile = next.drawPile.indexOf(id);
    if (inPile !== -1) next.drawPile.splice(inPile, 1);
  }
  for (const [player, hand] of Object.entries(hands)) next.hands[player] = [...hand];
  return next;
}

/** A quiet state where `you` leads with one card on a red n discard. */
function riggedMatch(hands: Record<string, number[]>, overrides: Partial<UnoState> = {}): UnoState {
  const state = dealRound(PLAYERS, {}, 0, 0, 'you', rngFrom(977));
  const next = withHands({ ...state, direction: 1, ...overrides }, { ada: handOf(state, 'ada'), rex: handOf(state, 'rex'), mia: handOf(state, 'mia'), ...hands });
  return next;
}

const cardTotal = (state: UnoState): number =>
  state.drawPile.length + state.discardPile.length + Object.values(state.hands).reduce((sum, hand) => sum + hand.length, 0);

// ------------------------------------------------------------------ the deck

test('the deck is a classic 108-card UNO deck', () => {
  const ids = Array.from({ length: DECK_SIZE }, (_, id) => id);
  const cards = ids.map(cardFromId);
  assert.equal(cards.length, 108);
  for (const color of COLORS) {
    const inColor = cards.filter(card => card.color === color);
    assert.equal(inColor.length, 25, `${color} block`);
    for (let value = 0; value <= 9; value++) {
      const expected = value === 0 ? 1 : 2;
      assert.equal(inColor.filter(card => card.kind === 'number' && card.value === value).length, expected, `${color} ${value}`);
    }
    for (const kind of ['skip', 'reverse', 'draw-two']) {
      assert.equal(inColor.filter(card => card.kind === kind).length, 2, `${color} ${kind}`);
    }
  }
  assert.equal(cards.filter(card => card.kind === 'wild').length, 4);
  assert.equal(cards.filter(card => card.kind === 'wild-four').length, 4);
  assert.equal(new Set(ids).size, 108, 'ids are unique');
  for (const card of cards) {
    const points = card.kind === 'number' ? card.value : card.kind === 'wild' || card.kind === 'wild-four' ? 50 : 20;
    assert.equal(card.value, points, `${cardLabel(card)} scoring value`);
  }
});

// --------------------------------------------------------------------- setup

test('a new match deals seven cards each and flips a usable starter', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const state = newMatch(PLAYERS, {}, rngFrom(seed));
    assert.equal(state.round, 0);
    assert.ok(['playing', 'color'].includes(state.phase), `seed ${seed} phase`);
    const flipDrawsTwo = kindOf(state.discardPile[0]!) === 'draw-two';
    assert.ok(PLAYERS.every(player => handOf(state, player).length === 7 || (flipDrawsTwo && handOf(state, player).length === 9)), `seed ${seed} hands`);
    assert.equal(cardTotal(state), 108);
    assert.ok(kindOf(state.discardPile[0]!) !== 'wild-four', 'a wild four never starts the discard');
    assert.equal(state.winner, null);
    assert.equal(state.matchWinner, null);
  }
});

test('special starting discards apply their effect to the first player', () => {
  const skip = dealWith('skip');
  assert.notEqual(skip.turn, skip.players[0], 'the first player is skipped');

  const drawTwo = dealWith('draw-two');
  assert.equal(handOf(drawTwo, drawTwo.players[0]!).length, 9, 'the first player draws two');
  assert.notEqual(drawTwo.turn, drawTwo.players[0], 'the first player is skipped');

  const reverse = dealWith('reverse');
  assert.equal(reverse.direction, -1, 'play proceeds the other way');

  const reverseTwo = dealWith('reverse', ['you', 'ada']);
  assert.equal(reverseTwo.direction, -1);
  assert.notEqual(reverseTwo.turn, reverseTwo.players[0], 'acts as a skip with two players');

  const wildStart = dealWith('wild');
  assert.equal(wildStart.phase, 'color', 'the starting player chooses the color');
  assert.equal(wildStart.turn, wildStart.players[0]);
  const chosen = applyAction(wildStart, wildStart.turn, { type: 'choose-color', color: 'green' }, rngFrom(2));
  assert.equal(chosen.activeColor, 'green');
  assert.equal(chosen.phase, 'playing');
  assert.throws(() => applyAction(wildStart, 'ada', { type: 'choose-color', color: 'green' }, rngFrom(2)), /Not your turn/);
  assert.throws(() => applyAction(wildStart, wildStart.turn, { type: 'choose-color', color: 'purple' as Color }, rngFrom(2)), /real color/);
});

// -------------------------------------------------------------- basic play

test('only matching cards may be played and turns rotate clockwise', () => {
  const state = riggedMatch({ you: [num('blue', 7, 1), num('red', 7, 1), num('green', 5, 1)] }, { activeColor: 'blue', turn: 'you' });
  state.discardPile = [num('blue', 2, 1)];
  assert.equal(canPlayCard(state, num('blue', 8, 1)), true, 'same color matches');
  assert.equal(canPlayCard(state, action('blue', 'skip')), true, 'same color action matches');
  assert.equal(canPlayCard(state, num('red', 2, 2)), true, 'same number matches');
  assert.equal(canPlayCard(state, num('green', 5, 1)), false, 'no color or value match');
  assert.equal(canPlayCard(state, wild()), true, 'wilds always fit');

  assert.throws(() => applyAction(state, 'ada', { type: 'play-card', card: num('blue', 7, 1) }, rngFrom(4)), /Not your turn/);
  assert.throws(() => applyAction(state, 'you', { type: 'play-card', card: num('blue', 8, 2) }, rngFrom(4)), /do not have that card/);
  assert.throws(() => applyAction(state, 'you', { type: 'play-card', card: num('green', 5, 1) }, rngFrom(4)), /does not match/);

  const played = applyAction(state, 'you', { type: 'play-card', card: num('blue', 7, 1) }, rngFrom(4));
  assert.equal(handOf(played, 'you').length, 2);
  assert.equal(played.turn, 'ada', 'clockwise to the next player');
  assert.equal(played.discardPile.length, 2);
  assert.equal(played.activeColor, 'blue');
});

test('skip and reverse steer the turn order', () => {
  const state = riggedMatch({ you: [action('blue', 'skip', 1), num('blue', 3, 1)] }, { turn: 'you', activeColor: 'blue' });
  state.discardPile = [num('blue', 1, 1)];
  const skipped = applyAction(state, 'you', { type: 'play-card', card: action('blue', 'skip', 1) }, rngFrom(6));
  assert.equal(skipped.turn, 'rex', 'ada was skipped');
  assert.equal(handOf(skipped, 'ada').length, 7, 'nobody drew');

  const duo = dealRound(['you', 'ada'], {}, 0, 0, 'you', rngFrom(7));
  const twoSkip = withHands({ ...duo, turn: 'you', activeColor: 'red' }, { you: [action('red', 'skip', 1)], ada: handOf(duo, 'ada') });
  twoSkip.discardPile = [num('red', 1, 1)];
  const skipTwo = applyAction(twoSkip, 'you', { type: 'play-card', card: action('red', 'skip', 1) }, rngFrom(8));
  assert.equal(skipTwo.turn, 'you', 'a skip in a duel returns the turn');

  const rev = riggedMatch({ you: [action('green', 'reverse', 1), num('green', 7, 1)], mia: [num('green', 6, 1), num('green', 8, 1)] }, { turn: 'you', activeColor: 'green' });
  rev.discardPile = [num('green', 1, 1)];
  const reversed = applyAction(rev, 'you', { type: 'play-card', card: action('green', 'reverse', 1) }, rngFrom(9));
  assert.equal(reversed.direction, -1);
  assert.equal(reversed.turn, 'mia', 'counter-clockwise now');
  const back = applyAction(reversed, 'mia', { type: 'play-card', card: num('green', 6, 1) }, rngFrom(10));
  assert.equal(back.turn, 'rex', 'the reversed direction holds');
});

// ----------------------------------------------------------------- wild four

test('wild draw four: accepting draws four and skips the challenged player', () => {
  const state = riggedMatch({ you: [wildFour(1), num('red', 4, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];
  const played = applyAction(state, 'you', { type: 'play-card', card: wildFour(1), color: 'green' }, rngFrom(14));
  assert.equal(played.phase, 'wild-four');
  assert.equal(played.turn, 'you', 'the turn waits on the challenge');
  assert.equal(played.wildFour?.target, 'ada');
  assert.equal(played.activeColor, 'green');

  assert.throws(() => applyAction(played, 'you', { type: 'accept-draw-four' }, rngFrom(15)), /Only the challenged player/);
  const accepted = applyAction(played, 'ada', { type: 'accept-draw-four' }, rngFrom(15));
  assert.equal(handOf(accepted, 'ada').length, 11, 'ada drew four');
  assert.equal(accepted.turn, 'rex', 'ada was skipped');
  assert.equal(accepted.phase, 'playing');
  assert.equal(accepted.wildFour, null);
});

test('wild draw four: a losing challenge costs six cards', () => {
  // You hold no red, so the wild four on red is legal — the challenge must fail.
  const state = riggedMatch({ you: [wildFour(2), num('blue', 3, 1)] }, { turn: 'you', activeColor: 'green' });
  state.discardPile = [num('green', 1, 1)];
  const played = applyAction(state, 'you', { type: 'play-card', card: wildFour(2), color: 'red' }, rngFrom(17));
  const challenged = applyAction(played, 'ada', { type: 'challenge-draw-four' }, rngFrom(18));
  assert.equal(handOf(challenged, 'ada').length, 13, 'ada drew six');
  assert.equal(challenged.turn, 'rex', 'ada also lost her turn');
});

test('wild draw four: a winning challenge punishes the bluffer', () => {
  // You hold a green card, so the wild four was illegal and Ada's challenge succeeds.
  const state = riggedMatch({ you: [wildFour(3), num('green', 3, 1)] }, { turn: 'you', activeColor: 'green' });
  state.discardPile = [num('green', 1, 1)];
  const played = applyAction(state, 'you', { type: 'play-card', card: wildFour(3), color: 'red' }, rngFrom(20));
  const challenged = applyAction(played, 'ada', { type: 'challenge-draw-four' }, rngFrom(21));
  assert.equal(handOf(challenged, 'you').length, 5, 'you drew four');
  assert.equal(challenged.turn, 'ada', "it is the challenger's turn");
  assert.equal(challenged.phase, 'playing');
});

test('wilds demand a color', () => {
  const state = riggedMatch({ you: [wild()] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];
  assert.throws(() => applyAction(state, 'you', { type: 'play-card', card: wild() }, rngFrom(22)), /Wilds need a color/);
  const played = applyAction(state, 'you', { type: 'play-card', card: wild(), color: 'yellow' }, rngFrom(22));
  assert.equal(played.activeColor, 'yellow');
});

// ------------------------------------------------------------------ drawing

test('drawing a playable card lets you play it or pass; a dud ends the turn', () => {
  const state = riggedMatch({ you: [num('red', 2, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];
  const red9 = num('red', 9, 1);
  const blue5 = num('blue', 5, 1);
  state.drawPile = state.drawPile.filter(id => id !== red9 && id !== blue5);

  // A playable draw parks the turn on you.
  const drawn = applyAction({ ...state, drawPile: [...state.drawPile, red9] }, 'you', { type: 'draw-card' }, rngFrom(23));
  assert.equal(drawn.drawnCard, red9, 'the drawn card stays playable');
  assert.equal(drawn.turn, 'you');
  assert.throws(() => applyAction(drawn, 'you', { type: 'play-card', card: num('red', 2, 1) }, rngFrom(24)), /Play the card you drew/);
  const played = applyAction(drawn, 'you', { type: 'play-card', card: red9 }, rngFrom(24));
  assert.equal(played.turn, 'ada');
  assert.equal(played.drawnCard, null);
  assert.equal(handOf(played, 'you').length, 1);

  const passed = applyAction(drawn, 'you', { type: 'pass-turn' }, rngFrom(24));
  assert.equal(passed.turn, 'ada');
  assert.equal(passed.drawnCard, null);

  // A useless draw auto-advances.
  const dud = applyAction({ ...state, drawPile: [...state.drawPile, blue5] }, 'you', { type: 'draw-card' }, rngFrom(25));
  assert.equal(dud.drawnCard, null);
  assert.equal(dud.turn, 'ada');
  assert.equal(handOf(dud, 'you').length, 2);

  assert.throws(() => applyAction(state, 'you', { type: 'pass-turn' }, rngFrom(26)), /Draw a card before passing/);
});

test('an empty draw pile reshuffles the discard minus the top card', () => {
  const state = riggedMatch({ you: [num('red', 2, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('blue', 1, 1), num('green', 1, 1), num('red', 1, 2)];
  state.drawPile = [];
  const before = cardTotal(state);

  const drawn = applyAction(state, 'you', { type: 'draw-card' }, rngFrom(28));
  assert.equal(drawn.drawPile.length, 1, 'the two discard under-cards became the new pile');
  assert.equal(drawn.discardPile.length, 1, 'only the top card remains');
  assert.equal(drawn.discardPile[0], num('red', 1, 2), 'the top card survives');
  assert.equal(cardTotal(drawn), before, 'no card is ever lost');
  assert.equal(drawn.turn, 'you', 'the drawn card is playable, so the turn holds');
  assert.equal(drawn.drawnCard !== null, true, 'either leftover matches the red top');
});

// ------------------------------------------------------------ stacked twos

test('draw twos stack: the threat passes along and the victim stacks or takes it', () => {
  const state = riggedMatch(
    { you: [action('red', 'draw-two', 1), num('red', 5, 1)], ada: [action('red', 'draw-two', 2), num('blue', 4, 1)] },
    { turn: 'you', activeColor: 'red' },
  );
  state.discardPile = [num('red', 1, 1)];

  const played = applyAction(state, 'you', { type: 'play-card', card: action('red', 'draw-two', 1) }, rngFrom(57));
  assert.equal(played.stackedDraw, 2, 'nobody draws until the threat resolves');
  assert.equal(played.turn, 'ada', 'the threat waits on the next player');
  assert.equal(handOf(played, 'ada').length, 2, 'ada has not drawn');

  assert.equal(canPlayCard(played, action('red', 'draw-two', 2)), true, 'a matching draw two stacks');
  assert.equal(canPlayCard(played, action('blue', 'draw-two', 1)), false, 'the draw two must match the active color');
  assert.equal(canPlayCard(played, num('blue', 4, 1)), false, 'nothing else is playable while stacked');
  assert.equal(canPlayCard(played, wildFour(1)), false, 'wild fours do not stack draw twos');
  assert.throws(() => applyAction(played, 'ada', { type: 'pass-turn' }, rngFrom(58)), /Draw a card before passing/);

  const stacked = applyAction(played, 'ada', { type: 'play-card', card: action('red', 'draw-two', 2) }, rngFrom(58));
  assert.equal(stacked.stackedDraw, 4, 'stacks accumulate');
  assert.equal(stacked.turn, 'rex');

  const taken = applyAction(stacked, 'rex', { type: 'draw-card' }, rngFrom(59));
  assert.equal(handOf(taken, 'rex').length, 11, 'rex took the whole stack');
  assert.equal(taken.stackedDraw, 0, 'the stack is settled');
  assert.equal(taken.turn, 'mia', 'taking ends the turn');
});

test('a stacked player without a matching draw two must take the accumulated cards', () => {
  const state = riggedMatch(
    { you: [action('green', 'draw-two', 1), num('green', 5, 1)], ada: [num('green', 6, 1), num('blue', 2, 1)] },
    { turn: 'you', activeColor: 'green' },
  );
  state.discardPile = [num('green', 1, 1)];

  const played = applyAction(state, 'you', { type: 'play-card', card: action('green', 'draw-two', 1) }, rngFrom(60));
  assert.throws(() => applyAction(played, 'ada', { type: 'play-card', card: num('green', 6, 1) }, rngFrom(61)), /does not match/);
  const taken = applyAction(played, 'ada', { type: 'draw-card' }, rngFrom(61));
  assert.equal(handOf(taken, 'ada').length, 4, 'ada drew the two');
  assert.equal(taken.stackedDraw, 0);
  assert.equal(taken.turn, 'rex');
});

// ----------------------------------------------------------------- uno calls

test('missed UNO calls can be caught for a two-card penalty, and calling first is safe', () => {
  const state = riggedMatch({ you: [num('red', 2, 1), num('red', 3, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];

  const silent = applyAction(state, 'you', { type: 'play-card', card: num('red', 3, 1) }, rngFrom(30));
  assert.equal(silent.missedUno, 'you', 'the call was missed');
  assert.equal(handOf(silent, 'you').length, 1);
  assert.throws(() => applyAction(silent, 'you', { type: 'catch-uno', target: 'you' }, rngFrom(31)), /yourself/);
  const caught = applyAction(silent, 'ada', { type: 'catch-uno', target: 'you' }, rngFrom(31));
  assert.equal(handOf(caught, 'you').length, 3, 'two-card penalty');
  assert.equal(caught.missedUno, null);

  const safe = applyAction(state, 'you', { type: 'play-card', card: num('red', 3, 1), callUno: true }, rngFrom(32));
  assert.deepEqual(safe.calledUno, ['you']);
  assert.equal(safe.missedUno, null);
  assert.throws(() => applyAction(safe, 'ada', { type: 'catch-uno', target: 'you' }, rngFrom(33)), /miss/);

  // Calling within the window clears the risk; once the next player acts it is too late.
  const lateCall = applyAction(silent, 'you', { type: 'call-uno' }, rngFrom(34));
  assert.deepEqual(lateCall.calledUno, ['you']);
  assert.equal(lateCall.missedUno, null);
  const closed = applyAction(silent, 'ada', { type: 'draw-card' }, rngFrom(35));
  assert.equal(closed.missedUno, null, 'the window shuts once the next turn starts');
  assert.throws(() => applyAction(closed, 'rex', { type: 'catch-uno', target: 'you' }, rngFrom(36)), /miss/);
});

// ------------------------------------------------------------------ winning

test('emptying a hand wins the round and banks the other hands as points', () => {
  const state = riggedMatch({ you: [num('red', 7, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];
  state.matchTarget = DEFAULT_MATCH_TARGET;
  const ada = handOf(state, 'ada');
  const rex = handOf(state, 'rex');
  const mia = handOf(state, 'mia');
  const pot = handPoints(ada) + handPoints(rex) + handPoints(mia);

  const won = applyAction(state, 'you', { type: 'play-card', card: num('red', 7, 1) }, rngFrom(38));
  assert.equal(won.phase, 'results');
  assert.equal(won.winner, 'you');
  assert.equal(won.scores.you, pot);
  assert.deepEqual(won.lastGains, { ada: handPoints(ada), rex: handPoints(rex), mia: handPoints(mia) });
  assert.equal(won.matchWinner, null, 'one round is short of 500');
  assert.throws(() => applyAction(won, 'you', { type: 'play-card', card: 0 }, rngFrom(39)), /round is over/);

  const again = applyAction(won, 'rex', { type: 'next-round' }, rngFrom(40));
  assert.equal(again.round, 1);
  assert.equal(again.phase, 'playing');
  assert.equal(again.scores.you, pot, 'scores carry across rounds');
  assert.equal(again.winner, null);
  assert.equal(again.matchWinner, null);
  const flipDrawsTwo = kindOf(again.discardPile[0]!) === 'draw-two';
  assert.ok(PLAYERS.every(player => handOf(again, player).length === 7 || (flipDrawsTwo && handOf(again, player).length === 9)));
  assert.equal(again.turn !== again.winner, true, 'the player after the winner starts');
});

test('reaching the match target crowns a match winner', () => {
  const state = riggedMatch({ you: [num('red', 7, 1)] }, { turn: 'you', activeColor: 'red', matchTarget: 500 });
  state.discardPile = [num('red', 1, 1)];
  state.scores = { you: 495, ada: 0, rex: 0, mia: 0 };
  const won = applyAction(state, 'you', { type: 'play-card', card: num('red', 7, 1) }, rngFrom(42));
  assert.equal(won.matchWinner, 'you');
  assert.throws(() => applyAction(won, 'you', { type: 'next-round' }, rngFrom(43)), /match is over/);
});

// ------------------------------------------------------------- engine soaks

test('random bot games stay consistent and always finish', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = rngFrom(seed * 7);
    let state = newMatch(PLAYERS, { matchTarget: 0 }, rng);
    let guard = 0;
    while (state.phase !== 'results' && guard++ < 5000) {
      const actor = state.phase === 'wild-four'
        ? state.wildFour!.target
        : state.missedUno !== null && rng() < 0.15 ? state.missedUno : state.turn;
      const move = botMove(state, actor, seed % 2 ? 'easy' : 'normal', rng);
      state = applyAction(state, actor, move, rng);
      assert.equal(cardTotal(state), 108, `seed ${seed}: cards are conserved`);
    }
    assert.ok(guard <= 5000, `seed ${seed}: game terminated`);
    assert.equal(state.phase, 'results');
    if (state.players.length >= 2) {
      assert.ok(state.winner !== null, `seed ${seed}: a winner exists`);
      for (const player of state.players) {
        if (player === state.winner) continue;
        assert.ok(handOf(state, player).length > 0, `${player} kept cards`);
      }
    }
  }
});

test('views only ever expose the viewer hand and public counts', () => {
  const state = newMatch(PLAYERS, {}, rngFrom(44));
  const mine = toView(state, 'you');
  assert.deepEqual(Object.keys(mine.hands), ['you']);
  assert.equal(mine.hands.you!.length, 7);
  assert.deepEqual(Object.values(mine.counts), [7, 7, 7, 7]);
  assert.equal(mine.drawPile, state.drawPile.length);
  const spectator = toView(state, null);
  assert.deepEqual(spectator.hands, {});
  assert.equal(spectator.you, null);
  assert.equal(spectator.drawnCard, null);

  const drawn = applyAction({ ...structuredClone(state), turn: 'you' }, 'you', { type: 'draw-card' }, rngFrom(45));
  const viewer = toView(drawn, 'ada');
  assert.equal(viewer.drawnCard, null, 'the drawn card is private');
  const drawer = toView(drawn, 'you');
  assert.equal(drawer.drawnCard !== null || drawer.turn === 'ada', true);
});

// ------------------------------------------------------------ players leaving

test('removing a player advances the game safely', () => {
  const state = riggedMatch({}, { turn: 'rex' });
  const removed = removePlayerFromMatch(state, 'rex', rngFrom(47));
  assert.deepEqual(removed.players, ['you', 'ada', 'mia']);
  assert.equal(Object.keys(removed.hands).includes('rex'), false);
  assert.equal(removed.turn, 'mia', 'the next seat takes over');
  assert.equal(removePlayerFromMatch(removed, 'nobody', rngFrom(48)), removed, 'unknown players are a no-op');

  const duo = dealRound(['you', 'ada'], {}, 0, 0, 'you', rngFrom(49));
  const lone = removePlayerFromMatch(duo, 'ada', rngFrom(50));
  assert.equal(lone.phase, 'results', 'too few players end the match');
});

test('spectators and stale actors are rejected', () => {
  const state = riggedMatch({ you: [num('red', 4, 1)] }, { turn: 'you', activeColor: 'red' });
  state.discardPile = [num('red', 1, 1)];
  assert.throws(() => applyAction(state, 'ghost', { type: 'draw-card' }, rngFrom(52)), /Spectators cannot act/);
  assert.throws(() => applyAction(state, 'ada', { type: 'draw-card' }, rngFrom(53)), /Not your turn/);
  assert.throws(() => applyAction(state, 'you', { type: 'catch-uno', target: 'ada' }, rngFrom(54)), /Nobody missed/);
  assert.throws(() => applyAction(state, 'you', { type: 'play-card', card: num('blue', 4, 1) }, rngFrom(55)), /do not have that card/);
});

test('playableCards mirrors canPlayCard for the UI', () => {
  const state = newMatch(PLAYERS, {}, rngFrom(56));
  const hand = handOf(state, state.turn);
  const playable = playableCards(state, state.turn);
  assert.ok(hand.every(id => playable.includes(id) === canPlayCard(state, id)));
});
