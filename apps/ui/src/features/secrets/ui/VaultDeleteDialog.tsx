import { useEffect, useState } from 'react'
import { AlertTriangle, PlugZap } from 'lucide-react'

import type { SecretBinding, SecretMeta } from '@localixai/api/client'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Input } from '@localixai/kit/input'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { VAULT_PROBLEM_SCOPE } from '../model/vaultProblem'

interface VaultDeleteDialogProps {
  open: boolean
  item?: SecretMeta
  bindings: SecretBinding[]
  loadingBindings: boolean
  deleting: boolean
  /** Already classified by the workspace hook: a sentence, with the raw text in its detail. */
  error: Problem | null
  onOpenChange: (open: boolean) => void
  onConfirm: (force: boolean) => void
}

export function VaultDeleteDialogBody({
  open,
  item,
  bindings,
  loadingBindings,
  deleting,
  error,
  onOpenChange,
  onConfirm,
}: VaultDeleteDialogProps) {
  const [confirmation, setConfirmation] = useState('')
  const problem = useProblemReport(
    error ? { subject: { label: item?.label ?? 'Vault item' }, problems: [error] } : null,
    { scope: VAULT_PROBLEM_SCOPE, sourceVisible: true },
  )

  useEffect(() => {
    if (open) setConfirmation('')
  }, [open, item?.key])

  const inUse = bindings.length > 0
  const confirmed = !inUse || confirmation === item?.key

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-status-error" />
          Delete {item?.label ?? 'Vault item'}?
        </DialogTitle>
        <DialogDescription>
          Deleting the item removes its encrypted version history. Secret values cannot be
          reconstructed afterward.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="grid gap-3">
        {loadingBindings ? (
          <div className="border-y border-border-faint py-3 text-text-soft">
            <ActivitySignal
              label="Checking consumers"
              className="text-xs"
              labelClassName="min-w-0"
            />
          </div>
        ) : inUse ? (
          <div className="grid gap-3">
            <div className="border-y border-status-warning/25 py-2">
              <p className="flex items-center gap-2 font-medium text-status-warning">
                <PlugZap aria-hidden="true" className="size-3.5 shrink-0" />
                This item is used by {bindings.length} consumer{bindings.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-2 divide-y divide-border-faint border-t border-border-faint">
                {bindings.map((binding) => (
                  <li
                    key={`${binding.consumerType}:${binding.consumerId}:${binding.field}`}
                    className="flex items-center gap-2 py-2 text-text-soft"
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-status-warning"
                    />
                    <span className="truncate">{binding.label || binding.consumerId}</span>
                    <span className="ml-auto text-text-faint">{binding.consumerType}</span>
                  </li>
                ))}
              </ul>
            </div>
            <label className="grid gap-1.5">
              <span>
                Type <code className="font-mono text-foreground">{item?.key}</code> to confirm
              </span>
              <Input
                size="lg"
                value={confirmation}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <p className="border-y border-border-faint py-2 text-text-soft">
            No registered consumers currently reference this item.
          </p>
        )}

        {problem && <ProblemLine {...problem} />}
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
          Cancel
        </Button>
        <Button
          variant="destructive-solid"
          disabled={loadingBindings || deleting || !confirmed}
          onClick={() => onConfirm(inUse)}
          aria-busy={deleting}
        >
          {deleting ? (
            <ActivitySignal
              label="Deleting"
              className="text-xs [&_.lx-activity-orb]:text-current"
              labelClassName="min-w-0"
            />
          ) : inUse ? (
            'Delete anyway'
          ) : (
            'Delete item'
          )}
        </Button>
      </DialogFooter>
    </>
  )
}

export function VaultDeleteDialog(props: VaultDeleteDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">
        <VaultDeleteDialogBody {...props} />
      </DialogContent>
    </Dialog>
  )
}
