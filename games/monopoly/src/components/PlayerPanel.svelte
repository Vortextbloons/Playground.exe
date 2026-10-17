<script lang="ts">
  import { GROUP_COLORS, playerColor, SPACES } from '../rules/board';
  import { netWorth, type MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    selected: number | null;
    onselect: (space: number) => void;
    cashChanges?: Record<string, number>;
    cashKey?: number;
  }

  let { view, names, selected = null, onselect, cashChanges = {}, cashKey = 0 }: Props = $props();

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
      {#if cashChanges[id]}
        {#key cashKey}
          <span class={['cash-delta', { 'is-gain': cashChanges[id]! > 0 }]} aria-label={`${cashChanges[id]! > 0 ? 'Received' : 'Paid'} $${Math.abs(cashChanges[id]!).toLocaleString()}`}>
            {cashChanges[id]! > 0 ? '+' : '−'}${Math.abs(cashChanges[id]!).toLocaleString()}
          </span>
        {/key}
      {/if}
      <header>
        <span class="dot"></span>
        <strong>{names[id] ?? id}{view.you === id && names[id] !== 'You' ? ' (you)' : ''}</strong>
        <span class="worth" title="Cash" aria-label={`Cash: $${(player?.cash ?? 0).toLocaleString()}`}>{#key player?.cash}<span class="money-update">${(player?.cash ?? 0).toLocaleString()}</span>{/key}</span>
      </header>
      <p class="cash">
        <span>Total worth {#key worth}<strong class="money-update">${worth.toLocaleString()}</strong>{/key}</span>
        <span>{deeds.length} {deeds.length === 1 ? 'deed' : 'deeds'}</span>
        {#if player?.inJail}<span class="jail-badge">in jail</span>{/if}
        {#if player?.bankrupt}<span class="bust-badge">bankrupt</span>{/if}
      </p>
      {#if view.target !== null}
      <div class="wealth-track" role="meter" aria-label={`${names[id] ?? id} net worth`} aria-valuemin={0} aria-valuemax={view.target} aria-valuenow={Math.max(0, Math.min(worth, view.target))}>
        <span style:width="{Math.max(0, Math.min(100, worth / view.target * 100))}%"></span>
      </div>
      {/if}
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
