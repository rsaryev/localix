import type { RealtimeCommand } from './ws-commands'
import type { LspDocumentService } from '../lsp'

/**
 * The LSP surface this socket needs — DERIVED from its owner, never restated.
 *
 * This used to be twenty hand-written method signatures: a second, unchecked copy
 * of `LspDocumentService` (`features/lsp/service.ts`). A copied signature is a
 * copied piece of knowledge, and TypeScript will not keep the two in step — a
 * function is assignable to a signature with MORE parameters than it declares, so
 * a copy that lost a parameter type-checks perfectly and simply drops the
 * argument at runtime. That is precisely what happened to `codeAction`, whose
 * `kinds` scope was dropped at the composition root: "Organize imports" over the
 * socket silently returned quick-fixes.
 *
 * `Pick` keeps the port genuinely narrow (the socket gets the document methods and
 * NOT `dispose` — it does not own the service's lifecycle) while making the owner
 * the single authority on every signature in it. Add a parameter to a method over
 * in `service.ts` and the call sites here go red; there is no copy left to drift.
 * The import is type-only, so the socket still links against nothing in the LSP
 * feature at runtime.
 */
export type RealtimeLspService = Pick<
  LspDocumentService,
  | 'open'
  | 'change'
  | 'close'
  | 'save'
  | 'hover'
  | 'completion'
  | 'definition'
  | 'implementation'
  | 'typeDefinition'
  | 'references'
  | 'documentHighlight'
  | 'signatureHelp'
  | 'inlayHint'
  | 'documentColor'
  | 'documentSymbols'
  | 'workspaceSymbols'
  | 'prepareRename'
  | 'rename'
  | 'formatDocument'
  | 'codeAction'
  | 'applyCodeAction'
>

/**
 * The LSP channel of one `/rpc/ws` connection.
 *
 * It exists as its own module for one reason: **a socket owns the documents it
 * opened.** The editor opens a buffer in the language server over this socket and
 * is supposed to close it again — but a dropped connection never sends the clean
 * `lsp.close`. Without {@link LspChannel.teardown}, the service and the language
 * server keep the stale buffer forever and go on re-publishing diagnostics for a
 * session nobody is watching. That is per-connection resource ownership, not a
 * phase of the socket's life, so it belongs with the code that acquires the
 * resource rather than scattered across `onMessage` and `onClose`.
 *
 * It also owns the NEUTRAL FALLBACK per request: with no LSP wired (or a nullish
 * result) a position request answers `null` and a list request answers `[]`, so
 * the editor gets a well-formed empty answer instead of an error. One helper, so
 * the ~20 handlers cannot drift apart on what "nothing" looks like.
 *
 * `handle` returns true when it consumed the command, false when it is not an LSP
 * command at all — the caller keeps dispatching.
 */

/** The socket's reply function (`{ ok, result }` / `{ ok: false, error }`). */
export type LspReplyFn = (body: Record<string, unknown>) => void
/** The socket's error-reply function (maps an ApiError to its code + status). */
export type LspFailFn = (error: unknown) => void

export interface LspChannelDeps {
  /** Absent → every LSP command still answers, with its neutral fallback. */
  lsp?: RealtimeLspService
  userId: string
  logger: { warn: (entry: Record<string, unknown>) => void }
}

/** The LSP slice of the socket's command union — every `lsp.*` kind, and only those. */
type LspCommand = Extract<RealtimeCommand, { kind: `lsp.${string}` }>

const isLspCommand = (command: RealtimeCommand): command is LspCommand =>
  command.kind.startsWith('lsp.')

export interface LspChannel {
  /** Dispatch one command. Returns false when it is not an LSP command. */
  handle(command: RealtimeCommand, reply: LspReplyFn, fail: LspFailFn): boolean
  /** Release every document this connection left open. Call on socket close. */
  teardown(): void
}

let connectionSeq = 0

