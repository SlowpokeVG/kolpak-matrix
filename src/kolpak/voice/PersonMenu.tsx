import { useEffect, useRef, type CSSProperties } from 'react';
import {
  DEFAULT_PERSON,
  MAX_PERSON_VOLUME,
  personSetting,
  resetPerson,
  updatePerson,
  usePeopleSettings,
} from './peopleSettings';

// One person's menu in the voice tree, on its own line under their row: their volume for
// us (0–200%) and "mute for me". Neither is sent to the server or seen by anyone else.
// Escape or a click outside the menu and the person's row closes it.

const MAX_PERCENT = MAX_PERSON_VOLUME * 100;

export function PersonMenu({ name, onClose }: { name: string; onClose: () => void }) {
  const people = usePeopleSettings();
  const setting = personSetting(people, name);
  const box = useRef<HTMLDivElement>(null);
  const percent = Math.round(setting.volume * 100);
  const isDefault =
    setting.volume === DEFAULT_PERSON.volume && setting.muted === DEFAULT_PERSON.muted;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // The open row counts as inside, so its name button toggles the menu shut by itself.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target)) return;
      if (target?.closest?.('.kolpak-tree__row--user[data-open="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      className="kolpak-person"
      role="dialog"
      aria-label={`Voice settings for ${name}`}
    >
      <div className="kolpak-person__volume">
        <input
          type="range"
          className="kolpak-range"
          min={0}
          max={MAX_PERCENT}
          step={5}
          value={percent}
          disabled={setting.muted}
          aria-label={`Volume for ${name}`}
          aria-valuetext={`${percent}%`}
          style={{ '--kolpak-range-fill': `${(percent / MAX_PERCENT) * 100}%` } as CSSProperties}
          onChange={(event) => updatePerson(name, { volume: Number(event.target.value) / 100 })}
        />
        <span className="kolpak-person__value">{setting.muted ? 'off' : `${percent}%`}</span>
      </div>
      <div className="kolpak-person__actions">
        <button
          type="button"
          className="kolpak-person__button"
          aria-pressed={setting.muted}
          title="only you stop hearing them"
          onClick={() => updatePerson(name, { muted: !setting.muted })}
        >
          {setting.muted ? 'Unmute' : 'Mute for me'}
        </button>
        <button
          type="button"
          className="kolpak-person__button kolpak-person__reset"
          disabled={isDefault}
          title="back to 100%"
          onClick={() => resetPerson(name)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
