<script lang="ts">
  import { cardFromId } from '../rules/cards';

  interface Props {
    id?: number | null;
    width?: number;
    playable?: boolean;
    dim?: boolean;
    class?: string;
    onclick?: () => void;
    label?: string;
  }

  let { id = null, width = 92, playable = false, dim = false, class: extra = '', onclick, label: ariaLabel }: Props = $props();

  const card = $derived(id === null ? null : cardFromId(id));
  const colorVar: Record<string, string> = {
    red: 'var(--color-red)',
    yellow: 'var(--color-sun)',
    green: 'var(--color-grass)',
    blue: 'var(--color-royal)',
    wild: 'conic-gradient(from 0deg, var(--color-red) 0 25%, var(--color-sun) 0 50%, var(--color-grass) 0 75%, var(--color-royal) 0)',
  };
  const solid = $derived(card ? colorVar[card.color] ?? 'var(--color-red)' : 'var(--color-red)');
  const isWild = $derived(card?.color === 'wild');
  const isFour = $derived(card?.kind === 'wild-four');
</script>

<button
  type="button"
  class="card {extra}"
  class:back={card === null}
  class:playable
  class:dim
  class:four={isFour}
  style:--w="{width}px"
  style:--c={solid}
  onclick={playable ? onclick : undefined}
  aria-label={ariaLabel}
>
  <div class="face">
    {#if card}
      <div class="ellipse" class:wild={isWild} style:--c={solid}></div>
      <div class="emblem">
        {#if card.kind === 'number'}
          <span class="numeral">{card.value}</span>
        {:else if card.kind === 'skip'}
          <svg viewBox="0 0 64 64" aria-hidden="true" class="icon"><circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" stroke-width="7" /><path d="M17 47 L47 17" stroke="currentColor" stroke-width="7" stroke-linecap="round" /></svg>
        {:else if card.kind === 'reverse'}
          <svg viewBox="0 0 64 64" aria-hidden="true" class="icon" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 37 A 18 18 0 0 1 44 25" />
            <path d="M44 12 L47 26 L33 24 Z" fill="currentColor" stroke="none" />
            <path d="M49 27 A 18 18 0 0 1 20 39" />
            <path d="M20 52 L17 38 L31 40 Z" fill="currentColor" stroke="none" />
          </svg>
        {:else if card.kind === 'draw-two'}
          <span class="numeral plus">+2</span>
        {:else if card.kind === 'wild'}
          <svg viewBox="0 0 64 64" aria-hidden="true" class="icon on-wild"><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="7" /><path d="M19 45 L45 19" stroke="#fff" stroke-width="7" stroke-linecap="round" /></svg>
        {:else}
          <svg viewBox="0 0 64 64" aria-hidden="true" class="fan">
            <rect x="23" y="10" width="18" height="28" rx="3" fill="var(--color-royal)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" transform="rotate(-18 32 56)" />
            <rect x="23" y="10" width="18" height="28" rx="3" fill="var(--color-grass)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" transform="rotate(-6 32 56)" />
            <rect x="23" y="10" width="18" height="28" rx="3" fill="var(--color-sun)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" transform="rotate(6 32 56)" />
            <rect x="23" y="10" width="18" height="28" rx="3" fill="var(--color-red)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" transform="rotate(18 32 56)" />
          </svg>
        {/if}
      </div>
    {:else}
      <div class="ellipse"></div>
      <svg viewBox="0 0 64 64" aria-hidden="true" class="icon back-mark"><circle cx="32" cy="32" r="19" fill="none" stroke="var(--c)" stroke-width="7" /><path d="M19 45 L45 19" stroke="var(--c)" stroke-width="7" stroke-linecap="round" /></svg>
      <svg viewBox="0 0 64 64" aria-hidden="true" class="icon corner-mark tl-mark"><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="8" /><path d="M19 45 L45 19" stroke="#fff" stroke-width="8" stroke-linecap="round" /></svg>
      <svg viewBox="0 0 64 64" aria-hidden="true" class="icon corner-mark br-mark"><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="8" /><path d="M19 45 L45 19" stroke="#fff" stroke-width="8" stroke-linecap="round" /></svg>
    {/if}
  </div>
</button>

<style>
  .face {
    pointer-events: none;
  }

  .card {
    flex: none;
    appearance: none;
    border: 0;
    margin: 0;
    padding: calc(var(--w) * 0.07);
    font: inherit;
    background: #fff;
    color: inherit;
    text-align: left;
  }

  .emblem .numeral {
    transform: rotate(-28deg);
    text-shadow: 0 2px 0 rgba(0, 0, 0, 0.14);
  }

  .emblem .numeral.plus {
    font-size: calc(var(--w) * 0.42);
  }

  .emblem .icon {
    width: 62%;
    height: 62%;
    transform: rotate(-28deg);
  }

  .emblem .icon.on-wild {
    width: 44%;
    height: 44%;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
  }

  .ellipse.wild {
    background: conic-gradient(from 0deg, var(--color-red) 0 25%, var(--color-sun) 0 50%, var(--color-grass) 0 75%, var(--color-royal) 0);
  }

  .card.four {
    background: #1f1f26;
  }

  .card.four .ellipse {
    background: #fff;
  }

  .card.four .face::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(115deg, transparent 32%, rgba(255, 255, 255, 0.38) 50%, transparent 68%);
    transform: translateX(-130%);
    animation: uno-shine 3.4s ease-in-out infinite;
  }

  @keyframes uno-shine {
    0%, 55% { transform: translateX(-130%); }
    90%, 100% { transform: translateX(130%); }
  }

  .emblem .fan {
    width: 86%;
    height: 86%;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35));
  }

  .back-mark {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 46%;
    height: 46%;
    transform: translate(-50%, -50%) rotate(-28deg);
  }

  .corner-mark {
    position: absolute;
    width: 17%;
    height: 17%;
  }

  .tl-mark {
    top: 6%;
    left: 7%;
  }

  .br-mark {
    bottom: 6%;
    right: 7%;
    transform: rotate(180deg);
  }
</style>
