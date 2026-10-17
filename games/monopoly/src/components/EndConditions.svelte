<script lang="ts">
  import type { EndConditions } from '../rules/engine';
  import { START_CASH, WEALTH_TARGET } from '../rules/board';

  interface Props {
    onsubmit: (conditions: EndConditions) => void;
    label?: string;
  }

  let { onsubmit, label = "Let's play" }: Props = $props();
  let bankruptcy = $state(true);
  let wealth = $state(false);
  let timed = $state(false);
  let target = $state<number | undefined>(WEALTH_TARGET);
  let minutes = $state<number | undefined>(20);
  const valid = $derived(
    (bankruptcy || wealth || timed) &&
    (!wealth || (target !== undefined && Number.isSafeInteger(target) && target > START_CASH)) &&
    (!timed || (minutes !== undefined && Number.isSafeInteger(minutes) && minutes >= 1 && Number.isSafeInteger(minutes * 60_000))),
  );

  function start(): void {
    if (!valid) return;
    onsubmit({ bankruptcy, target: wealth ? target! : null, timeLimitMs: timed ? minutes! * 60_000 : null });
  }
</script>

<div class="end-conditions">
  <fieldset>
    <legend>End the match when…</legend>
    <label class="end-condition-option">
      <input type="checkbox" bind:checked={bankruptcy} />
      <span><strong>Last player standing</strong><small>Everyone else goes bankrupt.</small></span>
    </label>
    <div class="end-condition-row">
      <label class="end-condition-option">
        <input type="checkbox" bind:checked={wealth} />
        <span><strong>A wealth target is reached</strong><small>Count cash and property value.</small></span>
      </label>
      <label class="end-condition-value"><span>Target ($)</span><input type="number" min={START_CASH + 1} step="1" bind:value={target} disabled={!wealth} required={wealth} /></label>
    </div>
    <div class="end-condition-row">
      <label class="end-condition-option">
        <input type="checkbox" bind:checked={timed} />
        <span><strong>Time runs out</strong><small>Highest net worth wins. Ties share victory.</small></span>
      </label>
      <label class="end-condition-value"><span>Minutes</span><input type="number" min="1" step="1" bind:value={minutes} disabled={!timed} required={timed} /></label>
    </div>
  </fieldset>
  <p class="end-condition-hint" role="status">{bankruptcy || wealth || timed ? 'Combine rules: the first enabled condition reached ends the match.' : 'Enable at least one end condition.'}</p>
  <button type="button" class="btn btn--primary btn--big" disabled={!valid} onclick={start}>{label}</button>
</div>
