<script lang="ts">
  import { GROUP_COLORS, playerColor, SPACES, type Space } from '../rules/board';
  import type { MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    selected: number | null;
    onselect: (space: number) => void;
  }

  let { view, names, selected = null, onselect }: Props = $props();

  const CELL = 54;

  function tilePos(id: number): { left: number; top: number; corner: boolean } {
    if (id <= 10) return { left: (10 - id) * CELL, top: 10 * CELL, corner: id === 0 };
    if (id <= 20) return { left: 0, top: (20 - id) * CELL, corner: id === 20 };
    if (id <= 30) return { left: (id - 20) * CELL, top: 0, corner: id === 30 };
    return { left: 10 * CELL, top: (id - 30) * CELL, corner: false };
  }

  const tiles = $derived(
    SPACES.map((space) => ({ space, ...tilePos(space.id) })),
  );

  function colorOf(playerId: string): string {
    const index = view.order.indexOf(playerId);
    return playerColor(index === -1 ? 0 : index);
  }

  function labelOf(space: Space): string {
    switch (space.kind) {
      case 'street':
        return space.name
          .replace('North Carolina', 'N. Carolina')
          .replace('Pennsylvania', 'Penn.')
          .replace('Mediterranean', 'Mediterr.')
          .replace(' Vermont', ' Vt.')
          .replace(' Oriental', ' Ori.')
          .replace(' Illinois', ' Ill.')
          .replace(' Atlantic', ' Atl.')
          .replace(' Pacific', ' Pac.');
      case 'railroad':
        return space.name.replace(' Railroad', ' RR').replace('B. & O.', 'B&O');
      case 'utility':
        return space.name.replace('Electric Company', 'Electric Co.');
      case 'chance':
        return 'Chance';
      case 'chest':
        return 'Chest';
      default:
        return space.name;
    }
  }

  function priceOf(space: Space): string | null {
    return space.price ? `$${space.price}` : null;
  }

  function housesOn(spaceId: number): number {
    return view.houses[String(spaceId)] ?? 0;
  }

  function ownerOf(spaceId: number): string | null {
    return view.owners[String(spaceId)] ?? null;
  }

  const tokens = $derived.by(() => {
    const byTile: Record<number, string[]> = {};
    for (const id of view.order) {
      if (view.players[id]?.bankrupt) continue;
      const tile = view.players[id]?.position ?? 0;
      const list = byTile[tile] ?? [];
      list.push(id);
      byTile[tile] = list;
    }
    const out: { id: string; left: number; top: number; color: string; label: string }[] = [];
    for (const [tileKey, ids] of Object.entries(byTile)) {
      const base = tilePos(Number(tileKey));
      ids.forEach((id, index) => {
        const angle = (index / Math.max(ids.length, 1)) * Math.PI * 2;
        const spread = ids.length > 1 ? 9 : 0;
        out.push({
          id,
          left: base.left + CELL / 2 - 9 + Math.cos(angle) * spread,
          top: base.top + CELL / 2 - 9 + Math.sin(angle) * spread,
          color: colorOf(id),
          label: (names[id] ?? id).slice(0, 2).toUpperCase(),
        });
      });
    }
    return out;
  });
</script>

<div class="city-scene">
  <div class="city-plane">
    <div class="city-table"></div>
    {#each tiles as t (t.space.id)}
      <button
        type="button"
        class={[
          'tile',
          `tile-kind--${t.space.kind}`,
          { 'tile-corner': t.corner, 'is-selected': selected === t.space.id },
        ]}
        style:left="{t.left}px"
        style:top="{t.top}px"
        style:--group-color={t.space.group ? GROUP_COLORS[t.space.group] : null}
        style:--owner-color={ownerOf(t.space.id) ? colorOf(ownerOf(t.space.id)!) : null}
        onclick={() => onselect(t.space.id)}
        aria-label={t.space.name}
      >
        <span class="tile-top">
          {#if t.space.kind === 'street'}<span class="tile-band"></span>{/if}
          <span class="tile-label">{labelOf(t.space)}</span>
          {#if priceOf(t.space)}<span class="tile-price">{priceOf(t.space)}</span>{/if}
          {#if ownerOf(t.space.id)}<span class="tile-owner-flag"></span>{/if}
          {#if view.mortgages[String(t.space.id)]}<span class="tile-mortgaged">M</span>{/if}
          {#if housesOn(t.space.id) > 0}
            <span class="tile-buildings">
              {#if housesOn(t.space.id) === 5}
                <i class="standing hotel"></i>
              {:else}
                {#each { length: housesOn(t.space.id) } as _, i (i)}
                  <i class="standing house"></i>
                {/each}
              {/if}
            </span>
          {/if}
        </span>
      </button>
    {/each}

    <div class="city-center">
      <div class="city-center-billboard">
        <div class="roundel">
          <strong>MONOPOLY</strong>
          <em>First to ${view.target} wins</em>
        </div>
        <div class="city-decks">
          <div class="deck-card deck-card--chance">Chance</div>
          <div class="deck-card deck-card--chest">Chest</div>
        </div>
      </div>
    </div>

    {#each tokens as token (token.id)}
      <div
        class={['token token-glide', { 'is-turn': view.turn === token.id }]}
        style:left="{token.left}px"
        style:top="{token.top}px"
        style:--token-color={token.color}
      >
        <span class="token-body"><b>{token.label}</b></span>
      </div>
    {/each}
  </div>
</div>