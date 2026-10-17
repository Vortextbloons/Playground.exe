<script lang="ts">
  import type { SessionView } from '@playground-exe/game-kit/multiplayer';
  import { TURN_MS, WEALTH_TARGET } from './rules/board';
  import { applyAction, newMatch, toView, type MonoAction, type MonoActionPayloads, type MonoState, type MonoView } from './rules/engine';
  import { mulberry32 } from './rules/rng';
  import { actorFor, botMove } from './bots/bots';
  import { sound } from './sound';
  import ActionBar from './components/ActionBar.svelte';
  import AuctionModal from './components/AuctionModal.svelte';
  import Board from './components/Board.svelte';
  import CardModal from './components/CardModal.svelte';
  import DeedCard from './components/DeedCard.svelte';
  import EventLog from './components/EventLog.svelte';
  import PlayerPanel from './components/PlayerPanel.svelte';
  import ResultsScreen from './components/ResultsScreen.svelte';
  import SoloSetup from './components/SoloSetup.svelte';
  import TradeModal from './components/TradeModal.svelte';

  interface Props {
    session?: {
      subscribe(listener: (view: SessionView<MonoView>) => void): () => void;
      send(action: keyof MonoActionPayloads, payload: MonoActionPayloads[keyof MonoActionPayloads]): boolean;
      onError(listener: (message: string) => void): () => void;
    } | null;
    menuElement?: HTMLElement | null;
  }

  let { session = null, menuElement = null }: Props = $props();

  let soundOn = $state(true);
  let showSettings = $state(false);

  let local = $state<MonoState | null>(null);
  let soloRng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  const BOT_NAMES = ['ada', 'rex', 'mia', 'sol', 'nia'] as const;
  let names = $state<Record<string, string>>({});

  let mpView = $state<MonoView | null>(null);
  let mpConnected = $state(true);
  let mpInMatch = $state(false);
  let mpSelected = $state(false);
  let lobbyHost = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!menuElement) return;
    const host = lobbyHost;
    if (host && menuElement.parentElement !== host) host.append(menuElement);
  });

  $effect(() => {
    if (!session) return;
    const offState = session.subscribe(next => {
      mpConnected = next.connected;
      mpInMatch = next.match !== null;
      mpSelected = next.party?.selection?.gameId === 'monopoly';
      const nextView = next.match?.state ?? null;
      observe(mpView, nextView);
      mpView = nextView;
      if (next.match) {
        const roster: Record<string, string> = {};
        for (const player of next.party?.players ?? []) roster[player.id] = player.nickname;
        names = roster;
      }
    });
    const offError = session.onError(message => {
      showBanner(message);
    });
    return () => { offState(); offError(); };
  });

  const inMatch = $derived(local !== null || mpInMatch);
  const view = $derived(mpInMatch ? mpView : local === null ? null : toView(local, 'you'));
  const isSpectator = $derived(view !== null && view.you === null);
  const busy = false;

  function nameOf(playerId: string): string {
    return names[playerId] ?? playerId;
  }

  function bannerFor(playerId: string, text: string): string {
    const name = nameOf(playerId);
    if (name !== 'You') return `${name} ${text}`;
    const first = /^\w+/.exec(text)?.[0] ?? '';
    const irregular: Record<string, string> = { is: 'are', goes: 'go', does: 'do', has: 'have', was: 'were' };
    let base = irregular[first] ?? first;
    if (base === first) {
      if (first.endsWith('es') && /(s|x|z|ch|sh|o)$/.test(first.slice(0, -2))) base = first.slice(0, -2);
      else if (first.endsWith('s')) base = first.slice(0, -1);
    }
    return `${name} ${base}${text.slice(first.length)}`;
  }

  function dispatch(action: MonoAction, actor = 'you'): void {
    sound.unlock();
    if (mpInMatch) {
      session?.send(action.type, payloadOf(action));
      return;
    }
    if (!local) return;
    const next = applyAction($state.snapshot(local), actor, action, soloRng);
    observe(toView(local, 'you'), toView(next, 'you'));
    local = next;
    scheduleBot();
  }

  function payloadOf(action: MonoAction): MonoActionPayloads[keyof MonoActionPayloads] {
    switch (action.type) {
      case 'bid': return { amount: action.amount };
      case 'build': case 'sell': case 'mortgage': case 'unmortgage': return { space: action.space };
      case 'propose-trade': {
        const payload: MonoActionPayloads['propose-trade'] = {
          to: action.to,
          cash: action.cash,
          properties: action.properties,
          wantCash: action.wantCash,
          wantProperties: action.wantProperties,
        };
        return payload;
      }
      default: return null;
    }
  }

  let botTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleBot(): void {
    clearTimeout(botTimer);
    botTimer = undefined;
    if (mpInMatch || !local || local.phase === 'results') return;
    const actor = actorFor(local);
    if (actor === 'you') return;
    const thinking = 620 + Math.random() * 760;
    botTimer = setTimeout(() => {
      if (!local || mpInMatch) return;
      if (actorFor(local) !== actor) return;
      const move = botMove(local, actor, soloRng);
      if (move) dispatch(move, actor);
    }, thinking);
  }

  $effect(() => {
    if (local && !mpInMatch) scheduleBot();
    return () => clearTimeout(botTimer);
  });

  let banner = $state<{ text: string; key: number } | null>(null);
  let bannerKey = 0;

  function showBanner(text: string): void {
    bannerKey += 1;
    banner = { text, key: bannerKey };
  }

  let lastRollKey = '';
  let lastCardId = -1;
  let jailers: string[] = [];

  function observe(prev: MonoView | null, next: MonoView | null): void {
    if (!prev || !next) return;
    const rollKey = next.lastRoll ? next.lastRoll.join('-') : '';
    if (rollKey !== lastRollKey) {
      if (rollKey !== '') sound.play('dice');
      lastRollKey = rollKey;
    }
    const cardId = next.drawnCard ? next.drawnCard.id : -1;
    if (cardId !== lastCardId && cardId !== -1) sound.play('card');
    lastCardId = cardId;
    const jailed = next.order.filter(id => next.players[id]?.inJail && !prev.players[id]?.inJail);
    for (const id of jailed) {
      if (!jailers.includes(id)) {
        jailers.push(id);
        sound.play('jail');
        showBanner(bannerFor(id, 'goes to jail!'));
      }
    }
    jailers = jailers.filter(id => next.players[id]?.inJail);
    if (Object.keys(next.owners).length > Object.keys(prev.owners).length) sound.play('buy');
    const houseSum = (v: MonoView): number => Object.values(v.houses).reduce((total, count) => total + count, 0);
    if (houseSum(next) > houseSum(prev)) sound.play('build');
    if (next.phase === 'auction' && prev.phase !== 'auction') {
      sound.play('gavel');
      showBanner('Auction!');
    }
    if (next.phase === 'debt' && prev.phase !== 'debt') sound.play('pay');
    if (next.phase === 'results' && prev.phase !== 'results') {
      sound.play(next.winners.includes(next.you ?? '') ? 'win' : 'lose');
    }
    if (next.trade && !prev.trade) showBanner(bannerFor(next.trade.from, 'proposes a trade'));
  }

  let now = $state(Date.now());
  let lastTimeoutStamp = -1;

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const timerLeft = $derived.by(() => {
    if (!view || view.phase === 'results' || !mpInMatch) return null;
    return Math.max(0, TURN_MS - (now - view.turnStartedAt));
  });

  $effect(() => {
    if (timerLeft !== null && timerLeft <= 0 && view) {
      const stamp = view.turnStartedAt;
      if (lastTimeoutStamp !== stamp) {
        lastTimeoutStamp = stamp;
        if (view.phase === 'auction' && view.auction) dispatch({ type: 'timeout' }, view.auction.turn);
        else dispatch({ type: 'timeout' }, view.turn);
      }
    }
  });

  let selected = $state<number | null>(null);
  let showTrade = $state(false);

  function select(space: number): void {
    selected = selected === space ? null : space;
  }

  function startSolo(bots: number): void {
    soloRng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const botIds = BOT_NAMES.slice(0, bots).map((_, i) => `bot${i}`);
    names = { you: 'You', ...Object.fromEntries(botIds.map((id, i) => [id, BOT_NAMES[i] ?? `Bot ${i}`])) };
    lastRollKey = '';
    lastCardId = -1;
    jailers = [];
    lastTimeoutStamp = -1;
    local = newMatch(['you', ...botIds], soloRng(), { target: WEALTH_TARGET });
    sound.unlock();
    sound.play('turn');
    showBanner(bannerFor(local.turn, 'rolls first'));
    scheduleBot();
  }

  function backToMenu(): void {
    clearTimeout(botTimer);
    local = null;
    selected = null;
  }
