<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView } from '../../core/types';
  import { SUIT_LABELS, cardRank, cardSuit, rankLabel } from '../../core/cards';
  import { CATEGORY_NAMES, evaluate5, handCategory, videoCoinWin } from '../../games/poker-eval';
  import { POKER_ANTE, POKER_BET, POKER_MAX_RAISES, POKER_RESULTS_MS, POKER_SEATS, POKER_TURN_MS } from '../../games/poker';
  import type { PokerView } from '../../games/poker';
  import { sound } from '../../sound';
  import Avatar from '../Avatar.svelte';

  let { detail, view, names, send }: { detail: Json; view: PlayerView; names: Record<string, string>; send: (action: string, payload: Json) => void } = $props();

  type Seat = NonNullable<PokerView['table']>['seats'][number];
  type ResultRow = NonNullable<PokerView['results']>[number];
  type ChipFlight = { id: number; dx: number; dy: number; delay: number; tone: number };
  type TossCard = { id: number; card: number; left: number; machine: 'video' | 'own' };

  const COIN_VALUES = [1, 2, 3, 4, 5] as const;
  const CONFETTI_COLORS = ['var(--color-gold)', 'var(--color-red)', 'var(--color-mint)', 'var(--color-violet)', 'var(--color-sky)'];
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const WIN_NAMES: Record<number, string> = {
    1: CATEGORY_NAMES[1]!,
    2: CATEGORY_NAMES[2]!,
    3: CATEGORY_NAMES[3]!,
    4: CATEGORY_NAMES[4]!,
    6: CATEGORY_NAMES[5]!,
    9: CATEGORY_NAMES[6]!,
    25: CATEGORY_NAMES[7]!,
    50: CATEGORY_NAMES[8]!,
    250: CATEGORY_NAMES[8]!,
  };

  const confetti = reduceMotion ? [] : Array.from({ length: 18 }, () => ({
    x: Math.round((Math.random() * 2 - 1) * 170),
    y: Math.round(90 + Math.random() * 200),
    r: Math.round((Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 420)),
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0]!,
    d: +(Math.random() * 0.35).toFixed(2),
    t: +(1.2 + Math.random() * 1).toFixed(2),
  }));

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function netLabel(value: number): string {
    if (value === 0) return '$0';
    return `${value > 0 ? '+' : '−'}${money(value)}`;
  }

  function nameOf(id: string): string {
    return names[id] ?? 'Player';
  }

  function isRed(card: number): boolean {
    const suit = cardSuit(card);
    return suit === 1 || suit === 2;
  }

  function categoryOf(cards: readonly number[]): string {
    if (cards.length !== 5) return '—';
    return CATEGORY_NAMES[handCategory(evaluate5(cards))] ?? '—';
  }

  const poker = $derived.by(() => {
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return null;
    return detail as unknown as PokerView;
  });

  const you = $derived(view.you);
  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const limits = $derived(poker?.limits ?? { ante: POKER_ANTE, bet: POKER_BET, maxRaises: POKER_MAX_RAISES, coins: COIN_VALUES.length });
  const phase = $derived(poker?.phase ?? 'idle');
  const mode = $derived(poker?.mode ?? 'solo');
  const table = $derived(poker?.table ?? null);
  const results = $derived(poker?.results ?? null);
  const actions = $derived(poker?.actions ?? []);

  const video = $derived.by(() => {
    const hand = poker?.you.video ?? null;
    return hand !== null && Array.isArray(hand.cards) && hand.cards.length === 5 ? hand : null;
  });

  const own = $derived.by(() => {
    const hand = poker?.you.hand ?? null;
    return hand !== null && Array.isArray(hand.cards) && hand.cards.length === 5 ? hand : null;
  });

  const turnSeat = $derived(table?.turn ?? null);
  const buttonSeat = $derived(table?.button ?? null);
  const seatRows = $derived.by(() => {
    const seats = table?.seats ?? [];
    const split = Math.ceil(seats.length / 2);
    return { top: seats.slice(0, split), bottom: seats.slice(split) };
  });

  let now = $state(Date.now());
  let arrivedAt = $state(Date.now());

  const serverNow = $derived(view.now + (now - arrivedAt));
  const remaining = $derived.by(() => (table === null ? 0 : Math.max(0, table.deadline - serverNow)));
  const seconds = $derived(Math.ceil(remaining / 1000));
  const phaseTotal = $derived(phase === 'results' ? POKER_RESULTS_MS : POKER_TURN_MS);
  const barPercent = $derived(Math.max(0, Math.min(100, (remaining / phaseTotal) * 100)));
  const danger = $derived(remaining <= 8000);
  const canAct = $derived(view.vault !== null && view.vault.status === 'active' && serverNow < view.vault.personalDeadline);
  const betting = $derived(phase === 'bet1' || phase === 'bet2');
  const myTurn = $derived(you !== null && turnSeat === you);
  const turnName = $derived(turnSeat === null ? null : nameOf(turnSeat));
  const canDeal = $derived(canAct && video === null && bankroll >= 1 && actions.includes('deal'));
  const callAmount = $derived(table === null || own === null ? 0 : Math.max(0, table.currentBet - own.roundBet));
  const canRaise = $derived(canAct && myTurn && actions.includes('raise') && bankroll > callAmount);
  const showVideo = $derived(table === null || video !== null || canDeal);

  const videoHand = $derived.by(() => {
    if (video === null) return null;
    const score = evaluate5(video.cards);
    return { name: CATEGORY_NAMES[handCategory(score)] ?? CATEGORY_NAMES[0]!, win: videoCoinWin(video.cards, video.coins) };
  });

  const winners = $derived.by(() => {
    if (results === null) return [] as ResultRow[];
    const best = results.reduce((top, row) => Math.max(top, row.net), 0);
    return best > 0 ? results.filter(row => row.net === best) : [];
  });

  const celebrate = $derived.by(() => {
    if (outcome !== null && outcome.net >= 150) return true;
    if (phase === 'results' && results !== null) {
      const me = results.find(row => row.id === you);
      return me !== undefined && me.net > 0;
    }
    return false;
  });

  const phaseLabel = $derived.by(() => {
    if (phase === 'results') return 'showdown';
    if (phase === 'draw') return 'the draw';
    if (betting) return myTurn ? 'your move' : `waiting for ${turnName ?? 'the table'}`;
    return 'waiting for players';
  });

  const burstCount = $derived.by(() => {
    if (reduceMotion || phase !== 'results' || table === null || winners.length === 0) return 0;
    return Math.min(26, 8 + Math.floor(table.pot / 12));
  });

  let ovalW = $state(0);
  let ovalH = $state(0);
  let chips = $state<ChipFlight[]>([]);
  let toss = $state<TossCard[]>([]);
  let tension = $state(0);
  let fxSeq = 0;
  let lastPotSeen = -1;
  let lastBetSeen = -1;
  let lastTicked = -1;

  let holds = $state<boolean[]>([false, false, false, false, false]);
  let coins = $state<number>(COIN_VALUES[0]);
  let videoKey = $state('');
  let pvpHoldKey = -1;
  let resultKey = -1;
  let dealtBankroll = 0;
  let pending: { coins: number } | null = null;
  let outcome = $state<{ name: string; win: number; net: number } | null>(null);

  $effect(() => {
    void view.now;
    arrivedAt = Date.now();
  });

  $effect(() => {
    const id = window.setInterval(() => { now = Date.now(); }, 200);
    return () => window.clearInterval(id);
  });

  let compact = $state(false);

  $effect(() => {
    const query = window.matchMedia('(orientation: landscape) and (max-height: 620px)');
    const sync = () => { compact = query.matches; };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  $effect(() => {
    if (view.phase !== 'playing') return;
    const current = table;
    if (current === null || current.deadline <= 0) {
      lastTicked = -1;
      return;
    }
    if (serverNow < current.deadline || lastTicked === current.deadline) return;
    lastTicked = current.deadline;
    send('tick', null);
  });

  $effect(() => {
    const hand = video;
    if (hand !== null) {
      const key = `${hand.coins}:${hand.cards.join('-')}`;
      if (key !== videoKey) {
        videoKey = key;
        dealtBankroll = view.vault?.bankroll ?? 0;
        pending = null;
        outcome = null;
        holds = [false, false, false, false, false];
        sound.play('card');
      }
      return;
    }
    if (videoKey === '') return;
    videoKey = '';
    const win = Math.max(0, (view.vault?.bankroll ?? 0) - dealtBankroll);
    const paid = pending?.coins ?? 0;
    const multiplier = paid > 0 ? Math.round(win / paid) : 0;
    pending = null;
    outcome = { name: WIN_NAMES[multiplier] ?? 'No win', win, net: win - paid };
    sound.play(win > 0 ? 'win' : 'lose');
  });

  $effect(() => {
    if (phase !== 'draw' || table === null || own === null) return;
    if (table.deadline === pvpHoldKey) return;
    pvpHoldKey = table.deadline;
    holds = [false, false, false, false, false];
  });

  $effect(() => {
    if (phase !== 'results' || table === null || results === null) return;
    if (table.deadline === resultKey) return;
    resultKey = table.deadline;
    const me = results.find(row => row.id === you);
    if (me !== undefined && me.net > 0) sound.play('win');
    else if (me !== undefined && me.net < 0) sound.play('lose');
  });

  $effect(() => {
    const current = table;
    if (current === null || view.phase !== 'playing') {
      lastPotSeen = -1;
      lastBetSeen = -1;
      return;
    }
    const pot = current.pot;
    const bet = current.currentBet;
    if (lastPotSeen >= 0) {
      if (bet > lastBetSeen && bet > 0) {
        const raiser = current.seats.find(seat => seat.roundBet === bet) ?? null;
        spawnChips(3, raiser === null ? null : raiser.id);
        tension += 1;
      } else if (pot > lastPotSeen) {
        let leader: Seat | null = null;
        for (const seat of current.seats) {
          if (leader === null || seat.roundBet > leader.roundBet) leader = seat;
        }
        spawnChips(Math.min(5, Math.max(1, Math.round((pot - lastPotSeen) / 12))), leader === null ? null : leader.id);
      }
    }
    lastPotSeen = pot;
    lastBetSeen = bet;
  });

  function allows(name: string): boolean {
    return actions.includes(name);
  }

  function revealedCards(seat: Seat): number[] | null {
    if (seat.cards !== null) return seat.cards;
    if (you !== null && seat.id === you && own !== null) return own.cards;
    return null;
  }

  function resultOf(id: string): ResultRow | null {
    return results?.find(row => row.id === id) ?? null;
  }

  function seatOffset(seatId: string | null): { dx: number; dy: number } {
    const current = table;
    if (current === null || seatId === null) return { dx: 0, dy: -40 };
    const index = current.seats.findIndex(seat => seat.id === seatId);
    if (index < 0) return { dx: 0, dy: -40 };
    const angle = (index / current.seats.length) * Math.PI * 2 - Math.PI / 2;
    return { dx: Math.cos(angle) * ovalW * 0.44, dy: Math.sin(angle) * ovalH * 0.42 };
  }

  function spawnChips(count: number, seatId: string | null): void {
    if (reduceMotion) return;
    const origin = seatOffset(seatId);
    const flights: ChipFlight[] = [];
    for (let index = 0; index < count; index += 1) {
      fxSeq += 1;
      const spread = (index - (count - 1) / 2) * 14;
      flights.push({
        id: fxSeq,
        dx: origin.dx + spread,
        dy: origin.dy - Math.abs(spread) * 0.25,
        delay: index * 0.05,
        tone: fxSeq % 3,
      });
    }
    chips = [...chips.slice(-8), ...flights];
  }

  function dropChip(id: number): void {
    chips = chips.filter(chip => chip.id !== id);
  }

  function launchDiscards(cards: readonly number[], machine: 'video' | 'own'): void {
    if (reduceMotion) return;
    const items: TossCard[] = [];
    cards.forEach((card, index) => {
      if (holds[index] !== false) return;
      fxSeq += 1;
      items.push({ id: fxSeq, card, left: 10 + index * 20, machine });
    });
    if (items.length > 0) toss = [...toss.slice(-6), ...items];
  }

  function dropToss(id: number): void {
    toss = toss.filter(item => item.id !== id);
  }

  function burstCoins(count: number): { dx: number; dy: number; delay: number }[] {
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.35;
      const reach = 46 + (index % 5) * 16;
      return {
        dx: Math.cos(angle) * reach * (1 + ovalW / 1200),
        dy: Math.sin(angle) * reach * 0.72 + 34,
        delay: (index % 6) * 0.045,
      };
    });
  }

  function selectCoins(value: number): void {
    if (video !== null || value > bankroll || !canAct) return;
    coins = Math.min(value, limits.coins);
    sound.play('chip');
  }

  function dealVideo(): void {
    if (!canDeal || coins > bankroll) return;
    sound.play('chip');
    send('deal', { coins });
  }

  function toggleHold(index: number): void {
    holds = holds.map((value, at) => (at === index ? !value : value));
  }

  function drawVideo(): void {
    if (video === null || !canAct || !allows('draw')) return;
    pending = { coins: video.coins };
    launchDiscards(video.cards, 'video');
    sound.play('card');
    send('draw', { holds: [...holds] });
  }

  function drawShared(): void {
    if (own === null || !canAct || !allows('draw')) return;
    launchDiscards(own.cards, 'own');
    sound.play('card');
    send('draw', { holds: [...holds] });
  }

  function bet(name: 'check' | 'call' | 'raise' | 'fold'): void {
    if (!canAct || !myTurn || !allows(name)) return;
    sound.play('chip');
    send(name, null);
  }
