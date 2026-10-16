<script lang="ts">
  import type { Shape } from '../engine/types';

  let { shape, color, cell = 22 }: { shape: Shape; color: number; cell?: number } = $props();

  const filled = $derived(new Set(shape.cells.map(part => part.row * shape.width + part.col)));
  const indices = $derived(Array.from({ length: shape.width * shape.height }, (_, index) => index));
</script>

<div
  class="grid"
  style="--pc: {cell}px; grid-template-columns: repeat({shape.width}, var(--pc)); grid-template-rows: repeat({shape.height}, var(--pc));"
>
  {#each indices as index (index)}
    <div class="cell">
      {#if filled.has(index)}<div class="tile t{color}"></div>{/if}
    </div>
  {/each}
</div>
