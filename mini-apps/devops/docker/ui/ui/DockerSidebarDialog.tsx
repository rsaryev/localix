import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { confirmCopy } from '../model/confirmCopy'
import type { DockerSidebarActions } from '../model/useDockerSidebarActions'

export function DockerSidebarDialog({ actions }: { actions: DockerSidebarActions }) {
  const copy = actions.confirm ? confirmCopy(actions.confirm) : null
  return (
    <ConfirmDialog
      open={actions.confirm !== null}
      title={copy?.title ?? ''}
      description={copy?.description ?? ''}
      confirmLabel={copy?.confirmLabel ?? 'Remove'}
      onConfirm={() => void actions.runConfirm()}
      onClose={actions.cancelConfirm}
    />
  )
}
