import { FilePen, Image as ImageIcon, MessageSquareDashed, SquareTerminal } from 'lucide-react'
import type { ToolMeta } from './meta'

/**
 * A name that is NOT in the server's `TOOL` map and never can be — with the reason.
 * `absentBecause` is REQUIRED: "absent by design" must be a stated, reviewable claim,
 * never the silent gap that let five real tools ship as unlabeled wrenches.
 */
export interface NonCoreMeta extends ToolMeta {
  absentBecause: string
}

/**
 * Names that legitimately reach the transcript but are ABSENT from `TOOL` BY DESIGN.
 *
 * This is the ONLY sanctioned escape from the exhaustive `CORE_META` in `meta.ts`, so every
 * entry must justify itself — `meta.test.ts` asserts each one is genuinely un-owned by
 * the server (i.e. really not in `TOOL`), which stops this map becoming the dumping
 * ground that would quietly re-open the gap the typed core just closed.
 *
 * NOTE the asymmetry: most extension tools are absent from BOTH maps on purpose —
 * they render via the generic extension-tool card.
 * A name only belongs here if it needs presentation meta despite having no server entry.
 */
export const NON_CORE_META = {
  view_image: {
    absentBecause:
      'HISTORICAL: `read` now returns images itself, but saved sessions still hold `view_image` items, which render through ReadCard.',
    label: 'Viewed',
    noun: 'images',
    verb: 'Viewing image',
    icon: ImageIcon,
    stackable: true,
    readOnly: true,
  },
  apply_patch: {
    absentBecause:
      'HISTORICAL: the patch tool was removed (agents edit with `edit`/`write`), but saved sessions still hold `apply_patch` items, which keep their label.',
    label: 'Patched',
    noun: 'patches',
    verb: 'Patching',
    icon: FilePen,
    stackable: true,
  },
  conversation_control: {
    absentBecause:
      'HISTORICAL: group turns hand the floor through `handoff` now and `set_topic` changes the topic, but saved sessions still hold `conversation_control` items, which keep their label.',
    label: 'Conversation updated',
    noun: 'conversation updates',
    verb: 'Updating conversation',
    icon: MessageSquareDashed,
    stackable: false,
    readOnly: true,
  },
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

/** The sanctioned exemptions and their stated reasons — see {@link NON_CORE_META}. */
export function nonCoreToolMeta(): Record<string, NonCoreMeta> {
  return NON_CORE_META
}
