// The kit page's script. The page is whole HTML from the build; this mounts the components that
// answer to a press (the install command, the download, the tour, the clip), and writes beside each token its value in force and,
// for a text colour, its contrast on the ground it is used on.
import { createRoot } from 'react-dom/client';
import { Clip } from '@/features/clip';
import { Download } from '@/features/download';
import { InstallCommand } from '@/features/install-command';
import { Tour } from '@/features/tour';
import type { Build, Clip as ClipContent, Tour as TourContent } from '@/shared/config';
import { Action } from '@/shared/ui';
import './entry-docs';

for (const island of document.querySelectorAll<HTMLElement>('[data-island="install"]')) {
  const tabs = JSON.parse(island.dataset.tabs ?? '[]') as [string, string][];
  createRoot(island).render(<InstallCommand tabs={tabs} />);
}

for (const island of document.querySelectorAll<HTMLElement>('[data-island="download"]')) {
  createRoot(island).render(
    <Download builds={JSON.parse(island.dataset.builds ?? '[]') as Build[]}>
      <Action href="#download">Get started</Action>
    </Download>,
  );
}
for (const island of document.querySelectorAll<HTMLElement>('[data-island="tour"]')) {
  if (island.dataset.tour) createRoot(island).render(<Tour tour={JSON.parse(island.dataset.tour) as TourContent} />);
}
for (const island of document.querySelectorAll<HTMLElement>('[data-island="clip"]')) {
  if (island.dataset.clip) createRoot(island).render(<Clip clip={JSON.parse(island.dataset.clip) as ClipContent} />);
}

const probe = document.createElement('span');
probe.hidden = true;
document.body.append(probe);

/** A custom property's colour as the browser resolves it, in sRGB. */
function rgb(token: string): [number, number, number] | undefined {
  probe.style.color = `var(${token})`;
  const parts = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(getComputedStyle(probe).color);
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : undefined;
}

/** WCAG 2's relative luminance. */
function luminance(colour: [number, number, number]): number {
  const [r, g, b] = colour.map((part) => {
    const c = part / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const root = getComputedStyle(document.documentElement);
for (const slot of document.querySelectorAll<HTMLElement>('[data-token]')) {
  const value = root.getPropertyValue(slot.dataset.token ?? '').trim().replace(/\s+/g, ' ');
  const [text, ground] = [rgb(slot.dataset.token ?? ''), slot.dataset.on && rgb(slot.dataset.on)];
  if (!text || !ground) {
    slot.textContent = value;
    continue;
  }
  const [a, b] = [luminance(text), luminance(ground)];
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  slot.textContent = `${value} · ${ratio.toFixed(1)}:1 ${ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'fails AA'}`;
}
probe.remove();
