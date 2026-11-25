import './room-list.css';

// "KLPQ" in Rubik Spray Paint with the "Podkolpakom" signature beside it
// (AI/DESIGN.md §2.2). The marker face is used for the signature and nowhere else.
export function Wordmark() {
  return (
    <span className="kolpak-wordmark" aria-label="KLPQ Podkolpakom">
      <span className="kolpak-wordmark__klpq" aria-hidden="true">
        KLPQ
      </span>
      <span className="kolpak-wordmark__sign" aria-hidden="true">
        Podkolpakom
      </span>
    </span>
  );
}
