import { expect, test } from 'bun:test'

import { PLUGIN_NAME_RE, toPluginName } from './scaffold'

// A creation refused for its name's shape cost the model a round trip to fix a mechanical rule,
// so the host applies the rule; whatever comes out must be a name the scaffold accepts.
test.each([
  ['gpu-monitor', 'gpu-monitor'],
  ['GPU Monitor', 'gpu-monitor'],
  ['gpu_monitor', 'gpu-monitor'],
  ['GpuMonitor', 'gpu-monitor'],
  ['  --café menu--  ', 'cafe-menu'],
  ['2048 game', 'game'],
  // A Cyrillic word ("monitor") from code points: no ASCII survives, so the fallback name is used.
  [String.fromCodePoint(0x043c, 0x043e, 0x043d, 0x0438, 0x0442, 0x043e, 0x0440), 'my-plugin'],
  ['', 'my-plugin'],
  ['a'.repeat(80), 'a'.repeat(40)],
])('%p becomes %p', (raw, name) => {
  expect(toPluginName(raw)).toBe(name)
  expect(PLUGIN_NAME_RE.test(toPluginName(raw))).toBe(true)
})
