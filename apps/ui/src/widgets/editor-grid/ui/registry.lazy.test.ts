import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./registry.tsx', import.meta.url), 'utf8')

test('keeps the sandboxed view runtime off the empty-workbench startup path', () => {
  // A plugin view pulls in the sandboxed iframe runtime. It is needed only after such a tab opens,
  // under WorkItemBody's existing local Suspense boundary.
  expect(source).not.toMatch(
    /import\s+\{\s*BridgedPluginView\s*\}\s+from\s+['"]@\/features\/inspector\/ui\/BridgedPluginView['"]/,
  )
  expect(source).toContain("import('@/features/inspector/ui/BridgedPluginView')")
  expect(source).toContain('<Suspense fallback={<LoadingHint')
})

test('keeps diff parsing and highlighting behind the work-item boundary', () => {
  expect(source).not.toMatch(/from\s+['"]@\/shared\/ui\/diff['"]/)
  expect(source).not.toMatch(/from\s+['"]\.\/DiffWorkItemBody['"]/)
  expect(source).toContain("import('./DiffWorkItemBody')")
  expect(source).toContain('<DiffWorkItemBody item={item} />')
})

test('every work item body learns whether it is the FOCUSED one', () => {
  // Window-singleton contributions (the status bar) must key off `focused`, not
  // `visible`: a side-by-side split has two visible bodies and warm keep-alive
  // mounts hidden ones, so `visible` would contribute two or more entries.
  expect(source).toContain('<WorkItemFocusProvider focused={props.focused}>')
  const groupView = readFileSync(new URL('./GroupView.tsx', import.meta.url), 'utf8')
  expect(groupView).toContain('focused={isFocused && id === visibleActive}')
})
