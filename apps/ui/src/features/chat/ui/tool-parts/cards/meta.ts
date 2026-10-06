import {
  FileText,
  Gauge,
  Image as ImageIcon,
  Search,
  FilePen,
  FilePlus,
  Terminal,
  SquareTerminal,
  Brain,
  History,
  BookOpen,
  MessageCircleQuestion,
  Plug,
  Wrench,
  Bot,
  RefreshCw,
  MousePointerClick,
  Globe,
  TextSearch,
  ListTree,
  MessageSquareDashed,
  SlidersHorizontal,
  KeyRound,
  ClipboardList,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ToolCardContribution } from '@localixai/plugin-sdk/ui'
import { TOOL, type ToolName } from '@localixai/api/tool-names'
import { isAlwaysStandaloneToolName } from '@localixai/api/item-format'
import { toolCardFor } from '@/shared/contrib/toolCards'

/**
 * Presentation metadata for tool-backed items, keyed by TOOL NAME (the name the
 * model called — `item.name`, present on every tool-backed item regardless of
 * its specialized type). Pure data — card components live in `registry.tsx` so
 * this module stays import-light for helpers (verbs and stacking).
 *
 * Adding a tool: one entry here (+ a card in `registry.tsx` if it needs rich UI).
 */
export interface ToolMeta {
  /** Imperative label, e.g. "Read", "Searched" — used in stacked summaries. */
  label: string
  /** Plural noun for aggregated counts, e.g. "files", "searches". */
  noun: string
  /** Present-participle verb for live state, e.g. "Reading". */
  verb: string
  icon: ComponentType<{ className?: string }>
  /**
   * When true, a run of consecutive identical calls collapses into one summary
   * row. Reserved for high-frequency, low-signal data/file ops. Interactive or
   * visually rich tools and interactive surfaces never stack.
   */
  stackable: boolean
  /**
   * When true, the tool is a pure exploration op (file read, search/grep,
   * code lookup). Runs of 2+ CONSECUTIVE COMPLETED read-only calls — even of
   * different tools — fold into one summary row ("Explored 5 locations");
   * see `cards/stacking.ts`. Never set on tools that mutate anything.
   */
  readOnly?: boolean
}

/**
 * A name that is NOT in the server's `TOOL` map and never can be — with the reason.
 * `absentBecause` is REQUIRED: "absent by design" must be a stated, reviewable claim,
 * never the silent gap that let five real tools ship as unlabeled wrenches.
 */
interface NonCoreMeta extends ToolMeta {
  absentBecause: string
}

/**
 * The CORE vocabulary — every tool the SERVER owns (`TOOL`, agent-core/tool-names.ts).
 *
 * Keyed on `ToolName`, so this map is EXHAUSTIVE BY CONSTRUCTION: a built-in added
 * server-side with no entry here fails `bun run type-check`. Before that key type, this
 * was a `Record<string, …>` hand-shadow of the server's map and could silently drift.
 */
