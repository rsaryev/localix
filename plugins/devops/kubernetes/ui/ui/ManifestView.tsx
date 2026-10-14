import type { KubeManifestKind } from '../../backend/contracts'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { CodeEditor } from '@localixai/kit/code-editor'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { useManifestEditor } from '../model/useManifestEditor'
import { ManifestStatus } from './ManifestStatus'
import { ManifestToolbar } from './ManifestToolbar'

/**
 * Shared read/edit manifest surface. The model owns request deduplication, race
 * control, stale-content recovery, dry-run apply feedback, and target changes.
 */
export function ManifestView({
  kind,
  name,
  namespace,
  context,
}: {
  kind: KubeManifestKind
  name: string
  namespace: string
  context?: string
}) {
  const model = useManifestEditor({ kind, name, namespace, context })
  // Two open manifests are two subjects; "Manifest" alone made them settle each other's row.
  const manifestSubject = `${kind}/${name} manifest`
  // Nothing loaded yet: the failure IS the pane, so the centred line owns "Manifest" alone.
  // Exactly one owner of the subject is mounted in every state, or they settle each other's row.
  const blocked = Boolean(model.loadIssue) && !model.original

  return (
    <div className="flex h-full flex-col">
      <ManifestToolbar model={model} />
      {!blocked && <ManifestStatus subject={manifestSubject} model={model} />}

      <div className="min-h-0 flex-1">
        {model.loading && !model.original ? (
          <LoadingHint className="p-4">Loading manifest…</LoadingHint>
        ) : blocked ? (
          <DevOpsProblem
            centered
            subject={manifestSubject}
            issue={model.loadIssue ?? null}
            onRetry={() => void model.refresh()}
          />
        ) : (
          <CodeEditor
            value={model.editing ? model.draft : model.original}
            language="yaml"
            readOnly={!model.editing}
            onChange={model.setDraft}
            ariaLabel={`${kind} ${name} manifest`}
          />
        )}
      </div>

      <ConfirmDialog
        open={model.confirming}
        title={`Apply changes to ${kind} "${name}"?`}
        description="The manifest is validated server-side (dry-run) before it is applied. This changes live cluster state."
        confirmLabel="Validate & apply"
        variant="default"
        onConfirm={() => void model.apply()}
        onClose={model.cancelApply}
      />
    </div>
  )
}
