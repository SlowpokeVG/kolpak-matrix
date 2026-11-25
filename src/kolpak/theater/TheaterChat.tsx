import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MatrixEventEvent, MsgType, RoomEvent } from '$types/matrix-sdk';
import type { IImageContent } from '$types/matrix/common';
import { MImage } from '$components/message/MsgTypeRenderers';
import { ImageContent } from '$components/message/content/ImageContent';
import { Image } from '$components/media';
import { ImageViewer } from '$components/image-viewer/ImageViewer';
import { imagesFrom, sendImage } from './chatImages';
import type { MatrixEvent, Room } from '$types/matrix-sdk';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { getMxIdLocalPart } from '$utils/matrix';
import { setTheaterRoom } from './theaterStore';

// The chat column of theater mode (AI/DESIGN.md §4): one room, compact, one line per
// message as `HH:MM name text`. Names are green while that person talks in voice and
// orange for the streamer. A minimal composer sends plain text.
//
// This is deliberately not Sable's timeline: it shows text and images and says what other
// content is; for anything more the user exits theater mode. Images use Sable's own image
// component, so encrypted and authenticated media, spoilers and the full-size viewer work
// as in the timeline. Images are posted with the attach button or by pasting one.

const MAX_LINES = 150;

type ChatLine = {
  id: string;
  time: string;
  sender: string;
  name: string;
  text: string;
  /** Not plain text: a file, something that did not decrypt. */
  muted: boolean;
  /** Set for m.image: rendered under the line. */
  image?: IImageContent;
};

export const clock = (ts: number): string => {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Drop the quoted fallback that replies carry at the top of their body. */
export const stripReplyFallback = (body: string): string => {
  if (!body.startsWith('> ')) return body;
  const lines = body.split('\n');
  const first = lines.findIndex((line) => !line.startsWith('>'));
  return first < 0 ? body : lines.slice(first).join('\n').trim();
};

function toLine(event: MatrixEvent, room: Room): ChatLine | undefined {
  if (event.isRedacted()) return undefined;
  const sender = event.getSender() ?? '';
  const name = room.getMember(sender)?.name ?? getMxIdLocalPart(sender) ?? sender;
  const base = {
    id: event.getId() ?? `${event.getTs()}`,
    time: clock(event.getTs()),
    sender,
    name,
  };

  if (event.isDecryptionFailure()) return { ...base, text: 'could not decrypt this.', muted: true };
  if (event.getType() !== 'm.room.message') return undefined;
  const content = event.getContent();
  // Edits are folded into the original by the SDK; the edit events themselves are skipped.
  if (content['m.relates_to']?.rel_type === 'm.replace') return undefined;
  const body = typeof content.body === 'string' ? content.body : '';

  switch (content.msgtype) {
    case 'm.text':
    case 'm.notice':
      return { ...base, text: stripReplyFallback(body), muted: false };
    case 'm.emote':
      return { ...base, text: `* ${body}`, muted: false };
    case 'm.image':
      return { ...base, text: '', muted: false, image: content as IImageContent };
    case 'm.video':
      return { ...base, text: '[video]', muted: true };
    case 'm.audio':
      return { ...base, text: '[audio]', muted: true };
    case 'm.file':
      return { ...base, text: `[file] ${body}`, muted: true };
    default:
      return body ? { ...base, text: body, muted: false } : undefined;
  }
}

/** Re-render whenever the room gets a new or newly decrypted event. */
function useRoomVersion(roomId: string | undefined): number {
  const mx = useMatrixClient();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!roomId) return undefined;
    const bump = () => setVersion((value) => value + 1);
    const onTimeline = (_event: MatrixEvent, room: Room | undefined) => {
      if (room?.roomId === roomId) bump();
    };
    const onDecrypted = (event: MatrixEvent) => {
      if (event.getRoomId() === roomId) bump();
    };
    mx.on(RoomEvent.Timeline, onTimeline);
    mx.on(RoomEvent.LocalEchoUpdated, onTimeline);
    mx.on(RoomEvent.Redaction, onTimeline);
    mx.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      mx.off(RoomEvent.Timeline, onTimeline);
      mx.off(RoomEvent.LocalEchoUpdated, onTimeline);
      mx.off(RoomEvent.Redaction, onTimeline);
      mx.off(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [mx, roomId]);
  return version;
}

type TheaterChatProps = {
  roomId: string | undefined;
  /** Lower-case names of people talking in voice right now. */
  talking: ReadonlySet<string>;
  /** Lower-case name of the person streaming, if known. */
  streamer: string | undefined;
};

