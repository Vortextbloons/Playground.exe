import { PARTY_CHANNEL, isRecord, NETWORK_PRESETS, type GameMenuCommand, type Json, type MultiplayerUpdate, type PartyPlayer, type PartyMatch, type PartySnapshot } from './protocol';
export * from './protocol';
export { createMultiplayerMenu } from './menu';

export interface SessionView<State extends Json> extends MultiplayerUpdate { match: (Omit<PartyMatch, 'state'> & { state: State }) | null; isPlayer: boolean }
/** No sockets or credentials in game iframes. The playground owns the party connection. */
export function createMultiplayer<State extends Json = Json, Actions extends Record<string, Json> = Record<string, Json>>(gameId: string) {
  let current: SessionView<State> = { party: null, playerId: null, connected: false, match: null, isPlayer: false };
  const listeners = new Set<(session: SessionView<State>) => void>();
  const stateListeners = new Set<(state: State, session: SessionView<State>) => void>();
  const playerListeners = new Set<(players: PartyPlayer[]) => void>();
  const errorListeners = new Set<(message: string) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { action: string; payload: Json }[] = [];
  let sequence = 0; let destroyed = false;
  const post = (message: Record<string, unknown>) => { if (window.parent !== window && !destroyed) window.parent.postMessage({ channel: PARTY_CHANNEL, gameId, ...message }, location.origin); };
  function receive(event: MessageEvent<unknown>) {
    if (event.source !== window.parent || event.origin !== location.origin || !isRecord(event.data) || event.data.channel !== PARTY_CHANNEL) return;
    if (event.data.type === 'error' && typeof event.data.message === 'string') { for (const listener of errorListeners) listener(event.data.message); return; }
    if (event.data.type !== 'update' || !isRecord(event.data.update)) return;
    const update = event.data.update as unknown as MultiplayerUpdate;
    const party: PartySnapshot | null = update.party;
    const activeMatch = party?.match?.gameId === gameId ? party.match : null;
    // A no-spectating mode deliberately withholds its state from nonparticipants.
    const withheld = activeMatch?.state === null && !activeMatch.playerIds.includes(update.playerId ?? '');
    const match = activeMatch && !withheld ? activeMatch as SessionView<State>['match'] : null;
    if (match?.id !== current.match?.id) { pending = []; clearTimeout(timer); sequence = 0; }
    current = { ...update, match, isPlayer: !!match?.playerIds.includes(update.playerId ?? '') };
    for (const listener of listeners) listener(current);
    if (match) for (const listener of stateListeners) listener(match.state, current);
    for (const listener of playerListeners) listener(party?.players ?? []);
  }
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (pending.length && current.match) post({ type: 'actions', matchId: current.match.id, commands: pending.splice(0, 8).map(command => ({ ...command, sequence: sequence++ })) });
    if (pending.length) timer = setTimeout(flush, 100);
  }
  window.addEventListener('message', receive);
  post({ type: 'subscribe' });
  return {
    get current() { return current; },
    subscribe(listener: (session: SessionView<State>) => void) { listeners.add(listener); listener(current); return () => { listeners.delete(listener); }; },
    onState(listener: (state: State, session: SessionView<State>) => void) { stateListeners.add(listener); if (current.match) listener(current.match.state, current); return () => { stateListeners.delete(listener); }; },
    onPlayers(listener: (players: PartyPlayer[]) => void) { playerListeners.add(listener); listener(current.party?.players ?? []); return () => { playerListeners.delete(listener); }; },
    onError(listener: (message: string) => void) { errorListeners.add(listener); return () => { errorListeners.delete(listener); }; },
    command(command: GameMenuCommand) {
      if (destroyed || !current.connected || current.party?.selection?.gameId !== gameId) return false;
      post({ type: 'menu', command });
      return true;
    },
    send<K extends Extract<keyof Actions, string>>(action: K, payload: Actions[K]) {
      if (destroyed || !current.connected || !current.match || current.match.status !== 'playing' || !current.isPlayer) return false;
      const mode = current.party?.selection;
      if (!mode) return false;
      if (pending.length >= 8) return false;
      pending.push({ action, payload });
      const interval = NETWORK_PRESETS[current.match.preset].intervalMs;
      if (!interval) flush();
      else if (!timer) timer = setTimeout(flush, interval);
      return true;
    },
    destroy() { destroyed = true; clearTimeout(timer); pending = []; window.removeEventListener('message', receive); listeners.clear(); stateListeners.clear(); playerListeners.clear(); errorListeners.clear(); },
  };
}
