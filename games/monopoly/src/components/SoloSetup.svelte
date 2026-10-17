<script lang="ts">
  import type { EndConditions } from '../rules/engine';
  import EndConditionsForm from './EndConditions.svelte';
  interface Props {
    onstart: (bots: number, conditions: EndConditions) => void;
  }

  let { onstart }: Props = $props();

  const BOT_NAMES = ['ada', 'rex', 'mia', 'sol', 'nia'];
  let bots = $state(3);
</script>

<div class="solo-setup">
  <span class="solo-kicker">The property trading game</span>
  <h1>MONOPOLY</h1>
  <h2>Small city.<br />Big ambitions.</h2>
  <p class="solo-lede">
    Buy streets, build houses, and trade your way to the top.
    Choose what ends your game.
  </p>

  <div class="opponents-label" id="opponents-label">Choose your opponents</div>
  <div class="solo-picker" role="group" aria-labelledby="opponents-label">
    {#each { length: BOT_NAMES.length } as _, i (i)}
      {@const count = i + 1}
      <button
        type="button"
        class={['btn', { 'is-picked': bots === count }]}
        onclick={() => (bots = count)}
        aria-pressed={bots === count}
      >
        {count}
      </button>
    {/each}
  </div>
  <p class="opponent-preview">You + {bots} bot{bots === 1 ? '' : 's'}</p>

  <EndConditionsForm onsubmit={(conditions) => onstart(bots, conditions)} />
  <p class="solo-hint">Buy. Build. Trade. Take over.</p>
</div>