const CORE_META: Record<ToolName, ToolMeta> = {
  external_agent_sessions: {
    label: 'Agent history',
    noun: 'sessions',
    verb: 'Reading',
    icon: History,
    stackable: true,
    readOnly: true,
  },
  read: {
    label: 'Read',
    noun: 'files',
    verb: 'Reading',
    icon: FileText,
    stackable: true,
    readOnly: true,
  },
  view_image: {
    label: 'Viewed',
    noun: 'images',
    verb: 'Viewing image',
    icon: ImageIcon,
    stackable: true,
    readOnly: true,
  },
  context_budget: {
    label: 'Checked budget',
    noun: 'checks',
    verb: 'Checking context budget',
    icon: Gauge,
    stackable: true,
    readOnly: true,
  },
  search: {
    label: 'Searched',
    noun: 'searches',
    verb: 'Searching',
    icon: Search,
    stackable: true,
    readOnly: true,
  },
  write: {
    label: 'Wrote',
    noun: 'files',
    verb: 'Writing',
    icon: FilePlus,
    stackable: true,
  },
  edit: {
    label: 'Edited',
    noun: 'edits',
    verb: 'Editing',
    icon: FilePen,
    stackable: true,
  },
  apply_patch: {
    label: 'Patched',
    noun: 'patches',
    verb: 'Patching',
    icon: FilePen,
    stackable: true,
  },
  bash: {
    label: 'Ran',
    noun: 'commands',
    verb: 'Running',
    icon: Terminal,
    stackable: false,
  },
  memory: {
    label: 'Memory',
    noun: 'notes',
    verb: 'Remembering',
    icon: Brain,
    stackable: true,
  },
  history_search: {
    label: 'History',
    noun: 'lookups',
    verb: 'Searching history',
    icon: History,
    stackable: true,
  },
  tool_output: {
    label: 'Tool output',
    noun: 'output lookups',
    verb: 'Inspecting output',
    icon: TextSearch,
    stackable: true,
  },
  mcp_resources: {
    label: 'MCP resources',
    noun: 'lookups',
    verb: 'Reading MCP resources',
    icon: ListTree,
    stackable: true,
  },
  vault: {
    label: 'Vault',
    noun: 'vault actions',
    verb: 'Managing vault',
    icon: KeyRound,
    stackable: false,
  },
  skill: {
    label: 'Skill',
    noun: 'skills',
    verb: 'Running skill',
    icon: BookOpen,
    stackable: true,
  },
  ask: {
    label: 'Asked',
    noun: 'questions',
    verb: 'Asking',
    icon: MessageCircleQuestion,
    stackable: false,
  },
  browser: {
    label: 'Browser',
    noun: 'actions',
    verb: 'Controlling browser',
    icon: MousePointerClick,
    stackable: false,
  },
  jobs: {
    label: 'Jobs',
    noun: 'jobs',
    verb: 'Checking jobs',
    icon: Terminal,
    stackable: true,
  },
  // Child task management — list / message / wait / close. Stackable
  // because these are cheap bookkeeping calls a coordinator makes several of in a row,
  // unlike a spawn, where each card stands for a whole child run worth looking at.
  agents: {
    label: 'Agents',
    noun: 'calls',
    verb: 'Coordinating',
    icon: Bot,
    stackable: true,
  },
  loops: {
    label: 'Loops',
    noun: 'loops',
    verb: 'Scheduling loop',
    icon: RefreshCw,
    stackable: false,
  },
  plugin_build: {
    label: 'Built plugin',
    noun: 'plugins',
    verb: 'Building plugin',
    icon: Plug,
    stackable: false,
  },
  research: {
    label: 'Researched',
    noun: 'researches',
    verb: 'Researching',
    icon: Globe,
    stackable: false,
    readOnly: true,
  },
  conversation_control: {
    label: 'Conversation updated',
    noun: 'conversation updates',
    verb: 'Updating conversation',
    icon: MessageSquareDashed,
    stackable: false,
    readOnly: true,
  },
  configure: {
    label: 'Configure',
    noun: 'configuration proposals',
    verb: 'Proposing a change',
    icon: SlidersHorizontal,
    stackable: false,
  },
  plan: {
    label: 'Presented plan',
    noun: 'plans',
    verb: 'Presenting plan',
    icon: ClipboardList,
    stackable: false,
  },
}

/**
 * Names that legitimately reach the transcript but are ABSENT from `TOOL` BY DESIGN.
 *
 * This is the ONLY sanctioned escape from the exhaustive `CORE_META` above, so every
 * entry must justify itself — `meta.test.ts` asserts each one is genuinely un-owned by
 * the server (i.e. really not in `TOOL`), which stops this map becoming the dumping
 * ground that would quietly re-open the gap the typed core just closed.
 *
 * NOTE the asymmetry: most extension tools are absent from BOTH maps on purpose —
 * they render via the generic extension-tool card.
 * A name only belongs here if it needs presentation meta despite having no server entry.
 */
const NON_CORE_META = {
  terminal: {
    absentBecause:
      'NOT A TOOL: the interactive PTY actions are folded INTO `bash` (agent-core/tools/terminal/terminal.ts). This is the icon key TerminalToolCard looks up by literal for those bash calls.',
    label: 'Terminal',
    noun: 'terminals',
    verb: 'Driving terminal',
    icon: SquareTerminal,
    stackable: false,
  },
} satisfies Record<string, NonCoreMeta>

/**
 * The non-core names sanctioned above, as a UNION.
 *
 * `satisfies` (rather than a `: Record<string, NonCoreMeta>` annotation) is what makes
 * this possible: the values are still checked, but the KEYS stay literal instead of
 * widening to `string`, so sibling registries can key on the real vocabulary.
 */
export type NonCoreToolName = keyof typeof NON_CORE_META

/**
 * Every tool name the transcript can present: the server's own `ToolName`, plus the
 * sanctioned non-core exemptions.
 *
 * This is the vocabulary the card registries key on. It exists so that a tool RENAMED
 * server-side, or simply typo'd, fails `bun run type-check` at the registry instead of
 * silently reverting a rich card to the generic wrench — the exact failure `CORE_META`
 * already documents having shipped ("five real tools ship as unlabeled wrenches").
 */
export type PresentableToolName = ToolName | NonCoreToolName

