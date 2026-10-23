import { Fragment, type ReactNode } from 'react'

import { useActiveRowScroll } from './useActiveRowScroll'
import { MENU_ROW, SELECTED_ROW } from '@localixai/kit/selected-row'
import { ResultCountStatus } from '@localixai/mini-app-sdk/ui/result-count-status'
import {
  AutocompleteBody,
  AutocompleteHeader,
  AutocompleteOption,
  AutocompleteOptions,
  AutocompletePanel,
} from '@localixai/kit/autocomplete'
import { MenuGroupHeader } from '@localixai/kit/menu-entries'

export const COMPOSER_COMPLETION_MENU_ID = 'composer-completion-menu'
export const completionOptionId = (menuId: string, index: number) => `${menuId}-option-${index}`

export interface CompletionMenuSectionHeader {
  label: string
  divider?: boolean
}

/**
 * One completion row for {@link CompletionMenu}. Content is a caller-owned slot
 * (icon + label + description + trailing hint), so each menu keeps its own row
 * composition; the menu owns only the button FRAME, the keyboard-active styling
 * and the scroll-into-view mechanics.
 */
export interface CompletionMenuItem {
  /** Stable React key for the row. */
  key: string
  /** Absolute index into the flat list — drives active/hover selection. */
  index: number
  /** Headers that start a new accessible option group immediately before this row. */
  sectionHeaders?: CompletionMenuSectionHeader[]
  /** Row inner content (icon + label + description + trailing). */
  content: ReactNode
  /** Fired on click / Enter. */
  onSelect: () => void
}

interface CompletionMenuProps {
  id?: string
  items: CompletionMenuItem[]
  activeIndex: number
  onHover: (index: number) => void
  /** Sticky content above the rows (e.g. the @-ref filter tabs). */
  top?: ReactNode
  /** Content below the rows (spinner, in-band listing notices). */
  bottom?: ReactNode
  /** Shown in place of rows when the list is empty. */
  empty?: ReactNode
  /** Accessible name for the listbox. */
  label?: string
  singular?: string
  plural?: string
}

interface CompletionSection {
  key: string
  headers: CompletionMenuSectionHeader[]
  items: CompletionMenuItem[]
}

function groupItems(items: CompletionMenuItem[]): CompletionSection[] {
  const sections: CompletionSection[] = []
  for (const item of items) {
    if (sections.length === 0 || item.sectionHeaders?.length) {
      sections.push({ key: item.key, headers: item.sectionHeaders ?? [], items: [] })
    }
    sections.at(-1)?.items.push(item)
  }
  return sections
}

/**
 * CompletionMenu — the shared presentational surface behind the composer's
 * `/`-command and `@`-reference pickers. It renders the floating panel, the
 * keyboard-highlight scroll behaviour and the row frame; each menu supplies its
 * own trigger/data hooks, row content, headers, filter tabs, empty state and
 * notices via props/slots. Behaviour and look are identical to the hand-rolled
 * menus this replaced — the two can no longer drift apart.
 */
export function CompletionMenu({
  id = COMPOSER_COMPLETION_MENU_ID,
  items,
  activeIndex,
  onHover,
  top,
  bottom,
  empty,
  label = 'Composer suggestions',
  singular = 'suggestion',
  plural = 'suggestions',
}: CompletionMenuProps) {
  const { activeRef, markPointerNav } = useActiveRowScroll(activeIndex)
  const sections = groupItems(items)

  const renderOption = (item: CompletionMenuItem) => {
    const isActive = item.index === activeIndex
    return (
      <AutocompleteOption
        key={item.key}
        id={completionOptionId(id, item.index)}
        active={isActive}
        activeClassName={SELECTED_ROW}
        ref={isActive ? activeRef : undefined}
        onClick={item.onSelect}
        onMouseMove={() => {
          markPointerNav()
          onHover(item.index)
        }}
        className={MENU_ROW}
      >
        {item.content}
      </AutocompleteOption>
    )
  }

  return (
    <AutocompletePanel side="top" sideOffset={6}>
      {top && <AutocompleteHeader>{top}</AutocompleteHeader>}
      <ResultCountStatus count={items.length} singular={singular} plural={plural} />
      <AutocompleteBody>
        <AutocompleteOptions id={id} aria-label={label}>
          {sections.map((section) => {
            const options = section.items.map(renderOption)
            if (section.headers.length === 0) {
              return <Fragment key={section.key}>{options}</Fragment>
            }
            return (
              <div
                key={section.key}
                role="group"
                aria-label={section.headers.map((header) => header.label).join(' / ')}
              >
                {section.headers.map((header, index) => (
                  <MenuGroupHeader
                    key={`${header.label}:${index}`}
                    label={header.label}
                    divider={header.divider}
                  />
                ))}
                {options}
              </div>
            )
          })}
        </AutocompleteOptions>
        {items.length === 0 && empty}
        {bottom}
      </AutocompleteBody>
    </AutocompletePanel>
  )
}
