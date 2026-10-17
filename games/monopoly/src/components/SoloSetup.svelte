<script lang="ts">
  interface Props {
    onstart: (bots: number) => void;
  }

  let { onstart }: Props = $props();

  const BOT_NAMES = ['ada', 'rex', 'mia', 'sol', 'nia'];
  let bots = $state(3);
</script>

<div class="solo-setup">
  <span class="solo-kicker">Monopoly</span>
  <h1>Own the city</h1>
  <p class="solo-lede">
    Buy streets, build houses, bankrupt your rivals — or reach a
    <strong>$5,000</strong> net worth before they do.
  </p>

  <div class="solo-picker">
    {#each { length: BOT_NAMES.length } as _, i (i)}
      {@const count = i + 1}
      <button
        type="button"
        class={['btn', { 'is-picked': bots === count }]}
        onclick={() => (bots = count)}
        aria-pressed={bots === count}
      >
        {count} bot{count === 1 ? '' : 's'}
      </button>
    {/each}
  </div>

  <button type="button" class="btn btn--primary btn--big" onclick={() => onstart(bots)}>
    Start solo match
  </button>
  <p class="solo-hint">Or host a party match from the multiplayer menu to play with 2–8 people.</p>
</div>