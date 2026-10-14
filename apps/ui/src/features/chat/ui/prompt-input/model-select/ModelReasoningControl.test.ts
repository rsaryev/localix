import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ModelReasoningControl.tsx', import.meta.url), 'utf8')

/**
 * The expanded control is the app's own menu, built by the same `reasoningEntries` the details
 * panel uses. Earlier attempts failed differently — a slider with a hand-aligned label row could
 * not match a model's own number of levels, a segmented row opening downward covered the message
 * being written, and a hand-built radio popover drifted from the panel's menu in its wording.
 */
test('the expanded control is the shared reasoning menu, not a slider or a segmented row', () => {
  expect(source).toContain('<DropdownMenu ')
  expect(source).toContain('<MenuEntries')
  expect(source).toContain('reasoningEntries(')
  expect(source).not.toContain('PopoverRadioGroup')
  expect(source).not.toContain('SegmentedControl')
  // No column count can be right for every model: the number of levels is the model's, not ours.
  expect(source).not.toContain('grid-cols-6')
})

test('it opens above the composer, where the trigger is', () => {
  // The composer sits at the bottom of the window; a menu opening downward lands over the
  // message. Every other chip in this row anchors the same way.
  expect(source).toContain('align="end" side="top"')
})

test('the slider survives only in the dense row', () => {
  expect(source).toContain("display === 'inline'")
})
