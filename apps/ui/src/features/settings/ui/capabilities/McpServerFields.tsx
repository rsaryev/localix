import type { McpServerConfig, McpTransport, Project } from '@/shared/api/contracts'
import { MCP_FIELD_IDS, type McpField, type McpServerDraft } from '../../model/mcpDraft'
import type { FieldErrors } from '@/shared/lib/forms/fieldErrors'
import { splitCommandLine } from '../../model/mcpCommand'
import { buildProjectScopeOptions } from '@/shared/lib/projectScope'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { SegmentedControl, SegmentedControlItem } from '@localixai/plugin-sdk/ui/segmented-control'
import { EnvEditor } from '../mcpFormParts'

/**
 * The structured editor for one MCP server draft: identity, scope, transport,
 * and the fields that transport implies.
 *
 * Separated from the add panel because this is the only part that has to know
 * what an MCP server IS. The panel around it knows about modes and saving; a new
 * transport or a new config key lands here and nowhere else.
 */
export function McpServerFields({
  draft,
  setDraft,
  setConfig,
  setTransport,
  editingId,
  saving,
  projects,
  errors,
  onFieldEdited,
}: {
  draft: McpServerDraft
  setDraft: (draft: McpServerDraft) => void
  setConfig: (patch: Partial<McpServerConfig>) => void
  setTransport: (transport: McpTransport) => void
  /** Id of the server being edited, or null when adding. Keys the env editors. */
  editingId: string | null
  saving: boolean
  projects: Project[]
  /** What each control got wrong, shown under it. See `shared/lib/forms/fieldErrors.ts`. */
  errors?: FieldErrors<McpField>
  /** Stop complaining about a field as it is corrected. */
  onFieldEdited?: (field: McpField) => void
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
        <Field
          controlId={MCP_FIELD_IDS.name}
          label="Name"
          required
          disabled={saving}
          error={errors?.name}
        >
          <Input
            size="xl"
            placeholder="filesystem"
            value={draft.name}
            onChange={(e) => {
              onFieldEdited?.('name')
              setDraft({ ...draft, name: e.target.value })
            }}
          />
        </Field>
        <Field label="Scope" disabled={saving}>
          <Select
            size="xl"
            className="w-full"
            value={draft.projectId ?? ''}
            onValueChange={(v) => setDraft({ ...draft, projectId: v || null })}
            options={buildProjectScopeOptions(projects)}
          />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-text-soft">Transport</p>
        <SegmentedControl variant="muted" fullWidth aria-label="Transport">
          {(['stdio', 'http'] as McpTransport[]).map((t) => (
            <SegmentedControlItem
              key={t}
              active={draft.transport === t}
              disabled={saving}
              onClick={() => setTransport(t)}
            >
              {t === 'stdio' ? 'Local (stdio)' : 'Remote (http)'}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {draft.transport === 'stdio' ? (
        <>
          <Field
            controlId={MCP_FIELD_IDS.command}
            label="Command"
            description="Full command line, including its arguments."
            required
            disabled={saving}
            error={errors?.command}
          >
            <Input
              size="xl"
              className="font-mono"
              placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
              value={(draft.config.command ?? []).join(' ')}
              onChange={(e) => {
                onFieldEdited?.('command')
                setConfig({ command: splitCommandLine(e.target.value) })
              }}
            />
          </Field>
          <EnvEditor
            key={`env-${editingId ?? 'new'}`}
            label="Environment variables"
            entries={draft.config.env ?? {}}
            disabled={saving}
            onChange={(env) => setConfig({ env: Object.keys(env).length ? env : undefined })}
          />
        </>
      ) : (
        <>
          <Field
            controlId={MCP_FIELD_IDS.url}
            label="URL"
            required
            disabled={saving}
            error={errors?.url}
          >
            <Input
              size="xl"
              className="font-mono"
              placeholder="https://mcp.example.com/mcp"
              value={draft.config.url ?? ''}
              onChange={(e) => {
                onFieldEdited?.('url')
                setConfig({ url: e.target.value })
              }}
            />
          </Field>
          <EnvEditor
            key={`headers-${editingId ?? 'new'}`}
            label="Headers"
            keyPlaceholder="Authorization"
            valuePlaceholder="Bearer …"
            entries={draft.config.headers ?? {}}
            disabled={saving}
            onChange={(headers) =>
              setConfig({ headers: Object.keys(headers).length ? headers : undefined })
            }
          />
        </>
      )}

      <Field label="Description" optional disabled={saving}>
        <Input
          size="xl"
          placeholder="What this server provides"
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>
    </>
  )
}
