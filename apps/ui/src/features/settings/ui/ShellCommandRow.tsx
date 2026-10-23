import { useEffect, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { shellCommandApi, type ShellCommandStatusDto } from '@/shared/api/shell-command-client'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { SettingsRow } from './SettingsScaffold'

/**
 * "Install the `localix` command" — a PATH install. Reflects live
 * status (installed / stale / not-installed) and, when installed but its bin dir
 * isn't on PATH, tells the user which dir to add.
 */
export function ShellCommandRow() {
  const workItemVisible = useWorkItemVisible()
  const [status, setStatus] = useState<ShellCommandStatusDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'install' | 'uninstall' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workItemVisible) return
    setLoading(true)
    setError(null)
    shellCommandApi
      .status()
      .then(setStatus)
      .catch((caught) => setError(inlineFailure(caught, 'Could not check the command status.')))
      .finally(() => setLoading(false))
  }, [workItemVisible])

  const run = async (action: 'install' | 'uninstall') => {
    setBusyAction(action)
    setError(null)
    try {
      setStatus(await shellCommandApi[action]())
    } catch (e) {
      setError(inlineFailure(e, `Could not ${action} the localix command.`))
    } finally {
      setBusyAction(null)
    }
  }

  const installed = status?.state === 'installed' || status?.state === 'stale'
  const unavailable = status != null && !status.available

  const summary = !status
    ? 'Command status is unavailable.'
    : unavailable
      ? 'Unavailable in this runtime. Portable Linux AppImage builds cannot install a durable launcher; use the .deb package.'
      : status.state === 'installed'
        ? 'Installed.'
        : status.state === 'stale'
          ? 'Installed, but points at an old location — reinstall to refresh.'
          : 'Not installed.'

  return (
    <SettingsRow className="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
      <div className="space-y-0.5">
        <p className="text-sm text-foreground">
          Install the <span className="font-mono text-xs">localix</span> command
        </p>
        {loading ? (
          <ActivitySignal
            label="Checking command status"
            className="max-w-prose text-xs leading-5 text-text-soft text-pretty"
          />
        ) : (
          <p className="max-w-prose text-xs leading-5 text-text-soft text-pretty">
            {summary}{' '}
            {status && !unavailable && (
              <>
                Then run <span className="font-mono text-xs">localix .</span> or{' '}
                <span className="font-mono text-xs">localix &lt;file&gt;</span> to open it here.
              </>
            )}
          </p>
        )}
        {status && installed && !status.onPath && (
          <p className="text-xs leading-5 text-status-warning">
            Add <span className="font-mono text-xs">{status.binDir}</span> to your PATH to use it.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs leading-5 text-status-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {installed && (
          <Button
            variant="outline"
            size="xl"
            aria-busy={busyAction === 'uninstall' || undefined}
            disabled={busyAction !== null}
            onClick={() => {
              void run('uninstall')
            }}
          >
            {busyAction === 'uninstall' ? (
              <ActivitySignal label="Removing" className="text-sm" labelClassName="min-w-0" />
            ) : (
              'Uninstall'
            )}
          </Button>
        )}
        <Button
          variant="outline"
          size="xl"
          aria-busy={busyAction === 'install' || undefined}
          disabled={busyAction !== null || unavailable || !status}
          onClick={() => {
            void run('install')
          }}
        >
          {busyAction === 'install' ? (
            <ActivitySignal label="Installing" className="text-sm" labelClassName="min-w-0" />
          ) : status?.state === 'installed' ? (
            'Reinstall'
          ) : (
            'Install'
          )}
        </Button>
      </div>
    </SettingsRow>
  )
}
