import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { MenuActionEntry, MenuEntry, MenuSubmenuEntry } from '@localixai/plugin-sdk/ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { MENU_FAMILIES as FAMILIES, type MenuFamilyName } from './menu-families'
import { MenuRowLabel, MenuTrailingCheck } from './menu-row-parts'
import { MENU_SHORTCUT } from './popover-surface'
import {
  isMenuHeader,
  isMenuSeparator,
  isMenuSubmenu,
  menuLevelNeedsGutter,
  normalizeMenuEntries,
} from './menu-model'
import { ChordHint } from '../keyboard/chord-hint'
import { LocalixBorderBeam, RECOMMENDED_BEAM_INTENSITY } from '../feedback/localix-border-beam'

/**
 * ONE walker over a described menu, rendered into either Radix family.
 *
 * A right-click menu and the same list under a kebab button are the same menu reached two ways —
 * the right model is one action list, with the host deciding the presentation. Radix does not:
 * `ContextMenu*` and `DropdownMenu*` are separate component families, and this file used to be two
 * near-identical recursive walkers with a comment excusing the copy. They drifted exactly where a
 * copy drifts — one spelled `danger` as bare `text-status-error`, the shared `tone="danger"` recipe
 * (which also tints the highlight) reached neither, and the API plugin's context menu lost the
 * treatment altogether while its dropdown kept it.
 *
 * Passing the family in as data (`menu-families.ts`) is the whole fix. Add an entry kind here and
 * both surfaces gain it.
 *
 * What the walker owns, and no call site may re-decide:
 *   - the SEAMS. Menus are built by spreading live data between literal separators, so an empty
 *     spread leaves a rule against the top edge or two rules in a row. `normalizeMenuEntries` is
 *     what lets a plugin write `[open, —, ...rows, —, ...actions]` and stop worrying;
 *   - the leading COLUMN. If anything in a level carries an icon, everything in that level is
 *     indented, so a list of branches reads as a column rather than a ragged edge; a check never
 *     claims it — `selected` and `checked` rows both end on theirs;
 *   - TRUNCATION. A menu row is one line; a long branch name shortens rather than widening the
 *     panel past the `max-w-80` its content class sets.
 */
export type { MenuFamilyName }

/**
 * Render a described menu into `family`'s components. Nests through submenus, so a plugin's
 * `items` group reads the same at any depth.
 *
 * Each row is a Radix menu control. An optional trailing action is a sibling control in a
 * presentation-only wrapper, so keyboard navigation reaches both actions independently.
 */
export function MenuEntries({
  entries,
  family,
}: {
  entries: readonly MenuEntry[]
  family: MenuFamilyName
}) {
  return <MenuLevel entries={normalizeMenuEntries(entries)} family={family} />
}

/**
 * One level of an already-normalised menu.
 *
 * Split from {@link MenuEntries} so normalisation runs ONCE per level rather than once per level
 * per depth: the recursion happens here, on entries a parent has already cleaned.
 */
function MenuLevel({ entries, family }: { entries: readonly MenuEntry[]; family: MenuFamilyName }) {
  const { Item, CheckboxItem, Label, Separator } = FAMILIES[family]
  const gutter = menuLevelNeedsGutter(entries)
  const closeLevel = useContext(CloseLevel)

  return (
    <>
      {entries.map((entry, index) => {
        if (isMenuSeparator(entry)) return <Separator key={`sep:${index}`} />
        if (isMenuHeader(entry))
          return <Label key={`head:${entry.header}:${index}`}>{entry.header}</Label>
        if (isMenuSubmenu(entry))
          return <Submenu key={entry.id} entry={entry} family={family} gutter={gutter} />

        // Radix closes the whole menu on select unless the event is prevented; a `keepOpen`
        // choice prevents it and steps back out of the submenu it was made in.
        const onSelect = (event: Event) => {
          if (entry.keepOpen) event.preventDefault()
          entry.onSelect()
          if (entry.keepOpen) closeLevel?.()
        }

        // Drawn exactly like a `selected` row — icon in front, check at the end (the item adds
        // it) — so the two choice kinds differ only in role, never in where their marks sit.
        if (entry.checked !== undefined) {
          const primary = (
            <CheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled}
              className={entry.trailingAction ? 'min-w-0 flex-1' : undefined}
              onSelect={onSelect}
            >
              <MenuRow entry={entry} gutter={gutter} />
            </CheckboxItem>
          )
          return entry.trailingAction ? (
            <MenuActionPair key={entry.id} action={entry.trailingAction} family={family}>
              {primary}
            </MenuActionPair>
          ) : (
            primary
          )
        }

        // The menu's expected next step wears the recommended Button's accent: a menu opened from
        // a recommended trigger otherwise dropped the mark exactly where the act has to be found.
        // `MENU_ITEM` is already `relative`, so the beam rides the row's own radius.
        const recommended = entry.recommended === true && !entry.disabled

        const primary = (
          <Item
            key={entry.id}
            disabled={entry.disabled}
            {...(recommended ? { 'data-recommended': true } : {})}
            className={entry.trailingAction ? 'min-w-0 flex-1' : undefined}
            tone={entry.danger ? 'danger' : 'default'}
            onSelect={onSelect}
            {...(entry.selected !== undefined
              ? { role: 'menuitemradio' as const, 'aria-checked': entry.selected }
              : {})}
          >
            <MenuRow entry={entry} gutter={gutter} />
            {entry.selected !== undefined ? <MenuTrailingCheck selected={entry.selected} /> : null}
            {recommended ? (
              <LocalixBorderBeam active variant="focus" intensity={RECOMMENDED_BEAM_INTENSITY} />
            ) : null}
          </Item>
        )
        return entry.trailingAction ? (
          <MenuActionPair key={entry.id} action={entry.trailingAction} family={family}>
            {primary}
          </MenuActionPair>
        ) : (
          primary
        )
      })}
    </>
  )
}

