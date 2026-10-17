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
        <h2>{names[incoming.from] ?? incoming.from} proposes a trade</h2>
        <p class="modal-sub">Review both sides before accepting the deal.</p>
      </header>
      <div class="trade-columns">
        <div class="trade-side">
          <h3>You receive</h3>
          <p class="offer-cash">${incoming.cash.toLocaleString()} <small>cash</small></p>
          {#each incoming.properties as id (id)}<span class="deed-chip" style={chipStyle(id)}>{deedLabel(id)}{#if view.mortgages[String(id)]}<em>Mortgaged</em>{/if}</span>{/each}
          {#if incoming.cash === 0 && incoming.properties.length === 0}<p class="deed-note">Nothing</p>{/if}
        </div>
        <div class="trade-side">
          <h3>You give</h3>
          <p class="offer-cash">${incoming.wantCash.toLocaleString()} <small>cash</small></p>
          {#each incoming.wantProperties as id (id)}<span class="deed-chip" style={chipStyle(id)}>{deedLabel(id)}{#if view.mortgages[String(id)]}<em>Mortgaged</em>{/if}</span>{/each}
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
        <h2>Make a deal</h2>
        <p class="modal-sub">Choose cash and deeds for each side of the trade.</p>
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
            <small>${(me?.cash ?? 0).toLocaleString()} available</small>
          </label>
          <p class="property-count">Properties <span>{giveProps.length} selected</span></p>
          <div class="deed-chips">
            {#each myDeeds as id (id)}
              <button
                type="button"
                class={['deed-chip', { 'is-picked': giveProps.includes(id) }]}
                aria-pressed={giveProps.includes(id)}
                style={chipStyle(id)}
                onclick={() => (giveProps = toggle(giveProps, id))}
              >
                {deedLabel(id)}
                {#if view.mortgages[String(id)]}<em>Mortgaged</em>{/if}
              </button>
            {/each}
            {#if myDeeds.length === 0}<p class="deed-note">You own nothing yet.</p>{/if}
          </div>
        </div>
        <div class="trade-side">
          <h3>You receive</h3>
          <label class="trade-cash">
            Cash
            <input type="number" min="0" max={them?.cash ?? 0} bind:value={wantCash} />
            <small>${(them?.cash ?? 0).toLocaleString()} available</small>
          </label>
          <p class="property-count">Properties <span>{wantProps.length} selected</span></p>
          <div class="deed-chips">
            {#each theirDeeds as id (id)}
              <button
                type="button"
                class={['deed-chip', { 'is-picked': wantProps.includes(id) }]}
                aria-pressed={wantProps.includes(id)}
                style={chipStyle(id)}
                onclick={() => (wantProps = toggle(wantProps, id))}
              >
                {deedLabel(id)}
                {#if view.mortgages[String(id)]}<em>Mortgaged</em>{/if}
              </button>
            {/each}
            {#if theirDeeds.length === 0}<p class="deed-note">They own nothing yet.</p>{/if}
          </div>
        </div>
      </div>

      {#if blockedByBuildings}<p class="deed-note">Properties with buildings cannot be traded — sell the houses first.</p>{/if}

      <div class="trade-summary">
        <span>You give <strong>${(giveCash ?? 0).toLocaleString()} + {giveProps.length} {giveProps.length === 1 ? 'deed' : 'deeds'}</strong></span>
        <span>You receive <strong>${(wantCash ?? 0).toLocaleString()} + {wantProps.length} {wantProps.length === 1 ? 'deed' : 'deeds'}</strong></span>
      </div>

      <div class="action-buttons">
        <button type="button" class="btn btn--primary" disabled={busy || !effectivePartner || blockedByBuildings} onclick={propose}>
          Propose trade
        </button>
        <button type="button" class="btn btn--ghost" onclick={onclose}>Cancel</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .trade-modal { width: min(760px, calc(100vw - 32px)); gap: 20px; padding: 28px; }
  .modal-head { margin: 0; gap: 6px; }
  .trade-modal h2 { font-family: var(--font-display); font-size: clamp(28px, 5vw, 38px); line-height: 1.05; margin: 0; }
  .trade-partner { padding: 12px 16px; background: #dfe8d5; border-radius: 8px; }
  .trade-partner select { min-height: 44px; border-color: #57727066; }
  .trade-columns { gap: 16px; }
  .trade-side { min-width: 0; padding: 18px; gap: 14px; border: 1px solid #173d3c33; border-top: 5px solid #577270; border-radius: 8px; background: #fff; }
  .trade-side:last-child { border-top-color: #15866a; background: #f0f8f4; }
  .trade-side h3 { color: #173d3c; font-family: var(--font-display); font-size: 25px; letter-spacing: 0; text-transform: none; }
  .trade-cash { gap: 6px; }
  .trade-cash input { min-width: 0; min-height: 52px; font-size: 24px; font-variant-numeric: tabular-nums; border-color: #57727066; }
  .trade-cash small { font-size: 11px; font-weight: 500; }
  .property-count { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; font-size: 12px; font-weight: 700; }
  .property-count span { color: #577270; font-weight: 500; }
  .deed-chips { display: grid; gap: 8px; }
  .trade-side .deed-chip { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; min-height: 48px; padding: 10px 34px 10px 14px; border: 1px solid #173d3c33; border-left: 7px solid var(--chip-color); border-radius: 4px; background: #fff; color: #173d3c; white-space: normal; text-align: left; font-size: 12px; box-shadow: 0 2px 0 #173d3c0a; animation: none; }
  button.deed-chip::after { content: '+'; position: absolute; right: 12px; font-size: 20px; color: #577270; }
  .trade-side .deed-chip.is-picked { background: #dfe8d5; border-color: #15866a; border-left-color: var(--chip-color); }
  button.deed-chip.is-picked::after { content: '✓'; color: #15866a; }
  .deed-chip em { font-size: 10px; font-style: normal; color: #577270; background: #e7eeeb; }
  .offer-cash { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .offer-cash small { font-size: 12px; font-weight: 500; color: #577270; }
  .trade-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 18px; border-block: 1px solid #173d3c26; }
  .trade-summary span { display: grid; gap: 4px; font-size: 11px; color: #577270; }
  .trade-summary strong { font-size: 14px; color: #173d3c; }
  .action-buttons { justify-content: flex-end; }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 3px solid #15866a; outline-offset: 3px; }
  @media (max-width: 540px) {
    .trade-modal { padding: 20px 16px; gap: 16px; }
    .trade-modal .trade-columns { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .trade-side { padding: 14px; }
    .trade-partner { padding: 10px; }
    .trade-summary { padding: 12px 0; }
    .action-buttons .btn { flex: 1; }
  }
</style>
