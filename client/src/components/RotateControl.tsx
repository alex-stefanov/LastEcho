interface Props {
  on: boolean;
  onToggle: () => void;
}

export default function RotateControl({ on, onToggle }: Props) {
  return (
    <button
      className={`rotate-toggle panel${on ? ' on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
      title={on ? 'Auto-rotation on — click to stop' : 'Auto-rotation off — click to spin'}
    >
      <svg className="ico" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M12.2 6A5.2 5.2 0 1 0 11 9.6" />
        <path d="M12.4 2.2v3.4H9" />
      </svg>
      <span>{on ? 'Rotating' : 'Paused'}</span>
    </button>
  );
}
