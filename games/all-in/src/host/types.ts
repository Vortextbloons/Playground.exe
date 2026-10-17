import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import type { PlayerView } from '../core/types';

export type HostStatus = {
  view: PlayerView;
  connected: boolean;
  playing: boolean;
  names: Record<string, string>;
};

export interface CasinoHost {
  subscribe(listener: (status: HostStatus) => void): () => void;
  send(action: string, payload: Json): boolean;
}
