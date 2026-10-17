export interface Hud {
  party: HTMLElement;
  onPlace(listener: () => void): void;
  setInteraction(message: string, canPlace: boolean): void;
  setStats(primary: string, secondary?: string): void;
  toast(message: string): void;
  showResult(title: string, detail: string, action: { label: string; onSelect(): void }): void;
  hideResult(): void;
  setQuality(value: 'high' | 'low'): void;
  onQuality(listener: (value: 'high' | 'low') => void): void;
  onRestart(listener: () => void): void;
  setRestartVisible(visible: boolean): void;
  addControl(element: HTMLElement): void;
  destroy(): void;
}

export function createHud(container: HTMLElement): Hud {
  const root = document.createElement('div');
  root.className = 'hud';

  const party = document.createElement('div');
  party.className = 'hud-party';

  const stats = document.createElement('div');
  stats.className = 'hud-stats';
  const primary = document.createElement('strong');
  const secondary = document.createElement('span');
  stats.append(primary, secondary);

  const controls = document.createElement('div');
  controls.className = 'hud-controls';
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.textContent = 'Restart';
  const qualityLabel = document.createElement('label');
  qualityLabel.textContent = 'Quality';
  const quality = document.createElement('select');
  for (const [value, text] of [['high', 'High'], ['low', 'Low']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    quality.append(option);
  }
  qualityLabel.append(quality);
  controls.append(restart, qualityLabel);

  const toastNode = document.createElement('div');
  toastNode.className = 'hud-toast';
  toastNode.setAttribute('role', 'status');

  const result = document.createElement('div');
  result.className = 'hud-result';
  result.hidden = true;
  const resultTitle = document.createElement('h2');
  const resultDetail = document.createElement('p');
  const resultAction = document.createElement('button');
  resultAction.type = 'button';
  result.append(resultTitle, resultDetail, resultAction);

  const interaction = document.createElement('div');
  interaction.className = 'hud-interaction';
  const instruction = document.createElement('p');
  instruction.setAttribute('role', 'status');
  const place = document.createElement('button');
  place.type = 'button';
  place.textContent = 'Place block';
  place.hidden = true;
  interaction.append(instruction, place);
  root.append(party, stats, controls, interaction, toastNode, result);
  container.append(root);

  let toastTimer = 0;
  let action: (() => void) | null = null;
  const qualityListeners = new Set<(value: 'high' | 'low') => void>();
  const restartListeners = new Set<() => void>();

  restart.addEventListener('click', () => { for (const listener of restartListeners) listener(); });
  resultAction.addEventListener('click', () => action?.());
  quality.addEventListener('change', () => { for (const listener of qualityListeners) listener(quality.value as 'high' | 'low'); });

  return {
    party,
    onPlace(listener) { place.addEventListener('click', listener); },
    setInteraction(message, canPlace) {
      if (instruction.textContent !== message) instruction.textContent = message;
      place.hidden = !canPlace;
    },
    setStats(text, detail) {
      primary.textContent = text;
      secondary.textContent = detail ? `· ${detail}` : '';
    },
    toast(message) {
      toastNode.textContent = message;
      toastNode.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastNode.classList.remove('visible'), 2600);
    },
    showResult(title, detail, next) {
      resultTitle.textContent = title;
      resultDetail.textContent = detail;
      resultAction.textContent = next.label;
      action = next.onSelect;
      result.hidden = false;
    },
    hideResult() {
      result.hidden = true;
      action = null;
    },
    setQuality(value) {
      quality.value = value;
    },
    onQuality(listener) {
      qualityListeners.add(listener);
    },
    onRestart(listener) {
      restartListeners.add(listener);
    },
    setRestartVisible(visible) {
      restart.hidden = !visible;
    },
    addControl(element) {
      controls.append(element);
    },
    destroy() {
      clearTimeout(toastTimer);
      root.remove();
      qualityListeners.clear();
      restartListeners.clear();
    },
  };
}
