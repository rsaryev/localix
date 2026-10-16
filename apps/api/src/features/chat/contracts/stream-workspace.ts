import type { ResourceChangedEvent } from '../../realtime/resources'
/**
 * THE STREAM EVENTS THAT ARE NOT ABOUT THE CONVERSATION.
 *
 * One socket carries every live update, but its union answers two different questions. Most of
 * it is the conversation: a message arrived, a run started, the room's floor moved. These are
 * about the MACHINE the conversation is running on — the language servers, the preview, the
 * terminals, the files on disk, the installed capabilities. A client can render a whole chat
 * without handling one of them, and the surfaces that do handle them (the inspector, the
 * terminal grid, the file tree) have no interest in the other half.
 *
 * Split out for that reason, and also for a plainer one: the union had grown past the size the
 * repository allows a source file to reach (`scripts/source-size-guard.test.ts`), and the honest
 * cut is the one that was already there. `AgentStreamEvent` unions this in, so nothing about the
 * wire changes and the contract guard still reads one opcode set across both files.
 */
import type { PreviewCommand } from '../../agent-core/tools/preview/preview-control'
import type { LspDiagnostic, LspServerState } from '../../lsp'

export type WorkspaceStreamEvent =
  | ResourceChangedEvent
  | { type: 'session.deleted'; sessionIds: string[] }
  // Language-server lifecycle for the session's workspace — which servers are up.
  | { type: 'lsp.status'; sessionId: string; servers: LspServerState[] }
  // Per-file LSP diagnostics (ranges + severity) for a file the inspector editor
  // has open — drives inline squiggles. Live-only (resynced on the next open).
  | {
      type: 'lsp.diagnostics'
      sessionId: string
      file: string
      diagnostics: LspDiagnostic[]
    }
  | {
      // Generic plugin→UI command envelope (`session.emitCommand`): a plugin tool
      // drives its own UI surface.
      // REPLAYABLE and non-coalescing: a command is an ordered state change, not a
      // latest-wins tick. Core stays plugin-agnostic:
      // it relays the envelope; the plugin's UI registers a sink for its
      // (plugin, channel) key and parses `payload` with its own guard.
      type: 'plugin.command'
      sessionId: string
      /** The emitting plugin's name — the client command registry's first routing key. */
      plugin: string
      /** Plugin-chosen sub-channel (e.g. 'chart') — the second routing key. */
      channel: string
      /** Opaque to core; the plugin's two ends share the shape. */
      payload: unknown
      /** Unique per command — the client dedups replayed frames by it. */
      commandId: string
      /** Monotonic per run — an ordering/debugging aid (dedup is by `commandId`). */
      seq: number
    }
  | {
      type: 'preview.updated'
      background?: boolean
      viewport?: { width: number; height: number } | null
      sessionId: string
      /** Stable preview identity = URL origin (scheme://host:port). Re-use to dedup/refresh. */
      previewId: string
      url: string
      title?: string
      /** Monotonic; a higher value forces the iframe to reload, an equal value (replay) is a no-op. */
      version: number
      /** Entry file we auto-serve (e.g. "index.html") — the visual-feedback source anchor. */
      servedFile?: string
      /** Directory the static preview is served from — context for the agent's edits. */
      rootDir?: string
      /** The site refuses iframing (X-Frame-Options / frame-ancestors) — the UI shows its
       *  open-in-browser card and offers the strip-proxy view on demand. The proxy address
       *  itself is never on the wire: it is an ephemeral port the pane resolves from the
       *  live process (`POST /rpc/preview/resolve`) right before it mounts a frame. */
      frameBlocked?: boolean
    }
  | {
      /** Agent-driven preview control: the `browser` tool asks the open
       *  inspector's probe to execute one command. The UI runs it and replies via
       *  the `{t:'preview-result'}` WS RPC, keyed by `commandId`. */
      type: 'preview.command'
      sessionId: string
      commandId: string
      command: PreviewCommand
    }
  | {
      /** The agent CLOSED the preview via `browser` action="close". The UI
       *  closes the matching preview tab (or all preview tabs for the session when
       *  `previewId` is absent). Tool-only — never round-trips to the probe. */
      type: 'preview.closed'
      backgroundOnly?: boolean
      sessionId: string
      previewId?: string
      previewIds?: string[]
    }
  | {
      /**
       * On-disk files under the session's workspace changed (agent write/edit/patch,
       * a build, an external editor) — the live file-tree refresh signal. `paths` are
       * ABSOLUTE directory paths whose contents changed; an EMPTY array is the coarse
       * "reload everything visible" signal (large churn / overflow). Live-only: never
       * replayed (a reconnecting client remounts the tree from scratch).
       */
      type: 'fs.changed'
      sessionId: string
      paths: string[]
      /** Changed entries, when known; directory paths remain the tree's own projection. */
      changedPaths?: string[] | null
      /** False when a previously live watcher failed or was evicted. */
      live?: boolean
    }
  | {
      /**
       * The agent spawned a PTY the user can watch — a `bash action:"open"`
       * interactive terminal or a `bash background:true` job pane. The UI adopts
       * + reveals the terminal tab immediately (push — the docs' "the Terminal
       * tab auto-opens onto it"; the poll-driven alt-screen policy only covers
       * full-screen apps that actually enter the alternate screen, which e.g.
       * `claude` does not) and seeds the live-PTY registry so transcript cards
       * never flash "Terminal closed" while the fresh PTY is alive but not yet
       * seen by the background-jobs poll. Live-only: never replayed (a reload
       * restores terminal tabs from grid persistence; re-revealing a tab the
       * user closed would steal focus).
       */
      type: 'terminal.opened'
      sessionId: string
      terminalId: string
      command?: string
    }
  | {
      /**
       * A live PTY's server-side state changed: a full-screen app took it over or left
       * (alt-screen), or the URL it serves became known, moved, or vanished. Pushed so the
       * composer learns it in the same tick instead of on its registry poll, which runs an OS
       * port scan and so cannot be brisk. A full snapshot of the two signals, last wins per
       * terminal. Exit is NOT this frame: it is `terminal.finished`.
       */
      type: 'terminal.state'
      sessionId: string
      terminalId: string
      /** The one-shot command the pane runs (absent for an interactive shell) — a tab title. */
      command?: string
      altScreen: boolean
      previewUrl?: string
    }
  | {
      /** The agent entered or left an action="wait" call for this PTY. Volatile UI activity. */
      type: 'terminal.waiting'
      sessionId: string
      terminalId: string
      active: boolean
      /** Short display-safe description of the wait condition. */
      label?: string
    }
  | {
      /** Input was sent to a live PTY. Literal input bytes are deliberately never published. */
      type: 'terminal.input'
      sessionId: string
      terminalId: string
      source: 'agent' | 'user'
      /** Short display-safe description such as "Enter" or "user input". */
      label?: string
    }
  | {
      /** The owned PTY process exited. Replayable by terminalId so reconnecting
       * clients can settle waits and surface one completion notification. */
      type: 'terminal.finished'
      sessionId: string
      terminalId: string
      cwd?: string
      exitCode: number
      command?: string
      /**
       * When the process actually exited (epoch ms), set by the producer.
       *
       * This frame is replayable, so a client that was away receives it on reconnect. Without the
       * fact's own time the notification layer stamps `Date.now()`
       * (`agentNotificationEnvelope`'s default), the TTL in `policy.ts` sees a brand-new envelope,
       * and a job that finished hours ago raises a native banner and a terminal bell as if it just
       * happened. Optional so an older producer/replayed frame still parses; consumers fall back to
       * their own clock exactly as before.
       */
      finishedAt?: number
      /** Explicitly closed through the terminal controls, rather than a process failure. */
      stopped?: true
      /**
       * Why a stopped terminal was stopped, in plain words a notice can quote: `timeout 60 s`,
       * `stopped by the agent`. Absent when the stop gave no reason (the person's Close button).
       */
      stopReason?: string
      /**
       * The login shell the person opened from the terminal panel, not a job. The frame still
       * settles the pane; a client must not report it, since the person typed `exit` themselves.
       */
      interactive?: true
      /**
       * An agent job whose exit wakes the agent (`bash notify`). The woken turn is the report, so
       * a client that also reported this exit showed one job as two Event Center rows.
       */
      wakesAgent?: true
    }
