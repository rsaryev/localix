/**
 * The console action buttons — Run, Stop and the quiet toolbar actions — for the four consoles
 * (SQL console, SQL file panel, document console, KV console).
 *
 * Each console used to transcribe its own class string: a padding-sized button (`px-2.5 py-1`)
 * where every kit control takes its height from a rung, so the run bar's buttons sat a pixel
 * off every other `xs` control in the app; and Stop was drawn two ways — a labelled, filled
 * square in the SQL consoles, a bare unfilled icon in the document and KV consoles. These are
 * the kit `Button` at the `xs` rung, one look per role.
 *
 * Run is the `mono` fill, not `bg-accent`: under the glass theme `--accent` is a 6% foreground
 * veil, so a Run painted with it read as a ghost — the one primary action on the bar was the
 * faintest thing on it.
 */
import type { ComponentProps } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Spinner } from '@localixai/kit/spinner'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

type ButtonProps = ComponentProps<typeof Button>

/** The primary "run it" action. Shows a spinner while `running`. */
export function RunButton({
  running,
  label = 'Run',
  className,
  ...props
}: Omit<ButtonProps, 'children' | 'variant' | 'size'> & { running: boolean; label?: string }) {
  return (
    <Button size="xs" variant="mono" className={className} {...props}>
      {running ? <Spinner className="size-3" /> : <Play className="size-3" />}
      {label}
    </Button>
  )
}

/** Stop the running statement — the same labelled, filled square in every console. */
export function StopButton({
  className,
  title = 'Stop the running query',
  ...props
}: Omit<ButtonProps, 'children' | 'variant' | 'size'>) {
  return (
    <Button
      size="xs"
      variant="ghost"
      title={title}
      className={cn(
        'text-text-soft hover:border-status-error/60 hover:bg-transparent hover:text-status-error',
        className,
      )}
      {...props}
    >
      <Square className="size-3 fill-current" />
      Stop
    </Button>
  )
}

/** A quiet run-bar action (Format, Explain, History, Back…). */
export function ConsoleToolButton({ className, ...props }: Omit<ButtonProps, 'variant' | 'size'>) {
  return <Button size="xs" variant="ghost" className={cn('text-text-soft', className)} {...props} />
}
