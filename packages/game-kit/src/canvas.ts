/** Logical coordinates remain constant while CSS scales the canvas to fit. */
export function fitCanvas(canvas: HTMLCanvasElement, container: HTMLElement, width = 960, height = 540) {
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = height * dpr;
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
    canvas.style.width = `${width * scale}px`; canvas.style.height = `${height * scale}px`;
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  return { resize, destroy: () => observer.disconnect() };
}
