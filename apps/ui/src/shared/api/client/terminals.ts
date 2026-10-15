import type { ResourceBrowseResult } from '../contracts'
import { client, unwrap } from '../internal'

/** What `POST /rpc/preview/open` answers — the same facts the `preview.updated` frame carries. */
export interface OpenedPreview {
  url: string
  previewId: string
  title: string
  version: number
  servedFile?: string
  rootDir?: string
  frameBlocked: boolean
}

/** What `POST /rpc/preview/resolve` answers: where the page is served from RIGHT NOW. */
export interface ResolvedPreviewEndpoint {
  url: string
  previewId: string
  /** Probe-injecting proxy in front of an external server, bound by the live API process. */
  injectUrl?: string
}

/** PTY panes, live previews and `@resource:` browsing. */
export const terminalsApi = {
  // Run a command in a PTY pane for a session's workspace (e.g. the preview panel
  // relaunching a stopped dev server). Returns the backend terminalId so the UI can
  // adopt the pane and surface its logs on demand.
  async spawnTerminalCommand(input: {
    sessionId: string
    command: string
    cwd?: string
  }): Promise<{ terminalId: string; cwd?: string }> {
    return unwrap(await client.rpc.terminal.spawn.$post({ json: input }))
  },

  // Where a preview's page is served from NOW. Both in-process preview servers (the static
  // file server, the probe-injecting proxy) live on ephemeral ports that die with the API
  // process, so the pane asks before every mount and after every reconnect instead of
  // trusting a stored port — which is what left a white frame over a live app.
  async resolvePreview(input: {
    url: string
    rootDir?: string
    servedFile?: string
  }): Promise<ResolvedPreviewEndpoint> {
    return unwrap(await client.rpc.preview.resolve.$post({ json: input }))
  },

  // Kill a PTY by id (e.g. stopping a dev server the Preview panel launched).
  async closeTerminal(terminalId: string): Promise<void> {
    await client.rpc.terminal[':id'].$delete({ param: { id: terminalId } })
  },

  // The session's MANAGED JOBS — the single source of truth for long-running
  // spawned processes. Both an agent `bash background` job and a preview "Start
  // server" relaunch spawn a command-bearing PTY via terminalService, so a live
  // PTY that carries a `command` (interactive shells have none) IS a job. Returns
  // them with the cwd they run in, so the UI can show + stop + (later) relaunch.
  // ALL of the session's live PTYs — command-bearing background jobs AND
  // interactive shells — with their server-side liveness signals (alt-screen =
  // a full-screen TUI is running). Callers filter: the jobs strip shows the
  // command-bearing rows, the auto-reveal policy watches every row.
  async listTerminals() {
    return unwrap(await client.rpc.terminal.$get())
  },

  async listSessionTerminals(sessionId: string): Promise<
    Array<{
      terminalId: string
      command?: string
      cwd: string
      previewUrl?: string
      altScreen: boolean
    }>
  > {
    const rows = await unwrap(await client.rpc.terminal.$get())
    return rows.flatMap((r) =>
      r.chatSessionId === sessionId
        ? [
            {
              terminalId: r.id,
              command: r.command,
              cwd: r.cwd,
              previewUrl: r.previewUrl,
              altScreen: r.altScreen ?? false,
            },
          ]
        : [],
    )
  },

  // Backend-authoritative `@resource:` browse. The server owns URI navigation,
  // provider grouping, search, sorting, notices and the shared cap.
  async browseResources(partial: string, sessionId?: string): Promise<ResourceBrowseResult> {
    return unwrap(
      await client.rpc['resource-refs'].$get({
        query: { partial, ...(sessionId ? { sessionId } : {}) },
      }),
    )
  },

  // Open (or reload) a live preview for a URL a background job advertised — used by
  // the jobs strip's "Open preview" so a closed preview can be re-attached. The
  // server publishes `preview.updated`, which the UI routes to reveal the tab.
  async openPreview(sessionId: string, url: string, root?: string): Promise<OpenedPreview> {
    // Unwrapped, not fired-and-forgotten: the server refuses a preview for real reasons (no such
    // file, a path outside the workspace, a dead URL), and a caller that never read the response
    // showed "Previewing…" over nothing.
    return unwrap(
      await client.rpc.preview.open.$post({ json: { sessionId, url, ...(root ? { root } : {}) } }),
    )
  },
}
