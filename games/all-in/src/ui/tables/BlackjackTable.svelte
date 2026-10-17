<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView } from '../../core/types';
  import { cardRank, cardSuit, rankLabel, SUIT_LABELS } from '../../core/cards';
  import {
    handValue,
    type BlackjackHandStatus,
    type BlackjackPhase,
    type BlackjackView,
    type BlackjackViewHand,
    type BlackjackViewSeat,
  } from '../../games/blackjack';
  import { sound } from '../../sound';
  import Avatar from '../Avatar.svelte';

  let { detail, view, names, send }: {
    detail: Json;
    view: PlayerView;
    names: Record<string, string>;
    send: (action: string, payload: Json) => void;
  } = $props();

  const table = $derived(detail as unknown as BlackjackView | null);

  const CHIPS = [1, 5, 10, 25, 100];
  const SEAT_CENTERS = ['10%', '30%', '50%', '70%', '90%'];
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PHASE_LABELS: Record<BlackjackPhase, string> = {
    idle: 'Place your bet',
    betting: 'Betting open',
    playing: 'Cards in play',
    dealer: 'Dealer plays',
    results: 'Payouts',
  };

  const STATUS_LABELS: Record<BlackjackHandStatus, string> = {
    playing: 'in play',
    stood: 'stand',
    busted: 'bust',
    blackjack: 'blackjack',
    doubled: 'doubled',
  };

  type Tone = 'win' | 'lose' | 'push' | 'blackjack';

  type Coin = { x: string; y: string; r: string; d: string };

  type Burst = { id: number; x: string; y: string; tone: Tone; coins: Coin[]; phases: number };

  type Toss = { id: number; x: string; y: string; coins: Coin[] };

  const vault = $derived(view.vault);
  const bankroll = $derived(vault?.bankroll ?? 0);
  const ready = $derived(vault !== null && vault.status === 'active');
  const minBet = $derived(table?.min ?? 1);
  const maxBet = $derived(table?.max ?? 500);
  const mySeat = $derived(table !== null && view.you !== null ? table.seats.find(seat => seat.id === view.you) ?? null : null);
  const myHand = $derived(mySeat === null ? null : mySeat.hands.find(hand => hand.status === 'playing') ?? null);
  const myTurn = $derived(table !== null && view.you !== null && table.turn === view.you);
  const committed = $derived(table !== null && (table.phase === 'idle' || table.phase === 'betting') ? mySeat?.bet ?? 0 : 0);
  const hiddenHole = $derived(table?.phase === 'playing');
  const canBet = $derived(table !== null && ready && bankroll >= minBet && table.actions.includes('bet'));
  const canDouble = $derived(table !== null && myHand !== null && bankroll >= myHand.bet && table.actions.includes('double'));
  const canSplit = $derived(table !== null && myHand !== null && bankroll >= myHand.bet && table.actions.includes('split'));
  const staging = $derived(table !== null && canBet && committed === 0 && (table.phase === 'idle' || table.phase === 'betting'));
  const dealerTotal = $derived(table === null || table.dealer.cards.length === 0 ? '—' : String(table.dealer.value));
  const dealerBust = $derived(table !== null && table.dealer.value > 21);
  const smolder = $derived(!reduceMotion && dealerBust);
  const mySeatIndex = $derived(mySeat === null || table === null ? -1 : table.seats.indexOf(mySeat));

  const net = $derived.by(() => {
    if (table?.phase !== 'results' || mySeat === null) return 0;
    let value = 0;
    for (const hand of mySeat.hands) value += (hand.payout ?? 0) - hand.bet;
    return value;
  });

  const cardCount = $derived.by(() => {
    if (table === null) return 0;
    let count = table.dealer.cards.length;
    for (const seat of table.seats) for (const hand of seat.hands) count += hand.cards.length;
    return count;
  });

  const mineLost = $derived.by(() => {
    if (table?.phase !== 'results' || mySeat === null) return false;
    return mySeat.hands.some(hand => hand.outcome === 'lose');
  });

  let now = $state(Date.now());
  let arrivedAt = Date.now();
  let stamp = '';

  const deadline = $derived(table?.deadline ?? 0);
  const live = $derived(table !== null && deadline > 0 && (table.phase === 'betting' || table.phase === 'playing' || table.phase === 'results'));
  const windowMs = $derived(table !== null && live ? Math.max(1, deadline - view.now) : 1);
  const remaining = $derived(live ? Math.max(0, deadline - (view.now + (now - arrivedAt))) : 0);
  const fraction = $derived(Math.min(1, remaining / windowMs));
  const seconds = $derived(Math.ceil(remaining / 1000));

  let wager = $state(0);
  let flash = $state<Tone | null>(null);
  let toss = $state<Toss | null>(null);
  let bursts = $state<Burst[]>([]);

  let lastCards = 0;
  let lastPhase: BlackjackPhase | null = null;
  let lastWagerPhase: BlackjackPhase | null = null;
  let lastTicked = 0;
  let lastTickDeadline = 0;
  let lastCommit = 0;
  let lastBet = 0;
  let fxId = 0;
  let flashTimer: number | null = null;
  let tossTimer: number | null = null;
  let burstTimer: number | null = null;

  const timerLabel = $derived.by(() => {
    const current = table;
    if (current === null) return '';
    if (current.phase === 'results') return 'Next deal';
    if (current.phase === 'betting') return committed > 0 ? 'Bet locked in' : 'Betting closes';
    if (current.phase === 'playing') {
      if (current.turn === null) return 'Dealer';
      return current.turn === view.you ? 'Your move' : `${nameOf(current.turn)} to act`;
    }
    return PHASE_LABELS[current.phase];
  });

  const barStatus = $derived.by(() => {
    const current = table;
    if (current === null) return '';
    if (!ready) return 'You are watching this table.';
    if (committed > 0) return `${money(committed)} is on the felt.`;
    if (current.phase === 'results') return live && seconds > 0 ? `Next deal in ${seconds}s` : 'Waiting for the next deal.';
    if (current.phase === 'playing') return current.turn === null ? 'The dealer plays out the hand.' : `${nameOf(current.turn)} is deciding…`;
    if (bankroll < minBet) return 'Out of chips — take the bailout to keep playing.';
    if (current.phase === 'betting') return 'Betting is open.';
    return 'Waiting for a bet to open the round.';
  });

  $effect(() => {
    const mark = `${view.now}|${table?.phase ?? ''}|${table?.turn ?? ''}|${table?.deadline ?? 0}`;
    if (mark !== stamp) {
      stamp = mark;
      arrivedAt = Date.now();
      now = Date.now();
    }
    tickDue();
  });

  $effect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      now = Date.now();
      tickDue();
    }, 200);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (cardCount > lastCards) sound.play('card');
    lastCards = cardCount;
    const current = table;
    if (current === null) return;
    const phase = current.phase;

    if (phase === 'playing' && lastPhase === 'betting') {
      spawnToss(lastBet > 0 ? mySeatIndex : -1, lastBet > 0 ? chipCount(lastBet) : 3);
    }

    if (phase === 'results' && lastPhase === 'playing') {
      if (net > 0) sound.play('win');
      else if (net < 0) sound.play('lose');
      spawnBursts(mySeat?.hands ?? [], mySeatIndex);
      const hands = mySeat?.hands ?? [];
      const blackjack = hands.some(hand => hand.status === 'blackjack' && hand.outcome === 'win');
      if (blackjack) setFlash('blackjack');
      else if (net > 0) setFlash('win');
    }

    if ((phase === 'betting' || phase === 'idle') && committed > 0) lastBet = committed;
    if (committed > lastCommit && committed > 0) spawnToss(mySeatIndex, chipCount(committed));
    lastCommit = committed;

    lastPhase = phase;
  });

  $effect(() => {
    const phase = table?.phase ?? null;
    if (phase === lastWagerPhase) return;
    lastWagerPhase = phase;
    if (phase !== 'idle' && phase !== 'betting') wager = 0;
  });

  $effect(() => () => {
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    if (tossTimer !== null) window.clearTimeout(tossTimer);
    if (burstTimer !== null) window.clearTimeout(burstTimer);
  });

  function tickDue(): void {
    const current = table;
    if (current === null) return;
    if (current.deadline !== lastTickDeadline) {
      lastTickDeadline = current.deadline;
      lastTicked = 0;
    }
    if (current.deadline <= 0 || current.deadline === lastTicked) return;
    if (view.phase !== 'playing') return;
    if (current.deadline - (view.now + (Date.now() - arrivedAt)) > 0) return;
    lastTicked = current.deadline;
    send('tick', null);
  }

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function signed(value: number): string {
    if (value === 0) return money(0);
    return `${value < 0 ? '−' : '+'}${money(value)}`;
  }

  function nameOf(id: string | null): string {
    return id === null ? 'Open seat' : names[id] ?? 'Player';
  }

  function suitText(card: number): string {
    return SUIT_LABELS[cardSuit(card)] ?? '♠';
  }

  function delay(index: number): string {
    return reduceMotion ? '0ms' : `${index * 70}ms`;
  }

  function has(name: string): boolean {
    return table?.actions.includes(name) ?? false;
  }

  function outcomeText(hand: BlackjackViewHand): string {
    if (hand.outcome === 'push') return 'Push';
    return signed((hand.payout ?? 0) - hand.bet);
  }

  function canPlace(chip: number): boolean {
    return wager + chip <= maxBet && wager + chip <= bankroll;
  }

  function chipCount(amount: number): number {
    return Math.min(10, Math.max(3, Math.round(amount / 25)));
  }

  function scatter(count: number, seed: number): Coin[] {
    return Array.from({ length: count }, (_, index) => ({
      x: `${Math.round(Math.sin(index * 2.399 + seed) * 72 + (index - count / 2) * 6)}px`,
      y: `${Math.round(38 + Math.abs(Math.cos(index * 1.71 + seed)) * 74)}px`,
      r: `${Math.round((index % 2 === 0 ? 1 : -1) * (160 + ((index * 37 + seed * 13) % 200)))}deg`,
      d: `${Math.round((index * 53 + seed * 17) % 140)}ms`,
    }));
  }

  function toneOf(hand: BlackjackViewHand): Tone {
    if (hand.outcome === 'win') return hand.status === 'blackjack' ? 'blackjack' : 'win';
    if (hand.outcome === 'lose') return 'lose';
    return 'push';
  }

  function spawnBursts(hands: readonly BlackjackViewHand[], seatIndex: number): void {
    if (reduceMotion || table?.phase !== 'results') return;
    const x = SEAT_CENTERS[seatIndex] ?? '50%';
    const next: Burst[] = [];
    hands.forEach((hand, handIndex) => {
      if (hand.outcome === null) return;
      const tone = toneOf(hand);
      const payout = hand.payout ?? 0;
      const coins = tone === 'win' || tone === 'blackjack' ? Math.min(16, Math.max(3, Math.round(payout / 12))) : 0;
      next.push({
        id: (fxId += 1),
        x,
        y: `${54 + handIndex * 7}%`,
        tone,
        coins: scatter(coins, fxId * 5),
        phases: tone === 'lose' ? 2 : 0,
      });
    });
    if (next.length === 0) return;
    bursts = [...bursts, ...next];
    const ids = new Set(next.map(burst => burst.id));
    if (burstTimer !== null) window.clearTimeout(burstTimer);
    burstTimer = window.setTimeout(() => {
      bursts = bursts.filter(burst => !ids.has(burst.id));
      burstTimer = null;
    }, 2400);
  }

  function spawnToss(seatIndex: number, count: number): void {
    if (reduceMotion) return;
    toss = { id: (fxId += 1), x: SEAT_CENTERS[seatIndex] ?? '50%', y: '56%', coins: scatter(count, fxId * 3) };
    if (tossTimer !== null) window.clearTimeout(tossTimer);
    tossTimer = window.setTimeout(() => {
      toss = null;
      tossTimer = null;
    }, 900);
  }

  function setFlash(tone: Tone): void {
    if (reduceMotion) return;
    flash = tone;
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      flash = null;
      flashTimer = null;
    }, 1200);
  }

  function seatWin(seat: BlackjackViewSeat): boolean {
    if (reduceMotion || table?.phase !== 'results') return false;
    return seat.hands.some(hand => hand.outcome === 'win');
  }

  function dealerDim(index: number): boolean {
    if (reduceMotion || table === null || !mineLost) return false;
    return index === table.dealer.cards.length - 1;
  }

  function addChip(chip: number): void {
    wager = Math.min(wager + chip, maxBet, bankroll);
    sound.play('chip');
  }

  function clearWager(): void {
    wager = 0;
    sound.play('chip');
  }

  function deal(): void {
    if (wager < minBet || wager > bankroll) return;
    send('bet', { amount: wager });
    sound.play('chip');
  }

  function move(name: 'hit' | 'stand' | 'double' | 'split'): void {
    send(name, null);
    if (name !== 'hit' && name !== 'stand') sound.play('chip');
  }
