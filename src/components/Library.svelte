<script lang="ts">
  import { onMount } from 'svelte';
  import type { GameMetadata } from '../data/games';
  import { readLocal, writeLocal } from '../lib/storage';
  let { games, base, guide }: { games: GameMetadata[]; base: string; guide: string } = $props();
  let query = $state(''); let genre = $state('All games'); let sort = $state('newest'); let compact = $state(false);
  const genres = $derived(['All games', ...new Set(games.map(game => game.genre))]);
  const filtered = $derived(games.filter(game => (genre === 'All games' || game.genre === genre) && `${game.title} ${game.description} ${game.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  onMount(() => { sort = readLocal('sort', 'newest', (value): value is string => ['newest', 'oldest', 'title'].includes(String(value))); compact = readLocal('compact', false, (value): value is boolean => typeof value === 'boolean'); });
  function reset() { query = ''; genre = 'All games'; }
</script>

<section class="library" id="library" aria-labelledby="library-title">
  <div class="library-heading"><div><p class="eyebrow">THE COLLECTION</p><h2 id="library-title">Game library <span class="count">{games.length}</span></h2></div><span class="library-note"><span class="status-dot"></span> No downloads. Just play.</span></div>
  <div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search games" placeholder="Find your next favorite…" bind:value={query}/>{#if query}<button aria-label="Clear search" onclick={() => query = ''}>×</button>{/if}</label><label class="sort"><span>Sort by</span><select aria-label="Sort games" bind:value={sort} onchange={(event) => writeLocal('sort', event.currentTarget.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select></label><button class="view-button" aria-label={compact ? 'Use spacious grid' : 'Use compact grid'} aria-pressed={compact} onclick={() => { compact = !compact; writeLocal('compact', compact); }}>▦</button></div>
  <div class="filter-row"><div class="filters" aria-label="Filter by genre">{#each genres as item (item)}<button class={{ chosen: genre === item }} aria-pressed={genre === item} onclick={() => genre = item}>{item}{#if item === 'All games'}<span>{games.length}</span>{/if}</button>{/each}</div><span class="results" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'game' : 'games'}</span></div>
  {#if games.length === 0}
    <div class="empty-state"><div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 80 64" fill="none"><path d="M20 17h40l10 31c2 8-7 12-12 7l-9-8H31l-9 8c-5 5-14 1-12-7z" stroke="currentColor" stroke-width="2"/><path d="M27 27v14M20 34h14" stroke="currentColor" stroke-width="2"/><circle cx="52" cy="30" r="2" fill="currentColor"/><circle cx="59" cy="37" r="2" fill="currentColor"/><path d="M35 17V8h10V2" stroke="currentColor" stroke-width="2"/></svg><span class="mini-spark">✧</span></div><span class="empty-tag">AN EMPTY LIBRARY. A FRESH START.</span><h3>The next great little game<br/>could be yours.</h3><p>No games here just yet. This space is ready for whatever<br class="desktop-break"/> you dream up, build, and hit publish on.</p><a class="button primary" href={guide}>Add your first game <span aria-hidden="true">↗</span></a><span class="empty-footnote">One idea. One folder. A new place to play.</span></div>
  {:else if filtered.length === 0}
    <div class="empty-state"><h3>No games found.</h3><p>Try a different search or genre.</p><button class="button primary" onclick={reset}>Clear filters</button></div>
  {:else}
    <div class={['game-grid', { compact }]}>{#each filtered as game (game.id)}<a class="game-card" href={`${base}play/${game.id}/`}><div class="game-cover">{#if game.cover}<img src={`${base}games/${game.id}/${game.cover}`} alt="" loading="lazy"/>{:else}<span aria-hidden="true">▧</span>{/if}<span class="play-chip">Play ↗</span></div><div class="card-copy"><span class="eyebrow">{game.genre}</span><h3>{game.title}</h3><p>{game.description}</p><span class="card-author">By {game.author}</span></div></a>{/each}</div>
  {/if}
  <aside class="developer-strip"><span class="code-icon" aria-hidden="true">&lt;/&gt;</span><div><h3>Made for playing. Built for creating.</h3><p>Your next idea already has a home. Start with the Game Kit and make it yours.</p></div><a href={guide}>Meet the Game Kit <span aria-hidden="true">↗</span></a></aside>
</section>
