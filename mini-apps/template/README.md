# System Overview

System Overview is a complete Localix mini app. It shows live information about the machine running
the Localix backend, short-term CPU and memory history, and a read-only process inspector.

## Run it

Install dependencies from the repository root with `bun install --frozen-lockfile`, then:

```bash
cd mini-apps/template
bun run dev
```

Open `http://127.0.0.1:5174`. This starts Vite and the Bun backend on loopback port 5175. In
Localix, open **System Overview** from the workspace overflow menu or command palette. It appears in
the normal mini app catalog and follows the same enablement rules as Database, DevOps and Trading.

| Command                    | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `bun run dev`              | Start the backend and hot-reloading preview             |
| `bun run build`            | Type-check and build preview, UI module and Bun backend |
| `bun run preview`          | Serve built UI on 4174 and backend on 4175              |
| `bun run type-check:tests` | Check production and test TypeScript                    |
| `bun run test`             | Run mini app regression tests                           |

## Architecture

| Location                  | Responsibility                                                  |
| ------------------------- | --------------------------------------------------------------- |
| `mini-app.json`           | The mini app: identity, category, surfaces, backend, commands   |
| `icon.svg`                | Its icon in the store, the rail and its Mac app; replace it     |
| `screenshots/`            | What the store page shows; replace them with your app's own     |
| `backend/system.ts`       | Injectable native OS reader and one-second snapshot cache       |
| `backend/processes.ts`    | Cross-platform process collector                                |
| `backend/system-marks.ts` | Marks: notes saved with the CPU and memory of their moment      |
| `backend/store.ts`        | Durable JSON state under `ctx.dataDir`, one change at a time    |
| `backend/routes.ts`       | `GET /system`, `/processes`, `/marks`; `POST`/`DELETE /marks`   |
| `backend/context.ts`      | Resource discovery and agent-context expansion                  |
| `backend/index.ts`        | Backend registration, tools and `createRoutes(dataDir)`         |
| `shared/system.ts`        | Validated snapshot contract and shared formatter                |
| `shared/system-marks.ts`  | The marks contract and the note limit both sides enforce        |
| `ui/register.tsx`         | Launcher, work item, resource anchor and agent guidance         |
| `ui/Workspace.tsx`        | The domain's root component, imported by the frame              |
| `ui/system/`              | Responsive dashboard and visible-context publication            |
| `ui/usePolledSnapshot.ts` | Visibility-gated reads and `send()` for actions                 |
| `ui/useStoreSnapshot.ts`  | Store-change reads; polling only when the feed is unavailable   |
| `backend/store-feed.ts`   | Nudges an open view after an `openJsonStore` write              |
| `shared/store-feed.ts`    | The store feed's frame tag, commands and frame                  |
| `ui/useNow.ts`            | The SDK clock for values derived from a stored timestamp        |
| `@localixai/kit/*`        | The host UI kit — the mini app's only view of the host          |
| `guide.md`                | How the agent reads these sources without inventing a diagnosis |
| `preview/`                | Standalone composition and loopback backend runner              |

System snapshots use Bun's native `node:os` APIs. The process inspector runs `ps` on Unix or
`powershell.exe` on Windows through the SDK's bounded subprocess reader. System CPU utilization
requires two counter samples; repeated system reads within one second reuse the cached snapshot.
Unix process CPU comes from `ps`; Windows process CPU uses counter deltas divided by logical core
count and is unavailable on the first read. Used memory is total minus free and includes OS caches.
Readings describe the backend machine, which may differ from the browser device. Hostnames,
usernames, paths and network addresses are deliberately excluded.

The dashboard refreshes every three seconds while visible, keeps 30 in-memory chart samples, cancels
in-flight requests on cleanup and preserves the last successful sample after a failure. That exact
timestamped sample is published as message context. `localix://resource/template/system` supports
explicit attachment; `system_overview` obtains a read-only snapshot subject to the one-second cache.
`system_processes` lists processes without command lines or private paths. Process names, PIDs,
parent PIDs, CPU and memory are included in agent context, so the agent can use native system tools
when the user explicitly requests process management. The mini app deliberately hardcodes no process
actions. Its guide (`guide.md`) tells the agent how to interpret these sources without inventing a
diagnosis.

The process collector keeps at most 500 rows, sorted by CPU and then memory. The agent tool formats
the first 100; pane and resource context format the first 50 before host context limits. An omitted
process is not evidence that it is absent.

Marks are the mini app's one piece of state a person creates: a note — "before the build" — saved
with the machine's CPU and memory at that moment, so a later sample has something to compare with.
The `system_mark` tool lets the agent add one, and the HTTP routes support adding and deleting them.
Both go through one store under the mini app's data folder, so marks outlive the pane and the app.

Only the latest 50 marks are retained; notes are trimmed and limited to 200 characters. Saving a
mark uses the same cached system reading rather than forcing a new CPU sample. The agent tool
classifies this durable write as `host`; conversation permissions can refuse it while still allowing
read-only system and process tools.

See the [mini app guide](../../docs/extending/mini-apps.md) for the full Localix contract.

## Fork it and publish

Every mini app starts from this one. To make your own:

1. Copy this folder to `mini-apps/<name>`. In `mini-app.json`, set `name`, `displayName`,
   `description`, `category` and `author`, and start `version` at `0.1.0`. Rename the domain files
   and tools that `scaffold.json` lists. `/mini-app create` does the same renames for you.
2. Replace the system domain with yours, keeping the shapes: a store under `ctx.dataDir`, routes
   that answer with the new state, tools for the agent, and a `guide.md` that tells the agent how to
   read what the app shows.
3. Check it: `bun run test`, `bun run type-check:tests` and `bun run build` in its folder.
4. Pack it, from the repository root:
   `bun run pack:mini-apps --only <name> --publisher "<you>" --out dist/catalog`.
5. Publish the folder's files as one release's assets. Then share the catalog URL, which people add
   to Localix.
6. For every update, raise `version` and repeat steps 4 and 5.

[Publish a mini app](../../docs/extending/mini-app-publishing.md) covers the catalog format,
hosting, updates and trust.

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Development and build commands](package.json)
- [Standalone ports and proxy](vite.config.ts)
- [Standalone process ownership](preview/serve.ts)
- [System readings](backend/system.ts)
- [Process collectors](backend/processes.ts)
- [System sampling and history limits](ui/system/useSystem.ts)
- [Shared store synchronization](../../packages/mini-app-sdk/src/ui/store-snapshot.ts)

## Publish it

`mini-app.json` names the app's `icon`, `screenshots` and `tags`. A copy keeps `icon.svg`, so it
always has an icon; draw your own on the same tile, and take screenshots of your app at full
resolution. `mini_app_build` and `/mini-app reload` report problems with them in the **store media**
step, and packing refuses an app without a valid icon. See
[Publish a mini app](../../docs/extending/mini-app-publishing.md).
