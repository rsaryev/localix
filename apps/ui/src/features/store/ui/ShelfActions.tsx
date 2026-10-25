import { useEffect, useState } from 'react'
import type { ItemAction, PackageKind, Scope, ShelfPlan } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useStoreScope } from '../model/storeContext'
import { useShelfActions } from '../model/useStoreData'

type ShelfAction = ItemAction & { kind: PackageKind }

/**
 * ONE ACTION ON A WHOLE SHELF ("Archive unused", `docs/internals/store.md`, "Shelf actions"): the
 * preview the provider computes, which items and why, and nothing is written until the person
 * confirms. Confirming sends back the ids that were shown, so a skill that stopped qualifying
 * meanwhile is left alone by the provider.
 */
function ShelfActionDialog({
  action,
  scope,
  onClose,
}: {
  action: ShelfAction
  scope: Scope
  onClose: () => void
}) {
  const store = useStoreScope()
  const projectId = scope === 'project' ? (store.project?.id ?? null) : null
  const [plan, setPlan] = useState<ShelfPlan | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    store.client
      .planShelfAction(action.kind, action.id, scope, projectId)
      .then((next) => current && setPlan(next))
      .catch((error: unknown) => current && setProblem(errorMessage(error, 'Could not preview it')))
    return () => {
      current = false
    }
  }, [store.client, action.kind, action.id, scope, projectId])

  const confirm = async () => {
    if (!plan || busy) return
    setBusy(true)
    try {
      await store.client.runShelfAction(
        action.kind,
        action.id,
        scope,
        plan.items.map((item) => item.ref.id),
        projectId,
      )
      onClose()
    } catch (error) {
      setProblem(errorMessage(error, `${action.label} did not work`))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>
            {plan?.summary ?? action.help ?? 'Reading the shelf…'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {!plan && !problem && <LoadingHint />}
          {plan && plan.items.length === 0 && <EmptyHint>Nothing to do.</EmptyHint>}
          {plan && plan.items.length > 0 && (
            <ul className={DIVIDED_LIST} aria-label="Skills to archive">
              {plan.items.map((item) => (
                <li key={item.ref.id} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
                  <span className="shrink-0 text-xs text-text-soft">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {problem && (
            <p role="alert" className="text-xs text-status-error">
              {problem}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button size="xl" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="xl"
            variant="mono"
            disabled={!plan || plan.items.length === 0 || busy}
            aria-busy={busy}
            onClick={() => void confirm()}
          >
            {action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The buttons for what can be done to this shelf: none when no provider offers anything. */
export function ShelfActionButtons({ scope }: { scope: Scope }) {
  const store = useStoreScope()
  const actions = useShelfActions(
    store.client,
    scope,
    scope === 'project' ? (store.project?.id ?? null) : null,
  ).data
  const [open, setOpen] = useState<ShelfAction | null>(null)
  if (!actions || actions.length === 0) return null
  return (
    <>
      {actions.map((action) => (
        <Button
          key={`${action.kind}:${action.id}`}
          size="sm"
          variant="secondary"
          title={action.help}
          onClick={() => setOpen(action)}
        >
          {action.label}
        </Button>
      ))}
      {open && <ShelfActionDialog action={open} scope={scope} onClose={() => setOpen(null)} />}
    </>
  )
}
