import { rich } from '@/shared/lib/rich';
import { ANSI, SHAPE, SURFACES, type Swatch, SYNTAX, TEXT, TYPE } from './tokens';

function Swatches({ list }: { list: Swatch[] }) {
  return (
    <ul className="kit-swatches">
      {list.map(({ name, use, on = '--black', text }) => (
        <li key={name} className="kit-swatch">
          <span
            className={text ? 'kit-chip kit-chip-text' : 'kit-chip'}
            style={text ? { background: `var(${on})`, color: `var(${name})` } : { background: `var(${name})` }}
            aria-hidden="true"
          >
            {text && 'Aa'}
          </span>
          <span className="kit-swatch-name">
            <code>{name}</code>
            {/* Filled in by the page's script from the styles in force: the value, and for text its
                contrast on the ground it is used on. */}
            <span className="kit-value" data-token={name} {...(text && { 'data-on': on })} />
          </span>
          <span className="kit-swatch-use">{use}</span>
        </li>
      ))}
    </ul>
  );
}

/** What everything is made of: colour, type, shape and motion, each a custom property. */
export function Foundations() {
  return (
    <>
      <section className="kit-section" aria-labelledby="colour">
        <h2 id="colour">Colour</h2>
        <p className="kit-note">
          One ground, three steps of text, and hairlines. Colour is never decoration: green and red appear only where they
          mean done and wrong. Every text colour meets WCAG AA (4.5:1) on the ground it is used on; the ratio beside each
          is measured on this page.
        </p>
        <h3>Surfaces and lines</h3>
        <Swatches list={SURFACES} />
        <h3>Text</h3>
        <Swatches list={TEXT} />
        <h3>Code and status</h3>
        <Swatches list={SYNTAX} />
        <h3>A recording's colours</h3>
        <Swatches list={ANSI} />
      </section>

      <section className="kit-section" aria-labelledby="type">
        <h2 id="type">Type</h2>
        <p className="kit-note">
          Three variable fonts, self-hosted: <code>--display</code> for headings, <code>--text</code> for reading,{' '}
          <code>--mono</code> for code. Sizes are in rem and the root grows with the window, so a wide monitor scales the
          page instead of leaving it a narrow column.
        </p>
        <ul className="kit-type">
          {TYPE.map(({ name, className, sample, use }) => (
            <li key={name}>
              <p className={className}>{sample}</p>
              <p className="kit-meta">
                <code>{name}</code> {use}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="kit-section" aria-labelledby="shape">
        <h2 id="shape">Shape and motion</h2>
        <ul className="kit-swatches">
          {SHAPE.map(({ name, use }) => (
            <li key={name} className="kit-swatch">
              <span className="kit-swatch-name">
                <code>{name}</code>
                <span className="kit-value" data-token={name} />
              </span>
              <span className="kit-swatch-use">{rich(use)}</span>
            </li>
          ))}
        </ul>
        <p className="kit-note">
          Motion is the first paint and a card’s lines coming in, once. With <code>prefers-reduced-motion</code> nothing
          moves. Anything pressable is at least 44 px tall on the landing’s bar and 36 px elsewhere, and shows the same
          focus ring: tab through this page to see it.
        </p>
      </section>
    </>
  );
}
