<script lang="ts">
  import { onMount } from 'svelte';
  import type { GameMetadata } from '../data/games';
  import type { PartyCommand, PartyPlayer } from '../../packages/game-kit/src/multiplayer/protocol';
  import { normalizePartyCode } from '../../packages/game-kit/src/multiplayer/protocol';
  import { getPartyClient, type PartyClientState } from '../lib/party';

  let { games, base }: { games: GameMetadata[]; base: string } = $props();
  let clientState = $state.raw<PartyClientState | null>(null);
  let nickname = $state('');
  let code = $state('');
  let notice = $state('');
  let client: ReturnType<typeof getPartyClient> | undefined;
  const party = $derived(clientState?.party);
  const me = $derived(party?.players.find(player => player.id === clientState?.playerId));
  const host = $derived(party?.players.find(player => player.id === party.hostId));
  const isHost = $derived(!!party && party.hostId === clientState?.playerId);
  const availableGames = $derived(games.filter(game => game.multiplayer?.modes.length));
  const selectedGame = $derived(games.find(game => game.id === party?.selection?.gameId));
  const mode = $derived(selectedGame?.multiplayer?.modes.find(item => item.id === party?.selection?.modeId));

  onMount(() => {
    client = getPartyClient();
    const proposedGame = new URLSearchParams(location.search).get('game');
    let proposedFor: string | null = null;
    let previousParty: { code: string; hostId: string } | null = null;
    let previousSelection: string | undefined;
    const unsubscribe = client.subscribe(value => {
      clientState = value;
      const current = value.party;
      if (!current) { previousParty = null; previousSelection = undefined; return; }
      if (previousParty?.code === current.code && previousParty.hostId !== current.hostId) {
        const newHost = current.players.find(player => player.id === current.hostId);
        notice = `${newHost?.nickname ?? 'Another player'} is now the host.`;
      }
      previousParty = { code: current.code, hostId: current.hostId };
      const selection = current.selection?.gameId;
      if (previousSelection !== undefined && value.connected && selection && selection !== previousSelection) window.location.assign(`${base}play/${selection}/`);
      previousSelection = selection;
      if (proposedGame && current.hostId === value.playerId && !current.selection && !current.match && proposedFor !== current.code) {
        proposedFor = current.code;
        selectGame(proposedGame);
      }
    });
    client.initialize();
    return unsubscribe;
  });

  function send(command: PartyCommand) { client?.send(command); }
  async function enter(join: boolean) {
    notice = '';
    if (!nickname.trim()) { notice = 'Choose a nickname before creating or joining a party.'; return; }
    if (join) { code = normalizePartyCode(code); await client?.join(code, nickname.trim()); }
    else await client?.create(nickname.trim());
  }
  function pasteCode(event: ClipboardEvent) {
    const pasted = event.clipboardData?.getData('text');
    if (pasted === undefined) return;
    event.preventDefault();
    code = normalizePartyCode(pasted);
  }
  function selectGame(gameId: string) {
    if (party?.selection?.gameId === gameId) { window.location.assign(`${base}play/${gameId}/`); return; }
    const firstMode = games.find(game => game.id === gameId)?.multiplayer?.modes[0];
    if (firstMode) send({ type: 'select', gameId, modeId: firstMode.id });
  }
  function playerStatus(player: PartyPlayer) {
    if (!player.connected) return 'Reconnecting';
    if (player.role === 'spectator') return mode?.spectators === false ? 'Sitting out' : 'Watching';
    return party?.match ? 'In game' : player.ready ? 'Ready' : 'Not ready';
  }
  async function copyCode() {
    if (!party) return;
    try { await navigator.clipboard.writeText(party.code); notice = 'Party code copied. Send it to your friends.'; }
    catch { notice = 'Select the four-digit party code to copy it.'; }
  }
</script>

