<script lang="ts">
  import type { UnoView } from '../rules/engine';
  import { cardFromId, cardLabel } from '../rules/cards';
  import { cardMatchesView } from '../rules/engine';
  import Card from './Card.svelte';

  interface Props {
    view: UnoView;
    width: number;
    maxWidth: number;
    onDrag: (active: boolean, over: boolean) => void;
    onPlay: (cardId: number) => void;
  }

  let { view, width, maxWidth, onDrag, onPlay }: Props = $props();

  const you = $derived(view.you);
  const hand = $derived(you === null ? [] : view.hands[you] ?? []);
  const canAct = $derived(you !== null && view.turn === you && view.phase === 'playing');
  const drawn = $derived(view.drawnCard);
  const overlap = $derived.by(() => {
    if (hand.length <= 1) return 0;
    const free = Math.max(0, maxWidth - width);
    return Math.min(width * 0.34, free / (hand.length - 1));
  });

  function isPlayable(cardId: number): boolean {
    if (!canAct) return false;
    if (drawn !== null && cardId !== drawn) return false;
    const top = view.discardTop === null ? null : cardFromId(view.discardTop);
    return cardMatchesView(cardFromId(cardId), view.activeColor, top, view.stackedDraw);
  }

  interface Gesture {
    cardId: number;
    slot: HTMLElement;
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    dragging: boolean;
    over: boolean;
  }

  let gesture: Gesture | null = null;
  let dragCardId = $state<number | null>(null);

  function startDrag(cardId: number, event: PointerEvent): void {
    if (!isPlayable(cardId) || event.button !== 0) return;
    const slot = event.currentTarget as HTMLElement;
    try {
      slot.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone (e.g. synthetic events) — the drag still works without capture.
    }
    gesture = { cardId, slot, x0: event.clientX, y0: event.clientY, dx: 0, dy: 0, dragging: false, over: false };
  }

  function moveDrag(event: PointerEvent): void {
    const g = gesture;
    if (!g) return;
    g.dx = event.clientX - g.x0;
    g.dy = event.clientY - g.y0;
    if (!g.dragging) {
      if (Math.hypot(g.dx, g.dy) < 8) return;
      g.dragging = true;
      dragCardId = g.cardId;
      onDrag(true, false);
    }
    g.slot.style.setProperty('--dx', `${g.dx}px`);
    g.slot.style.setProperty('--dy', `${g.dy}px`);
    const over = overDiscard(event.clientX, event.clientY);
    if (over !== g.over) {
      g.over = over;
      onDrag(true, over);
    }
  }

  function endDrag(event: PointerEvent): void {
    const g = gesture;
    if (!g) return;
    const played = g.dragging && overDiscard(event.clientX, event.clientY);
    stopDrag(g);
    if (played) onPlay(g.cardId);
  }

  function cancelDrag(): void {
    const g = gesture;
    if (!g) return;
    stopDrag(g);
  }

  function stopDrag(g: Gesture): void {
    gesture = null;
    dragCardId = null;
    if (!g.dragging) return;
    g.slot.style.removeProperty('--dx');
    g.slot.style.removeProperty('--dy');
    onDrag(false, false);
  }

  function overDiscard(x: number, y: number): boolean {
    const zone = document.querySelector('[data-drop-zone]');
    if (!zone) return false;
    const r = zone.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
</script>

<div class="hand" style:--w="{width}px" style:--overlap="{overlap}px" aria-label="Your hand, {hand.length} cards">
  {#each hand as cardId, index (cardId)}
    <div
      class="slot"
      class:lifted={canAct && (isPlayable(cardId) || cardId === drawn)}
      class:dragging={dragCardId === cardId}
      role="group"
      style:--i={index}
      onpointerdown={event => startDrag(cardId, event)}
      onpointermove={moveDrag}
      onpointerup={endDrag}
      onpointercancel={cancelDrag}
    >
      {@render cardSlot(cardId)}
    </div>
  {/each}
</div>

{#snippet cardSlot(cardId: number)}
  {#if drawn !== null && cardId === drawn && canAct}
    <div class="drawn-chip">drawn</div>
  {/if}
  <Card
    id={cardId}
    {width}
    playable={isPlayable(cardId)}
    dim={canAct && !isPlayable(cardId)}
    label="Drag to play {cardLabel(cardFromId(cardId))}"
  />
{/snippet}

<style>
  .hand {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    min-height: calc(var(--w) * 1.63);
    padding: 0 8px;
  }

  .slot {
    position: relative;
    margin-left: calc(var(--overlap, 0px) * -1);
    animation: var(--animate-card-in);
    animation-delay: calc(var(--i) * 22ms);
    touch-action: none;
  }

  .slot:first-child {
    margin-left: 0;
  }

  .slot.lifted {
    z-index: 3;
  }

  .slot.lifted :global(.card) {
    transform: translateY(calc(var(--w) * -0.12));
  }

  .slot.dragging {
    z-index: 20;
  }

  .slot.dragging :global(.card) {
    transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(1.06);
    transition: none;
    cursor: grabbing;
  }

  .slot :global(.card.playable) {
    cursor: grab;
  }

  .drawn-chip {
    position: absolute;
    top: calc(var(--w) * -0.3);
    left: 50%;
    translate: -50% 0;
    z-index: 4;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #712d00;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    animation: var(--animate-pop-in);
  }
</style>
