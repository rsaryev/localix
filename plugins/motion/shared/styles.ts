/**
 * Directions. Each is a complete film in `plugins/motion/directions/<id>/` with its own idea,
 * copy, layout grammar and motion signature, plus the tokens and rules below. The agent forks the
 * film (`create`) or applies only the vector — tokens to blocks/style.css, rules to DIRECTION.md —
 * to a film it structures itself (`restyle`).
 */
export interface MotionStyle {
  id: string
  name: string
  category: string
  description: string
  /** The format the direction's film is composed for. */
  format: 'landscape' | 'portrait' | 'square'
  /** Film second that shows the direction best: gallery still and poster. */
  poster: number
  /** Kit custom properties (without the leading --). */
  tokens: Record<string, string>
  direction: {
    palette: string
    type: string
    motion: string
    composition: string
    transitions: string
    avoid: string
  }
}

const sans = 'ui-sans-serif, system-ui, -apple-system, sans-serif'
const serif = 'ui-serif, Georgia, serif'

export const motionStyles: MotionStyle[] = [
  {
    id: 'blackout',
    format: 'landscape',
    poster: 2.2,
    name: 'Blackout',
    category: 'Typography',
    description:
      'Oversized type, a measured grid and sharp hooks. Monochrome with room to breathe.',
    tokens: {
      'mk-bg': '#050506',
      'mk-surface': '#111114',
      'mk-line': 'rgba(255,255,255,0.09)',
      'mk-text': '#f5f5f2',
      'mk-muted': '#85858a',
      'mk-accent': '#f5f5f2',
      'mk-display-weight': '800',
      'mk-display-tracking': '-0.05em',
      'mk-radius': '0px',
      'mk-grain': '0.09',
      'mk-glow': '18%',
      'mk-ease-enter': 'expo.out',
      'mk-tempo': '0.9',
    },
    direction: {
      palette:
        'Black and bone white only; one grey for labels. No colour accent — contrast is the accent.',
      type: 'Huge tight headlines (12–16u), 2–4 words per line, line masks. Tracked caps labels.',
      motion:
        'Decisive expo.out arrivals, hard holds, fast exits. One move per beat; stillness between.',
      composition:
        'A measured grid (mk-gridlines), left-aligned type on strong axes, generous black.',
      transitions: 'Hard cuts on the beat and straight wipes. No fades, no blur.',
      avoid: 'Gradients, glows, rounded cards, colour, playful overshoot.',
    },
  },
  {
    id: 'relay',
    format: 'landscape',
    poster: 9.6,
    name: 'Relay',
    category: 'Product',
    description:
      'A camera study: a tactile app dock, a close-up of the product and a wide pullback.',
    tokens: {
      'mk-bg': '#07080b',
      'mk-surface': '#13151b',
      'mk-line': 'rgba(255,255,255,0.08)',
      'mk-text': '#f3f5fa',
      'mk-muted': '#8a90a0',
      'mk-accent': '#7aa2ff',
      'mk-radius': 'calc(var(--u) * 2.2)',
      'mk-grain': '0.05',
      'mk-glow': '30%',
      'mk-ease-move': 'power3.inOut',
      'mk-tempo': '1',
    },
    direction: {
      palette:
        'Deep blue-black, cool steel neutrals, one electric blue accent for the interaction.',
      type: 'Medium-weight sans, sentence case, short product lines under the UI.',
      motion:
        'The camera moves: tilt that settles flat, zoom 1.6–2× into the detail, wide pullback at the end.',
      composition:
        'The real product UI is the hero (mk-browser with an imported screenshot); text is secondary.',
      transitions:
        'Scale-through and zoom transitions that follow the camera; blur-through for big turns.',
      avoid: 'Text-only scenes longer than the hook; mock UIs when a real screenshot exists.',
    },
  },
  {
    id: 'nightfall',
    format: 'landscape',
    poster: 14.6,
    name: 'Nightfall',
    category: 'Brand',
    description: 'Warm graphite, a slower aperture reveal and a measured brand signature.',
    tokens: {
      'mk-bg': '#16161a',
      'mk-surface': '#222228',
      'mk-line': 'rgba(255,255,255,0.08)',
      'mk-text': '#ecebe7',
      'mk-muted': '#9a9aa2',
      'mk-accent': '#ff7a45',
      'mk-display': serif,
      'mk-display-weight': '500',
      'mk-display-tracking': '-0.02em',
      'mk-grain': '0.08',
      'mk-ease-enter': 'power4.out',
      'mk-tempo': '1.3',
    },
    direction: {
      palette: 'Graphite and warm off-white; ember orange used once per scene.',
      type: 'A serif display at medium weight, quiet sans for labels.',
      motion:
        'Slow, calm arrivals (1–1.4 s), long holds, an iris/aperture reveal for the brand mark.',
      composition: 'Centred, symmetrical, lots of negative space; a single glowing focal point.',
      transitions: 'Iris and soft fades only.',
      avoid: 'Fast cuts, bouncy easing, busy UI, more than two elements moving at once.',
    },
  },
  {
    id: 'orbit',
    format: 'landscape',
    poster: 3,
    name: 'Orbit',
    category: 'Product',
    description: 'A rotating, faceted token before a crisp product reveal.',
    tokens: {
      'mk-bg': '#0b0d12',
      'mk-surface': '#151922',
      'mk-line': 'rgba(255,255,255,0.08)',
      'mk-text': '#eef3f6',
      'mk-muted': '#8b97a3',
      'mk-accent': '#9cf0d0',
      'mk-radius': 'calc(var(--u) * 3)',
      'mk-glow': '40%',
      'mk-tempo': '1',
    },
    direction: {
      palette: 'Ink with a mint accent and soft glows.',
      type: 'Clean sans, sentence case, short benefit lines.',
      motion:
        'A hero object rotates or orbits (rotate/scale drift) before the product lands; one spring pop on the logo.',
      composition: 'Hero object centre, product UI enters from below with a tilt that settles.',
      transitions: 'Zoom and blur-through.',
      avoid: 'Flat static frames; more than one orbiting element.',
    },
  },
  {
    id: 'type-play',
    format: 'landscape',
    poster: 2,
    name: 'Type play',
    category: 'Typography',
    description: 'Poster type that shouts: lines that stack, swap and punch on the beat.',
    tokens: {
      'mk-bg': '#e9f56b',
      'mk-surface': '#f4fbb4',
      'mk-line': 'rgba(0,0,0,0.12)',
      'mk-text': '#111111',
      'mk-muted': '#3d3f1a',
      'mk-accent': '#ff3d00',
      'mk-display-weight': '900',
      'mk-display-case': 'uppercase',
      'mk-display-tracking': '-0.02em',
      'mk-radius': '0px',
      'mk-grain': '0.06',
      'mk-ease-pop': 'back.out(2)',
      'mk-tempo': '0.8',
    },
    direction: {
      palette: 'Acid yellow ground, black type, one hot orange word.',
      type: 'Heavy uppercase, stacked lines that fill the frame; word carousels for the changing word.',
      motion:
        'Brisk: chars and words land fast (30–60 ms staggers), scale punches on the beat word.',
      composition: 'Type is the image. Edge-to-edge, tight leading, no UI.',
      transitions: 'Hard cuts and slides on the beat.',
      avoid: 'Thin weights, long sentences, soft fades.',
    },
  },
  {
    id: 'daylight',
    format: 'portrait',
    poster: 3,
    name: 'Daylight',
    category: 'Social',
    description: 'Soft, bright and friendly — made for a vertical feed.',
    tokens: {
      'mk-bg': '#f6e9e4',
      'mk-surface': '#fffaf7',
      'mk-line': 'rgba(0,0,0,0.08)',
      'mk-text': '#1d1b1a',
      'mk-muted': '#6f6560',
      'mk-accent': '#e5484d',
      'mk-display-weight': '700',
      'mk-display-tracking': '-0.03em',
      'mk-radius': 'calc(var(--u) * 3)',
      'mk-grain': '0.03',
      'mk-glow': '22%',
      'mk-ease-pop': 'back.out(1.3)',
      'mk-display': 'ui-rounded, "SF Pro Rounded", ui-sans-serif, system-ui, sans-serif',
      'mk-tempo': '1.05',
    },
    direction: {
      palette: 'Blush paper, warm near-black, a single coral accent.',
      type: 'Rounded-feeling bold sans, big and short; captions in mk-caption boxes.',
      motion: 'Friendly springs, cards that stack and gather, gentle overshoot once per scene.',
      composition:
        'Portrait-first: content in the central 4:5, large cards, thumb-friendly captions.',
      transitions: 'Slides and soft wipes.',
      avoid: 'Dark grounds, tiny text, dense UI.',
    },
  },
  {
    id: 'connect',
    format: 'landscape',
    poster: 4,
    name: 'Connect',
    category: 'Explainer',
    description: 'Separate ideas gather into one clear system.',
    tokens: {
      'mk-bg': '#1534d1',
      'mk-surface': '#2445ea',
      'mk-line': 'rgba(255,255,255,0.18)',
      'mk-text': '#ffffff',
      'mk-muted': '#c3cdff',
      'mk-accent': '#ffe14d',
      'mk-radius': 'calc(var(--u) * 2)',
      'mk-grain': '0.04',
      'mk-tempo': '1',
    },
    direction: {
      palette: 'Saturated cobalt, white, a yellow highlight for the key idea.',
      type: 'Clear sans, one statement per scene, annotated keywords (MK.annotate marker).',
      motion:
        'Items arrive separately, then gather into one stack or diagram; lines draw between them.',
      composition: 'Diagram logic: steps, connectors (MK.drawPath), numbered cards.',
      transitions: 'Wipes in reading direction.',
      avoid: 'Decoration without meaning; more than three items per scene.',
    },
  },
  {
    id: 'momentum',
    format: 'landscape',
    poster: 3,
    name: 'Momentum',
    category: 'Data',
    description: 'Real figures, rising bars and a headline number that counts up.',
    tokens: {
      'mk-bg': '#f2f1ec',
      'mk-surface': '#ffffff',
      'mk-line': 'rgba(0,0,0,0.08)',
      'mk-text': '#111111',
      'mk-muted': '#6b6a64',
      'mk-accent': '#1f8a5b',
      'mk-display-weight': '750',
      'mk-display-tracking': '-0.04em',
      'mk-radius': 'calc(var(--u) * 1)',
      'mk-grain': '0.03',
      'mk-tempo': '1',
    },
    direction: {
      palette: 'Paper white, ink, one green for growth.',
      type: 'Tabular figures (mk-stat), small tracked labels, an honest source line.',
      motion: 'Counters roll, bars grow with staggers, the key figure gets a hand-drawn circle.',
      composition: 'One number per scene; charts with labelled axes; show the source.',
      transitions: 'Wipes up, following growth.',
      avoid: 'Invented numbers, 3D charts, unlabeled values.',
    },
  },
  {
    id: 'soft-signal',
    format: 'landscape',
    poster: 2.6,
    name: 'Soft signal',
    category: 'Brand',
    description: 'Planes fold into a glowing brand mark.',
    tokens: {
      'mk-bg': '#1b1640',
      'mk-surface': '#251f55',
      'mk-line': 'rgba(255,255,255,0.1)',
      'mk-text': '#f1eefe',
      'mk-muted': '#a59fd0',
      'mk-accent': '#a78bfa',
      'mk-radius': 'calc(var(--u) * 2)',
      'mk-grain': '0.04',
      'mk-glow': '48%',
      'mk-ease-enter': 'power4.out',
      'mk-tempo': '1.2',
    },
    direction: {
      palette: 'Deep violet, lavender light, glow on the mark only.',
      type: 'Light-to-regular sans, generous tracking on labels.',
      motion: 'Shapes fold and slide into the logo; slow glows; one light leak at the climax.',
      composition: 'Logo-centred, layered translucent planes, depth through scale.',
      transitions: 'Blur-through and fades.',
      avoid: 'Hard edges everywhere, fast cuts, busy copy.',
    },
  },
  {
    id: 'offbeat',
    format: 'portrait',
    poster: 2.5,
    name: 'Offbeat',
    category: 'Events',
    description: 'An event poster that moves: loud colour and rhythmic type.',
    tokens: {
      'mk-bg': '#ff5a1f',
      'mk-surface': '#ff7a47',
      'mk-line': 'rgba(0,0,0,0.15)',
      'mk-text': '#1a0e08',
      'mk-muted': '#5c2a12',
      'mk-accent': '#fff2e0',
      'mk-display-weight': '900',
      'mk-display-case': 'uppercase',
      'mk-display-tracking': '-0.03em',
      'mk-radius': '0px',
      'mk-ease-pop': 'back.out(1.8)',
      'mk-tempo': '0.85',
    },
    direction: {
      palette: 'Ember orange, near-black type, cream highlights.',
      type: 'Heavy uppercase poster type; date and place set big.',
      motion:
        'Rhythmic: lines slide in alternating directions on a steady beat; starburst behind the date.',
      composition: 'Poster grid, big date block, portrait-friendly.',
      transitions: 'Slides and hard cuts on the beat.',
      avoid: 'Subtle greys, long paragraphs.',
    },
  },
  {
    id: 'field-notes',
    format: 'landscape',
    poster: 3,
    name: 'Field notes',
    category: 'Editorial',
    description: 'A serif editorial page, a tracked document handoff and a measured pullback.',
    tokens: {
      'mk-bg': '#f2efe6',
      'mk-surface': '#fbfaf5',
      'mk-line': 'rgba(0,0,0,0.09)',
      'mk-text': '#1b1b18',
      'mk-muted': '#6c6a60',
      'mk-accent': '#1e6b52',
      'mk-display': serif,
      'mk-display-weight': '500',
      'mk-display-tracking': '-0.015em',
      'mk-radius': 'calc(var(--u) * 0.6)',
      'mk-grain': '0.05',
      'mk-ease-enter': 'power3.out',
      'mk-tempo': '1.25',
    },
    direction: {
      palette: 'Paper, ink and a deep green; feels printed.',
      type: 'Serif headlines, small caps labels, real paragraphs allowed (still short).',
      motion: 'Measured: pages slide in, lines reveal, a slow pullback ends on the page.',
      composition: 'Editorial columns, margins, a document or screenshot as a page.',
      transitions: 'Page slides and gentle fades.',
      avoid: 'Neon, glow, heavy grain, bouncy motion.',
    },
  },
]

export const DEFAULT_STYLE = 'blackout'
export const styleById = (id: string) => motionStyles.find((style) => style.id === id)

/** blocks/style.css for a project: the direction's tokens over the kit defaults. */
export function styleCss(style: MotionStyle) {
  const vars = Object.entries(style.tokens).map(([name, value]) => `  --${name}: ${value};`)
  return `/* Direction: ${style.name}. Edit freely; motion_studio restyle replaces this file. */\n:root {\n  --mk-sans: ${sans};\n${vars.join('\n')}\n}\n`
}

/** DIRECTION.md for a project: the rules the agent follows. */
export function styleMarkdown(style: MotionStyle) {
  const d = style.direction
  return `# Direction: ${style.name}\n\n${style.description}\n\nFollow this direction in every scene. Tokens live in \`blocks/style.css\`; use the \`--mk-*\` variables, not literal colours.\n\n- **Palette:** ${d.palette}\n- **Type:** ${d.type}\n- **Motion:** ${d.motion}\n- **Composition:** ${d.composition}\n- **Transitions:** ${d.transitions}\n- **Avoid:** ${d.avoid}\n`
}
