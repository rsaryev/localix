# `@localixai/markdown`

This private workspace package owns the Markdown grammar shared by the workspace, agent prompts, and
public documentation. Hosts supply navigation, media resolution, content actions, and styling.

## Entry points

| Import                                | Contract                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/markdown`                 | Dialect definitions, GFM and answer-block plugins, HTML sanitization, lazy math setup, syntax detection, and heading helpers. |
| `@localixai/markdown/dialect`         | Callout/container markers, fence languages, and prompt examples without browser imports.                                      |
| `@localixai/markdown/react`           | `Markdown`, its props and renderer overrides, callouts, answer tabs, file trees, and lazy diagrams.                           |
| `@localixai/markdown/markdown-stream` | Completion of partial fences, links, and formulas for streaming hosts.                                                        |

The manifest also exports source-level helper modules and the `MarkdownBlockquote`,
`AnswerVariants`, and `FileTree` component entries. Import paths resolve to TypeScript source; this
package has no build step or `dist` entry.

## Render a document

```tsx
import { Markdown } from '@localixai/markdown/react'

export function Article({ source }: { source: string }) {
  return (
    <article className="markdown-renderer">
      <Markdown headingIds>{source}</Markdown>
    </article>
  )
}
```

Use `components` to override links, images, and code rendering. The host supplies the kit stylesheet
and its document wrapper styles; the renderer does not install a CSS theme.

## Limits

- Raw HTML passes through `rehype-raw` and `rehype-sanitize`. Host renderer overrides remain the
  host's responsibility.
- Math loads only when formulas are detected. Dollar amounts, shell variables, and code stay
  literal.
- Mermaid uses strict security, a bounded cache, and one render queue. Failed imports are retryable;
  invalid diagrams retain their source and show the rendering error.
- File and agent mentions, task persistence, streaming cadence, and content actions belong to the
  workspace host. Repository links, screenshot resolution, copy controls, and article layout belong
  to the documentation host.

## Verification

From the repository root, run a focused parser or renderer test, or the package suite:

```bash
bun test packages/markdown/src
```

Workspace integration tests remain beside `MarkdownRendererImpl` in the UI.

## Related guides

- [Shared Markdown authoring](../../docs/extending/markdown.md)
- [Answer formatting](../../docs/features/answer-formatting.md)

## Source of truth

- [Package exports](package.json)
- [Root helpers](src/index.ts)
- [Portable React renderer](src/react.tsx)
- [Dialect grammar](src/dialect.ts)
- [Streaming completion](src/markdown-stream.ts)
- [Math and HTML plugins](src/markdownPlugins.ts)
- [Diagram renderer](src/renderMermaid.ts)
