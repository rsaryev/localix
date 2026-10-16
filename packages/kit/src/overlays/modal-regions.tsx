import * as React from 'react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  modalFooter,
  modalFooterActions,
  modalFooterAside,
  modalHeader,
  modalHeaderActions,
  modalHeaderMain,
} from './modal-surface'

type NamedHeaderActions =
  | { actions?: undefined; actionsLabel?: never }
  | { actions: React.ReactNode; actionsLabel: string }
type DistributiveOmit<Props, Keys extends PropertyKey> = Props extends unknown
  ? Omit<Props, Keys>
  : never

type ModalHeaderRegionProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> &
  NamedHeaderActions & {
    children: React.ReactNode
    slot: string
  }
type ModalHeaderRegionOwnerProps = DistributiveOmit<ModalHeaderRegionProps, 'slot'>

/**
 * Shared modal title row: context remains fluid while an explicitly named toolbar
 * stays aligned at the trailing edge. Shell-specific wrappers provide their slot.
 */
function ModalHeaderRegion({
  slot,
  className,
  children,
  actions,
  actionsLabel,
  ...props
}: ModalHeaderRegionProps) {
  return (
    <div data-slot={`${slot}-header`} className={cn(modalHeader, className)} {...props}>
      <div data-slot={`${slot}-header-main`} className={modalHeaderMain}>
        {children}
      </div>
      {actions != null && (
        <div
          data-slot={`${slot}-header-actions`}
          role="group"
          aria-label={actionsLabel}
          className={modalHeaderActions}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

type ModalFooterRegionProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  children: React.ReactNode
  slot: string
  /** Supplemental context/control kept separate from the decision button group. */
  aside?: React.ReactNode
  actionsLabel?: string
}
type ModalFooterRegionOwnerProps = Omit<ModalFooterRegionProps, 'slot'>

/**
 * Shared modal decision row. At narrow widths the primary action appears first and
 * cancel/back last; at workbench widths supplemental context stays on the leading
 * side and the named action group aligns to the trailing edge.
 */
function ModalFooterRegion({
  slot,
  className,
  children,
  aside,
  actionsLabel = 'Dialog actions',
  ...props
}: ModalFooterRegionProps) {
  return (
    <div data-slot={`${slot}-footer`} className={cn(modalFooter, className)} {...props}>
      {aside != null && (
        <div data-slot={`${slot}-footer-aside`} className={modalFooterAside}>
          {aside}
        </div>
      )}
      <div
        data-slot={`${slot}-footer-actions`}
        role="group"
        aria-label={actionsLabel}
        className={modalFooterActions}
      >
        {children}
      </div>
    </div>
  )
}

export { ModalFooterRegion, ModalHeaderRegion }
export type {
  ModalFooterRegionOwnerProps,
  ModalFooterRegionProps,
  ModalHeaderRegionOwnerProps,
  ModalHeaderRegionProps,
}
