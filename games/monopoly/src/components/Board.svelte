<script lang="ts">
  import { untrack } from 'svelte';
  import { GROUP_COLORS, playerColor, SPACES, type Space } from '../rules/board';
  import type { MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    selected: number | null;
    onselect: (space: number) => void;
    paused?: boolean;
    ontravel?: (moving: boolean) => void;
  }

  let { view, names, selected = null, onselect, paused = false, ontravel }: Props = $props();

  let positions = $state<Record<string, number>>({});

  $effect(() => {
    const targets = Object.fromEntries(view.order.map(id => [id, view.players[id]!.position]));
    if (paused) return;
    const current = untrack(() => ({ ...positions }));
    const paths = Object.entries(targets).map(([id, target]) => {
      const from = current[id] ?? target;
      const distance = (target - from + 40) % 40;
      const backwards = distance === 37;
      const steps = backwards ? 3 : distance;
      const path = view.players[id]!.inJail && from !== target
        ? [target]
        : Array.from({ length: steps }, (_, i) => (from + (i + 1) * (backwards ? -1 : 1) + 40) % 40);
      current[id] = from;
      return { id, path };
    });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const moving = !reducedMotion && paths.some(({ path }) => path.length > 0);
    positions = moving ? current : targets;
    ontravel?.(moving);
    if (!moving) return;
    const timer = setInterval(() => {
      let remaining = false;
      for (const { id, path } of paths) {
        const next = path.shift();
        if (next !== undefined) {
          positions[id] = next;
          remaining = true;
        }
      }
      if (!remaining) {
        clearInterval(timer);
        ontravel?.(false);
      }
    }, 140);
    return () => clearInterval(timer);
  });

  let overhead = $state(false);
  const landmarks = [
    { x: 19, y: 17, w: 34, d: 34, h: 48, color: '#e9c58e' },
    { x: 32, y: 16, w: 29, d: 32, h: 76, color: '#9cbfc5' },
    { x: 45, y: 18, w: 32, d: 32, h: 112, color: '#5994a9' },
    { x: 58, y: 16, w: 29, d: 29, h: 62, color: '#eccb99' },
    { x: 71, y: 20, w: 35, d: 28, h: 44, color: '#e29f83' },
    { x: 19, y: 37, w: 34, d: 30, h: 36, color: '#e49f7b' },
    { x: 33, y: 36, w: 30, d: 34, h: 64, color: '#b2cdd0' },
    { x: 60, y: 37, w: 34, d: 32, h: 84, color: '#7cabbc' },
    { x: 74, y: 39, w: 28, d: 30, h: 38, color: '#e8d5aa' },
    { x: 19, y: 58, w: 30, d: 34, h: 28, color: '#e8cc98' },
    { x: 33, y: 58, w: 32, d: 30, h: 40, color: '#d88b73' },
    { x: 69, y: 60, w: 40, d: 32, h: 30, color: '#e5d2b0' },
  ];
  const trees = [[12, 14], [12, 28], [87, 17], [86, 33], [12, 47], [46, 37], [48, 50], [54, 59], [84, 58], [16, 74], [30, 75], [72, 75], [85, 74]];
  const icons: Record<string, string> = { go: '➜', railroad: '▤', utility: 'ϟ', chance: '?', chest: '▣', tax: '$', jail: '▥', parking: 'P', gotojail: '➜' };

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
      const tile = positions[id] ?? view.players[id]?.position ?? 0;
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

