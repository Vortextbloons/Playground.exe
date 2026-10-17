<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { FeedItem, TableId } from '../core/types';
  import type { CasinoHost, HostStatus } from '../host/types';
  import { sound } from '../sound';
  import Hud from './Hud.svelte';
  import Floor from './Floor.svelte';
  import Leaderboard from './Leaderboard.svelte';
  import FeedTicker from './FeedTicker.svelte';
  import BailoutOverlay from './BailoutOverlay.svelte';
  import ResultsScreen from './ResultsScreen.svelte';
  import TableShell from './TableShell.svelte';
  import BlackjackTable from './tables/BlackjackTable.svelte';
  import RouletteTable from './tables/RouletteTable.svelte';
  import SlotsBank from './tables/SlotsBank.svelte';
  import PlinkoBoard from './tables/PlinkoBoard.svelte';
  import PokerRoom from './tables/PokerRoom.svelte';

  type Coin = { x: number; d: number; t: number; r: number };
  type Jackpot = { key: number; who: string; amount: number; coins: Coin[] };

  let { host, menu = null, names = {} }: { host: CasinoHost; menu?: HTMLElement | null; names?: Record<string, string> } = $props();

  const TABLE_LABELS: Record<TableId, string> = {
    blackjack: 'Blackjack',
    roulette: 'Roulette',
    slots: 'Slots',
    plinko: 'Plinko',
    poker: 'Poker',
  };

  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const JACKPOT_MS = reduceMotion ? 1600 : 4200;

  let status = $state<HostStatus | null>(null);
  let lobby = $state<HTMLElement | null>(null);
  let menuReady = $state(false);
  let boardOpen = $state(typeof matchMedia === 'function' && matchMedia('(min-width: 761px)').matches);
  let now = $state(Date.now());
  let arrivedAt = Date.now();
  let tickedDeadline = -1;
  let lastPhase: 'playing' | 'results' | null = null;
  let lastSecond = -1;
  let bailoutSeen = false;
  let jackpot = $state<Jackpot | null>(null);
  let jackpotKey = 0;
  let jackpotTimer: ReturnType<typeof setTimeout> | undefined;
  let feedMark = -1;

  const view = $derived(status?.view ?? null);
  const playing = $derived(status?.playing ?? false);
  const connected = $derived(status?.connected ?? true);
  const roster = $derived(status?.names ?? names);
  const partyMode = $derived(menu !== null && menuReady);
  const offered = $derived(view?.vault?.status === 'offered');

  const remaining = $derived.by(() => {
    const current = view;
    if (!current) return 0;
    return Math.max(0, current.deadline - (current.now + (now - arrivedAt)));
  });

  const danger = $derived(view?.phase === 'playing' && remaining <= 60_000);

  const screen = $derived.by(() => {
    const current = view;
    if (!current) return 'Warming up';
    if (current.phase === 'results') return 'Final Results';
    if (current.at === 'floor') return 'Casino Floor';
    return TABLE_LABELS[current.at];
  });

  $effect(() => {
    const stop = host.subscribe(next => {
      arrivedAt = Date.now();
      status = next;
    });
    return stop;
  });

  $effect(() => {
    const id = window.setInterval(() => {
      now = Date.now();
    }, 250);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!menu) return;
    const target = lobby;
    if (target && menu.parentElement !== target) target.append(menu);
  });

  $effect(() => {
    if (!menu) {
      menuReady = false;
      return;
    }
    const sync = () => {
      menuReady = !menu.hidden;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(menu, { attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  });

  $effect(() => {
    const current = view;
    if (!current || !playing || current.phase !== 'playing') return;
    if (remaining > 0 || tickedDeadline === current.deadline) return;
    if (host.send('tick', null)) tickedDeadline = current.deadline;
  });

  $effect(() => {
    const current = view;
    if (!current) return;
    if (current.phase === 'results' && lastPhase === 'playing') {
      sound.play(current.you !== null && current.results?.[0]?.id === current.you ? 'jackpot' : 'lose');
    }
    lastPhase = current.phase;
  });

  $effect(() => {
    if (!offered) {
      bailoutSeen = false;
      return;
    }
    if (!bailoutSeen) {
      bailoutSeen = true;
      sound.play('chip');
    }
  });

  $effect(() => {
    const current = view;
    if (!current || !playing || current.phase !== 'playing' || remaining <= 0) {
      lastSecond = -1;
      return;
    }
    const second = Math.ceil(remaining / 1000);
    if (second <= 5 && second !== lastSecond) {
      lastSecond = second;
      sound.play('tick');
    }
  });

  $effect(() => {
    const current = view;
    if (!current) return;
    const items = current.feed;
    if (feedMark < 0) {
      feedMark = 0;
      for (const item of items) feedMark = Math.max(feedMark, item.id);
      return;
    }
    let latest: FeedItem | null = null;
    let highest = feedMark;
    for (const item of items) {
      if (item.id > highest) {
        highest = item.id;
        if (item.kind === 'jackpot') latest = item;
      }
    }
    feedMark = highest;
    if (!latest) return;
    jackpotKey += 1;
    jackpot = {
      key: jackpotKey,
      who: latest.playerId === null ? 'The house' : roster[latest.playerId] ?? 'A player',
      amount: latest.amount,
      coins: reduceMotion ? [] : makeCoins(),
    };
    sound.play('jackpot');
    clearTimeout(jackpotTimer);
    jackpotTimer = setTimeout(() => {
      jackpot = null;
    }, JACKPOT_MS);
  });

  $effect(() => () => clearTimeout(jackpotTimer));

  function makeCoins(): Coin[] {
    return Array.from({ length: 26 }, () => ({
      x: +(Math.random() * 100).toFixed(1),
      d: +(Math.random() * 1.6).toFixed(2),
      t: +(2.2 + Math.random() * 2).toFixed(2),
      r: Math.round((Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)),
    }));
  }

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function unlock(): void {
    sound.unlock();
  }

  function send(action: string, payload: Json): void {
    host.send(action, payload);
  }

  function backToFloor(): void {
    send('sit', { at: 'floor' });
  }

  function decideBailout(accept: boolean): void {
    send('bailout', { accept });
  }
</script>

<svelte:window onpointerdown={unlock} onkeydown={unlock} />

<div class="shell h-full min-h-0">
  <div class="backdrop" class:hot={danger} aria-hidden="true"></div>

  {#if view}
    <div class="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div class="grid">
        <Hud
          {view}
          {screen}
          {remaining}
          rail={view.phase === 'playing'}
          {boardOpen}
          ontoggle={() => (boardOpen = !boardOpen)}
        />
        {#if !connected}
          <p class="m-0 bg-red/15 px-3 py-1.5 text-center text-[12px] font-semibold tracking-[0.08em] text-red" role="status">
            Reconnecting…
          </p>
        {/if}
      </div>
      <div class="body-grid min-h-0" class:with-rail={view.phase === 'playing'}>
        <main class="scroll-y relative min-h-0 overflow-x-hidden overflow-y-auto">
          {#if view.phase === 'results'}
            <ResultsScreen {view} names={roster} {send} party={partyMode} />
          {:else if view.at === 'blackjack' && view.table !== null}
            <TableShell title="Blackjack" watching={!playing} reconnecting={!connected} onback={backToFloor}>
              <BlackjackTable detail={view.table} {view} names={roster} {send} />
            </TableShell>
          {:else if view.at === 'roulette' && view.table !== null}
            <TableShell title="Roulette" watching={!playing} reconnecting={!connected} onback={backToFloor}>
              <RouletteTable detail={view.table} {view} names={roster} {send} />
            </TableShell>
          {:else if view.at === 'slots' && view.table !== null}
            <TableShell title="Slots" watching={!playing} reconnecting={!connected} onback={backToFloor}>
              <SlotsBank detail={view.table} {view} names={roster} {send} />
            </TableShell>
          {:else if view.at === 'plinko' && view.table !== null}
            <TableShell title="Plinko" watching={!playing} reconnecting={!connected} onback={backToFloor}>
              <PlinkoBoard detail={view.table} {view} names={roster} {send} />
            </TableShell>
          {:else if view.at === 'poker' && view.table !== null}
            <TableShell title="Poker" watching={!playing} reconnecting={!connected} onback={backToFloor}>
              <PokerRoom detail={view.table} {view} names={roster} {send} />
            </TableShell>
          {:else}
            <Floor {view} names={roster} {send} {remaining} {playing} {connected} />
          {/if}
          {#if menu}
            <section class="lobby-panel" hidden={!menuReady} bind:this={lobby} aria-label="Party lobby">
              <p class="eyebrow">Party lobby</p>
            </section>
          {/if}
        </main>
        {#if view.phase === 'playing'}
          <aside class="rail scroll-y" class:open={boardOpen} aria-label="Standings and floor feed">
            <button type="button" class="btn min-[761px]:hidden" onclick={() => (boardOpen = false)}>Hide panels</button>
            <Leaderboard {view} names={roster} />
            <FeedTicker {view} names={roster} />
          </aside>
        {/if}
      </div>
    </div>
  {:else}
    <div class="relative z-10 grid h-full place-items-center">
      <p class="animate-title font-display text-[30px] tracking-[0.12em] text-gold">ALL IN!</p>
    </div>
  {/if}

  {#if jackpot !== null}
    {#key jackpot.key}
      <div class="jackpot" class:calm={reduceMotion} role="status" aria-live="polite">
        {#if !reduceMotion}
          <div class="jackpot-sweep" aria-hidden="true"></div>
          <div class="jackpot-coins" aria-hidden="true">
            {#each jackpot.coins as coin, index (index)}
              <span style:--x="{coin.x}%" style:--d="{coin.d}s" style:--t="{coin.t}s" style:--r="{coin.r}deg"></span>
            {/each}
          </div>
        {/if}
        <div class="jackpot-word">
          <strong>JACKPOT</strong>
          <span>{jackpot.who} · {money(jackpot.amount)}</span>
        </div>
      </div>
    {/key}
  {/if}

  {#if offered}
    <BailoutOverlay ondecide={decideBailout} />
  {/if}
</div>
