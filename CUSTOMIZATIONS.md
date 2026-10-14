# Dissero local customizations

The upstream baseline is official Habblaud v0.11.0. Existing provider, source, identity, and Windows runtime changes remain intact. The workspace refinements are grouped under `client/src/local/`, including feed presentation policy. `client/src/ui/feed-policy.ts` is a stable re-export used by existing integration points. `workspace.css` is loaded after upstream styles, so new styling does not have to be scattered through the original stylesheet.

Integration points are `ui/index.ts`, `prefs.ts`, `context.ts`, `sidebar.ts`, `drawer.ts`, `rows.ts`, `widgets.ts`, `settings.ts`, and the additive camera/economy API in `world/api.ts` and `world/index.ts`. Preferences use the existing `habblaud:prefs` key with per-field defaults. Compact panel sizes are temporary; saved user dimensions are retained. Raw activity data is retained; feed filtering and text cleanup affect presentation only.

Inventory without changing anything:

The legal-office presentation adds `local/legal-appearance.ts` for deterministic formal defaults, `local/legal-social.ts` for discussion dialogue and reading preferences, and `art/furniture/legal.ts` for furniture variants using existing footprints. Saved character parts override generated defaults. Project rooms retain six desk spots; the former game lounge becomes the Sala de Convivência, with four seats around a discussion table. Modern SVG controls retain their existing labels and actions. The four appearance choices are Automatic, None, Christmas, and Halloween. Legacy `legal` preferences migrate to None. UI world options enable `legalOffice` independently of the seasonal theme, favoring books and thesis discussions while disabling competitive social activities and shell waiting gags. Real agent status remains intact.

The camera picker measures the selected project name using explicit computed font properties (the font shorthand can be empty with numeric variants). All camera controls stay on one line. The picker uses its measured width within 160–260 px and does not grow to fill the toolbar. Narrow windows can scroll the row horizontally. Integration points also include the art catalog and dispatcher, `layout/core.ts`, `layout/room.ts`, `render/scene.ts`, `render/renderer.ts`, `render/overlay.ts`, `sim/sim.ts`, and `social/social.ts`. The pure upstream appearance generator remains available; the runtime art adapter applies formal defaults consistently to world characters and UI avatars.

`local/readability.css` and `local/readable-typography.ts` enlarge the existing UI hierarchy moderately: Segoe UI, 15 px body text, 18 px section headings, and a 14 px minimum for small labels. The startup adaptation visits local UI stylesheet rules, including media rules; explicit numeric overrides cover shorthands whose serialization is hidden by numeric variants. Dialogs, controls, statistics grids, and settings wrap for larger type. Usage rows have matching line heights and column widths, and provider logos are square. The terminal uses 15 px text. Day statistics reuse the provider-logo account chip, including historical accounts. Help describes the current navigation, feed, account usage, legal-office activities, and command waiting; stage identifiers and timing remain compatible with the upstream model.

Subagents are always listed below their main agent, within the active account/search filters. The caption is informational, with no collapse control. The reception has a window in place of the old sign. The interface uses the official Dissero open-D mark; justice posters use a larger dark silhouette on an ivory field.

The local product is Dissero at `https://dissero.localhost/`. Client and server explicitly select `pt-BR`, and the settings language selector is removed. Dissero SVG, raster favicon/PWA sizes and social preview are included in this public visual distribution. Page metadata, wordmark, notifications, demo activities and user-facing server messages use Dissero. Habblaud remains the upstream engine name and retains compatibility package/plugin identifiers, environment variables, storage keys and the existing data directory. Updates and releases belong exclusively to `brunoflma/disserohub`; the hosted Dissero plugin has its own Cloudflare distribution and is not part of this repository.