<section class="party-page" aria-label="Party lobby">
  <ol class="steps" aria-label="Party progress">
    <li class={{ current: !party }}><span aria-hidden="true">1</span> Get together</li>
    <li class={{ current: !!party }}><span aria-hidden="true">2</span> Pick a game</li>
    <li><span aria-hidden="true">3</span> Choose a mode in game</li>
  </ol>

  {#if clientState?.error}
    <div class="feedback error" role="alert"><p>{clientState.error}</p>{#if clientState.configured && !clientState.connected && !clientState.busy}<button onclick={() => client?.retry()}>Reconnect</button>{/if}{#if !party}<button onclick={() => client?.leave()}>Start fresh</button>{/if}</div>
  {/if}
  {#if notice}<p class="feedback" role="status">{notice}</p>{/if}

  {#if !party}
    {#if clientState?.busy}
      <div class="restoring" role="status"><span class="connection-light" aria-hidden="true"></span><h2>Getting your party together…</h2><p>You’ll be back with your people in a moment.</p><button onclick={() => client?.leave()}>Cancel connection</button></div>
    {:else}
      <div class="identity-row"><label for="party-nickname">First, what should we call you?</label><input id="party-nickname" bind:value={nickname} maxlength="24" autocomplete="nickname" placeholder="Your nickname" required form="create-party"/><p>No account needed. Just bring a nickname.</p></div>
      {#if clientState && !clientState.configured}<p class="feedback">Parties are not available on this playground yet. <a href={base}>Browse solo games ↗</a></p>{/if}
      <div class="entry-grid">
        <form id="create-party" class="entry-card create-card" onsubmit={event => { event.preventDefault(); void enter(false); }}>
          <span class="eyebrow">MAKE ROOM FOR YOUR FRIENDS</span><h2>Start your party.</h2><p>Get a private code, invite your people, and pick something to play together.</p>
          <div class="ticket-preview" aria-hidden="true"><span>YOUR INVITATION</span><strong>••••</strong><span>ONE PARTY. MANY GAMES.</span></div>
          <button class="primary wide" disabled={!clientState?.configured}>Create a party <span aria-hidden="true">↗</span></button><p class="footnote">You’ll host. Your group stays together between games.</p>
        </form>
        <form class="entry-card join-card" novalidate onsubmit={event => { event.preventDefault(); void enter(true); }}>
          <span class="eyebrow">ALREADY HAVE AN INVITE?</span><h2>Find your people.</h2><p>Ask your host for the four-digit code. Enter it below and you’re in.</p>
          <label for="join-code" class="code-label">Party code</label><input id="join-code" class="join-code" bind:value={code} onpaste={pasteCode} required inputmode="numeric" maxlength="32" autocomplete="off" placeholder="0000" aria-describedby="code-help"/><p id="code-help" class="footnote">Four digits, including any zeros.</p>
          <button class="secondary wide" disabled={!clientState?.configured}>Join a party <span aria-hidden="true">→</span></button><p class="footnote">Join the game, watch a round, or just hang out.</p>
        </form>
      </div>
    {/if}
  {:else}
    <div class="lobby-grid">
      <aside class="party-sidebar" aria-label="Your group">
        <div class="invite-ticket"><div class="ticket-top"><span class="eyebrow">YOUR PARTY CODE</span><span class={['connection-light', { offline: !clientState?.connected }]} aria-label={clientState?.connected ? 'Connected' : 'Reconnecting'}></span></div><strong class="party-code">{party.code}</strong><button class="copy-button" onclick={copyCode}>Copy invite code <span aria-hidden="true">⧉</span></button><p>Friends join from the Party page.</p></div>
        <div class="group-heading"><h2>Your people</h2><span>{party.players.length}/16</span></div>
        <ul class="roster">{#each party.players as player (player.id)}<li><span class={['avatar', { disconnected: !player.connected }]} aria-hidden="true">{player.nickname.slice(0, 1).toUpperCase()}</span><div><strong>{player.nickname}{player.id === me?.id ? ' (you)' : ''}</strong><span>{playerStatus(player)}</span></div>{#if player.id === party.hostId}<span class="host-tag">Host</span>{/if}</li>{/each}</ul>
        <p class="host-note">{isHost ? 'You choose the game and start each round.' : `${host?.nickname ?? 'The host'} chooses the game and starts each round.`} If the host leaves, the party picks a new host.</p>
        <button class="leave-button" onclick={() => { notice = ''; client?.leave(); }}>Leave party</button>
      </aside>
      <div class="lobby-main">
          <section class="game-choice" aria-labelledby="game-choice-title"><div class="section-heading"><div><span class="eyebrow">PICK YOUR NEXT ROUND</span><h2 id="game-choice-title">{isHost ? 'What are we playing?' : selectedGame ? 'Here’s what’s next.' : 'Your host is picking a game.'}</h2></div>{#if isHost}<span class="host-tag">Host controls</span>{/if}</div>
            {#if isHost}<div class="game-grid">{#each availableGames as game (game.id)}<button class={['game-option', { selected: selectedGame?.id === game.id }]} disabled={!clientState?.connected} aria-pressed={selectedGame?.id === game.id} onclick={() => selectGame(game.id)}><span class="game-icon" aria-hidden="true">{game.title.slice(0, 1)}</span><span><strong>{game.title}</strong><small>{Math.min(...game.multiplayer!.modes.map(item => item.minPlayers))}–{Math.max(...game.multiplayer!.modes.map(item => item.maxPlayers))} players</small></span><span class="choice-mark" aria-hidden="true">{selectedGame?.id === game.id ? '✓' : '+'}</span></button>{/each}</div>{:else if selectedGame}<div class="chosen-game"><span class="game-icon" aria-hidden="true">{selectedGame.title.slice(0, 1)}</span><div><h3><a href={`${base}play/${selectedGame.id}/`}>{selectedGame.title}</a></h3><p>{selectedGame.description}</p></div></div>{:else}<p class="hint">You’re in. Share the code while the host gets a round ready.</p>{/if}
            {#if availableGames.length === 0}<p class="hint">No multiplayer games are available yet. Keep the party together and check back when one is added.</p>{/if}
            <p class="hint">Choose a game to load it for everyone. Pick your mode and ready up inside the game.</p>
          </section>
      </div>
    </div>
  {/if}
</section>

<style>
  .party-page{padding-bottom:64px}.steps{display:flex;gap:30px;list-style:none;padding:0 0 25px;margin:0 0 30px;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px}.steps li{display:flex;align-items:center;gap:9px}.steps li>span{display:grid;place-items:center;width:23px;height:23px;border:1px solid var(--line);border-radius:50%;font:11px monospace}.steps .current{color:var(--accent)}.steps .current>span{border-color:var(--accent);background:#2c253b}.eyebrow{font:9px monospace;letter-spacing:1.6px;color:var(--muted)}h2{font-size:27px;letter-spacing:-.8px;line-height:1.2}h3{font-size:17px;font-weight:500}button{font-size:12px;padding:12px 16px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:18px}button:hover:not(:disabled){border-color:var(--accent)}.primary{background:var(--accent);border:1px solid var(--accent);color:#21182f;font-weight:650}.secondary{background:#282230;color:#ddcef8;border-color:#554566}.wide{width:100%;justify-content:space-between}.hint,.footnote{font-size:11px;color:var(--muted);line-height:1.7}.footnote{font-size:10px}.feedback{padding:15px 18px;border:1px solid #3c4f49;background:#19221f;color:var(--mint);border-radius:7px;font-size:12px;margin-bottom:20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.feedback a{text-decoration:underline}.error{color:#efb3bd;background:#281c23;border-color:#67414e}.feedback p{flex:1}.identity-row{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;align-items:center;max-width:660px;margin-bottom:30px}.identity-row label{font:500 17px 'Space Grotesk',sans-serif}.identity-row p{grid-column:1/-1;font-size:11px;color:var(--muted)}input{font-size:16px;color:#efedf5;padding:13px 15px;min-width:0;width:100%}.entry-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.entry-card{border:1px solid var(--line);border-radius:12px;padding:30px;display:flex;flex-direction:column;background:var(--surface)}.entry-card h2{margin:13px 0 12px;font-size:32px}.entry-card>p:not(.footnote){font-size:13px;color:var(--muted);max-width:340px}.entry-card>.wide{margin-top:auto}.entry-card>.footnote:last-child{margin-top:12px}.create-card{border-color:#45394f}.ticket-preview{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--accent);border:1px dashed #51435e;margin:27px 0;border-radius:7px;padding:17px}.ticket-preview>span{font:8px monospace;letter-spacing:2px}.ticket-preview strong{font:54px monospace;letter-spacing:12px;padding-left:12px}.code-label{font-size:11px;color:var(--muted);margin-top:26px;margin-bottom:8px}.join-code{font:50px monospace;letter-spacing:15px;padding:12px 15px 12px 30px;text-align:center;background:#121217;border-color:#4d425a}.join-card>#code-help{margin:9px 0 27px}.lobby-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:28px;align-items:start}.party-sidebar{border:1px solid var(--line);border-radius:10px;background:var(--surface);overflow:hidden}.invite-ticket{padding:23px;border-bottom:1px dashed #51445e;background:#211c2b}.ticket-top{display:flex;align-items:center;justify-content:space-between}.party-code{display:block;font:66px monospace;letter-spacing:8px;margin:16px 0;color:var(--mint);user-select:all;line-height:1.1}.connection-light{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--mint)}.offline{background:#d7b083}.copy-button{width:100%;justify-content:space-between;background:transparent;border-color:#51445e;color:var(--accent);padding:10px 12px}.invite-ticket>p{font-size:10px;color:var(--muted);margin-top:12px}.group-heading{display:flex;justify-content:space-between;align-items:center;padding:23px 20px 14px}.group-heading h2{font-size:18px}.group-heading>span{font:11px monospace;color:var(--muted)}.roster{list-style:none;padding:0 20px;margin:0;display:flex;flex-direction:column;gap:17px}.roster li{display:flex;gap:10px;align-items:center;min-width:0}.avatar{width:32px;height:32px;display:grid;place-items:center;background:#30283e;border-radius:8px;color:var(--accent);font:16px 'Space Grotesk',sans-serif;flex-shrink:0}.disconnected{opacity:.4}.roster li>div{min-width:0}.roster strong{display:block;font-size:12px;font-weight:500;overflow-wrap:anywhere}.roster li>div>span{display:block;font-size:10px;color:var(--muted);margin-top:3px}.host-tag{font:9px monospace;color:var(--accent);background:#30273d;padding:5px 7px;border-radius:4px;white-space:nowrap}.roster .host-tag{margin-left:auto}.host-note{padding:22px 20px 0;font-size:10px;color:var(--muted)}.leave-button{margin:17px 20px 20px;background:transparent;color:var(--muted);padding:9px 12px}.lobby-main{display:flex;flex-direction:column;gap:22px;min-width:0}.game-choice{border:1px solid var(--line);border-radius:10px;padding:25px;background:var(--surface)}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:22px}.section-heading h2{margin-top:8px;font-size:24px}.game-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.game-option{text-align:left;padding:14px;gap:12px;justify-content:start;min-width:0;background:#15141b}.game-icon{width:39px;height:43px;flex-shrink:0;border-radius:5px;background:#30283e;color:var(--accent);display:grid;place-items:center;font:23px 'Space Grotesk',sans-serif}.game-option>span:nth-child(2){min-width:0}.game-option strong{display:block;font-size:13px;font-weight:500;overflow-wrap:anywhere}.game-option small{display:block;font-size:10px;color:var(--muted);margin-top:5px}.choice-mark{margin-left:auto;color:var(--accent)}.game-option.selected{border-color:var(--accent);background:#272132}.chosen-game{display:flex;gap:16px;align-items:center}.chosen-game p{font-size:12px;color:var(--muted);margin-top:6px}.restoring{text-align:center;padding:65px 20px;border:1px dashed var(--line);border-radius:10px}.restoring h2{margin:16px 0 10px}.restoring p{font-size:13px;color:var(--muted)}.restoring button{margin-top:24px}
  @media(max-width:1000px){.lobby-grid{grid-template-columns:240px minmax(0,1fr);gap:20px}.game-grid{grid-template-columns:1fr}.party-code{font-size:54px;letter-spacing:6px}.game-choice{padding:20px}}
  @media(max-width:760px){.entry-card{padding:23px}.entry-grid{gap:16px}.entry-card h2{font-size:27px}.steps{gap:18px;font-size:10px}.steps li{gap:6px}.lobby-grid{grid-template-columns:1fr}.party-sidebar{display:grid;grid-template-columns:220px minmax(0,1fr)}.invite-ticket{grid-row:1/5;border-bottom:0;border-right:1px dashed #51445e}.roster{padding-bottom:10px}.host-note{padding-top:12px}.group-heading{padding-top:20px}.game-grid{grid-template-columns:1fr 1fr}.identity-row{max-width:none}}
  @media(max-width:500px){.party-page{padding-bottom:40px}.steps{gap:12px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:20px}.steps li{flex-basis:calc(50% - 12px)}.entry-grid{grid-template-columns:1fr}.identity-row{grid-template-columns:1fr;gap:10px}.identity-row p{grid-column:auto}.entry-card{padding:24px}.party-sidebar{display:block}.invite-ticket{border-right:0;border-bottom:1px dashed #51445e}.party-code{font-size:70px}.game-grid{grid-template-columns:1fr}.section-heading{align-items:start;gap:10px}.section-heading h2{font-size:22px}.game-choice{padding:19px}.join-code{font-size:46px}}
</style>
