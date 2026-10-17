<script lang="ts">
  import { GROUP_COLORS, playerColor, SPACES } from '../rules/board';
  import { netWorth, type MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    selected: number | null;
    onselect: (space: number) => void;
  }

  let { view, names, selected = null, onselect }: Props = $props();

  function colorOf(playerId: string): string {
    return playerColor(view.order.indexOf(playerId));
  }

  const holdings = $derived.by(() => {
    const map: Record<string, number[]> = {};
    for (let id = 0; id < SPACES.length; id++) {
      const owner = view.owners[String(id)];
      if (!owner) continue;
      const list = map[owner] ?? [];
      list.push(id);
      map[owner] = list;
    }
    return map;
  });

  function chipStyle(id: number): string {
    const space = SPACES[id]!;
    return space.group ? `--chip-color:${GROUP_COLORS[space.group]}` : '--chip-color:#8a8f98';
  }
</script>

<div class="player-list">
  {#each view.order as id (id)}
    {@const player = view.players[id]}
    {@const worth = netWorth(view, id)}
    {@const deeds = holdings[id] ?? []}
    <article
      class={['player-card', { 'is-turn': view.turn === id && view.phase !== 'results', 'is-bankrupt': player?.bankrupt }]}
      style:--player-color={colorOf(id)}
    >
      <header>
        <span class="dot"></span>
        <strong>{names[id] ?? id}{view.you === id ? ' (you)' : ''}</strong>
        <span class="worth">${worth}</span>
      </header>
      <p class="cash">
        ${player?.cash ?? 0}
        {#if player?.inJail}<span class="jail-badge">in jail</span>{/if}
        {#if player?.bankrupt}<span class="bust-badge">bankrupt</span>{/if}
      </p>
      {#if deeds.length > 0 && !player?.bankrupt}
        <div class="deed-chips">
          {#each deeds as spaceId (spaceId)}
            <button
              type="button"
              class={['deed-chip', { 'is-selected': selected === spaceId }]}
              style={chipStyle(spaceId)}
              onclick={() => onselect(spaceId)}
            >
              {SPACES[spaceId]!.name}
              {#if view.mortgages[String(spaceId)]}<em>m</em>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </article>
  {/each}
</div>