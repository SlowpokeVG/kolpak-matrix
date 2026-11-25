import type { VoiceSnapshot, VoiceUser } from './types';

// Turns a snapshot into the rows of the voice outline (AI/DESIGN.md §3.4).

export type TreeRow =
  | {
      kind: 'channel';
      id: number;
      name: string;
      depth: number;
      /** Users directly in this channel. */
      userCount: number;
      /** Whether there is anything under it to fold away. */
      foldable: boolean;
      collapsed: boolean;
      /** The channel we are in. */
      current: boolean;
    }
  | {
      kind: 'user';
      session: number;
      name: string;
      depth: number;
      self: boolean;
      /** 'deafened' implies muted. */
      state: 'open' | 'muted' | 'deafened';
    };

export function userState(user: VoiceUser): 'open' | 'muted' | 'deafened' {
  if (user.deaf || user.selfDeaf) return 'deafened';
  if (user.mute || user.selfMute || user.suppress) return 'muted';
  return 'open';
}

/**
 * Rows in display order. Channels arrive parents-first, so a channel's depth is its
 * parent's plus one. Everything under a collapsed channel is left out.
 */
export function buildTreeRows(snapshot: VoiceSnapshot, collapsed: ReadonlySet<number>): TreeRow[] {
  const depthOf = new Map<number, number>();
  const hiddenUnder = new Set<number>();
  const me = snapshot.users.find((user) => user.session === snapshot.session);
  const rows: TreeRow[] = [];

  for (const channel of snapshot.channels) {
    const parentDepth = channel.parent === null ? undefined : depthOf.get(channel.parent);
    const depth = parentDepth === undefined ? 0 : parentDepth + 1;
    depthOf.set(channel.id, depth);

    const parentHidden =
      channel.parent !== null && (hiddenUnder.has(channel.parent) || collapsed.has(channel.parent));
    if (parentHidden) {
      hiddenUnder.add(channel.id);
      continue;
    }

    const users = snapshot.users.filter((user) => user.channelId === channel.id);
    const hasChildren = snapshot.channels.some((other) => other.parent === channel.id);
    const isCollapsed = collapsed.has(channel.id);
    rows.push({
      kind: 'channel',
      id: channel.id,
      name: channel.name,
      depth,
      userCount: users.length,
      foldable: hasChildren || users.length > 0,
      collapsed: isCollapsed,
      current: me?.channelId === channel.id,
    });
    if (isCollapsed) continue;
    for (const user of users) {
      rows.push({
        kind: 'user',
        session: user.session,
        name: user.name,
        depth: depth + 1,
        self: user.session === snapshot.session,
        state: userState(user),
      });
    }
  }
  return rows;
}
