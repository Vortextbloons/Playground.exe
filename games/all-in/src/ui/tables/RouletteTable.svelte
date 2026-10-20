<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView } from '../../core/types';
  import { ROULETTE_BET_MS, ROULETTE_LIMIT, ROULETTE_MAX_CHIPS, ROULETTE_MAX_TOTAL, ROULETTE_MIN_CHIP, ROULETTE_RESULT_MS } from '../../games/roulette';
  import type { RouletteBetKind, RouletteChip, RouletteView } from '../../games/roulette';
  import { sound } from '../../sound';
  import Avatar from '../Avatar.svelte';

  let { detail, view, names, send }: { detail: Json; view: PlayerView; names: Record<string, string>; send: (action: string, payload: Json) => void } = $props();

  const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const BLACK = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];
  const ODD = Array.from({ length: 18 }, (_, index) => index * 2 + 1);
  const EVEN = Array.from({ length: 18 }, (_, index) => index * 2 + 2);
  const LOW = Array.from({ length: 18 }, (_, index) => index + 1);
  const HIGH = Array.from({ length: 18 }, (_, index) => index + 19);
  const CHIP_VALUES = [1, 5, 10, 25, 100, 500, 1000];
  const COIN_COLORS = ['#d8b76c', '#96d3ae', '#e57475'];
  const ROWS = [
    [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
    [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
    [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
  ];
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const WHEEL_STEP = 360 / WHEEL_ORDER.length;

  const PAYOUTS: Record<RouletteBetKind, string> = {
    straight: '35:1',
    split: '17:1',
    street: '11:1',
    corner: '8:1',
    sixline: '5:1',
    column: '2:1',
    dozen: '2:1',
    red: '1:1',
    black: '1:1',
    odd: '1:1',
    even: '1:1',
    low: '1:1',
    high: '1:1',
  };

  type GridCell = { key: string; kind: RouletteBetKind; label: string; numbers: number[] };
  type Combo = { kind: RouletteBetKind; numbers: number[]; label: string };

  const DOZENS: GridCell[] = [
    { base: 1, label: '1st 12' },
    { base: 13, label: '2nd 12' },
    { base: 25, label: '3rd 12' },
  ].map(entry => ({
    key: `k:dozen:${entry.base}`,
    kind: 'dozen',
    label: entry.label,
    numbers: Array.from({ length: 12 }, (_, index) => entry.base + index),
  }));

  const COLUMNS: GridCell[] = [
    { base: 1, label: 'COL 1–12' },
    { base: 13, label: 'COL 13–24' },
    { base: 25, label: 'COL 25–36' },
  ].map(entry => ({
    key: `k:column:${entry.base}`,
    kind: 'column',
    label: entry.label,
    numbers: Array.from({ length: 12 }, (_, index) => entry.base + index),
  }));

  const EVEN_MONEY: GridCell[] = [
    { key: 'k:low', kind: 'low', label: '1–18', numbers: LOW },
    { key: 'k:even', kind: 'even', label: 'EVEN', numbers: EVEN },
    { key: 'k:red', kind: 'red', label: 'RED', numbers: RED },
    { key: 'k:black', kind: 'black', label: 'BLACK', numbers: BLACK },
    { key: 'k:odd', kind: 'odd', label: 'ODD', numbers: ODD },
    { key: 'k:high', kind: 'high', label: '19–36', numbers: HIGH },
  ];

  function polar(radius: number, degrees: number): string {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return `${(radius * Math.cos(radians)).toFixed(3)} ${(radius * Math.sin(radians)).toFixed(3)}`;
  }

  function sectorPath(index: number): string {
    const outer = 58;
    const inner = 40;
    const start = index * WHEEL_STEP;
    const end = start + WHEEL_STEP;
    return `M ${polar(outer, start)} A ${outer} ${outer} 0 0 1 ${polar(outer, end)} L ${polar(inner, end)} A ${inner} ${inner} 0 0 0 ${polar(inner, start)} Z`;
  }

  function rayPoints(index: number): string {
    const outer = 64;
    const inner = 46;
    const center = index * 30;
    const spread = 3.4;
    return `${polar(outer, center - spread)} ${polar(outer, center + spread)} ${polar(inner, center + spread)} ${polar(inner, center - spread)}`;
  }

  const SECTORS = WHEEL_ORDER.map((value, index) => ({
    value,
    path: sectorPath(index),
    color: value === 0 ? '#1fae90' : RED.includes(value) ? '#b32342' : '#1b2338',
  }));

  const RAYS = Array.from({ length: 12 }, (_, index) => rayPoints(index));

  function asRouletteView(value: Json): RouletteView | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, Json>;
    if (record.phase !== 'betting' && record.phase !== 'results') return null;
    const wheel = record.wheel;
    if (wheel === null || typeof wheel !== 'object' || Array.isArray(wheel)) return null;
    const chips = record.chips;
    if (chips === null || typeof chips !== 'object' || Array.isArray(chips)) return null;
    if (!Array.isArray(record.lastResults) || !Array.isArray(record.yourChips)) return null;
    return value as unknown as RouletteView;
  }

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function anchorKey(chip: RouletteChip): string {
    if (chip.kind === 'column' || chip.kind === 'dozen') return `k:${chip.kind}:${chip.numbers[0] ?? 0}`;
    if (chip.kind === 'red' || chip.kind === 'black' || chip.kind === 'odd' || chip.kind === 'even' || chip.kind === 'low' || chip.kind === 'high') return `k:${chip.kind}`;
    return `n:${chip.numbers[0] ?? 0}`;
  }

  function combosFor(number: number): Combo[] {
    const combos: Combo[] = [{ kind: 'straight', numbers: [number], label: `STRAIGHT ${number}` }];
    if (number < 1) return combos;
    if (number % 3 !== 0) combos.push({ kind: 'split', numbers: [number, number + 1], label: `${number}/${number + 1}` });
    if (number % 3 !== 1) combos.push({ kind: 'split', numbers: [number - 1, number], label: `${number - 1}/${number}` });
    if (number + 3 <= 36) combos.push({ kind: 'split', numbers: [number, number + 3], label: `${number}/${number + 3}` });
    if (number - 3 >= 1) combos.push({ kind: 'split', numbers: [number - 3, number], label: `${number - 3}/${number}` });
    const street = number - ((number - 1) % 3);
    combos.push({ kind: 'street', numbers: [street, street + 1, street + 2], label: `ST ${street}–${street + 2}` });
    for (const base of [number - 4, number - 3, number - 1, number]) {
      if (base >= 1 && base <= 32 && base % 3 !== 0) combos.push({ kind: 'corner', numbers: [base, base + 1, base + 3, base + 4], label: `C ${base}/${base + 1}/${base + 3}/${base + 4}` });
    }
    for (let base = 1; base <= 31; base += 3) {
      if (number >= base && number <= base + 5) combos.push({ kind: 'sixline', numbers: [base, base + 1, base + 2, base + 3, base + 4, base + 5], label: `L ${base}–${base + 5}` });
    }
    return combos;
  }

  function coinStyle(index: number): string {
    const left = (index * 37) % 100;
    const delay = (((index * 53) % 90) / 100).toFixed(2);
    const duration = (1.1 + ((index * 29) % 80) / 100).toFixed(2);
    const drift = ((index * 61) % 120) - 60;
    const color = COIN_COLORS[index % 3]!;
    const size = 7 + ((index * 17) % 7);
    return `left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s;--drift:${drift}px;width:${size}px;height:${size}px;background:radial-gradient(circle at 35% 30%, #fff6d8, ${color} 72%);`;
  }

  const table = $derived(asRouletteView(detail));
  const viewerId = $derived(view.you);
  const active = $derived(view.vault?.status === 'active');
  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const open = $derived(table !== null && table.phase === 'betting');
  const settling = $derived(table !== null && table.phase === 'results');

  let chipValue = $state(1);
  let selected = $state<number | null>(null);
  let turns = $state(0);
  let snapshotAt = $state(Date.now());
  let clockNow = $state(Date.now());
  let ballAngle = $state(0);
  let ballRadius = $state(56);
  let ballVisible = $state(false);
  let rainKey = $state(0);
  let rainCount = $state(0);
  let shake = $state(false);
  let wobbleKey = $state(0);
  let previousPhase: RouletteView['phase'] | null = null;
  let lastOwnChips: RouletteChip[] = [];
  let lastTicked = -1;
  let ballFrame = 0;
  let shakeTimer = 0;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cancelBall(): void {
    if (ballFrame !== 0) {
      cancelAnimationFrame(ballFrame);
      ballFrame = 0;
    }
  }

  function launchBall(last: number | null): void {
    cancelBall();
    if (last === null) {
      ballVisible = false;
      return;
    }
    if (reduced) {
      ballAngle = 0;
      ballRadius = 41.5;
      ballVisible = true;
      return;
    }
    const index = Math.max(0, WHEEL_ORDER.indexOf(last));
    const startTime = performance.now();
    const startAngle = 720 + (index + 1) * 53;
    ballVisible = true;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / 2600);
      const eased = 1 - Math.pow(1 - t, 3);
      ballAngle = startAngle * (1 - eased);
      ballRadius = 56 - (56 - 41.5) * (1 - Math.pow(1 - t, 2));
      ballFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    ballFrame = requestAnimationFrame(step);
  }

  $effect(() => {
    if (view.now > 0) snapshotAt = Date.now();
  });

  $effect(() => {
    const id = window.setInterval(() => {
      clockNow = Date.now();
    }, 200);
    return () => clearInterval(id);
  });

  $effect(() => {
    const current = table;
    const deadline = current?.deadline ?? 0;
    if (current === null || deadline === 0) {
      lastTicked = deadline;
      return;
    }
    if (view.phase !== 'playing') return;
    if (remaining > 0 || lastTicked === deadline) return;
    lastTicked = deadline;
    send('tick', null);
  });

  $effect(() => {
    const current = table;
    if (current !== null && current.phase === 'betting') lastOwnChips = current.yourChips;
  });

  $effect(() => {
    const current = table;
    if (current === null) return;
    if (previousPhase === null) {
      previousPhase = current.phase;
      return;
    }
    if (current.phase === previousPhase) return;
    previousPhase = current.phase;
    if (current.phase !== 'results') {
      cancelBall();
      ballVisible = false;
      rainCount = 0;
      return;
    }
    turns += 1;
    launchBall(current.wheel.last);
    const best = current.lastResults.reduce((max, row) => Math.max(max, row.net), 0);
    rainCount = reduced || best <= 0 ? 0 : Math.min(64, Math.round(best / 20) + 8);
    rainKey += 1;
    const mine = current.lastResults.find(row => row.id === viewerId) ?? null;
    if (mine !== null) sound.play(mine.net > 0 ? 'win' : 'lose');
    const hit = current.wheel.last !== null && lastOwnChips.some(chip => chip.kind === 'straight' && chip.numbers[0] === current.wheel.last);
    if (hit) {
      shake = true;
      clearTimeout(shakeTimer);
      shakeTimer = window.setTimeout(() => {
        shake = false;
      }, 520);
    }
  });

  $effect(() => () => {
    cancelBall();
    clearTimeout(shakeTimer);
  });

  const remaining = $derived(table !== null && table.deadline > 0 ? Math.max(0, table.deadline - (view.now + (clockNow - snapshotAt))) : 0);
  const fever = $derived(open && table !== null && table.deadline > 0 && remaining <= 3000);
  const windowMs = $derived(table?.phase === 'results' ? ROULETTE_RESULT_MS : ROULETTE_BET_MS);
  const fraction = $derived(Math.min(100, Math.max(0, (remaining / windowMs) * 100)));
  const staked = $derived(table !== null ? table.yourChips.reduce((sum, chip) => sum + chip.amount, 0) : 0);
  const wouldExceed = $derived(staked + chipValue > ROULETTE_MAX_TOTAL || (table?.yourChips.length ?? 0) >= ROULETTE_MAX_CHIPS);
  const canBet = $derived(active && open && bankroll >= chipValue && !wouldExceed);
  const canClear = $derived(active && (table?.yourChips.length ?? 0) > 0);
  const occupants = $derived(view.players.filter(player => player.at === 'roulette'));
  const bettable = $derived(occupants.filter(player => player.bankroll >= ROULETTE_MIN_CHIP));
  const canSpin = $derived.by(() => {
    if (table === null || !active || table.phase !== 'betting') return false;
    if (table.deadline === 0) return table.yourChips.length > 0;
    if (Object.keys(table.chips).length === 0) return false;
    return bettable.every(player => (table.chips[player.id]?.length ?? 0) > 0);
  });
  const spinHint = $derived.by(() => {
    if (table === null) return 'Waiting for the table.';
    if (!active) return 'Take a seat to play.';
    if (table.phase !== 'betting') return 'Wheel is spinning.';
    if (table.deadline === 0) return table.yourChips.length > 0 ? 'Spin the wheel.' : 'Place a bet first.';
    if (Object.keys(table.chips).length === 0) return 'Place a bet first.';
    if (!bettable.every(player => (table.chips[player.id]?.length ?? 0) > 0)) return 'Everyone at the table must place a bet first.';
    return 'Spin the wheel.';
  });
  const dockHint = $derived.by(() => {
    if (!active) return 'Watching — take a seat in the lobby to play.';
    if (table === null) return '';
    if (table.phase === 'results') return 'Round resolving…';
    if (wouldExceed) return `Table cap — max ${money(ROULETTE_MAX_TOTAL)} staked each round.`;
    if (bankroll < chipValue) return `Bankroll too low for a ${money(chipValue)} chip.`;
    if (table.deadline > 0 && Object.keys(table.chips).length === 0) return 'Bets are open — the window closes on its own.';
    if (table.deadline > 0 && !canSpin) return 'Waiting on every bettable player to place a chip.';
    if (table.deadline === 0 && staked === 0) return 'Place chips any time, then spin.';
    return canSpin ? 'Ready when you are.' : '';
  });

  const feltStakes = $derived.by(() => {
    const stakes: Record<string, number> = {};
    if (table === null) return stakes;
    for (const chip of table.yourChips) {
      const key = anchorKey(chip);
      stakes[key] = (stakes[key] ?? 0) + chip.amount;
    }
    return stakes;
  });

  const playerStakes = $derived.by(() => {
    const stakes: Record<string, { amount: number; count: number }> = {};
    if (table === null) return stakes;
    for (const [id, chips] of Object.entries(table.chips)) {
      stakes[id] = { amount: chips.reduce((sum, chip) => sum + chip.amount, 0), count: chips.length };
    }
    return stakes;
  });

  const history = $derived(table !== null ? [...table.wheel.history].reverse() : []);
  const selectedCombos = $derived(selected === null ? [] : combosFor(selected));
  const wheelAngle = $derived.by(() => {
    const last = table?.wheel.last ?? null;
    if (last === null) return turns * 360;
    const index = Math.max(0, WHEEL_ORDER.indexOf(last));
    return turns * 360 - (index + 0.5) * WHEEL_STEP;
  });
  const ballPoint = $derived.by(() => {
    const radians = (ballAngle * Math.PI) / 180;
    return { x: (ballRadius * Math.sin(radians)).toFixed(2), y: (-ballRadius * Math.cos(radians)).toFixed(2) };
  });
  const rainCoins = $derived(Array.from({ length: rainCount }, (_, index) => ({ id: index, style: coinStyle(index) })));

  function stakeAt(key: string): number {
    return feltStakes[key] ?? 0;
  }

  function place(kind: RouletteBetKind, numbers: number[]): void {
    if (!canBet) return;
    if (kind === 'straight') selected = numbers[0] ?? null;
    send('bet', { kind, numbers: [...numbers], amount: chipValue });
    sound.play('chip');
    wobbleKey += 1;
  }

  function clearBets(): void {
    if (!canClear) return;
    send('clear', null);
    sound.play('chip');
  }

  function spinWheel(): void {
    if (!canSpin) return;
    send('spin', null);
    sound.play('spin');
  }
</script>

{#if table === null}
  <div class="stub-card" data-table="roulette">
    <h3 class="m-0 font-display text-[28px] leading-none tracking-[0.05em] text-red">Roulette</h3>
    <p class="m-0 text-[13px] text-muted">Waiting for the wheel to report in…</p>
  </div>
{:else}
  <div class="flex h-full min-h-0 min-w-0 flex-col gap-3 short:gap-2" class:table-shake={shake} data-table="roulette">
    <div class="roulette-layout grid min-h-0 min-w-0 flex-1 gap-3 short:gap-2 short:grid-cols-[212px_minmax(0,1fr)] min-[900px]:grid-cols-[280px_minmax(0,1fr)]">
      <div class="panel short:gap-1.5 short:p-2">
        <div class="flex items-center justify-between gap-2">
          <p class="eyebrow m-0">The wheel</p>
          <span class="badge" class:shared={table.phase === 'betting'} class:alert={table.phase === 'results'}>
            {table.phase === 'betting' ? (table.deadline === 0 ? 'solo' : 'shared') : 'settling'}
          </span>
        </div>
        <div class="grid grid-cols-[124px_minmax(0,1fr)] items-center gap-3 short:grid-cols-[98px_minmax(0,1fr)] short:gap-2">
          <svg viewBox="-66 -66 132 132" class="w-full max-w-[150px] justify-self-center" role="img" aria-label={`Roulette wheel, last outcome ${table.wheel.last === null ? 'none' : table.wheel.last}`}>
            <circle r="63" fill="#0a0f1d" stroke="rgba(216, 183, 108, 0.35)" stroke-width="1.5" />
            {#if settling}
              <g class="wheel-rays" aria-hidden="true">
                {#each RAYS as points, index (index)}
                  <polygon points={points} />
                {/each}
              </g>
            {/if}
            <g class="wheel-rotor" style:transform={`rotate(${wheelAngle}deg)`}>
              {#each SECTORS as sector (sector.value)}
                <path d={sector.path} fill={sector.color} stroke="#070b14" stroke-width="0.5" class:win={settling && table.wheel.last === sector.value} />
              {/each}
            </g>
            <circle r="39" fill="#0a0f1d" stroke="rgba(216, 183, 108, 0.25)" />
            <circle r="30" fill="#122a21" stroke="#47604a" />
            {#key table.wheel.last}
              <text class="wheel-last" x="0" y="1" text-anchor="middle" dominant-baseline="central">{table.wheel.last ?? '–'}</text>
            {/key}
            {#if settling}
              <g class="wheel-streak" aria-hidden="true">
                <circle r="60" class="streak-ring" />
                <circle r="45" class="streak-ring alt" />
              </g>
              <path class="spotlight" d="M -18 -66 L 18 -66 L 4 -34 L -4 -34 Z" />
              <circle class="pocket-glow" cx="0" cy="-49" r="10" />
            {/if}
            {#if ballVisible}
              <circle class="wheel-ball" cx={ballPoint.x} cy={ballPoint.y} r="3.4" />
            {/if}
            <polygon points="-5,-64 5,-64 0,-52" fill="var(--color-gold)" />
          </svg>
          <div class="grid gap-2 short:gap-1">
            <div>
              <p class="eyebrow m-0">Last spin</p>
              <p class="m-0 font-display text-[34px] leading-none tracking-wide text-gold short:text-[26px]">{table.wheel.last ?? '—'}</p>
            </div>
            <div class="short:hidden">
              <p class="eyebrow m-0">History</p>
              <div class="mt-1 flex flex-wrap gap-1">
                {#if history.length === 0}
                  <span class="text-[12px] text-muted">No spins yet.</span>
                {:else}
                  {#each history as value, index (index)}
                    <span class="history-pill" class:red={RED.includes(value)} class:zero={value === 0}>{value}</span>
                  {/each}
                {/if}
              </div>
            </div>
          </div>
        </div>
        {#if table.deadline > 0}
          <div class="grid gap-1">
            <div class="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
              <span>{table.phase === 'results' ? 'Next round' : 'Betting closes'}</span>
              <span class="tabular-nums">{Math.ceil(remaining / 1000)}s</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full border border-edge/60 bg-ink/60">
              <div class="h-full transition-[width] duration-200 ease-linear" class:bg-red={remaining <= 3000} class:bg-gold={remaining > 3000} style:width={`${fraction}%`}></div>
            </div>
          </div>
        {/if}
      </div>

      <div class="panel felt-panel relative flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden short:gap-1.5 short:p-2" class:live={open && !fever} class:fever={fever}>
        {#if rainCount > 0}
          <div class="coin-rain" aria-hidden="true">
            {#key rainKey}
              {#each rainCoins as coin (coin.id)}
                <span class="coin" style={coin.style}></span>
              {/each}
            {/key}
          </div>
        {/if}
        <div class="flex items-center justify-between gap-2">
          <p class="eyebrow m-0">The felt</p>
          <p class="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Chip {money(chipValue)}</p>
        </div>
        <div class="scroll-y min-h-0 flex-1 overflow-x-auto pb-1">
          <div class="felt-board flex h-full min-w-[640px] gap-1">
            <button type="button" class="felt-zero" disabled={!canBet} title="Straight 0 · pays 35:1" onclick={() => place('straight', [0])}>
              0
              {#if stakeAt('n:0') > 0}
                {#key wobbleKey}
                  <span class="chip-badge wobble">{money(stakeAt('n:0'))}</span>
                {/key}
              {/if}
            </button>
            <div class="betting-grid grid min-h-0 flex-1 grid-rows-[repeat(3,minmax(46px,1fr))_auto_auto_auto] gap-1">
              {#each ROWS as row, rowIndex (rowIndex)}
                <div class="number-row grid grid-cols-12 gap-1">
                  {#each row as value (value)}
                    {@const badge = stakeAt(`n:${value}`)}
                    <button
                      type="button"
                      class="felt-cell"
                      style:--pocket={value}
                      class:red={RED.includes(value)}
                      class:black={!RED.includes(value)}
                      class:selected={selected === value}
                      class:winner={settling && table.wheel.last === value}
                      disabled={!canBet}
                      title={`Straight ${value} · pays 35:1`}
                      onclick={() => place('straight', [value])}
                    >
                      {value}
                      {#if badge > 0}
                        {#key wobbleKey}
                          <span class="chip-badge wobble">{money(badge)}</span>
                        {/key}
                      {/if}
                    </button>
                  {/each}
                </div>
              {/each}
              <div class="grid grid-cols-12 gap-1">
                {#each DOZENS as cell (cell.key)}
                  {@const badge = stakeAt(cell.key)}
                  <button type="button" class="outside-cell col-span-4" disabled={!canBet} title={`${cell.label} · pays 2:1`} onclick={() => place(cell.kind, cell.numbers)}>
                    {cell.label}
                    {#if badge > 0}
                      {#key wobbleKey}
                        <span class="chip-badge wobble">{money(badge)}</span>
                      {/key}
                    {/if}
                  </button>
                {/each}
              </div>
              <div class="grid grid-cols-12 gap-1">
                {#each EVEN_MONEY as cell (cell.key)}
                  {@const badge = stakeAt(cell.key)}
                  <button
                    type="button"
                    class="outside-cell col-span-2"
                    class:red={cell.kind === 'red'}
                    class:black={cell.kind === 'black'}
                    disabled={!canBet}
                    title={`${cell.label} · pays 1:1`}
                    onclick={() => place(cell.kind, cell.numbers)}
                  >
                    {cell.label}
                    {#if badge > 0}
                      {#key wobbleKey}
                        <span class="chip-badge wobble">{money(badge)}</span>
                      {/key}
                    {/if}
                  </button>
                {/each}
              </div>
              <div class="grid grid-cols-12 gap-1">
                {#each COLUMNS as cell (cell.key)}
                  {@const badge = stakeAt(cell.key)}
                  <button type="button" class="outside-cell col-span-4" disabled={!canBet} title={`${cell.label} · pays 2:1`} onclick={() => place(cell.kind, cell.numbers)}>
                    {cell.label}
                    {#if badge > 0}
                      {#key wobbleKey}
                        <span class="chip-badge wobble">{money(badge)}</span>
                      {/key}
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
        <div class="grid gap-1.5 rounded-xl border border-edge/70 bg-ink/40 p-2 short:p-1.5">
          {#if selected === null}
            <p class="m-0 text-[12px] text-muted short:hidden">Tap a number for a straight bet or an outside row for dozens, columns, and even money. Tap any number first to unlock splits, streets, corners, and sixlines.</p>
          {:else}
            <p class="eyebrow m-0">More on {selected}</p>
            <div class="flex flex-wrap gap-1.5">
              {#each selectedCombos as combo, index (index)}
                <button type="button" class="combo-btn" disabled={!canBet} title={`${combo.kind} ${combo.numbers.join(', ')}`} onclick={() => place(combo.kind, combo.numbers)}>
                  <strong>{combo.label}</strong>
                  <span>{PAYOUTS[combo.kind]}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="grid min-w-0 gap-3 min-[900px]:grid-cols-2 short:hidden">
      <div class="panel">
        <p class="eyebrow m-0">At the table · {occupants.length}/{ROULETTE_LIMIT}</p>
        <ul class="m-0 grid list-none gap-1.5 p-0">
          {#each occupants as player (player.id)}
            {@const seat = playerStakes[player.id] ?? { amount: 0, count: 0 }}
            {@const waiting = open && table.deadline > 0 && player.bankroll >= ROULETTE_MIN_CHIP && seat.count === 0}
            <li class="flex items-center gap-2 rounded-xl border border-edge/60 bg-surface/40 px-2.5 py-2" class:border-gold={player.id === viewerId}>
              <span class="flex-none"><Avatar id={player.id} size={20} label={names[player.id] ?? 'Player'} /></span>
              <span class="font-display text-[16px] leading-none tracking-wide text-fog">{names[player.id] ?? 'Player'}</span>
              {#if player.id === viewerId}
                <span class="badge">you</span>
              {/if}
              {#if waiting}
                <span class="badge alert">waiting</span>
              {/if}
              {#if player.status !== 'active'}
                <span class="badge">{player.status}</span>
              {/if}
              <span class="ml-auto grid justify-items-end text-[11.5px] leading-tight text-muted">
                <strong class="text-fog">{seat.count === 0 ? 'no chips' : `${money(seat.amount)} staked`}</strong>
                <span>{seat.count} {seat.count === 1 ? 'chip' : 'chips'}</span>
              </span>
            </li>
          {/each}
        </ul>
      </div>
      <div class="panel">
        <p class="eyebrow m-0">Last round · {table.lastResults.length} in play</p>
        {#if table.lastResults.length === 0}
          <p class="m-0 text-[12px] text-muted">No spins yet — stack some chips and give the wheel a push.</p>
        {:else}
          <ul class="m-0 grid list-none gap-1.5 p-0">
            {#each table.lastResults as row (row.id)}
              <li class="flex items-center gap-2 rounded-xl border border-edge/60 bg-surface/40 px-2.5 py-2" class:border-gold={row.id === viewerId}>
                <span class="font-display text-[16px] leading-none tracking-wide text-fog">{names[row.id] ?? 'Player'}</span>
                <span class="text-[11.5px] text-muted">staked {money(row.staked)}</span>
                <span class="ml-auto font-display text-[18px] leading-none" class:text-mint={row.net > 0} class:text-red={row.net < 0}>
                  {row.net > 0 ? `+${money(row.net)}` : row.net < 0 ? `−${money(row.net)}` : '$0'}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <div class="roulette-dock sticky bottom-0 z-20 -mx-3 -mb-3 mt-1 border-t border-edge bg-panel/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-14px_32px_-20px_rgba(0,0,0,0.95)] backdrop-blur short:py-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <div class="roulette-chips flex items-center gap-1.5">
          {#each CHIP_VALUES as value (value)}
            <button type="button" class="chip-btn" class:on={chipValue === value} disabled={value > bankroll} aria-pressed={chipValue === value} onclick={() => (chipValue = value)}>
              {money(value)}
            </button>
          {/each}
        </div>
        <div class="grid min-w-[132px] flex-1 gap-1">
          <div class="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
            <span>Staked <strong class="text-fog">{money(staked)}</strong></span>
            <span class="tabular-nums">{money(ROULETTE_MAX_TOTAL)} cap</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full border border-edge/60 bg-ink/60">
            <div class="h-full rounded-full" class:bg-red={staked >= ROULETTE_MAX_TOTAL} class:bg-gold={staked < ROULETTE_MAX_TOTAL} style:width={`${Math.min(100, (staked / ROULETTE_MAX_TOTAL) * 100)}%`}></div>
          </div>
        </div>
        <button type="button" class="btn" disabled={!canClear} title="Take back every chip this round" onclick={clearBets}>Clear</button>
        <button type="button" class="btn btn-primary" disabled={!canSpin} title={spinHint} onclick={spinWheel}>Spin</button>
      </div>
      {#if dockHint !== ''}
        <p class="m-0 pt-1 text-[11px] text-muted">{dockHint}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .felt-zero {
    position: relative;
    display: grid;
    place-items: center;
    width: 46px;
    min-width: 46px;
    border: 1px solid #1f7f6b;
    border-radius: 10px;
    background: linear-gradient(180deg, #1fae90, #0f6a57);
    color: #06231d;
    font-size: clamp(16px, 2.6vmin, 22px);
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .felt-zero:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 0 18px -6px rgba(150, 211, 174, 0.9);
  }

  .felt-board {
    min-height: min(44vh, 420px);
  }

  .felt-cell {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 46px;
    border: 1px solid var(--color-edge);
    border-radius: 8px;
    color: var(--color-fog);
    font-size: clamp(14px, 2.4vmin, 20px);
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
  }

  .felt-cell.red {
    background: linear-gradient(180deg, #59202f, #3a1420);
    border-color: #7d2a40;
  }

  .felt-cell.black {
    background: linear-gradient(180deg, #1b2338, #10131f);
  }

  .felt-cell:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(216, 183, 108, 0.55);
  }

  .felt-cell.selected {
    outline: 2px solid var(--color-gold);
    outline-offset: 1px;
  }

  .felt-cell.winner {
    box-shadow: 0 0 0 2px var(--color-gold), 0 0 20px -2px rgba(216, 183, 108, 0.8);
    animation: ai-winner 1.1s ease-in-out infinite;
  }

  .outside-cell {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 44px;
    padding: 2px 4px;
    border: 1px solid var(--color-edge);
    border-radius: 10px;
    background: rgba(23, 59, 49, 0.75);
    color: var(--color-fog);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 0.1s ease, border-color 0.1s ease;
  }

  .outside-cell.red {
    background: rgba(179, 35, 66, 0.55);
    border-color: rgba(229, 116, 117, 0.45);
  }

  .outside-cell.black {
    background: #17291f;
  }

  .outside-cell:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(216, 183, 108, 0.55);
  }

  .felt-zero:disabled,
  .felt-cell:disabled,
  .outside-cell:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .felt-panel.live {
    animation: ai-rim-live 2.6s ease-in-out infinite;
  }

  .felt-panel.fever {
    border-color: rgba(229, 116, 117, 0.85);
    animation: ai-rim-fever 0.65s ease-in-out infinite;
  }

  .chip-badge {
    position: absolute;
    right: -5px;
    bottom: -5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 20px;
    padding: 0 5px;
    border: 1px solid rgba(216, 183, 108, 0.85);
    border-radius: 999px;
    background: radial-gradient(circle at 34% 28%, #ffe9a8, #e0a92e 72%);
    color: #241a02;
    font-size: 10.5px;
    font-weight: 800;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }

  .chip-badge.wobble {
    animation: ai-wobble 0.45s cubic-bezier(0.3, 1.4, 0.4, 1) both;
  }

  .history-pill {
    display: inline-grid;
    place-items: center;
    width: 27px;
    height: 27px;
    border: 1px solid var(--color-edge);
    border-radius: 8px;
    background: #17291f;
    font-size: 11.5px;
    font-weight: 800;
  }

  .history-pill.red {
    background: #a3233f;
    border-color: #d14767;
  }

  .history-pill.zero {
    background: #1fae90;
    border-color: #96d3ae;
    color: #06231d;
  }

  .combo-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 8px 11px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(23, 59, 49, 0.8);
    color: var(--color-fog);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.1s ease, transform 0.1s ease;
  }

  .combo-btn strong {
    font-size: 12px;
    letter-spacing: 0.02em;
  }

  .combo-btn span {
    color: var(--color-muted);
    font-size: 10.5px;
    font-weight: 700;
  }

  .combo-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(216, 183, 108, 0.55);
  }

  .combo-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .chip-btn {
    display: grid;
    place-items: center;
    min-width: 47px;
    min-height: 44px;
    padding: 0 6px;
    border: 2px dashed rgba(233, 238, 252, 0.35);
    border-radius: 999px;
    background: radial-gradient(circle at 34% 28%, #2b3a63, #143328 68%);
    color: var(--color-fog);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
  }

  .chip-btn.on {
    border-style: solid;
    border-color: var(--color-gold);
    background: radial-gradient(circle at 34% 28%, #ffe9a8, #e0a92e 72%);
    color: #241a02;
    box-shadow: 0 0 16px -4px rgba(216, 183, 108, 0.85);
  }

  .chip-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .chip-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .wheel-rotor {
    transform-box: view-box;
    transform-origin: center;
    transition: transform 2.6s cubic-bezier(0.12, 0.75, 0.18, 1);
  }

  .wheel-rotor path.win {
    stroke: var(--color-gold);
    stroke-width: 1.4;
    filter: drop-shadow(0 0 5px rgba(216, 183, 108, 0.85));
    animation: ai-win 1.1s ease-in-out infinite;
  }

  .wheel-last {
    fill: var(--color-fog);
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 400;
    transform-box: fill-box;
    transform-origin: center;
    animation: ai-last 0.6s cubic-bezier(0.2, 1.5, 0.4, 1) both;
  }

  .wheel-ball {
    fill: #ffe9a8;
    filter: drop-shadow(0 0 4px rgba(255, 233, 168, 0.95));
  }

  .wheel-rays {
    mix-blend-mode: screen;
    transform-box: view-box;
    transform-origin: center;
    animation: ai-rays 9s linear infinite;
    pointer-events: none;
  }

  .wheel-rays polygon {
    fill: #d8b76c;
    opacity: 0.17;
  }

  .wheel-streak {
    pointer-events: none;
  }

  .streak-ring {
    fill: none;
    stroke: rgba(216, 183, 108, 0.45);
    stroke-width: 3;
    stroke-dasharray: 7 15;
    filter: blur(2px);
    transform-box: view-box;
    transform-origin: center;
    animation: ai-spin 0.7s linear infinite;
  }

  .streak-ring.alt {
    stroke: rgba(229, 116, 117, 0.4);
    stroke-width: 2;
    stroke-dasharray: 5 21;
    animation-duration: 0.95s;
    animation-direction: reverse;
  }

  .spotlight {
    fill: rgba(216, 183, 108, 0.16);
    filter: blur(2px);
    pointer-events: none;
  }

  .pocket-glow {
    fill: rgba(216, 183, 108, 0.5);
    filter: blur(6px);
    animation: ai-pocket 1.2s ease-in-out infinite;
    pointer-events: none;
  }

  .coin-rain {
    position: absolute;
    inset: 0;
    z-index: 6;
    overflow: hidden;
    pointer-events: none;
  }

  .coin {
    position: absolute;
    top: -24px;
    border-radius: 999px;
    box-shadow: 0 0 8px rgba(216, 183, 108, 0.65);
    opacity: 0;
    animation-name: ai-coin;
    animation-timing-function: cubic-bezier(0.3, 0.55, 0.6, 1);
    animation-fill-mode: both;
    will-change: transform;
  }

  .table-shake {
    animation: ai-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  @keyframes ai-last {
    from {
      opacity: 0;
      transform: scale(0.35);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes ai-win {
    0%,
    100% {
      stroke: rgba(216, 183, 108, 0.55);
    }
    50% {
      stroke: rgba(255, 235, 170, 1);
    }
  }

  @keyframes ai-winner {
    0%,
    100% {
      box-shadow: 0 0 0 2px var(--color-gold), 0 0 14px -4px rgba(216, 183, 108, 0.8);
    }
    50% {
      box-shadow: 0 0 0 2px var(--color-gold), 0 0 26px 0 rgba(216, 183, 108, 0.95);
    }
  }

  @keyframes ai-rim-live {
    0%,
    100% {
      box-shadow: 0 0 0 1px rgba(150, 211, 174, 0.25), 0 0 26px -14px rgba(150, 211, 174, 0.75);
    }
    50% {
      box-shadow: 0 0 0 1px rgba(150, 211, 174, 0.6), 0 0 36px -8px rgba(150, 211, 174, 0.95);
    }
  }

  @keyframes ai-rim-fever {
    0%,
    100% {
      box-shadow: 0 0 0 1px rgba(229, 116, 117, 0.55), 0 0 24px -12px rgba(229, 116, 117, 0.85);
    }
    50% {
      box-shadow: 0 0 0 1px rgba(229, 116, 117, 0.95), 0 0 40px -6px rgba(229, 116, 117, 1);
    }
  }

  @keyframes ai-wobble {
    0% {
      transform: scale(0.55) rotate(-12deg);
    }
    55% {
      transform: scale(1.15) rotate(6deg);
    }
    100% {
      transform: none;
    }
  }

  @keyframes ai-rays {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ai-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ai-pocket {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes ai-coin {
    0% {
      transform: translate3d(0, -30px, 0) rotate(0deg);
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    100% {
      transform: translate3d(var(--drift, 0px), 360px, 0) rotate(540deg);
      opacity: 0;
    }
  }

  @keyframes ai-shake {
    0%,
    100% {
      transform: translate3d(0, 0, 0);
    }
    15% {
      transform: translate3d(-3px, 2px, 0) rotate(-0.35deg);
    }
    30% {
      transform: translate3d(3px, -2px, 0) rotate(0.35deg);
    }
    45% {
      transform: translate3d(-2px, 1px, 0);
    }
    60% {
      transform: translate3d(2px, -1px, 0);
    }
    80% {
      transform: translate3d(-1px, 1px, 0);
    }
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .felt-board { min-width: 0; }
    .betting-grid { grid-template-rows: repeat(3, minmax(30px, 1fr)) auto auto auto; }
    .felt-cell { min-height: 30px; }
    .felt-zero { min-width: 30px; }
  }

  @media (max-width: 600px) and (orientation: portrait) {
    [data-table='roulette'] { overflow-y: auto; overflow-x: hidden; }
    .roulette-dock { margin: 0; padding: 8px 4px max(8px, env(safe-area-inset-bottom)); }
    .roulette-layout { flex: none; }
    .felt-board { min-width: 0; height: auto; flex-direction: column; }
    .felt-zero { width: 100%; min-height: 44px; }
    .betting-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); grid-template-rows: none; }
    .number-row { display: contents; }
    .felt-cell { order: var(--pocket); min-height: 44px; }
    .betting-grid > div:not(.number-row) { grid-column: 1 / -1; order: 37; }
    .roulette-chips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; }
    .chip-btn { flex: 1 1 44px; min-height: 44px; }
    .chip-badge { right: -2px; bottom: -3px; font-size: 9px; min-width: 22px; }
  }

</style>
