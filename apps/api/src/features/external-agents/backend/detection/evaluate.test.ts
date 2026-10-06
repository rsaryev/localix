import { describe, expect, it } from 'bun:test'
import { evaluateScreen, resolveState } from './evaluate'
import { claudeCodeManifest } from './manifests/claude-code'
import { codexManifest } from './manifests/codex'
import { IDLE_FALLBACK_REASON } from '../../shared/state'

/**
 * Screens below reconstruct the rendered shapes that the bundled rules must classify, including
 * the documented Claude Code approval menu.
 */
const CLAUDE_APPROVAL = [
  'I will run the test suite now.',
  '────────────────────────────────────────',
  'Bash command',
  '  bun test',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. Yes, and don’t ask again',
  '  3. No',
  'esc to cancel',
].join('\n')

const CLAUDE_TRANSCRIPT_VIEWER = [
  'Showing detailed transcript',
  'ctrl+o to toggle',
  '? for shortcuts',
].join('\n')

const CLAUDE_ORDINARY = ['Reading src/index.ts', 'Edited 3 files.', '', '❯ '].join('\n')

const CODEX_WORKING = ['Applying patch...', '', '• Working (12s · esc to interrupt)'].join('\n')

const CODEX_APPROVAL = [
  'Codex wants to run a command',
  '────────────────────────────────────────',
  'allow command?',
  '  1. Yes   2. No',
].join('\n')

/**
 * An approval Codex has already ANSWERED, scrolled above the composer.
 *
 * The two Codex rules are scoped `after_last_prompt_marker`, whose anchor is the composer line `›`.
 * They had been pointed at `after_last_horizontal_rule` instead — a different anchor, not a smaller
 * region. On this screen the last box-drawing rule sits ABOVE the settled approval, so that anchor
 * hands the rule a slice still containing "allow command?" and Codex reads as blocked while it is
 * doing nothing of the kind. A false `blocked` is in the default wait set, so it settles a wait
 * instantly.
 */
const CODEX_ANSWERED_APPROVAL_ABOVE_COMPOSER = [
  'Codex wants to run a command',
  '────────────────────────────────────────',
  'allow command?',
  '  1. Yes   2. No',
  '• Ran bun test — 3 passed',
  '›',
].join('\n')

describe('a region is an anchor, not merely a smaller slice', () => {
  it('an approval already scrolled above the composer is not a live blocker', () => {
    const result = evaluateScreen(codexManifest, CODEX_ANSWERED_APPROVAL_ABOVE_COMPOSER)
    expect(result.matchedRule).not.toBe('live_strong_blocker')
    expect(result.state).not.toBe('blocked')
  })

  it('a pending approval below the composer still blocks', () => {
    // The guard must not buy correctness by making the rule unreachable.
    const pending = [
      '• Ran bun test — 3 passed',
      '›',
      'Codex wants to run a command',
      'allow command?',
      '  1. Yes   2. No',
    ].join('\n')
    const result = evaluateScreen(codexManifest, pending)
    expect(result.state).toBe('blocked')
    expect(result.matchedRule).toBe('live_strong_blocker')
  })
})

/**
 * The one `working` signal Claude Code has, and the matcher semantics that make it portable.
 *
 * A matcher requires EVERY listed pattern. The evaluator treated the list as "any is enough".
 * Nothing misdetected while each rule carried one pattern per array, but that made
 * `btw_overlay_working` unusable: its two patterns are an AND and "esc to close" alone appears on
 * unrelated overlays.
 */
