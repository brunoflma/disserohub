import { describe, expect, it } from 'vitest';
import { workspaceLayout } from './workspace-layout';

const prefs = { sidebarWidth: 304, drawerWidth: 380, feedHeight: 200 };
describe('adaptive workspace', () => {
  it('recovers useful canvas space in the observed 927px window without changing preferences', () => {
    const result = workspaceLayout(927, 956, prefs, { sidebar: true, drawer: true, narrow: false });
    expect(927 - result.sidebar - result.drawer - 40).toBeGreaterThanOrEqual(360);
    expect(result.foldFeed).toBe(true);
    expect(prefs.sidebarWidth).toBe(304);
  });
  it('honors chosen panel sizes on a wide screen and when no drawer is open', () => {
    expect(workspaceLayout(1600, 900, prefs, { sidebar: true, drawer: true, narrow: false })).toMatchObject({ sidebar: 304, drawer: 380, compact: false, foldFeed: false });
    expect(workspaceLayout(927, 956, prefs, { sidebar: true, drawer: false, narrow: false }).compact).toBe(false);
  });
  it('keeps overlay panels out of the compact-column calculation', () => {
    expect(workspaceLayout(700, 800, prefs, { sidebar: true, drawer: true, narrow: true }).compact).toBe(false);
  });
});
