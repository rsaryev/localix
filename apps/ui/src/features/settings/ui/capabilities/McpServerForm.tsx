import type { Project } from '@/shared/api/contracts'
import type { useMcpServerForm } from '../../model/useMcpServerForm'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { SettingsRecordEditor } from '../SettingsRecordEditor'
import { McpServerFields } from './McpServerFields'

type McpFormState = ReturnType<typeof useMcpServerForm>
type McpFormMode = McpFormState['mode']

const MODE_LABEL = { form: 'Form', json: 'JSON', command: 'Command' } as const

/**
 * The add/edit-server dialog: it renders nothing until its host opens it.
 *
 * Three ways to add a server share one dialog because they are one decision —
 * fill it in, paste a config, paste a command — and the user picks between them
 * after opening it, not before. The draft, the save paths and the form error all
 * live in `useMcpServerForm`; this file is only their arrangement.
 *
 * The mode decides only what the decision button SAYS and which save it calls, so the
 * three cannot end up with a differently sized or differently ordered pair of buttons.
 */
export function McpServerForm({
  form,
  scope,
  projects,
}: {
  form: McpFormState
  /** '' = no project; otherwise a project id. Names the JSON import's target. */
  scope: string
  projects: Project[]
}) {
  if (!form.adding) return null
  const { mode, saving, formError } = form
  const importTargetLabel = scope
    ? (projects.find((p) => p.id === scope)?.name ?? 'project')
    : 'No project'
  const decision: Record<McpFormMode, { label: string; busyLabel: string; submit: () => void }> = {
    form: {
      label: form.editingId ? 'Update server' : 'Save server',
      busyLabel: 'Saving server',
      submit: () => void form.saveForm(),
    },
    json: { label: 'Import', busyLabel: 'Importing', submit: () => void form.saveJson() },
    command: {
      label: 'Add server',
      busyLabel: 'Adding server',
      submit: () => void form.saveCommand(),
    },
  }

  return (
    <SettingsRecordEditor
      title={form.editingId ? 'Edit MCP server' : 'Add MCP server'}
      description="A server the agent can call tools on."
      busy={saving}
      busyLabel={decision[mode].busyLabel}
      submitLabel={decision[mode].label}
      cancelLabel={mode === 'json' ? 'Close' : 'Cancel'}
      error={formError}
      aside={
        form.importSummary && mode === 'json' ? (
          <p role="status" className="text-xs text-text-soft">
            {form.importSummary}
          </p>
        ) : undefined
      }
      onSubmit={decision[mode].submit}
      onCancel={form.cancel}
    >
      <SegmentedControl variant="muted" fullWidth aria-label="Add server method">
        {(['form', 'json', 'command'] as const).map((m) => (
          <SegmentedControlItem
            key={m}
            active={mode === m}
            disabled={saving}
            onClick={() => {
              form.setMode(m)
              form.clearFormError()
              form.setImportSummary(null)
            }}
          >
            {MODE_LABEL[m]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {mode === 'form' && form.draft && (
        <McpServerFields
          draft={form.draft}
          setDraft={form.setDraft}
          setConfig={form.setConfig}
          setTransport={form.setTransport}
          editingId={form.editingId}
          saving={saving}
          projects={projects}
          errors={form.errors}
          onFieldEdited={form.clearFieldError}
        />
      )}

      {mode === 'json' && (
        <Field
          label="Server configuration"
          description={
            <>
              Paste a standard <code className="text-foreground">mcpServers</code> block, VS Code{' '}
              <code className="text-foreground">servers</code> block, or a bare name→config map. It
              will be imported into <strong>{importTargetLabel}</strong>.
            </>
          }
          required
          disabled={saving}
        >
          <Textarea
            size="xl"
            className="min-h-40 resize-y font-mono text-xs"
            placeholder={
              '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n    }\n  }\n}'
            }
            value={form.jsonText}
            onChange={(e) => form.setJsonText(e.target.value)}
          />
        </Field>
      )}

      {mode === 'command' && (
        <Field
          label="Command"
          description="Paste a one-line stdio command. The server name is derived from its package."
          required
          disabled={saving}
        >
          <Input
            size="xl"
            className="font-mono"
            placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
            value={form.commandLine}
            onChange={(e) => form.setCommandLine(e.target.value)}
          />
        </Field>
      )}
    </SettingsRecordEditor>
  )
}
