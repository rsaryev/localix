const base = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function Copy() {
  return (
    <svg {...base}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function Check() {
  return (
    <svg {...base}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Search() {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg {...base}>
      <path d="M19 12H5m7 7-7-7 7-7" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg {...base}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg {...base}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The letter that opens the reading options. */
export function Type() {
  return (
    <svg {...base}>
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  );
}
