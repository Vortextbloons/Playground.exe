import type { EngineRegistry } from '../core/types';
import { blackjackEngine } from './blackjack';
import { plinkoEngine } from './plinko';
import { pokerEngine } from './poker';
import { rouletteEngine } from './roulette';
import { slotsEngine } from './slots';

export const engines: EngineRegistry = {
  blackjack: blackjackEngine,
  roulette: rouletteEngine,
  slots: slotsEngine,
  plinko: plinkoEngine,
  poker: pokerEngine,
};
