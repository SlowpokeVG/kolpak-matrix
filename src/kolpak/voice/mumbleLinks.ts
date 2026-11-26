import type { VoiceSnapshot } from './types';

// Mumble links in chat: `mumble://host[:port]/Channel/Sub?version=…`, either as they are or
// wrapped in a web page that carries the link in its fragment, the way the community bot
// posts them (https://matrix-memes.klpq.io/join-mumble.html#mumble%3A%2F%2Fmumble.klpq.io%3A64738).
// Kolpak joins such links with its own voice instead of opening a browser or another app.

export const MUMBLE_DEFAULT_PORT = 64738;

export type MumbleTarget = {
  host: string;
  port: number;
  /** Channel names from the root's children down; empty for "just the server". */
  channelPath: string[];
  /** A name in the link itself, rarely present; the user's own setting wins. */
  username?: string;
};

const MUMBLE_URL =
  /^mumble:\/\/(?:([^@/?#]*)@)?(\[[^\]/?#]+\]|[^:/?#]+)(?::(\d{1,5}))?(\/[^?#]*)?(?:[?#].*)?$/i;

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** Parse a `mumble://` URL; undefined when it is not one. */
export function parseMumbleUrl(raw: string): MumbleTarget | undefined {
  const match = MUMBLE_URL.exec(raw.trim());
  if (!match) return undefined;
  const [, userInfo, rawHost, rawPort, rawPath] = match;
  const host = rawHost?.replace(/^\[|\]$/g, '');
  if (!host) return undefined;
  const port = rawPort ? Number.parseInt(rawPort, 10) : MUMBLE_DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const channelPath = (rawPath ?? '')
    .split('/')
    .filter(Boolean)
    .map((segment) => decode(segment).trim())
    .filter(Boolean);
  const username = userInfo ? decode(userInfo.split(':')[0] ?? '').trim() : '';
  return { host: decode(host), port, channelPath, ...(username ? { username } : {}) };
}

/**
 * The Mumble target behind a link's href: a `mumble://` URL, or a web URL whose fragment is
 * one (URL-encoded once or twice). Undefined for every other link.
 */
export function mumbleTargetFromHref(href: string): MumbleTarget | undefined {
  const value = href.trim();
  if (/^mumble:/i.test(value)) return parseMumbleUrl(value);
  if (!/^https?:\/\//i.test(value)) return undefined;
  const hashAt = value.indexOf('#');
  if (hashAt === -1) return undefined;
  let fragment = value.slice(hashAt + 1);
  for (let round = 0; round < 3; round += 1) {
    if (/^mumble:\/\//i.test(fragment)) return parseMumbleUrl(fragment);
    const next = decode(fragment);
    if (next === fragment) break;
    fragment = next;
  }
  return undefined;
}

/** Same server, ignoring case in the host name. */
export function sameServer(
  a: { host: string; port: number } | undefined,
  b: { host: string; port: number }
): boolean {
  return Boolean(a) && a!.host.toLowerCase() === b.host.toLowerCase() && a!.port === b.port;
}

/**
 * The channel a path names, walking down from the root by name (case does not matter).
 * Undefined when some step is missing.
 */
export function findChannelByPath(snapshot: VoiceSnapshot, path: string[]): number | undefined {
  const root = snapshot.channels.find((channel) => channel.parent === null);
  if (!root) return undefined;
  let current = root.id;
  for (const name of path) {
    const wanted = name.toLowerCase();
    const next = snapshot.channels.find(
      (channel) => channel.parent === current && channel.name.toLowerCase() === wanted
    );
    if (!next) return undefined;
    current = next.id;
  }
  return current;
}
