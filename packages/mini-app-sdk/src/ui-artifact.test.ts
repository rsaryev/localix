import { expect, test } from 'bun:test'
import { isPluginUiSharedModule } from './ui-artifact'

test('an artifact takes React, the kit and the SDK from the host, and bundles everything else', () => {
  for (const shared of [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    '@localixai/kit/button',
    '@localixai/mini-app-sdk/ui',
    '@localixai/mini-app-sdk/ui/runtime',
    '@localixai/mini-app-sdk/backends',
  ]) {
    expect(isPluginUiSharedModule(shared)).toBe(true)
  }
  for (const bundled of [
    'react-markdown',
    'react/other',
    'react-dom/server',
    '@localixai/kit/',
    '@localixai/kit/testing',
    '@localixai/kit/testing/dom',
    '@localixai/mini-app-sdk/',
    '@localixai/mini-app-sdk/backend',
    '@localixai/mini-app-sdk/backend/tools',
    '@localixai/agent/agents/items',
    'lucide-react',
  ]) {
    expect(isPluginUiSharedModule(bundled)).toBe(false)
  }
})
