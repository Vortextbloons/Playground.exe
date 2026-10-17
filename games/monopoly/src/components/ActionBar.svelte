<script lang="ts">
  import { SPACES } from '../rules/board';
  import type { MonoAction, MonoView } from '../rules/engine';
  import DiceTray from './DiceTray.svelte';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    busy: boolean;
    ondispatch: (action: MonoAction) => void;
    ontrade: () => void;
  }

  let { view, names, busy, ondispatch, ontrade }: Props = $props();

  const you = $derived(view.you !== null ? view.players[view.you] : null);
  const canAct = $derived(view.you !== null && view.turn === view.you && !busy);
  const debt = $derived(view.phase === 'debt' ? view.debt : null);
  const owedByYou = $derived(debt !== null && view.turn === view.you);

  function act(action: MonoAction): void {
    ondispatch(action);
  }

  const buyPrice = $derived(view.phase === 'buy-decision' && view.you !== null ? SPACES[view.players[view.you]?.position ?? 0]?.price ?? 0 : 0);
</script>

<div class="action-bar">
  <div class="action-info">
    {#if view.lastRoll && view.phase !== 'preroll'}
      <DiceTray roll={view.lastRoll} />
    {:else}
      <DiceTray roll={null} />
    {/if}
    <p class="action-hint">
      {#if debt && owedByYou}
        You owe <strong>${debt.amount}</strong>{debt.creditor ? ` to ${names[debt.creditor] ?? debt.creditor}` : ' to the bank'} — mortgage or sell to raise cash.
      {:else if view.phase === 'auction'}
        Auction in progress — bid from the auction panel.
      {:else if you === null || view.you === null}
        You are spectating this match.
      {:else if !canAct}
        Waiting for <strong>{names[view.turn] ?? view.turn}</strong>…
      {:else if view.phase === 'preroll' && you?.inJail}
        You are in jail — roll doubles, pay the fine, or use a card.
      {:else if view.phase === 'preroll'}
        Roll the dice to move.
      {:else if view.phase === 'buy-decision'}
        {SPACES[you?.position ?? 0]?.name} is unowned — buy it or send it to auction.
      {:else if view.phase === 'postroll'}
        Build, mortgage, or end your turn.
      {:else if view.phase === 'results'}
        The match is over.
      {/if}
    </p>
  </div>

  {#if view.phase === 'debt' && owedByYou && view.you !== null}
    <div class="action-buttons">
      <button type="button" class="btn btn--primary" disabled={busy || (you?.cash ?? 0) < debt!.amount} onclick={() => act({ type: 'pay-debt' })}>
        Pay ${debt!.amount}
      </button>
      <button type="button" class="btn btn--danger" disabled={busy} onclick={() => act({ type: 'declare-bankrupt' })}>
        Declare bankruptcy
      </button>
    </div>
  {:else if view.phase === 'preroll' && canAct}
    <div class="action-buttons">
      {#if you?.inJail}
        <button type="button" class="btn btn--primary" disabled={busy} onclick={() => act({ type: 'jail-roll' })}>
          Roll for doubles
        </button>
        <button type="button" class="btn" disabled={busy || (you?.cash ?? 0) < 50} onclick={() => act({ type: 'jail-fine' })}>
          Pay $50 fine
        </button>
        <button type="button" class="btn" disabled={busy || (you?.heldCards.length ?? 0) === 0} onclick={() => act({ type: 'jail-card' })}>
          Use jail card
        </button>
      {:else}
        <button type="button" class="btn btn--primary" disabled={busy} onclick={() => act({ type: 'roll' })}>
          Roll dice
        </button>
      {/if}
      <button type="button" class="btn btn--ghost" disabled={busy} onclick={ontrade}>Trade</button>
    </div>
  {:else if view.phase === 'buy-decision' && canAct}
    <div class="action-buttons">
      <button type="button" class="btn btn--primary" disabled={busy || (you?.cash ?? 0) < buyPrice} onclick={() => act({ type: 'buy' })}>
        Buy for ${buyPrice}
      </button>
      <button type="button" class="btn btn--ghost" disabled={busy} onclick={() => act({ type: 'decline' })}>
        Send to auction
      </button>
    </div>
  {:else if view.phase === 'postroll' && canAct}
    <div class="action-buttons">
      <button type="button" class="btn btn--primary" disabled={busy} onclick={() => act({ type: 'end-turn' })}>
        End turn
      </button>
      <button type="button" class="btn btn--ghost" disabled={busy} onclick={ontrade}>Trade</button>
    </div>
  {/if}

  {#if view.trade && view.you !== null && view.trade.to === view.you}
    <button type="button" class="btn btn--primary trade-alert" onclick={ontrade}>
      Trade offer from {names[view.trade.from] ?? view.trade.from}
    </button>
  {/if}
</div>