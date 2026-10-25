import { useState } from 'react'
import type { Scope } from '@localixai/store'
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
import { Select } from '@localixai/kit/select'
import { KIND_LABELS, TRUST_LABELS, inSentence, trustOf } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { KIND_SCOPES, type ConsentRequest } from '../model/useStoreActions'
import { PlanSummary } from './PlanSummary'
import { ListingIcon } from './StoreMarks'

/**
 * THE CONSENT SHEET: before a package that needs a yes is installed — it comes from a community
 * source, or the server says it runs code that must be agreed to — it shows what will run, the
 * hosts it reaches, where it comes from and how far that is trusted, and where to install it
 * (for you, or for the open project alone where its kind allows). Nothing installs until Install.
 */
export function ConsentSheet({
  request,
  onAnswer,
}: {
  request: ConsentRequest
  /** The request with the scope chosen, or null for Cancel. */
  onAnswer: (request: ConsentRequest | null) => void
}) {
  const store = useStoreScope()
  const { listing } = request
  const [scope, setScope] = useState<Scope>(request.scope)
  const scopes = KIND_SCOPES[listing.ref.kind].filter((s) => s === 'user' || store.project)
  const trust = trustOf(listing)
  return (
    <Dialog open onOpenChange={(open) => !open && onAnswer(null)}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ListingIcon listing={listing} size={48} />
            <div className="flex min-w-0 flex-col">
              <DialogTitle>Install {listing.displayName}?</DialogTitle>
              <DialogDescription>
                A {inSentence(KIND_LABELS[listing.ref.kind].one)} from {listing.source.label} ·{' '}
                {TRUST_LABELS[trust]}
                {trust === 'community' && ' — Localix does not review what this source lists'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <PlanSummary listing={listing} scope={scope} />
          {scopes.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Install for</span>
              <Select
                aria-label="Install for"
                value={scope}
                onValueChange={(value) => setScope(value as Scope)}
                options={scopes.map((s) => ({
                  value: s,
                  label: s === 'user' ? 'You, in every project' : `Only ${store.project!.name}`,
                }))}
                size="md"
                className="w-64"
              />
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button size="xl" variant="ghost" onClick={() => onAnswer(null)}>
            Cancel
          </Button>
          <Button size="xl" variant="mono" onClick={() => onAnswer({ ...request, scope })}>
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
