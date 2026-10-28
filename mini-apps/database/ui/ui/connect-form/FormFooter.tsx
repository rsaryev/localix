/** Error line, the trust-certificate recovery action, and the Cancel/Test/Connect row. */
import { AlertCircle, Check, Plug, ShieldCheck, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Spinner } from '@localixai/kit/spinner'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { ConnectFormState } from './useConnectForm'

export function FormFooter({
  f,
  isEdit,
  onCancel,
  variant = 'compact',
}: {
  f: ConnectFormState
  isEdit: boolean
  onCancel?: () => void
  variant?: 'compact' | 'workspace'
}) {
  return (
    <>
      {f.error && (
        <div role="alert" className="mt-2 flex items-start gap-1.5 text-2xs text-status-error">
          <AlertCircle className="mt-px size-3 shrink-0" />
          <span>{f.error}</span>
        </div>
      )}
      {/* Targeted recovery for a TLS/cert failure (field mode): one click to trust a
          self-signed server cert and re-test — the common local/internal-DB case. */}
      {f.errorCode === 'tls_failed' && f.isNetwork && (
        <Button
          variant="ghost"
          size="xs"
          onClick={f.trustCertAndRetry}
          disabled={f.testing || f.busy}
          title="Set the connection to accept a self-signed / untrusted certificate, then test again"
          className="mt-2 text-text-soft"
        >
          <ShieldCheck data-icon="inline-start" aria-hidden className="size-3" />
          Trust server certificate & retry
        </Button>
      )}
      <div
        className={cn(
          'flex items-center gap-1.5',
          variant === 'compact' ? 'mt-3' : 'mt-2 justify-end',
        )}
      >
        {!f.error && f.configIssue && variant === 'workspace' && (
          <span className="mr-auto text-2xs text-text-faint">{f.configIssue}</span>
        )}
        {onCancel && (
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={f.busy || f.testing}
            className="text-text-soft"
          >
            <X data-icon="inline-start" aria-hidden className="size-3.5" />
            Cancel
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => void f.test()}
          disabled={f.busy || f.testing || !f.config}
          aria-busy={f.testing || undefined}
          aria-live="polite"
          title="Validate the connection without saving it"
          className={cn(
            f.testOk === true
              ? 'border-status-success/50 text-status-success hover:bg-status-success/10 hover:text-status-success'
              : f.testOk === false
                ? 'border-status-error/50 text-status-error hover:bg-status-error/10 hover:text-status-error'
                : 'text-text-soft',
          )}
        >
          {f.testing ? (
            <Spinner className="size-3.5" />
          ) : f.testOk === true ? (
            <Check data-icon="inline-start" aria-hidden className="size-3.5" />
          ) : f.testOk === false ? (
            <AlertCircle data-icon="inline-start" aria-hidden className="size-3.5" />
          ) : (
            <Plug data-icon="inline-start" aria-hidden className="size-3.5" />
          )}
          {f.testing ? 'Testing…' : f.testOk === true ? 'Connected' : 'Test'}
        </Button>
        <Button
          onClick={() => void f.submit()}
          disabled={f.busy || f.testing || !f.config}
          aria-busy={f.busy || undefined}
          className={variant === 'compact' ? 'flex-1' : 'min-w-28'}
        >
          {f.busy ? (
            <Spinner className="size-3.5" />
          ) : isEdit ? (
            <Check data-icon="inline-start" aria-hidden className="size-3.5" />
          ) : (
            <Plug data-icon="inline-start" aria-hidden className="size-3.5" />
          )}
          {isEdit ? 'Save changes' : 'Connect'}
        </Button>
      </div>
      {!isEdit && variant === 'compact' && (
        <p className="mt-2.5 text-2xs leading-relaxed text-text-faint">
          Everything runs on the backend — the browser never touches the database directly.
        </p>
      )}
    </>
  )
}
