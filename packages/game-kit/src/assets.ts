export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = url; await image.decode(); return image;
}
export async function loadJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Asset failed: ${url} (${response.status})`); return response.json() as Promise<T>;
}
export function createAudio() {
  const tracks = new Set<HTMLAudioElement>(); let muted = false;
  return {
    load(url: string, loop = false) { const audio = new Audio(url); audio.loop = loop; audio.muted = muted; tracks.add(audio); return audio; },
    async play(audio: HTMLAudioElement) { try { await audio.play(); return true; } catch { return false; } },
    mute(value: boolean) { muted = value; tracks.forEach(audio => { audio.muted = value; }); },
    pause() { tracks.forEach(audio => audio.pause()); },
    destroy() { tracks.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); }); tracks.clear(); },
  };
}
