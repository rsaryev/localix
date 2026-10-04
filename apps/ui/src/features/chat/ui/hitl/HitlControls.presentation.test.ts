import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('HITL control presentation', () => {
  test('reuses shared form controls across decision views', () => {
    for (const file of [
      './AskInteractionView.tsx',
      './SecretInteractionView.tsx',
      './ConfirmInteractionView.tsx',
    ]) {
      expect(read(file)).toContain('<Button')
    }
    // An ask's fields live in the form both ask cards share (blocking and queued).
    for (const file of ['./AskQuestionForm.tsx', './SecretInteractionView.tsx']) {
      const source = read(file)
      expect(source).toContain('<Input')
      expect(source).not.toContain('focus:ring-1 focus:ring-control-border-focus')
    }
    expect(read('./HitlInteractionFrame.tsx')).toContain('<IconButton')
  })

  test('makes ask selection state and keyboard shortcuts programmatic', () => {
    const ask = read('./AskQuestionForm.tsx')
    expect(ask).toContain('aria-pressed={active}')
    expect(ask).toContain('aria-keyshortcuts=')
    expect(ask).toContain('role="group"')
    expect(ask).toContain('aria-label={`Custom answer for ${activeQuestion.question}`}')
  })
})

/**
 * ONE vocabulary across every card that blocks a run on a person.
 *
 * These four grew apart one card at a time: refusing was `Deny`, `Decline` and
 * `Don't provide`, agreeing was `Approve`, `Continue` and `Store secret`, and the ask form
 * offered no refusal in its footer at all. A user cannot learn a pattern that changes per
 * card, and the words are the whole interface at the moment a decision is made.
 */
describe('every decision card answers in the same words', () => {
  const VIEWS = [
    './AskInteractionView.tsx',
    './SecretInteractionView.tsx',
    './ConfirmInteractionView.tsx',
    './ConfigChangeInteractionView.tsx',
  ]

  test('refusing is Deny and agreeing is Approve, everywhere', () => {
    for (const file of VIEWS) {
      const source = read(file)
      expect({ file, deny: source.includes('>\n            Deny') }).toEqual({ file, deny: true })
      expect({ file, approve: source.includes('Approve') }).toEqual({ file, approve: true })
    }
  })

  test('the words that used to mean the same thing are gone', () => {
    // The positive control: this fails the day someone reintroduces one of them.
    for (const file of VIEWS) {
      const source = read(file)
      for (const retired of ['Decline', 'Don&rsquo;t provide', 'Store secret']) {
        expect({ file, retired, present: source.includes(`>\n            ${retired}`) }).toEqual({
          file,
          retired,
          present: false,
        })
      }
    }
  })

  test('both keys are offered on every card, not just on three of them', () => {
    for (const file of VIEWS) {
      const source = read(file)
      expect({ file, esc: source.includes('<Kbd>esc</Kbd>') }).toEqual({ file, esc: true })
      expect({ file, enter: source.includes('↵') }).toEqual({ file, enter: true })
    }
  })

  test('the deadline is the frame’s, so no card can forget to show it', () => {
    for (const file of VIEWS) {
      expect({
        file,
        wired: read(file).includes('expiresAt={interaction.request.expiresAt}'),
      }).toEqual({ file, wired: true })
    }
    const frame = read('./HitlInteractionFrame.tsx')
    // `remaining` reads "in 4m 12s" by itself — a literal "in" before it doubled the word.
    expect(frame).toContain('Auto-deny {remaining}')
    expect(frame).not.toContain('Auto-deny in {remaining}')
  })
})
