<script lang="ts">
  import { cardById } from '../rules/board';

  interface Props {
    card: { deck: 'chance' | 'chest'; id: number } | null;
    onclose: () => void;
  }

  let { card, onclose }: Props = $props();
</script>

{#if card}
  {@const def = cardById(card.id)}
  <div class="veil">
    <div class="modal modal--card">
      {#key card}
        <div class="card-reveal">
          <div class="card-turn">
            <div class="deck-card deck-card--large deck-card--{card.deck} card-back" aria-hidden="true">
              <b>{card.deck === 'chance' ? '?' : '♧'}</b>
              <span class="deck-card-label">{def.deck === 'chance' ? 'Chance' : 'Community Chest'}</span>
            </div>
            <div class="deck-card deck-card--large deck-card--{card.deck} card-front">
              <span class="deck-card-label">{def.deck === 'chance' ? 'Chance' : 'Community Chest'}</span>
              <p class="deck-card-text">{def.text}</p>
            </div>
          </div>
        </div>
      {/key}
      <button type="button" class="btn btn--primary" onclick={onclose}>Continue</button>
    </div>
  </div>
{/if}

<style>
  .card-reveal { width: 100%; perspective: 1000px; animation: draw-card .95s cubic-bezier(.22,.7,.25,1) both; }
  .card-turn { display: grid; transform-style: preserve-3d; animation: turn-card .95s cubic-bezier(.45,0,.2,1) both; }
  .card-turn .deck-card { grid-area: 1 / 1; backface-visibility: hidden; animation: none; }
  .card-turn .card-back { transform: rotateY(180deg); }
  .card-back b { font-size: 88px; margin-bottom: 24px; }
  .card-front { transform: rotateY(0); }
  @keyframes draw-card {
    0% { opacity: 0; transform: translateY(55px) rotate(-12deg) scale(.78); }
    25% { opacity: 1; transform: translateY(-12px) rotate(-6deg) scale(1.03); }
    75% { transform: translateY(-5px) rotate(2deg) scale(1.02); }
    100% { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
  }
  @keyframes turn-card {
    0%, 25% { transform: rotateY(180deg); }
    100% { transform: rotateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .card-reveal, .card-turn { animation: none; }
  }
</style>
