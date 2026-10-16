export function createInput(element: HTMLElement) {
  const controller = new AbortController(); const options = { signal: controller.signal };
  const keys = new Set<string>();
  const pointer = { x: 0, y: 0, down: false, type: 'mouse' };
  const clear = () => { keys.clear(); pointer.down = false; };
  element.addEventListener('keydown', event => { keys.add(event.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault(); }, options);
  element.addEventListener('keyup', event => { keys.delete(event.code); }, options);
  element.addEventListener('blur', clear, options);
  window.addEventListener('blur', clear, options);
  const update = (event: PointerEvent) => { const rect = element.getBoundingClientRect(); pointer.x = (event.clientX - rect.left) / (rect.width || 1); pointer.y = (event.clientY - rect.top) / (rect.height || 1); pointer.type = event.pointerType; };
  element.addEventListener('pointerdown', event => { element.focus(); element.setPointerCapture(event.pointerId); update(event); pointer.down = true; }, options);
  element.addEventListener('pointermove', update, options);
  element.addEventListener('pointerup', event => { update(event); pointer.down = false; }, options);
  element.addEventListener('pointercancel', clear, options);
  return { keys, pointer, clear, isDown: (code: string) => keys.has(code), destroy: () => { controller.abort(); clear(); } };
}
