<script lang="ts">
  import { playerColor, SPACES } from '../rules/board';
  import type { MonoAction, MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    busy: boolean;
    ondispatch: (action: MonoAction) => void;
  }

  let { view, names, busy, ondispatch }: Props = $props();

  const auction = $derived(view.auction);
  const space = $derived(auction ? SPACES[auction.space] : null);
  const myTurn = $derived(auction !== null && view.you !== null && auction.turn === view.you);
  const me = $derived(view.you !== null ? view.players[view.you] : null);

  let custom = $state('');

  const BID_STEPS = [10, 50, 100];

  function stepBid(step: number): void {
    if (!auction) return;
    ondispatch({ type: 'bid', amount: auction.highBid + step });
  }

  function customBid(): void {
    const amount = Number.parseInt(custom, 10);
    if (!Number.isInteger(amount)) return;
    ondispatch({ type: 'bid', amount });
    custom = '';
  }

  function participantName(id: string): string {
    return names[id] ?? id;
  }
</script>

{#if auction && space}
  <div class="veil">
    <div class="modal">
      <header class="modal-head">
        <span class="modal-kicker">For sale</span>
        <h2>{space.name}</h2>
        <p class="modal-sub">List price ${space.price} — highest bid wins it.</p>
      </header>

      <p class="auction-line">
        {#if auction.highBidder}
          <strong>{participantName(auction.highBidder)}</strong> leads at <strong>${auction.highBid}</strong>
        {:else}
          No bids yet — opening bid is $10.
        {/if}
      </p>

      <ul class="auction-order">
        {#each auction.order as id (id)}
          {@const passed = auction.passed.includes(id)}
          <li class={['auction-rider', { 'is-passed': passed, 'is-turn': auction.turn === id }]}>
            <span class="dot" style:--player-color={playerColor(view.order.indexOf(id))}></span>
            {participantName(id)}{passed ? ' — passed' : ''}
          </li>
        {/each}
      </ul>

      {#if myTurn}
        <div class="action-buttons">
          {#each BID_STEPS as step (step)}
            <button
              type="button"
              class="btn"
              disabled={busy || (me?.cash ?? 0) < auction.highBid + step}
              onclick={() => stepBid(step)}
            >
              +${step}
            </button>
          {/each}
        </div>
        <div class="bid-custom">
          <input type="number" min={auction.highBid + 1} bind:value={custom} placeholder="Your bid" aria-label="Custom bid" />
          <button
            type="button"
            class="btn btn--primary"
            disabled={busy || !/^\d+$/.test(custom) || Number.parseInt(custom, 10) <= auction.highBid || (me?.cash ?? 0) < Number.parseInt(custom, 10)}
            onclick={customBid}
          >
            Bid
          </button>
        </div>
        <div class="action-buttons">
          <button type="button" class="btn btn--danger" disabled={busy} onclick={() => ondispatch({ type: 'pass-bid' })}>
            Pass
          </button>
        </div>
      {:else}
        <p class="auction-wait">Waiting for <strong>{participantName(auction.turn)}</strong> to bid…</p>
      {/if}
    </div>
  </div>
{/if}