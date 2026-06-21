import { GROUP_COLOR, LEVEL_LABEL, type VitalityGroup, type YearRisk } from '../data/timeline';
import type { ClusterMember } from './GlobeView';

interface Props {
  members: ClusterMember[];
  onSelect: (iso: string) => void;
  onClose: () => void;
}

export default function ClusterCard({ members, onSelect, onClose }: Props) {
  return (
    <section className="selected cluster-card panel">
      <div className="head">
        <span className="name">{members.length} languages</span>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="cluster-card__sub">Co-located languages (within ~28 km). Nearby dots are separate languages. Click a row to inspect.</p>
      <ul className="cluster-card__list">
        {members.map((m) => (
          <li key={m.iso} className="cluster-card__row" onClick={() => onSelect(m.iso)}>
            <span className="cluster-card__dot" style={{ background: m.color }} />
            <span className="cluster-card__name">{m.name}</span>
            <span className="cluster-card__pill">{LEVEL_LABEL[m.level]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
