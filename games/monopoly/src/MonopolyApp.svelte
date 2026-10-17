<script lang="ts">
  import { untrack } from 'svelte';
  import type { SessionView } from '@playground-exe/game-kit/multiplayer';
  import { GROUP_COLORS, SPACES, TURN_MS } from './rules/board';
  import { applyAction, newMatch, toView, type EndConditions, type MonoAction, type MonoActionPayloads, type MonoState, type MonoView } from './rules/engine';
  import { mulberry32 } from './rules/rng';
  import { actorFor, botMove } from './bots/bots';
  import { sound } from './sound';
  import ActionBar from './components/ActionBar.svelte';
  import AuctionModal from './components/AuctionModal.svelte';
  import Board from './components/Board.svelte';
  import CardModal from './components/CardModal.svelte';
  import DeedCard from './components/DeedCard.svelte';
  import DiceTray from './components/DiceTray.svelte';
  import EventLog from './components/EventLog.svelte';
  import EndConditionsForm from './components/EndConditions.svelte';
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
  const preview = toView(newMatch(['you', 'rival'], 42), 'you');
  let soloConditions: EndConditions = { bankruptcy: true, target: null, timeLimitMs: null };
  let names = $state<Record<string, string>>({});

  let mpView = $state<MonoView | null>(null);
  let mpConnected = $state(true);
  let mpInMatch = $state(false);
  let mpSelected = $state(false);
  let inParty = $state(false);
  let lobbyHost = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!menuElement) return;
    const host = lobbyHost;
    if (host && menuElement.parentElement !== host) host.append(menuElement);
  });

  $effect(() => {
    if (!session) return;
    const offState = session.subscribe(next => untrack(() => {
      inParty = next.party !== null;
      if (inParty) { local = null; clearTimeout(botTimer); }
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
    }));
    const offError = session.onError(message => {
      showBanner(message);
    });
    return () => { offState(); offError(); };
  });

  const inMatch = $derived(local !== null || mpInMatch);
  const view = $derived(mpInMatch ? mpView : local === null ? null : toView(local, 'you'));
  const isSpectator = $derived(view !== null && view.you === null);
  let diceRoll = $state<{ roll: [number, number]; player: string; key: number } | null>(null);
  let rollKey = 0;
  let traveling = $state(false);
  const busy = $derived(diceRoll !== null || traveling);
  let propertyFeedback = $state<{ space: number; player: string; label: string; key: number } | null>(null);
  let cashPulse = $state<{ changes: Record<string, number>; key: number } | null>(null);
  let feedbackKey = 0;

  $effect(() => {
    if (!propertyFeedback || diceRoll) return;
    const timer = setTimeout(() => (propertyFeedback = null), 2600);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!cashPulse || diceRoll) return;
    const timer = setTimeout(() => (cashPulse = null), 1800);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!diceRoll) return;
    const timer = setTimeout(() => (diceRoll = null), 2100);
    return () => clearTimeout(timer);
  });

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
    const next = applyAction($state.snapshot(local), actor, action, soloRng, Date.now());
    observe(toView(local, 'you'), toView(next, 'you'));
    local = next;
    scheduleBot();
  }

  function payloadOf(action: MonoAction): MonoActionPayloads[keyof MonoActionPayloads] {
    switch (action.type) {
      case 'configure': return action.conditions;
      case 'bid': return { amount: action.amount };
      case 'sell': return { space: action.space, all: action.all ?? false };
      case 'build': case 'mortgage': case 'unmortgage': return { space: action.space };
      case 'propose-trade': {
        const payload: MonoActionPayloads['propose-trade'] = {
          to: action.to,
          cash: action.cash,
          properties: [...action.properties],
          wantCash: action.wantCash,
          wantProperties: [...action.wantProperties],
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
    if (mpInMatch || !local || local.phase === 'results' || busy) return;
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

  let lastCardId = -1;
  let cardDismissed = $state(false);
  let jailers: string[] = [];

  function observe(prev: MonoView | null, next: MonoView | null): void {
    if (!prev || !next) return;
    if (prev.phase === 'preroll' && next.lastRoll && (
      prev.lastRoll === null || next.phase !== 'preroll' || next.doubles !== prev.doubles ||
      next.players[prev.turn]?.jailTurns !== prev.players[prev.turn]?.jailTurns
    )) {
      rollKey += 1;
      propertyFeedback = null;
      cashPulse = null;
      diceRoll = { roll: [...next.lastRoll], player: nameOf(prev.turn), key: rollKey };
      sound.play('dice');
    }
    const cardId = next.drawnCard ? next.drawnCard.id : -1;
    if (cardId !== lastCardId && cardId !== -1) {
      sound.play('card');
      cardDismissed = false;
    }
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
    const acquired = SPACES.find(space => next.owners[space.id] && next.owners[space.id] !== prev.owners[space.id]);
    const developed = SPACES.find(space => next.owners[space.id] && next.owners[space.id] === prev.owners[space.id] && next.houses[space.id] !== prev.houses[space.id]);
    const mortgaged = SPACES.find(space => next.owners[space.id] && next.owners[space.id] === prev.owners[space.id] && next.mortgages[space.id] !== prev.mortgages[space.id]);
    if (acquired || developed || mortgaged) {
      const space = (acquired ?? developed ?? mortgaged)!;
      const houses = next.houses[space.id] ?? 0;
      const built = houses > (prev.houses[space.id] ?? 0);
      const label = acquired ? (prev.owners[space.id] ? 'Property traded' : 'Property acquired')
        : developed ? (built ? (houses === 5 ? 'Hotel opened' : 'House built') : 'Building sold')
        : next.mortgages[space.id] ? 'Property mortgaged' : 'Mortgage paid off';
      feedbackKey += 1;
      propertyFeedback = { space: space.id, player: nameOf(next.owners[space.id] ?? prev.owners[space.id] ?? prev.turn), label, key: feedbackKey };
      if (acquired) sound.play('buy');
      else if (built) sound.play('build');
    }
    const changes: Record<string, number> = {};
    for (const id of next.order) {
      const before = prev.players[id];
      const after = next.players[id];
      if (before && after && before.cash !== after.cash) changes[id] = after.cash - before.cash;
    }
    if (Object.keys(changes).length > 0) {
      feedbackKey += 1;
      cashPulse = { changes, key: feedbackKey };
    }
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
    if (!view || view.phase === 'results' || view.phase === 'setup' || !mpInMatch) return null;
    return Math.max(0, TURN_MS - (now - view.turnStartedAt));
  });

  const matchTimeLeft = $derived(view?.endsAt !== null && view?.endsAt !== undefined ? Math.max(0, view.endsAt - now) : null);

  $effect(() => {
    if (view && view.phase !== 'results' && view.phase !== 'setup' && view.endsAt !== null && now >= view.endsAt && view.you !== null) {
      dispatch({ type: 'finish-time' });
    }
  });

  $effect(() => {
    if (timerLeft !== null && timerLeft <= 0 && view) {
      const stamp = view.turnStartedAt;
      if (lastTimeoutStamp !== stamp) {
        lastTimeoutStamp = stamp;
        if (view.phase === 'auction' && view.auction) dispatch({ type: 'timeout' }, view.auction.turn);
        else dispatch({ type: 'timeout' }, view.phase === 'debt' ? view.debt!.payer : view.turn);
      }
    }
  });

  let selected = $state<number | null>(null);
  let showTrade = $state(false);

  function select(space: number): void {
    selected = selected === space ? null : space;
  }

  function startSolo(bots: number, conditions: EndConditions = soloConditions): void {
    if (inParty) return;
    soloConditions = conditions;
    soloRng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const botIds = BOT_NAMES.slice(0, bots).map((_, i) => `bot${i}`);
    names = { you: 'You', ...Object.fromEntries(botIds.map((id, i) => [id, BOT_NAMES[i] ?? `Bot ${i}`])) };
    diceRoll = null;
    propertyFeedback = null;
    cashPulse = null;
    lastCardId = -1;
    cardDismissed = false;
    jailers = [];
    lastTimeoutStamp = -1;
    local = newMatch(['you', ...botIds], soloRng(), { ...conditions, now: Date.now() });
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

<div class={['city-app', { 'is-rolling': diceRoll !== null }]} inert={diceRoll !== null}>
  {#if !inMatch}
    <section class="city-menu">
      <div class="menu-city" inert>
        <Board view={preview} names={{ you: 'You' }} selected={null} onselect={() => {}} />
      </div>
      <div class="menu-content">
      {#if !inParty}<div class="solo-host">
        <SoloSetup onstart={startSolo} />
      </div>{/if}
      {#if session && mpSelected}
        <div class="lobby-host" bind:this={lobbyHost}></div>
      {/if}
      </div>
    </section>
  {:else if view?.phase === 'setup'}
    <section class="city-menu">
      <div class="menu-city" inert><Board {view} {names} selected={null} onselect={() => {}} /></div>
      <div class="menu-content solo-host">
        <div class="solo-setup">
          <h2>Choose how it ends</h2>
          {#if view.you === view.turn}
            <EndConditionsForm label="Start match" onsubmit={(conditions) => dispatch({ type: 'configure', conditions })} />
          {:else}
            <p class="solo-lede">Waiting for {nameOf(view.turn)} to choose the end conditions.</p>
          {/if}
        </div>
      </div>
    </section>
  {:else if view}
    <header class="city-topbar">
      <div class="brand-chip">Monopoly</div>
      <div class="match-goal">
        {#if view.bankruptcy}<span>Last player standing</span>{/if}
        {#if view.target !== null}<span>First to ${view.target.toLocaleString()}</span>{/if}
        {#if matchTimeLeft !== null}<span class="match-clock">{Math.floor(matchTimeLeft / 60_000)}:{String(Math.floor(matchTimeLeft / 1000) % 60).padStart(2, '0')} left</span>{/if}
      </div>
      {#key view.turn}
      <div class={['turn-strip', { 'is-mine': view.you !== null && view.turn === view.you }]}>
        {#if view.phase === 'results'}
          Match over
        {:else}
          {view.turn === view.you ? 'Your turn' : `${nameOf(view.turn)}'s turn`}
        {/if}
      </div>
      {/key}
      {#if timerLeft !== null}
        <div class={['timer-pill', { 'is-urgent': timerLeft < 20000 }]}>{Math.ceil(timerLeft / 1000)}s</div>
      {/if}
      {#if session && mpInMatch}
        <div class={['net-chip', { off: !mpConnected }]} title={mpConnected ? 'Connected' : 'Reconnecting…'}>
          {mpConnected ? 'online' : 'reconnecting'}
        </div>
      {/if}
      <button type="button" class="gear" onclick={() => (showSettings = !showSettings)} aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </button>
    </header>

    <section class="city-stage">
      <Board {view} {names} {selected} onselect={select} paused={diceRoll !== null} ontravel={(moving) => (traveling = moving)} />
      {#if propertyFeedback && !diceRoll}
        {#key propertyFeedback.key}
          {@const property = SPACES[propertyFeedback.space]!}
          <div class="property-feedback" role="status" style:--property-color={property.group ? GROUP_COLORS[property.group] : '#459db3'}>
            <span class="property-feedback-icon" aria-hidden="true">✓</span>
            <div><span class="property-feedback-label">{propertyFeedback.label}</span><strong>{property.name}</strong><span class="property-feedback-player">{propertyFeedback.player === 'You' ? 'Your portfolio' : `${propertyFeedback.player}'s portfolio`}</span></div>
          </div>
        {/key}
      {/if}
      {#if banner}
        {#key banner.key}
          <div class="banner">{banner.text}</div>
        {/key}
      {/if}
    </section>

    <aside class="city-side">
      <PlayerPanel {view} {names} {selected} cashChanges={diceRoll ? {} : cashPulse?.changes ?? {}} cashKey={cashPulse?.key ?? 0} onselect={select} />
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

    {#if view.drawnCard && !cardDismissed && !busy}
      <CardModal card={view.drawnCard} onclose={() => (cardDismissed = true)} />
    {/if}

    {#if view.phase === 'buy-decision' && view.you !== null && view.turn === view.you && !busy && (!view.drawnCard || cardDismissed)}
      <DeedCard {view} {names} spaceId={view.players[view.you]!.position} ondispatch={dispatch} purchase />
    {/if}

    {#if view.phase === 'results'}
      <ResultsScreen {view} {names} onrestart={mpInMatch ? null : () => startSolo(Object.keys(names).length - 1)} onmenu={mpInMatch ? null : backToMenu} />
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

{#if diceRoll}
  {#key diceRoll.key}
    <div class="dice-spotlight" role="status" aria-live="polite" aria-atomic="true">
      <div class="dice-spotlight-content">
        <p class="dice-player">{diceRoll.player === 'You' ? 'Your roll' : `${diceRoll.player}'s roll`}</p>
        <div class="dice-stage"><DiceTray roll={diceRoll.roll} cinematic /></div>
        <div class="dice-result">
          <strong>{diceRoll.roll[0] + diceRoll.roll[1]}</strong>
          <span>{diceRoll.roll[0] === diceRoll.roll[1] ? 'Doubles!' : 'Total rolled'}</span>
        </div>
      </div>
    </div>
  {/key}
{/if}
