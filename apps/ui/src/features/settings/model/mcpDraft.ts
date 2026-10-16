import type { McpServerConfig, McpServerInput, McpServerRecord } from '@/shared/api/contracts'
import { hasFieldErrors, type FieldErrors } from '@/shared/lib/forms/fieldErrors'

/**
 * The add/edit form's working copy of a server. Identical to the wire payload
 * except `config` is the un-narrowed view (`McpServerConfig`): the form edits
 * `url` and `command` before the transport is settled, and toggling the
 * transport must not throw the other side's fields away.
 */
export type McpServerDraft = Omit<McpServerInput, 'config'> & { config: McpServerConfig }

export const emptyDraft = (projectId: string | null): McpServerDraft => ({
  name: '',
  description: '',
  transport: 'stdio',
  projectId,
  enabled: true,
  config: { command: [] },
})

/** Load an existing server into the form. Its config rides across WHOLE. */
export const draftFromRecord = (server: McpServerRecord): McpServerDraft => ({
  name: server.name,
  description: server.description,
  transport: server.transport,
  projectId: server.projectId || null,
  enabled: server.enabled,
  config: server.config,
})

/** The controls a save can send the reader back to. */
export type McpField = 'name' | 'command' | 'url'

/** One id per validated control — read by its `Field` and by focus-on-submit. */
export const MCP_FIELD_IDS = {
  name: 'mcp-name',
  command: 'mcp-command',
  url: 'mcp-url',
} as const satisfies Record<McpField, string>

export type McpSaveResult =
  | { ok: true; payload: McpServerInput }
  | { ok: false; errors: FieldErrors<McpField> }

/** Mirrors the server-side name regex (`mcpServerInputSchema`) — dotted ecosystem names allowed. */
const NAME_RE = /^[a-z0-9][a-z0-9_.-]*$/i

/**
 * Build the wire payload for a save.
 *
 * The `PUT /rpc/mcp/servers/:id` route replaces `config` WHOLESALE, so whatever
 * this function omits is destroyed on the server. The only per-transport
 * knowledge it therefore allows itself is which field IDENTIFIES the transport —
 * `command` for stdio, `url` for remote — the same single fact
 * `mcpServerInputSchema`'s superRefine encodes. Every other field rides through
 * on a rest spread, and the server's zod strips whatever the chosen transport
 * does not accept.
 *
 * NEVER re-enumerate the config fields here. An allowlist rebuild is exactly what
 * silently wiped `oauth` and timeout/filter fields from every edited server — it
 * could only name the fields the UI's own short copy of the type knew about. See
 * `mcpDraft.test.ts`, which derives its fixture from the owner type so the
 * allowlist cannot come back.
 */
export function buildMcpSavePayload(draft: McpServerDraft): McpSaveResult {
  // Top-down and per field, so both problems of a nameless stdio server are reported at once
  // and each sits under the control it is about (see `shared/lib/forms/fieldErrors.ts`).
  const errors: FieldErrors<McpField> = {}
  if (!NAME_RE.test(draft.name)) {
    errors.name = draft.name.trim()
      ? 'Start with a letter or digit; then letters, digits, dots, dashes or underscores.'
      : 'Required.'
  }
  const { command, url, ...carried } = draft.config
  if (draft.transport === 'stdio') {
    if (!command?.length) errors.command = 'Required for a stdio server.'
    if (hasFieldErrors(errors) || !command?.length) return { ok: false, errors }
    return { ok: true, payload: { ...draft, config: { ...carried, command } } }
  }
  if (!url) errors.url = `Required for a ${draft.transport} server.`
  if (hasFieldErrors(errors) || !url) return { ok: false, errors }
  return { ok: true, payload: { ...draft, config: { ...carried, url } } }
}