<div class={['city-scene', { 'is-overhead': overhead }]}>
  <div class="board-camera" aria-label="Board view">
    <button type="button" aria-pressed={!overhead} onclick={() => (overhead = false)}>City view</button>
    <button type="button" aria-pressed={overhead} onclick={() => (overhead = true)}>Overhead</button>
  </div>
  <div class="board-fit">
  <div class="city-plane">
    <div class="city-table"></div>
    {#each tiles as t (t.space.id)}
      <button
        type="button"
        class={[
          'tile',
          `tile-kind--${t.space.kind}`,
          { 'tile-corner': t.space.id % 10 === 0, 'is-selected': selected === t.space.id, 'is-occupied': (positions[view.turn] ?? view.players[view.turn]?.position) === t.space.id },
        ]}
        style:left="{t.left}px"
        style:top="{t.top}px"
        style:--group-color={t.space.group ? GROUP_COLORS[t.space.group] : null}
        style:--owner-color={ownerOf(t.space.id) ? colorOf(ownerOf(t.space.id)!) : null}
        onclick={() => onselect(t.space.id)}
        aria-label={`${t.space.name}${priceOf(t.space) ? `, ${priceOf(t.space)}` : ''}${ownerOf(t.space.id) ? `, owned by ${names[ownerOf(t.space.id)!] ?? ownerOf(t.space.id)}` : ''}`}
        aria-pressed={selected === t.space.id}
      >
        <span class="tile-top">
          {#if t.space.kind === 'street'}<span class="tile-band"></span>{/if}
          {#if icons[t.space.kind]}<span class="tile-icon" aria-hidden="true">{icons[t.space.kind]}</span>{/if}
          <span class="tile-label">{labelOf(t.space)}</span>
          {#if priceOf(t.space)}<span class="tile-price">{priceOf(t.space)}</span>{/if}
          {#key ownerOf(t.space.id)}
            {#if ownerOf(t.space.id)}<span class="tile-owner-flag"></span>{/if}
          {/key}
          {#if view.mortgages[String(t.space.id)]}<span class="tile-mortgaged">M</span>{/if}
          {#key housesOn(t.space.id)}
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
          {/key}
        </span>
      </button>
    {/each}

    <div class="city-center">
      <div class="city-water" aria-hidden="true"></div>
      <div class="city-road city-road--across" aria-hidden="true"></div>
      <div class="city-road city-road--down" aria-hidden="true"></div>
      <div class="city-park" aria-hidden="true"></div>
      <div class="city-bridge" aria-hidden="true"></div>
      <div class="city-car city-car--red" aria-hidden="true"></div>
      <div class="city-car city-car--yellow" aria-hidden="true"></div>
      {#each landmarks as building, i (i)}
        <div class="city-building" style:left="{building.x}%" style:top="{building.y}%" style:--bw="{building.w}px" style:--bd="{building.d}px" style:--bh="{building.h}px" style:--facade={building.color} style:--build-delay="{i * 55}ms" aria-hidden="true">
          <i class="building-front"></i><i class="building-side"></i><i class="building-roof"></i>
        </div>
      {/each}
      {#each trees as tree, i (i)}
        <div class="city-tree" style:left="{tree[0]}%" style:top="{tree[1]}%" style:--sway-delay="{-i * 350}ms" aria-hidden="true"><i></i></div>
      {/each}
      <div class="city-center-billboard">
        <div class="roundel">
          <strong>MONOPOLY</strong>
          <em>Build your empire</em>
        </div>
        <div class="city-decks">
          <div class="deck-card deck-card--chance"><b>?</b>Chance</div>
          <div class="deck-card deck-card--chest"><b>▣</b>Chest</div>
        </div>
      </div>
    </div>

    {#each tokens as token (token.id)}
      <div
        class={['token token-glide', { 'is-turn': view.turn === token.id }]}
        style:left="{token.left}px"
        style:top="{token.top}px"
        style:--token-color={token.color}
        role="img"
        aria-label={`${names[token.id] ?? token.id} at ${SPACES[view.players[token.id]?.position ?? 0]?.name}`}
      >
        {#key positions[token.id]}
          <span class="token-body token-hop"><b>{token.label}</b></span>
        {/key}
      </div>
    {/each}
  </div>
  </div>
  <p class="board-caption">Select a property to inspect its deed</p>
</div>

<style>
  .token-glide { transition: left 140ms linear, top 140ms linear, transform .7s; }
  .token-hop { animation-duration: 140ms; }
</style>
