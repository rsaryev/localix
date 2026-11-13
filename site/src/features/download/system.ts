import type { Build } from '@/shared/config';

/** The reader's system as a build names it, from what the browser says of itself. Undefined when
 *  it says nothing known, and on a phone or a tablet, which no build is for. */
export function system(): Build['os'] | undefined {
  const browser = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const agent = browser.userAgent;
  if (browser.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(agent)) return undefined;
  const says = browser.userAgentData?.platform || browser.platform || agent;
  // An iPad says it is a Mac: it is the one with a touch screen.
  if (/mac/i.test(says)) return browser.maxTouchPoints > 1 ? undefined : 'macos';
  if (/win/i.test(says)) return 'windows';
  if (/linux|x11/i.test(says)) return 'linux';
  return undefined;
}
