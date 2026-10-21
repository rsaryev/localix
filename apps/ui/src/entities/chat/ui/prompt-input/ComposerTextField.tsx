import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { Autocomplete, AutocompleteAnchor } from '@localixai/kit/autocomplete'

import { CommandChipPrefix } from './CommandChipPrefix'
import { completionOptionId } from './CompletionMenu'
import { SlashArgMenu } from './SlashArgMenu'
import { SlashCommandMenu } from './SlashCommandMenu'
import { TextArea } from './TextArea'
import type { useAtRefAutocomplete } from './useAtRefAutocomplete'
import type { ComposerCommands } from './useComposerCommands'
import type { useOpenResourceCommand } from './useOpenResourceCommand'

// Completion providers and their icon catalogs are interaction-only. Dynamic
// imports still resolve from the packaged app, so opening them remains offline.
const AtRefMenu = lazy(() =>
  import('./AtRefMenu').then(({ AtRefMenu }) => ({ default: AtRefMenu })),
)
const OpenResourceMenu = lazy(() =>
  import('./OpenResourceMenu').then(({ OpenResourceMenu }) => ({ default: OpenResourceMenu })),
)

/**
 * The composer's text field and the four completion menus that can own it: slash commands,
 * slash arguments, `/open` resources and @-references.
 *
 * At most one menu is open, in that precedence, and the textarea's ARIA state
 * (`aria-activedescendant`) must name an option of THAT menu — so which menu is open and which
 * of its options is active are decided here, in one place, rather than by each menu.
 */
export function ComposerTextField(props: {
  composer: ComposerCommands
  atRef: ReturnType<typeof useAtRefAutocomplete>
  openResource: ReturnType<typeof useOpenResourceCommand>
  openCommandActive: boolean
  completionMenuId: string
  suggestionGhost: string | undefined
  placeholder: string
  disabled: boolean
  /** DOM focus of this text field. */
  focused: boolean
  /** Whether this composer's surface is the visible, active one (a collapsed surface is not). */
  surfaceActive: boolean
  highlight: ((value: string) => ReactNode) | undefined
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFocusChange: (focused: boolean) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  onSubmit: () => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean | void
  onCaretChange: (atEnd: boolean, offset: number, text: string) => void
}) {
  const { composer, atRef, openResource, openCommandActive, completionMenuId } = props
  const [windowActive, setWindowActive] = useState(() => document.hasFocus())
  useEffect(() => {
    // Native windows can retain their active textarea after losing OS focus.
    const activate = () => setWindowActive(true)
    const deactivate = () => setWindowActive(false)
    window.addEventListener('focus', activate)
    window.addEventListener('blur', deactivate)
    return () => {
      window.removeEventListener('focus', activate)
      window.removeEventListener('blur', deactivate)
    }
  }, [])
  const { slash, slashArgs } = composer
  // One menu at a time, and only at the composer the user is typing in: drafts are shared between
  // mounted composers, so every mounted composer sees the same open completion state.
  const menu =
    !props.focused || !props.surfaceActive || !windowActive || props.disabled
      ? null
      : slash.isOpen
        ? { kind: 'slash' as const, index: slash.activeIndex, rows: slash.filtered.length }
        : slashArgs.isMenuOpen || slashArgs.valueHint
          ? { kind: 'args' as const, index: slashArgs.activeIndex, rows: slashArgs.options.length }
          : openCommandActive
            ? {
                kind: 'open' as const,
                index: openResource.activeIndex,
                rows: openResource.rows.length,
              }
            : atRef.isOpen
              ? { kind: 'at' as const, index: atRef.activeIndex, rows: atRef.suggestions.length }
              : null
  const completionOpen = menu !== null
  const completionActiveIndex = menu && menu.index < menu.rows ? menu.index : null

  return (
    <div
      className="relative"
      onPaste={(event) => {
        props.onPaste(event)
        if (event.defaultPrevented) return
        const text = event.clipboardData.getData('text/plain')
        if (slash.acceptPastedCommand(text)) event.preventDefault()
      }}
    >
      {/* Completion state machines own close/selection; this root owns only
          collision-aware placement and the portal so ARIA state cannot drift. */}
      <Autocomplete open={completionOpen}>
        {menu?.kind === 'slash' && (
          <SlashCommandMenu
            menuId={completionMenuId}
            commands={slash.filtered}
            query={slash.query}
            activeIndex={slash.activeIndex}
            onSelect={slash.handleSelect}
            onHover={slash.setActiveIndex}
          />
        )}
        {menu?.kind === 'args' && (
          <SlashArgMenu
            menuId={completionMenuId}
            options={slashArgs.options}
            activeIndex={slashArgs.activeIndex}
            onSelect={slashArgs.selectOption}
            onHover={slashArgs.setActiveIndex}
            hint={slashArgs.valueHint}
          />
        )}
        <Suspense fallback={null}>
          {menu?.kind === 'open' && (
            <OpenResourceMenu model={openResource} menuId={completionMenuId} />
          )}
          {menu?.kind === 'at' && (
            <AtRefMenu
              menuId={completionMenuId}
              suggestions={atRef.suggestions}
              activeIndex={atRef.activeIndex}
              query={atRef.query}
              onSelect={atRef.accept}
              onHover={atRef.setActiveIndex}
              pending={atRef.pending}
              emptyLabel={atRef.emptyLabel}
              notices={atRef.notices}
              showFilters={atRef.showFilters}
              filter={atRef.filter}
              onFilterChange={atRef.setFilter}
            />
          )}
        </Suspense>
        <AutocompleteAnchor asChild>
          <div>
            <TextArea
              ariaLabel="Message"
              onCompositionStart={props.onCompositionStart}
              onCompositionEnd={props.onCompositionEnd}
              value={composer.textValue}
              onChange={composer.onTextChange}
              onFocus={() => props.onFocusChange(true)}
              onBlur={() => props.onFocusChange(false)}
              onSubmit={props.onSubmit}
              onKeyDown={props.onKeyDown}
              onCaretChange={props.onCaretChange}
              placeholder={
                // A visible ghost suggestion stands in for the placeholder — hide
                // it so the two don't overprint on an empty composer.
                props.suggestionGhost
                  ? ''
                  : (composer.commandPlaceholder ??
                    (slash.detected
                      ? `Argument for /${slash.detected.command.trigger}…`
                      : props.placeholder))
              }
              disabled={props.disabled}
              prefix={<CommandChipPrefix slash={slash} slashArgs={slashArgs} />}
              highlight={props.highlight}
              completion={{
                open: completionOpen,
                menuId: completionMenuId,
                activeOptionId:
                  completionActiveIndex !== null
                    ? completionOptionId(completionMenuId, completionActiveIndex)
                    : undefined,
              }}
            />
          </div>
        </AutocompleteAnchor>
      </Autocomplete>
    </div>
  )
}
