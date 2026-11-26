import { enterPip, pipSupported } from './pip';
import { usePlayer } from './sharedPlayer';

// The picture-in-picture button, shown while the stream plays and where the platform can.

export function PipButton({ className }: { className?: string }) {
  const player = usePlayer();
  if (player.status !== 'playing' || !pipSupported()) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => void enterPip()}
      title="picture in picture"
      aria-label="picture in picture"
    >
      PIP
    </button>
  );
}
