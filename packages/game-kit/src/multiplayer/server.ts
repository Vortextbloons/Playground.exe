import type { Json, MultiplayerMode } from './protocol';

export interface GameContext {
  playerId: string;
  playerIds: readonly string[];
  mode: MultiplayerMode;
  now: number;
  seed: number;
}
export interface GameResult { state: Json; finished?: boolean; phase?: string }
/** Keep private information in state; expose only the recipient's view(). */
export interface MultiplayerDefinition {
  setup(context: GameContext): GameResult;
  action(state: Json, action: string, payload: Json, context: GameContext): GameResult;
  view(state: Json, playerId: string | null): Json;
  /** Reconcile turns/phases after a player joins, leaves, or their seat expires. */
  playersChanged?(state: Json, context: GameContext): GameResult;
}
export function defineMultiplayer<T extends MultiplayerDefinition>(definition: T): T { return definition; }
