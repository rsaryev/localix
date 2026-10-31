import { useState } from 'react'
import type { Scope } from '@localixai/store'
import { Download } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { DialogHero } from '@localixai/kit/dialog-hero'
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
      <DialogContent size="sm" showCloseButton={false}>
        {/* Centred under its mark, like every question the app asks (`ConfirmDialog`). */}
        <DialogHeader className="pt-6 pr-4 text-center [&>[data-slot=dialog-header-main]]:items-center">
          <DialogHero icon={<Download />} />
          <DialogTitle>Install {listing.displayName}?</DialogTitle>
          <DialogDescription className="text-balance">
            {KIND_LABELS[listing.ref.kind].one} from {listing.source.label}
            {/* "Localix Community" already says Community. */}
            {trust &&
              !listing.source.label.toLowerCase().includes(TRUST_LABELS[trust].toLowerCase()) &&
              ` · ${TRUST_LABELS[trust]}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <ConsentPlan {...read} />
          {/* Its options say who it is for, so it needs no label above it in the centred column. */}
          {scopes.length > 1 && (
            <Select
              aria-label="Install for"
              value={scope}
              onValueChange={(value) => setScope(value as Scope)}
              options={scopes.map((s) => ({
                value: s,
                label:
                  s === 'user' ? 'For you, in every project' : `Only for ${store.project!.name}`,
              }))}
              size="md"
              className="w-full"
            />
          )}
        </DialogBody>
        {/* The two answers side by side at equal width, as a confirmation ends. */}
        <DialogFooter
          actionsLabel="Install actions"
          className="border-t-0 pt-1 pb-4 [&>[data-slot=dialog-footer-actions]]:w-full [&>[data-slot=dialog-footer-actions]]:flex-row [&>[data-slot=dialog-footer-actions]>*]:flex-1"
        >
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
