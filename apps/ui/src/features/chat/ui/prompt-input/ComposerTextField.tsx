import { lazy, Suspense, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'

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
  const { slash, slashArgs } = composer
  const completionActiveIndex =
    slash.isOpen && slash.filtered[slash.activeIndex]
      ? slash.activeIndex
      : slashArgs.isMenuOpen && slashArgs.options[slashArgs.activeIndex]
        ? slashArgs.activeIndex
        : openCommandActive && openResource.rows[openResource.activeIndex]
          ? openResource.activeIndex
          : atRef.isOpen && atRef.suggestions[atRef.activeIndex]
            ? atRef.activeIndex
            : null
  const completionOpen = slash.isOpen || slashArgs.isMenuOpen || openCommandActive || atRef.isOpen

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
        {slash.isOpen && (
          <SlashCommandMenu
            menuId={completionMenuId}
            commands={slash.filtered}
            query={slash.query}
            activeIndex={slash.activeIndex}
            onSelect={slash.handleSelect}
            onHover={slash.setActiveIndex}
          />
        )}
        {slashArgs.isMenuOpen && (
          <SlashArgMenu
            menuId={completionMenuId}
            options={slashArgs.options}
            activeIndex={slashArgs.activeIndex}
            onSelect={slashArgs.selectOption}
            onHover={slashArgs.setActiveIndex}
          />
        )}
        <Suspense fallback={null}>
          {openCommandActive && !slash.isOpen && !slashArgs.isMenuOpen && (
            <OpenResourceMenu model={openResource} menuId={completionMenuId} />
          )}
          {atRef.isOpen && !slash.isOpen && !slashArgs.isMenuOpen && !openCommandActive && (
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