</script>

<div class="city-app">
  {#if !inMatch}
    <section class="city-menu">
      <div class="solo-host">
        <SoloSetup onstart={startSolo} />
      </div>
      {#if session && mpSelected}
        <div class="lobby-host" bind:this={lobbyHost}></div>
      {/if}
    </section>
  {:else if view}
    <header class="city-topbar">
      <div class="brand-chip">Monopoly</div>
      <div class={['turn-strip', { 'is-mine': view.you !== null && view.turn === view.you }]}>
        {#if view.phase === 'results'}
          Match over
        {:else}
          {nameOf(view.turn)}'s turn
        {/if}
      </div>
      {#if timerLeft !== null}
        <div class={['timer-pill', { 'is-urgent': timerLeft < 20000 }]}>{Math.ceil(timerLeft / 1000)}s</div>
      {/if}
      {#if session && mpInMatch}
        <div class={['net-chip', { off: !mpConnected }]} title={mpConnected ? 'Connected' : 'Reconnecting…'}>
          {mpConnected ? 'online' : 'reconnecting'}
        </div>
      {/if}
      <button type="button" class="gear" onclick={() => (showSettings = !showSettings)} aria-label="Settings">
        <span aria-hidden="true">gear</span>
      </button>
    </header>

    <section class="city-stage">
      <Board {view} {names} {selected} onselect={select} />
      {#if banner}
        {#key banner.key}
          <div class="banner">{banner.text}</div>
        {/key}
      {/if}
    </section>

    <aside class="city-side">
      <PlayerPanel {view} {names} {selected} onselect={select} />
      <EventLog {view} {names} />
    </aside>

    <div class="city-dock">
      <ActionBar {view} {names} {busy} ondispatch={dispatch} ontrade={() => (showTrade = true)} />
    </div>

    {#if isSpectator}
      <div class="spectate-note">Spectating this match</div>
    {/if}

    {#if view.auction}
      <AuctionModal {view} {names} {busy} ondispatch={dispatch} />
    {:else if showTrade}
      <TradeModal {view} {names} {busy} ondispatch={dispatch} onclose={() => (showTrade = false)} />
    {/if}

    {#if selected !== null}
      <DeedCard {view} {names} spaceId={selected} ondispatch={dispatch} onclose={() => (selected = null)} />
    {/if}

    {#if view.drawnCard}
      <CardModal card={view.drawnCard} />
    {/if}

    {#if view.phase === 'results'}
      <ResultsScreen {view} {names} onrestart={mpInMatch ? null : () => startSolo(Object.keys(names).length - 1)} />
    {/if}

    {#if showSettings}
      <div class="modal settings-modal">
        <h2>Settings</h2>
        <label><input type="checkbox" bind:checked={soundOn} onchange={() => sound.setEnabled(soundOn)} /> Sounds</label>
        <button type="button" class="btn btn--ghost" onclick={() => (showSettings = false)}>Close</button>
      </div>
    {/if}
  {/if}
</div>