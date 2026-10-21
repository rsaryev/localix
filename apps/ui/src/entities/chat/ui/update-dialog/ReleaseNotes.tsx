import ReactMarkdown, { type Components } from 'react-markdown'

const group = ({ children }: { children?: React.ReactNode }) => (
  <h4 className="pt-1 text-2xs font-medium tracking-wide text-text-faint uppercase">{children}</h4>
)

// The notes are the version's CHANGELOG section: an opening sentence, `### Added / Changed /
// Fixed` groups and bullets. Drawn at the dialog's own scale rather than as a chat message, and
// links stay text: the dialog is for deciding about a restart, not for leaving it.
const components: Components = {
  h1: group,
  h2: group,
  h3: group,
  h4: group,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="flex flex-col gap-1.5">{children}</ul>,
  ol: ({ children }) => <ul className="flex flex-col gap-1.5">{children}</ul>,
  li: ({ children }) => (
    <li className="relative pl-3.5 before:absolute before:top-[0.6em] before:left-0.5 before:size-1 before:rounded-full before:bg-text-faint">
      {children}
    </li>
  ),
  strong: ({ children }) => <strong className="font-medium text-text-strong">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded-sm bg-surface-hover px-1 py-px font-mono text-[0.9em]">
      {children}
    </code>
  ),
  // A code block keeps its lines but wraps them: the dialog has one scroll axis, and it is vertical.
  pre: ({ children }) => (
    <pre className="rounded-md bg-surface-hover p-2 font-mono text-[0.9em] break-all whitespace-pre-wrap">
      {children}
    </pre>
  ),
  a: ({ children }) => <span className="text-text-strong">{children}</span>,
  img: () => null,
}

/** The release notes of the version on offer, in the update dialog. */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    // `wrap-anywhere`: a long URL or identifier breaks rather than widening the dialog.
    <div className="flex min-w-0 flex-col gap-2 text-xs/relaxed wrap-anywhere text-text-soft">
      <ReactMarkdown components={components}>{markdown}</ReactMarkdown>
    </div>
  )
}
