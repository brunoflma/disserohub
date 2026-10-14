import { describe, expect, it } from 'vitest';
import { cameraRestoreMode } from './camera-memory';
const view = { x: 800, y: 250, zoom: 2, cols: 4, width: 927, height: 956, mode: 'manual' as const };
describe('camera memory', () => {
  it('restores a manual position only for the same building and viewport', () => {
    expect(cameraRestoreMode(view, 4, 927, 956)).toBe('manual');
    expect(cameraRestoreMode(view, 3, 927, 956)).toBe('offices');
    expect(cameraRestoreMode(view, 4, 1600, 900)).toBe('offices');
  });
  it('refits remembered overview and office presets at any viewport size', () => {
    expect(cameraRestoreMode({ ...view, mode: 'overview' }, 10, 1600, 900)).toBe('overview');
    expect(cameraRestoreMode({ ...view, mode: 'offices' }, 10, 700, 800)).toBe('offices');
  });
});
