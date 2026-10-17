<script lang="ts">
  import { BAILOUT_CHIPS, BAILOUT_PENALTY, BAILOUT_TIME_MS } from '../core/economy';

  let { ondecide }: { ondecide: (accept: boolean) => void } = $props();

  const seconds = BAILOUT_TIME_MS / 1000;

  function money(value: number): string {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
</script>

<div class="fixed inset-0 z-50 grid place-items-center p-4">
  <div class="bailout-veil absolute inset-0 backdrop-blur-sm" aria-hidden="true"></div>
  <div class="panel bailout-panel relative w-[min(100%,430px)] gap-3 p-5" role="dialog" aria-modal="true" aria-label="Emergency bailout offer">
    <p class="eyebrow m-0 text-red">The pit boss makes an offer</p>
    <h2 class="m-0 font-display text-[32px] leading-none tracking-[0.05em] text-gold">Bailout?</h2>
    <p class="m-0 text-[14px] leading-relaxed text-muted">
      You're out of chips, but the house will spot you <strong class="text-fog">{money(BAILOUT_CHIPS)} emergency chips</strong> so you can keep playing this run.
    </p>
    <ul class="m-0 grid gap-1.5 pl-4 text-[13px] text-muted">
      <li>− {money(BAILOUT_PENALTY)} off your final score</li>
      <li>− {seconds} seconds of playable time</li>
      <li>The clock keeps running while you decide</li>
    </ul>
    <div class="mt-1 flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary flex-1" onclick={() => ondecide(true)}>Take the {money(BAILOUT_CHIPS)}</button>
      <button type="button" class="btn flex-1" onclick={() => ondecide(false)}>Walk away</button>
    </div>
  </div>
</div>
