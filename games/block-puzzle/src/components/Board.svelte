<script lang="ts">
  import { BOARD_SIZE, type Board as BoardData } from '../engine/types';
  import { cellAt, readGridMetrics } from '../metrics';

  let {
    board,
    pop = new Set<number>(),
    clearing = new Set<number>(),
    preview = new Set<number>(),
    previewLine = new Set<number>(),
    previewValid = true,
    onhover,
    ontap,
    grid = $bindable<HTMLElement | null>(null),
  }: {
    board: BoardData;
    pop?: ReadonlySet<number>;
    clearing?: ReadonlySet<number>;
    preview?: ReadonlySet<number>;
    previewLine?: ReadonlySet<number>;
    previewValid?: boolean;
    onhover?: (index: number | null) => void;
    ontap?: (index: number) => void;
    grid?: HTMLElement | null;
  } = $props();

  /** Cell ring for keyboard play; cleared as soon as a pointer moves. */
  let cursor = $state<number | null>(null);

  const SPARK_COLORS = ['', '#b9a3f7', '#8fd6b8', '#7cc3f2', '#f5c76b', '#f2866c', '#ef8fc4', '#6fe3d6'];

  interface Spark {
    index: number;
    left: number;
    top: number;
    dx: number;
    dy: number;
    color: string;
    delay: number;
  }

  const sparks = $derived.by<Spark[]>(() => {
    if (clearing.size === 0) return [];
    const list: Spark[] = [];
    for (const index of clearing) {
      const r = Math.floor(index / BOARD_SIZE);
      const c = index % BOARD_SIZE;
      const wave = ((r + c) % 4) * 30;
      const color = SPARK_COLORS[board[r]?.[c] ?? 0] ?? '#ffffff';
      for (let k = 0; k < 2; k++) {
        const h = ((index * 2654435761 + k * 40503) >>> 0) % 1000 / 1000;
        const angle = h * Math.PI * 2 + k * Math.PI;
        const dist = 20 + ((index * 31 + k * 17) % 18);
        list.push({
          index: index * 2 + k,
          left: ((c + 0.5) / BOARD_SIZE) * 100,
          top: ((r + 0.5) / BOARD_SIZE) * 100,
          dx: Math.round(Math.cos(angle) * dist),
          dy: Math.round(Math.sin(angle) * dist),
          color: k === 0 ? '#ffffff' : color,
          delay: 80 + wave + k * 40,
        });
      }
    }
    return list;
  });

  const waveDelay = (r: number, c: number) => ((r + c) % 4) * 30;

  const armed = $derived(previewLine.size > 0);

  function locate(event: PointerEvent): number | null {
    if (!grid) return null;
    return cellAt(readGridMetrics(grid), event.clientX, event.clientY);
  }

  function hover(event: PointerEvent) {
    if (cursor !== null) cursor = null;
    onhover?.(locate(event));
  }

  function press(event: PointerEvent) {
    const index = locate(event);
    if (index !== null) ontap?.(index);
  }

  function keys(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      cursor = null;
      onhover?.(null);
      return;
    }
    const start = cursor ?? 27; /* (3, 3) */
    const row = Math.floor(start / BOARD_SIZE);
    const col = start % BOARD_SIZE;
    let index = start;
    if (event.key === 'ArrowUp') index = ((row + BOARD_SIZE - 1) % BOARD_SIZE) * BOARD_SIZE + col;
    if (event.key === 'ArrowDown') index = ((row + 1) % BOARD_SIZE) * BOARD_SIZE + col;
    if (event.key === 'ArrowLeft') index = row * BOARD_SIZE + ((col + BOARD_SIZE - 1) % BOARD_SIZE);
    if (event.key === 'ArrowRight') index = row * BOARD_SIZE + ((col + 1) % BOARD_SIZE);
    cursor = index;
    onhover?.(index);
    if (event.key === 'Enter' || event.key === ' ') ontap?.(index);
  }
</script>

<div class="board-shell bg-panel border border-edge rounded-[22px] p-[clamp(7px,2.2%,13px)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.45),0_26px_50px_-32px_rgba(0,0,0,0.9)]" class:armed>
  <div
    class="relative grid grid-cols-8 grid-rows-8 aspect-square rounded-[14px] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4"
    bind:this={grid}
    role="grid"
    tabindex="0"
    aria-label="Game board"
    onpointermove={hover}
    onpointerleave={() => onhover?.(null)}
    onpointerdown={press}
    onkeydown={keys}
  >
    {#each board as row, r (r)}
      {#each row as value, c (c)}
        {@const index = r * BOARD_SIZE + c}
        {@const isClearing = clearing.has(index)}
        <div class="cell" role="gridcell" aria-label={`Row ${r + 1}, column ${c + 1}: ${value ? 'block' : 'empty'}`}>
          {#if value}
            <div
              class="tile t{value}"
              class:pop={pop.has(index)}
              class:clearing={isClearing}
              style={isClearing ? `animation-delay: ${waveDelay(r, c)}ms` : undefined}
            ></div>
          {:else}
            <div class="slot"></div>
          {/if}
          {#if previewLine.has(index) && !clearing.has(index)}
            <div class="hint line"></div>
          {/if}
          {#if preview.has(index)}
            <div class="hint" class:ok={previewValid} class:bad={!previewValid}></div>
          {/if}
          {#if cursor === index}
            <div class="pointer-events-none absolute inset-[4%] rounded-[24%] border-2 border-accent"></div>
          {/if}
        </div>
      {/each}
    {/each}
    {#if sparks.length > 0}
      <div class="pointer-events-none absolute inset-0 z-[2]">
        {#each sparks as spark (spark.index)}
          <div
            class="spark"
            style="left: {spark.left}%; top: {spark.top}%; --dx: {spark.dx}px; --dy: {spark.dy}px; --spark: {spark.color}; animation-delay: {spark.delay}ms"
          ></div>
        {/each}
      </div>
    {/if}
  </div>
</div>
