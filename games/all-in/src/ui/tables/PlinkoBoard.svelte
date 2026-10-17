<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView } from '../../core/types';
  import { mulberry32 } from '../../core/rng';
  import {
    PLINKO_MAX, PLINKO_MIN, PLINKO_ROWS, RISK_TABLES, simulateDrop,
    type PlinkoBall, type PlinkoView, type Risk,
  } from '../../games/plinko';
  import { sound } from '../../sound';
  import Avatar from '../Avatar.svelte';

  let { detail, view, names, send }: { detail: Json; view: PlayerView; names: Record<string, string>; send: (action: string, payload: Json) => void } = $props();

  const RISKS: readonly Risk[] = ['low', 'medium', 'high'];
  const RISK_ACCENTS: Record<Risk, string> = {
    low: 'var(--color-sky)', medium: 'var(--color-gold)', high: 'var(--color-red)',
  };
  const CHIPS = [1, 5, 10, 25, 50, 100, 500, 1000];
  const OWNER_COLORS = ['#d8b76c', '#96d3ae', '#a4c5bb', '#caa87b', '#ff7ab5', '#ffa94d', '#a3e635', '#e879f9'];
  const TRAIL = [3, 2, 1];
  const FALL_MS = 1500;
  const STAGGER_MS = 150;
  const BURST_MS = 1800;
  const RING_MS = 650;
  const EDGE_MS = 600;
  const WOBBLE_MS = 420;
  const PARTICLE_CAP = 40;
  const SPARKS_PER_BOUNCE = 2;
  const COINS_PER_WIN = 4;
  const PAD = 0.35;
  const SLOT_HEIGHT = 1.55;

  type Flyer = {
    id: number;
    playerId: string;
    bet: number;
    win: number;
    risk: Risk;
    slot: number;
    rights: number[];
    progress: number;
    sparkStage: number;
    settled: boolean;
    instant: boolean;
    own: boolean;
    startAt: number;
    lastAt: number;
    landedAt: number;
  };

  type Burst = {
    elapsed: number;
    flashOpacity: number;
    labelOpacity: number;
    floatOpacity: number;
    rise: number;
    paint: string;
    flashPaint: string;
    text: string;
  };

  type Particle = {
    id: number;
    kind: 'spark' | 'coin';
    x: number;
    y: number;
    vx: number;
    vy: number;
    at: number;
    ttl: number;
    paint: string;
  };

  let risk = $state<Risk>('medium');
  let bet = $state(10);
  let flyers = $state<Flyer[]>([]);
  let particles = $state<Particle[]>([]);
  let frameNow = $state(0);
  let edgeFlash = $state<{ paint: string; at: number } | null>(null);
  let wobbleUntil = $state(-1);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let particleId = 0;
  let frameId = 0;
  let frameLast = 0;
  const seen = new Set<number>();
  let booted = false;

  const board = $derived.by((): PlinkoView | null => {
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return null;
    return detail as unknown as PlinkoView;
  });

  const rows = $derived(board?.rows ?? PLINKO_ROWS);
  const slots = $derived(rows + 1);
  const slotTop = $derived(rows + 0.95);
  const restY = $derived(slotTop + 0.35);
  const vbW = $derived(slots + PAD * 2);
  const vbH = $derived(slotTop + SLOT_HEIGHT + PAD * 2);
  const viewBox = $derived(`${-PAD} ${-PAD} ${vbW} ${vbH}`);
  const slotIndexes = $derived(Array.from({ length: slots }, (_, index) => index));

  const pegs = $derived.by(() => {
    const list: { x: number; y: number }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let index = 0; index <= row; index += 1) list.push({ x: (slots - row) / 2 + index, y: 1.1 + row });
    }
    return list;
  });

  const mine = $derived(board !== null && Array.isArray(board.mine) ? board.mine : []);
  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const active = $derived(view.vault !== null && view.vault.status === 'active' && view.phase === 'playing' && view.at === 'plinko');
  const canDrop = $derived(active && bet >= PLINKO_MIN && bet <= PLINKO_MAX && bet <= bankroll);
  const hint = $derived.by((): string | null => {
    if (!active) return view.vault === null ? 'Watching this run — take a seat to drop chips.' : null;
    if (bet > bankroll) return `Not enough chips for a ${money(bet)} drop.`;
    return null;
  });

  const restPoints = $derived.by(() => {
    const points = new Map<number, { x: number; y: number }>();
    const counts = new Map<number, number>();
    for (const flyer of flyers) {
      if (!flyer.settled) continue;
      const count = counts.get(flyer.slot) ?? 0;
      counts.set(flyer.slot, count + 1);
      points.set(flyer.id, { x: flyer.slot + 0.175 + (count % 6) * 0.13, y: restY + Math.floor(count / 6) * 0.16 });
    }
    return points;
  });

  const edgeOpacity = $derived(edgeFlash === null ? 0 : Math.max(0, 1 - (frameNow - edgeFlash.at) / EDGE_MS));
  const wobbleActive = $derived(frameNow < wobbleUntil);
  const stageScale = $derived(stageWidth > 0 && stageHeight > 0 ? Math.min(stageWidth / vbW, stageHeight / vbH) : 0);
  const stagePadX = $derived((stageWidth - vbW * stageScale) / 2);
  const stagePadY = $derived((stageHeight - vbH * stageScale) / 2);

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function money(value: number): string {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }

  function formatMultiplier(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function topMultiplier(level: Risk): number {
    return Math.max(...RISK_TABLES[level]);
  }

  function tierOf(multiplier: number): { peak: string; fill: string; edge: string } {
    if (multiplier >= 10) return { peak: 'var(--color-gold)', fill: 'rgba(216, 183, 108, 0.16)', edge: 'rgba(216, 183, 108, 0.5)' };
    if (multiplier >= 2) return { peak: 'var(--color-mint)', fill: 'rgba(150, 211, 174, 0.13)', edge: 'rgba(150, 211, 174, 0.42)' };
    if (multiplier >= 1) return { peak: '#b2bba7', fill: 'rgba(136, 148, 184, 0.12)', edge: 'rgba(136, 148, 184, 0.34)' };
    return { peak: 'var(--color-red)', fill: 'rgba(229, 116, 117, 0.13)', edge: 'rgba(229, 116, 117, 0.46)' };
  }

  function ownerColor(playerId: string): string {
    let hash = 0;
    for (let index = 0; index < playerId.length; index += 1) hash = (Math.imul(hash, 31) + playerId.charCodeAt(index)) >>> 0;
    return OWNER_COLORS[hash % OWNER_COLORS.length]!;
  }

  function labelOf(flyer: Flyer): string {
    if (flyer.own) return 'You';
    const name = names[flyer.playerId] ?? 'Player';
    return name.length > 10 ? `${name.slice(0, 9)}…` : name;
  }

  function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pseudo(value: number): number {
    const raw = Math.sin(value * 12.9898) * 43758.5453;
    return raw - Math.floor(raw);
  }

  function rightsPath(seed: number, rowCount: number): number[] {
    const rng = mulberry32(seed >>> 0);
    const rights: number[] = [];
    let count = 0;
    for (let row = 0; row < rowCount; row += 1) {
      if (rng() >= 0.5) count += 1;
      rights.push(count);
    }
    return rights;
  }

  function pathPoint(rights: readonly number[], slot: number, index: number): { x: number; y: number } {
    if (index <= 0) return { x: slots / 2, y: 0.5 };
    if (index >= rows + 1) return { x: slot + 0.5, y: restY };
    return { x: slots / 2 + (rights[index - 1] ?? 0) - index / 2, y: 0.5 + index };
  }

  function flightPoint(flyer: Flyer, progress: number): { x: number; y: number } {
    const scaled = clamp(progress, 0, 1) * (flyer.rights.length + 1);
    const index = Math.min(Math.floor(scaled), flyer.rights.length);
    const local = scaled - index;
    const from = pathPoint(flyer.rights, flyer.slot, index);
    const to = pathPoint(flyer.rights, flyer.slot, index + 1);
    return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
  }

  function multiplierOf(flyer: Flyer): number {
    return RISK_TABLES[flyer.risk][flyer.slot] ?? 0;
  }

  function stageX(userX: number): number {
    return stagePadX + (userX + PAD) * stageScale;
  }

  function stageY(userY: number): number {
    return stagePadY + (userY + PAD) * stageScale;
  }

  function pulseFor(slot: number): number {
    let pulse = 0;
    for (const flyer of flyers) {
      if (flyer.settled || flyer.instant || flyer.slot !== slot) continue;
      const value = clamp((flyer.progress - 0.55) / 0.45, 0, 1);
      if (value > pulse) pulse = value;
    }
    return pulse;
  }

  function burstOf(flyer: Flyer, now: number): Burst | null {
    if (!flyer.settled || flyer.landedAt < 0) return null;
    const elapsed = now - flyer.landedAt;
    if (elapsed < 0 || elapsed >= BURST_MS) return null;
    const t = elapsed / BURST_MS;
    const net = flyer.win - flyer.bet;
    return {
      elapsed,
      flashOpacity: (1 - t) * 0.45,
      labelOpacity: t < 0.65 ? 1 : (1 - t) / 0.35,
      floatOpacity: 1 - t,
      rise: flyer.instant ? 0 : t * 0.9,
      paint: net > 0 ? 'var(--color-mint)' : net < 0 ? 'var(--color-red)' : '#b2bba7',
      flashPaint: tierOf(multiplierOf(flyer)).peak,
      text: net > 0 ? `+${money(flyer.win)}` : net < 0 ? `-${money(flyer.bet - flyer.win)}` : 'even',
    };
  }

  function landedSound(flyer: Pick<Flyer, 'own' | 'win' | 'bet'>): void {
    if (!flyer.own) return;
    sound.play(flyer.win > flyer.bet ? 'win' : flyer.win < flyer.bet ? 'lose' : 'chip');
  }

  function addParticle(particle: Omit<Particle, 'id'>): void {
    particles.push({ id: particleId, ...particle });
    particleId += 1;
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function spawnSparks(x: number, y: number, paint: string, seed: number, now: number): void {
    for (let index = 0; index < SPARKS_PER_BOUNCE; index += 1) {
      const key = seed * 7 + index * 3;
      const angle = -Math.PI / 2 + (pseudo(key) - 0.5) * 2.4;
      const speed = 0.5 + pseudo(key + 3) * 0.7;
      addParticle({
        kind: 'spark', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        at: now, ttl: 300 + pseudo(key + 11) * 180, paint,
      });
    }
  }

  function spawnCoins(x: number, y: number, now: number): void {
    for (let index = 0; index < COINS_PER_WIN; index += 1) {
      const key = now * 0.37 + index * 17;
      addParticle({
        kind: 'coin', x: x + (pseudo(key) - 0.5) * 0.6, y: y - pseudo(key + 5) * 0.25,
        vx: (pseudo(key + 7) - 0.5) * 0.6, vy: -0.75 - pseudo(key + 9) * 0.4,
        at: now, ttl: 850 + pseudo(key + 13) * 250, paint: 'var(--color-gold)',
      });
    }
  }

  function makeFlyer(ball: PlinkoBall, now: number, startAt: number, instant: boolean, boot: boolean): Flyer {
    return {
      id: ball.id,
      playerId: ball.playerId,
      bet: ball.bet,
      win: ball.win,
      risk: ball.risk,
      slot: simulateDrop(ball.seed, rows),
      rights: rightsPath(ball.seed, rows),
      progress: instant ? 1 : 0,
      sparkStage: 0,
      settled: instant,
      instant,
      own: view.you !== null && ball.playerId === view.you,
      startAt,
      lastAt: startAt,
      landedAt: instant ? (boot ? -BURST_MS : now) : 0,
    };
  }

  function syncBoard(current: PlinkoView): void {
    const balls: PlinkoBall[] = Array.isArray(current.balls) ? current.balls : [];
    const alive = new Set(balls.map(ball => ball.id));
    const kept = flyers.filter(flyer => alive.has(flyer.id));
    if (kept.length !== flyers.length) flyers = kept;
    const fresh = balls.filter(ball => !seen.has(ball.id));
    if (fresh.length === 0) return;
    const boot = !booted;
    booted = true;
    const instant = boot || reducedMotion();
    const now = performance.now();
    for (let index = 0; index < fresh.length; index += 1) {
      const ball = fresh[index]!;
      seen.add(ball.id);
      const flyer = makeFlyer(ball, now, instant ? now : now + index * STAGGER_MS, instant, boot);
      flyers.push(flyer);
      if (instant && !boot) landedSound(flyer);
    }
    if (!boot) ensureFrame();
  }

  function land(flyer: Flyer, now: number): void {
    flyer.settled = true;
    flyer.landedAt = now;
    landedSound(flyer);
    if (flyer.instant) return;
    const multiplier = multiplierOf(flyer);
    edgeFlash = { paint: tierOf(multiplier).edge, at: now };
    if (multiplier >= 10) wobbleUntil = now + WOBBLE_MS;
    if (flyer.win > flyer.bet) spawnCoins(flyer.slot + 0.5, restY - 0.1, now);
  }

  function ensureFrame(): void {
    if (frameId !== 0) return;
    const step = (now: number): void => {
      frameNow = now;
      const delta = frameLast === 0 ? 16 : Math.min(80, now - frameLast);
      frameLast = now;
      let activeFrame = false;
      for (const flyer of flyers) {
        if (flyer.settled) {
          if (now - flyer.landedAt < BURST_MS) activeFrame = true;
          continue;
        }
        if (now < flyer.startAt) {
          activeFrame = true;
          continue;
        }
        const tick = Math.min(80, now - flyer.lastAt);
        flyer.lastAt = now;
        flyer.progress = Math.min(1, flyer.progress + tick / FALL_MS);
        if (!flyer.instant) {
          const stage = Math.min(Math.floor(flyer.progress * (flyer.rights.length + 1)), flyer.rights.length);
          while (flyer.sparkStage < stage) {
            flyer.sparkStage += 1;
            const point = pathPoint(flyer.rights, flyer.slot, flyer.sparkStage);
            spawnSparks(point.x, point.y, ownerColor(flyer.playerId), flyer.id * 100 + flyer.sparkStage, now);
          }
        }
        if (flyer.progress >= 1) land(flyer, now);
        activeFrame = true;
      }
      if (particles.length > 0) {
        activeFrame = true;
        const seconds = delta / 1000;
        for (let index = particles.length - 1; index >= 0; index -= 1) {
          const particle = particles[index]!;
          const age = now - particle.at;
          if (age >= particle.ttl) {
            particles.splice(index, 1);
            continue;
          }
          particle.x += particle.vx * seconds;
          particle.y += particle.vy * seconds;
          if (particle.kind === 'spark') {
            particle.vy += 2.8 * seconds;
          } else {
            particle.x += Math.sin((age / particle.ttl) * Math.PI * 3) * 0.28 * seconds;
            particle.vy = Math.min(0.6, particle.vy + 0.55 * seconds);
          }
        }
      }
      frameId = activeFrame ? requestAnimationFrame(step) : 0;
    };
    frameId = requestAnimationFrame(step);
  }

  $effect(() => {
    const current = board;
    if (current === null) return;
    syncBoard(current);
  });

  $effect(() => () => {
    if (frameId !== 0) cancelAnimationFrame(frameId);
    frameId = 0;
  });

  function adjustBet(direction: number): void {
    const step = bet <= 10 ? 1 : bet <= 50 ? 5 : bet < 1000 ? 10 : 100;
    bet = clamp(bet + direction * step, PLINKO_MIN, PLINKO_MAX);
  }

  function onBetInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const parsed = Number.parseInt(input.value, 10);
    if (Number.isInteger(parsed) && parsed >= PLINKO_MIN && parsed <= PLINKO_MAX) bet = parsed;
  }

  function onBetChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const parsed = Number.parseInt(input.value, 10);
    bet = Number.isInteger(parsed) ? clamp(parsed, PLINKO_MIN, PLINKO_MAX) : PLINKO_MIN;
    input.value = String(bet);
  }

  function pickChip(chip: number): void {
    bet = clamp(chip, PLINKO_MIN, PLINKO_MAX);
  }

  function dropBall(): void {
    if (!canDrop) return;
    sound.play('chip');
    send('drop', { bet, risk });
  }