export function TheaterChat({ roomId, talking, streamer }: TheaterChatProps) {
  const mx = useMatrixClient();
  const room = roomId ? mx.getRoom(roomId) : null;
  const version = useRoomVersion(roomId);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(0);
  const filePicker = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  const lines = useMemo(() => {
    if (!room) return [];
    const events = room.getLiveTimeline().getEvents();
    const out: ChatLine[] = [];
    for (const event of events.slice(-MAX_LINES * 2)) {
      const line = toLine(event, room);
      if (line) out.push(line);
    }
    return out.slice(-MAX_LINES);
    // `version` changes whenever the timeline does; the room object itself does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, version]);

  const rooms = useMemo(
    () =>
      mx
        .getRooms()
        .filter((entry) => entry.getMyMembership() === 'join' && !entry.isSpaceRoom())
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    // Re-read the list when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, picking]
  );

  useLayoutEffect(() => {
    const element = list.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !roomId) return;
    setDraft('');
    setSendError(undefined);
    stickToBottom.current = true;
    mx.sendMessage(roomId, { msgtype: MsgType.Text, body }).catch((error: unknown) => {
      setSendError(error instanceof Error ? error.message : 'could not send.');
      setDraft(body);
    });
  };

  const postImages = (files: File[]) => {
    if (!roomId || files.length === 0) return;
    setSendError(undefined);
    stickToBottom.current = true;
    for (const file of files) {
      setUploading((count) => count + 1);
      sendImage(mx, roomId, file)
        .catch((error: unknown) => {
          setSendError(error instanceof Error ? error.message : 'could not post the image.');
        })
        .finally(() => setUploading((count) => count - 1));
    }
  };

  const colourOf = (line: ChatLine): 'talking' | 'streamer' | undefined => {
    const keys = [line.name.toLowerCase(), (getMxIdLocalPart(line.sender) ?? '').toLowerCase()];
    if (streamer && keys.includes(streamer)) return 'streamer';
    if (keys.some((key) => talking.has(key))) return 'talking';
    return undefined;
  };

  const roomName = room?.name ?? 'no room';

  return (
    <aside className="kolpak-theater-chat" aria-label="Chat">
      <header className="kolpak-theater-chat__head">
        <h2 className="kolpak-theater-chat__title">{roomName}</h2>
        <button
          type="button"
          className="kolpak-theater-chat__switch"
          aria-label="Switch room"
          aria-expanded={picking}
          title="switch room"
          onClick={() => setPicking((value) => !value)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 8h14l-3-3M20 16H6l3 3" />
          </svg>
        </button>
      </header>

      {picking ? (
        <ul className="kolpak-theater-chat__rooms">
          {rooms.map((entry) => (
            <li key={entry.roomId}>
              <button
                type="button"
                aria-current={entry.roomId === roomId ? 'true' : undefined}
                onClick={() => {
                  setTheaterRoom(entry.roomId);
                  setPicking(false);
                  stickToBottom.current = true;
                }}
              >
                {entry.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ol
          ref={list}
          className="kolpak-theater-chat__lines"
          onScroll={(event) => {
            const element = event.currentTarget;
            stickToBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
        >
          {!room && <li className="kolpak-theater-chat__empty">pick a room to chat in.</li>}
          {room && lines.length === 0 && (
            <li className="kolpak-theater-chat__empty">nothing said here yet.</li>
          )}
          {lines.map((line) => (
            <li key={line.id}>
              <span className="kolpak-theater-chat__time">{line.time}</span>{' '}
              <span className="kolpak-theater-chat__name" data-colour={colourOf(line)}>
                {line.name}
              </span>{' '}
              {line.text && (
                <span className={line.muted ? 'kolpak-theater-chat__muted' : undefined}>
                  {line.text}
                </span>
              )}
              {line.image && (
                <div className="kolpak-theater-chat__image">
                  <MImage
                    content={line.image}
                    renderImageContent={(props) => (
                      <ImageContent
                        {...props}
                        autoPlay
                        renderImage={(imageProps) => <Image {...imageProps} loading="lazy" />}
                        renderViewer={(viewerProps) => <ImageViewer {...viewerProps} />}
                      />
                    )}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <form className="kolpak-theater-chat__composer" onSubmit={send}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            const files = imagesFrom(event.dataTransfer);
            if (files.length > 0) {
              event.preventDefault();
              postImages(files);
            }
          }}
          onPaste={(event) => {
            const files = imagesFrom(event.clipboardData);
            if (files.length > 0) {
              event.preventDefault();
              postImages(files);
            }
          }}
          placeholder={uploading > 0 ? 'posting the image.' : `message ${roomName.toLowerCase()}`}
          aria-label={`Message ${roomName}`}
          disabled={!room}
        />
        <button
          type="button"
          className="kolpak-theater-chat__attach"
          aria-label="Post an image"
          title="post an image"
          disabled={!room}
          onClick={() => filePicker.current?.click()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
        </button>
        <input
          ref={filePicker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            postImages(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </form>
      {sendError && <p className="kolpak-theater-chat__error">{sendError}</p>}
    </aside>
  );
}
