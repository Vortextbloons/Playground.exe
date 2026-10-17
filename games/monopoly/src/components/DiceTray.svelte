<script lang="ts">
  interface Props {
    roll: [number, number] | null;
  }

  let { roll }: Props = $props();

  const PIPS: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
</script>

<div class={['dice-tray', { 'is-empty': roll === null }]}>
  {#each [0, 1] as die (die)}
    {#key `${roll?.[die] ?? 0}-${roll !== null}`}
      <span class={['die', { 'is-rolling': roll !== null }]}>
        {#each { length: 9 } as _, i (i)}
          <i class={{ on: (PIPS[roll?.[die] ?? 0] ?? []).includes(i) }}></i>
        {/each}
      </span>
    {/key}
  {/each}
</div>