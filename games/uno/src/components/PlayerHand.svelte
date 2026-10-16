<script lang="ts">
  import type { UnoView } from '../rules/engine';
  import { cardFromId, cardLabel } from '../rules/cards';
  import { cardMatchesView } from '../rules/engine';
  import Card from './Card.svelte';

  interface Props {
    view: UnoView;
    width: number;
    onPlay: (cardId: number) => void;
  }

  let { view, width, onPlay }: Props = $props();

  const you = $derived(view.you);
  const hand = $derived(you === null ? [] : view.hands[you] ?? []);
  const canAct = $derived(you !== null && view.turn === you && view.phase === 'playing');
  const drawn = $derived(view.drawnCard);

  function isPlayable(cardId: number): boolean {
    if (!canAct) return false;
    if (drawn !== null && cardId !== drawn) return false;
    const top = view.discardTop === null ? null : cardFromId(view.discardTop);
    return cardMatchesView(cardFromId(cardId), view.activeColor, top);
  }
</script>

<div class="hand" style:--w="{width}px" aria-label="Your hand, {hand.length} cards">
  {#each hand as cardId, index (cardId)}
    <div
      class="slot"
      class:lifted={canAct && (isPlayable(cardId) || cardId === drawn)}
      style:--i={index}
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
    onclick={() => onPlay(cardId)}
    label="Play {cardLabel(cardFromId(cardId))}"
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
    margin-left: calc(var(--w) * -0.34);
    animation: var(--animate-card-in);
    animation-delay: calc(var(--i) * 22ms);
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
