<script lang="ts">
  import type { UnoView } from '../rules/engine';
  import Card from './Card.svelte';

  interface Props {
    view: UnoView;
    drawCount: number;
    canDraw: boolean;
    direction: 1 | -1;
    onDraw: () => void;
  }

  let { view, drawCount, canDraw, direction, onDraw }: Props = $props();

  const tilt = $derived(view.discardTop === null ? 0 : ((view.discardTop * 47) % 21) - 10);
</script>

<div class="table" aria-label="Table piles">
  <div class="pile draw">
    <button
      type="button"
      class="stack"
      onclick={canDraw ? onDraw : undefined}
      disabled={!canDraw}
      aria-label="Draw a card ({drawCount} left)"
    >
      <span class="ghost g2"></span>
      <span class="ghost g1"></span>
      <span class="top-back">
        <Card width={92} />
      </span>
    </button>
    <span class="pile-label">{drawCount}</span>
  </div>

  <div class="mid">
    <svg class="ring" class:flip={direction === -1} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 8 A 42 42 0 0 1 92 50" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="6" stroke-linecap="round" />
      <path d="M50 92 A 42 42 0 0 1 8 50" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="6" stroke-linecap="round" />
      <path d="M88 36 L94 53 L77 51 Z" fill="rgba(255,255,255,0.8)" />
      <path d="M12 64 L6 47 L23 49 Z" fill="rgba(255,255,255,0.8)" />
    </svg>
    <div class="discard">
      {#if view.discardTop === null}
        <div class="empty" style:--w="92px"></div>
      {:else}
        <div class="drop" style:--tilt="{tilt}deg">
          <Card id={view.discardTop} width={92} label="Discard pile" />
        </div>
      {/if}
    </div>
  </div>

  <div class="active-color">
    <span class="dot" style:--c={view.activeColor === null ? 'transparent' : {
      red: 'var(--color-red)',
      yellow: 'var(--color-sun)',
      green: 'var(--color-grass)',
      blue: 'var(--color-royal)',
    }[view.activeColor]}></span>
    <span class="label">{view.activeColor === null ? '—' : view.activeColor.toUpperCase()}</span>
  </div>
</div>

<style>
  .table {
    display: flex;
    align-items: center;
    gap: clamp(18px, 5vw, 44px);
  }

  .pile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stack {
    position: relative;
    appearance: none;
    border: 0;
    padding: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  .stack:disabled {
    cursor: default;
  }

  .stack :global(.card) {
    position: relative;
    z-index: 3;
  }

  .ghost,
  .top-back {
    position: absolute;
    left: 0;
    top: 0;
  }

  .ghost {
    z-index: 1;
  }

  .ghost :global(.card) {
    filter: brightness(0.72);
  }

  .g1 {
    z-index: 1;
    transform: translate(4px, 4px) rotate(3deg);
  }

  .g2 {
    z-index: 0;
    transform: translate(8px, 8px) rotate(-2deg);
  }

  .top-back {
    z-index: 3;
  }

  .stack:not(:disabled):hover .top-back {
    transform: translateY(-4px);
  }

  .stack:not(:disabled):hover :global(.card) {
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.18),
      0 8px 20px rgba(40, 4, 8, 0.55),
      0 0 0 3px var(--color-gold);
  }

  .pile-label {
    font-weight: 800;
    font-size: 12px;
    color: var(--color-muted);
  }

  .mid {
    position: relative;
    display: grid;
    place-items: center;
  }

  .ring {
    position: absolute;
    width: clamp(150px, 30vw, 210px);
    height: clamp(150px, 30vw, 210px);
    transition: transform 0.35s ease;
  }

  .ring.flip {
    transform: scaleX(-1);
  }

  .discard {
    position: relative;
    width: 92px;
    height: calc(92px * 1.525);
    display: grid;
    place-items: center;
  }

  .empty {
    width: var(--w);
    aspect-ratio: 2 / 3.05;
    border-radius: calc(var(--w) * 0.12);
    background: rgba(70, 5, 12, 0.5);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.14);
  }

  .drop {
    animation: var(--animate-pop-in);
    transform: rotate(var(--tilt));
  }

  .active-color {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }

  .dot {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--c);
    box-shadow:
      inset 0 -3px 6px rgba(0, 0, 0, 0.25),
      inset 0 3px 6px rgba(255, 255, 255, 0.35),
      0 0 0 3px rgba(255, 255, 255, 0.85);
    animation: var(--animate-pulse-soft);
  }

  .label {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 0.08em;
  }
</style>
