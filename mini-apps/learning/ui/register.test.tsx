import { expect, test } from 'bun:test'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  RailViewletContribution,
  StatusItemContribution,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'

import { registerUi } from './register'

/**
 * Registration goes through the SDK's recording host, not a hand-built literal.
 *
 * The literal this replaced named every seam the mini app used and cast past the rest, so the day
 * the contract grew one more, `registerUi` died on `undefined.register` — inside the test whose
 * job is to prove registration works. Four mini apps hit that at once when status items landed. The
 * completeness check belongs in the package that owns the contract, and does.
 */
test('keeps the library and course tabs session-scoped', () => {
  const { host, registrations } = recordingMiniAppUiHost()

  registerUi(host)

  const viewlets = registrations.railViewlets as RailViewletContribution[]
  const workItems = registrations.workItems as WorkItemKindContribution[]
  const anchor = (registrations.anchors as UiAnchorContribution[])[0]

  expect(viewlets.map((viewlet) => viewlet.kind)).toEqual(['learning:workspace'])
  expect(workItems.map((item) => item.kind)).toEqual(['learning:workspace', 'learning:course'])
  expect(workItems.every((item) => item.scope === 'session')).toBe(true)
  expect(
    anchor?.resolve(
      'localix://resource/learning/session-1/module/module-1/lesson/lesson-1/step/step-1',
    ),
  ).toMatchObject({
    kind: 'work-item',
    workKind: 'learning:course',
    id: 'learning:course:session-1',
    payload: {
      courseId: 'session-1',
      resourceUri:
        'localix://resource/learning/session-1/module/module-1/lesson/lesson-1/step/step-1',
    },
  })
  expect(anchor?.resolve('localix://resource/learning/session-1/module/module-1')).toMatchObject({
    kind: 'work-item',
    workKind: 'learning:course',
    id: 'learning:course:session-1',
    payload: { courseId: 'session-1' },
  })

  // Asserted here rather than in a second test: `registerUi` is once-only, so a second call
  // records nothing and a second case would prove only that.
  const items = registrations.statusItems as StatusItemContribution[]
  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'learning:progress', placement: 'titlebar' },
  ])
})
