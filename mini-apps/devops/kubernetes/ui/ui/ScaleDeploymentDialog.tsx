import { useState } from 'react'
import type { KubeDeployment } from '../../backend/contracts'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'

/**
 * A small confirm-guarded dialog to scale a deployment through the API. The replica
 * input IS the confirmation — scaling to a
 * different count is a deliberate, typed number, and 0 (scale to nothing) is allowed
 * but flagged in the copy. A typed backend failure surfaces inline.
 */
export function ScaleDeploymentDialog({
  deployment,
  context,
  onClose,
  onScaled,
}: {
  deployment: KubeDeployment | null
  context?: string
  onClose: () => void
  onScaled?: () => void
}) {
  const [replicas, setReplicas] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the input with the deployment's current desired count each time it
  // opens (render-time adjust).
  const [lastDeployment, setLastDeployment] = useState(deployment)
  if (lastDeployment !== deployment) {
    setLastDeployment(deployment)
    if (deployment) {
      // `ready` is "<ready>/<desired>" — default the field to the desired replicas.
      const desired = deployment.ready.split('/')[1]
      setReplicas(desired && /^\d+$/.test(desired) ? desired : '1')
      setError(null)
      setBusy(false)
    }
  }

  const scale = async () => {
    if (!deployment) return
    const n = Number(replicas)
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setError('Replicas must be between 0 and 1000.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await kubernetesApi.scaleDeployment(deployment.name, deployment.namespace, n, context)
      onScaled?.()
      onClose()
    } catch (err) {
      setError(
        err instanceof KubeApiError ? err.detail || err.message : 'Could not scale the deployment.',
      )
    } finally {
      setBusy(false)
    }
  }

  const zero = Number(replicas) === 0

  return (
    <Dialog
      open={deployment !== null}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Scale {deployment?.name ?? 'deployment'}</DialogTitle>
          <DialogDescription>
            Set the desired replica count. Kubernetes adds or removes pods to match.
            {zero && ' Scaling to 0 stops all pods for this deployment.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <Field label="Replicas">
            <Input
              type="number"
              min={0}
              max={1000}
              value={replicas}
              onChange={(e) => setReplicas(e.target.value)}
              placeholder="1"
            />
          </Field>
          {error && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void scale()} disabled={busy}>
            {busy ? 'Scaling…' : 'Scale'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
