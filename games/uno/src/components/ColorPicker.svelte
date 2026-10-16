<script lang="ts">
  import { COLORS, type Color } from '../rules/cards';

  interface Props {
    title: string;
    current?: Color | null;
    onPick: (color: Color) => void;
    onCancel?: () => void;
  }

  let { title, current = null, onPick, onCancel }: Props = $props();

  function onWindowClick(event: MouseEvent): void {
    if (!onCancel) return;
    if (!(event.target instanceof Element) || !event.target.classList.contains('veil')) return;
    onCancel();
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="veil" role="presentation"></div>
<div class="picker" role="dialog" aria-label={title}>
  <h2>{title}</h2>
  <div class="swatches">
    {#each COLORS as color (color)}
      <button
        type="button"
        class="swatch"
        class:current={current === color}
        style:--c={color === 'red' ? 'var(--color-red)' : color === 'yellow' ? 'var(--color-sun)' : color === 'green' ? 'var(--color-grass)' : 'var(--color-royal)'}
        onclick={() => onPick(color)}
        aria-label="Choose {color}"
      >
        <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="17" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="7" /><path d="M20 44 L44 20" stroke="rgba(255,255,255,0.9)" stroke-width="7" stroke-linecap="round" /></svg>
      </button>
    {/each}
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    background: rgba(40, 3, 8, 0.55);
    backdrop-filter: blur(2px);
    animation: var(--animate-veil);
  }

  .picker {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 18px 22px 20px;
    border-radius: 18px;
    background: linear-gradient(170deg, #5e0710, #3d040b);
    box-shadow:
      inset 0 0 0 2px rgba(255, 255, 255, 0.14),
      0 18px 50px rgba(0, 0, 0, 0.5);
    animation: var(--animate-panel);
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    letter-spacing: 0.02em;
  }

  .swatches {
    display: flex;
    gap: 12px;
  }

  .swatch {
    appearance: none;
    border: 0;
    width: 58px;
    height: 86px;
    border-radius: 9px;
    background:
      linear-gradient(160deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0) 44%),
      var(--c);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85), 0 4px 10px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: transform 0.14s ease;
  }

  .swatch svg {
    width: 30px;
    height: 30px;
    transform: rotate(-28deg);
  }

  .swatch:hover,
  .swatch:focus-visible {
    transform: translateY(-4px) scale(1.05);
  }

  .swatch.current {
    box-shadow:
      inset 0 0 0 2px rgba(255, 255, 255, 0.85),
      0 0 0 3px var(--color-gold),
      0 6px 14px rgba(0, 0, 0, 0.4);
  }
</style>
