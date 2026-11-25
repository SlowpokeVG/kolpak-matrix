//! The server as we know it: channels and users, built up from the partial updates the
//! server sends. Every `ChannelState` and `UserState` only carries the fields that changed.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::proto;

/// The root channel always has ID 0 and no parent.
pub const ROOT_CHANNEL: u32 = 0;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: u32,
    /// `None` only for the root channel.
    pub parent: Option<u32>,
    pub name: String,
    pub position: i32,
    pub temporary: bool,
    /// 0 means no limit.
    pub max_users: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub session: u32,
    pub name: String,
    pub channel_id: u32,
    /// Muted by the server or an admin.
    pub mute: bool,
    /// Deafened by the server or an admin.
    pub deaf: bool,
    /// Muted by the server because they may not speak in this channel.
    pub suppress: bool,
    pub self_mute: bool,
    pub self_deaf: bool,
    /// Registered users have an ID; guests do not.
    pub registered: bool,
    pub priority_speaker: bool,
    pub recording: bool,
}

/// A full copy of the state, in a stable order, for sending to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Our own session ID once the server has synced us.
    pub session: Option<u32>,
    /// Parents before children, siblings by position then name.
    pub channels: Vec<Channel>,
    /// By channel, then name.
    pub users: Vec<User>,
}

#[derive(Debug, Default)]
pub struct ServerState {
    channels: BTreeMap<u32, Channel>,
    users: BTreeMap<u32, User>,
    session: Option<u32>,
}

impl ServerState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn session(&self) -> Option<u32> {
        self.session
    }

    pub fn set_session(&mut self, session: u32) {
        self.session = Some(session);
    }

    pub fn channel(&self, id: u32) -> Option<&Channel> {
        self.channels.get(&id)
    }

    pub fn user(&self, session: u32) -> Option<&User> {
        self.users.get(&session)
    }

    /// Returns true if anything changed.
    pub fn apply_channel_state(&mut self, msg: &proto::ChannelState) -> bool {
        let Some(id) = msg.channel_id else {
            return false;
        };
        let before = self.channels.get(&id).cloned();
        let channel = self.channels.entry(id).or_insert_with(|| Channel {
            id,
            parent: None,
            name: String::new(),
            position: 0,
            temporary: false,
            max_users: 0,
        });
        if id != ROOT_CHANNEL {
            if let Some(parent) = msg.parent {
                channel.parent = Some(parent);
            }
        }
        if let Some(name) = &msg.name {
            channel.name.clone_from(name);
        }
        if let Some(position) = msg.position {
            channel.position = position;
        }
        if let Some(temporary) = msg.temporary {
            channel.temporary = temporary;
        }
        if let Some(max_users) = msg.max_users {
            channel.max_users = max_users;
        }
        before.as_ref() != self.channels.get(&id)
    }

    pub fn remove_channel(&mut self, id: u32) -> bool {
        self.channels.remove(&id).is_some()
    }

    /// Returns true if anything changed.
    pub fn apply_user_state(&mut self, msg: &proto::UserState) -> bool {
        let Some(session) = msg.session else {
            return false;
        };
        let before = self.users.get(&session).cloned();
        let user = self.users.entry(session).or_insert_with(|| User {
            session,
            name: String::new(),
            // A new user without a channel is in the root channel.
            channel_id: ROOT_CHANNEL,
            mute: false,
            deaf: false,
            suppress: false,
            self_mute: false,
            self_deaf: false,
            registered: false,
            priority_speaker: false,
            recording: false,
        });
        if let Some(name) = &msg.name {
            user.name.clone_from(name);
        }
        if let Some(channel_id) = msg.channel_id {
            user.channel_id = channel_id;
        }
        if let Some(value) = msg.mute {
            user.mute = value;
        }
        if let Some(value) = msg.deaf {
            user.deaf = value;
        }
        if let Some(value) = msg.suppress {
            user.suppress = value;
        }
        if let Some(value) = msg.self_mute {
            user.self_mute = value;
        }
        if let Some(value) = msg.self_deaf {
            user.self_deaf = value;
        }
        if msg.user_id.is_some() {
            user.registered = true;
        }
        if let Some(value) = msg.priority_speaker {
            user.priority_speaker = value;
        }
        if let Some(value) = msg.recording {
            user.recording = value;
        }
        before.as_ref() != self.users.get(&session)
    }

    pub fn remove_user(&mut self, session: u32) -> bool {
        self.users.remove(&session).is_some()
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut channels = Vec::with_capacity(self.channels.len());
        self.collect_subtree(ROOT_CHANNEL, &mut channels);
        // Channels whose parent we never heard about still have to be shown somewhere.
        let mut orphans: Vec<&Channel> = self
            .channels
            .values()
            .filter(|channel| !channels.iter().any(|seen: &Channel| seen.id == channel.id))
            .collect();
        orphans.sort_by(|a, b| sibling_order(a, b));
        channels.extend(orphans.into_iter().cloned());

        let order: BTreeMap<u32, usize> = channels
            .iter()
            .enumerate()
            .map(|(index, channel)| (channel.id, index))
            .collect();
        let mut users: Vec<User> = self.users.values().cloned().collect();
        users.sort_by(|a, b| {
            let a_pos = order.get(&a.channel_id).copied().unwrap_or(usize::MAX);
            let b_pos = order.get(&b.channel_id).copied().unwrap_or(usize::MAX);
            a_pos
                .cmp(&b_pos)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.session.cmp(&b.session))
        });

        Snapshot {
            session: self.session,
            channels,
            users,
        }
    }

    fn collect_subtree(&self, id: u32, out: &mut Vec<Channel>) {
        let Some(channel) = self.channels.get(&id) else {
            return;
        };
        // A parent loop would be a server bug; do not follow it forever.
        if out.iter().any(|seen| seen.id == id) {
            return;
        }
        out.push(channel.clone());
        let mut children: Vec<&Channel> = self
            .channels
            .values()
            .filter(|child| child.parent == Some(id) && child.id != id)
            .collect();
        children.sort_by(|a, b| sibling_order(a, b));
        for child in children {
            self.collect_subtree(child.id, out);
        }
    }
}

