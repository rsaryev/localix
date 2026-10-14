import { expect, test } from '@playwright/test'

test('landing/workbench-layout: tools stay left of the session and flight anchors follow the split', async ({
  page,
}) => {
  await page.goto('/')
  for (const selector of ['.sc-plugin-split', '.sc-browser', '.sc-context']) {
    const scene = page.locator(selector)
    await scene.scrollIntoViewIfNeeded()
    const geometry = await scene.evaluate((node) => {
      const work = node.firstElementChild.getBoundingClientRect()
      const session = node.querySelector('.sc-session').getBoundingClientRect()
      return {
        left: work.right <= session.left + 1,
        aligned: Math.abs(work.top - session.top) < 1,
        contained: [
          ...node.querySelectorAll('.k-composer, .sc-build, .sc-real, .k-chip, .sc-tag'),
        ].every(
          (child) => child.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1,
        ),
      }
    })
    expect(geometry).toEqual({ left: true, aligned: true, contained: true })
    if (selector === '.sc-plugin-split') continue
    const anchors = await scene.evaluate((node) => {
      const from = node.querySelector('[data-fly-from]').getBoundingClientRect()
      const to = node.querySelector('[data-fly-to]').getBoundingClientRect()
      return {
        sourceInWork: node.firstElementChild.contains(node.querySelector('[data-fly-from]')),
        targetInSession: node
          .querySelector('.sc-session')
          .contains(node.querySelector('[data-fly-to]')),
        measuredX: Number.parseFloat(node.style.getPropertyValue('--fly-x')),
        measuredY: Number.parseFloat(node.style.getPropertyValue('--fly-y')),
        actualX: Math.round(from.left - to.left),
        actualY: Math.round(from.top - to.top),
      }
    })
    expect(anchors.sourceInWork).toBe(true)
    expect(anchors.targetInSession).toBe(true)
    expect(anchors.measuredX).toBe(anchors.actualX)
    expect(anchors.measuredY).toBe(anchors.actualY)
    expect(anchors.measuredX).toBeLessThan(0)
  }
})

test('landing/workbench-choreography: build precedes the left panel and the cursor selects Publish', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const plugin = page.locator('[data-feature="plugins"]')
  await plugin.scrollIntoViewIfNeeded()
  const seek = async (scene, fraction) => {
    await scene.evaluate((node, progress) => {
      for (const animation of node.getAnimations({ subtree: true })) {
        animation.pause()
        const timing = animation.effect.getTiming()
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * progress
      }
    }, fraction)
  }
  await seek(plugin, 0.18)
  await expect(plugin.locator('.sc-plugin-ask')).toHaveCSS('opacity', '1')
  await expect(plugin.locator('.sc-skeleton').first()).toHaveCSS('opacity', '1')
  await expect(plugin.locator('.sc-real').first()).toHaveCSS('opacity', '0')
  await seek(plugin, 0.52)
  await expect(plugin.locator('.sc-build-done')).toHaveCSS('opacity', '1')
  await expect(plugin.locator('.sc-plugin-tab')).toHaveCSS('opacity', '1')
  await expect(plugin.locator('.sc-real').first()).toHaveCSS('opacity', '1')
  await seek(plugin, 0.75)
  await expect(plugin.locator('.sc-plugin-progress .k-swap > :last-child')).toHaveCSS(
    'opacity',
    '1',
  )
  const browser = page.locator('.sc-browser')
  await browser.scrollIntoViewIfNeeded()
  await seek(browser, 0.23)
  const cursor = await browser.locator('.sc-browser-cursor').evaluate((node) => ({
    anchored: node.parentElement.classList.contains('sc-publish'),
    settled: new DOMMatrix(getComputedStyle(node).transform)
      .toFloat64Array()
      .every((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) < 0.001),
    opacity: getComputedStyle(node).opacity,
  }))
  expect(cursor).toEqual({ anchored: true, settled: true, opacity: '1' })
  await seek(browser, 0.75)
  await expect(browser.locator('.sc-fly-x')).toHaveCSS('transform', 'none')
  await expect(browser.locator('.sc-fly-y')).toHaveCSS('transform', 'none')
})

test('landing/feature-highlights: readable cards, a full-card link, and individual workbenches', async ({
  page,
}, testInfo) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const section = page.locator('#platform')
  const cards = section.locator('.bento-tile')
  await expect(cards).toHaveCount(12)
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expect(section.locator('.bento-grid')).toHaveClass(/is-visible/)
  await expect(section).toHaveCSS('opacity', '1')
  await expect(section.locator('.bento-cell').first()).toHaveCSS('opacity', '1')
  await page.evaluate(() => document.fonts.ready)

  // Each whole card owns exactly one accessible link, with no nested controls or link footer.
  await expect(section.getByRole('link')).toHaveCount(12)
  await expect(section.getByRole('link', { name: /^Explore / })).toHaveCount(0)
  await expect(section.locator('button, input, .arrow-cue')).toHaveCount(0)
  for (const name of ['Git', 'Code Graph', 'Kanban', 'Database', 'API Client', 'DevOps']) {
    await expect(section.getByRole('link', { name, exact: true })).toHaveCount(1)
  }
  const overflow = await section.evaluate((element) => {
    const viewport = document.documentElement.clientWidth
    return [...element.querySelectorAll('.bento-tile, .bento-copy, .bento-visual')]
      .filter(
        (node) =>
          node.getBoundingClientRect().right > viewport + 1 ||
          node.scrollWidth > node.clientWidth + 1,
      )
      .map((node) => node.className)
  })
  expect(overflow).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath('describe-a-workbench.png'),
    animations: 'disabled',
  })

  const git = section.getByRole('link', { name: 'Git', exact: true })
  await git.scrollIntoViewIfNeeded()
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({
      path: testInfo.outputPath('individual-workbenches.png'),
      animations: 'disabled',
    })
  }
  // Click the empty top-right corner, away from text and the illustration.
  const bounds = await git.boundingBox()
  await git.click({ position: { x: bounds.width - 8, y: 8 } })
  await expect(page).toHaveURL(/\/docs\/features--source-control#what-you-can-do$/)
  await expect(page.locator('#what-you-can-do')).toBeVisible()

  await page.goBack()
  const browser = page.getByRole('link', { name: 'Point at the interface', exact: true })
  await browser.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/features--visual-feedback#let-the-agent-drive-the-preview$/)
})

test('landing/feature-motion: off-screen loops pause and reduced motion stays readable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const card = page.locator('[data-feature="plugins"]')
  await expect(card).toHaveAttribute('data-paused', 'true')
  const loop = card.locator('.sc-build > i')
  await expect
    .poll(() => loop.evaluate((node) => getComputedStyle(node).animationPlayState))
    .toBe('paused')
  await card.scrollIntoViewIfNeeded()
  await expect(card).not.toHaveAttribute('data-paused')
  await expect
    .poll(() => loop.evaluate((node) => getComputedStyle(node).animationPlayState))
    .toBe('running')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect
    .poll(() => loop.evaluate((node) => getComputedStyle(node).animationName))
    .toBe('none')
  // The resting frame is the result: rendered rows and a passed build, not the skeleton.
  await expect(card.locator('.sc-real').first()).toHaveCSS('opacity', '1')
  await expect(card.locator('.sc-skeleton').first()).toHaveCSS('opacity', '0')
  await expect(card.locator('.sc-build-done')).toBeVisible()
})
