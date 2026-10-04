import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepRail } from './wizard/StepRail'

describe('onboarding chrome', () => {
  test('shows step labels and progress without decorative icons', () => {
    const html = renderToStaticMarkup(
      <StepRail
        steps={[
          { id: 'welcome', title: 'Welcome', description: 'Get started', Component: () => null },
          {
            id: 'ready',
            title: 'Ready',
            description: 'Confirm the connection',
            Component: () => null,
          },
        ]}
        stepIndex={1}
        furthestStep={1}
        onJump={() => {}}
      />,
    )

    expect(html).toContain('Welcome')
    expect(html).toContain('Confirm the connection')
    expect(html).toContain('aria-current="step"')
    expect(html).not.toContain('<svg')
  })
})
