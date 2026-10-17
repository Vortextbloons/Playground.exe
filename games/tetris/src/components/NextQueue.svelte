<script lang="ts">
  import { cellsFor, COLOR } from '../engine/pieces';
  import type { PieceKind } from '../engine/types';

  let { queue }: { queue: readonly PieceKind[] } = $props();

  function miniCells(kind: PieceKind) {
    const cells = cellsFor(kind, 0);
    const minRow = Math.min(...cells.map(cell => cell.row));
    const minCol = Math.min(...cells.map(cell => cell.col));
    return cells.map(cell => ({ row: cell.row - minRow, col: cell.col - minCol }));
  }
</script>

<div class="grid gap-[8px]" aria-label="Next pieces">
  {#each queue.slice(0, 3) as kind, i (i)}
    {@const cells = miniCells(kind)}
    {@const width = Math.max(...cells.map(cell => cell.col)) + 1}
    {@const height = Math.max(...cells.map(cell => cell.row)) + 1}
    <div
      class="mini rounded-[10px] border border-edge bg-[rgba(35,32,48,0.5)] p-[6px]"
      class:first={i === 0}
      style="display: grid; grid-template-columns: repeat({width}, 14px); grid-template-rows: repeat({height}, 14px); justify-content: center;"
      aria-label={i === 0 ? `Next piece` : `Piece after next ${i}`}
    >
      {#each Array.from({ length: width * height }, (_, n) => n) as n (n)}
        {@const r = Math.floor(n / width)}
        {@const c = n % width}
        {@const filled = cells.some(cell => cell.row === r && cell.col === c)}
        <div class={filled ? `mini-cell t${COLOR[kind]}` : 'mini-cell'}></div>
      {/each}
    </div>
  {/each}
</div>
