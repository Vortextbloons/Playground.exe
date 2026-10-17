import type { SessionView } from '@playground-exe/game-kit/multiplayer';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { applyCasino, createCasino, viewCasino } from '../core/casino';
import type { PlayerView } from '../core/types';
import { cryptoEntropy } from '../core/rng';
import { engines } from '../games';
import type { CasinoHost, HostStatus } from './types';

export const LOCAL_ID = 'local';

export type PartySession = {
  readonly current: SessionView<PlayerView>;
  subscribe(listener: (session: SessionView<PlayerView>) => void): () => void;
  send(action: string, payload: Json): boolean;
};

export function createHybridHost(session: PartySession): CasinoHost {
  const entropy = cryptoEntropy();
  const known = new Map<string, string>();
  const listeners = new Set<(status: HostStatus) => void>();
  let local = createCasino(engines, [LOCAL_ID], { now: Date.now(), entropy });

  const localStatus = (): HostStatus => ({
    view: viewCasino(engines, local, session.current.party ? null : LOCAL_ID), connected: true, playing: !session.current.party,
    names: { [LOCAL_ID]: 'You' }, waitingForParty: !!session.current.party,
  });

  const partyStatus = (): HostStatus | null => {
    const { match, connected, isPlayer, party } = session.current;
    if (!match) return null;
    for (const player of party?.players ?? []) known.set(player.id, player.nickname);
    const names: Record<string, string> = {};
    for (const [id, nickname] of known) names[id] = nickname;
    return { view: match.state, connected, playing: isPlayer, names, waitingForParty: false };
  };

  let status = partyStatus() ?? localStatus();
  const refresh = () => {
    status = partyStatus() ?? localStatus();
    for (const listener of listeners) listener(status);
  };
  session.subscribe(refresh);

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => { listeners.delete(listener); };
    },
    send(action, payload) {
      if (session.current.party && !session.current.match) return false;
      if (action === 'again') {
        if (session.current.match) return false;
        local = createCasino(engines, [LOCAL_ID], { now: Date.now(), entropy });
        refresh();
        return true;
      }
      if (session.current.match) return session.send(action, payload);
      try {
        local = applyCasino(engines, local, LOCAL_ID, action, payload, { now: Date.now(), entropy }).state;
      } catch {
        return false;
      }
      refresh();
      return true;
    },
  };
}
