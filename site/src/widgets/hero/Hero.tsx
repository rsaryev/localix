import { Clip } from '@/features/clip';
import { Download } from '@/features/download';
import { Film } from '@/features/film';
import { InstallCommand } from '@/features/install-command';
import { Tour } from '@/features/tour';
import { LANDING, SITE } from '@/shared/config';
import { rich } from '@/shared/lib/rich';
import { Action } from '@/shared/ui';
import './Hero.css';

/** The landing, one screen: what the product is and how to get it on the left; on the right the
 *  product itself, its window in stills or a real run of it at a terminal. The way to get it is
 *  one thing: the download and the other ways in as a row of actions where the site has builds,
 *  the install command otherwise; then one quiet line. */
export function Hero() {
  const { title, lede, under, links, film, tour, clip } = LANDING.hero;
  return (
    <section className="hero wrap">
      <div className="hero-copy">
        <h1>
          {title.chip && (
            <>
              <span className="hero-lead">
                <span className="hero-chip">{title.chip}</span>
                {title.after}
              </span>{' '}
            </>
          )}
          {title.rest}
        </h1>
        <p className="lede">{rich(lede)}</p>
        {SITE.downloads ? (
          <Download builds={SITE.downloads} after={rich(under)}>
            {links?.map((link) => (
              <Action key={link.href} href={link.href}>
                {link.label}
              </Action>
            ))}
          </Download>
        ) : (
          <>
            {SITE.install && <InstallCommand tabs={SITE.install} />}
            <p className="hero-under">{rich(under)}</p>
          </>
        )}
      </div>
      {(clip ?? tour ?? film) && (
        <figure className="hero-demo">
          {clip ? <Clip clip={clip} /> : tour ? <Tour tour={tour} /> : film && <Film src={film.src} label={film.label} />}
        </figure>
      )}
    </section>
  );
}