/** Two sibling menu controls: choosing the icon never invokes or closes the primary action. */
interface MenuActionPairProps {
  action: NonNullable<MenuActionEntry['trailingAction']>
  family: MenuFamilyName
  children: ReactNode
}
function MenuActionPair({ action, family, children }: MenuActionPairProps) {
  const { Item } = FAMILIES[family]
  const Icon = action.icon
  return (
    <div role="presentation" className="flex items-center gap-0.5">
      {children}
      <Item
        aria-label={action.label}
        role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={action.checked}
        disabled={action.disabled}
        className={cn(
          'size-(--chrome-control-md) shrink-0 justify-center p-0',
          action.checked && 'text-foreground [&_svg]:fill-current',
        )}
        onSelect={(event) => {
          event.preventDefault()
          action.onSelect()
        }}
      >
        <Icon aria-hidden="true" />
      </Item>
    </div>
  )
}

/**
 * Steps out of the submenu a `keepOpen` choice was made in; `null` at the root level.
 *
 * The defect it closes: a choice that kept the menu open left its submenu open too, so the
 * trigger's `hint` — the place the new answer shows — stayed hidden behind the list it came from.
 */
const CloseLevel = createContext<(() => void) | null>(null)

/**
 * One submenu, its open state held here so a `keepOpen` choice inside can close it.
 *
 * Focus goes back to the trigger as it closes: the focused row unmounts with its panel, and focus
 * left on `<body>` takes the arrow keys with it — the parent level stops answering the keyboard.
 */
function Submenu({
  entry,
  family,
  gutter,
}: {
  entry: MenuSubmenuEntry
  family: MenuFamilyName
  gutter: boolean
}) {
  const { Item, Sub, SubTrigger, SubContent } = FAMILIES[family]
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    trigger.current?.focus()
  }, [])
  return (
    <Sub open={open} onOpenChange={setOpen}>
      <SubTrigger ref={trigger} disabled={entry.disabled}>
        <MenuRow entry={entry} gutter={gutter} />
      </SubTrigger>
      <SubContent>
        {entry.items.length > 0 ? (
          <CloseLevel.Provider value={close}>
            <MenuLevel entries={entry.items} family={family} />
          </CloseLevel.Provider>
        ) : (
          // A chevron that opens onto nothing reads as a broken menu, so the empty case
          // says what is missing instead. Disabled: it is an answer, not a command.
          <Item disabled>{entry.emptyLabel ?? 'Nothing here yet'}</Item>
        )}
      </SubContent>
    </Sub>
  )
}

/**
 * The inside of one row: mark, label, trailing value.
 *
 * Shared by actions, checkboxes and submenu triggers so the three cannot drift on truncation or on
 * where their trailing text sits — the drift this file exists to prevent, one level down.
 *
 * A real flex column reserves the icon width on every row in the level. An absolute slot
 * depended on separately generated left padding and could overlap labels after a CSS update.
 * Selected and checked rows keep their independent trailing indicator.
 */
function MenuRow({
  entry,
  gutter,
}: {
  entry: MenuActionEntry | MenuSubmenuEntry
  gutter: boolean
}) {
  const Icon = entry.icon
  const hint = 'hint' in entry ? entry.hint : undefined
  const description = 'description' in entry ? entry.description : undefined
  const chordId = 'chordId' in entry ? entry.chordId : undefined
  return (
    <>
      {/* The column reserves physical space even when a row has no icon. */}
      {gutter && (
        <span
          data-slot="menu-leading-icon"
          aria-hidden="true"
          className="flex size-3.5 shrink-0 items-center justify-center text-text-soft"
        >
          {Icon ? <Icon aria-hidden="true" /> : null}
        </span>
      )}
      <MenuRowLabel label={entry.label} description={description} />
      {hint && (
        <span className={cn(MENU_SHORTCUT, 'max-w-32 truncate tracking-normal')}>{hint}</span>
      )}
      {chordId && <ChordHint commandId={chordId} />}
    </>
  )
}
