<script lang="ts">
  import { GROUP_COLORS, GROUP_SPACES, SPACES } from '../rules/board';
  import type { MonoAction, MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    busy: boolean;
    ondispatch: (action: MonoAction) => void;
    onclose: () => void;
  }

  let { view, names, busy, ondispatch, onclose }: Props = $props();

  const incoming = $derived(view.trade !== null && view.you !== null && view.trade.to === view.you ? view.trade : null);

  const solventOthers = $derived(
    view.order.filter(id => id !== view.you && !view.players[id]?.bankrupt),
  );

  let partner = $state('');
  const effectivePartner = $derived(partner === '' && solventOthers.length > 0 ? solventOthers[0]! : partner);
  let giveCash = $state(0);
  let wantCash = $state(0);
  let giveProps = $state<number[]>([]);
  let wantProps = $state<number[]>([]);

  function deedsOf(id: string): number[] {
    return Object.entries(view.owners)
      .filter(([, owner]) => owner === id)
      .map(([key]) => Number(key))
      .sort((a, b) => a - b);
  }

  const myDeeds = $derived(view.you !== null ? deedsOf(view.you) : []);
  const theirDeeds = $derived(effectivePartner ? deedsOf(effectivePartner) : []);

  const blockedByBuildings = $derived.by(() => {
    const involved = [...giveProps, ...wantProps];
    for (const id of involved) {
      const space = SPACES[id]!;
      if (!space.group) continue;
      if (GROUP_SPACES[space.group].some(gid => (view.houses[String(gid)] ?? 0) > 0)) return true;
    }
    return false;
  });

  const me = $derived(view.you !== null ? view.players[view.you] : null);
  const them = $derived(effectivePartner ? view.players[effectivePartner] : null);

  function toggle(list: number[], id: number): number[] {
    return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
  }

  function chipStyle(id: number): string {
    const space = SPACES[id]!;
    return space.group ? `--chip-color:${GROUP_COLORS[space.group]}` : '--chip-color:#8a8f98';
  }

  function propose(): void {
    if (!effectivePartner || view.you === null) return;
    ondispatch({
      type: 'propose-trade',
      to: effectivePartner,
      cash: giveCash,
      properties: giveProps,
      wantCash,
      wantProperties: wantProps,
    });
    onclose();
  }

  function deedLabel(id: number): string {
    return SPACES[id]!.name;
  }
</script>

<div class="veil" onclick={onclose} role="presentation">
  <div class="modal trade-modal" onclick={(event) => event.stopPropagation()} role="presentation">
    {#if incoming}
      <header class="modal-head">
        <span class="modal-kicker">Trade offer</span>
        <h2>{names[incoming.from] ?? incoming.from} proposes a trade</h2>
      </header>
      <div class="trade-columns">
        <div class="trade-side">
          <h3>You receive</h3>
          {#if incoming.cash > 0}<p>${incoming.cash}</p>{/if}
          {#each incoming.properties as id (id)}<span class="deed-chip" style={chipStyle(id)}>{deedLabel(id)}</span>{/each}
          {#if incoming.cash === 0 && incoming.properties.length === 0}<p class="deed-note">Nothing</p>{/if}
        </div>
        <div class="trade-side">
          <h3>You give</h3>
          {#if incoming.wantCash > 0}<p>${incoming.wantCash}</p>{/if}
          {#each incoming.wantProperties as id (id)}<span class="deed-chip" style={chipStyle(id)}>{deedLabel(id)}</span>{/each}
          {#if incoming.wantCash === 0 && incoming.wantProperties.length === 0}<p class="deed-note">Nothing</p>{/if}
        </div>
      </div>
      <div class="action-buttons">
        <button type="button" class="btn btn--primary" disabled={busy} onclick={() => ondispatch({ type: 'accept-trade' })}>
          Accept
        </button>
        <button type="button" class="btn btn--danger" disabled={busy} onclick={() => ondispatch({ type: 'reject-trade' })}>
          Reject
        </button>
      </div>
    {:else}
      <header class="modal-head">
        <span class="modal-kicker">Trade</span>
        <h2>Propose a trade</h2>
      </header>

      <label class="trade-partner">
        Trade with
        <select bind:value={partner}>
          {#each solventOthers as id (id)}
            <option value={id}>{names[id] ?? id}</option>
          {/each}
        </select>
      </label>

      <div class="trade-columns">
        <div class="trade-side">
          <h3>You give</h3>
          <label class="trade-cash">
            Cash
            <input type="number" min="0" max={me?.cash ?? 0} bind:value={giveCash} />
          </label>
          <div class="deed-chips">
            {#each myDeeds as id (id)}
              <button
                type="button"
                class="deed-chip"
                class:is-picked={giveProps.includes(id)}
                style={chipStyle(id)}
                onclick={() => (giveProps = toggle(giveProps, id))}
              >
                {deedLabel(id)}
                {#if view.mortgages[String(id)]}<em>m</em>{/if}
              </button>
            {/each}
            {#if myDeeds.length === 0}<p class="deed-note">You own nothing yet.</p>{/if}
          </div>
        </div>
        <div class="trade-side">
          <h3>You get</h3>
          <label class="trade-cash">
            Cash
            <input type="number" min="0" max={them?.cash ?? 0} bind:value={wantCash} />
          </label>
          <div class="deed-chips">
            {#each theirDeeds as id (id)}
              <button
                type="button"
                class="deed-chip"
                class:is-picked={wantProps.includes(id)}
                style={chipStyle(id)}
                onclick={() => (wantProps = toggle(wantProps, id))}
              >
                {deedLabel(id)}
                {#if view.mortgages[String(id)]}<em>m</em>{/if}
              </button>
            {/each}
            {#if theirDeeds.length === 0}<p class="deed-note">They own nothing yet.</p>{/if}
          </div>
        </div>
      </div>

      {#if blockedByBuildings}<p class="deed-note">Properties with buildings cannot be traded — sell the houses first.</p>{/if}

      <div class="action-buttons">
        <button type="button" class="btn btn--primary" disabled={busy || !effectivePartner || blockedByBuildings} onclick={propose}>
          Propose trade
        </button>
        <button type="button" class="btn btn--ghost" onclick={onclose}>Cancel</button>
      </div>
    {/if}
  </div>
</div>