</script>

{#if table === null}
  <div class="stub-card" data-table="blackjack">
    <h3 class="m-0 font-display text-[28px] leading-none tracking-[0.05em] text-gold">Blackjack</h3>
    <p class="m-0 text-[13px] text-muted">The croupier is shuffling — take a seat in the lobby.</p>
  </div>
{:else}
  {#snippet face(card: number, index: number, dim: boolean)}
    <span class="bj-slot" style:animation-delay={delay(index)}>
      <span class="bj-card" class:red={cardSuit(card) === 1 || cardSuit(card) === 2}>
        <span class="bj-card-rank">{rankLabel(cardRank(card))}</span>
        <span class="bj-card-suit">{suitText(card)}</span>
        <span class="bj-shine" aria-hidden="true"></span>
      </span>
      {#if dim}
        <span class="bj-dim" aria-hidden="true"></span>
      {/if}
    </span>
  {/snippet}

  <section
    class="bj relative flex h-full min-h-0 flex-col"
    data-phase={table.phase}
    data-smolder={smolder ? 'true' : 'false'}
    aria-label="Blackjack table"
  >
    {#if flash !== null}
      <span class="bj-flash" data-tone={flash} aria-hidden="true"></span>
    {/if}

    {#if live}
      <div class="bj-timer bj-enter" data-urgent={seconds <= 5 ? 'true' : 'false'} aria-hidden="true">
        <span class="bj-timer-label">{timerLabel}</span>
        <span class="bj-track"><span class="bj-fill" style:width={`${Math.round(fraction * 100)}%`}></span></span>
        <span class="bj-clock">{seconds}s</span>
      </div>
    {/if}

    <div class="bj-felt bj-enter flex flex-1 flex-col short:p-2">
      <div class="bj-fx" aria-hidden="true">
        {#if table.phase === 'playing' || table.phase === 'betting'}
          <span class="bj-felt-rim" class:mine={myTurn}></span>
        {/if}
        {#if toss !== null}
          {#key toss.id}
            <div class="bj-toss" style:--bj-tx={toss.x} style:--bj-ty={toss.y}>
              {#each toss.coins as coin, index (index)}
                <span class="bj-toss-chip" style:--x={coin.x} style:--y={coin.y} style:--r={coin.r} style:animation-delay={coin.d}></span>
              {/each}
            </div>
          {/key}
        {/if}
        <div class="bj-bursts">
          {#each bursts as burst (burst.id)}
            <span class="bj-burst" data-tone={burst.tone} style:--bj-bx={burst.x} style:--bj-by={burst.y}>
              <span class="bj-burst-rim"></span>
              {#if burst.tone === 'blackjack'}
                <span class="bj-rays"></span>
              {/if}
              {#each Array(burst.phases) as _, phaseIndex (phaseIndex)}
                <span class="bj-phase" style:animation-delay={`${phaseIndex * 380}ms`}></span>
              {/each}
              {#each burst.coins as coin, coinIndex (coinIndex)}
                <span class="bj-coin" style:--x={coin.x} style:--y={coin.y} style:--r={coin.r} style:animation-delay={coin.d}></span>
              {/each}
            </span>
          {/each}
        </div>
      </div>

      <article class="bj-dealer" data-live={table.phase === 'playing' ? 'true' : 'false'} data-smolder={smolder ? 'true' : 'false'} aria-label="Dealer hand">
        <header class="flex flex-wrap items-center gap-2">
          <span class="eyebrow">Dealer</span>
          <strong class="bj-total" data-bust={dealerBust ? 'true' : 'false'}>{dealerTotal}</strong>
          <span class="badge ml-auto" class:shared={table.mode === 'shared'}>{table.mode}</span>
          <span class="badge short:hidden">{PHASE_LABELS[table.phase]}</span>
        </header>
        <div class="bj-cards">
          {#each table.dealer.cards as card, index (index)}
            {@render face(card, index, dealerDim(index))}
          {/each}
          {#if hiddenHole}
            <span class="bj-slot" style:animation-delay={delay(table.dealer.cards.length)}>
              <span class="bj-card back" aria-hidden="true"></span>
            </span>
          {/if}
          {#if table.dealer.cards.length === 0}
            <span class="bj-empty">The dealer waits for a bet.</span>
          {/if}
        </div>
      </article>

      <div class="bj-seats min-h-0" aria-label="Seats">
        {#each table.seats as seat, index (index)}
          {@const mine = seat.id !== null && seat.id === view.you}
          {@const turn = seat.id !== null && seat.id === table.turn}
          <article class="bj-seat" class:me={mine} class:active={turn} class:open={seat.id === null} class:win={seatWin(seat)}>
            <header class="bj-seat-top">
              {#if seat.id !== null}
                <Avatar id={seat.id} size={22} label={nameOf(seat.id)} />
              {/if}
              <span class="bj-seat-name">{seat.id === null ? 'Open seat' : nameOf(seat.id)}</span>
              {#if mine}<span class="bj-you">you</span>{/if}
              {#if seat.bet > 0}<span class="bj-seat-bet">{money(seat.bet)}</span>{/if}
            </header>
            {#if seat.hands.length === 0}
              <p class="bj-seat-hint">{seat.id === null ? 'Waiting for a player' : 'No bet this round'}</p>
            {:else}
              {#each seat.hands as hand, handIndex (handIndex)}
                {@const shimmer = mine && table.phase === 'playing' && hand.status === 'playing'}
                <div class="bj-hand" class:smolder={hand.status === 'busted'}>
                  <div class="bj-cards">
                    {#each hand.cards as card, cardIndex (cardIndex)}
                      {@render face(card, cardIndex, false)}
                    {/each}
                    {#if shimmer}
                      <span class="bj-hand-fx">
                        <span class="bj-shimmer" aria-hidden="true"></span>
                      </span>
                    {/if}
                  </div>
                  <div class="bj-hand-foot">
                    <span class="bj-hand-total" data-status={hand.status}>{handValue(hand.cards)}</span>
                    <span class="bj-tag" data-status={hand.status}>{STATUS_LABELS[hand.status]}</span>
                    {#if seat.hands.length > 1}
                      <span class="bj-tag">Hand {handIndex + 1}</span>
                    {/if}
                    {#if hand.outcome !== null}
                      <span class="bj-badge" data-outcome={hand.outcome} data-status={hand.status}>{outcomeText(hand)}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </article>
        {/each}
      </div>
    </div>

    <div class="bj-bar bj-enter" class:mine={myTurn}>
      {#if myTurn && myHand !== null}
        <div class="bj-bar-top">
          <span class="eyebrow">Your hand · {money(myHand.bet)}</span>
          <strong class="bj-hand-total" data-status={myHand.status}>{handValue(myHand.cards)}</strong>
        </div>
        <div class="bj-moves">
          <button type="button" class="btn" disabled={!has('hit')} onclick={() => move('hit')}>Hit</button>
          <button type="button" class="btn" disabled={!has('stand')} onclick={() => move('stand')}>Stand</button>
          <button type="button" class="btn" disabled={!canDouble} onclick={() => move('double')}>Double</button>
          <button type="button" class="btn" disabled={!canSplit} onclick={() => move('split')}>Split</button>
        </div>
      {:else if staging}
        <div class="bj-bar-top">
          <span class="eyebrow">Stake</span>
          <strong class="bj-wager">{money(wager)}</strong>
        </div>
        <div class="bj-chips">
          {#each CHIPS as chip (chip)}
            <button type="button" class="bj-chip" disabled={!canPlace(chip)} onclick={() => addChip(chip)} aria-label={`Add ${money(chip)}`}>+{money(chip)}</button>
          {/each}
        </div>
        <div class="bj-bar-actions">
          <button type="button" class="btn flex-1" disabled={wager === 0} onclick={clearWager}>Clear</button>
          <button type="button" class="btn btn-primary flex-1" disabled={wager < minBet} onclick={deal}>Deal</button>
        </div>
      {:else if table.phase === 'results'}
        <div class="bj-bar-top">
          <span class="eyebrow">Round result</span>
          <strong class="bj-net" data-outcome={net > 0 ? 'win' : net < 0 ? 'lose' : 'push'}>{signed(net)}</strong>
        </div>
        <p class="bj-bar-status">{barStatus}</p>
      {:else}
        <p class="bj-bar-status">{barStatus}</p>
      {/if}
    </div>
  </section>
{/if}

<style>
  .bj {
    --bj-card-w: 42px;
    --bj-card-h: 60px;
    --bj-seat-y: 56%;
    --bj-rise: 210px;
    gap: 10px;
  }

  @media (max-width: 619px) {
    .bj {
      --bj-card-w: 38px;
      --bj-card-h: 54px;
      --bj-seat-y: 66%;
    }
  }

  @media (min-width: 900px) {
    .bj {
      --bj-card-w: 52px;
      --bj-card-h: 74px;
    }
  }

  @media (min-width: 1240px) {
    .bj {
      --bj-card-w: 60px;
      --bj-card-h: 86px;
    }
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .bj {
      --bj-card-w: 33px;
      --bj-card-h: 47px;
      --bj-seat-y: 60%;
      --bj-rise: 140px;
      gap: 6px;
    }
  }

  .bj-enter {
    animation: var(--animate-card-in);
  }

  .bj-timer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(16, 22, 39, 0.82);
  }

  .bj-timer-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-muted);
    white-space: nowrap;
  }

  .bj-track {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: #202a49;
    overflow: hidden;
  }

  .bj-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--color-gold), var(--color-mint));
    transition: width 0.18s linear;
  }

  .bj-timer[data-urgent='true'] .bj-fill {
    background: var(--color-red);
  }

  .bj-timer[data-urgent='true'] .bj-clock {
    color: var(--color-red);
  }

  .bj-clock {
    min-width: 2.4em;
    text-align: right;
    font-size: 12px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .bj-felt {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: clamp(300px, calc(100dvh - 420px), 900px);
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--color-gold) 22%, var(--color-edge));
    border-radius: 18px;
    background:
      radial-gradient(420px 200px at 50% -10%, rgba(35, 224, 190, 0.08), transparent 72%),
      linear-gradient(170deg, #16203a, #0d1322 78%);
    overflow: hidden;
  }

  .bj-fx {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }

  .bj-felt-rim {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 70px -12px rgba(35, 224, 190, 0.55), inset 0 0 0 2px rgba(35, 224, 190, 0.35);
    opacity: 0.22;
    animation: bj-rim 2.8s ease-in-out infinite;
  }

  .bj-felt-rim.mine {
    box-shadow: inset 0 0 80px -8px rgba(35, 224, 190, 0.7), inset 0 0 0 2px rgba(35, 224, 190, 0.5);
    animation-duration: 1.7s;
  }

  @keyframes bj-rim {
    0%, 100% { opacity: 0.18; }
    50% { opacity: 0.62; }
  }

  .bj-flash {
    position: absolute;
    inset: 0;
    z-index: 20;
    border-radius: 18px;
    pointer-events: none;
    opacity: 0;
    animation: bj-flash 1s ease-out both;
  }

  .bj-flash[data-tone='blackjack'] {
    box-shadow: inset 0 0 110px 24px rgba(244, 201, 93, 0.55);
    background: radial-gradient(circle at 50% 55%, transparent 38%, rgba(244, 201, 93, 0.3));
  }

  .bj-flash[data-tone='win'] {
    box-shadow: inset 0 0 90px 18px rgba(35, 224, 190, 0.4);
  }

  @keyframes bj-flash {
    0% { opacity: 0; }
    14% { opacity: 1; }
    100% { opacity: 0; }
  }

  .bj-toss {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .bj-toss-chip {
    position: absolute;
    left: var(--bj-tx, 50%);
    top: var(--bj-ty, 56%);
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 999px;
    background: radial-gradient(circle at 50% 30%, #ffe9a8, #f4c95d 45%, #a97c12 100%);
    box-shadow: inset 0 0 0 3px rgba(9, 13, 23, 0.35), 0 5px 12px -5px rgba(0, 0, 0, 0.95);
    opacity: 0;
    animation: bj-toss 0.66s cubic-bezier(0.22, 1.1, 0.36, 1) both;
  }

  @keyframes bj-toss {
    0% { opacity: 0; transform: translate(0, calc(-1 * var(--bj-rise, 210px))) rotate(-26deg) scale(0.6); }
    14% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)) scale(1); }
  }

  .bj-bursts {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .bj-burst {
    --bj-tone: var(--color-mint);
    position: absolute;
    left: var(--bj-bx, 50%);
    top: var(--bj-by, 56%);
    width: 0;
    height: 0;
  }

  .bj-burst[data-tone='lose'] {
    --bj-tone: var(--color-red);
  }

  .bj-burst[data-tone='push'] {
    --bj-tone: var(--color-muted);
  }

  .bj-burst[data-tone='blackjack'] {
    --bj-tone: var(--color-gold);
  }

  @media (max-width: 619px) {
    .bj-burst {
      left: 50%;
    }
  }

  .bj-burst-rim {
    position: absolute;
    left: 0;
    top: 0;
    width: 150px;
    height: 150px;
    margin: -75px 0 0 -75px;
    border-radius: 999px;
    background: radial-gradient(circle, color-mix(in srgb, var(--bj-tone) 40%, transparent) 0%, transparent 66%);
    box-shadow: 0 0 70px -6px var(--bj-tone);
    opacity: 0;
    animation: bj-burst 1s ease-out both;
  }

  @keyframes bj-burst {
    0% { opacity: 0; transform: scale(0.35); }
    24% { opacity: 1; }
    100% { opacity: 0; transform: scale(1.4); }
  }

  .bj-rays {
    position: absolute;
    left: 0;
    top: 0;
    width: 280px;
    height: 280px;
    margin: -140px 0 0 -140px;
    border-radius: 999px;
    background: repeating-conic-gradient(from 0deg, rgba(244, 201, 93, 0.5) 0deg 5deg, transparent 5deg 20deg);
    mask: radial-gradient(circle, rgba(0, 0, 0, 0.9) 0%, transparent 68%);
    -webkit-mask: radial-gradient(circle, rgba(0, 0, 0, 0.9) 0%, transparent 68%);
    opacity: 0;
    animation: bj-rays 1.15s ease-out both;
  }

  @keyframes bj-rays {
    0% { opacity: 0; transform: scale(0.3) rotate(0deg); }
    26% { opacity: 0.95; }
    100% { opacity: 0; transform: scale(1.3) rotate(72deg); }
  }

  .bj-phase {
    position: absolute;
    left: 0;
    top: 0;
    width: 220px;
    height: 220px;
    margin: -110px 0 0 -110px;
    border-radius: 44% 56% 52% 48% / 50% 44% 56% 50%;
    background: radial-gradient(circle at 50% 46%, rgba(255, 57, 91, 0.5), rgba(255, 57, 91, 0.12) 55%, transparent 74%);
    filter: blur(7px);
    opacity: 0;
    animation: bj-smear 1.1s ease-out both;
  }

  @keyframes bj-smear {
    0% { opacity: 0; transform: scale(0.45) rotate(0deg); }
    30% { opacity: 1; }
    100% { opacity: 0; transform: scale(1.55) rotate(26deg); }
  }

  .bj-coin {
    position: absolute;
    left: 0;
    top: 0;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    border-radius: 999px;
    background: radial-gradient(circle at 50% 30%, #ffeeb8, #f4c95d 46%, #b8860b 100%);
    box-shadow: inset 0 0 0 3px rgba(9, 13, 23, 0.32), 0 4px 10px -5px rgba(0, 0, 0, 0.9);
    opacity: 0;
    animation: bj-coin 1.2s cubic-bezier(0.25, 0.7, 0.4, 1) both;
  }

  @keyframes bj-coin {
    0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.5); }
    14% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)) scale(0.9); }
  }

  .bj-dealer {
    position: relative;
    flex: 0 0 auto;
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid rgba(36, 46, 76, 0.9);
    border-radius: 14px;
    background: rgba(9, 13, 23, 0.42);
    transition: border-color 0.16s ease;
  }

  .bj-dealer::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: radial-gradient(circle at 50% 120%, rgba(255, 57, 91, 0.5), transparent 72%);
    opacity: 0;
  }

  .bj-dealer[data-smolder='true']::after {
    animation: bj-smolder 2.6s ease-in-out 1s infinite;
  }

  .bj-dealer[data-smolder='true'] .bj-cards {
    animation: bj-wobble 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.1s 1 both;
  }

  @keyframes bj-smolder {
    0%, 100% { opacity: 0.22; }
    50% { opacity: 0.78; }
  }

  @keyframes bj-wobble {
    10%, 90% { transform: translateX(-1.5px) rotate(-0.4deg); }
    20%, 80% { transform: translateX(2px) rotate(0.5deg); }
    30%, 50%, 70% { transform: translateX(-3px) rotate(-0.8deg); }
    40%, 60% { transform: translateX(3px) rotate(0.8deg); }
  }

  .bj-dealer[data-live='true'] {
    border-color: rgba(76, 201, 240, 0.4);
  }

  @media (min-width: 900px) {
    .bj-dealer {
      padding: 14px 16px;
      gap: 12px;
    }
  }

  .bj-cards {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 5px;
    min-height: calc(var(--bj-card-h) + 2px);
  }

  .bj-slot {
    position: relative;
    display: inline-block;
    perspective: 640px;
  }

  .bj-card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    width: var(--bj-card-w);
    height: var(--bj-card-h);
    padding: 3px 4px;
    border: 1px solid #cdd6ec;
    border-radius: 6px;
    background: linear-gradient(165deg, #fdfdff, #dde3f2);
    color: #101728;
    font-weight: 800;
    box-shadow: 0 6px 14px -9px rgba(0, 0, 0, 0.95);
    animation: bj-deal 0.44s cubic-bezier(0.22, 1.2, 0.36, 1) both;
  }

  @keyframes bj-deal {
    0% { opacity: 0; transform: translate(26px, -46px) rotateX(-78deg) rotate(-8deg) scale(0.8); }
    55% { opacity: 1; transform: translate(-4px, 4px) rotateX(-14deg) rotate(2deg) scale(1.02); }
    100% { opacity: 1; transform: none; }
  }

  .bj-card.red {
    color: #d3133a;
  }

  .bj-card-rank {
    font-size: calc(var(--bj-card-w) * 0.34);
    line-height: 1;
  }

  .bj-card-suit {
    align-self: end;
    justify-self: end;
    font-size: calc(var(--bj-card-w) * 0.36);
    line-height: 1;
  }

  .bj-shine {
    position: absolute;
    inset: 0;
    border-radius: 5px;
    overflow: hidden;
    pointer-events: none;
  }

  .bj-shine::after {
    content: '';
    position: absolute;
    top: -60%;
    left: -80%;
    width: 42%;
    height: 220%;
    background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.85), transparent);
    transform: rotate(18deg);
    opacity: 0;
    animation: bj-shine 2.9s ease-in-out 0.7s infinite;
  }

  @keyframes bj-shine {
    0% { opacity: 0; transform: translateX(0) rotate(18deg); }
    18% { opacity: 0.9; }
    40% { opacity: 0; transform: translateX(420%) rotate(18deg); }
    100% { opacity: 0; transform: translateX(420%) rotate(18deg); }
  }

  .bj-dim {
    position: absolute;
    inset: 0;
    border-radius: 6px;
    pointer-events: none;
    background: rgba(255, 57, 91, 0.45);
    mix-blend-mode: multiply;
    animation: bj-dim 2.6s ease-out both;
  }

  .bj-slot:has(.bj-dim) {
    animation: bj-smolder-in 0.9s ease-out both;
  }

  @keyframes bj-smolder-in {
    0% { filter: none; }
    100% { filter: brightness(0.55) saturate(0.5); }
  }

  @keyframes bj-dim {
    0% { opacity: 0; }
    14% { opacity: 1; }
    72% { opacity: 0.9; }
    100% { opacity: 0; }
  }

  .bj-card.back {
    border-color: rgba(244, 201, 93, 0.45);
    background:
      repeating-linear-gradient(135deg, rgba(244, 201, 93, 0.18) 0 3px, transparent 3px 9px),
      linear-gradient(160deg, #22305a, #131a2f);
    box-shadow: inset 0 0 0 2px rgba(9, 13, 23, 0.9), inset 0 0 0 3px rgba(244, 201, 93, 0.3);
  }

  .bj-card.back::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 5px;
    background: linear-gradient(100deg, transparent 34%, rgba(199, 240, 255, 0.34) 50%, transparent 66%);
    background-size: 240% 100%;
    opacity: 0.45;
    animation: bj-frost 2.4s ease-in-out infinite;
  }

  .bj-empty {
    align-self: center;
    font-size: 12px;
    color: var(--color-muted);
  }

  .bj-total {
    font-family: var(--font-display);
    font-size: clamp(22px, 3vw, 34px);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--color-gold);
    font-variant-numeric: tabular-nums;
  }

  .bj-total[data-bust='true'] {
    color: var(--color-red);
  }

  .bj-seats {
    flex: 1 1 auto;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(min-content, 1fr);
  }

  @media (min-width: 620px) {
    .bj-seats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 860px) {
    .bj-seats {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .bj-seats {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 5px;
    }
  }

  .bj-seat {
    position: relative;
    display: grid;
    align-content: center;
    gap: 6px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--color-edge);
    border-radius: 14px;
    background: rgba(24, 30, 50, 0.42);
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }

  .bj-seat::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(circle at 50% 28%, rgba(35, 224, 190, 0.32), transparent 76%);
  }

  .bj-seat.win::after {
    animation: bj-seat-win 0.95s ease-out both;
  }

  @keyframes bj-seat-win {
    0% { opacity: 0; }
    22% { opacity: 1; }
    100% { opacity: 0; }
  }

  .bj-seat.me {
    border-color: rgba(244, 201, 93, 0.55);
    background: rgba(244, 201, 93, 0.07);
    box-shadow: 0 0 22px -12px rgba(244, 201, 93, 0.9);
  }

  .bj-seat.active {
    border-color: rgba(35, 224, 190, 0.7);
    background: rgba(35, 224, 190, 0.08);
    box-shadow: 0 0 24px -10px rgba(35, 224, 190, 0.85);
    animation: bj-seat-pulse 1.6s ease-in-out infinite;
  }

  .bj-seat.open {
    border-style: dashed;
    opacity: 0.62;
  }

  @keyframes bj-seat-pulse {
    0%, 100% { box-shadow: 0 0 18px -12px rgba(35, 224, 190, 0.7); }
    50% { box-shadow: 0 0 26px -8px rgba(35, 224, 190, 0.95); }
  }

  .bj-seat-top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .bj-seat-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--color-fog);
  }

  @media (max-width: 619px) {
    .bj-seat-top :global(.avatar) {
      width: 18px !important;
      height: 18px !important;
      font-size: 11px !important;
    }
  }

  .bj-seat.open .bj-seat-name {
    color: var(--color-muted);
  }

  .bj-you {
    flex: none;
    padding: 1px 7px;
    border: 1px solid rgba(244, 201, 93, 0.55);
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-gold);
  }

  .bj-seat-bet {
    margin-left: auto;
    font-size: 11.5px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: var(--color-gold);
  }

  .bj-seat-hint {
    margin: 0;
    font-size: 11px;
    color: var(--color-muted);
  }

  .bj-hand {
    display: grid;
    gap: 4px;
  }

  .bj-hand.smolder {
    animation: bj-wobble 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.15s 1 both;
  }

  .bj-hand.smolder .bj-card {
    box-shadow: 0 6px 14px -9px rgba(0, 0, 0, 0.95), 0 0 18px -4px rgba(255, 57, 91, 0.6);
  }

  .bj-hand-fx {
    position: relative;
    display: inline-flex;
    align-items: flex-end;
    align-self: flex-end;
    width: 0;
  }

  .bj-shimmer {
    position: absolute;
    left: calc(var(--bj-card-w) * -1);
    bottom: 0;
    width: var(--bj-card-w);
    height: var(--bj-card-h);
    border-radius: 6px;
    overflow: hidden;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(76, 201, 240, 0.55), 0 0 22px -4px rgba(76, 201, 240, 0.6);
    animation: bj-frost 2.2s ease-in-out infinite;
  }

  .bj-shimmer::after {
    content: '';
    position: absolute;
    top: -60%;
    left: -90%;
    width: 45%;
    height: 230%;
    background: linear-gradient(100deg, transparent, rgba(199, 240, 255, 0.75), transparent);
    transform: rotate(16deg);
    animation: bj-frost-ray 2.6s ease-in-out 0.3s infinite;
  }

  @keyframes bj-frost {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  @keyframes bj-frost-ray {
    0% { opacity: 0; transform: translateX(0) rotate(16deg); }
    25% { opacity: 0.85; }
    55% { opacity: 0; transform: translateX(420%) rotate(16deg); }
    100% { opacity: 0; transform: translateX(420%) rotate(16deg); }
  }

  .bj-hand-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }

  .bj-hand-total {
    font-family: var(--font-display);
    font-size: clamp(18px, 2.2vw, 26px);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--color-fog);
    font-variant-numeric: tabular-nums;
  }

  .bj-hand-total[data-status='busted'] {
    color: var(--color-red);
  }

  .bj-hand-total[data-status='blackjack'] {
    color: var(--color-gold);
  }

  .bj-tag {
    padding: 1px 7px;
    border: 1px solid var(--color-edge);
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .bj-tag[data-status='busted'] {
    border-color: rgba(255, 57, 91, 0.45);
    color: var(--color-red);
  }

  .bj-tag[data-status='blackjack'] {
    border-color: rgba(244, 201, 93, 0.5);
    color: var(--color-gold);
  }

  .bj-tag[data-status='doubled'] {
    border-color: rgba(139, 124, 255, 0.5);
    color: var(--color-violet);
  }

  .bj-badge {
    animation: bj-pop 0.32s cubic-bezier(0.2, 1.4, 0.4, 1) both;
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
  }

  .bj-badge[data-outcome='win'] {
    border: 1px solid rgba(35, 224, 190, 0.5);
    background: rgba(35, 224, 190, 0.14);
    color: var(--color-mint);
  }

  .bj-badge[data-outcome='win'][data-status='blackjack'] {
    border-color: rgba(244, 201, 93, 0.6);
    background: rgba(244, 201, 93, 0.16);
    color: var(--color-gold);
  }

  .bj-badge[data-outcome='lose'] {
    border: 1px solid rgba(255, 57, 91, 0.45);
    background: rgba(255, 57, 91, 0.12);
    color: #ffd4dc;
  }

  .bj-badge[data-outcome='push'] {
    border: 1px solid var(--color-edge);
    background: rgba(24, 30, 50, 0.7);
    color: var(--color-muted);
  }

  @keyframes bj-pop {
    from { opacity: 0; transform: scale(0.72); }
    to { opacity: 1; transform: none; }
  }

  .bj-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    flex: 0 0 auto;
    margin-top: auto;
    display: grid;
    gap: 8px;
    padding: 10px;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    border: 1px solid var(--color-edge);
    border-radius: 16px;
    background: rgba(16, 22, 39, 0.96);
    box-shadow: 0 -14px 34px -18px rgba(0, 0, 0, 0.95);
    backdrop-filter: blur(10px);
    transition: border-color 0.16s ease;
  }

  .bj-bar.mine {
    border-color: rgba(35, 224, 190, 0.55);
  }

  .bj-bar-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .bj-wager {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--color-gold);
    font-variant-numeric: tabular-nums;
  }

  .bj-net {
    animation: bj-pop 0.32s cubic-bezier(0.2, 1.4, 0.4, 1) both;
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 1;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
  }

  .bj-net[data-outcome='win'] {
    color: var(--color-mint);
    text-shadow: 0 0 18px rgba(35, 224, 190, 0.5);
  }

  .bj-net[data-outcome='lose'] {
    color: var(--color-red);
  }

  .bj-net[data-outcome='push'] {
    color: var(--color-muted);
  }

  .bj-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .bj-chip {
    min-height: 44px;
    min-width: 54px;
    padding: 8px 10px;
    border: 1px solid rgba(244, 201, 93, 0.4);
    border-radius: 999px;
    background: radial-gradient(circle at 50% 28%, #2a3a6a, #16203a);
    color: var(--color-gold);
    font: 800 13px/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: transform 0.12s ease, border-color 0.12s ease;
  }

  .bj-chip:hover:not(:disabled) {
    border-color: var(--color-gold);
    transform: translateY(-1px);
  }

  .bj-chip:active:not(:disabled) {
    transform: translateY(1px) scale(0.98);
  }

  .bj-chip:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  .bj-chip:disabled {
    opacity: 0.42;
    cursor: default;
  }

  .bj-bar-actions {
    display: flex;
    gap: 8px;
  }

  .bj-moves {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .bj-moves .btn {
    padding: 10px 6px;
  }

  .bj-bar-status {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-muted);
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .bj-felt {
      min-height: 0;
      gap: 5px;
      padding: 6px;
    }

    .bj-timer {
      padding: 3px 8px;
    }

    .bj-dealer {
      padding: 4px 6px;
      gap: 4px;
    }

    .bj-seat {
      padding: 4px 6px;
      gap: 3px;
    }

    .bj-bar {
      padding: 6px 8px;
      padding-bottom: max(6px, env(safe-area-inset-bottom));
      gap: 6px;
    }
  }
</style>