`shared/branding.ts` holds a strict allowlist of UI preference keys. Before app startup, `local/branding-origin.ts` transfers those preferences from the old local origin using ephemeral one-use server tickets. Tickets expire after three minutes and are removed after use; values stay out of the URL and server files. Existing destination values win, and source values remain intact. The API requires loopback, an explicit approved Host and matching Origin, rejects unknown keys and oversized input, and is disabled for remote listeners. A failed import cannot initialize replacement defaults; `?dissero-legacy=1` keeps a recovery address available. Real project registration, names, sessions, usage and history remain in the original data location.

The top bar grows with its content. `TopBar` observes its actual height and publishes `--top-h` for the panels and camera; the bar itself uses intrinsic height, avoiding a sizing feedback loop. Account cards keep a 240 px minimum, move to their own row when needed, and support visible horizontal scrolling and keyboard focus. Real and demo accounts share this behavior. Reserved slots reuse the normal project-office layout with six workstations, existing furniture footprints, rugs and an open doorway toward the corridor. They remain visual placeholders and do not register projects, walkable areas or agent spots. Their former outdoor closure walls are removed rather than layered behind the doorway.

The sidebar search includes an Add project button. `ui/projects.ts` provides a modal with recent-folder shortcuts, directory navigation, and a path field. `server/projects/folders.ts` lists directory metadata and atomically persists selected paths in a separate `<dataDir>/projects.json`. Registrations are idempotent, serialized within the process, and capped at 100; listings are capped at 500 directories and omit files and symlinks. The new API requires a loopback connection, a local Host, and the same origin when Origin is supplied. It is unavailable on the remote listener. Registered rooms survive without agents and restart; registration does not launch an agent or create a project directory. Shared folder-response types live in `shared/projects.ts`.

The project dialog also exposes local drive shortcuts independently of the current folder. Windows mounted volume letters come from a read-only `MountedDevices` registry query in `server/projects/roots.ts`, with a one-minute cache, bounded output and a hidden subprocess. Canonical directory checks exclude unavailable historical letters, UNC shares and drive aliases; only root names and paths reach the client. Non-Windows runtimes expose the filesystem root; if discovery fails, manual path entry remains available and the home volume is shown. Existing project persistence and route guards are unchanged.

The common-area layout keeps two reception armchairs plus a usable three-seat sofa, publications, coffee tables and a reading lamp. The bathroom has a usable mirrored vanity, towel/supply cabinets and a low privacy partition, with no bench or chair. `art/furniture/facilities.ts` supplies the three new fixtures with catalog footprints and standard floor anchors. Common and project-room plants occupy corner zones; the reserved-room presentation follows the same placement. Six cafeteria seats remain at one table, and the Sala de Convivência keeps grouped reading/discussion seats. Its label is updated in world overlays, social events, invitations and help, while `core:lounge` and discussion-group IDs remain stable. Reception seats never use the sleeping pose. Idle agents still visit all four common areas, and work resumption, pathfinding, occupancy reservations, and the six desks per project room retain their existing behavior.

```powershell
node scripts/local-customizations.mjs status
```

Export tracked changes, new source modules, and their baseline commit to a new directory outside `integration`:

```powershell
node scripts/local-customizations.mjs export
```

The export contains `tracked.patch`, `new-files/`, and `manifest.json`. It contains source customizations only, not identities, usage, history, TLS certificates, or credentials. A full installation/data backup is still required before an upgrade.

For a future upstream release, fetch the official `upstream` remote and prepare an integration branch in this fork. Reconcile conflicts without replacing the Dissero customizations. Update the recorded upstream baseline, run the validation below and CI, and publish a new Dissero release only after acceptance. Do not reset or overwrite a live customized installation. Its automatic dirty-tree protection must remain enabled.

Validate in the candidate:

```powershell
npm run typecheck
npm test -- client/src shared --maxWorkers=2
npm run build:client
```

Check narrow and wide windows, saved camera restoration, feed filters, subagent expansion, keyboard resizing, questions, live terminal entry points, and timelapse in the real browser before activating a candidate. Preserve the native and WSL copies together and keep the previous working source as a rollback point.
