<script lang="ts">
  import { GROUP_SPACES, GROUP_COLORS, SPACES, mortgageInterestOf, type Space } from '../rules/board';
  import type { MonoAction, MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    spaceId: number;
    ondispatch: (action: MonoAction) => void;
    onclose: () => void;
  }

  let { view, names, spaceId, ondispatch, onclose }: Props = $props();

  const space = $derived(SPACES[spaceId]);
  const owner = $derived(view.owners[String(spaceId)] ?? null);
  const houses = $derived(view.houses[String(spaceId)] ?? 0);
  const mortgaged = $derived(view.mortgages[String(spaceId)] ?? false);

  const isMine = $derived(owner !== null && owner === view.you);
  const canManage = $derived(
    isMine && view.turn === view.you && (view.phase === 'preroll' || view.phase === 'postroll' || view.phase === 'debt'),
  );
  const canDevelop = $derived(canManage && view.phase !== 'debt' && space?.kind === 'street');

  const groupHouses = $derived.by(() => {
    if (!space?.group) return [] as number[];
    return GROUP_SPACES[space.group].map(id => view.houses[String(id)] ?? 0);
  });

  const groupHasBuildings = $derived(groupHouses.some(count => count > 0));
  const groupHasMortgage = $derived.by(() => {
    if (!space?.group) return false;
    return GROUP_SPACES[space.group].some(id => view.mortgages[String(id)]);
  });
  const atGroupMin = $derived(groupHouses.length > 0 && houses === Math.min(...groupHouses));
  const atGroupMax = $derived(groupHouses.length > 0 && houses === Math.max(...groupHouses));
  const fullGroupOwned = $derived(
    space?.group ? GROUP_SPACES[space.group].every(id => view.owners[String(id)] === view.you) : false,
  );

  const me = $derived(view.you !== null ? view.players[view.you] : null);

  const mortgageValue = $derived(space ? Math.floor((space.price ?? 0) / 2) : 0);
  const liftCost = $derived(space ? mortgageInterestOf(space.price ?? 0) : 0);

  const rentRows = $derived.by(() => {
    if (!space || space.kind !== 'street' || !space.rent) return [];
    return [
      { label: 'Rent', amount: space.rent[0]! },
      { label: 'With 1 House', amount: space.rent[1]! },
      { label: 'With 2 Houses', amount: space.rent[2]! },
      { label: 'With 3 Houses', amount: space.rent[3]! },
      { label: 'With 4 Houses', amount: space.rent[4]! },
      { label: 'With Hotel', amount: space.rent[5]! },
    ];
  });

  function deedAccent(s: Space | undefined): string {
    if (!s) return '#8a8f98';
    if (s.group) return GROUP_COLORS[s.group];
    if (s.kind === 'railroad') return '#3d3a35';
    return '#7ba3b8';
  }

  function send(action: MonoAction): void {
    ondispatch(action);
  }
</script>

{#if space}
  <div class="veil" onclick={onclose} role="presentation">
    <div class="modal deed-modal" onclick={(event) => event.stopPropagation()} role="presentation">
      <header class="deed-head" style:--deed-accent={deedAccent(space)}>
        <span class="deed-kicker">Title Deed</span>
        <h2>{space.name}</h2>
        {#if space.price}<p class="deed-price">Price ${space.price}</p>{/if}
      </header>

      {#if rentRows.length > 0}
        <dl class="rent-table">
          {#each rentRows as row, i (row.label)}
            <div class={['rent-row', { 'is-current': houses === i }]}>
              <dt>{row.label}</dt>
              <dd>${row.amount}</dd>
            </div>
          {/each}
          {#if space!.houseCost}
            <div class="rent-row rent-row--meta"><dt>House cost</dt><dd>${space!.houseCost} each</dd></div>
          {/if}
        </dl>
      {:else if space.kind === 'railroad'}
        <dl class="rent-table">
          <div class="rent-row"><dt>1 railroad</dt><dd>$25</dd></div>
          <div class="rent-row"><dt>2 railroads</dt><dd>$50</dd></div>
          <div class="rent-row"><dt>3 railroads</dt><dd>$100</dd></div>
          <div class="rent-row"><dt>4 railroads</dt><dd>$200</dd></div>
        </dl>
      {:else if space.kind === 'utility'}
        <dl class="rent-table">
          <div class="rent-row"><dt>1 utility</dt><dd>4 × dice roll</dd></div>
          <div class="rent-row"><dt>2 utilities</dt><dd>10 × dice roll</dd></div>
        </dl>
      {:else}
        <p class="deed-note">{space.name} — no rent, no deed.</p>
      {/if}

      <p class="deed-owner">
        {#if owner}
          Owned by <strong>{names[owner] ?? owner}</strong>{mortgaged ? ' — mortgaged' : ''}
          {#if houses > 0} — {houses === 5 ? 'a hotel' : `${houses} house${houses === 1 ? '' : 's'}`}{/if}
        {:else if space.price}
          Unowned
        {/if}
      </p>

      {#if canManage}
        <div class="deed-actions">
          {#if canDevelop}
            <button
              type="button"
              class="btn"
              disabled={!fullGroupOwned || groupHasMortgage || !atGroupMin || houses >= 5 || (me?.cash ?? 0) < (space.houseCost ?? 0)}
              title={!fullGroupOwned ? 'Own the whole colour group first' : groupHasMortgage ? 'Lift mortgages first' : !atGroupMin ? 'Build evenly across the group' : ''}
              onclick={() => send({ type: 'build', space: spaceId })}
            >
              Build house (${space.houseCost})
            </button>
            <button
              type="button"
              class="btn"
              disabled={houses === 0 || !atGroupMax}
              title={!atGroupMax ? 'Sell evenly across the group' : ''}
              onclick={() => send({ type: 'sell', space: spaceId })}
            >
              Sell house (${Math.floor((space.houseCost ?? 0) / 2)})
            </button>
          {/if}
          {#if !mortgaged}
            <button
              type="button"
              class="btn btn--ghost"
              disabled={space.kind === 'street' ? groupHasBuildings : false}
              title={space.kind === 'street' && groupHasBuildings ? 'Sell the buildings first' : ''}
              onclick={() => send({ type: 'mortgage', space: spaceId })}
            >
              Mortgage (${mortgageValue})
            </button>
          {:else}
            <button
              type="button"
              class="btn btn--ghost"
              disabled={(me?.cash ?? 0) < liftCost}
              onclick={() => send({ type: 'unmortgage', space: spaceId })}
            >
              Lift mortgage (${liftCost})
            </button>
          {/if}
        </div>
      {/if}

      <button type="button" class="btn btn--ghost deed-close" onclick={onclose}>Close</button>
    </div>
  </div>
{/if}