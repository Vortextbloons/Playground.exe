export type Command = 'pause' | 'resume' | 'restart' | 'mute';
export interface HostCommand { channel: 'playground-exe'; type: Command; muted?: boolean }
export function isCommand(value: unknown): value is HostCommand {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.channel === 'playground-exe' && ['pause', 'resume', 'restart', 'mute'].includes(String(data.type)) && (data.type !== 'mute' || typeof data.muted === 'boolean');
}
export function createBridge(handler: (message: HostCommand) => void) {
  const origin = location.origin;
  const send = (type: 'ready' | 'score' | 'pause' | 'fullscreen', score?: number) => {
    if (window.parent !== window) window.parent.postMessage({ channel: 'playground-exe', type, score }, origin);
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source === window.parent && event.origin === origin && isCommand(event.data)) handler(event.data);
  };
  window.addEventListener('message', receive);
  return { ready: () => send('ready'), score: (score: number) => { if (Number.isFinite(score)) send('score', score); }, requestPause: () => send('pause'), requestFullscreen: () => send('fullscreen'), destroy: () => window.removeEventListener('message', receive) };
}
