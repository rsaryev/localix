import { useState } from 'react'

import { unwrapMcpServersBlob } from '@localixai/api/mcp-import'

import { backendClient } from '@/shared/api/client'
import type { McpServerConfig, McpServerRecord } from '@/shared/api/contracts'
import { splitCommandLine, slugFromCommand } from './mcpCommand'
import {
  buildMcpSavePayload,
  draftFromRecord,
  emptyDraft,
  MCP_FIELD_IDS,
  type McpField,
  type McpServerDraft,
} from './mcpDraft'
import { focusFirstInvalid, type FieldErrors } from '@/shared/lib/forms/fieldErrors'
import { failureSentence } from '@/shared/api/internal'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'

type McpAddMode = 'form' | 'json' | 'command'

interface McpServerFormDeps {
  scope: string
  refresh: () => void
}

/**
 * The "add / edit MCP server" panel: form/json/command modes, draft state, and
 * the three save paths (single form, Claude-desktop JSON import, raw command
 * line). Form validation and save errors stay local to this hook so they cannot
 * replace list loading or row mutation feedback.
 */
export function useMcpServerForm({ scope, refresh }: McpServerFormDeps) {
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<McpAddMode>('form')
  const [draft, setDraft] = useState<McpServerDraft | null>(null)
  /** Id of the server being edited (null = adding a new one). Drives update-vs-create. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [commandLine, setCommandLine] = useState('')
  const [importSummary, setImportSummary] = useState<string | null>(null)
  /** Per-field problems. `formError` stays for failures of the whole save. */
  const [errors, setErrors] = useState<FieldErrors<McpField>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const startAdd = () => {
    setAdding(true)
    setMode('form')
    setEditingId(null)
    setDraft(emptyDraft(scope || null))
    setFormError(null)
    setImportSummary(null)
    setJsonText('')
    setCommandLine('')
  }

  const startEdit = (s: McpServerRecord) => {
    setAdding(true)
    setMode('form')
    setEditingId(s.id)
    setDraft(draftFromRecord(s))
    setFormError(null)
  }

  const cancel = () => {
    setAdding(false)
    setDraft(null)
    setEditingId(null)
    setFormError(null)
    setImportSummary(null)
  }

  const setConfig = (patch: Partial<McpServerConfig>) =>
    setDraft((d) => (d ? { ...d, config: { ...d.config, ...patch } } : d))

  /** Switch the draft's transport WITHOUT discarding the other config fields
   *  (env/headers/oauth/filters/timeout) — only the transport-relevant identity
   *  field is projected out at save time, so a toggle-and-back is lossless. */
  const setTransport = (transport: McpServerDraft['transport']) =>
    setDraft((d) => (d ? { ...d, transport } : d))

  const saveForm = async () => {
    if (!draft) return
    const built = buildMcpSavePayload(draft)
    if (!built.ok) {
      setErrors(built.errors)
      setFormError(null)
      focusFirstInvalid(built.errors, MCP_FIELD_IDS)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await trackCapabilityWrite(undefined, async () => {
        if (editingId) await backendClient.updateMcpServer(editingId, built.payload)
        else await backendClient.createMcpServer(built.payload)
      })
      cancel()
      refresh()
    } catch (e) {
      setFormError(inlineFailure(e, 'This server could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const saveJson = async () => {
    setFormError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      setFormError('Invalid JSON.')
      return
    }
    // Accepts mcpServers (Claude Desktop/.mcp.json), servers (VS Code), or a bare map.
    let mcpServers: Record<string, Record<string, unknown>>
    try {
      mcpServers = unwrapMcpServersBlob(parsed)
    } catch (e) {
      setFormError(failureSentence(e, 'Unrecognized MCP config shape.'))
      return
    }
    setSaving(true)
    try {
      // Bulk-imported servers land INERT (enabled:false) — a pasted stdio server
      // must not silently spawn a process on the next turn. The user enables the
      // ones they want from the list.
      const result = await trackCapabilityWrite(undefined, () =>
        backendClient.importMcpServers(mcpServers, {
          projectId: scope || null,
          defaultEnabled: false,
        }),
      )
      const okCount = result.created.length
      const errPart = result.errors.length
        ? ` ${result.errors.length} failed: ${result.errors.map((e) => `${e.name} (${e.error})`).join(', ')}`
        : ''
      setImportSummary(
        `Imported ${okCount} server${okCount === 1 ? '' : 's'} (disabled — enable the ones you want).${errPart}`,
      )
      if (okCount > 0) refresh()
    } catch (e) {
      setFormError(inlineFailure(e, 'The import did not complete.'))
    } finally {
      setSaving(false)
    }
  }

  const saveCommand = async () => {
    setFormError(null)
    const tokens = splitCommandLine(commandLine)
    if (tokens.length === 0) {
      setFormError('Enter a command, e.g. npx -y @modelcontextprotocol/server-filesystem /tmp.')
      return
    }
    setSaving(true)
    try {
      await trackCapabilityWrite(undefined, () =>
        backendClient.createMcpServer({
          name: slugFromCommand(tokens),
          description: '',
          transport: 'stdio',
          projectId: scope || null,
          enabled: true,
          config: { command: tokens },
        }),
      )
      cancel()
      refresh()
    } catch (e) {
      setFormError(inlineFailure(e, 'This server could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return {
    adding,
    mode,
    setMode,
    draft,
    setDraft,
    editingId,
    saving,
    jsonText,
    setJsonText,
    commandLine,
    setCommandLine,
    importSummary,
    setImportSummary,
    errors,
    /** Stop complaining about a field as it is corrected. */
    clearFieldError: (field: McpField) =>
      setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev)),
    formError,
    clearFormError: () => setFormError(null),
    startAdd,
    startEdit,
    cancel,
    setConfig,
    setTransport,
    saveForm,
    saveJson,
    saveCommand,
  }
}
