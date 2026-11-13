import { LANDING, RELEASES } from '@/shared/config';
import { SectionHead } from '@/shared/ui';
import './Releases.css';

/** A changelog's date ("2026-11-03") as people read it ("Nov 3, 2026"), the same on every machine. */
const readable = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The latest releases, read from CHANGELOG.md as the site is built: the version and its date on
 *  the left, what it brings, and how much it lists under that. Drawn when the landing's content
 *  has `releases` and the changelog has one. */
export function Releases() {
  const releases = LANDING.releases;
  if (!releases || RELEASES.length === 0) return null;
  return (
    <section className="releases wrap" aria-labelledby="releases-title">
      <SectionHead
        id="releases-title"
        title={releases.title}
        aside={
          releases.more && (
            <a className="label" href={releases.more.href}>
              {releases.more.label} →
            </a>
          )
        }
      />
      <ol>
        {RELEASES.map((release) => (
          <li key={release.version} className="reveal">
            <p className="releases-when">
              <span className="releases-version">v{release.version}</span>
              {release.date && <time dateTime={release.date}>{readable(release.date)}</time>}
            </p>
            <div>
              {release.summary && <p className="releases-summary">{release.summary}</p>}
              {release.changes > 0 && (
                <p className="releases-changes">
                  {release.changes} {release.changes === 1 ? 'change' : 'changes'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
