import { advanceTicks, setDirection, WIDTH, STEP_MS, type ArenaState, type Dir } from './sim';

type Position = { x: number; y: number };

export function createMovementPrediction() {
  let from: Position[] = [], target: Position[] = [];
  let startedAt = 0;
  const sample = (now: number) => {
    const amount = Math.max(0, Math.min(1, (now - startedAt) / STEP_MS));
    return target.map((point, index) => {
      const before = from[index] ?? point;
      return { x: before.x + (point.x - before.x) * amount, y: before.y + (point.y - before.y) * amount };
    });
  };
  return {
    sample,
    receive(state: ArenaState, id: string, dir: Dir, now: number, reset = false) {
      const snake = state.snakes.find(item => item.id === id);
      if (!snake || !snake.alive || state.finished) { from = target = []; return; }
      const next = structuredClone(state);
      setDirection(next, id, dir);
      advanceTicks(next, 1);
      const predicted = next.snakes.find(item => item.id === id)!;
      const body = predicted.alive ? predicted.body : snake.body;
      from = reset || !target.length ? snake.body.map(cell => ({ x: cell % WIDTH, y: Math.floor(cell / WIDTH) })) : sample(now);
      target = body.map(cell => ({ x: cell % WIDTH, y: Math.floor(cell / WIDTH) }));
      startedAt = now;
    },
    reset() { from = target = []; },
  };
}
