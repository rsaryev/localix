import { useEffect, useState } from 'react'
import { ShieldCheck, X, Trash2 } from 'lucide-react'
import { toast } from '@/shared/lib/notify'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { Spinner } from '@localixai/kit/spinner'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { ComposerChip } from '@localixai/kit/composer-chip'

/**
 * Composer context-bar chip listing what the user chose to "Always allow" for this session
 * (see RuntimeState.sessionAutoApprovedTools). It's the see-and-revoke counterpart to the
 * confirm HITL's "Always allow" grant: without it, granting is a one-way door for the session.
 * Renders nothing when the set is empty, so it only appears once something was granted. Each
 * grant can be revoked individually, or all at once — the server publishes
 * `session_permissions.updated`, so the chip refreshes itself from the firehose; we keep no
 * local copy of the set.
 *
 * An entry is a SCOPE, not a tool name: a command is remembered by its program (`bash(git)`),
 * a file approval by the path or folder the person picked (`read(/work/src/*)`). The strings are
 * rendered verbatim rather than relabelled — the scope is the thing being reviewed — and a
 * folder scope is long, so each row carries it whole in its tooltip.
 */
export function PermissionsChip({
  sessionId,
  tools,
}: {
  sessionId: string | null
  tools: string[]
}) {
  const [open, setOpen] = useState(false)
  /**
   * The revoke in flight, if any: `{ tool: name }` for one grant, `{ tool: null }`
   * for the clear-all action, `null` when idle. A shape rather than a magic string,
   * so no tool name can ever collide with the clear-all marker.
   */
  const [busy, setBusy] = useState<{ tool: string | null } | null>(null)

  /**
   * "Revoke all" lives inside this popup, so unmounting on empty tore the open popup out with
   * the chip — no exit animation, and focus dropped to `document.body`, because Radix cannot
   * return it to a trigger that no longer exists. The chip outlives its popup by one step:
   * mounted while open, closed by the effect once there is nothing left, removed on the render
   * after that.
   */
  const empty = !sessionId || tools.length === 0
  useEffect(() => {
    if (empty && open) setOpen(false)
  }, [empty, open])
  if (empty && !open) return null
  if (!sessionId) return null

  // No success row: the revoked tool leaves this list (and the chip goes with the last one) in
  // front of the person who clicked, and the Event Center keeps rows — an echo would outlive it.
  const revoke = async (toolName: string | undefined) => {
    if (busy) return
    setBusy({ tool: toolName ?? null })
    try {
      await backendClient.revokeSessionPermission(sessionId, toolName)
    } catch (err) {
      toast.error('Could not revoke the permission', {
        description: errorMessage(err, '') || undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ComposerChip
          title={`${tools.length} permission${tools.length === 1 ? '' : 's'} auto-approved this session — click to review or revoke`}
          aria-label={`${tools.length} ${tools.length === 1 ? 'permission' : 'permissions'} auto-approved this session`}
        >
          <ShieldCheck className="size-3.5 shrink-0 text-status-warning opacity-90" />
          <span className="truncate font-medium">{tools.length} auto-approved</span>
        </ComposerChip>
      </PopoverTrigger>
      <PopoverContent layout="structured" align="start" side="top" className="w-72">
        <PopoverHeader>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-status-warning" aria-hidden="true" />
            <PopoverTitle>Always allow</PopoverTitle>
          </div>
          <PopoverDescription>
            These run without asking for the rest of this session. A command is remembered by its
            program, so `bash(git)` covers git and nothing else; a folder such as
            `read(/work/src/*)` covers everything inside it. Revoke one to make it prompt again. A
            restart re-asks.
          </PopoverDescription>
        </PopoverHeader>

        <PopoverBody className="max-h-56 p-1.5">
          {tools.map((tool) => (
            <div
              key={tool}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
            >
              <span className="flex-1 truncate font-mono text-2xs text-text-strong" title={tool}>
                {tool}
              </span>
              <IconButton
                size="xs"
                tone="danger"
                aria-label={`Revoke ${tool}`}
                tooltip={`Revoke ${tool}`}
                aria-busy={busy?.tool === tool}
                onClick={() => {
                  void revoke(tool)
                }}
                disabled={busy !== null}
                className="shrink-0 rounded-sm"
              >
                {busy?.tool === tool ? <Spinner /> : <X />}
              </IconButton>
            </div>
          ))}
        </PopoverBody>

        {tools.length > 1 && (
          <PopoverFooter role="group" aria-label="Permission actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void revoke(undefined)
              }}
              disabled={busy !== null}
              aria-busy={busy?.tool === null}
              className="w-full justify-start text-text-soft hover:text-foreground"
            >
              {busy?.tool === null ? <Spinner /> : <Trash2 className="opacity-70" />}
              Revoke all
            </Button>
          </PopoverFooter>
        )}
      </PopoverContent>
    </Popover>
  )
}
