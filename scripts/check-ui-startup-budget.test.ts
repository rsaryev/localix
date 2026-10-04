import { describe, expect, test } from 'bun:test'
import {
  checkUiStartupBudget,
  externalStartupUrls,
  startupAssetPaths,
} from './check-ui-startup-budget.mjs'

describe('UI startup budget', () => {
  test('counts only unique entry, modulepreload, and startup stylesheet assets', () => {
    const html = `
      <link href="/assets/app.css" rel="stylesheet">
      <link rel="modulepreload" href="/assets/shared.js">
      <link rel="icon" href="/assets/icon.svg">
      <script type="module" src="/assets/index.js"></script>
      <script type="module" src="/assets/index.js"></script>
      <img src="/assets/lazy.png">
    `
    expect(startupAssetPaths(html)).toEqual([
      'assets/app.css',
      'assets/shared.js',
      'assets/index.js',
    ])
  })

  test('reports byte and file regressions independently', () => {
    expect(
      checkUiStartupBudget({ files: 5, bytes: 99, assets: [] }, { maxFiles: 4, maxBytes: 100 }),
    ).toEqual(['5 startup files exceeds 4'])
    expect(
      checkUiStartupBudget({ files: 4, bytes: 101, assets: [] }, { maxFiles: 4, maxBytes: 100 }),
    ).toEqual(['101 startup bytes exceeds 100'])
  })

  test('keeps the production shell independent of internet-hosted startup resources', () => {
    const html = `
      <link rel="stylesheet" href="https://fonts.example/ui.css">
      <link rel="modulepreload" href="//cdn.example/shared.js">
      <script type="module" src="/assets/index.js"></script>
      <img src="https://images.example/lazy.png">
    `
    const css = `
      @font-face { src: url('https://fonts.example/ui.woff2') }
      .local { background: url('/assets/bg.png') }
    `
    expect(externalStartupUrls(html, [css])).toEqual([
      'https://fonts.example/ui.css',
      '//cdn.example/shared.js',
      'https://fonts.example/ui.woff2',
    ])
    expect(
      checkUiStartupBudget({
        files: 1,
        bytes: 1,
        assets: [],
        externalUrls: ['https://fonts.example/ui.css'],
      }),
    ).toEqual(['startup requires external network: https://fonts.example/ui.css'])
  })
})
