import { BOARD_SIZE } from './engine/types';

/** Geometry of a board grid element: the grid maps 1:1 onto the 8×8 field. */

export interface GridMetrics {
  left: number;
  top: number;
  /** Distance between adjacent cell origins, in px. */
  pitch: number;
}

export function readGridMetrics(element: HTMLElement): GridMetrics {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, pitch: rect.width / BOARD_SIZE };
}

/** Board index (row * 8 + col) under a viewport point, or null outside. */
export function cellAt(metrics: GridMetrics, x: number, y: number): number | null {
  const col = Math.floor((x - metrics.left) / metrics.pitch);
  const row = Math.floor((y - metrics.top) / metrics.pitch);
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  return row * BOARD_SIZE + col;
}

/** Anchor (top-left of a shape's bounding box) that puts the grid at (x, y). */
export function anchorAt(metrics: GridMetrics, x: number, y: number): { row: number; col: number } {
  return {
    row: Math.round((y - metrics.top) / metrics.pitch),
    col: Math.round((x - metrics.left) / metrics.pitch),
  };
}

/** What the tray hands to the stage when a drag begins. */
export interface PickupDetail {
  pointerId: number;
  pointerType: string;
  /** Pointer position in viewport coordinates. */
  x: number;
  y: number;
  /** Bounding box of the piece inside the slot. */
  rect: DOMRect;
  /** Rendered size of one piece cell, in px. */
  cell: number;
}
