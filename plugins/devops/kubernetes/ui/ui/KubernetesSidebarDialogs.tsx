import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import type { KubernetesWorkbenchModel } from '../model/useKubernetes'
import type { KubernetesSidebarActions } from '../model/useKubernetesSidebarActions'
import { NODE_ACTION_META } from './SidebarRows'
import { PortForwardDialog } from './PortForwardDialog'
import { ScaleDeploymentDialog } from './ScaleDeploymentDialog'

export function KubernetesSidebarDialogs({
  kubernetes,
  actions,
}: {
  kubernetes: KubernetesWorkbenchModel
  actions: KubernetesSidebarActions
}) {
  const deletePod = actions.confirmDeletePod
  const restart = actions.confirmRestart
  const nodeAction = actions.nodeAction
  const refresh = () => void kubernetes.refresh({ forceSecondary: true, silent: true })
  return (
    <>
      {/* Deleting a pod used to be the ONE action in this sidebar guarded by a pair of tiny inline
          buttons in the row, while the restart below it — the reversible one — got a real dialog.
          Same question, same surface now. */}
      <ConfirmDialog
        open={deletePod !== null}
        title={deletePod ? `Delete pod ${deletePod.name}?` : ''}
        description={
          deletePod
            ? `The pod is deleted from ${deletePod.namespace}. A controller-managed pod is recreated; a bare one is gone for good.`
            : ''
        }
        confirmLabel="Delete pod"
        onConfirm={() => deletePod && void actions.deletePod(deletePod)}
        onClose={actions.cancelDelete}
      />

      <ConfirmDialog
        open={restart !== null}
        title={restart ? `Restart rollout of ${restart.name}?` : ''}
        description="Triggers a rolling restart — pods are recreated one batch at a time. This cannot be undone."
        confirmLabel="Restart"
        onConfirm={() => restart && void actions.restartDeployment(restart)}
        onClose={actions.cancelRestart}
      />

      <ConfirmDialog
        open={nodeAction !== null}
        title={
          nodeAction ? `${NODE_ACTION_META[nodeAction.action].title} ${nodeAction.node.name}?` : ''
        }
        description={nodeAction ? NODE_ACTION_META[nodeAction.action].description : ''}
        confirmLabel={nodeAction ? NODE_ACTION_META[nodeAction.action].confirmLabel : 'Confirm'}
        variant={nodeAction?.action === 'drain' ? 'destructive' : 'default'}
        onConfirm={() => nodeAction && void actions.runNodeAction(nodeAction)}
        onClose={actions.cancelNodeAction}
      />

      <ScaleDeploymentDialog
        deployment={actions.scaleDeployment}
        context={actions.context}
        onClose={actions.closeScale}
        onScaled={refresh}
      />

      <PortForwardDialog
        pod={actions.portForwardPod}
        namespace={actions.portForwardPod?.namespace ?? kubernetes.activeNamespace}
        context={actions.context}
        onClose={actions.closePortForward}
        onStarted={refresh}
      />
    </>
  )
}
