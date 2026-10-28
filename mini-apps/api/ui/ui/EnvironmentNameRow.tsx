import { Check, Copy, Layers, Pencil, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import type { Panel } from '../model/useEnvironmentDraft'
import { focusOnMount } from './focusOnMount'

/** The open environment's name: typed for a new one; shown, renamed or copied for a saved one. */
export function EnvironmentNameRow({
  panel,
  setPanel,
  renameDraft,
  setRenameDraft,
  saving,
  rename,
  duplicate,
}: {
  panel: Exclude<Panel, { kind: 'idle' }>
  setPanel: (panel: Panel) => void
  renameDraft: string | null
  setRenameDraft: (draft: string | null) => void
  saving: boolean
  rename: () => Promise<void>
  duplicate: () => Promise<void>
}) {
  return (
    <div className="border-b border-border-soft px-3 py-2">
      {panel.kind === 'new' ? (
        <Input
          size="lg"
          ref={focusOnMount}
          value={panel.name}
          placeholder="Environment name, e.g. production"
          aria-label="Environment name"
          onChange={(e) => setPanel({ ...panel, name: e.target.value })}
        />
      ) : (
        <div className="flex min-h-7 items-center gap-1.5">
          {renameDraft !== null ? (
            <>
              <Input
                ref={focusOnMount}
                size="md"
                aria-label={`Rename ${panel.name}`}
                className="h-7 min-w-0 flex-1"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void rename()
                  if (event.key === 'Escape') setRenameDraft(null)
                }}
              />
              <IconButton
                size="sm"
                aria-label="Save environment name"
                tooltip="Save name"
                disabled={saving || renameDraft.trim() === ''}
                onClick={() => void rename()}
              >
                <Check className="size-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                aria-label="Cancel environment rename"
                tooltip="Cancel"
                onClick={() => setRenameDraft(null)}
              >
                <X className="size-3.5" />
              </IconButton>
            </>
          ) : (
            <>
              <Layers className="size-4 shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {panel.name}
              </span>
              <IconButton
                size="sm"
                aria-label={`Rename ${panel.name}`}
                tooltip="Rename environment"
                disabled={saving}
                onClick={() => setRenameDraft(panel.name)}
              >
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                aria-label={`Duplicate ${panel.name}`}
                tooltip="Duplicate environment"
                disabled={saving}
                onClick={() => void duplicate()}
              >
                <Copy className="size-3.5" />
              </IconButton>
            </>
          )}
        </div>
      )}
    </div>
  )
}