describe('the /btw overlay is the only visible working signal Claude Code gives', () => {
  const overlay = (lines: string[]) => ['assistant output above', '', ...lines].join('\n')

  it('reports working when both halves of the rule are on screen', () => {
    const result = evaluateScreen(
      claudeCodeManifest,
      overlay(['/btw what is the plan here', '', 'esc to close']),
    )

    expect(result.state).toBe('working')
    expect(result.matchedRule).toBe('btw_overlay_working')
  })

  it('does NOT fire on the close hint alone, which other overlays also show', () => {
    // "background session · esc to close" is a different screen entirely. On the old disjunctive
    // semantics this returned `working` for it.
    const result = evaluateScreen(
      claudeCodeManifest,
      overlay(['background session', 'esc to close']),
    )

    expect(result.matchedRule).not.toBe('btw_overlay_working')
    expect(result.state).not.toBe('working')
  })

  it('does NOT fire on a mention of /btw without the overlay open', () => {
    const result = evaluateScreen(
      claudeCodeManifest,
      overlay(['/btw is handy for side questions', 'anyway, continuing']),
    )

    expect(result.state).not.toBe('working')
  })

  it('each pattern may match its own line — they need not share one', () => {
    // Matchers form a conjunction over patterns and a disjunction over lines. Requiring one line to
    // satisfy both would never match this overlay.
    const result = evaluateScreen(claudeCodeManifest, overlay(['/btw', 'note', 'esc to close']))

    expect(result.matchedRule).toBe('btw_overlay_working')
  })
})

describe('evaluateScreen — Claude Code', () => {
  it('classifies a permission menu as blocked and names the rule', () => {
    const result = evaluateScreen(claudeCodeManifest, CLAUDE_APPROVAL)
    expect(result.state).toBe('blocked')
    expect(result.matchedRule).toBeDefined()
    expect(result.fallbackReason).toBeUndefined()
  })

  it('treats the transcript viewer as carrying no lifecycle information', () => {
    const result = evaluateScreen(claudeCodeManifest, CLAUDE_TRANSCRIPT_VIEWER)
    expect(result.matchedRule).toBe('transcript_viewer')
    expect(result.skipStateUpdate).toBe(true)
  })

  it('degrades an unrecognized screen to idle WITH the fallback reason, never to blocked', () => {
    const result = evaluateScreen(claudeCodeManifest, CLAUDE_ORDINARY)
    expect(result.state).toBe('idle')
    expect(result.fallbackReason).toBe(IDLE_FALLBACK_REASON)
  })
})

describe('evaluateScreen — Codex', () => {
  it('detects the working footer', () => {
    const result = evaluateScreen(codexManifest, CODEX_WORKING)
    expect(result.state).toBe('working')
    expect(result.matchedRule).toBe('screen_working_fallback')
  })

  it('detects an approval prompt as blocked', () => {
    expect(evaluateScreen(codexManifest, CODEX_APPROVAL).state).toBe('blocked')
  })

  it('does not report working once the turn was interrupted', () => {
    const interrupted = `${CODEX_WORKING}\n■ Conversation interrupted`
    expect(evaluateScreen(codexManifest, interrupted).state).not.toBe('working')
  })
})

describe('resolveState — single authority', () => {
  const observedAt = 1_700_000_000_000

  it('classifies from the screen manifest — the only authority a launch can claim', () => {
    const explain = resolveState({
      manifest: claudeCodeManifest,
      screen: CLAUDE_APPROVAL,
      observedAt,
    })
    expect(explain.state).toBe('blocked')
    expect(explain.authority).toBe('screen-manifest')
    expect(explain.manifestId).toBe('claude-code')
  })

  it('keeps the previous state when a matched rule declines to update it', () => {
    const explain = resolveState({
      manifest: claudeCodeManifest,
      screen: CLAUDE_TRANSCRIPT_VIEWER,
      previous: 'working',
      observedAt,
    })
    expect(explain.state).toBe('working')
    expect(explain.matchedRule).toBe('transcript_viewer')
  })

  it('reports unknown, not idle, for an agent kind with no manifest', () => {
    const explain = resolveState({ screen: 'anything at all', observedAt })
    expect(explain.state).toBe('unknown')
    expect(explain.authority).toBe('none')
  })

  it('always produces an explainable summary', () => {
    for (const explain of [
      resolveState({ manifest: claudeCodeManifest, screen: CLAUDE_APPROVAL, observedAt }),
      resolveState({ manifest: claudeCodeManifest, screen: CLAUDE_ORDINARY, observedAt }),
      resolveState({ observedAt }),
    ]) {
      expect(explain.summary.length).toBeGreaterThan(20)
    }
  })
})
