import { useContext, useState, type ReactNode } from 'react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Kbd } from '@localixai/kit/kbd'
import { Select } from '@localixai/kit/select'
import { Textarea } from '@localixai/kit/textarea'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { ModAction } from '@/shared/api/modsApi'
import { ModActionBarContext, ModControlContext, ModSiteContext } from './modSite'
import { buttonLook } from './modStyle'

/**
 * A mod's controls, drawn with the kit's own. A Button's label is its `label`, else its children;
 * its `hotkey` shows as the kit's keycap after the label (the site presses it: `siteHotkeys.ts`);
 * `plain` draws it as a list row, `variant: 'primary'` as the main action, `dimColor` quiet. A
 * label is the UI's own type even where the site draws a mod's text in the code face. `autoFocus`
 * marks where the site's focus starts when it takes the keyboard (`data-autofocus`).
 */

type Act = (action: ModAction) => void

/** A prop as text: what a mod passes as a string or number, never an object's `[object Object]`. */
export const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback

const autoFocusOf = (props: Record<string, unknown>) =>
  props.autoFocus === true ? { 'data-autofocus': '' } : {}

export function ModButton(input: {
  props: Record<string, unknown>
  children: ReactNode
  hasChildren: boolean
  act: Act
}) {
  const { props } = input
  const look = buttonLook(props, useContext(ModSiteContext), useContext(ModActionBarContext))
  const hotkey = typeof props.hotkey === 'string' ? props.hotkey : undefined
  const label = typeof props.label === 'string' ? props.label : undefined
  return (
    <Button
      size={look.size}
      variant={look.variant}
      className={cn(
        'font-normal',
        // A plain button is a row: full width, its label at the start, its key at the end.
        look.row && 'w-full justify-start gap-2 text-left',
        look.quiet && 'text-text-soft hover:text-foreground',
      )}
      aria-keyshortcuts={hotkey}
      {...autoFocusOf(props)}
      onClick={() => input.act({ kind: 'press', element: text(props.key) })}
    >
      <span className="min-w-0 truncate">
        <ModControlContext.Provider value={true}>
          {label ?? (input.hasChildren ? input.children : '')}
        </ModControlContext.Provider>
      </span>
      {hotkey && <Kbd className={cn(look.row && 'ml-auto')}>{hotkey}</Kbd>}
    </Button>
  )
}

/** Each change is sent as `ui.input` of kind `change`, as it is typed; Enter submits the text. */
export function ModInput(input: { element: string; props: Record<string, unknown>; act: Act }) {
  const { props } = input
  const [value, setValue] = useState(text(props.value))
  const rows = typeof props.rows === 'number' && props.rows > 1 ? Math.min(props.rows, 40) : 1
  const label = typeof props.label === 'string' ? props.label : undefined
  const field = {
    'aria-label': label ?? input.element,
    placeholder: typeof props.placeholder === 'string' ? props.placeholder : undefined,
    value,
    ...autoFocusOf(props),
  }
  const change = (next: string) => {
    setValue(next)
    input.act({ kind: 'change', element: input.element, value: next })
  }
  const submit = () => input.act({ kind: 'submit', element: input.element, value })
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {label && <span className="shrink-0 text-xs text-text-soft">{label}</span>}
      {rows > 1 ? (
        <Textarea
          {...field}
          rows={rows}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits, as in the terminal; Shift+Enter is a new line.
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            submit()
          }}
        />
      ) : (
        <Input {...field} onChange={(event) => change(event.target.value)} />
      )}
      {typeof props.submitLabel === 'string' && (
        <Button size="sm" type="submit">
          {props.submitLabel}
        </Button>
      )}
    </form>
  )
}

export function ModSelect(input: { props: Record<string, unknown>; act: Act }) {
  const { props } = input
  const label = typeof props.label === 'string' ? props.label : undefined
  return (
    <div className="flex items-center gap-2" {...autoFocusOf(props)}>
      {label && <span className="shrink-0 text-xs text-text-soft">{label}</span>}
      <Select
        aria-label={label ?? text(props.key)}
        value={text(props.value)}
        onValueChange={(value) => input.act({ kind: 'select', element: text(props.key), value })}
        options={optionsOf(props.options)}
      />
    </div>
  )
}

function optionsOf(value: unknown): { value: string; label: string }[] {
  if (!Array.isArray(value)) return []
  return value.map((option) =>
    typeof option === 'string'
      ? { value: option, label: option }
      : {
          value: text((option as { value?: unknown }).value),
          label: text(
            (option as { label?: unknown }).label,
            text((option as { value?: unknown }).value),
          ),
        },
  )
}
