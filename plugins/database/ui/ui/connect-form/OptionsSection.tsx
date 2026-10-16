/** The store-password-as-secret checkbox/hint + the collapsed Options block
 *  (read-only guard-rail + connection color). */
import { Ban, ChevronRight, Lock } from 'lucide-react'
import { Checkbox } from '@localixai/kit/checkbox'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DATABASE_DRIVER_CATALOG } from '../../../shared/driver-catalog'
import {
  CONNECTION_COLORS,
  CONNECTION_COLOR_LABEL,
  connectionDotClass,
} from '../../model/connectionColor'
import type { ConnectFormState } from './useConnectForm'

export function OptionsSection({
  f,
  expanded = false,
}: {
  f: ConnectFormState
  expanded?: boolean
}) {
  const capabilities = DATABASE_DRIVER_CATALOG[f.dialect].capabilities
  const showOptions = expanded || f.showOptions
  return (
    <>
      {f.canStoreSecret && (
        <label
          className="mt-2 flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
          title="The saved config keeps only a ${secret:…} token, never the raw password."
        >
          <Checkbox checked={f.storeSecret} onChange={(e) => f.setStoreSecret(e.target.checked)} />
          <span>Store the password as a secret</span>
        </label>
      )}
      {f.isNetwork && !f.canStoreSecret && (
        <p className="mt-1.5 text-2xs text-text-faint">
          Reference a secret with <code className="text-text-soft">{'${secret:KEY}'}</code> — set
          keys in Settings → Secrets.
        </p>
      )}

      {/* Options (read-only + color) — collapsed by default so the form stays calm. */}
      <div className={expanded ? 'mt-0' : 'mt-2.5'}>
        {!expanded && (
          <button
            type="button"
            onClick={() => f.setShowOptions((s) => !s)}
            className="flex items-center gap-1 rounded-sm text-2xs text-text-soft outline-none transition-colors hover:text-foreground focus-ring"
          >
            <ChevronRight
              className={cn('size-3 transition-transform', f.showOptions && 'rotate-90')}
            />
            Options
            {!f.showOptions && (f.readonly || f.color) && (
              <span className="text-text-faint">
                {f.readonly ? ' · Read-only' : ''}
                {f.color ? ` · ${CONNECTION_COLOR_LABEL[f.color]}` : ''}
              </span>
            )}
          </button>
        )}
        {showOptions && (
          <div className="mt-2 space-y-2.5 border-l border-border pl-3">
            {capabilities.rowEditing && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-soft"
                title="Block writes (INSERT/UPDATE/DELETE/DDL) — a safety guard-rail, not a database permission."
              >
                <Checkbox checked={f.readonly} onChange={(e) => f.setReadonly(e.target.checked)} />
                <Lock className="size-2.5 text-text-faint" />
                <span className="font-medium text-foreground">Read-only</span>
                <span className="text-text-faint">— block writes on this connection</span>
              </label>
            )}
            <div className="flex items-center gap-2">
              <label className="text-2xs text-text-soft">Color</label>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => f.setColor(undefined)}
                  title="None"
                  aria-label="No color"
                  aria-pressed={!f.color}
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full border text-text-faint outline-none transition-colors focus-ring',
                    !f.color
                      ? 'border-foreground/60'
                      : 'border-border hover:border-control-border-hover',
                  )}
                >
                  <Ban className="size-2.5" />
                </button>
                {CONNECTION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => f.setColor(c)}
                    title={CONNECTION_COLOR_LABEL[c]}
                    aria-label={CONNECTION_COLOR_LABEL[c]}
                    aria-pressed={f.color === c}
                    className={cn(
                      'size-4 rounded-full outline-none ring-offset-1 ring-offset-background transition-shadow focus-ring',
                      connectionDotClass(c),
                      f.color === c
                        ? 'ring-2 ring-foreground/70'
                        : 'hover:ring-2 hover:ring-border-strong',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
