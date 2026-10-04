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
    '@localixai/plugin-sdk/ui',
    '@localixai/plugin-sdk/ui/runtime',
    '@localixai/plugin-sdk/backends',
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
    '@localixai/plugin-sdk/',
    '@localixai/plugin-sdk/backend',
    '@localixai/plugin-sdk/backend/tools',
    '@localixai/agent/agents/items',
    'lucide-react',
  ]) {
    expect(isPluginUiSharedModule(bundled)).toBe(false)
  }
})
