import { useState } from 'react'
import type { Scope } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
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
import { KIND_LABELS, TRUST_LABELS, trustOf } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { KIND_SCOPES, type ConsentRequest } from '../model/useStoreActions'
import { ConsentPlan } from './ConsentPlan'
import { useListingPlan } from './PlanSummary'

/**
 * THE CONSENT SHEET: before a package that needs a yes is installed — it comes from a community
 * source, or the server says it runs code that must be agreed to — it says where it comes from,
 * in a sentence or two what will run and the hosts it reaches, and where to install it (for you,
 * or for the open project alone where its kind allows), drawn as every other question the app
 * asks. Nothing installs until Install.
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
  const read = useListingPlan(listing, scope)
  return (
    <Dialog open onOpenChange={(open) => !open && onAnswer(null)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Install {listing.displayName}?</DialogTitle>
          <DialogDescription>
            {KIND_LABELS[listing.ref.kind].one} from {listing.source.label}
            {trust && TRUST_LABELS[trust] !== listing.source.label && ` · ${TRUST_LABELS[trust]}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <ConsentPlan {...read} />
          {scopes.length > 1 && (
            <Field label="Install for">
              <Select
                value={scope}
                onValueChange={(value) => setScope(value as Scope)}
                options={scopes.map((s) => ({
                  value: s,
                  label: s === 'user' ? 'You, in every project' : `Only ${store.project!.name}`,
                }))}
                size="md"
                className="w-64"
              />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className="text-text-soft" onClick={() => onAnswer(null)}>
            Cancel
          </Button>
          <Button
            variant="mono"
            disabled={!read.plan}
            onClick={() => onAnswer({ ...request, scope })}
          >
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
