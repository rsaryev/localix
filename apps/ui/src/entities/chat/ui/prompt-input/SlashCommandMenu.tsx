import { SLASH_CATEGORIES, type SlashCategoryId } from '@localixai/api/slash-catalog'
import type { SlashArgSpec } from './SlashArgSpec'
import { CompletionKeyHint } from './CompletionKeyHint'
import { CompletionMenu, type CompletionMenuItem } from './CompletionMenu'
import { MatchedText } from '@localixai/kit/matched-text'
import { Chip } from '@localixai/kit/chip'
import { isFeaturedSlashCommand, matchSlashCommand } from './slashCommandMatch'

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description: string
  icon: React.ReactNode
  prefix?: string
  badge?: string
  /** Placeholder shown in the composer once this command is active. */
  placeholder?: string
  /** When true, the command takes no argument (composer stays empty, just Enter to run). */
  argless?: boolean
  /** 'skill' commands pin/warm into the session instead of inserting text. */
  kind?: 'builtin' | 'skill'
  skillName?: string
  /**
   * Which shared-catalog section this built-in belongs to. Drives the grouped
   * menu headers (Autonomous, Configuration, …). Absent for plugin/skill
   * commands, which are grouped under their own Plugins/Skills headers.
   */
  category?: SlashCategoryId
  /** Declarative positional arguments (choice/text) rendered as chips + menus. */
  args?: SlashArgSpec[]
  /** For a plugin command with DYNAMIC args — identity used to fetch their options. */
  argSource?: { app: string; command: string }
  /** Shown first, under "Suggested" (a plugin command's manifest `featured`). */
  featured?: boolean
  /**
   * A row that does something when chosen instead of inserting text (a plugin that waits for its
   * OK opens its Store page). It stands for the plugin named by its trigger, so it is offered
   * for `/<plugin>:<anything>` as well, and never becomes the composer's active command.
   */
  onChoose?: () => void
}

interface SlashCommandMenuProps {
  menuId?: string
  commands: SlashCommand[]
  /** The active fuzzy query (no leading `/`) — highlights the matched characters. */
  query: string
  activeIndex: number
  onSelect: (cmd: SlashCommand) => void
  onHover: (index: number) => void
}

const CATEGORY_LABEL: Record<SlashCategoryId, string> = Object.fromEntries(
  SLASH_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<SlashCategoryId, string>

/**
 * The section label a command renders under: its shared-catalog category
 * (Autonomous, Configuration, …), else Plugins for a plugin-declared command,
 * else Skills. Used to emit a group header when the label CHANGES between
 * adjacent rows — the same running-header pattern the `@`-menu (AtRefMenu) uses,
 * so the menu renders in the exact flat order the hook ranks (tier-first), and
 * arrow-key nav always lines up with the visual order.
 */
function groupLabelOf(cmd: SlashCommand): string {
  if (isFeaturedSlashCommand(cmd)) return 'Suggested'
  if (cmd.kind === 'skill') return 'Skills'
  if (cmd.id.startsWith('plugin:')) return 'Plugins'
  if (cmd.category) return CATEGORY_LABEL[cmd.category]
  return CATEGORY_LABEL[SLASH_CATEGORIES[0].id]
}

/**
 * The characters of the rendered `/trigger` to emphasise: the ones the ranker matched, so the
 * highlight shows why the row ranked where it did. A row that ranked on its TITLE lights nothing
 * in the trigger. Indices shift by one for the `/` drawn in front of the trigger.
 */
function triggerHighlight(query: string, cmd: SlashCommand): Set<number> | null {
  if (!query) return null
  const match = matchSlashCommand(query, cmd)
  if (match?.field !== 'trigger') return null
  return new Set(Array.from(match.positions, (i) => i + (cmd.trigger.startsWith('/') ? 0 : 1)))
}

export function SlashCommandMenu({
  menuId,
  commands,
  query,
  activeIndex,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  if (commands.length === 0) return null

  const labels = commands.map(groupLabelOf)
  // With a single distinct group the header adds no information — skip it to keep
  // the menu compact. Show headers once the list spans two or more sections.
  const showLabels = new Set(labels).size > 1

  // Render in the flat (already-ranked) order: `index: i` keeps keyboard nav in
  // lockstep with the visual order. A header rides on the first row whose section
  // label differs from the previous row's; row 0 always starts a section, so a
  // divider on every header past row 0 separates the groups (the first has none).
  const items: CompletionMenuItem[] = commands.map((cmd, i) => {
    const newSection = i === 0 || labels[i] !== labels[i - 1]
    return {
      key: cmd.id,
      index: i,
      sectionHeaders:
        showLabels && newSection ? [{ label: labels[i] ?? '', divider: i > 0 }] : undefined,
      onSelect: () => onSelect(cmd),
      content: (
        <>
          <span className="shrink-0 text-text-soft">{cmd.icon}</span>
          <span className="shrink-0 text-sm">
            <MatchedText
              text={`/${cmd.trigger}`}
              query={query}
              positions={triggerHighlight(query, cmd)}
              plainClassName="font-medium text-foreground"
              dimClassName="font-medium text-text-soft"
              matchClassName="font-semibold text-foreground"
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-soft">{cmd.description}</span>
          {cmd.badge && (
            <Chip tone="neutral" className="shrink-0 text-text-soft">
              {cmd.badge}
            </Chip>
          )}
          {i === activeIndex && <CompletionKeyHint hints={[{ key: '↵' }]} />}
        </>
      ),
    }
  })

  return <CompletionMenu id={menuId} items={items} activeIndex={activeIndex} onHover={onHover} />
}
