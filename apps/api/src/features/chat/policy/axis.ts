/**
 * ONE AXIS OF A RUN'S POLICY: the variants a run can be on one dimension, first match wins.
 *
 * A run varies along independent dimensions — which host runs it, whether the conversation has
 * colleagues, whether a person can answer, why this turn started. Each dimension used to be
 * answered inline wherever a stage happened to need it, and the same question ended up with
 * five spellings that disagreed at the edges. An axis answers it once: its variants are tried
 * in order, the first whose `applies` holds decides, and the decision is a typed value every
 * consumer reads instead of re-deriving it.
 *
 * Variants on one axis are mutually exclusive by construction (first match wins). Axes are
 * orthogonal, so a new behaviour is a new variant on its axis — or a new axis — and never a
 * new branch in a stage. Pure: no I/O, no clock; the facts arrive whole.
 */

export interface AxisVariant<Facts, Decision> {
  /** Stable name, recorded in the policy trace (`why does this run see X`). */
  readonly id: string
  applies(facts: Facts): boolean
  decide(facts: Facts): Decision
}

export interface Axis<Facts, Decision> {
  readonly name: string
  readonly variants: readonly AxisVariant<Facts, Decision>[]
}

/** The decision an axis reached, and which variant reached it. */
export interface AxisChoice<Decision> {
  readonly variant: string
  readonly decision: Decision
}

export function defineAxis<Facts, Decision>(
  name: string,
  variants: readonly AxisVariant<Facts, Decision>[],
): Axis<Facts, Decision> {
  return { name, variants }
}

/**
 * The first variant that applies decides. An axis whose variants do not cover its facts is a
 * definition bug, never a state to run on, so it throws rather than falling back silently.
 */
export function chooseOn<Facts, Decision>(
  axis: Axis<Facts, Decision>,
  facts: Facts,
): AxisChoice<Decision> {
  const variant = axis.variants.find((candidate) => candidate.applies(facts))
  if (!variant) throw new Error(`No ${axis.name} variant applies to these facts`)
  return { variant: variant.id, decision: variant.decide(facts) }
}
