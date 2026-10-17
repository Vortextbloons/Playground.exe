<script lang="ts">
  import { cardById } from '../rules/board';

  interface Props {
    card: { deck: 'chance' | 'chest'; id: number } | null;
  }

  let { card }: Props = $props();
</script>

{#if card}
  {@const def = cardById(card.id)}
  <div class="veil">
    <div class="modal modal--card">
      <div class="deck-card deck-card--large deck-card--{card.deck}">
        <span class="deck-card-label">{def.deck === 'chance' ? 'Chance' : 'Community Chest'}</span>
        <p class="deck-card-text">{def.text}</p>
      </div>
    </div>
  </div>
{/if}