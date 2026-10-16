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

<div class="bg-panel border border-edge rounded-[22px] p-[clamp(7px,2.2%,13px)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.45),0_26px_50px_-32px_rgba(0,0,0,0.9)]">
  <div
    class="grid grid-cols-8 grid-rows-8 aspect-square rounded-[14px] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4"
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
        <div class="cell" role="gridcell" aria-label={`Row ${r + 1}, column ${c + 1}: ${value ? 'block' : 'empty'}`}>
          {#if value}
            <div class="tile t{value}" class:pop={pop.has(index)} class:clearing={clearing.has(index)}></div>
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
  </div>
</div>
