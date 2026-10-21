import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeviceAuthorizationStatus } from './DeviceAuthorizationStatus'

describe('DeviceAuthorizationStatus presentation', () => {
  test('renders authorization progress as a flat activity row', () => {
    const html = renderToStaticMarkup(
      <DeviceAuthorizationStatus
        deviceInfo={{
          userCode: 'ABCD-1234',
          verificationUri: 'https://example.com/device',
        }}
        copied={false}
        onCopy={() => {}}
      />,
    )

    expect(html).toContain('ABCD-1234')
    expect(html).toContain('Waiting for authorization')
    expect(html).toContain('lx-activity-orb')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('border-control-border bg-surface-raised')
  })

  test('keeps the instruction useful when the provider omits its verification URI', () => {
    const html = renderToStaticMarkup(
      <DeviceAuthorizationStatus
        deviceInfo={{ userCode: 'ABCD-1234' }}
        copied={false}
        onCopy={() => {}}
      />,
    )

    expect(html).toContain('provider verification page')
  })
})
