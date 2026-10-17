<script lang="ts">
  import type { SessionView } from '@playground-exe/game-kit/multiplayer';
  import { createStorage } from '@playground-exe/game-kit';
  import { applyMove, newGame, validMoves, type GameState, type Player } from './rules/engine';
  import { chooseMove, type Difficulty } from './ai';
  import { mulberry32, type Rng } from './rules/rng';
  import type { TicState } from './multiplayer';

  interface Session {
    subscribe(listener: (view: SessionView<TicState>) => void): () => void;
    send(action: 'place', payload: { index: number }): boolean;
    onError(listener: (message: string) => void): () => void;
  }

  interface Props {
    session?: Session | null;
    menuElement?: HTMLElement | null;
  }

  let { session = null, menuElement = null }: Props = $props();

  const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
  const BOT_NAMES: Record<Difficulty, string> = { easy: 'Rookie', medium: 'Steady', hard: 'Sharp' };
  const storage = createStorage('tic-tac-toe');

  type SoloRecord = { w: number; l: number; d: number };

  let local = $state<GameState | null>(null);
  let mpState = $state<TicState | null>(null);
  let mpInMatch = $state(false);
  let mpConnected = $state(true);
  let mpSelected = $state(false);
  let inParty = $state(false);
  let meId = $state<string | null>(null);
  let names = $state<Record<string, string>>({});
  let difficulty = $state<Difficulty>('medium');
  let soloRng: Rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  let hoverCell = $state<number | null>(null);
  let lobbyHost = $state<HTMLElement | null>(null);
  let error = $state('');
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let paused = $state(false);
  let botTimer: ReturnType<typeof setTimeout> | undefined;
  let recorded = $state(false);
  let record = $state<SoloRecord>(storage.get<SoloRecord>('record', { w: 0, l: 0, d: 0 }));

  const game = $derived(mpInMatch ? mpState?.game ?? null : local);
  const mySlot = $derived(mpInMatch ? (mpState && meId ? mpState.players.indexOf(meId) : -1) : 0);
  const canPlace = $derived(game !== null && game.phase === 'playing' && game.turn === mySlot && mySlot >= 0 && (!mpInMatch || mpConnected));
  const finished = $derived(game !== null && game.phase !== 'playing');

  const seats = $derived.by(() => {
    if (game === null) return [] as { key: string; label: string; slot: Player }[];
    if (!mpInMatch || mpState === null) {
      return [
        { key: 'you', label: 'You', slot: 0 as Player },
        { key: 'bot', label: BOT_NAMES[difficulty], slot: 1 as Player },
      ];
    }
    return mpState.players.map((id, index) => ({ key: id, label: id === meId ? 'You' : nameOf(id), slot: index as Player }));
  });

  const status = $derived.by(() => {
    if (game === null) return '';
    if (game.phase === 'draw') return 'Draw';
    if (game.phase === 'won') {
      if (!mpInMatch) return game.winner === 0 ? 'You win' : `${BOT_NAMES[difficulty]} wins`;
      if (game.winner === null) return 'Round over';
      return game.winner === mySlot ? 'You win' : `${nameOf(mpState?.players[game.winner])} wins`;
    }
    if (!mpInMatch) return game.turn === 0 ? 'Your turn' : `${BOT_NAMES[difficulty]} is thinking`;
    if (mySlot < 0) return `${nameOf(mpState?.players[game.turn])}’s turn`;
    return game.turn === mySlot ? 'Your turn' : `${nameOf(mpState?.players[game.turn])}’s turn`;
  });

  const resultDetail = $derived.by(() => {
    if (game === null) return '';
    if (!mpInMatch) return `${difficulty} computer`;
    if (mySlot < 0) return 'Watching';
    return `You played ${mySlot === 0 ? 'X' : 'O'}`;
  });

  function nameOf(id: string | undefined): string {
    return (id && names[id]) || 'Player';
  }

  function showError(message: string): void {
    clearTimeout(errorTimer);
    error = message;
    errorTimer = setTimeout(() => { error = ''; }, 4000);
  }

  function tally(outcome: 'w' | 'l' | 'd'): void {
    if (recorded) return;
    recorded = true;
    if (outcome === 'w') record = { ...record, w: record.w + 1 };
    else if (outcome === 'l') record = { ...record, l: record.l + 1 };
    else record = { ...record, d: record.d + 1 };
    storage.set('record', record);
  }

  function startSolo(): void {
    if (inParty) return;
    clearTimeout(botTimer);
    botTimer = undefined;
    soloRng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    local = newGame();
    recorded = false;
  }

  function backToMenu(): void {
    clearTimeout(botTimer);
    botTimer = undefined;
    local = null;
  }

  function place(index: number): void {
    if (!canPlace) return;
    if (mpInMatch) {
      session?.send('place', { index });
      return;
    }
    if (local === null) return;
    local = applyMove($state.snapshot(local), index);
    if (local.phase === 'won') tally(local.winner === 0 ? 'w' : 'l');
    else if (local.phase === 'draw') tally('d');
    scheduleBot();
  }

  function scheduleBot(): void {
    clearTimeout(botTimer);
    botTimer = undefined;
    if (paused || mpInMatch || local === null || local.phase !== 'playing' || local.turn !== 1) return;
    const snapshot = $state.snapshot(local);
    botTimer = setTimeout(() => {
      botTimer = undefined;
      if (paused || mpInMatch || local === null || local.phase !== 'playing' || local.turn !== 1) return;
      const index = chooseMove(snapshot, difficulty, soloRng);
      local = applyMove($state.snapshot(local), index);
      if (local.phase === 'won') tally(local.winner === 1 ? 'l' : 'w');
      else if (local.phase === 'draw') tally('d');
      scheduleBot();
    }, 320 + Math.random() * 260);
  }

  export function restart(): void {
    if (mpInMatch) return;
    startSolo();
  }

  export function pause(): void {
    paused = true;
    clearTimeout(botTimer);
    botTimer = undefined;
  }

  export function resume(): void {
    if (!paused) return;
    paused = false;
    scheduleBot();
  }

  $effect(() => {
    if (mpInMatch) {
      clearTimeout(botTimer);
      botTimer = undefined;
      local = null;
    }
  });

  $effect(() => {
    if (!session) return;
    const offState = session.subscribe(next => {
      inParty = next.party !== null;
      if (inParty) { local = null; clearTimeout(botTimer); }
      mpConnected = next.connected;
      mpInMatch = next.match !== null;
      mpSelected = next.party?.selection?.gameId === 'tic-tac-toe';
      meId = next.playerId;
      mpState = next.match?.state ?? null;
      const roster: Record<string, string> = {};
      for (const player of next.party?.players ?? []) roster[player.id] = player.nickname;
      names = roster;
    });
    const offError = session.onError(message => { showError(message); });
    return () => {
      offState();
      offError();
      clearTimeout(errorTimer);
    };
  });

  $effect(() => {
    if (!menuElement) return;
    const host = lobbyHost;
    if (host && menuElement.parentElement !== host) host.append(menuElement);
  });
