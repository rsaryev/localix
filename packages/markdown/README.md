# @localixai/markdown

The Markdown grammar shared by the workspace, agent prompt and public documentation.

- `dialect`: callout/container markers, fence languages and prompt examples; no browser imports.
- Root: GFM and answer-block plugins, safe HTML, lazy cached math, syntax detection and headings.
- `react`: a document renderer with host overrides for links, images and code blocks. Includes
  callouts, tabs, file trees and lazy Mermaid diagrams. Typography comes from the Localix kit.
- `markdown-stream`: completion of partial fences, links and formulas for streaming hosts.

```tsx
import { Markdown } from '@localixai/markdown/react'

;<article className="markdown-renderer">
  <Markdown headingIds components={hostComponents}>
    {source}
  </Markdown>
</article>
```

Raw HTML passes through `rehype-raw` and `rehype-sanitize`. Math loads only for formulas; dollar
amounts, shell variables and code stay literal. Mermaid uses strict security, a bounded cache and
one render queue. Failed imports are retryable and invalid diagrams retain their source.

The workspace owns file/agent mentions, task persistence, streaming cadence and content actions. The
documentation host owns repository links, screenshot resolution, code copy and page layout. Neither
host implements a second Markdown grammar.

Run `bun test packages/markdown/src` for parser and portable-renderer regressions. Workspace
integration tests remain beside `MarkdownRendererImpl`.