</script>

{#if board === null}
  <div class="stub-card" data-table="plinko">
    <h3 class="m-0 font-display text-[28px] leading-none tracking-[0.05em] text-mint">Plinko</h3>
    <p class="m-0 text-[13px] text-muted">The board is being polished — try again in a moment.</p>
  </div>
{:else}
  <section class="flex h-full min-h-0 flex-col gap-3 short:flex-row short:gap-2" data-table="plinko">
    <div class="panel flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2.5 short:gap-1.5 short:p-2">
      <div class="flex shrink-0 items-center justify-between gap-2 short:hidden">
        <p class="eyebrow m-0">Drop board</p>
        <span class="badge" class:shared={view.tables.plinko.mode === 'shared'}>{view.tables.plinko.seats}/{view.tables.plinko.limit} seated</span>
      </div>
      <div class="board-stage" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight}>
        <svg class="board" class:wobble={wobbleActive} viewBox={viewBox} role="img" aria-label={`Plinko board with ${rows} rows and ${slots} slots`}>
          <rect class="board-bg" x={-PAD} y={-PAD} width={slots + PAD * 2} height={slotTop + SLOT_HEIGHT + PAD * 2} rx="0.5" />
          {#each pegs as peg, index (index)}
            <circle class="peg" cx={peg.x} cy={peg.y} r="0.07" />
          {/each}
          {#each slotIndexes as slot (slot)}
            {@const multiplier = RISK_TABLES[risk][slot] ?? 0}
            {@const tier = tierOf(multiplier)}
            <g class="slot" style:--pulse={pulseFor(slot)}>
              <rect x={slot + 0.06} y={slotTop} width="0.88" height={SLOT_HEIGHT} rx="0.12" fill={tier.fill} stroke={tier.peak} stroke-width="0.025" />
              <text class="slot-text" x={slot + 0.5} y={slotTop + SLOT_HEIGHT - 0.38} text-anchor="middle" fill={tier.peak}>×{formatMultiplier(multiplier)}</text>
            </g>
          {/each}
          {#each flyers as flyer (flyer.id)}
            {@const head = flightPoint(flyer, flyer.progress)}
            {#if flyer.settled}
              {@const burst = burstOf(flyer, frameNow)}
              {@const rest = restPoints.get(flyer.id) ?? { x: flyer.slot + 0.5, y: restY }}
              {#if burst !== null}
                <rect x={flyer.slot + 0.03} y={slotTop} width="0.94" height={SLOT_HEIGHT} rx="0.1" fill={burst.flashPaint} opacity={burst.flashOpacity} />
                {#if !flyer.instant && burst.elapsed < RING_MS}
                  {@const ring = burst.elapsed / RING_MS}
                  <circle cx={flyer.slot + 0.5} cy={restY} r={0.22 + ring * 1.05} fill="none" stroke={tierOf(multiplierOf(flyer)).peak} stroke-width={0.06 - ring * 0.045} opacity={(1 - ring) * 0.7} />
                {/if}
              {/if}
              <circle class="ball" cx={rest.x} cy={rest.y} r="0.09" fill={ownerColor(flyer.playerId)} opacity="0.85" stroke={flyer.own ? 'var(--color-fog)' : 'rgba(7, 27, 23, 0.9)'} stroke-width="0.025" />
              {#if burst !== null}
                <text class="land-amount" x={flyer.slot + 0.5} y={slotTop - 0.52 - burst.rise} text-anchor="middle" fill={burst.paint} opacity={burst.floatOpacity}>{burst.text}</text>
              {/if}
            {:else}
              {#each TRAIL as lag (lag)}
                {@const ghost = flightPoint(flyer, flyer.progress - lag * 0.045)}
                <circle class="ball" cx={ghost.x} cy={ghost.y} r={0.18 - lag * 0.028} fill={ownerColor(flyer.playerId)} opacity={0.26 - lag * 0.07} />
              {/each}
              <circle class="ball" cx={head.x} cy={head.y} r="0.36" fill={ownerColor(flyer.playerId)} opacity="0.14" />
              <circle class="ball" cx={head.x} cy={head.y} r="0.21" fill={ownerColor(flyer.playerId)} stroke={flyer.own ? 'var(--color-fog)' : 'rgba(7, 27, 23, 0.85)'} stroke-width={flyer.own ? 0.05 : 0.03} />
            {/if}
          {/each}
          {#each particles as particle (particle.id)}
            {@const fade = Math.max(0, 1 - (frameNow - particle.at) / particle.ttl)}
            {#if particle.kind === 'spark'}
              <circle cx={particle.x} cy={particle.y} r={0.028 + 0.05 * fade} fill={particle.paint} opacity={fade * 0.9} />
            {:else}
              <g opacity={fade} transform={`translate(${particle.x} ${particle.y})`}>
                <circle r="0.1" fill={particle.paint} stroke="#8a6414" stroke-width="0.022" />
                <circle r="0.045" fill="#fff0bd" opacity="0.85" />
              </g>
            {/if}
          {/each}
        </svg>
        {#each flyers as flyer (flyer.id)}
          {#if flyer.settled}
            {@const burst = burstOf(flyer, frameNow)}
            {#if burst !== null}
              <div
                class="land-chip"
                style:left={`${stageX(flyer.slot + 0.5)}px`}
                style:top={`${stageY(slotTop - 0.4)}px`}
                style:opacity={burst.labelOpacity}
              >
                <Avatar id={flyer.playerId} size={18} label={labelOf(flyer)} />
                <span class="land-name" style:color={ownerColor(flyer.playerId)}>{labelOf(flyer)}</span>
              </div>
            {/if}
          {/if}
        {/each}
      </div>
    </div>

    <div class="scroll-y flex min-h-0 min-w-0 flex-col gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] short:shrink-0 short:overflow-y-auto short:pb-0 short:w-[min(340px,44vw)]">
      <div class="panel controls">
        <div class="field risk-field">
          <div class="flex items-center justify-between gap-2 short:hidden">
            <p class="eyebrow m-0">Risk</p>
            <span class="badge">top ×{formatMultiplier(topMultiplier(risk))}</span>
          </div>
          <div class="risk-row" role="group" aria-label="Risk level">
            {#each RISKS as level (level)}
              <button
                type="button"
                class="risk"
                style:--risk-accent={RISK_ACCENTS[level]}
                class:active={risk === level}
                aria-pressed={risk === level}
                onclick={() => (risk = level)}
              >
                <span class="risk-name">{level}</span>
                <span class="risk-top">×{formatMultiplier(topMultiplier(level))}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="field bet-field">
          <div class="flex items-center justify-between gap-2 short:hidden">
            <p class="eyebrow m-0">Bet</p>
            <span class="text-[11px] font-semibold tracking-[0.08em] text-muted">bankroll {money(bankroll)}</span>
          </div>
          <div class="bet-row">
            <button type="button" class="btn bet-step" aria-label="Lower bet" disabled={!active || bet <= PLINKO_MIN} onclick={() => adjustBet(-1)}>−</button>
            <input
              class="bet-input"
              type="number"
              inputmode="numeric"
              min={PLINKO_MIN}
              max={PLINKO_MAX}
              step="1"
              value={bet}
              aria-label="Bet amount"
              oninput={onBetInput}
              onchange={onBetChange}
            />
            <button type="button" class="btn bet-step" aria-label="Raise bet" disabled={!active || bet >= PLINKO_MAX} onclick={() => adjustBet(1)}>+</button>
          </div>
          <div class="chip-row">
            {#each CHIPS as chip (chip)}
              <button type="button" class="chip" class:active={bet === chip} disabled={!active || bankroll < chip} onclick={() => pickChip(chip)}>{money(chip)}</button>
            {/each}
            <button type="button" class="chip" disabled={!active || bankroll < PLINKO_MIN} onclick={() => pickChip(Math.min(bankroll, PLINKO_MAX))}>Max</button>
          </div>
        </div>

        <div class="field drop-field">
          <button type="button" class="btn btn-primary drop" disabled={!canDrop} onclick={dropBall}>
            <strong class="drop-word">DROP</strong>
            <span class="drop-meta">{money(bet)} · {risk}</span>
          </button>
          {#if hint !== null}
            <p class="m-0 text-[11px] text-muted">{hint}</p>
          {/if}
        </div>

        <div class="field mine-field short:hidden">
          <p class="eyebrow m-0">Your drops</p>
          {#if mine.length === 0}
            <p class="m-0 text-[11.5px] text-muted">No drops yet — pick a risk and send a chip down the board.</p>
          {:else}
            <div class="mine-tags">
              {#each [...mine].slice(-5).reverse() as ball (ball.id)}
                {@const net = ball.win - ball.bet}
                <span class="mine-tag">
                  <span class="mine-dot" style:--risk-accent={RISK_ACCENTS[ball.risk]}></span>
                  <span>{money(ball.bet)}→{money(ball.win)}</span>
                  <strong class:gain={net > 0} class:pain={net < 0}>{net > 0 ? `+${money(net)}` : net < 0 ? `-${money(-net)}` : '±$0'}</strong>
                </span>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if edgeFlash !== null && edgeOpacity > 0}
      <div class="edge-flash" style:--edge={edgeFlash.paint} style:opacity={edgeOpacity}></div>
    {/if}
  </section>
{/if}

<style>
  .board {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .board-stage {
    position: relative;
    flex: 1 1 0%;
    min-height: 0;
  }

  .board.wobble {
    animation: plinko-wobble 0.42s ease-in-out;
  }

  @keyframes plinko-wobble {
    0%, 100% { transform: translateX(0) rotate(0deg); }
    25% { transform: translateX(-0.3%) rotate(-0.35deg); }
    50% { transform: translateX(0.26%) rotate(0.3deg); }
    75% { transform: translateX(-0.18%) rotate(-0.15deg); }
  }

  .board-bg {
    fill: rgba(7, 27, 23, 0.68);
    stroke: var(--color-edge);
    stroke-width: 0.03;
  }

  .peg {
    fill: #c4ac78;
  }

  .slot {
    transform-box: fill-box;
    transform-origin: center;
    transform: scale(calc(1 + var(--pulse, 0) * 0.1));
    transition: transform 0.09s linear;
  }

  .slot-text {
    font-family: var(--font-display);
    font-size: 0.44px;
    letter-spacing: 0.03em;
  }

  .land-chip {
    position: absolute;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    white-space: nowrap;
  }

  .land-name {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 3px rgba(7, 27, 23, 0.95);
  }

  .land-amount {
    font-family: var(--font-display);
    font-size: 0.52px;
    letter-spacing: 0.05em;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }

  .field {
    display: grid;
    align-content: start;
    gap: 5px;
    min-width: 0;
  }

  .risk-field {
    flex: 1 1 210px;
  }

  .bet-field {
    flex: 1 1 230px;
  }

  .drop-field {
    flex: 1 1 100%;
  }

  .mine-field {
    flex: 1 1 100%;
  }

  @media (min-width: 780px) {
    .drop-field {
      flex: 0 0 190px;
    }

    .mine-field {
      flex: 2 1 240px;
    }
  }

  .risk-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .risk {
    display: grid;
    justify-items: center;
    gap: 3px;
    min-height: 48px;
    padding: 7px 6px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(23, 59, 49, 0.72);
    color: var(--color-muted);
    font: 700 12px/1.1 var(--font-sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
  }

  .risk:hover {
    border-color: color-mix(in srgb, var(--risk-accent, var(--color-edge)) 60%, var(--color-edge));
  }

  .risk.active {
    border-color: var(--risk-accent, var(--color-gold));
    background: color-mix(in srgb, var(--risk-accent, var(--color-gold)) 14%, rgba(23, 59, 49, 0.72));
    color: var(--color-fog);
    box-shadow: 0 0 18px -8px var(--risk-accent, var(--color-gold));
  }

  .risk:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  .risk-top {
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--risk-accent, var(--color-muted));
  }

  .bet-row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 6px;
  }

  .bet-step {
    min-height: 44px;
    padding: 0;
    font-size: 20px;
  }

  .bet-input {
    width: 100%;
    min-height: 44px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(7, 27, 23, 0.72);
    color: var(--color-fog);
    font-family: var(--font-display);
    font-size: 24px;
    text-align: center;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
  }

  .bet-input::-webkit-outer-spin-button,
  .bet-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .bet-input:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: -2px;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    flex: 1 1 auto;
    min-width: 52px;
    min-height: 44px;
    border: 1px solid var(--color-edge);
    border-radius: 999px;
    background: rgba(23, 59, 49, 0.72);
    color: var(--color-fog);
    font: 700 12.5px/1 var(--font-sans);
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
  }

  .chip:hover:not(:disabled) {
    border-color: rgba(150, 211, 174, 0.55);
    transform: translateY(-1px);
  }

  .chip.active {
    border-color: var(--color-mint);
    background: rgba(150, 211, 174, 0.14);
  }

  .chip:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .chip:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  .drop {
    display: grid;
    gap: 3px;
    width: 100%;
    min-height: 58px;
    padding: 8px 14px;
  }

  .drop-word {
    font-family: var(--font-display);
    font-size: 26px;
    letter-spacing: 0.14em;
    line-height: 1;
  }

  .drop-meta {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.75;
  }

  .mine-field .eyebrow {
    flex-shrink: 0;
  }

  .mine-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    max-height: 60px;
    overflow: hidden;
  }

  .mine-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 1px solid var(--color-edge);
    border-radius: 999px;
    background: rgba(23, 59, 49, 0.6);
    color: var(--color-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .mine-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--risk-accent, var(--color-muted));
  }

  .mine-tag .gain {
    color: var(--color-mint);
  }

  .mine-tag .pain {
    color: var(--color-red);
  }

  .edge-flash {
    position: fixed;
    inset: 0;
    z-index: 35;
    pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 52%, var(--edge, transparent) 100%);
    mix-blend-mode: screen;
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .controls {
      gap: 8px;
    }

    .risk-field,
    .bet-field,
    .drop-field {
      flex: 1 1 100%;
    }
  }

  @media (max-width: 600px) and (orientation: portrait) {
    [data-table='plinko'] { overflow-y: auto; }
    [data-table='plinko'] > .panel { flex: none; height: clamp(220px, 35dvh, 320px); }
    [data-table='plinko'] > .scroll-y { flex: none; }
    .controls { gap: 8px; }
    .risk-field, .bet-field { flex: 1 1 100%; }
    .chip-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .chip { min-width: 0; padding: 6px 2px; font-size: 11px; }
    .bet-input { font-size: 18px; }
    .drop { min-height: 52px; }
  }

</style>
