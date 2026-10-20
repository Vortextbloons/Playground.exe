/** Logical coordinates remain constant while CSS scales the canvas to fit. */
export function fitCanvas(canvas: HTMLCanvasElement, container: HTMLElement, width = 960, height = 540) {
  let worldWidth = width, worldHeight = height;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = worldWidth * dpr; canvas.height = worldHeight * dpr;
    const scale = Math.min(container.clientWidth / worldWidth, container.clientHeight / worldHeight);
    canvas.style.width = `${worldWidth * scale}px`; canvas.style.height = `${worldHeight * scale}px`;
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  return {
    resize,
    setWorld(nextWidth: number, nextHeight: number) { worldWidth = nextWidth; worldHeight = nextHeight; resize(); },
    destroy: () => observer.disconnect(),
  };
}
