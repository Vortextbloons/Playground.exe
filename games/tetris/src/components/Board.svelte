<script lang="ts">
  import { COLS, ROWS, type Board as BoardData } from '../engine/types';

  let {
    board,
    active = new Map<number, number>(),
    ghost = new Map<number, number>(),
    clearing = new Set<number>(),
  }: {
    board: BoardData;
    active?: ReadonlyMap<number, number>;
    ghost?: ReadonlyMap<number, number>;
    clearing?: ReadonlySet<number>;
  } = $props();
</script>

<div class="board-shell h-full bg-panel border border-edge rounded-[18px] p-[clamp(6px,1.8%,10px)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.45),0_26px_50px_-32px_rgba(0,0,0,0.9)]">
  <div
    class="relative grid h-full w-full rounded-[12px]"
    style="grid-template-columns: repeat({COLS}, minmax(0, 1fr)); grid-template-rows: repeat({ROWS}, minmax(0, 1fr));"
    role="grid"
    aria-label="Falling blocks well"
  >
    {#each board as row, r (r)}
      {#each row as value, c (c)}
        {@const index = r * COLS + c}
        {@const held = active.get(index) ?? 0}
        {@const shade = ghost.get(index) ?? 0}
        {@const isClearing = clearing.has(index)}
        <div class="cell" role="gridcell" aria-label={`Row ${r + 1}, column ${c + 1}`}>
          {#if held}
            <div class="tile t{held} live"></div>
          {:else if value}
            <div class="tile t{value}" class:clearing={isClearing}></div>
          {:else if shade}
            <div class="ghost-cell t{shade}"></div>
          {:else}
            <div class="slot"></div>
          {/if}
        </div>
      {/each}
    {/each}
  </div>
</div>
