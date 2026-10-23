import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

type WorkbenchListRowProps = ComponentPropsWithoutRef<'div'> & {
  /** Dense rows are 28px; compact sidebar rows 32px; default rows may carry descriptions. */
  density?: 'dense' | 'compact' | 'default'
  /** Current/open resource, distinct from transient keyboard focus. */
  active?: boolean
  /** Quiet visual feedback while a row participates in drag and drop. */
  dragging?: boolean
}

/**
 * Shared frame for workbench sidebar/tree rows. The primary navigation trigger,
 * passive metadata and secondary controls stay siblings, so a switch or row
 * action is never nested inside another interactive element.
 */
const WorkbenchListRow = forwardRef<HTMLDivElement, WorkbenchListRowProps>(
  ({ density = 'default', active = false, dragging = false, className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="workbench-list-row"
      data-density={density}
      data-active={active || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        'group/workbench-row flex w-full items-center gap-1 rounded-md px-1 text-xs text-text-soft transition-[background-color,color,opacity] duration-(--dur-fast) hover:bg-surface-hover focus-within:bg-surface-hover motion-reduce:transition-none data-[active=true]:bg-sidebar-accent/55 data-[active=true]:text-sidebar-foreground data-[dragging=true]:opacity-50',
        density === 'dense'
          ? 'min-h-[var(--chrome-control-md)]'
          : density === 'compact'
            ? 'min-h-[var(--chrome-control-lg)]'
            : 'min-h-[var(--chrome-control-touch)]',
        className,
      )}
      {...props}
    />
  ),
)
WorkbenchListRow.displayName = 'WorkbenchListRow'

const WorkbenchListRowTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  ({ type = 'button', className, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="workbench-list-row-trigger"
      className={cn(
        'flex min-h-[var(--chrome-control-md)] min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-1.5 text-left text-inherit outline-none focus-ring disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
WorkbenchListRowTrigger.displayName = 'WorkbenchListRowTrigger'

const WorkbenchListRowLeading = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="workbench-list-row-leading"
      className={cn(
        'flex size-[var(--chrome-control-sm)] shrink-0 items-center justify-center text-text-soft transition-colors duration-(--dur-fast) group-hover/workbench-row:text-foreground group-data-[active=true]/workbench-row:text-sidebar-foreground motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  ),
)
WorkbenchListRowLeading.displayName = 'WorkbenchListRowLeading'

function WorkbenchListRowText({
  title,
  description,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <span data-slot="workbench-list-row-text" className={cn('min-w-0 flex-1', className)}>
      <span
        data-slot="workbench-list-row-title"
        className="block truncate text-foreground group-data-[active=true]/workbench-row:text-sidebar-foreground"
      >
        {title}
      </span>
      {description != null && (
        <span
          data-slot="workbench-list-row-description"
          className="block truncate text-2xs text-text-faint"
        >
          {description}
        </span>
      )}
    </span>
  )
}

const WorkbenchListRowMeta = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="workbench-list-row-meta"
      className={cn('shrink-0 px-1.5 text-2xs text-text-faint', className)}
      {...props}
    />
  ),
)
WorkbenchListRowMeta.displayName = 'WorkbenchListRowMeta'

type WorkbenchListRowActionsProps = Omit<ComponentPropsWithoutRef<'div'>, 'aria-label'> & {
  'aria-label': string
  visibility?: 'always' | 'hover'
  /** Passive metadata that shares this slot with hover actions, without shifting the row. */
  fallback?: ReactNode
}

const WorkbenchListRowActions = forwardRef<HTMLDivElement, WorkbenchListRowActionsProps>(
  ({ visibility = 'always', fallback, children, className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="workbench-list-row-actions"
      data-visibility={visibility}
      role="group"
      className={cn(
        fallback != null && visibility === 'hover'
          ? 'group/workbench-actions ml-auto grid shrink-0 items-center'
          : 'ml-auto flex shrink-0 items-center gap-0.5',
        visibility === 'hover' &&
          fallback == null &&
          'lx-hover-actions opacity-0 transition-opacity duration-(--dur-fast) group-hover/workbench-row:opacity-100 group-focus-within/workbench-row:opacity-100 motion-reduce:transition-none',
        className,
      )}
      {...props}
    >
      {fallback == null || visibility === 'always' ? (
        children
      ) : (
        <>
          <span
            data-slot="workbench-list-row-action-fallback"
            className="lx-hover-actions-fallback pointer-events-none col-start-1 row-start-1 justify-self-end transition-opacity duration-(--dur-fast) group-hover/workbench-row:opacity-0 group-focus-within/workbench-row:opacity-0 group-has-[[data-state=open]]/workbench-actions:opacity-0 motion-reduce:transition-none"
          >
            {fallback}
          </span>
          <div
            data-slot="workbench-list-row-action-controls"
            className={cn(
              'col-start-1 row-start-1 flex items-center justify-self-end gap-0.5',
              visibility === 'hover' &&
                'lx-hover-actions pointer-events-none opacity-0 transition-opacity duration-(--dur-fast) group-hover/workbench-row:opacity-100 group-hover/workbench-row:pointer-events-auto group-focus-within/workbench-row:opacity-100 group-focus-within/workbench-row:pointer-events-auto group-has-[[data-state=open]]/workbench-actions:opacity-100 group-has-[[data-state=open]]/workbench-actions:pointer-events-auto motion-reduce:transition-none',
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  ),
)
WorkbenchListRowActions.displayName = 'WorkbenchListRowActions'

export {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowMeta,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
}
export type { WorkbenchListRowActionsProps, WorkbenchListRowProps }
