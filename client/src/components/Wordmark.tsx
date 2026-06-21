import logoMark from '../assets/lastecho-mark.png';

export default function Wordmark() {
  return (
    <header className="wordmark">
      <div className="brand-lockup" aria-label="LastEcho">
        <img className="brand-mark" src={logoMark} alt="" aria-hidden="true" />
        <h1>
          Last<span className="echo">Echo</span>
        </h1>
      </div>
    </header>
  );
}
