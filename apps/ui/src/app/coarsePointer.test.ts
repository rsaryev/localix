import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const css = readKitStylesheet()
const messageCard = readFileSync(
  resolve(import.meta.dir, '../features/chat/ui/MessageCard.tsx'),
  'utf8',
)
const mediaFigure = readFileSync(
  resolve(import.meta.dir, '../features/chat/ui/MediaFigure.tsx'),
  'utf8',
)
const messageActions = readFileSync(
  resolve(import.meta.dir, '../features/chat/ui/MessageActions.tsx'),
  'utf8',
)
const tabs = readFileSync(
  resolve(import.meta.dir, '../../../../packages/kit/src/layout/tabs/tabs.tsx'),
  'utf8',
)

describe('coarse-pointer action affordances', () => {
  /**
   * The message footer used to stack two absolutely-positioned layers in one fixed
   * row: resting metadata, and an actions layer at `opacity-0` that only appeared on
   * `group-hover`. Touch has no hover, so the stylesheet forced both visible and
   * pulled the overlay back into the flow.
   *
   * Both layers are gone — metadata moved to Activity and MessageActions now renders
   * unconditionally — so the assertion moves with them rather than being deleted.
   * Pinning "the actions are not hover-gated" fails the moment a reveal is
   * reintroduced, which is the thing that would actually strand a touch user; the
   * old assertions only checked that the workaround was still spelled correctly, and
   * would have gone on passing over a footer that had lost its actions entirely.
   */
  test('message actions are unconditional, not hover-revealed', () => {
    expect(messageCard).toContain('lx-message-footer')
    expect(messageActions).not.toMatch(/\bopacity-0\b/)
    expect(messageActions).not.toMatch(/group-hover:opacity/)
    // The overrides for those two layers must not outlive them as dead rules.
    expect(css).not.toContain('lx-message-footer__meta')
    expect(css).not.toContain('lx-message-footer__actions')
  })

  test('the affordances that ARE hover-revealed stay reachable on touch', () => {
    expect(mediaFigure).toContain('lx-media-actions')
    expect(tabs).toContain('lx-tab-dirty-indicator')
    expect(tabs).toContain('lx-hover-actions')
    expect(css).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?\.lx-message-footer \{[\s\S]*?overflow-x: auto !important;/,
    )
    expect(css).toMatch(
      /\.lx-media-actions,[\s\S]*?\.lx-hover-actions \{[\s\S]*?pointer-events: auto;[\s\S]*?opacity: 1 !important;/,
    )
    expect(css).toMatch(/\.lx-tab-dirty-indicator \{[\s\S]*?opacity: 0 !important;/)
  })
})
