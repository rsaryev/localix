import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { RuleGrammar } from '@/shared/api/contracts'
import { SectionLabel } from '@localixai/kit/section-label'

import { ACTION_COLORS } from './permissionActionColors'

/**
 * What a rule can say, rendered from what the SERVER says it can say.
 *
 * Every line here used to be prose in this file: the three effects, a handful of examples,
 * and no mention at all of the prefixes or the named classes. So the page explained a
 * vocabulary that had drifted from the engine's — and a class the engine understood was
 * documented nowhere a reader would look.
 *
 * Nothing in this component names a prefix, an effect or a class. It is a renderer.
 *
 * The effects are NOT listed here any more: what `allow`, `ask` and `deny` do is each option's
 * line in the Effect field itself, where the choice is made. What stays is what no single field
 * can say — the prefixes, the classes, the worked examples, and that order decides.
 */
export function PermissionLegend({ grammar }: { grammar: RuleGrammar }) {
  if (grammar.kinds.length === 0) return null
  return (
    <div className="mt-3 space-y-3">
      <Section title="Permission">
        <p className="mb-2 text-2xs leading-5 text-text-soft">
          The LAST matching rule decides, so an exception is written after the rule it excepts.
        </p>
        <Definitions
          items={grammar.kinds.map((kind) => ({
            term: kind.prefix,
            detail: `${kind.label} — ${kind.hint}`,
          }))}
        />
      </Section>

      <Section title="Applies to">
        <p className="mb-2 text-2xs leading-5 text-text-soft">
          A pattern — a command, a path, an agent id — with <code className="font-mono">*</code> for
          any run of characters. Or one of these named classes, which are answered by asking about
          the call rather than by matching its text:
        </p>
        <Definitions
          items={grammar.classes.map((entry) => ({
            term: entry.value,
            detail: entry.hint,
            // Which rows it is offered on — the reason `dangerous` does not appear on a plugin.
            note: entry.appliesTo.join(', '),
          }))}
        />
      </Section>

      <Section title="Examples">
        <div className="divide-y divide-border-faint">
          {grammar.examples.map((example) => (
            <div
              key={`${example.action} ${example.resource} ${example.effect}`}
              className="flex flex-wrap items-start gap-x-2 gap-y-0.5 py-1.5 text-2xs @md:flex-nowrap"
            >
              <div className="flex shrink-0 items-center gap-1 font-mono text-text-soft">
                <span>{example.action}</span>
                <span>·</span>
                <span>{example.resource}</span>
                <span>→</span>
                <span className={cn('font-medium', ACTION_COLORS[example.effect])}>
                  {example.effect}
                </span>
              </div>
              <span className="text-text-soft">{example.note}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-faint pt-2.5">
      <SectionLabel weight="semibold" className="mb-2">
        {title}
      </SectionLabel>
      {children}
    </div>
  )
}

/** A term and what it means — the same two columns for prefixes and for classes. */
function Definitions({ items }: { items: Array<{ term: string; detail: string; note?: string }> }) {
  return (
    <div className="divide-y divide-border-faint">
      {items.map((item) => (
        <div
          key={item.term}
          className="flex flex-wrap items-start gap-x-2 gap-y-0.5 py-1.5 text-2xs @md:flex-nowrap"
        >
          <span className="w-40 shrink-0 font-mono text-text-soft">{item.term}</span>
          <span className="text-text-soft">{item.detail}</span>
          {item.note && <span className="ml-auto shrink-0 text-text-soft">{item.note}</span>}
        </div>
      ))}
    </div>
  )
}
