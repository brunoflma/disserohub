import type { CameraView } from '../world/api';

export function cameraRestoreMode(state: CameraView, cols: number, width: number, height: number): CameraView['mode'] {
  if (state.mode !== 'manual') return state.mode;
  return state.cols === cols && Math.abs(state.width - width) < 3 && Math.abs(state.height - height) < 3 ? 'manual' : 'offices';
}