</script>

<div class="app">
  {#if game === null}
    <section class="menu">
      <h1 class="wordmark">
        Tic-Tac-Toe
        <span class="marks" aria-hidden="true">
          <i class="mark x">X</i><i class="mark o">O</i><i class="mark x">X</i>
        </span>
      </h1>

      {#if session && mpSelected}
        <div class="lobby" bind:this={lobbyHost}></div>
      {/if}

      {#if !inParty}
      <div class="setup">
        <div class="row">
          <span class="row-label">Opponent</span>
          <div class="segment">
            {#each DIFFICULTIES as level (level)}
              <button type="button" class:on={difficulty === level} onclick={() => (difficulty = level)}>{level}</button>
            {/each}
          </div>
        </div>
        <p class="record">Record: {record.w}–{record.l}–{record.d}</p>
        <button type="button" class="primary" onclick={startSolo}>Play the computer</button>
      </div>
      {/if}
      {#if session && !inParty}
        <p class="hint">Playing with friends? Create or join a party, then pick Tic-Tac-Toe.</p>
      {/if}
      {#if error}<p class="error" role="status">{error}</p>{/if}
    </section>
  {:else}
    <header class="top">
      <span class="brand">Tic-Tac-Toe</span>
      <div class="turn-chip" data-side={game.turn === 0 ? 'x' : 'o'}>
        <i class="pip" data-side={game.turn === 0 ? 'x' : 'o'}></i>
        <span aria-live="polite">{status}</span>
      </div>
      {#if mpInMatch}
        <span class="net" class:off={!mpConnected}>{mpConnected ? 'Online' : 'Reconnecting'}</span>
      {:else}
        <span class="level">{difficulty}</span>
        <button type="button" class="ghost" onclick={backToMenu}>Menu</button>
        <button type="button" class="ghost" onclick={startSolo}>Restart</button>
      {/if}
    </header>

    <section class="stage">
      <div class="seats">
        {#each seats as seat (seat.key)}
          <span class="seat" class:active={game.phase === 'playing' && game.turn === seat.slot}>
            <i class="pip" data-side={seat.slot === 0 ? 'x' : 'o'}></i>{seat.label}
          </span>
        {/each}
      </div>

      <div class="board">
        {#each Array(9) as _, index (index)}
          {@const cell = game.board[index]}
          <button
            type="button"
            class="cell"
            class:winning={game.winningCells.includes(index)}
            disabled={!canPlace || cell !== null}
            aria-label={`Place mark in cell ${index + 1}`}
            onpointerenter={() => (hoverCell = index)}
            onpointerleave={() => (hoverCell === index && (hoverCell = null))}
            onclick={() => place(index)}
          >
            {#if cell !== null}
              <span class="mark" data-side={cell === 0 ? 'x' : 'o'}>{cell === 0 ? 'X' : 'O'}</span>
            {:else if hoverCell === index && canPlace}
              <span class="mark preview" data-side={game.turn === 0 ? 'x' : 'o'}>{game.turn === 0 ? 'X' : 'O'}</span>
            {/if}
          </button>
        {/each}
      </div>

      {#if error}<p class="error" role="status">{error}</p>{/if}
    </section>

    {#if finished}
      <div class="veil"></div>
      <div class="result" role="dialog" aria-label="Round result">
        <h2>{game.phase === 'draw' ? 'Draw' : status}</h2>
        <p>{resultDetail}</p>
        {#if mpInMatch}
          <div class="lobby-inline" bind:this={lobbyHost}></div>
        {:else}
          <div class="result-actions">
            <button type="button" class="primary" onclick={startSolo}>Play again</button>
            <button type="button" class="ghost" onclick={backToMenu}>Main menu</button>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .app {
    --x: #6ee7ff;
    --o: #ff6b9d;
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 10px clamp(8px, 3vw, 22px) 16px;
    gap: 8px;
  }

  .menu {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 12px;
  }

  .wordmark {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    margin: 0;
    font-size: clamp(40px, 12vw, 76px);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 0.95;
    text-align: center;
    text-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
  }

  .marks {
    display: flex;
    gap: 10px;
    font-size: 0.4em;
  }

  .mark.x { color: var(--x); }
  .mark.o { color: var(--o); }

  .setup,
  .lobby {
    width: min(340px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 18px;
    background: rgba(9, 22, 40, 0.62);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.1), 0 20px 44px rgba(0, 0, 0, 0.35);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .row-label,
  .level {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .segment {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.32);
  }

  .segment button {
    border: 0;
    border-radius: 999px;
    padding: 6px 14px;
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
  }

  .segment button.on {
    background: var(--color-accent);
    color: #041121;
  }

  .record {
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: var(--color-muted);
  }

  .primary {
    border: 0;
    border-radius: 14px;
    padding: 13px;
    background: linear-gradient(180deg, #c9e8ff, var(--color-accent));
    color: #041121;
    font: inherit;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    box-shadow: 0 5px 0 #1c6ba3, 0 12px 22px rgba(0, 0, 0, 0.4);
    transition: transform 0.12s ease;
  }

  .primary:hover { transform: translateY(-2px); }
  .primary:active { transform: translateY(2px); box-shadow: 0 2px 0 #1c6ba3, 0 6px 12px rgba(0, 0, 0, 0.4); }

  .ghost {
    border: 0;
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.12);
    color: var(--color-fog);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .ghost:hover { background: rgba(255, 255, 255, 0.2); }

  .hint {
    margin: 0;
    max-width: 320px;
    text-align: center;
    font-size: 13px;
    color: var(--color-muted);
  }

  .error {
    margin: 0;
    font-size: 13px;
    color: #ffb4ac;
  }

  .top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
  }

  .brand {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .turn-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 10px;
    border-radius: 999px;
    background: rgba(9, 22, 40, 0.7);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.1);
    font-size: 13px;
    font-weight: 600;
  }

  .turn-chip[data-side='x'] { color: #b9f0ff; }
  .turn-chip[data-side='o'] { color: #ffc0d6; }

  .pip {
    width: 12px;
    aspect-ratio: 1;
    border-radius: 50%;
    flex: none;
  }

  .pip[data-side='x'] { background: var(--x); }
  .pip[data-side='o'] { background: var(--o); }

  .net,
  .level {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-mint);
  }

  .net.off { color: #ffb4ac; }

  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 2.4vh, 20px);
    min-height: 0;
  }

  .seats {
    display: flex;
    gap: 10px;
  }

  .seat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 9px;
    border-radius: 999px;
    background: rgba(9, 22, 40, 0.5);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.07);
    font-size: 13px;
    font-weight: 600;
    color: var(--color-muted);
    transition: box-shadow 0.25s ease, color 0.25s ease;
  }

  .seat .pip { opacity: 0.5; transition: opacity 0.25s ease; }
  .seat.active {
    color: var(--color-fog);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.28), 0 0 22px rgba(120, 190, 255, 0.25);
  }
  .seat.active .pip { opacity: 1; }

  .board {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(6px, 1.6vw, 12px);
    width: min(94vw, 74vh, 420px);
    padding: clamp(8px, 2vw, 16px);
    border-radius: clamp(16px, 3vw, 26px);
    background: linear-gradient(180deg, #1a2f4a, #0a1c31);
    box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.18), 0 26px 60px rgba(0, 0, 0, 0.5);
  }

  .cell {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.06);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.1);
    cursor: pointer;
    font-size: clamp(36px, 12vw, 72px);
    font-weight: 700;
    transition: background 0.15s ease, transform 0.12s ease;
  }

  .cell:disabled { cursor: default; }
  .cell:not(:disabled):hover { background: rgba(255, 255, 255, 0.12); transform: translateY(-2px); }
  .cell.winning { animation: ttt-win 1.1s ease-in-out infinite alternate; }

  @keyframes ttt-win {
    from { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4), 0 0 12px rgba(255, 255, 255, 0.35); }
    to { box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.95), 0 0 26px rgba(255, 255, 255, 0.7); }
  }

  .mark { line-height: 1; }
  .mark[data-side='x'] { color: var(--x); text-shadow: 0 0 12px rgba(110, 231, 255, 0.5); }
  .mark[data-side='o'] { color: var(--o); text-shadow: 0 0 12px rgba(255, 107, 157, 0.5); }
  .mark.preview { opacity: 0.45; }

  .veil {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(4, 10, 20, 0.5);
    backdrop-filter: blur(1.5px);
    animation: ttt-veil 0.25s ease-out 0.2s both;
  }

  .result {
    position: fixed;
    left: 50%;
    top: 50%;
    z-index: 30;
    width: min(360px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px;
    border-radius: 20px;
    background: linear-gradient(170deg, #123354, #0a1c31);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.14), 0 24px 60px rgba(0, 0, 0, 0.6);
    animation: ttt-result 0.3s cubic-bezier(0.2, 1.1, 0.4, 1) 0.2s both;
  }

  @keyframes ttt-veil { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ttt-result {
    from { opacity: 0; transform: translate(-50%, -50%) translateY(16px) scale(0.96); }
    to { opacity: 1; transform: translate(-50%, -50%); }
  }

  .result h2 { margin: 0; font-size: 24px; font-weight: 600; }
  .result p { margin: 0; font-size: 14px; color: var(--color-muted); }

  .result-actions { display: flex; gap: 10px; margin-top: 6px; }
  .result-actions > * { flex: 1; }

  .lobby :global(.multiplayer-menu),
  .lobby-inline :global(.multiplayer-menu) {
    display: grid;
    gap: 10px;
    margin: 0;
  }

  .lobby :global(.multiplayer-menu h2),
  .lobby-inline :global(.multiplayer-menu h2) { margin: 0; font-size: 18px; font-weight: 600; }

  .lobby :global(.eyebrow),
  .lobby-inline :global(.eyebrow) { margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.18em; color: var(--color-muted); }

  .lobby :global(.mode-options),
  .lobby-inline :global(.mode-options) { display: grid; gap: 8px; }

  .lobby :global(.mode-options button),
  .lobby-inline :global(.mode-options button) {
    display: grid; gap: 3px; text-align: left;
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px; padding: 10px 12px;
    background: transparent; color: var(--color-fog); font: inherit; cursor: pointer;
  }

  .lobby :global(.mode-options button[aria-pressed='true']),
  .lobby-inline :global(.mode-options button[aria-pressed='true']) {
    border-color: var(--color-accent); background: rgba(120, 190, 255, 0.14);
  }

  .lobby :global(.mode-options button:disabled),
  .lobby-inline :global(.mode-options button:disabled) { opacity: 0.45; cursor: default; }

  .lobby :global(.mode-options span),
  .lobby-inline :global(.mode-options span) { font-size: 11px; color: var(--color-muted); }

  .lobby :global(.party-roster),
  .lobby-inline :global(.party-roster) {
    display: grid; gap: 5px; margin: 0; padding: 0; list-style: none;
    font-size: 12px; font-weight: 600;
  }

  .lobby :global([role='status']),
  .lobby-inline :global([role='status']) { margin: 0; font-size: 12px; color: var(--color-muted); }

  .lobby :global(.actions),
  .lobby-inline :global(.actions) { display: flex; flex-wrap: wrap; gap: 8px; }

  .lobby :global(.actions button),
  .lobby-inline :global(.actions button) {
    border: 0; border-radius: 10px; padding: 9px 12px;
    background: rgba(255, 255, 255, 0.12); color: var(--color-fog);
    font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  }

  .lobby :global(.actions button:disabled) { opacity: 0.45; }
  .lobby :global([hidden]), .lobby-inline :global([hidden]) { display: none !important; }

  @media (max-width: 520px) {
    .brand { display: none; }
    .seat, .turn-chip { font-size: 12px; }
  }
</style>