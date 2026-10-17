<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, watching = false, reconnecting = false, onback, children }: {
    title: string;
    watching?: boolean;
    reconnecting?: boolean;
    onback: () => void;
    children: Snippet;
  } = $props();
</script>

<section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
  <div class="grid content-start gap-2">
    <header class="flex flex-wrap items-center gap-2 px-3 pt-3">
      <button type="button" class="btn" onclick={onback}>← Casino floor</button>
      <h2 class="m-0 font-display text-[clamp(22px,5vw,30px)] leading-none tracking-[0.05em] text-fog">{title}</h2>
      {#if reconnecting}
        <span class="badge alert ml-auto">offline</span>
      {:else if watching}
        <span class="badge alert ml-auto">watching</span>
      {/if}
    </header>
    {#if reconnecting}
      <p class="mx-3 rounded-xl border border-dashed border-red/40 bg-red/5 px-3 py-2 text-[12.5px] text-red">
        Reconnecting… betting is paused until the connection is back.
      </p>
    {:else if watching}
      <p class="mx-3 rounded-xl border border-dashed border-red/40 bg-red/5 px-3 py-2 text-[12.5px] text-red">
        You're watching this table — take a seat in the party lobby to place bets.
      </p>
    {/if}
  </div>
  <div class="safe-bottom grid min-h-0 px-3" class:pointer-events-none={reconnecting} class:opacity-60={reconnecting}>
    {@render children()}
  </div>
</section>
