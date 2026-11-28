import { useEffect } from 'react';
import { useSetting } from '$state/hooks/settings';
import { MessageLayout, settingsAtom } from '$state/settings';
import { partOn, updateSimpleMode, useSimpleMode } from './simpleMode';

// Shlomo mode, "Messenger look": five of Sable's own settings set the way a messenger looks
// (bubbles, yours on the right, no join/leave or name-change lines, and the message field
// growing upwards between its buttons, "Always Inline Editor"), with how they were kept in
// the mode's `before` so switching the look off puts them back. The inline editor came
// later: a snapshot without it gets it added (and the setting applied) once. A component rather than
// the switch's handler, so the look also applies when the mode is on by default (a fresh
// install) and when the master switch flips. They stay changeable in Appearance meanwhile.

/** Stored settings are typed but read from storage; a wrong type must not reach the snapshot. */
const asBool = (value: unknown): boolean => value === true;

export function ShlomoLookSync() {
  const simple = useSimpleMode();
  const look = partOn(simple, 'look');
  const { before } = simple;
  const [messageLayout, setMessageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [useRightBubbles, setUseRightBubbles] = useSetting(settingsAtom, 'useRightBubbles');
  const [hideMembershipEvents, setHideMembershipEvents] = useSetting(
    settingsAtom,
    'hideMembershipEvents'
  );
  const [hideNickAvatarEvents, setHideNickAvatarEvents] = useSetting(
    settingsAtom,
    'hideNickAvatarEvents'
  );
  const [alwaysInlineEditor, setAlwaysInlineEditor] = useSetting(
    settingsAtom,
    'alwaysInlineEditor'
  );

  useEffect(() => {
    if (look && !before) {
      // Coerced, so the snapshot always passes the mode's check: one that failed it would be
      // dropped, leave `before` empty and apply again on every render.
      updateSimpleMode({
        before: {
          messageLayout: typeof messageLayout === 'number' ? messageLayout : MessageLayout.Modern,
          useRightBubbles: asBool(useRightBubbles),
          hideMembershipEvents: asBool(hideMembershipEvents),
          hideNickAvatarEvents: asBool(hideNickAvatarEvents),
          alwaysInlineEditor: asBool(alwaysInlineEditor),
        },
      });
      setMessageLayout(MessageLayout.Bubble);
      setUseRightBubbles(true);
      setHideMembershipEvents(true);
      setHideNickAvatarEvents(true);
      setAlwaysInlineEditor(true);
    } else if (look && before && before.alwaysInlineEditor === undefined) {
      updateSimpleMode({
        before: { ...before, alwaysInlineEditor: asBool(alwaysInlineEditor) },
      });
      setAlwaysInlineEditor(true);
    } else if (!look && before) {
      updateSimpleMode({ before: undefined });
      setMessageLayout(before.messageLayout);
      setUseRightBubbles(before.useRightBubbles);
      setHideMembershipEvents(before.hideMembershipEvents);
      setHideNickAvatarEvents(before.hideNickAvatarEvents);
      if (before.alwaysInlineEditor !== undefined) setAlwaysInlineEditor(before.alwaysInlineEditor);
    }
  }, [
    look,
    before,
    messageLayout,
    useRightBubbles,
    hideMembershipEvents,
    hideNickAvatarEvents,
    alwaysInlineEditor,
    setMessageLayout,
    setUseRightBubbles,
    setHideMembershipEvents,
    setHideNickAvatarEvents,
    setAlwaysInlineEditor,
  ]);

  return null;
}
