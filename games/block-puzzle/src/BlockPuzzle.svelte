<script lang="ts">
  import { onDestroy } from 'svelte';
  import Board from './components/Board.svelte';
  import PieceTray from './components/PieceTray.svelte';
  import BlockPiece from './components/BlockPiece.svelte';
  import { SHAPE_BY_ID } from './engine/shapes';
  import { applyMove, createEmptyState, deserialize, hasMovesLeft, serialize, startGame } from './engine/gameState';
  import { canPlace, hasAnyPlacement, lineClear, place, resolveTapAnchor } from './engine/placement';
  import { comboMultiplier } from './engine/scoring';
  import {
    BOARD_SIZE, TRAY_SIZE,
    type Board as BoardData, type GameState, type MoveResult, type Piece, type Pos, type Shape, type Tray,
  } from './engine/types';
  import { anchorAt, readGridMetrics, type PickupDetail } from './metrics';
  import { createSound } from './sound';

  interface StorageLike {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): boolean;
    remove(key: string): void;
  }

  let { storage, reportScore }: { storage?: StorageLike; reportScore?: (score: number) => void } = $props();

  const SAVE_KEY = 'save';
  const SOUND_KEY = 'sound';
  const POP_MS = 160; /* placed tiles snap in, then lines flash in a wave */
  const CLEAR_MS = 340;

  const sound = createSound();
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  interface Drag {
    index: number;
    piece: Piece;
    shape: Shape;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    grabRow: number;
    grabCol: number;
    moving: boolean;
    /** Viewport position of the ghost's top-left corner. */
    gx: number;
    gy: number;
    /** Board cell pitch at pickup, in px. */
    pitch: number;
    /** Scale the ghost grows from, so it lifts out of the tray. */
    liftFrom: number;
    anchorRow: number;
    anchorCol: number;
    valid: boolean;
    returning: boolean;
  }

  interface Popup {
    id: number;
    x: number;
    y: number;
    text: string;
    sub: string;
  }

  interface Banner {
    id: number;
    text: string;
    sub: string;
    tone: 'cool' | 'hot';
  }

  // Engine state is the source of truth; board/tray mirror it except while a
  // move animates.
  const initial = createEmptyState();
  let engine = $state<GameState>(initial);
  let board = $state<BoardData>(initial.board);
  let tray = $state<Tray>([null, null, null]);
  let phase = $state<'idle' | 'playing' | 'gameover'>('idle');
  let paused = $state(false);
  let score = $state(0);
  let shownScore = $state(0);
  let best = $state(0);
  let combo = $state(0);
  let moves = $state(0);
  let newBest = $state(false);
  let busy = $state(false);
  let selected = $state(-1);
  let hasSave = $state(false);

  let pop = $state<ReadonlySet<number>>(new Set());
  let clearing = $state<ReadonlySet<number>>(new Set());
  let preview = $state<ReadonlySet<number>>(new Set());
  let previewLine = $state<ReadonlySet<number>>(new Set());
  let previewValid = $state(true);
  let shakeIndex = $state(-1);
  let drag = $state<Drag | null>(null);
  let popup = $state<Popup | null>(null);
  let banner = $state<Banner | null>(null);
  let shaking = $state(false);
  let confirmRestart = $state(false);

  let soundOn = $state(true);
  let hostMuted = $state(false);
  let scorePulse = $state(0);
  let gridEl = $state<HTMLElement | null>(null);

  let popupSeq = 0;
  let suppressClick = 0;
  let tweenId = 0;
  const timers = new Set<number>();

  function later(ms: number, run: () => void) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      run();
    }, ms);
    timers.add(id);
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function tweenScore(to: number) {
    cancelAnimationFrame(tweenId);
    if (reduceMotion || shownScore === to) {
      shownScore = to;
      return;
    }
    const from = shownScore;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 340);
      shownScore = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) tweenId = requestAnimationFrame(step);
    };
    tweenId = requestAnimationFrame(step);
  }

  function effectiveAudio(): boolean {
    return soundOn && !hostMuted;
  }

  // ---------------------------------------------------------------- restore
  function restoreSession() {
    const savedSound = storage?.get<unknown>(SOUND_KEY, true);
    soundOn = savedSound !== false;
    const savedBest = storage?.get<unknown>('high-score', 0);
    best = typeof savedBest === 'number' && Number.isFinite(savedBest) ? Math.max(0, Math.floor(savedBest)) : 0;
    const restored = deserialize(storage?.get<unknown>(SAVE_KEY, null));
    if (restored && restored.score > 0 && hasMovesLeft(restored)) {
      engine = restored;
      board = restored.board;
      tray = restored.tray;
      score = restored.score;
      shownScore = restored.score;
      combo = restored.combo;
      moves = restored.moves;
      hasSave = true;
    } else if (restored) {
      storage?.remove(SAVE_KEY);
    }
    sound.setEnabled(effectiveAudio());
  }
  restoreSession();

  onDestroy(() => {
    clearTimers();
    cancelAnimationFrame(tweenId);
    sound.destroy();
  });

  // ---------------------------------------------------------------- previews
  const keyOf = (pos: Pos) => pos.row * BOARD_SIZE + pos.col;

  function showPreview(shape: Shape, row: number, col: number, valid: boolean) {
    const cells = new Set<number>();
    for (const part of shape.cells) {
      const r = row + part.row;
      const c = col + part.col;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) cells.add(r * BOARD_SIZE + c);
    }
    preview = cells;
    previewValid = valid;
    if (!valid) {
      previewLine = new Set();
      return;
    }
    const after = place(engine.board, shape, row, col, 1);
    const clear = lineClear(after);
    previewLine = clear.cells.length > 0 ? new Set(clear.cells.map(keyOf)) : new Set();
  }

  function clearPreview() {
    if (preview.size > 0) preview = new Set();
    if (previewLine.size > 0) previewLine = new Set();
  }

  // ---------------------------------------------------------------- tray
  function onTrayPickup(index: number, detail: PickupDetail) {
    if (busy || paused || phase !== 'playing' || drag) return;
    const piece = tray[index];
    if (!piece) return;
    const shape = SHAPE_BY_ID.get(piece.shapeId);
    if (!shape) return;
    const pitch = gridEl ? readGridMetrics(gridEl).pitch : Math.max(24, detail.cell * 2);
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
    drag = {
      index,
      piece,
      shape,
      pointerId: detail.pointerId,
      pointerType: detail.pointerType,
      startX: detail.x,
      startY: detail.y,
      grabRow: clamp(Math.floor((detail.y - detail.rect.top) / detail.cell), shape.height - 1),
      grabCol: clamp(Math.floor((detail.x - detail.rect.left) / detail.cell), shape.width - 1),
      moving: false,
      gx: detail.rect.left,
      gy: detail.rect.top,
      pitch,
      liftFrom: Math.min(1, detail.cell / pitch),
      anchorRow: 0,
      anchorCol: 0,
      valid: false,
      returning: false,
    };
    sound.unlock();
  }

  function onTrayActivate(index: number) {
    if (busy || paused || phase !== 'playing') return;
    if (performance.now() < suppressClick) return;
    const piece = tray[index];
    if (!piece) return;
    sound.unlock();
    if (selected === index) {
      selected = -1;
      clearPreview();
      return;
    }
    selected = index;
    clearPreview();
    sound.play('pick');
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!drag.moving) {
      if (Math.abs(x - drag.startX) + Math.abs(y - drag.startY) < 7) {
        drag = { ...drag, gx: x, gy: y };
        return;
      }
      selected = -1;
      clearPreview();
      drag = { ...drag, moving: true };
      sound.play('pick');
    }
    const lift = drag.pointerType === 'touch' ? 56 : 0;
    const gx = x - (drag.grabCol + 0.5) * drag.pitch;
    const gy = y - lift - (drag.grabRow + 0.5) * drag.pitch;
    let anchorRow = -99;
    let anchorCol = -99;
    let valid = false;
    if (gridEl) {
      const anchor = anchorAt(readGridMetrics(gridEl), gx, gy);
      anchorRow = anchor.row;
      anchorCol = anchor.col;
      valid = canPlace(engine.board, drag.shape, anchorRow, anchorCol);
    }
    drag = { ...drag, gx, gy, anchorRow, anchorCol, valid };
    showPreview(drag.shape, anchorRow, anchorCol, valid);
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    if (!current.moving) {
      drag = null;
      return;
    }
    suppressClick = performance.now() + 240;
    clearPreview();
    if (current.valid && canPlace(engine.board, current.shape, current.anchorRow, current.anchorCol)) {
      drag = null;
      runMove(current.index, current.anchorRow, current.anchorCol);
      return;
    }
    sound.play('invalid');
    drag = { ...current, returning: true };
    later(170, () => {
      if (drag?.returning) drag = null;
    });
  }

  function cancelDrag() {
    if (!drag) return;
    if (drag.moving) suppressClick = performance.now() + 240;
    drag = null;
    clearPreview();
  }

  // ---------------------------------------------------------------- board input
  function onBoardHover(index: number | null) {
    if (drag?.moving) return;
    if (busy || paused || phase !== 'playing' || selected < 0) {
      clearPreview();
      return;
    }
    const piece = tray[selected];
    if (!piece) return;
    const shape = SHAPE_BY_ID.get(piece.shapeId);
    if (!shape || index === null) {
      clearPreview();
      return;
    }
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const anchor = resolveTapAnchor(engine.board, shape, row, col);
    if (anchor) showPreview(shape, anchor.row, anchor.col, true);
    else showPreview(shape, row - Math.floor((shape.height - 1) / 2), col - Math.floor((shape.width - 1) / 2), false);
  }

  function onBoardTap(index: number) {
    if (busy || paused || phase !== 'playing' || selected < 0 || drag) return;
    const piece = tray[selected];
    if (!piece) return;
    const shape = SHAPE_BY_ID.get(piece.shapeId);
    if (!shape) return;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const anchor = resolveTapAnchor(engine.board, shape, row, col);
    if (!anchor) {
      sound.play('invalid');
      shakeIndex = selected;
      showPreview(shape, row - Math.floor((shape.height - 1) / 2), col - Math.floor((shape.width - 1) / 2), false);
      later(320, () => {
        if (shakeIndex === selected) shakeIndex = -1;
        if (!busy) clearPreview();
      });
      return;
    }
    runMove(selected, anchor.row, anchor.col);
  }

  // ---------------------------------------------------------------- moves
  function runMove(index: number, row: number, col: number) {
    if (busy || phase !== 'playing') return;
    const result = applyMove(engine, index, row, col, Math.random);
    if (!result) return;
    busy = true;
    selected = -1;
    drag = null;
    sound.play('place');
    engine = result.next;
    tray = tray.map((piece, slot) => (slot === index ? null : piece));
    board = result.boardAfterPlace;
    pop = new Set(result.placedCells.map(keyOf));

    const settle = () => {
      board = engine.board;
      pop = new Set();
      clearing = new Set();
      combo = engine.combo;
      moves = engine.moves;
      score = engine.score;
      tweenScore(engine.score);
      scorePulse++;
      if (result.refilled) tray = engine.tray;
      if (result.gameOver) finishGame();
      busy = false;
      persist();
      reportScore?.(engine.score);
    };

    if (result.clear.cells.length === 0) {
      if (reduceMotion) settle();
      else later(POP_MS, settle);
      return;
    }

    const beginClear = () => {
      pop = new Set();
      clearing = new Set(result.clear.cells.map(keyOf));
      showClearPopup(result);
      sound.play(result.points.lines >= 2 || result.combo >= 2 ? 'multi' : 'clear', Math.max(result.points.lines, result.combo));
      if (result.points.lines >= 2 && !reduceMotion) {
        shaking = true;
        later(340, () => {
          shaking = false;
        });
      }
      if (reduceMotion) settle();
      else later(CLEAR_MS, settle);
    };
    if (reduceMotion) beginClear();
    else later(POP_MS, beginClear);
  }

  function praiseFor(lines: number, comboCount: number): { text: string; tone: 'cool' | 'hot' } | null {
    if (lines >= 4 || comboCount >= 5) return { text: 'Amazing!', tone: 'hot' };
    if (lines === 3 || comboCount === 4) return { text: 'Excellent!', tone: 'hot' };
    if (lines === 2 || comboCount === 3) return { text: 'Great!', tone: 'hot' };
    if (comboCount === 2) return { text: 'Nice!', tone: 'cool' };
    return null;
  }

  function showClearPopup(result: MoveResult) {
    const cells = result.clear.cells;
    const row = cells.reduce((sum, cell) => sum + cell.row, 0) / cells.length;
    const col = cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length;
    const sub = result.combo > 1
      ? `combo ${multiplierLabel(result.combo)}`
      : result.points.lines > 1
        ? `${result.points.lines} lines`
        : '';
    popup = {
      id: ++popupSeq,
      x: ((col + 0.5) / BOARD_SIZE) * 100,
      y: ((row + 0.5) / BOARD_SIZE) * 100,
      text: `+${result.points.clear}`,
      sub,
    };
    const praise = praiseFor(result.points.lines, result.combo);
    if (praise && !reduceMotion) {
      const id = popup.id;
      const comboSub = result.combo > 1 ? `Combo ${multiplierLabel(result.combo)} · ` : '';
      banner = { id, text: praise.text, sub: `${comboSub}+${result.points.clear}`, tone: praise.tone };
      later(950, () => {
        if (banner?.id === id) banner = null;
      });
    }
  }

  function finishGame() {
    const previous = best;
    best = Math.max(best, engine.score);
    newBest = engine.score > previous;
    phase = 'gameover';
    selected = -1;
    storage?.remove(SAVE_KEY);
    storage?.set('high-score', best);
    sound.play('over');
  }

  function persist() {
    if (!storage) return;
    if (engine.status === 'playing') storage.set(SAVE_KEY, serialize(engine));
    else storage.remove(SAVE_KEY);
  }

  // ---------------------------------------------------------------- flow
  function startFresh() {
    clearTimers();
    cancelAnimationFrame(tweenId);
    engine = startGame(Math.random);
    board = engine.board;
    tray = engine.tray;
    phase = 'playing';
    paused = false;
    busy = false;
    selected = -1;
    combo = 0;
    moves = 0;
    score = 0;
    shownScore = 0;
    newBest = false;
    hasSave = false;
    pop = new Set();
    clearing = new Set();
    preview = new Set();
    previewLine = new Set();
    drag = null;
    popup = null;
    banner = null;
    shaking = false;
    confirmRestart = false;
    sound.unlock();
    sound.play('start');
    persist();
  }

  function continueGame() {
    phase = 'playing';
    sound.unlock();
    sound.play('start');
    persist();
  }

  function toggleSound() {
    soundOn = !soundOn;
    sound.setEnabled(effectiveAudio());
    storage?.set(SOUND_KEY, soundOn);
    if (soundOn) sound.play('pick');
  }

  function requestRestart() {
    if (phase !== 'playing') return;
    cancelDrag();
    confirmRestart = true;
    sound.unlock();
  }

  // Host lifecycle bridge — main.ts calls these through the mount exports.
  export function pause() {
    paused = true;
    cancelDrag();
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

  // ---------------------------------------------------------------- helpers
  const format = (value: number) => Math.round(value).toLocaleString('en-US');

  function multiplierLabel(comboCount: number): string {
    const value = comboMultiplier(comboCount);
    return Number.isInteger(value) ? `×${value}` : `×${value.toFixed(1)}`;
  }

  const canInteract = $derived(!busy && !paused && phase === 'playing');

  const playable = $derived(
    tray.map(piece => {
      if (!piece) return true;
      const shape = SHAPE_BY_ID.get(piece.shapeId);
      return shape ? hasAnyPlacement(engine.board, shape) : true;
    }),
  );

  // Shared utility stacks for the markup below.
  const ICON_BTN = 'grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[11px] border border-edge bg-[rgba(35,32,48,0.6)] p-0 text-muted transition-colors hover:border-[rgba(185,163,247,0.5)] hover:text-fog focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px] [&_svg]:h-[21px] [&_svg]:w-[21px]';
  const VEIL = 'absolute inset-0 z-[8] grid animate-veil place-items-center bg-[rgba(19,17,24,0.6)] p-[16px] backdrop-blur-[4px]';
  const VEIL_DIM = 'absolute inset-0 z-[9] grid animate-veil place-items-center bg-[rgba(19,17,24,0.52)] p-[16px] backdrop-blur-[4px]';
  const PANEL = 'grid animate-panel justify-items-center gap-[10px] rounded-[20px] border border-edge bg-panel px-[22px] pt-[22px] pb-[18px] text-center shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] w-[min(100%,320px)]';
  const PANEL_SMALL = 'grid animate-panel justify-items-center gap-[10px] rounded-[20px] border border-edge bg-panel p-[18px] text-center shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] w-[min(100%,280px)]';
  const BTN = 'cursor-pointer rounded-[12px] border border-edge bg-[rgba(35,32,48,0.7)] px-[18px] py-[11px] text-[14px] font-semibold text-fog transition-[transform,background-color,border-color] duration-[120ms] hover:bg-[#262336] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
  const BTN_PRIMARY = 'cursor-pointer rounded-[12px] border border-accent bg-accent px-[18px] py-[11px] text-[14px] font-semibold text-accent-ink transition-[transform,background-color,border-color] duration-[120ms] hover:bg-[#c8b5ff] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
  const BTN_QUIET = 'cursor-pointer rounded-[12px] border border-transparent bg-none px-[12px] py-[7px] text-[13px] font-medium text-muted transition-colors hover:bg-[rgba(35,32,48,0.6)] hover:text-fog focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[2px]';
</script>

<div class="relative grid h-full place-items-center p-[12px]">
  <div class="grid w-[min(94vw,56vh,520px)] gap-[10px] short:w-[min(92vw,680px)] short:grid-cols-[minmax(0,1.1fr)_minmax(180px,0.9fr)] short:[grid-template-areas:'bar_bar'_'board_stats'_'board_tray'] short:gap-x-[16px] short:content-center">
    <header class="relative z-10 flex min-h-[40px] items-center justify-between short:[grid-area:bar]">
      <div class="flex items-center gap-[9px] font-display text-[17px] font-semibold [&_svg]:h-[26px] [&_svg]:w-[26px]">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect x="4" y="26" width="18" height="18" rx="5" fill="#b9a3f7"></rect>
          <rect x="26" y="26" width="18" height="18" rx="5" fill="#8fd6b8"></rect>
          <rect x="15" y="5" width="18" height="18" rx="5" fill="#f5c76b"></rect>
        </svg>
        <span>Blockwave</span>
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

    <div class="grid min-h-[56px] grid-cols-[1fr_auto_1fr] items-end gap-[10px] short:[grid-area:stats] short:self-end">
      <div class="grid gap-[2px]">
        <span class="block text-[12px] text-muted">Score</span>
        {#key scorePulse}
          <strong class="block animate-score font-display text-[27px] leading-[1.1] font-semibold [font-variant-numeric:tabular-nums]">{format(shownScore)}</strong>
        {/key}
      </div>
      {#if combo > 1}
        <div class="self-end justify-self-center rounded-full border border-[rgba(185,163,247,0.42)] bg-[rgba(185,163,247,0.13)] px-[11px] pt-[4px] pb-[5px] font-display text-[13px] font-semibold text-accent" role="status">
          {#key combo}<span class="inline-block animate-chip">Combo {multiplierLabel(combo)}</span>{/key}
        </div>
      {:else}
        <div class="invisible min-w-px self-end justify-self-center" aria-hidden="true"></div>
      {/if}
      <div class="grid justify-items-end gap-[2px] text-right">
        <span class="block text-[12px] text-muted">Best</span>
        <strong class="block font-display text-[27px] leading-[1.1] font-semibold [font-variant-numeric:tabular-nums]">{format(Math.max(best, score))}</strong>
      </div>
    </div>

    <div class="relative short:[grid-area:board] short:w-[min(100%,68vh)] short:justify-self-center short:self-center">
      <div class="board-shaker" class:shaking>
        <Board
          bind:grid={gridEl}
          {board}
          {pop}
          {clearing}
          {preview}
          {previewLine}
          {previewValid}
          onhover={onBoardHover}
          ontap={onBoardTap}
        />
      </div>
      {#if banner}
        {#key banner.id}
          <div class="banner" class:cool={banner.tone === 'cool'} class:hot={banner.tone === 'hot'}>
            <strong>{banner.text}</strong>
            {#if banner.sub}<span>{banner.sub}</span>{/if}
          </div>
        {/key}
      {/if}
      {#if popup}
        {#key popup.id}
          <div class="pointer-events-none absolute z-[3] grid animate-rise justify-items-center" style="left: {popup.x}%; top: {popup.y}%">
            <strong class="font-display text-[21px] font-semibold [text-shadow:0_2px_10px_rgba(0,0,0,0.65)]">{popup.text}</strong>
            {#if popup.sub && !banner}<span class="font-display text-[11px] font-semibold text-accent">{popup.sub}</span>{/if}
          </div>
        {/key}
      {/if}
    </div>

    <div class="grid gap-[8px] short:[grid-area:tray] short:self-start">
      <PieceTray
        {tray}
        {selected}
        {playable}
        hidden={drag?.moving ? drag.index : -1}
        shake={shakeIndex}
        disabled={!canInteract}
        onpickup={onTrayPickup}
        onactivate={onTrayActivate}
      />
      {#if moves === 0 && phase === 'playing'}
        <p class="m-0 text-center text-[12.5px] text-muted short:hidden">Drag a block onto the board — or tap a block, then a cell.</p>
      {/if}
    </div>
  </div>

  {#if phase === 'idle'}
    <div class={VEIL}>
      <div class={PANEL}>
        <svg class="h-[46px] w-[46px]" viewBox="0 0 48 48" aria-hidden="true">
          <rect x="4" y="26" width="18" height="18" rx="5" fill="#b9a3f7"></rect>
          <rect x="26" y="26" width="18" height="18" rx="5" fill="#8fd6b8"></rect>
          <rect x="15" y="5" width="18" height="18" rx="5" fill="#f5c76b"></rect>
        </svg>
        <h1 class="m-0 font-display text-[27px] font-semibold tracking-[-0.01em]">Blockwave</h1>
        <p class="m-0 text-[14px] leading-[1.55] text-muted">Fill a row or column to clear it. Fill several at once for more points — and clear on back-to-back moves to build your combo.</p>
        {#if hasSave}
          <p class="m-0 text-[14px] font-semibold leading-[1.55] text-fog">Run in progress: {format(score)} points, {moves} moves.</p>
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
        <p class="m-0 font-semibold text-fog">The board is locked</p>
        <p class="m-0 font-display text-[40px] leading-[1.05] font-semibold text-fog">{format(score)}</p>
        {#if newBest}<p class="m-0 font-semibold text-accent">New best score</p>{/if}
        <p class="m-0 text-[14px] leading-[1.55] text-muted">{moves} {moves === 1 ? 'move' : 'moves'} · best {format(best)}</p>
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
        <p class="m-0 text-[14px] leading-[1.55] text-muted">This run ends and the board is cleared.</p>
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
        <p class="m-0 text-[14px] leading-[1.55] text-muted">Use the player controls to resume.</p>
      </div>
    </div>
  {/if}

  {#if drag?.moving}
    <div
      class="ghost pointer-events-none fixed left-0 top-0 z-[40]"
      class:returning={drag.returning}
      class:valid={drag.valid}
      class:invalid={!drag.valid}
      style="transform: translate3d({drag.gx}px, {drag.gy}px, 0)"
    >
      <div class="ghost-inner" style="--lift: {drag.liftFrom}">
        <BlockPiece shape={drag.shape} color={drag.piece.color} cell={drag.pitch} />
      </div>
    </div>
  {/if}
</div>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={cancelDrag} />
