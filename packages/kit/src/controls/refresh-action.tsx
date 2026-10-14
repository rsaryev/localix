import type { ComponentProps } from 'react'
import { RefreshCw } from 'lucide-react'
import { IconButton } from './icon-button'
import { Spinner } from '../feedback/spinner'

type RefreshActionProps = Omit<ComponentProps<typeof IconButton>, 'children'> & {
  /** Shows progress while the owner refreshes; callers decide whether another refresh is allowed. */
  busy?: boolean
}

/** One control size and progress glyph for refresh actions across workbench panels. */
export function RefreshAction({ busy = false, size = 'sm', ...props }: RefreshActionProps) {
  return (
    <IconButton size={size} {...props} aria-busy={busy}>
      {busy ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
    </IconButton>
  )
}
