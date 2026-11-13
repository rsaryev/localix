import { SITE } from '@/shared/config';
import { Footer } from '@/widgets/footer';
import { Nav } from '@/widgets/nav';
import { Components } from './Components';
import { Foundations } from './Foundations';

const SECTIONS = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape and motion'],
  ['components', 'Components'],
] as const;

/** /kit: the design system as it is in force on this site, drawn by the components themselves.
 *  The bar above and the footer below are specimens too. */
export function KitPage() {
  return (
    <>
      <Nav at="elsewhere" />
      <main id="main" className="kit wrap">
        <header className="docs-head">
          <p className="docs-label">UI kit</p>
          <h1>What {SITE.name} is drawn with</h1>
          <p className="docs-lede">
            The tokens and components of this site, each shown by the code the pages use, with this site’s theme
            applied. Change a token in <code>content/theme.css</code> and this page shows the result.
          </p>
          <nav className="kit-toc" aria-label="On this page">
            {SECTIONS.map(([id, title]) => (
              <a key={id} href={`#${id}`}>
                {title}
              </a>
            ))}
          </nav>
        </header>
        <Foundations />
        <Components />
      </main>
      <Footer />
    </>
  );
}
