import { describe, expect, test } from 'bun:test'

import { runRule } from '../testing/run-rule.ts'

const RULE = 'props-type-naming'
const IN_UI = { filename: 'apps/ui/src/features/demo/Widget.tsx' }

describe(RULE, () => {
  test('reports a locally declared props type named after nothing in particular', async () => {
    const findings = await runRule(
      RULE,
      `interface Options { a: string }
       export function Widget(props: Options) { return null }`,
      IN_UI,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('WidgetProps')
  })

  test('accepts the matching name', async () => {
    const findings = await runRule(
      RULE,
      `interface WidgetProps { a: string }
       export function Widget(props: WidgetProps) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('accepts a deliberate prefix, as the SDK uses for its public contracts', async () => {
    const findings = await runRule(
      RULE,
      `interface PluginWidgetProps { a: string }
       export function Widget(props: PluginWidgetProps) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('accepts a type alias declared after the component', async () => {
    const findings = await runRule(
      RULE,
      `export function Widget(props: WidgetProps) { return null }
       type WidgetProps = { a: string }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('leaves a shared contract from another file alone', async () => {
    // Renaming a contract a dozen other components import would be a defect, not a fix.
    const findings = await runRule(
      RULE,
      `import type { ResourceListProps } from './types'
       export function DeploymentsList(props: ResourceListProps) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('leaves a generic instantiation alone', async () => {
    const findings = await runRule(
      RULE,
      `interface Options { a: string }
       export function Widget(props: PropsWithChildren<Options>) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('ignores an inline object annotation', async () => {
    const findings = await runRule(
      RULE,
      `export function Widget(props: { a: string }) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('ignores a non-component function', async () => {
    const findings = await runRule(
      RULE,
      `interface Options { a: string }
       export function helper(input: Options) { return input }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('ignores a plain .ts file', async () => {
    const findings = await runRule(
      RULE,
      `interface Options { a: string }
       export function Widget(props: Options) { return null }`,
      { filename: 'apps/ui/src/helpers.ts' },
    )
    expect(findings).toEqual([])
  })

  test('leaves a local contract shared by several components alone', async () => {
    // One `LayoutProps` rendered as Wide and Narrow: there is no single component to name it after.
    const findings = await runRule(
      RULE,
      `interface LayoutProps { a: string }
       export function Wide(props: LayoutProps) { return null }
       export function Narrow(props: LayoutProps) { return null }`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })

  test('accepts a memoized inner component named for its exported wrapper', async () => {
    const findings = await runRule(
      RULE,
      `interface MessageCardProps { a: string }
       function MessageCardImpl(props: MessageCardProps) { return null }
       export const MessageCard = memo(MessageCardImpl)`,
      IN_UI,
    )
    expect(findings).toEqual([])
  })
})
