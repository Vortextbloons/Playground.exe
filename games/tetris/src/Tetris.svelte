<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Board from './components/Board.svelte';
  import NextQueue from './components/NextQueue.svelte';
  import {
    clearLines, collides, createBoard, drawSpawn, dropRow, gravityInterval,
    levelFor, LOCK_DELAY_MS, MAX_LOCK_RESETS, scoreForLines, serialize, deserialize,
    tryMove, tryRotate, lockPiece,
  } from './engine/game';
  import { cellsFor, COLOR } from './engine/pieces';
  import { COLS, type ActivePiece, type Board as BoardData, type PieceKind } from './engine/types';
  import { createSound } from './sound';

  interface StorageLike {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): boolean;
    remove(key: string): void;
  }

  let { storage, reportScore }: { storage?: StorageLike; reportScore?: (score: number) => void } = $props();

  const SAVE_KEY = 'save';
  const SOUND_KEY = 'sound';
  const CLEAR_MS = 240;

  const sound = createSound();
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let board = $state<BoardData>(createBoard());
  let active = $state<ActivePiece | null>(null);
  let queue = $state<PieceKind[]>([]);
  let frozen = $state<BoardData | null>(null);
  let clearing = $state<ReadonlySet<number>>(new Set());
  let phase = $state<'idle' | 'playing' | 'gameover'>('idle');
  let paused = $state(false);
  let busy = $state(false);
  let score = $state(0);
  let lines = $state(0);
  let level = $state(0);
  let best = $state(0);
  let newBest = $state(false);
  let hasSave = $state(false);
  let banner = $state<{ id: number; text: string; sub: string } | null>(null);
  let confirmRestart = $state(false);
  let soundOn = $state(true);
  let hostMuted = $state(false);
  let softDrop = $state(false);

  let fallAcc = 0;
  let lockAcc = 0;
  let lockResets = 0;
  let bannerSeq = 0;
  let raf = 0;
  let last = 0;
  let settleTimer = 0;
  const repeatTimers = new Set<number>();

  function effectiveAudio(): boolean {
    return soundOn && !hostMuted;
  }

  const grounded = (piece: ActivePiece): boolean =>
    collides(board, piece.kind, piece.rot, piece.row + 1, piece.col);

  function resetLock(piece: ActivePiece) {
    if (grounded(piece) && lockResets < MAX_LOCK_RESETS) {
      lockAcc = 0;
      lockResets++;
    }
  }

  function showBanner(text: string, sub: string) {
    if (reduceMotion) return;
    const id = ++bannerSeq;
    banner = { id, text, sub };
    window.setTimeout(() => {
      if (banner?.id === id) banner = null;
    }, 1100);
  }

  function persist() {
    if (!storage) return;
    if (phase === 'playing' && active) storage.set(SAVE_KEY, serialize(board, active, queue, score, lines, level));
    else storage.remove(SAVE_KEY);
  }

  function restoreSession() {
    soundOn = storage?.get<unknown>(SOUND_KEY, true) !== false;
    const savedBest = storage?.get<unknown>('high-score', 0);
    best = typeof savedBest === 'number' && Number.isFinite(savedBest) ? Math.max(0, Math.floor(savedBest)) : 0;
    const restored = deserialize(storage?.get<unknown>(SAVE_KEY, null));
    if (restored && (restored.score > 0 || restored.lines > 0)) {
      board = restored.board;
      active = restored.active;
      queue = restored.queue;
      score = restored.score;
      lines = restored.lines;
      level = restored.level;
      hasSave = true;
    } else if (restored) {
      storage?.remove(SAVE_KEY);
    }
    sound.setEnabled(effectiveAudio());
  }
  restoreSession();

  function spawnNext() {
    const result = drawSpawn(board, queue, Math.random);
    queue = result.queue;
    if (result.gameOver) {
      active = null;
      finishGame();
      return;
    }
    active = result.active;
    fallAcc = 0;
    lockAcc = 0;
    lockResets = 0;
  }

  function afterLock(lockedOut: boolean) {
    if (lockedOut) {
      finishGame();
      return;
    }
    spawnNext();
    persist();
    reportScore?.(score);
  }

  function lockActive() {
    if (!active || busy || phase !== 'playing') return;
    const piece = active;
    active = null;
    softDrop = false;
    const locked = lockPiece(board, piece);
    sound.play('lock');
    const cleared = clearLines(locked.board);
    if (cleared.cleared === 0) {
      board = locked.board;
      afterLock(locked.lockedOut);
      return;
    }
    const gained = scoreForLines(cleared.cleared, level);
    const settle = () => {
      board = cleared.board;
      frozen = null;
      clearing = new Set();
      score += gained;
      lines += cleared.cleared;
      const nextLevel = levelFor(lines);
      if (nextLevel > level) {
        level = nextLevel;
        sound.play('level');
        showBanner(`Level ${nextLevel}`, `${gravityLabel()} drop speed`);
      }
      sound.play('clear', cleared.cleared);
      if (cleared.cleared === 4) showBanner('Stack clear!', `+${gained}`);
      busy = false;
      afterLock(locked.lockedOut);
    };
    if (reduceMotion) {
      settle();
      return;
    }
    busy = true;
    frozen = locked.board;
    clearing = new Set(cleared.rows.flatMap(row => Array.from({ length: COLS }, (_, col) => row * COLS + col)));
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, CLEAR_MS);
  }

  function gravityLabel(): string {
    return `${gravityInterval(level)}ms`;
  }

  function shift(dir: -1 | 1) {
    if (!active || busy || paused || phase !== 'playing') return;
    const next = tryMove(board, active, 0, dir);
    if (!next) return;
    active = next;
    resetLock(next);
    sound.play('move');
  }

  function rotate(dir: 1 | -1) {
    if (!active || busy || paused || phase !== 'playing') return;
    const next = tryRotate(board, active, dir);
    if (!next) return;
    active = next;
    resetLock(next);
    sound.play('rotate');
  }

  function hardDrop() {
    if (!active || busy || paused || phase !== 'playing') return;
    const row = dropRow(board, active);
    score += (row - active.row) * 2;
    active = { ...active, row };
    sound.play('drop');
    lockActive();
  }

  function step(now: number) {
    if (!active) return;
    const interval = softDrop ? Math.min(40, gravityInterval(level) / 20) : gravityInterval(level);
    fallAcc += now;
    let guard = 0;
    while (fallAcc >= interval && guard++ < 40) {
      fallAcc -= interval;
      const moved = tryMove(board, active, 1, 0);
      if (!moved) break;
      active = moved;
      if (softDrop) score += 1;
    }
    if (grounded(active)) {
      lockAcc += now * (softDrop ? 6 : 1);
      if (lockAcc >= LOCK_DELAY_MS) lockActive();
    } else {
      lockAcc = 0;
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - (last || now));
    last = now;
    if (phase !== 'playing' || paused || busy || !active) return;
    step(dt);
  }

  onMount(() => {
    raf = requestAnimationFrame(frame);
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    window.clearTimeout(settleTimer);
    for (const id of repeatTimers) {
      window.clearInterval(id);
      window.clearTimeout(id);
    }
    repeatTimers.clear();
    sound.destroy();
  });

  function startFresh() {
    window.clearTimeout(settleTimer);
    cancelAnimationFrame(raf);
    board = createBoard();
    frozen = null;
    clearing = new Set();
    score = 0;
    lines = 0;
    level = 0;
    newBest = false;
    hasSave = false;
    busy = false;
    paused = false;
    softDrop = false;
    confirmRestart = false;
    queue = [];
    phase = 'playing';
    sound.unlock();
    sound.play('start');
    spawnNext();
    persist();
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function continueGame() {
    phase = 'playing';
    sound.unlock();
    sound.play('start');
    persist();
  }

  function finishGame() {
    best = Math.max(best, score);
    newBest = score > 0 && score >= best;
    phase = 'gameover';
    paused = false;
    softDrop = false;
    frozen = null;
    clearing = new Set();
    busy = false;
    storage?.remove(SAVE_KEY);
    storage?.set('high-score', best);
    sound.play('over');
    reportScore?.(score);
  }

  function toggleSound() {
    soundOn = !soundOn;
    sound.setEnabled(effectiveAudio());
    storage?.set(SOUND_KEY, soundOn);
    if (soundOn) sound.play('rotate');
  }

  function requestRestart() {
    if (phase !== 'playing') return;
    if (score === 0 && lines === 0) {
      startFresh();
      return;
    }
    confirmRestart = true;
    sound.unlock();
  }

  function togglePause() {
    if (phase !== 'playing') return;
    paused = !paused;
    softDrop = false;
    sound.unlock();
  }

  export function pause() {
    paused = true;
    softDrop = false;
  }

  export function resume() {
    paused = false;
  }

  export function restart() {
    startFresh();
  }

  export function setMuted(muted: boolean) {
    hostMuted = muted;
    sound.setEnabled(effectiveAudio());
  }

  function keys(event: KeyboardEvent) {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (phase !== 'playing') {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        startFresh();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        shift(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        shift(1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        softDrop = true;
        break;
      case 'ArrowUp':
      case 'x':
      case 'X':
        event.preventDefault();
        if (!event.repeat) rotate(1);
        break;
      case 'z':
      case 'Z':
        event.preventDefault();
        if (!event.repeat) rotate(-1);
        break;
      case ' ':
        event.preventDefault();
        if (!event.repeat) hardDrop();
        break;
      case 'p':
      case 'P':
      case 'Escape':
        event.preventDefault();
        togglePause();
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        requestRestart();
        break;
    }
  }

  function releaseSoft(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') softDrop = false;
  }

  function holdRepeat(action: () => void) {
    action();
    const delay = window.setTimeout(() => {
      const id = window.setInterval(action, 65);
      repeatTimers.add(id);
    }, 180);
    repeatTimers.add(delay);
  }

  function endRepeat() {
    for (const id of repeatTimers) {
      window.clearInterval(id);
      window.clearTimeout(id);
    }
    repeatTimers.clear();
    softDrop = false;
  }

  function pressLeft() { shift(-1); }
  function pressRight() { shift(1); }
  function pressDown() {
    if (!active || busy || paused || phase !== 'playing') return;
    const moved = tryMove(board, active, 1, 0);
    if (moved) {
      active = moved;
      score += 1;
    }
    softDrop = true;
  }

  const shown = $derived(frozen ?? board);

  const activeCells = $derived.by(() => {
    const cells = new Map<number, number>();
    if (active && !frozen) {
      const color = COLOR[active.kind];
      for (const cell of cellsFor(active.kind, active.rot)) {
        const r = active.row + cell.row;
        const c = active.col + cell.col;
        if (r >= 0) cells.set(r * COLS + c, color);
      }
    }
    return cells;
  });

  const ghostCells = $derived.by(() => {
    const cells = new Map<number, number>();
    if (!active || frozen) return cells;
    const color = COLOR[active.kind];
    const row = dropRow(board, active);
    for (const cell of cellsFor(active.kind, active.rot)) {
      const r = row + cell.row;
      const c = active.col + cell.col;
      if (r >= 0 && !activeCells.has(r * COLS + c)) cells.set(r * COLS + c, color);
    }
    return cells;
  });

  const canInteract = $derived(phase === 'playing' && !paused && !busy);
  const format = (value: number) => Math.round(value).toLocaleString('en-US');

  const ICON_BTN = 'grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[11px] border border-edge bg-[rgba(35,32,48,0.6)] p-0 text-muted transition-colors hover:border-[rgba(185,163,247,0.5)] hover:text-fog focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px] [&_svg]:h-[21px] [&_svg]:w-[21px]';
  const VEIL = 'absolute inset-0 z-[8] grid animate-veil place-items-center bg-[rgba(19,17,24,0.6)] p-[16px] backdrop-blur-[4px]';
  const VEIL_DIM = 'absolute inset-0 z-[9] grid animate-veil place-items-center bg-[rgba(19,17,24,0.52)] p-[16px] backdrop-blur-[4px]';
  const PANEL = 'grid animate-panel justify-items-center gap-[10px] rounded-[20px] border border-edge bg-panel px-[22px] pt-[22px] pb-[18px] text-center shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] w-[min(100%,320px)]';
  const PANEL_SMALL = 'grid animate-panel justify-items-center gap-[10px] rounded-[20px] border border-edge bg-panel p-[18px] text-center shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] w-[min(100%,280px)]';
  const BTN = 'cursor-pointer rounded-[12px] border border-edge bg-[rgba(35,32,48,0.7)] px-[18px] py-[11px] text-[14px] font-semibold text-fog transition-[transform,background-color,border-color] duration-[120ms] hover:bg-[#262336] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
  const BTN_PRIMARY = 'cursor-pointer rounded-[12px] border border-accent bg-accent px-[18px] py-[11px] text-[14px] font-semibold text-accent-ink transition-[transform,background-color,border-color] duration-[120ms] hover:bg-[#c8b5ff] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
  const BTN_QUIET = 'cursor-pointer rounded-[12px] border border-transparent bg-none px-[12px] py-[7px] text-[13px] font-medium text-muted transition-colors hover:bg-[rgba(35,32,48,0.6)] hover:text-fog focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
</script>

<svelte:window onkeydown={keys} onkeyup={releaseSoft} />

<div class="relative grid h-full place-items-center p-[12px]">
  <div class="stage">
    <header class="flex min-h-[40px] items-center justify-between">
      <div class="flex items-center gap-[9px] font-display text-[17px] font-semibold [&_svg]:h-[26px] [&_svg]:w-[26px]">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect x="4" y="26" width="18" height="18" rx="5" fill="#7cc3f2"></rect>
          <rect x="26" y="26" width="18" height="18" rx="5" fill="#f5c76b"></rect>
          <rect x="15" y="5" width="18" height="18" rx="5" fill="#b9a3f7"></rect>
        </svg>
        <span>Stack Drop</span>
      </div>
      <div class="flex gap-[8px]">
        <button
          type="button"
          class={ICON_BTN}
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
          onclick={toggleSound}
        >
          {#if soundOn}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"></path><path d="M15.5 8.8a4.4 4.4 0 0 1 0 6.4M17.8 6.4a7.6 7.6 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"></path><path d="m15.5 10 4.5 4m0-4-4.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
          {/if}
        </button>
        {#if phase === 'playing'}
          <button type="button" class={ICON_BTN} aria-label="Start a new game" onclick={requestRestart}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.5A7.6 7.6 0 1 0 19.6 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M19.5 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          </button>
        {/if}
      </div>
    </header>

    <div class="play">
      <div class="well">
        <Board board={shown} active={activeCells} ghost={ghostCells} {clearing} />
        {#if banner}
          {#key banner.id}
            <div class="banner hot">
              <strong>{banner.text}</strong>
              {#if banner.sub}<span>{banner.sub}</span>{/if}
            </div>
          {/key}
        {/if}
      </div>
      <aside class="side">
        <div class="stat">
          <span>Score</span>
          <strong>{format(score)}</strong>
        </div>
        <div class="stat">
          <span>Best</span>
          <strong>{format(Math.max(best, score))}</strong>
        </div>
        <div class="stat-row">
          <div class="stat">
            <span>Level</span>
            <strong>{level + 1}</strong>
          </div>
          <div class="stat">
            <span>Lines</span>
            <strong>{lines}</strong>
          </div>
        </div>
        <div class="next">
          <span>Next</span>
          <NextQueue queue={queue} />
        </div>
      </aside>
    </div>

    <div class="touch" role="group" aria-label="Touch controls">
      <button type="button" aria-label="Move left"
        onpointerdown={() => holdRepeat(pressLeft)} onpointerup={endRepeat} onpointercancel={endRepeat} onpointerleave={endRepeat}>◀</button>
      <button type="button" aria-label="Move right"
        onpointerdown={() => holdRepeat(pressRight)} onpointerup={endRepeat} onpointercancel={endRepeat} onpointerleave={endRepeat}>▶</button>
      <button type="button" aria-label="Soft drop"
        onpointerdown={() => holdRepeat(pressDown)} onpointerup={endRepeat} onpointercancel={endRepeat} onpointerleave={endRepeat}>▼</button>
      <button type="button" aria-label="Rotate" onclick={() => rotate(1)}>⟳</button>
      <button type="button" aria-label="Hard drop" onclick={hardDrop}>⤓</button>
    </div>
  </div>

  {#if phase === 'idle'}
    <div class={VEIL}>
      <div class={PANEL}>
        <svg class="h-[46px] w-[46px]" viewBox="0 0 48 48" aria-hidden="true">
          <rect x="4" y="26" width="18" height="18" rx="5" fill="#7cc3f2"></rect>
          <rect x="26" y="26" width="18" height="18" rx="5" fill="#f5c76b"></rect>
          <rect x="15" y="5" width="18" height="18" rx="5" fill="#b9a3f7"></rect>
        </svg>
        <h1 class="m-0 font-display text-[27px] font-semibold tracking-[-0.01em]">Stack Drop</h1>
        <p class="m-0 text-[14px] leading-[1.55] text-muted">Place falling blocks to fill rows. Four rows at once scores big — every 10 lines the drop gets faster.</p>
        {#if hasSave}
          <p class="m-0 text-[14px] font-semibold leading-[1.55] text-fog">Run in progress: {format(score)} points, {lines} lines.</p>
        {/if}
        <div class="mt-[4px] flex flex-wrap justify-center gap-[8px]">
          {#if hasSave}
            <button type="button" class={BTN_PRIMARY} onclick={continueGame}>Continue run</button>
            <button type="button" class={BTN} onclick={startFresh}>Start over</button>
          {:else}
            <button type="button" class={BTN_PRIMARY} onclick={startFresh}>Play</button>
          {/if}
        </div>
        <button type="button" class={BTN_QUIET} onclick={toggleSound} aria-pressed={soundOn}>{soundOn ? 'Sound on' : 'Sound off'}</button>
        <p class="m-0 text-[13px] leading-[1.55] text-muted">Best score {format(best)}</p>
      </div>
    </div>
  {:else if phase === 'gameover'}
    <div class={VEIL}>
      <div class={PANEL} role="status">
        <p class="m-0 font-semibold text-fog">The well is full</p>
        <p class="m-0 font-display text-[40px] leading-[1.05] font-semibold text-fog">{format(score)}</p>
        {#if newBest}<p class="m-0 font-semibold text-accent">New best score</p>{/if}
        <p class="m-0 text-[14px] leading-[1.55] text-muted">{lines} {lines === 1 ? 'line' : 'lines'} · level {level + 1} · best {format(best)}</p>
        <div class="mt-[4px] flex flex-wrap justify-center gap-[8px]">
          <button type="button" class={BTN_PRIMARY} onclick={startFresh}>Play again</button>
        </div>
      </div>
    </div>
  {/if}

  {#if confirmRestart}
    <div class={VEIL_DIM}>
      <div class={PANEL_SMALL} role="dialog" aria-label="Start a new game">
        <h3 class="m-0 font-display text-[18px] font-semibold">Start over?</h3>
        <p class="m-0 text-[14px] leading-[1.55] text-muted">This run ends and the well is cleared.</p>
        <div class="mt-[4px] flex flex-wrap justify-center gap-[8px]">
          <button type="button" class={BTN_PRIMARY} onclick={startFresh}>Start over</button>
          <button type="button" class={BTN} onclick={() => (confirmRestart = false)}>Keep playing</button>
        </div>
      </div>
    </div>
  {/if}

  {#if paused && phase === 'playing'}
    <div class={VEIL_DIM}>
      <div class={PANEL_SMALL}>
        <h3 class="m-0 font-display text-[18px] font-semibold">Paused</h3>
        <p class="m-0 text-[14px] leading-[1.55] text-muted">Press P or use resume to keep stacking.</p>
        <div class="mt-[4px] flex flex-wrap justify-center gap-[8px]">
          <button type="button" class={BTN_PRIMARY} onclick={togglePause}>Resume</button>
        </div>
      </div>
    </div>
  {/if}

  {#if !canInteract}
    <div class="sr-only" role="status">Game {phase}{paused ? ', paused' : ''}</div>
  {/if}
</div>
