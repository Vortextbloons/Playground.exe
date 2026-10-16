<script lang="ts">
  import type { SessionView } from '@playground-exe/game-kit/multiplayer';
  import { cardFromId, type Color } from './rules/cards';
  import {
    DEFAULT_MATCH_TARGET,
    applyAction,
    newMatch,
    toView,
    type Difficulty,
    type UnoAction,
    type UnoActionPayloads,
    type UnoState,
    type UnoView,
  } from './rules/engine';
  import { mulberry32 } from './rules/rng';
  import { botMove } from './bots/bots';
  import { sound } from './sound';
  import Card from './components/Card.svelte';
  import ColorPicker from './components/ColorPicker.svelte';
  import OpponentSeat from './components/OpponentSeat.svelte';
  import PlayerHand from './components/PlayerHand.svelte';
  import TablePiles from './components/TablePiles.svelte';

  type Speed = 'slow' | 'normal' | 'fast';

  interface Props {
    session?: {
      subscribe(listener: (view: SessionView<UnoView>) => void): () => void;
      send(action: keyof UnoActionPayloads, payload: UnoActionPayloads[keyof UnoActionPayloads]): boolean;
      onError(listener: (message: string) => void): () => void;
    } | null;
    menuElement?: HTMLElement | null;
  }

  let { session = null, menuElement = null }: Props = $props();

  // ------------------------------------------------------------------ settings

  let soundOn = $state(true);
  let speed = $state<Speed>('normal');
  let showSettings = $state(false);
  const speedFactor = $derived(speed === 'fast' ? 0.45 : speed === 'slow' ? 1.7 : 1);

  // ------------------------------------------------------------------ local (solo) match

  let local = $state<UnoState | null>(null);
  let soloRng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  let difficulty = $state<Difficulty>('normal');
  let botCount = $state(3);
  let targetPoints = $state(DEFAULT_MATCH_TARGET);

  const BOT_NAMES = ['Rosa', 'Milo', 'Juno', 'Pip'] as const;
  let names = $state<Record<string, string>>({});

  // ------------------------------------------------------------------ multiplayer mirror

  let mpView = $state<UnoView | null>(null);
  let mpConnected = $state(true);
  let mpInMatch = $state(false);
  let mpSelected = $state(false);
  let mpMatchStatus = $state<'playing' | 'finished' | null>(null);
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
      mpSelected = next.party?.selection?.gameId === 'uno';
      mpMatchStatus = next.match?.status ?? null;
      const nextView = next.match?.state ?? null;
      observe(mpView, nextView);
      mpView = nextView;
      const roster: Record<string, string> = {};
      for (const player of next.party?.players ?? []) roster[player.id] = player.nickname;
      names = roster;
    });
    const offError = session.onError(message => {
      showBanner(message);
      sound.play('catch');
    });
    return () => { offState(); offError(); };
  });

  // ------------------------------------------------------------------ rendered view

  const inMatch = $derived(local !== null || mpInMatch);
  const view = $derived(mpInMatch ? mpView : local === null ? null : toView(local, 'you'));
  const isSpectator = $derived(view !== null && view.you === null);
  const myTurn = $derived(view !== null && view.you !== null && view.turn === view.you);

  function nameOf(playerId: string): string {
    return names[playerId] ?? playerId;
  }

  // ------------------------------------------------------------------ action plumbing

  function dispatch(action: UnoAction, actor = 'you'): void {
    sound.unlock();
    if (mpInMatch) {
      session?.send(action.type, payloadOf(action));
      return;
    }
    if (!local) return;
    const next = applyAction($state.snapshot(local), actor, action, soloRng);
    observe(toView(local, 'you'), toView(next, 'you'));
    if (action.type === 'play-card' && action.callUno) sound.play('uno');
    local = next;
    scheduleBot();
  }

  function payloadOf(action: UnoAction): UnoActionPayloads[keyof UnoActionPayloads] {
    switch (action.type) {
      case 'play-card': {
        const payload: UnoActionPayloads['play-card'] = { card: action.card };
        if (action.color) payload.color = action.color;
        if (action.callUno) payload.callUno = true;
        return payload;
      }
      case 'catch-uno': return { target: action.target };
      case 'choose-color': return { color: action.color };
      default: return null;
    }
  }

  function actorFor(state: UnoState): string {
    return state.phase === 'wild-four' ? state.wildFour!.target : state.turn;
  }

  // ------------------------------------------------------------------ solo bots

  let botTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleBot(): void {
    clearTimeout(botTimer);
    botTimer = undefined;
    if (mpInMatch || !local || local.phase === 'results') return;
    const actor = actorFor(local);
    if (actor === 'you') return;
    const thinking = (620 + Math.random() * 700) * speedFactor + (local.missedUno ? 1600 * speedFactor : 0);
    botTimer = setTimeout(() => {
      if (!local || mpInMatch) return;
      if (actorFor(local) !== actor) return;
      dispatch(botMove(local, actor, difficulty, soloRng), actor);
    }, thinking);
  }

  $effect(() => {
    if (local && !mpInMatch) scheduleBot();
    return () => clearTimeout(botTimer);
  });

  // ------------------------------------------------------------------ announcements

  let banner = $state<{ text: string; key: number } | null>(null);
  let bannerKey = 0;

  function showBanner(text: string): void {
    bannerKey += 1;
    banner = { text, key: bannerKey };
  }

  function observe(prev: UnoView | null, next: UnoView | null): void {
    if (!prev || !next) return;
    if (next.discardTop !== prev.discardTop) sound.play('play');
    else if (grew(prev.counts, next.counts)) sound.play('draw');
    if (next.direction !== prev.direction) showBanner('Reverse!');
    if (next.phase === 'wild-four' && prev.phase !== 'wild-four') showBanner('Wild Draw Four!');
    if (next.missedUno && next.missedUno !== prev.missedUno) {
      showBanner(`${nameOf(next.missedUno)} forgot to call UNO!`);
      sound.play('catch');
    }
    if (next.winner && next.winner !== prev.winner) sound.play(next.winner === prev.you ? 'win' : 'lose');
  }

  function grew(prev: Record<string, number>, next: Record<string, number>): boolean {
    return Object.keys(next).some(id => (next[id] ?? 0) > (prev[id] ?? 0));
  }

  // ------------------------------------------------------------------ menu / match control

  function startSolo(): void {
    soloRng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const botIds = BOT_NAMES.slice(0, botCount).map((_, i) => `bot${i}`);
    names = { you: 'You', ...Object.fromEntries(botIds.map((id, i) => [id, BOT_NAMES[i] ?? `Bot ${i}`])) };
    local = newMatch(['you', ...botIds], { matchTarget: targetPoints }, soloRng);
    sound.unlock();
    sound.play('shuffle');
    showBanner(`${nameOf(local.turn)} starts`);
    scheduleBot();
  }

  function backToMenu(): void {
    clearTimeout(botTimer);
    local = null;
  }

  // ------------------------------------------------------------------ derived UI state

  const needColor = $derived(view !== null && view.phase === 'color' && myTurn);
  const wildFourForMe = $derived(view !== null && view.phase === 'wild-four' && view.wildFour !== null && view.wildFour.target === view.you);
  const canCatch = $derived(view !== null && view.you !== null && view.missedUno !== null && view.missedUno !== view.you);
  const callUnoNow = $derived(view !== null && view.you !== null && view.missedUno === view.you);
  const canPass = $derived(myTurn && view?.phase === 'playing' && view.drawnCard !== null);
  const canDraw = $derived(myTurn && view?.phase === 'playing' && view.drawnCard === null);
  let picking = $state<number | null>(null);

  const opponents = $derived(
    view
      ? view.players.filter(id => id !== view.you).map(id => ({
          id,
          name: nameOf(id),
          count: view.counts[id] ?? 0,
          active: view.turn === id,
          calledUno: view.calledUno.includes(id),
        }))
      : [],
  );

  const statusLine = $derived.by(() => {
    if (!view) return '';
    if (view.phase === 'wild-four' && view.wildFour) {
      return view.wildFour.target === view.you
        ? `${nameOf(view.wildFour.by)} played Wild Draw Four on you`
        : `${nameOf(view.wildFour.by)} awaits ${nameOf(view.wildFour.target)}'s response…`;
    }
    if (view.phase === 'color') return `${nameOf(view.turn)} is choosing a color`;
    if (view.phase === 'results') return view.winner ? `${nameOf(view.winner)} won round ${view.round + 1}` : 'Match over';
    if (view.turn === view.you) return 'Your turn';
    return `${nameOf(view.turn)}'s turn`;
  });

  let windowWidth = $state(1024);
  const handWidth = $derived.by(() => {
    const count = Math.max(7, view?.you !== null && view?.you !== undefined ? view.counts[view.you] ?? 7 : 7);
    const spread = 0.66 * (count - 1) + 1;
    return Math.max(48, Math.min(92, Math.floor((windowWidth - 48) / spread)));
  });

  // ------------------------------------------------------------------ confetti

  const CONFETTI_COLORS = ['var(--color-red)', 'var(--color-sun)', 'var(--color-grass)', 'var(--color-royal)', 'var(--color-gold)'];
  const confettiSeed = $derived(
    view?.phase === 'results' && view.winner !== null ? `${view.round}:${view.winner}` : null,
  );
  const confetti = $derived(
    confettiSeed === null
      ? []
      : Array.from({ length: 42 }, () => ({
          x: Math.round((Math.random() * 2 - 1) * 170),
          y: Math.round(90 + Math.random() * 230),
          r: Math.round((Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 420)),
          c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0]!,
          d: +(Math.random() * 0.45).toFixed(2),
          t: +(1.3 + Math.random() * 1.1).toFixed(2),
        })),
  );

  // ------------------------------------------------------------------ handlers

  function playCard(cardId: number): void {
    const card = cardFromId(cardId);
    if (card.kind === 'wild' || card.kind === 'wild-four') {
      picking = cardId;
      return;
    }
    dispatch({ type: 'play-card', card: cardId });
  }

  let drag = $state({ active: false, over: false });

  function onDrag(active: boolean, over: boolean): void {
    drag.active = active;
    drag.over = over;
  }

  function pickColor(color: Color): void {
    if (picking !== null) {
      const card = picking;
      picking = null;
      dispatch({ type: 'play-card', card, color });
      return;
    }
    dispatch({ type: 'choose-color', color });
  }
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="app" data-speed={speed}>
  {#if !inMatch}
    <section class="menu">
      <div class="logo-plate">
        <span class="logo-uno">UNO</span>
        <span class="logo-sub">CARD CLASSICS</span>
      </div>
      {#if session && mpSelected}
        <div class="lobby-host" bind:this={lobbyHost}></div>
      {:else}
        <div class="menu-form">
          <p class="form-title">{session ? 'Practice table' : 'Solo table'}</p>
          <label class="row">
            <span>Bots</span>
            <span class="stepper">
              <button type="button" onclick={() => (botCount = Math.max(1, botCount - 1))} aria-label="Fewer bots">−</button>
              <strong>{botCount}</strong>
              <button type="button" onclick={() => (botCount = Math.min(3, botCount + 1))} aria-label="More bots">+</button>
            </span>
          </label>
          <div class="row">
            <span>Difficulty</span>
            <span class="segment">
              {#each ['easy', 'normal'] as level (level)}
                <button type="button" class:on={difficulty === level} onclick={() => (difficulty = level as Difficulty)}>{level}</button>
              {/each}
            </span>
          </div>
          <div class="row">
            <span>Points</span>
            <span class="segment">
              <button type="button" class:on={targetPoints === 500} onclick={() => (targetPoints = 500)}>Race to 500</button>
              <button type="button" class:on={targetPoints === 0} onclick={() => (targetPoints = 0)}>Endless</button>
            </span>
          </div>
          <button type="button" class="deal" onclick={startSolo}>Deal me in</button>
        </div>
      {/if}
    </section>
  {:else if view}
    <header class="top">
      <div class="chip logo-chip">UNO</div>
      <div class="chip round-chip">
        {#if view.matchTarget > 0}
          Round {view.round + 1} · to {view.matchTarget}
        {:else}
          Round {view.round + 1}
        {/if}
      </div>
      {#if session}
        <div class="chip net" class:off={!mpConnected} title={mpConnected ? 'Connected' : 'Reconnecting…'}>
          {mpConnected ? '● online' : '○ reconnecting'}
        </div>
      {/if}
      <button type="button" class="gear" onclick={() => (showSettings = !showSettings)} aria-label="Settings">⚙</button>
    </header>

    <section class="table-area">
      <div class="opponents">
        {#each opponents as opponent (opponent.id)}
          <OpponentSeat name={opponent.name} count={opponent.count} active={opponent.active} calledUno={opponent.calledUno} />
        {/each}
        {#if isSpectator && opponents.length === 0}
          <p class="waiting">Waiting for the match…</p>
        {/if}
      </div>

      <div class="center">
        <TablePiles {view} drawCount={view.drawPile} {canDraw} direction={view.direction} dropActive={drag.active} dropHover={drag.over} onDraw={() => dispatch({ type: 'draw-card' })} />
      </div>

      <p class="status" data-active={String(myTurn)}>{statusLine}</p>

      {#if banner}
        {#key banner.key}
          <div class="banner">{banner.text}</div>
        {/key}
      {/if}

      {#if !isSpectator && view.you}
        <PlayerHand {view} width={handWidth} onDrag={onDrag} onPlay={playCard} />
        <div class="actions">
          {#if canPass}
            <button type="button" class="ghost-btn" onclick={() => dispatch({ type: 'pass-turn' })}>Pass</button>
          {/if}
          {#if callUnoNow}
            <button type="button" class="uno-btn" onclick={() => dispatch({ type: 'call-uno' })}>UNO!</button>
          {/if}
          {#if canCatch}
            <button type="button" class="catch-btn" onclick={() => dispatch({ type: 'catch-uno', target: view.missedUno! })}>
              Catch {nameOf(view.missedUno!)}!
            </button>
          {/if}
        </div>
      {:else if isSpectator}
        <p class="spectating">Spectating — you'll join the next match.</p>
      {/if}
    </section>

    {#if picking !== null}
      <ColorPicker title="Wild color" onPick={pickColor} onCancel={() => (picking = null)} />
    {:else if needColor}
      <ColorPicker title="Choose a color" onPick={pickColor} />
    {:else if wildFourForMe && view.wildFour}
      <div class="veil"></div>
      <div class="panel" role="dialog" aria-label="Wild Draw Four">
        <div class="wild-intro">
          <div class="wild-card"><Card id={view.discardTop} width={62} label="Wild Draw Four" /></div>
          <h2>{nameOf(view.wildFour.by)} played Wild Draw Four</h2>
        </div>
        <p>Challenge their play — if they had a {view.activeColor} card they draw 6 instead. Otherwise you draw 6.</p>
        <div class="pair">
          <button type="button" class="danger" onclick={() => dispatch({ type: 'challenge-draw-four' })}>Challenge!</button>
          <button type="button" onclick={() => dispatch({ type: 'accept-draw-four' })}>Take 4</button>
        </div>
      </div>
    {:else if view.phase === 'results'}
      <div class="veil"></div>
      <div class="panel" role="dialog" aria-label="Round results">
        <h2>
          {view.matchWinner
            ? `${nameOf(view.matchWinner)} wins the match!`
            : view.winner
              ? `${nameOf(view.winner)} won the round`
              : 'Match over'}
        </h2>
        <table>
          <thead><tr><th>Player</th><th>Score</th><th>Round</th></tr></thead>
          <tbody>
            {#each view.players as id (id)}
              <tr class:me={id === view.you}>
                <td>{nameOf(id)}</td>
                <td>{view.scores[id] ?? 0}</td>
                <td>+{view.lastGains?.[id] ?? 0}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if view.matchWinner}
          {#if !mpInMatch}
            <div class="pair">
              <button type="button" class="danger" onclick={startSolo}>New match</button>
              <button type="button" onclick={backToMenu}>Menu</button>
            </div>
          {:else}
            <div class="lobby-inline" bind:this={lobbyHost}></div>
          {/if}
        {:else if !isSpectator}
          <button type="button" class="danger" onclick={() => dispatch({ type: 'next-round' })}>Next round</button>
        {/if}
      </div>
    {/if}

    {#if confettiSeed !== null}
      {#key confettiSeed}
        <div class="confetti" aria-hidden="true">
          {#each confetti as piece, i (i)}
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
      {/key}
    {/if}

    {#if showSettings}
      <div class="panel settings" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <label><input type="checkbox" bind:checked={soundOn} onchange={() => sound.setEnabled(soundOn)} /> Sounds</label>
        <div class="row">
          <span>Animations</span>
          <span class="segment">
            {#each ['slow', 'normal', 'fast'] as rate (rate)}
              <button type="button" class:on={speed === rate} onclick={() => (speed = rate as Speed)}>{rate}</button>
            {/each}
          </span>
        </div>
        <button type="button" class="ghost-btn" onclick={() => (showSettings = false)}>Close</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ------- menu ------- */
  .menu {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 20px;
  }

  .logo-plate {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 34px 10px;
    border-radius: 22px;
    background: linear-gradient(175deg, #e8262a, #a10d17);
    box-shadow:
      inset 0 0 0 4px #fff,
      0 14px 40px rgba(40, 4, 8, 0.6);
    transform: rotate(-3deg);
    animation: uno-float 4.5s ease-in-out infinite;
  }

  @keyframes uno-float {
    0%, 100% { transform: rotate(-3deg) translateY(0); }
    50% { transform: rotate(-2deg) translateY(-7px); }
  }

  .logo-uno {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(56px, 14vw, 96px);
    line-height: 0.9;
    color: var(--color-gold);
    text-shadow: 0 4px 0 #7c0713, 0 8px 18px rgba(0, 0, 0, 0.4);
    letter-spacing: 0.02em;
  }

  .logo-sub {
    margin-top: 6px;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 0.42em;
    color: #fff;
  }

  .menu-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(360px, 92vw);
    padding: 18px;
    border-radius: 18px;
    background: rgba(70, 5, 12, 0.55);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.14);
  }

  .form-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--color-gold);
    text-align: center;
  }

  .lobby-inline {
    border-radius: 12px;
    background: rgba(70, 5, 12, 0.6);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.12);
    padding: 10px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-weight: 700;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .stepper button {
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
  }

  .stepper button:hover {
    background: rgba(255, 255, 255, 0.28);
  }

  .segment {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.28);
  }

  .segment button {
    border: 0;
    border-radius: 999px;
    padding: 5px 12px;
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
  }

  .segment button.on {
    background: var(--color-gold);
    color: #712d00;
  }

  .deal {
    border: 0;
    border-radius: 14px;
    padding: 13px;
    background: linear-gradient(180deg, var(--color-gold), #f0a80c);
    color: #5c2400;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0.03em;
    cursor: pointer;
    box-shadow: 0 6px 0 #a36b00, 0 10px 20px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease;
  }

  .deal:hover {
    transform: translateY(-2px);
  }

  .deal:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 #a36b00, 0 6px 12px rgba(0, 0, 0, 0.35);
  }

  .lobby-host {
    width: min(460px, 94vw);
    border-radius: 18px;
    background: rgba(70, 5, 12, 0.55);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.14);
    padding: 14px;
  }

  .lobby-host :global(.multiplayer-menu),
  .lobby-inline :global(.multiplayer-menu) {
    display: grid;
    gap: 10px;
    margin: 0;
  }

  .lobby-host :global(.multiplayer-menu h2),
  .lobby-inline :global(.multiplayer-menu h2) {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    color: var(--color-gold);
  }

  .lobby-host :global(.eyebrow),
  .lobby-inline :global(.eyebrow) {
    margin: 0;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: var(--color-muted);
  }

  .lobby-host :global(.mode-options),
  .lobby-inline :global(.mode-options) {
    display: grid;
    gap: 8px;
  }

  .lobby-host :global(.mode-options button),
  .lobby-inline :global(.mode-options button) {
    display: grid;
    gap: 3px;
    text-align: left;
    border: 1.5px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    padding: 10px 12px;
    background: transparent;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }

  .lobby-host :global(.mode-options button[aria-pressed='true']),
  .lobby-inline :global(.mode-options button[aria-pressed='true']) {
    border-color: var(--color-gold);
    background: rgba(255, 206, 74, 0.14);
  }

  .lobby-host :global(.mode-options button:disabled),
  .lobby-inline :global(.mode-options button:disabled) {
    opacity: 0.45;
    cursor: default;
  }

  .lobby-host :global(.mode-options span),
  .lobby-inline :global(.mode-options span) {
    font-size: 11px;
    color: var(--color-muted);
  }

  .lobby-host :global(.party-roster),
  .lobby-inline :global(.party-roster) {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
    font-weight: 700;
  }

  .lobby-host :global([role='status']),
  .lobby-inline :global([role='status']) {
    margin: 0;
    font-size: 12px;
    color: var(--color-muted);
  }

  .lobby-host :global(.actions),
  .lobby-inline :global(.actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .lobby-host :global(.actions button),
  .lobby-inline :global(.actions button) {
    border: 0;
    border-radius: 10px;
    padding: 9px 12px;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
  }

  .lobby-host :global(.actions button:disabled),
  .lobby-inline :global(.actions button:disabled) {
    opacity: 0.45;
  }

  .lobby-host :global([hidden]),
  .lobby-inline :global([hidden]) {
    display: none !important;
  }

  /* ------- table ------- */
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
  }

  .chip {
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(70, 5, 12, 0.55);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.14);
    font-size: 12px;
    font-weight: 800;
  }

  .logo-chip {
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--color-gold);
    background: linear-gradient(175deg, #e8262a, #a10d17);
  }

  .net.off {
    color: var(--color-gold-soft);
  }

  .gear {
    margin-left: auto;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font-size: 17px;
    cursor: pointer;
  }

  .gear:hover {
    background: rgba(255, 255, 255, 0.26);
  }

  .table-area {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 8px;
    gap: 6px;
    min-height: 0;
  }

  .opponents {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }

  .waiting {
    font-weight: 700;
    color: var(--color-muted);
  }

  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

  .status {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(14px, 2.6vw, 17px);
    color: var(--color-muted);
  }

  .status[data-active='true'] {
    color: var(--color-gold);
    text-shadow: 0 0 14px rgba(255, 206, 74, 0.4);
  }

  .banner {
    position: absolute;
    left: 50%;
    top: 38%;
    z-index: 20;
    padding: 8px 22px;
    border-radius: 999px;
    background: rgba(40, 3, 8, 0.82);
    box-shadow: inset 0 0 0 2px var(--color-gold), 0 0 26px rgba(255, 206, 74, 0.35);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(16px, 4vw, 24px);
    color: var(--color-gold);
    text-shadow: 0 0 16px rgba(255, 206, 74, 0.45);
    pointer-events: none;
    animation: var(--animate-banner);
  }

  .actions {
    display: flex;
    gap: 10px;
    padding-bottom: 4px;
  }

  .uno-btn {
    border: 0;
    border-radius: 999px;
    padding: 10px 26px;
    background: linear-gradient(180deg, var(--color-gold), #f0a80c);
    color: #5c2400;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.04em;
    cursor: pointer;
    box-shadow: 0 5px 0 #a36b00, 0 10px 18px rgba(0, 0, 0, 0.35);
    animation: var(--animate-pulse-soft);
  }

  .catch-btn {
    border: 0;
    border-radius: 999px;
    padding: 10px 20px;
    background: linear-gradient(180deg, #ff7a59, #e8492a);
    color: #fff;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 5px 0 #8f1f0d, 0 10px 18px rgba(0, 0, 0, 0.35);
  }

  .ghost-btn {
    border: 0;
    border-radius: 999px;
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }

  .ghost-btn:hover {
    background: rgba(255, 255, 255, 0.26);
  }

  .spectating {
    font-weight: 700;
    color: var(--color-muted);
    font-style: italic;
  }

  /* ------- panels ------- */
  .veil {
    position: fixed;
    inset: 0;
    z-index: 25;
    background: rgba(40, 3, 8, 0.55);
    backdrop-filter: blur(2px);
    animation: var(--animate-veil);
  }

  .panel {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 30;
    width: min(400px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px 20px;
    border-radius: 18px;
    background: linear-gradient(170deg, #5e0710, #3d040b);
    box-shadow:
      inset 0 0 0 2px rgba(255, 255, 255, 0.14),
      0 18px 50px rgba(0, 0, 0, 0.5);
    animation: var(--animate-panel);
  }

  .panel h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 21px;
  }

  .wild-intro {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .wild-card {
    flex: none;
    transform: rotate(-9deg);
    filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45));
    animation: uno-wobble 2.6s ease-in-out infinite;
  }

  @keyframes uno-wobble {
    0%, 100% { transform: rotate(-10deg) translateY(0); }
    50% { transform: rotate(-4deg) translateY(-4px); }
  }

  .confetti {
    position: fixed;
    inset: 0;
    z-index: 35;
    overflow: hidden;
    pointer-events: none;
  }

  .confetti span {
    position: absolute;
    left: 50%;
    top: 38%;
    width: 9px;
    height: 15px;
    border-radius: 2px;
    background: var(--c);
    opacity: 0;
    animation: uno-confetti var(--t) cubic-bezier(0.2, 0.65, 0.45, 1) var(--d) both;
  }

  @keyframes uno-confetti {
    0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.5); }
    10% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)) scale(0.85); }
  }

  .panel p {
    margin: 0;
    color: var(--color-muted);
    font-size: 14px;
  }

  .panel table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  .panel th,
  .panel td {
    padding: 5px 8px;
    text-align: left;
  }

  .panel th {
    color: var(--color-muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .panel tr.me {
    color: var(--color-gold);
  }

  .pair {
    display: flex;
    gap: 10px;
  }

  .pair button,
  .panel > button {
    flex: 1;
    border: 0;
    border-radius: 12px;
    padding: 11px;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }

  .pair .danger,
  .panel > .danger {
    background: linear-gradient(180deg, var(--color-gold), #f0a80c);
    color: #5c2400;
  }

  .settings label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
  }

  .settings input {
    width: 18px;
    height: 18px;
    accent-color: var(--color-gold);
  }

  @media (max-width: 560px) {
    .opponents {
      gap: 6px;
    }

    .banner {
      top: 30%;
    }
  }
</style>
