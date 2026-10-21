import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const launcher = readFileSync(new URL('./NotificationCenterLauncher.tsx', import.meta.url), 'utf8')
const titlebar = readFileSync(
  new URL('../../../pages/chat/ui/BreadcrumbTrailingActions.tsx', import.meta.url),
  'utf8',
)

describe('Event Center startup boundary', () => {
  test('keeps the journal behind an intent-prefetched dynamic import', () => {
    expect(launcher).toContain("import('./NotificationCenter')")
    expect(launcher).toContain('onPointerEnter={() => void preloadNotificationCenter()}')
    expect(launcher).toContain('onFocus={() => void preloadNotificationCenter()}')
  })

  test('mounts only the lightweight launcher in the titlebar', () => {
    expect(titlebar).toContain('NotificationCenterLauncher')
    expect(titlebar).not.toMatch(
      /from ['"]@\/shared\/ui\/notification-center\/NotificationCenter['"]/,
    )
  })
})
