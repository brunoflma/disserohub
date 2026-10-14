import type { UiPrefs } from '../ui/prefs';

export type PanelDimensions = Pick<UiPrefs, 'sidebarWidth' | 'drawerWidth' | 'feedHeight'>;

/** Adapt the presentation only; user preferences survive a temporary compact layout. */
export function workspaceLayout(width: number, height: number, prefs: PanelDimensions, flags: { sidebar: boolean; drawer: boolean; narrow: boolean }) {
  let sidebar = prefs.sidebarWidth;
  let drawer = prefs.drawerWidth;
  const compact = flags.drawer && flags.sidebar && !flags.narrow && width - sidebar - drawer - 40 < 360;
  if (compact) {
    sidebar = 220;
    drawer = Math.max(300, Math.min(drawer, width - sidebar - 400));
  }
  const foldFeed = flags.drawer && (width < 1200 || height < 720);
  return { sidebar, drawer, feed: Math.min(prefs.feedHeight, Math.max(120, height * 0.35)), compact, foldFeed };
}
