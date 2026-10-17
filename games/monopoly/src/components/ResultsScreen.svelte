<script lang="ts">
  import { SPACES } from '../rules/board';
  import { netWorth, type MonoView } from '../rules/engine';

  interface Props {
    view: MonoView;
    names: Record<string, string>;
    onrestart: (() => void) | null;
    onmenu?: (() => void) | null;
  }

  let { view, names, onrestart, onmenu = null }: Props = $props();

  const standings = $derived(
    [...view.order]
      .map(id => ({
        id,
        name: names[id] ?? id,
        worth: netWorth(view, id),
        cash: view.players[id]?.cash ?? 0,
        bankrupt: view.players[id]?.bankrupt ?? false,
      }))
      .sort((a, b) => (a.bankrupt === b.bankrupt ? b.worth - a.worth : a.bankrupt ? 1 : -1)),
  );

  function deedCount(id: string): number {
    return Object.values(view.owners).filter(owner => owner === id).length;
  }

  const totalDeeds = $derived(SPACES.filter(space => space.price).length);
</script>

<div class="veil">
  <div class="modal results-modal">
    <header class="modal-head">
      <span class="modal-kicker">Match over</span>
      <h2>{view.winners.length > 1 ? 'Shared victory' : `${names[view.winners[0] ?? ''] ?? 'Nobody'} wins`}</h2>
    </header>

    <table class="results-table">
      <thead>
        <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Net worth</th><th scope="col">Cash</th><th scope="col">Deeds</th></tr>
      </thead>
      <tbody>
        {#each standings as row, index (row.id)}
          <tr class={{ 'is-bankrupt': row.bankrupt }}>
            <td>{index + 1}</td>
            <td>{row.name}{view.winners.includes(row.id) ? ' ★' : ''}</td>
            <td>${row.worth}</td>
            <td>${row.cash}</td>
            <td>{deedCount(row.id)} / {totalDeeds}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if onrestart}
      <button type="button" class="btn btn--primary" onclick={onrestart}>Play again</button>
      {#if onmenu}<button type="button" class="btn btn--ghost" onclick={onmenu}>Change rules</button>{/if}
    {:else}
      <p class="deed-note">Start a fresh match from the multiplayer menu.</p>
    {/if}
  </div>
</div>