fn sibling_order(a: &Channel, b: &Channel) -> std::cmp::Ordering {
    a.position
        .cmp(&b.position)
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.id.cmp(&b.id))
}

impl Snapshot {
    /// How deep a channel sits: 0 for the root.
    pub fn depth_of(&self, channel_id: u32) -> usize {
        let mut depth = 0;
        let mut current = channel_id;
        while let Some(parent) = self
            .channels
            .iter()
            .find(|channel| channel.id == current)
            .and_then(|channel| channel.parent)
        {
            depth += 1;
            current = parent;
            if depth > self.channels.len() {
                break;
            }
        }
        depth
    }

    /// The channel tree as indented text, users listed under their channel.
    pub fn render_tree(&self) -> String {
        let mut out = String::new();
        for channel in &self.channels {
            let indent = "  ".repeat(self.depth_of(channel.id));
            let count = self
                .users
                .iter()
                .filter(|user| user.channel_id == channel.id)
                .count();
            out.push_str(&format!("{indent}- {} ({count})\n", channel.name));
            for user in self
                .users
                .iter()
                .filter(|user| user.channel_id == channel.id)
            {
                let mut flags = Vec::new();
                if user.self_deaf || user.deaf {
                    flags.push("deafened");
                } else if user.self_mute || user.mute || user.suppress {
                    flags.push("muted");
                }
                if Some(user.session) == self.session {
                    flags.push("you");
                }
                let suffix = if flags.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", flags.join(", "))
                };
                out.push_str(&format!("{indent}    {}{suffix}\n", user.name));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(id: u32, parent: Option<u32>, name: &str, position: i32) -> proto::ChannelState {
        proto::ChannelState {
            channel_id: Some(id),
            parent,
            name: Some(name.into()),
            position: Some(position),
            ..Default::default()
        }
    }

    fn user(session: u32, name: &str, channel_id: Option<u32>) -> proto::UserState {
        proto::UserState {
            session: Some(session),
            name: Some(name.into()),
            channel_id,
            ..Default::default()
        }
    }

    #[test]
    fn orders_channels_as_a_tree_by_position_then_name() {
        let mut state = ServerState::new();
        // Arrival order is deliberately not tree order.
        state.apply_channel_state(&channel(3, Some(1), "deep", 0));
        state.apply_channel_state(&channel(2, Some(0), "beta", 0));
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_channel_state(&channel(4, Some(0), "pinned last", 5));
        state.apply_channel_state(&channel(1, Some(0), "Alpha", 0));

        let snapshot = state.snapshot();
        let names: Vec<&str> = snapshot.channels.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Root", "Alpha", "deep", "beta", "pinned last"]);
        assert_eq!(snapshot.depth_of(3), 2);
        assert_eq!(snapshot.channels[0].parent, None);
    }

    #[test]
    fn partial_updates_only_change_the_fields_they_carry() {
        let mut state = ServerState::new();
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_channel_state(&channel(1, Some(0), "lobby", 0));
        assert!(state.apply_user_state(&user(7, "pyro", Some(1))));

        // A mute toggle carries the session and nothing else about the user.
        let changed = state.apply_user_state(&proto::UserState {
            session: Some(7),
            self_mute: Some(true),
            ..Default::default()
        });
        assert!(changed);
        let pyro = state.user(7).unwrap();
        assert_eq!(pyro.name, "pyro");
        assert_eq!(pyro.channel_id, 1);
        assert!(pyro.self_mute);

        // The same update again changes nothing.
        assert!(!state.apply_user_state(&proto::UserState {
            session: Some(7),
            self_mute: Some(true),
            ..Default::default()
        }));

        // A rename leaves the parent alone.
        state.apply_channel_state(&proto::ChannelState {
            channel_id: Some(1),
            name: Some("hall".into()),
            ..Default::default()
        });
        assert_eq!(state.channel(1).unwrap().parent, Some(0));
        assert_eq!(state.channel(1).unwrap().name, "hall");
    }

    #[test]
    fn a_new_user_without_a_channel_is_in_the_root() {
        let mut state = ServerState::new();
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_user_state(&user(1, "guest", None));
        assert_eq!(state.user(1).unwrap().channel_id, ROOT_CHANNEL);
        assert!(!state.user(1).unwrap().registered);
    }

    #[test]
    fn removal_and_messages_without_ids() {
        let mut state = ServerState::new();
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_user_state(&user(1, "guest", None));

        assert!(!state.apply_user_state(&proto::UserState::default()));
        assert!(!state.apply_channel_state(&proto::ChannelState::default()));
        assert!(state.remove_user(1));
        assert!(!state.remove_user(1));
        assert!(state.snapshot().users.is_empty());
    }

    #[test]
    fn renders_users_under_their_channel_and_marks_us() {
        let mut state = ServerState::new();
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_channel_state(&channel(1, Some(0), "lobby", 0));
        state.apply_user_state(&user(2, "zed", Some(1)));
        state.apply_user_state(&user(1, "Amy", Some(1)));
        state.apply_user_state(&proto::UserState {
            session: Some(2),
            self_mute: Some(true),
            self_deaf: Some(true),
            ..Default::default()
        });
        state.set_session(2);

        let tree = state.snapshot().render_tree();
        assert_eq!(
            tree,
            "- Root (0)\n  - lobby (2)\n      Amy\n      zed (deafened, you)\n"
        );
    }

    #[test]
    fn a_channel_with_an_unknown_parent_is_still_listed() {
        let mut state = ServerState::new();
        state.apply_channel_state(&channel(0, None, "Root", 0));
        state.apply_channel_state(&channel(9, Some(42), "lost", 0));
        let names: Vec<String> = state
            .snapshot()
            .channels
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["Root", "lost"]);
    }
}