export function createLspChannel(deps: LspChannelDeps): LspChannel {
  const { lsp, userId, logger } = deps
  /** Docs this connection opened, so a drop without a clean `lsp.close` still releases them. */
  const opened = new Map<string, { sessionId: string; file: string }>()
  /**
   * This connection's identity, handed to the service so it can tell holders apart.
   * There is ONE socket per browser tab, and the service keys documents by
   * (session, file) — so without this, a second tab's `open` replaced the first's
   * claim and EITHER tab's close (or `teardown` on either socket dropping) closed the
   * document on the language server while the other still had the buffer live.
   */
  const consumerId = `ws:${++connectionSeq}`

  /** Run an op, coalescing a nullish result — and a missing LSP — to `fallback`. */
  const answer = (
    reply: LspReplyFn,
    fail: LspFailFn,
    fallback: unknown,
    run: (lsp: RealtimeLspService) => Promise<unknown>,
  ): true => {
    if (!lsp) {
      reply({ ok: true, result: fallback })
      return true
    }
    run(lsp)
      .then((result) => reply({ ok: true, result: result ?? fallback }))
      .catch(fail)
    return true
  }

  return {
    teardown() {
      if (!lsp || opened.size === 0) return
      for (const { sessionId, file } of opened.values()) {
        lsp.close(userId, sessionId, file, consumerId).catch(() => {})
      }
      opened.clear()
    },

    handle(command, reply, fail) {
      if (!isLspCommand(command)) return false
      switch (command.kind) {
        // Document sync is FIRE-AND-ACKNOWLEDGE: diagnostics come back out-of-band
        // on the firehose as `lsp.diagnostics`, so the editor never waits on this.
        case 'lsp.open':
        case 'lsp.change':
        case 'lsp.save':
        case 'lsp.close': {
          if (lsp) {
            const docKey = `${command.sessionId}\n${command.file}`
            if (command.kind === 'lsp.open')
              opened.set(docKey, { sessionId: command.sessionId, file: command.file })
            else if (command.kind === 'lsp.close') opened.delete(docKey)
            const run =
              command.kind === 'lsp.close'
                ? lsp.close(userId, command.sessionId, command.file, consumerId)
                : command.kind === 'lsp.save'
                  ? lsp.save(userId, command.sessionId, command.file)
                  : command.kind === 'lsp.open'
                    ? // `open` carries the holder; `change` doesn't need one — it only
                      // re-syncs a buffer this connection already claimed.
                      lsp.open(userId, command.sessionId, command.file, command.content, consumerId)
                    : lsp.change(userId, command.sessionId, command.file, command.content)
            Promise.resolve(run).catch((error) =>
              logger.warn({
                event: 'ws.lsp_failed',
                userId,
                t: command.kind,
                detail: String(error),
              }),
            )
          }
          reply({ ok: true, result: { ok: true } })
          return true
        }

        // Position requests — one shape, one neutral fallback (`null`).
        case 'lsp.hover':
        case 'lsp.completion':
        case 'lsp.definition':
        case 'lsp.implementation':
        case 'lsp.typeDefinition':
        case 'lsp.references':
        case 'lsp.documentHighlight':
        case 'lsp.signatureHelp':
        case 'lsp.prepareRename': {
          const { kind, sessionId, file, position } = command
          return answer(reply, fail, null, (l) => {
            const op =
              kind === 'lsp.hover'
                ? l.hover
                : kind === 'lsp.completion'
                  ? l.completion
                  : kind === 'lsp.definition'
                    ? l.definition
                    : kind === 'lsp.implementation'
                      ? l.implementation
                      : kind === 'lsp.typeDefinition'
                        ? l.typeDefinition
                        : kind === 'lsp.documentHighlight'
                          ? l.documentHighlight
                          : kind === 'lsp.signatureHelp'
                            ? l.signatureHelp
                            : kind === 'lsp.prepareRename'
                              ? l.prepareRename
                              : l.references
            return op(userId, sessionId, file, position)
          })
        }

        case 'lsp.rename':
          return answer(reply, fail, null, (l) =>
            l.rename(userId, command.sessionId, command.file, command.position, command.newName),
          )
        case 'lsp.formatDocument':
          return answer(reply, fail, null, (l) =>
            l.formatDocument(userId, command.sessionId, command.file, command.options),
          )
        case 'lsp.applyCodeAction':
          return answer(reply, fail, null, (l) =>
            l.applyCodeAction(userId, command.sessionId, command.file, command.action),
          )
        case 'lsp.documentSymbols':
          return answer(reply, fail, null, (l) =>
            l.documentSymbols(userId, command.sessionId, command.file),
          )
        case 'lsp.workspaceSymbols':
          return answer(reply, fail, null, (l) =>
            l.workspaceSymbols(userId, command.sessionId, command.query),
          )

        // List requests — neutral fallback is an empty list, not null.
        case 'lsp.inlayHint':
          return answer(reply, fail, [], (l) =>
            l.inlayHint(userId, command.sessionId, command.file, command.range),
          )
        case 'lsp.documentColor':
          return answer(reply, fail, [], (l) =>
            l.documentColor(userId, command.sessionId, command.file),
          )
        case 'lsp.codeAction':
          return answer(reply, fail, [], (l) =>
            l.codeAction(
              userId,
              command.sessionId,
              command.file,
              command.range,
              command.kinds,
              command.trigger,
            ),
          )
      }
    },
  }
}
