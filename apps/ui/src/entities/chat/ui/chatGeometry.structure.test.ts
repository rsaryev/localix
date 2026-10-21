/**
 * Chat surface GEOMETRY guards.
 *
 * Chat is the most-used surface in the app, and its chrome kept drifting off the
 * one physical scale declared in `app/index.css` (--chrome-control-*): a message
 * action bar mixing 28px icon buttons with a 32px Sources button, two variants of
 * the SAME message footer slot declaring different heights, and composer rows
 * inset by an ad-hoc `0.7rem`.
 *
 * These read source text on purpose: the rules are about which token/primitive a
 * class list names, which has no runtime seam short of mounting the whole
 * workspace. They pin TOKENS and PRIMITIVES only — never a specific pixel nudge
 * (see ChatSurface.test.ts's rule 3).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const uiRoot = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(uiRoot, path), 'utf8')
const kitRoot = resolve(uiRoot, '../../../packages/kit/src')
const readKit = (path: string) => readFileSync(resolve(kitRoot, path), 'utf8')

describe('chat geometry contracts', () => {
  test('keeps the message footer slot one height across streaming and settled', () => {
    // The rule is that a row must not change height when its run finishes. This used to be
    // checked as "two class lists that both name the token" — two things agreeing, which is
    // a coincidence one edit apart. There is now ONE expression, shared by the streaming and
    // the settled branch, which is the same rule made structural: they cannot differ. That
    // is also what lets the reserve be conditional (a run's last card gets the slot, the
    // cards inside a run do not) without reintroducing the jump.
    const card = read('entities/chat/ui/MessageCard.tsx')
    const footers = card.match(/lx-message-footer[^'"`]*/g) ?? []
    expect(footers).toHaveLength(1)
    expect(card).toContain('min-h-[var(--chrome-control-lg)]')
    expect(card).not.toMatch(/\b(?:min-)?h-8\b/)
  })

  test('reserves room for tool labels before wrapping the independent action cluster', () => {
    const line = read('entities/chat/ui/tool-parts/ToolLine.tsx')
    expect(line).toContain('flex-wrap items-center rounded-lg')
    expect(line).toContain('min-w-[min(12rem,100%)] flex-1 items-center')
    expect(line).toContain('ml-auto flex shrink-0 items-center')
    expect(line).not.toContain('items-start gap-1.5 self-stretch')
  })

  test('gives a message card ONE content edge', () => {
    // Name, text and the first action glyph all start at the same place. They did not: the
    // name sat at the author indent, the text 4px further in on a transparent bubble's
    // padding, and the glyph 7px further still inside its icon button's box — three edges,
    // none of them chosen. The rules that keep it one:
    //   · a bubble with no background has no padding (padding on a transparent box is not
    //     breathing room, it is an edge), and the space between stacked parts is a gap;
    //   · a row of icon buttons is pulled out by the button's optical inset, which is a
    //     token derived from the control scale rather than a measured pixel nudge.
    const bubble = read('entities/chat/ui/MessageBubbles.tsx')
    const transparent = (bubble.match(/'[^']*bg-transparent[^']*'/g) ?? []).join(' ')
    expect(transparent).toBeTruthy()
    expect(transparent).not.toMatch(/\bp[xlrty]?-/)
    const card = read('entities/chat/ui/MessageCard.tsx')
    expect(card).toContain('var(--icon-button-optical-inset)')
    expect(card).not.toMatch(/lx-message-footer[^'"`]*\bpl-\d/)
    const css = readKitStylesheet()
    expect(css).toContain('--icon-button-optical-inset: calc((var(--chrome-control-md)')
  })

  test('keeps every message action on the shared Button size scale', () => {
    // MessageSources sits in the same row as MessageActions' icon buttons; an
    // explicit height/radius override is what made that row two heights tall.
    const sources = read('entities/chat/ui/MessageSources.tsx')
    expect(sources).toContain('size="default"')
    expect(sources).not.toMatch(/\bh-(?:7|8|9)\b/)
    expect(sources).not.toContain('rounded-lg')
  })

  test('keeps the collapsible tool-row family on one header height', () => {
    for (const path of [
      'entities/chat/ui/tool-parts/ToolLine.tsx',
      'entities/chat/ui/tool-parts/ToolChainHeader.tsx',
      'entities/chat/ui/tool-parts/cards/StackedItemGroup.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('min-h-[var(--chrome-control-md)]')
      expect(source).not.toMatch(/\bmin-h-7\b/)
    }
  })

  test('keeps composer control rows and context chips on the geometry scale', () => {
    for (const path of ['entities/chat/ui/prompt-input/ModelSearchSelect.tsx']) {
      const source = read(path)
      expect(source).toContain('h-[var(--chrome-control-lg)]')
      expect(source).not.toMatch(/\bh-8\b/)
    }
    const chip = readKit('controls/composer-chip.tsx')
    expect(chip).toContain('h-[var(--chrome-control-md)]')
    const surface = read('widgets/chat-workspace/ui/ChatSurface.tsx')
    expect(surface).toContain('h-[var(--chrome-control-xl)]')
    expect(surface).not.toMatch(/\bh-9\b/)
  })

  test('insets every composer shell row from one scale, with one narrow-width step', () => {
    for (const path of [
      'entities/chat/ui/prompt-input/PromptInput.tsx',
      'entities/chat/ui/prompt-input/PinnedSkillsRow.tsx',
      'entities/chat/ui/prompt-input/ContextRefChips.tsx',
      'entities/chat/ui/prompt-input/TextArea.tsx',
      'shared/ui/attachments/AttachmentTray.tsx',
      'entities/chat/ui/prompt-input/ActionButtons.tsx',
    ]) {
      const source = read(path)
      // Ad-hoc rem insets (`px-[0.7rem]`) are what put four different seams on the
      // sibling rows of one shell.
      expect(source).not.toMatch(/\bpx-\[[\d.]+rem\]/)
      if (/\bpx-\d/.test(source)) expect(source).toMatch(/max-sm:px-\d/)
    }
  })
})
