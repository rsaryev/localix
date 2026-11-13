import './Chapters.css';

/** One quiet line under a demo: its chapters, each a button that goes to it (the one shown is
 *  marked), and at the right the button that plays or pauses it. */
export function Chapters({
  labels,
  current,
  onPick,
  toggle,
}: {
  labels: string[];
  current: number;
  onPick: (at: number) => void;
  toggle: { label: string; disabled?: boolean; onPress: () => void };
}) {
  return (
    <div className="chapters">
      <span className="chapters-list">
        {labels.map((label, at) => (
          <button key={label} type="button" aria-current={at === current ? 'step' : undefined} onClick={() => onPick(at)}>
            {label}
          </button>
        ))}
      </span>
      <button type="button" className="chapters-toggle" disabled={toggle.disabled} onClick={toggle.onPress}>
        {toggle.label}
      </button>
    </div>
  );
}
