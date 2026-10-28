import { Pencil, RotateCcw, UploadCloud, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import type { ManifestEditorModel } from '../model/useManifestEditor'

export function ManifestToolbar({ model }: { model: ManifestEditorModel }) {
  const loading = model.loading || model.refreshing

  return (
    <WorkbenchToolbar wrap aria-label="Manifest actions" className="gap-1">
      <span className="mr-auto text-2xs text-text-faint">Manifest (YAML)</span>
      {model.editing ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reset manifest changes"
            title="Reset changes"
            disabled={!model.dirty || model.applying}
            onClick={model.reset}
          >
            <RotateCcw className="size-3" />
            <span className="@max-sm:sr-only">Reset</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={model.applying ? 'Applying manifest' : 'Apply manifest'}
            title="Apply manifest"
            disabled={!model.dirty || model.applying}
            onClick={model.requestApply}
          >
            {model.applying ? <Spinner className="size-3" /> : <UploadCloud className="size-3" />}
            <span className="@max-sm:sr-only">{model.applying ? 'Applying…' : 'Apply'}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Cancel manifest editing"
            title="Cancel editing"
            disabled={model.applying}
            onClick={model.cancelEditing}
          >
            <X className="size-3" />
            <span className="@max-sm:sr-only">Cancel</span>
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Edit manifest"
            title={
              model.loadIssue
                ? 'Refresh the manifest before editing'
                : model.loading
                  ? 'Wait for the manifest to load'
                  : 'Edit manifest'
            }
            disabled={!model.canEdit}
            onClick={model.startEditing}
          >
            <Pencil className="size-3" />
            <span className="@max-sm:sr-only">Edit</span>
          </Button>
          <RefreshAction
            size="sm"
            aria-label={loading ? 'Refreshing manifest' : 'Refresh manifest'}
            tooltip={loading ? 'Refreshing manifest' : 'Refresh manifest'}
            disabled={!model.canRefresh}
            busy={loading}
            onClick={() => void model.refresh()}
          />
        </>
      )}
    </WorkbenchToolbar>
  )
}
