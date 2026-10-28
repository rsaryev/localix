import type { UiTokenRule } from '../kit/kit'

/**
 * The patterns that make a generated screen look generated, where a machine can see them in a
 * class list or a string: each one a decoration standing in for structure or meaning. Drawn from
 * the anti-patterns Impeccable catalogues (github.com/pbakaus/impeccable, Apache-2.0), kept to the
 * ones that are never right in a mini app, which sits in Localix's own theme beside a chat.
 *
 * Taste a regex cannot judge — one headline, flat structure, words on buttons — is in the design
 * brief `mini-app create` prints; these only catch what slipped through it.
 */
export const MINI_APP_DESIGN_RULES: readonly UiTokenRule[] = [
  {
    name: 'gradient text',
    pattern: /\bbg-clip-text\b/gu,
    fix: 'set the text in text-foreground and let size and weight carry the emphasis',
  },
  {
    name: 'gradient',
    // A fade to transparent at a scrolling edge is a mask, not a colour; it is left alone.
    pattern:
      /\bbg-(?:gradient|linear|radial|conic)(?:-[\w/[\]().,%#-]+)?(?![^"'`]*\btransparent\b)/gu,
    fix: 'colour carries meaning, not decoration: a flat host surface such as bg-surface-hover, or none',
  },
  {
    name: 'side stripe',
    // A hairline that separates is structure; a thick coloured bar beside a card is decoration.
    pattern: /\bborder-[lrse]-(?:[4-9]|\[)/gu,
    fix: 'separate with spacing or divide-y divide-border-faint, and say a status in words with text-status-*',
  },
  {
    name: 'emoji icon',
    pattern: /\p{Emoji_Presentation}/gu,
    fix: 'use a lucide-react icon, or plain words',
  },
  {
    name: 'attention motion',
    pattern: /\banimate-(?:bounce|ping)\b/gu,
    fix: 'nothing bounces or pings for attention: LoadingHint while loading, a status colour with words for a state',
  },
  {
    name: 'glow',
    // A blur around nothing (no offset) is a glow; a ring drawn as a 0-blur shadow is not.
    pattern: /\b(?:drop-)?shadow-\[0_0_[1-9][^\]]*\]/gu,
    fix: 'no custom shadow or glow: the kit components carry their own elevation',
  },
]
