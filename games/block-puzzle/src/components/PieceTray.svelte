<script lang="ts">
  import BlockPiece from './BlockPiece.svelte';
  import { SHAPE_BY_ID } from '../engine/shapes';
  import type { Piece, Tray as TrayData } from '../engine/types';
  import type { PickupDetail } from '../metrics';

  let {
    tray,
    selected = -1,
    hidden = -1,
    shake = -1,
    disabled = false,
    playable = [true, true, true],
    onpickup,
    onactivate,
  }: {
    tray: TrayData;
    selected?: number;
    hidden?: number;
    shake?: number;
    disabled?: boolean;
    playable?: readonly boolean[];
    onpickup?: (index: number, detail: PickupDetail) => void;
    onactivate?: (index: number) => void;
  } = $props();

  let width = $state(0);
  let height = $state(0);
  const holders: (HTMLElement | undefined)[] = [];

  const slotWidth = $derived(width > 0 ? (width - 20) / 3 : 92);
  const pieceCell = $derived(Math.min(30, Math.max(9, (Math.min(slotWidth, height || slotWidth) - 22) / 5)));

  function down(event: PointerEvent, index: number) {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const piece = tray[index];
    const holder = holders[index];
    if (!piece || !holder) return;
    const shape = SHAPE_BY_ID.get(piece.shapeId);
    if (!shape) return;
    const rect = holder.getBoundingClientRect();
    onpickup?.(index, {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      rect,
      cell: rect.width / shape.width,
    });
  }

  function label(piece: Piece, index: number): string {
    const shape = SHAPE_BY_ID.get(piece.shapeId);
    const size = shape ? `, ${shape.width} by ${shape.height}` : '';
    return `Block ${index + 1}${size}${selected === index ? ', selected' : ''}`;
  }
</script>

<div class="grid grid-cols-3 gap-[10px]" bind:clientWidth={width} bind:clientHeight={height}>
  {#each tray as piece, index (index)}
    <button
      type="button"
      class="slot relative grid h-[clamp(76px,23vh,126px)] cursor-pointer place-items-center rounded-[18px] p-0 text-inherit focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[3px]"
      class:picked={selected === index}
      class:taken={hidden === index}
      class:shaking={shake === index}
      class:dim={!!piece && playable[index] === false}
      disabled={disabled || !piece}
      aria-pressed={selected === index}
      aria-label={piece ? label(piece, index) : `Slot ${index + 1}, empty`}
      onpointerdown={(event) => down(event, index)}
      onclick={() => onactivate?.(index)}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#if piece}
        {@const shape = SHAPE_BY_ID.get(piece.shapeId)}
        {#if shape}
          {#key piece}
            <div
              class="holder grid place-items-center"
              style="animation-delay: {index * 60}ms"
              bind:this={holders[index]}
            >
              <BlockPiece {shape} color={piece.color} cell={pieceCell} />
            </div>
          {/key}
        {/if}
      {/if}
    </button>
  {/each}
</div>