const META: Record<string, ToolMeta> = { ...CORE_META, ...NON_CORE_META }

/**
 * Unknown and plugin tools — and, since external-agent transcripts landed, every FOREIGN tool.
 *
 * `stackable` is true for the same reason MCP's is: a run of consecutive calls to ONE name is one
 * activity however little we know about the name, and `groupConsecutiveItems` only stacks a same-name
 * run at three or more. It was false, and a foreign transcript is where that stopped being harmless —
 * folding keys on this table, so a repeated foreign tool folded nowhere.
 *
 * Measured on a real foreign-agent run of 1,169 consecutive `Bash` calls, mounting the chain:
 *
 *   foreign name, unstackable   1,169 groups · 12,875 DOM nodes · 96 ms
 *   registered read-only name       1 group  ·      34 nodes    ·  2 ms
 *
 * `readOnly` stays absent, which is the conservative half: read-only runs fold at TWO and claiming
 * that for a tool we cannot classify would fold a run of writes on the strength of a guess.
 */
export const FALLBACK_META: ToolMeta = {
  label: 'Tool',
  noun: 'calls',
  verb: 'Running',
  icon: Wrench,
  stackable: true,
}
export const MCP_META: ToolMeta = {
  label: 'MCP',
  noun: 'calls',
  verb: 'Calling',
  icon: Plug,
  stackable: true,
}

/**
 * A standalone surface with no entry of its own.
 *
 * `STANDALONE_TOOL_NAMES` are the surfaces that must stay independent rows, and the rule used to
 * hold only because the generic fallback happened to be unstackable — an accident, and one that
 * broke the moment the fallback needed to stack for foreign runs. It is enforced at the lookup now,
 * so a standalone name added without a meta entry is safe by construction rather than by luck.
 */
const STANDALONE_FALLBACK_META: ToolMeta = { ...FALLBACK_META, stackable: false }

/**
 * The label to SHOW for a tool name.
 *
 * A registered tool has a curated label; an unregistered one has only its own name — and that beats
 * the generic fallback word, which is what a folded run of them was reduced to. Measured before this:
 * 200 consecutive `Bash` calls rendered as "Tool 200 calls · Tool, Tool +198", with the name gone
 * from both the summary and the preview.
 *
 * Asked separately from {@link toolMeta} on purpose: that function must keep returning the
 * `FALLBACK_META` IDENTITY, because `meta.test.ts` proves a card has a real entry by comparing
 * against it. A derived object would make that guard pass for everything.
 */
export function toolDisplayLabel(name: string): string {
  const registered = META[name] ?? contributedToolMeta(name)
  if (registered) return registered.label
  return name.startsWith('mcp_') ? MCP_META.label : name
}

/** Look up presentation meta for a tool name (fallback for unknown tools). */
export function toolMeta(name: string): ToolMeta {
  const registered = META[name] ?? contributedToolMeta(name)
  if (registered) return registered
  if (name.startsWith('mcp_')) return MCP_META
  return isAlwaysStandaloneToolName(name) ? STANDALONE_FALLBACK_META : FALLBACK_META
}

/**
 * The row a plugin registered for a tool it owns (`host.toolCards`), in this table's shape.
 *
 * Consulted only AFTER the core table, so a plugin cannot restyle a built-in by registering its
 * name. Cached per contribution because callers compare meta by identity (the stacking fold, the
 * `FALLBACK_META` guard) and a fresh object per call would read as a different tool every render.
 */
const contributedMeta = new WeakMap<ToolCardContribution, ToolMeta>()

function contributedToolMeta(name: string): ToolMeta | undefined {
  const contribution = toolCardFor(name)
  if (!contribution) return undefined
  const cached = contributedMeta.get(contribution)
  if (cached) return cached
  const { Icon, ...presentation } = contribution.presentation
  const meta: ToolMeta = { ...presentation, icon: Icon }
  contributedMeta.set(contribution, meta)
  return meta
}

/** Whether the transcript's own table owns `name` — a contributed card never replaces one. */
export function isCoreToolMetaName(name: string): boolean {
  return Object.hasOwn(META, name)
}

/** Every name with a registered entry — the enumeration `meta.test.ts` guards over. */
export function allToolMetaNames(): string[] {
  return Object.keys(META)
}

/** Every tool the SERVER owns. Re-exported so the guard derives from the owner, not from our copy. */
export function coreToolNames(): ToolName[] {
  return Object.values(TOOL)
}

/** The sanctioned exemptions and their stated reasons — see {@link NON_CORE_META}. */
export function nonCoreToolMeta(): Record<string, NonCoreMeta> {
  return NON_CORE_META
}
