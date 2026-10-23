import type { ReactNode } from 'react'
import type { Element } from 'hast'
import type { ActionTarget } from '@localixai/mini-app-sdk/ui'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { ContributedActions } from './ContributedActions'

/** A quiet hover affordance; the original block owns typography and spacing. */
export function ContentActionBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const markdown = String(node?.properties.markdownSource ?? '')
  const block = node?.properties.blockKind as
    | Extract<ActionTarget, { kind: 'markdown' }>['block']
    | 'table'
  const target: ActionTarget =
    block === 'table' ? { kind: 'table', markdown } : { kind: 'markdown', markdown, block }
  return (
    <div className="lx-content-block group/content relative">
      {children}
      <div
        className={`${FLOATING_SURFACE} lx-media-actions pointer-events-none absolute right-0 top-0 z-(--z-controls) flex gap-0.5 p-0.5 opacity-0 empty:hidden group-hover/content:pointer-events-auto group-hover/content:opacity-100 group-focus-within/content:pointer-events-auto group-focus-within/content:opacity-100`}
      >
        <ContributedActions target={target} />
      </div>
    </div>
  )
}

export function ContentLinkActions({
  target,
  children,
}: {
  target: ActionTarget
  children: ReactNode
}) {
  return (
    <span className="group/link relative inline-flex items-baseline">
      {children}
      <span
        className={`${FLOATING_SURFACE} lx-media-actions pointer-events-none absolute bottom-full left-0 z-(--z-controls) flex p-0.5 opacity-0 empty:hidden group-hover/link:pointer-events-auto group-hover/link:opacity-100 group-focus-within/link:pointer-events-auto group-focus-within/link:opacity-100`}
      >
        <ContributedActions target={target} />
      </span>
    </span>
  )
}
