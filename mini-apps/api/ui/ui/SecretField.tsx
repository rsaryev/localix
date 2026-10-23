/**
 * A credential field that can POINT at the vault instead of holding a value.
 *
 * Until now the only way to reference a stored secret was to know its key and type
 * `${secret:GITHUB_TOKEN}` by hand — which means knowing both the syntax and a key the browser is
 * deliberately never told. Typing a literal worked (it is vaulted on save), but that mints a NEW
 * key every time, so the same token ends up stored three times under three names and rotating it
 * fixes one request.
 *
 * So the field offers only the vault metadata exposed through the host capability. The capability
 * omits managed items that must stay opaque; this mini app merely adapts the returned `secret:KEY`
 * handle to the `${secret:KEY}` template syntax understood by API requests.
 *
 * Nothing new is exposed. The capability returns METADATA — keys, labels and references — never a value; the
 * value is resolved server-side at send time and has never been reachable from a browser.
 */

import { useState } from 'react'
import { KeyRound } from 'lucide-react'

import { Input } from '@localixai/kit/input'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { miniAppSecrets } from '@localixai/mini-app-sdk/ui/runtime'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** A value that is a pointer rather than a secret — shown as such, and safe to display. */
function isReference(value: string): boolean {
  return value.trim().startsWith('${secret:')
}

/** Convert a host vault handle into the interpolation syntax stored in API request fields. */
export function requestSecretReference(reference: string): string {
  const value = reference.trim()
  if (isReference(value)) return value
  return value.startsWith('secret:') ? `\${${value}}` : value
}

interface VaultChoice {
  key: string
  label: string
  reference: string
}

export function SecretField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  embedded = false,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  ariaLabel: string
  /** Render inside PairEditor's bordered table cell instead of drawing a second input border. */
  embedded?: boolean
}) {
  const [choices, setChoices] = useState<VaultChoice[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Loaded once when the menu is first opened rather than on mount: most requests never touch
  // auth, and a vault read per rendered request pane is a request nobody asked for.
  const load = () => {
    if (choices || failed) return
    void miniAppSecrets
      .listReferences()
      .then((secrets) => {
        setChoices(
          secrets
            .map((secret) => ({
              key: secret.key,
              label: secret.label || secret.key,
              reference: secret.reference,
            }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        )
      })
      .catch(() => setFailed(true))
  }

  const referenced = isReference(value)
  return (
    <div className={cn('flex items-center', embedded ? 'gap-0' : 'gap-1')}>
      <Input
        aria-label={ariaLabel}
        size="md"
        className={cn(
          'min-w-0 flex-1 font-mono text-xs',
          embedded && 'h-8 rounded-none border-0 bg-transparent shadow-none focus-ring',
          referenced && 'text-status-info',
        )}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <DropdownMenu onOpenChange={(open) => open && load()}>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label="Use a secret from the vault"
            tooltip="Use a secret from the vault"
            size={embedded ? 'xs' : 'sm'}
          >
            <KeyRound className={cn('size-3.5', referenced && 'text-status-info')} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 min-w-56 overflow-y-auto">
          <DropdownMenuLabel>Vault</DropdownMenuLabel>
          {failed ? (
            <DropdownMenuItem disabled>The vault could not be read</DropdownMenuItem>
          ) : choices === null ? (
            <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          ) : choices.length === 0 ? (
            <DropdownMenuItem disabled>No referenceable secrets yet</DropdownMenuItem>
          ) : (
            choices.map((choice) => (
              <DropdownMenuItem
                key={choice.key}
                onSelect={() => onChange(requestSecretReference(choice.reference))}
              >
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                <span className="ml-2 shrink-0 font-mono text-2xs text-text-faint">
                  {choice.key}
                </span>
              </DropdownMenuItem>
            ))
          )}
          {referenced && (
            <>
              <DropdownMenuSeparator />
              {/* Clearing writes an empty string, not the mask: the mask means "keep what is
                  stored", so reusing it here would make "stop using this secret" a no-op. */}
              <DropdownMenuItem onSelect={() => onChange('')}>Clear the reference</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Exported for the editor's hint line — a reference is worth saying out loud. */
export function secretFieldHint(value: string): string | null {
  if (isReference(value)) {
    return 'Resolved from the vault at send time. The value never reaches this browser.'
  }
  return null
}
