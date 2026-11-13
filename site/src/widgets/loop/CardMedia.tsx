import { Clip } from '@/features/clip';
import { Film } from '@/features/film';
import type { Media } from '@/shared/config';
import { Panel } from '@/shared/ui';

/** What a card shows beside its words: a drawn terminal, a picture, a clip or a recording.
 *  `title` is the card's, for a terminal that names nothing itself. */
export function CardMedia({ media, title }: { media: Media; title: string }) {
  switch (media.kind) {
    case 'terminal':
      return <Panel blocks={media.blocks} label={media.label ?? `${title}: what the terminal shows`} />;
    case 'image':
      return (
        // The picture itself is the link to it whole: a screenshot is read at its own size.
        <a className="loop-shot" href={media.src} aria-label={`${media.alt} (open the picture)`}>
          <img src={media.src} alt={media.alt} width={media.width} height={media.height} loading="lazy" decoding="async" />
        </a>
      );
    case 'video':
      return <Clip clip={media} />;
    case 'film':
      return <Film src={media.src} label={media.label} />;
  }
}
