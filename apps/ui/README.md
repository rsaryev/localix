# `@localixai/ui`

This workspace-private application is Localix's browser workbench and is not an external component
library. Its Vite build supplies the workspace used by the desktop shell and by API or CLI-hosted
browser sessions.

## Consumers

The desktop shell embeds this package's `dist` output as its production frontend and loads the Vite
server during development. The API's `localix` executable serves the same build when it is present.
The separate CLI workspace hands paths to the desktop app and includes no UI build. Repository
development scripts start this app beside the API; no workspace source imports an `@localixai/ui`
module export.

## Entry points

The package manifest defines no JavaScript exports. These are its runtime and extension seams:

| Entry point                                                                              | Contract                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`index.html`](./index.html)                                                             | Provides the browser document, initial theme paint, PWA metadata, root element, and module load.              |
| [`src/app/main.tsx`](./src/app/main.tsx)                                                 | Installs platform and startup adapters, restores the shell frame, and mounts the React application.           |
| [`src/app/routing/router.tsx`](./src/app/routing/router.tsx)                             | Defines the hash-routed workspace, setup page, scoped session routes, legacy route, and grid preview harness. |
| [`src/shared/api/internal.ts`](./src/shared/api/internal.ts)                             | Resolves browser or desktop runtime addresses and provides the readiness-gated typed HTTP transport.          |
| [`src/shared/api/eventSocket.ts`](./src/shared/api/eventSocket.ts)                       | Owns the multiplexed realtime connection, session watches, cursor replay, commands, and subsystem frames.     |
| [`src/shared/contrib/discover.ts`](./src/shared/contrib/discover.ts)                     | Eagerly registers core feature contributions and addressable UI surface declarations.                         |
| [`src/shared/contrib/miniAppUiDiscovery.ts`](./src/shared/contrib/miniAppUiDiscovery.ts) | Imports each enabled plugin's UI artifact by URL and replaces it in place when its revision moves.            |

## Limits

- The build is an application artifact, not an importable UI SDK. Cross-package UI extensions use
  `@localixai/mini-app-sdk/ui` and the contribution registries instead of importing this source
  tree.
- The workbench requires a compatible API runtime. In development, Vite requires
  `VITE_API_BASE_URL`; the repository supervisor also supplies the direct WebSocket address because
  Vite's Bun-hosted proxy handles HTTP but not WebSocket upgrades.
- Packaged desktop requests wait for the shell's API-readiness signal. Browser sessions have no
  native command bridge, so desktop dialogs, badges, menus, updater actions, and filesystem-path
  recovery are absent or use browser-specific fallbacks.
- The router uses URL hashes. Settings, statistics, plugin views, and other workbenches are
  inspector panels inside the workspace rather than independent page routes.
- Core contribution modules must match `src/features/*/contrib.ts` or `.tsx`. Plugin UI is never
  host source: a plugin's `ui/register` is built into an artifact the API serves, and the workbench
  imports it by URL only after the plugin is enabled.
- The enforced layer direction is `app` → `pages` → `widgets` → `features` → `shared`. The
  architecture gate rejects outward imports and direct relative imports into API source; package
  export-map leaves are the cross-application contract.

## Source of truth

- [Package manifest](./package.json)
- [Vite runtime and build configuration](./vite.config.ts)
- [Application composition root](./src/app/main.tsx)
- [Route surface](./src/app/routing/router.tsx)
- [API transport](./src/shared/api/internal.ts)
- [UI contribution discovery](./src/shared/contrib/discover.ts)
