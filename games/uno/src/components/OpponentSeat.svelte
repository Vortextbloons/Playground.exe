<script lang="ts">
  import Card from './Card.svelte';

  interface Props {
    name: string;
    count: number;
    active: boolean;
    calledUno: boolean;
  }

  let { name, count, active, calledUno }: Props = $props();

  const initials = $derived(
    name
      .split(/\s+/)
      .map((word) => word[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?',
  );
  const backs = $derived(Array.from({ length: Math.min(4, Math.max(1, count)) }, (_, i) => i));
</script>

<div class="seat" class:active>
  <div class="fan" aria-hidden="true">
    {#each backs as i (i)}
      <div class="fan-card" style:--i={i} style:--n={backs.length}>
        <Card width={44} />
      </div>
    {/each}
  </div>
  <div class="who">
    <span class="avatar">{initials}</span>
    <span class="meta">
      <span class="name">{name}</span>
      <span class="count">{count} {count === 1 ? 'card' : 'cards'}</span>
    </span>
    {#if calledUno}
      <span class="uno-badge">UNO!</span>
    {/if}
  </div>
</div>

<style>
  .seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 10px 7px;
    border-radius: 14px;
    background: rgba(70, 5, 12, 0.5);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.12);
    transition: box-shadow 0.2s ease, background 0.2s ease, transform 0.2s ease;
  }

  .seat.active {
    background: rgba(112, 8, 20, 0.75);
    box-shadow:
      inset 0 0 0 2px var(--color-gold),
      0 0 18px rgba(255, 206, 74, 0.35);
    transform: translateY(1px) scale(1.03);
  }

  .fan {
    display: flex;
    height: 40px;
    min-width: 34px;
    justify-content: center;
  }

  .fan-card {
    position: absolute;
    transform-origin: 50% 130%;
    transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 11deg));
  }

  .fan-card :global(.card) {
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18), 0 2px 5px rgba(40, 4, 8, 0.5);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(160deg, var(--color-gold-soft), var(--color-sun));
    color: #6d3b00;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.18);
  }

  .meta {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .name {
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 800;
    font-size: 13px;
  }

  .count {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-muted);
  }

  .uno-badge {
    align-self: center;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #712d00;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 0.03em;
    animation: var(--animate-pulse-soft);
  }
</style>
