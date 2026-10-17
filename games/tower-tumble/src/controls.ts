import * as THREE from 'three';

export interface PointerRay {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export interface ControlHost {
  pick(ray: PointerRay): number | null;
  canGrab(index: number): boolean;
  beginGrab(index: number): void;
  drag(ray: PointerRay): void;
  release(): void;
  hover(index: number | null, legal: boolean): void;
  orbit: { rotate(dx: number, dy: number): void; zoom(delta: number): void };
}

interface Pointer {
  x: number;
  y: number;
  mode: 'grab' | 'orbit';
}

export function createControls(element: HTMLElement, camera: THREE.Camera, host: ControlHost) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointers = new Map<number, Pointer>();
  let grabbing = false;
  let pinch: { distance: number; x: number; y: number } | null = null;

  function ray(event: PointerEvent): PointerRay {
    const rect = element.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / (rect.height || 1)) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    return {
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
    };
  }

  function endGrab() {
    if (!grabbing) return;
    grabbing = false;
    host.release();
  }

  function down(event: PointerEvent) {
    if (event.button === 1) return;
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, mode: 'orbit' });
    if (pointers.size > 1) {
      endGrab();
      const [first, second] = [...pointers.values()];
      pinch = { distance: Math.hypot(first!.x - second!.x, first!.y - second!.y), x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 };
      host.hover(null, false);
      return;
    }
    pinch = null;
    const index = event.button === 0 ? host.pick(ray(event)) : null;
    if (index !== null && host.canGrab(index)) {
      grabbing = true;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, mode: 'grab' });
      host.beginGrab(index);
    }
  }

  function move(event: PointerEvent) {
    const entry = pointers.get(event.pointerId);
    if (!entry) {
      if (pointers.size === 0) {
        const index = host.pick(ray(event));
        host.hover(index, index !== null && host.canGrab(index));
      }
      return;
    }
    const dx = event.clientX - entry.x;
    const dy = event.clientY - entry.y;
    entry.x = event.clientX;
    entry.y = event.clientY;
    if (pointers.size > 1) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
      const x = (first!.x + second!.x) / 2;
      const y = (first!.y + second!.y) / 2;
      if (pinch) {
        host.orbit.rotate(x - pinch.x, y - pinch.y);
        host.orbit.zoom((pinch.distance - distance) * 1.7);
      }
      pinch = { distance, x, y };
      return;
    }
    if (entry.mode === 'grab') host.drag(ray(event));
    else host.orbit.rotate(dx, dy);
  }

  function up(event: PointerEvent) {
    const entry = pointers.get(event.pointerId);
    if (entry?.mode === 'grab') endGrab();
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    host.orbit.zoom(event.deltaY);
  }

  function leave() {
    if (pointers.size === 0) host.hover(null, false);
  }

  const block = (event: Event) => event.preventDefault();
  element.addEventListener('contextmenu', block);
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', up);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('wheel', wheel, { passive: false });

  return {
    destroy() {
      endGrab();
      element.removeEventListener('contextmenu', block);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('wheel', wheel);
    },
  };
}
