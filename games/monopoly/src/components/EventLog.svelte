<script lang="ts">
  import type { MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
  }

  let { view, names }: Props = $props();

  const entries = $derived(
    view.log.slice(-16).reverse(),
  );

  function entryText(entry: MonoView['log'][number]): string {
    if (!entry.actor) return entry.text;
    const name = names[entry.actor] ?? entry.actor;
    if (name !== 'You') return entry.text;
    const first = /^\w+/.exec(entry.text)?.[0] ?? '';
    const irregular: Record<string, string> = { is: 'are', goes: 'go', does: 'do', has: 'have', was: 'were' };
    let base = irregular[first] ?? first;
    if (base === first) {
      if (first.endsWith('es') && /(s|x|z|ch|sh|o)$/.test(first.slice(0, -2))) base = first.slice(0, -2);
      else if (first.endsWith('s')) base = first.slice(0, -1);
    }
    return `${base}${entry.text.slice(first.length)}`;
  }
</script>

<div class="event-log">
  {#each entries as entry, i (view.log.length - i)}
    <p class={{ fresh: i === 0 }}>
      {#if entry.actor}<strong>{names[entry.actor] ?? entry.actor}</strong> {entryText(entry)}{:else}{entry.text}{/if}
    </p>
  {/each}
</div>