</script>

{#snippet face(card: number)}
  <span class="pc-rank">{rankLabel(cardRank(card))}</span>
  <span class="pc-suit">{SUIT_LABELS[cardSuit(card)]}</span>
{/snippet}

{#snippet back()}
  <span class="pcard back" aria-hidden="true"></span>
{/snippet}

{#snippet empty()}
  <span class="pcard empty" aria-hidden="true"></span>
{/snippet}

{#snippet seatTile(seat: Seat)}
  {@const revealed = revealedCards(seat)}
  {@const row = resultOf(seat.id)}
  {@const crowned = row !== null && row.net > 0 && row.net === (winners[0]?.net ?? 0)}
  <article
    class="seat"
    class:turn={turnSeat === seat.id}
    class:me={seat.id === you}
    class:out={seat.status === 'folded'}
    class:crowned={crowned}
    class:toss={seat.status === 'folded' && revealed === null}
  >
    {#if crowned}
      <span class="spot" aria-hidden="true"></span>
      <span class="crown" aria-hidden="true">♛</span>
    {/if}
    <div class="seat-top">
      <Avatar id={seat.id} size={compact ? 18 : 22} label={seat.id === you ? 'You' : nameOf(seat.id)} />
      <strong class="seat-name">{nameOf(seat.id)}{#if seat.id === you}<span class="text-gold"> · you</span>{/if}</strong>
      {#if buttonSeat === seat.id}{#key buttonSeat}<span class="dealer" title="Dealer button">D</span>{/key}{/if}
      {#if turnSeat === seat.id && phase !== 'results'}<span class="turn-sec">{seconds}s</span>{/if}
      {#if row !== null}<span class="net" class:win={row.net > 0}>{netLabel(row.net)}</span>{/if}
    </div>
    <div class="cards-mini" aria-hidden="true">
      {#if revealed !== null}
        {#each revealed as card, index (index)}
          <span class="pcard" class:red={isRed(card)}>{@render face(card)}</span>
        {/each}
      {:else}
        {#each Array.from({ length: seat.cardCount }) as _, index (index)}{@render back()}{/each}
      {/if}
    </div>
    <div class="seat-meta">
      {#if seat.status === 'folded'}
        <span class="tag">folded</span>
      {:else if seat.status === 'allin'}
        <span class="tag allin">all in</span>
      {:else}
        <span>in for {money(seat.contributed)}</span>
      {/if}
      {#if revealed !== null}
        <span class="hand-name">{categoryOf(revealed)}</span>
      {/if}
    </div>
  </article>
{/snippet}

{#if poker === null}
  <div class="stub-card" data-table="poker">
    <h3 class="m-0 font-display text-[28px] leading-none tracking-[0.05em] text-sky">Poker</h3>
    <p class="m-0 text-[13px] text-muted">The dealer is still shuffling the deck.</p>
  </div>
{:else}
  <div class="room flex h-full min-h-0 min-w-0 flex-col gap-2" data-table="poker">
    {#if table !== null}
      <section class="felt table-felt relative flex min-h-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="eyebrow">Shared draw table</span>
          <span class="badge shared">{table.seats.length}/{POKER_SEATS}</span>
          <span class="ml-auto text-[11.5px] font-semibold tracking-wide text-muted">{phaseLabel}</span>
        </div>

        <div class="bar" class:danger>
          <span style:width="{barPercent}%"></span>
        </div>

        <div class="table-oval" bind:clientWidth={ovalW} bind:clientHeight={ovalH}>
          <div class="oval" aria-hidden="true"></div>
          <div class="seat-ring">
            <div class="seat-row top">
              {#each seatRows.top as seat (seat.id)}{@render seatTile(seat)}{/each}
            </div>

            <div class="pot-core">
              {#key table.pot}
                <strong class="pot-num font-display text-[clamp(22px,4.6vw,30px)] leading-none text-gold tabular-nums">{money(table.pot)}</strong>
              {/key}
              {#key table.currentBet}
                {#if table.currentBet > 0 && phase !== 'results'}
                  <span class="pot-ring" aria-hidden="true"></span>
                {/if}
              {/key}
              <span class="text-[11.5px] text-muted">
                {#if betting}
                  ante {money(limits.ante)} · to call {money(table.currentBet)} · raises {table.raises}/{limits.maxRaises}
                {:else if phase === 'draw'}
                  discard what you don't hold
                {:else if phase === 'results'}
                  {#if winners.length > 0}
                    {#each winners as winner, index (winner.id)}{index > 0 ? ' & ' : ''}{nameOf(winner.id)}{/each} take{#if winners.length === 1}s{/if} {money(winners[0]!.net)}
                  {:else}
                    the pot returns
                  {/if}
                {:else}
                  ante {money(limits.ante)} to be dealt in
                {/if}
              </span>
            </div>

            <div class="seat-row bottom">
              {#each seatRows.bottom as seat (seat.id)}{@render seatTile(seat)}{/each}
            </div>
          </div>

          <div class="fx-layer" aria-hidden="true">
            {#each chips as chip (chip.id)}
              <span
                class="chip-fly chip-tone-{chip.tone}"
                style:--dx="{chip.dx}px"
                style:--dy="{chip.dy}px"
                style:animation-delay="{chip.delay}s"
                onanimationend={() => dropChip(chip.id)}
              ></span>
            {/each}
            {#if burstCount > 0}
              {#each burstCoins(burstCount) as coin, index (index)}
                <span
                  class="burst-coin"
                  style:--dx="{coin.dx}px"
                  style:--dy="{coin.dy}px"
                  style:animation-delay="{coin.delay}s"
                ></span>
              {/each}
            {/if}
          </div>
        </div>

        {#if tension > 0 && !reduceMotion}
          {#key tension}<div class="tension" aria-hidden="true"></div>{/key}
        {/if}
      </section>
    {/if}

    {#if own !== null && phase !== 'results'}
      <section class="panel own-panel shrink-0" class:turn={myTurn}>
        <div class="flex flex-wrap items-center gap-2">
          <span class="eyebrow">Your hand</span>
          <span class="badge" class:alert={myTurn}>{categoryOf(own.cards)}</span>
          {#if own.allin}
            <span class="badge alert">all in</span>
          {:else if own.folded}
            <span class="badge">folded</span>
          {/if}
          {#if myTurn && betting}
            <span class="ml-auto text-[12px] font-semibold text-gold">your move · {seconds}s</span>
          {/if}
        </div>
        <div class="stage">
          <div class="cards-big">
            {#each own.cards as card, index (card)}
              {#if phase === 'draw' && !own.folded && !own.allin && !own.drawn && canAct && allows('draw')}
                <button
                  type="button"
                  class="pcard"
                  class:red={isRed(card)}
                  class:held={holds[index]}
                  aria-pressed={holds[index]}
                  aria-label={`${rankLabel(cardRank(card))} ${SUIT_LABELS[cardSuit(card)]}${holds[index] ? ' held' : ''}`}
                  onclick={() => toggleHold(index)}
                >
                  {@render face(card)}
                  {#if holds[index]}<span class="pc-tag">HOLD</span>{/if}
                </button>
              {:else}
                <span class="pcard" class:red={isRed(card)}>{@render face(card)}</span>
              {/if}
            {/each}
          </div>
          {#if toss.some(item => item.machine === 'own')}
            <div class="toss-layer" aria-hidden="true">
              {#each toss as item (item.id)}
                {#if item.machine === 'own'}
                  <span
                    class="pcard toss-card"
                    class:red={isRed(item.card)}
                    style:left="{item.left}%"
                    onanimationend={() => dropToss(item.id)}
                  >{@render face(item.card)}</span>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        <p class="m-0 text-[12.5px] text-muted">
          {#if own.folded}
            Folded — your chips stay in the pot.
          {:else if own.allin}
            All in for {money(own.contributed)} — cards stay face up to you.
          {:else if phase === 'draw'}
            {own.drawn ? 'Cards locked in — waiting for the table.' : 'Tap cards to hold, then confirm your draw in the dock.'}
          {:else if myTurn}
            Your move — check, call, raise, or fold in the dock.
          {:else}
            Waiting for {turnName ?? 'the table'} to act.
          {/if}
        </p>
      </section>
    {/if}

    {#if table !== null && own === null && phase !== 'results'}
      <p class="note shrink-0">
        Sitting out this hand.
        {bankroll < limits.ante ? `You need ${money(limits.ante)} to ante into the next one.` : 'You hold a seat and get dealt into the next hand.'}
      </p>
    {/if}

    {#if showVideo}
      <section class="felt video relative flex min-h-0 flex-col gap-2 {table === null ? 'flex-1' : 'shrink-0'}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="eyebrow">Video poker</span>
          <span class="badge" class:shared={mode === 'shared'}>{mode}</span>
          {#if video !== null}<span class="ml-auto text-[12px] font-semibold text-sky">{money(video.coins)} credit{video.coins === 1 ? '' : 's'} in</span>{/if}
        </div>

        <div class="video-stage">
          <div class="grid w-full justify-items-center gap-3">
            <div class="stage">
              <div class="cards-big">
                {#if video !== null}
                  {#each video.cards as card, index (card)}
                    {#if canAct && allows('draw')}
                      <button
                        type="button"
                        class="pcard"
                        class:red={isRed(card)}
                        class:held={holds[index]}
                        aria-pressed={holds[index]}
                        aria-label={`${rankLabel(cardRank(card))} ${SUIT_LABELS[cardSuit(card)]}${holds[index] ? ' held' : ''}`}
                        onclick={() => toggleHold(index)}
                      >
                        {@render face(card)}
                        {#if holds[index]}<span class="pc-tag">HOLD</span>{/if}
                      </button>
                    {:else}
                      <span class="pcard" class:red={isRed(card)}>{@render face(card)}</span>
                    {/if}
                  {/each}
                {:else}
                  {#each COIN_VALUES as slot (slot)}{@render empty()}{/each}
                {/if}
              </div>
              {#if toss.some(item => item.machine === 'video')}
                <div class="toss-layer" aria-hidden="true">
                  {#each toss as item (item.id)}
                    {#if item.machine === 'video'}
                      <span
                        class="pcard toss-card"
                        class:red={isRed(item.card)}
                        style:left="{item.left}%"
                        onanimationend={() => dropToss(item.id)}
                      >{@render face(item.card)}</span>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>

            {#if videoHand !== null}
              <p class="m-0 text-[13px] text-muted">
                Standing on <strong class="text-fog">{videoHand.name}</strong> — pays <strong class="text-mint">{money(videoHand.win)}</strong>
              </p>
            {:else if outcome !== null}
              <p class="outcome m-0" class:win={outcome.net > 0}>
                <strong>{outcome.name}</strong> — paid {money(outcome.win)} ({netLabel(outcome.net)})
              </p>
            {:else}
              <p class="m-0 text-center text-[13px] text-muted">
                Five cards, one draw, private to you. Jacks or better pays.
                {#if view.vault !== null}
                  <span class="text-muted/80">Run: {view.vault.rounds} rounds · best win {money(view.vault.biggestWin)}</span>
                {/if}
              </p>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <div class="dock mt-auto">
      {#if video !== null}
        {#if canAct && allows('draw')}
          <p class="m-0 text-[12px] text-muted">Tap cards to hold, then draw the rest.</p>
          <button type="button" class="btn btn-primary" onclick={drawVideo}>Draw cards</button>
        {:else}
          <p class="m-0 text-[12px] text-muted">Your draw is resolving…</p>
        {/if}
      {:else if own !== null && phase === 'draw'}
        {#if !own.drawn && !own.folded && !own.allin && canAct && allows('draw')}
          <p class="m-0 text-[12px] text-muted">Tap cards to hold, then confirm.</p>
          <button type="button" class="btn btn-primary" onclick={drawShared}>Confirm · {seconds}s left</button>
        {:else}
          <p class="m-0 text-[12px] text-muted">
            {own.folded ? 'Folded — waiting for the table.' : 'Cards locked — waiting for the table.'}
          </p>
        {/if}
      {:else if own !== null && betting && myTurn}
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class="btn flex-1 basis-[30%]" disabled={!canAct || !allows('check')} onclick={() => bet('check')}>Check</button>
          <button type="button" class="btn flex-1 basis-[30%]" disabled={!canAct || !allows('call')} onclick={() => bet('call')}>Call {money(callAmount)}</button>
          <button type="button" class="btn flex-1 basis-[30%]" disabled={!canRaise} onclick={() => bet('raise')}>Raise {money(limits.bet)}</button>
          <button type="button" class="btn flex-1 basis-[30%]" disabled={!canAct || !allows('fold')} onclick={() => bet('fold')}>Fold</button>
        </div>
      {:else if canDeal}
        <div class="flex flex-wrap items-center gap-1.5">
          {#each COIN_VALUES as value (value)}
            <button
              type="button"
              class="coin"
              class:on={coins === value}
              aria-pressed={coins === value}
              disabled={!canAct || value > bankroll || value > limits.coins}
              onclick={() => selectCoins(value)}
            >{money(value)}</button>
          {/each}
          <button type="button" class="btn btn-primary ml-auto" disabled={coins > bankroll} onclick={dealVideo}>Deal</button>
        </div>
        {#if table !== null}
          <p class="m-0 text-[11.5px] text-muted">Video hands are private — dealing one skips the next shared hand.</p>
        {/if}
      {:else if own !== null && betting}
        <p class="m-0 text-[12px] text-muted">Waiting for {turnName ?? 'the table'} · {seconds}s</p>
      {:else}
        <p class="m-0 text-[12px] text-muted">{canAct ? 'Sit tight — the next hand is being dealt.' : 'Spectating — chips are needed to bet.'}</p>
      {/if}
    </div>
  </div>
{/if}

{#if celebrate && confetti.length > 0}
  <div class="confetti" aria-hidden="true">
    {#each confetti as piece, index (index)}
      <span
        style:--x="{piece.x}px"
        style:--y="{piece.y}px"
        style:--r="{piece.r}deg"
        style:--c={piece.c}
        style:--d="{piece.d}s"
        style:--t="{piece.t}s"
      ></span>
    {/each}
  </div>
{/if}

<style>
  .felt {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--color-sky) 28%, var(--color-edge));
    border-radius: 18px;
    background:
      radial-gradient(420px 200px at 50% 0%, rgba(76, 201, 240, 0.12), transparent 70%),
      radial-gradient(520px 260px at 50% 120%, rgba(35, 224, 190, 0.07), transparent 70%),
      linear-gradient(170deg, #14213a, #0d1424);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 18px 40px -30px rgba(0, 0, 0, 0.9);
  }

  .felt.video {
    border-color: color-mix(in srgb, var(--color-violet) 30%, var(--color-edge));
    min-height: 170px;
  }

  .table-felt {
    min-height: 190px;
  }

  .bar {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--color-sky), var(--color-mint));
    transition: width 0.2s linear;
  }

  .bar.danger span {
    background: var(--color-red);
  }

  .table-oval {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .oval {
    position: absolute;
    inset: 1% 0.5%;
    border: 1px solid color-mix(in srgb, var(--color-sky) 24%, var(--color-edge));
    border-radius: 50%;
    background:
      radial-gradient(60% 55% at 50% 42%, rgba(76, 201, 240, 0.1), transparent 70%),
      radial-gradient(70% 65% at 50% 58%, rgba(35, 224, 190, 0.06), transparent 72%),
      linear-gradient(170deg, #16233d, #0d1424);
    box-shadow: inset 0 0 70px -24px rgba(0, 0, 0, 0.95);
    pointer-events: none;
  }

  .seat-ring {
    position: relative;
    z-index: 2;
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 2px;
    min-width: 0;
  }

  .seat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: 6px;
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    min-width: 0;
  }

  .seat-row.top {
    padding: 0 4%;
  }

  .seat-row.bottom {
    padding: 0 4%;
  }

  .fx-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    overflow: hidden;
    pointer-events: none;
  }

  .seat {
    position: relative;
    display: grid;
    gap: 5px;
    width: 100%;
    max-width: 250px;
    justify-self: center;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--color-edge);
    border-radius: 13px;
    background: rgba(9, 13, 23, 0.55);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .seat.turn {
    border-color: var(--color-gold);
    box-shadow: 0 0 0 1px rgba(244, 201, 93, 0.4), 0 0 24px -8px rgba(244, 201, 93, 0.8);
  }

  .seat.me {
    background: rgba(244, 201, 93, 0.07);
  }

  .seat.out {
    opacity: 0.55;
  }

  .seat.crowned {
    border-color: var(--color-mint);
    box-shadow: 0 0 0 1px rgba(35, 224, 190, 0.4), 0 0 26px -8px rgba(35, 224, 190, 0.9);
  }

  .spot {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    background: radial-gradient(65% 75% at 50% 38%, rgba(35, 224, 190, 0.34), transparent 72%);
    animation: spot-in 0.7s ease-out both;
    pointer-events: none;
  }

  .crown {
    position: absolute;
    top: -11px;
    left: 50%;
    z-index: 3;
    font-size: 17px;
    line-height: 1;
    color: var(--color-gold);
    text-shadow: 0 0 12px rgba(244, 201, 93, 0.95);
    animation: crown-sparkle 1.5s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes spot-in {
    from { opacity: 0; transform: scale(0.85); }
    to { opacity: 1; transform: none; }
  }

  @keyframes crown-sparkle {
    0%, 100% { opacity: 0.85; transform: translateX(-50%) scale(1) rotate(-5deg); }
    50% { opacity: 1; transform: translateX(-50%) scale(1.18) rotate(5deg); }
  }

  .seat-top {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .seat-name {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dealer {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 17px;
    height: 17px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #241a02;
    font: 800 9.5px/1 var(--font-sans);
    animation: dealer-spin 0.65s cubic-bezier(0.2, 1.2, 0.4, 1) both;
  }

  @keyframes dealer-spin {
    from { opacity: 0; transform: rotate(-220deg) scale(0.4); }
    to { opacity: 1; transform: rotate(0deg) scale(1); }
  }

  .turn-sec {
    margin-left: auto;
    font: 800 11px/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    color: var(--color-gold);
  }

  .net {
    margin-left: auto;
    font: 800 11.5px/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    color: var(--color-red);
  }

  .net.win {
    color: var(--color-mint);
  }

  .seat-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    min-height: 16px;
    font-size: 10.5px;
    color: var(--color-muted);
  }

  .hand-name {
    color: var(--color-fog);
    font-weight: 700;
  }

  .tag {
    padding: 1px 6px;
    border: 1px solid var(--color-edge);
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .tag.allin {
    border-color: rgba(255, 57, 91, 0.5);
    color: var(--color-red);
  }

  .pot-core {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 3px;
    width: max-content;
    max-width: 92%;
    margin: 0 auto;
    padding: 6px 16px;
    border: 1px dashed color-mix(in srgb, var(--color-gold) 30%, var(--color-edge));
    border-radius: 14px;
    background: rgba(9, 13, 23, 0.6);
    text-align: center;
  }

  .pot-num {
    display: inline-block;
    animation: pot-pop 0.5s cubic-bezier(0.2, 1.3, 0.4, 1) both;
  }

  @keyframes pot-pop {
    0% { transform: scale(1); }
    35% { transform: scale(1.22) translateY(-2px); }
    65% { transform: scale(0.95) translateY(1px); }
    100% { transform: scale(1); }
  }

  .pot-ring {
    position: absolute;
    inset: -14% -8%;
    border: 1px solid rgba(244, 201, 93, 0.55);
    border-radius: 999px;
    box-shadow: 0 0 26px -4px rgba(244, 201, 93, 0.8);
    animation: ring-burst 0.6s ease-out both;
    pointer-events: none;
  }

  @keyframes ring-burst {
    from { opacity: 0.95; transform: scale(0.7); }
    to { opacity: 0; transform: scale(1.28); }
  }

  .chip-fly {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 13px;
    height: 13px;
    margin: -6.5px 0 0 -6.5px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffe9a8, var(--color-gold));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 0 0 2px rgba(255, 255, 255, 0.32);
    animation: chip-arc 0.62s cubic-bezier(0.25, 0.75, 0.3, 1) both;
  }

  .chip-tone-1 {
    background: linear-gradient(180deg, #ff9bb0, var(--color-red));
  }

  .chip-tone-2 {
    background: linear-gradient(180deg, #9df3e2, var(--color-mint));
  }

  @keyframes chip-arc {
    0% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.55); }
    18% { opacity: 1; }
    55% { transform: translate(calc(var(--dx) * 0.4), calc(var(--dy) * 0.4 - 26px)) scale(1.05); }
    100% { opacity: 0.9; transform: translate(0, 0) scale(0.85); }
  }

  .burst-coin {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 11px;
    height: 11px;
    margin: -5.5px 0 0 -5.5px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff3c9, var(--color-gold) 55%, #8a6410);
    box-shadow: 0 0 9px rgba(244, 201, 93, 0.85);
    animation: coin-burst 1.15s cubic-bezier(0.2, 0.75, 0.3, 1) both;
  }

  @keyframes coin-burst {
    0% { opacity: 0; transform: translate(0, 0) scale(0.2); }
    15% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.9); }
  }

  .tension {
    position: absolute;
    inset: 0;
    z-index: 6;
    border-radius: inherit;
    background: radial-gradient(ellipse at center, transparent 42%, rgba(255, 57, 91, 0.16) 78%, rgba(255, 57, 91, 0.3) 100%);
    animation: tension-flash 1.35s ease-out both;
    pointer-events: none;
  }

  @keyframes tension-flash {
    0% { opacity: 0; }
    18% { opacity: 1; }
    100% { opacity: 0; }
  }

  .video-stage {
    display: grid;
    flex: 1;
    min-height: 0;
    place-items: center;
  }

  .stage {
    position: relative;
    width: 100%;
    max-width: 420px;
    margin: 0 auto;
  }

  .cards-big {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .cards-mini {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 2.5px;
  }

  .pcard {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1px;
    position: relative;
    width: 100%;
    aspect-ratio: 5 / 7;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-edge);
    border-radius: 8px;
    background: linear-gradient(180deg, #1c2746, #101627);
    color: var(--color-fog);
    font: inherit;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    animation: card-flip 0.45s cubic-bezier(0.2, 1, 0.3, 1) both;
  }

  .pcard::after {
    content: '';
    position: absolute;
    inset: -30% -70%;
    background: linear-gradient(100deg, transparent 44%, rgba(255, 255, 255, 0.28) 50%, transparent 56%);
    transform: translateX(-130%) rotate(6deg);
    animation: card-shimmer 0.65s ease-out 0.06s both;
    pointer-events: none;
  }

  @keyframes card-flip {
    0% { opacity: 0; transform: perspective(640px) rotateY(78deg) translateY(-14px) scale(1.06); }
    60% { opacity: 1; }
    100% { opacity: 1; transform: perspective(640px) rotateY(0deg) translateY(0) scale(1); }
  }

  @keyframes card-shimmer {
    from { transform: translateX(-130%) rotate(6deg); }
    to { transform: translateX(130%) rotate(6deg); }
  }

  button.pcard {
    cursor: pointer;
    transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  }

  button.pcard:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: rgba(244, 201, 93, 0.55);
  }

  button.pcard:disabled {
    cursor: default;
  }

  button.pcard:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  .pcard.red {
    color: var(--color-red);
  }

  .pcard.held {
    border-color: var(--color-gold);
    box-shadow: 0 0 0 1px rgba(244, 201, 93, 0.65), 0 0 20px -6px rgba(244, 201, 93, 0.9);
  }

  .cards-big .pcard:nth-child(1) { animation-delay: 0ms; }
  .cards-big .pcard:nth-child(2) { animation-delay: 55ms; }
  .cards-big .pcard:nth-child(3) { animation-delay: 110ms; }
  .cards-big .pcard:nth-child(4) { animation-delay: 165ms; }
  .cards-big .pcard:nth-child(5) { animation-delay: 220ms; }

  .cards-mini .pcard:nth-child(1) { animation-delay: 0ms; }
  .cards-mini .pcard:nth-child(2) { animation-delay: 35ms; }
  .cards-mini .pcard:nth-child(3) { animation-delay: 70ms; }
  .cards-mini .pcard:nth-child(4) { animation-delay: 105ms; }
  .cards-mini .pcard:nth-child(5) { animation-delay: 140ms; }

  .seat-row.top .seat.toss .pcard {
    animation: fold-toss-down 0.55s ease-in both;
  }

  .seat-row.bottom .seat.toss .pcard {
    animation: fold-toss-up 0.55s ease-in both;
  }

  .seat-row .seat.toss .pcard:nth-child(1) { animation-delay: 0ms; }
  .seat-row .seat.toss .pcard:nth-child(2) { animation-delay: 25ms; }
  .seat-row .seat.toss .pcard:nth-child(3) { animation-delay: 50ms; }
  .seat-row .seat.toss .pcard:nth-child(4) { animation-delay: 75ms; }
  .seat-row .seat.toss .pcard:nth-child(5) { animation-delay: 100ms; }

  @keyframes fold-toss-down {
    0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translate(18px, 46px) rotate(46deg) scale(0.72); }
  }

  @keyframes fold-toss-up {
    0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translate(-16px, -42px) rotate(-44deg) scale(0.72); }
  }

  .toss-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }

  .toss-card {
    position: absolute;
    top: 0;
    width: 17.5%;
    animation: discard-toss 0.6s ease-in both;
    pointer-events: none;
  }

  @keyframes discard-toss {
    0% { opacity: 1; transform: translateX(-50%) translateY(0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translateX(-50%) translateY(96px) rotate(42deg) scale(0.68); }
  }

  .pc-rank {
    font-family: var(--font-display);
    line-height: 0.9;
  }

  .pc-suit {
    line-height: 1;
  }

  .cards-big .pc-rank,
  .toss-card .pc-rank {
    font-size: clamp(22px, 8vw, 36px);
  }

  .cards-big .pc-suit,
  .toss-card .pc-suit {
    font-size: clamp(16px, 6vw, 26px);
  }

  .cards-mini .pc-rank {
    font-size: clamp(9px, 2.6vw, 13px);
  }

  .cards-mini .pc-suit {
    font-size: clamp(8px, 2.2vw, 11px);
  }

  .pcard.back {
    background:
      repeating-linear-gradient(45deg, #1d2a4d 0 5px, #131c33 5px 10px);
    border-color: color-mix(in srgb, var(--color-sky) 22%, var(--color-edge));
  }

  .pcard.empty {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-muted) 30%, var(--color-edge));
    background: rgba(9, 13, 23, 0.3);
  }

  .pc-tag {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 2;
    padding: 2px 0;
    background: rgba(244, 201, 93, 0.92);
    color: #241a02;
    font: 800 8.5px/1 var(--font-sans);
    letter-spacing: 0.12em;
    text-align: center;
  }

  .panel.turn {
    border-color: rgba(244, 201, 93, 0.55);
    box-shadow: 0 0 26px -12px rgba(244, 201, 93, 0.9);
  }

  .note {
    margin: 0;
    padding: 8px 11px;
    border: 1px dashed color-mix(in srgb, var(--color-gold) 35%, var(--color-edge));
    border-radius: 13px;
    background: rgba(244, 201, 93, 0.05);
    font-size: 12.5px;
    color: var(--color-muted);
  }

  .outcome {
    padding: 7px 10px;
    border: 1px solid rgba(255, 57, 91, 0.4);
    border-radius: 12px;
    background: rgba(255, 57, 91, 0.08);
    font-size: 13.5px;
    color: #ffd4dc;
    animation: var(--animate-panel);
  }

  .outcome.win {
    border-color: rgba(35, 224, 190, 0.45);
    background: rgba(35, 224, 190, 0.08);
    color: #b8fff0;
  }

  .dock {
    position: sticky;
    bottom: 0;
    z-index: 20;
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
    border: 1px solid var(--color-edge);
    border-radius: 16px;
    background: rgba(9, 13, 23, 0.94);
    box-shadow: 0 -16px 34px -26px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(10px);
  }

  .coin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: linear-gradient(180deg, #202a49, #161d33);
    color: var(--color-fog);
    font: 700 13px/1 var(--font-sans);
    cursor: pointer;
    transition: border-color 0.12s ease, transform 0.12s ease;
  }

  .coin:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(244, 201, 93, 0.5);
  }

  .coin.on {
    border-color: rgba(244, 201, 93, 0.9);
    background: rgba(244, 201, 93, 0.16);
    box-shadow: 0 0 18px -6px rgba(244, 201, 93, 0.8);
  }

  .coin:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .coin:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .felt {
      gap: 5px;
      padding: 8px;
    }

    .table-felt {
      min-height: 150px;
    }

    .felt.video {
      min-height: 140px;
    }

    .seat {
      gap: 3px;
      padding: 4px 6px;
    }

    .seat-name {
      font-size: 11px;
    }

    .seat-meta {
      min-height: 14px;
      font-size: 9.5px;
    }

    .cards-mini {
      width: min(100%, 112px);
      margin: 0 auto;
    }

    .cards-big {
      max-width: 250px;
      margin: 0 auto;
    }

    .cards-big .pc-rank,
    .toss-card .pc-rank {
      font-size: 22px;
    }

    .cards-big .pc-suit,
    .toss-card .pc-suit {
      font-size: 16px;
    }

    .pot-core {
      gap: 2px;
      padding: 3px 12px;
    }

    .stage {
      max-width: 250px;
    }

    .dock {
      gap: 5px;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    }

    .own-panel {
      gap: 6px;
      padding: 8px;
    }
  }
</style>
