//! The control-channel messages Kolpak uses, written by hand against upstream's
//! `src/Mumble.proto` (mumble-voip/mumble, read 2026-11-25) so that no `protoc` is needed
//! at build time. Field numbers and types must match that file exactly.
//!
//! Fields Kolpak never reads (textures, comments, plugin data, ACLs) are left out;
//! protobuf skips unknown fields on decode.

/// Message type IDs, the first two bytes of every control frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum MessageType {
    Version = 0,
    UdpTunnel = 1,
    Authenticate = 2,
    Ping = 3,
    Reject = 4,
    ServerSync = 5,
    ChannelRemove = 6,
    ChannelState = 7,
    UserRemove = 8,
    UserState = 9,
    BanList = 10,
    TextMessage = 11,
    PermissionDenied = 12,
    Acl = 13,
    QueryUsers = 14,
    CryptSetup = 15,
    ContextActionModify = 16,
    ContextAction = 17,
    UserList = 18,
    VoiceTarget = 19,
    PermissionQuery = 20,
    CodecVersion = 21,
    UserStats = 22,
    RequestBlob = 23,
    ServerConfig = 24,
    SuggestConfig = 25,
    PluginDataTransmission = 26,
}

impl MessageType {
    pub fn from_u16(value: u16) -> Option<Self> {
        use MessageType::*;
        Some(match value {
            0 => Version,
            1 => UdpTunnel,
            2 => Authenticate,
            3 => Ping,
            4 => Reject,
            5 => ServerSync,
            6 => ChannelRemove,
            7 => ChannelState,
            8 => UserRemove,
            9 => UserState,
            10 => BanList,
            11 => TextMessage,
            12 => PermissionDenied,
            13 => Acl,
            14 => QueryUsers,
            15 => CryptSetup,
            16 => ContextActionModify,
            17 => ContextAction,
            18 => UserList,
            19 => VoiceTarget,
            20 => PermissionQuery,
            21 => CodecVersion,
            22 => UserStats,
            23 => RequestBlob,
            24 => ServerConfig,
            25 => SuggestConfig,
            26 => PluginDataTransmission,
            _ => return None,
        })
    }
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Version {
    /// Legacy format: `major << 16 | minor << 8 | patch`, patch capped at 255.
    #[prost(uint32, optional, tag = "1")]
    pub version_v1: Option<u32>,
    /// 1.5 format: `major << 48 | minor << 32 | patch << 16`.
    #[prost(uint64, optional, tag = "5")]
    pub version_v2: Option<u64>,
    #[prost(string, optional, tag = "2")]
    pub release: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub os: Option<String>,
    #[prost(string, optional, tag = "4")]
    pub os_version: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Authenticate {
    #[prost(string, optional, tag = "1")]
    pub username: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub password: Option<String>,
    #[prost(string, repeated, tag = "3")]
    pub tokens: Vec<String>,
    #[prost(int32, repeated, packed = "false", tag = "4")]
    pub celt_versions: Vec<i32>,
    #[prost(bool, optional, tag = "5")]
    pub opus: Option<bool>,
    #[prost(int32, optional, tag = "6")]
    pub client_type: Option<i32>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Ping {
    #[prost(uint64, optional, tag = "1")]
    pub timestamp: Option<u64>,
    #[prost(uint32, optional, tag = "2")]
    pub good: Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    pub late: Option<u32>,
    #[prost(uint32, optional, tag = "4")]
    pub lost: Option<u32>,
    #[prost(uint32, optional, tag = "5")]
    pub resync: Option<u32>,
    #[prost(uint32, optional, tag = "6")]
    pub udp_packets: Option<u32>,
    #[prost(uint32, optional, tag = "7")]
    pub tcp_packets: Option<u32>,
    #[prost(float, optional, tag = "8")]
    pub udp_ping_avg: Option<f32>,
    #[prost(float, optional, tag = "9")]
    pub udp_ping_var: Option<f32>,
    #[prost(float, optional, tag = "10")]
    pub tcp_ping_avg: Option<f32>,
    #[prost(float, optional, tag = "11")]
    pub tcp_ping_var: Option<f32>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Reject {
    /// `RejectType` in the .proto; see [`crate::RejectKind`].
    #[prost(int32, optional, tag = "1")]
    pub r#type: Option<i32>,
    #[prost(string, optional, tag = "2")]
    pub reason: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct ServerSync {
    #[prost(uint32, optional, tag = "1")]
    pub session: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub max_bandwidth: Option<u32>,
    #[prost(string, optional, tag = "3")]
    pub welcome_text: Option<String>,
    #[prost(uint64, optional, tag = "4")]
    pub permissions: Option<u64>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct ChannelRemove {
    #[prost(uint32, required, tag = "1")]
    pub channel_id: u32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct ChannelState {
    #[prost(uint32, optional, tag = "1")]
    pub channel_id: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub parent: Option<u32>,
    #[prost(string, optional, tag = "3")]
    pub name: Option<String>,
    #[prost(bool, optional, tag = "8")]
    pub temporary: Option<bool>,
    #[prost(int32, optional, tag = "9")]
    pub position: Option<i32>,
    #[prost(uint32, optional, tag = "11")]
    pub max_users: Option<u32>,
    #[prost(bool, optional, tag = "12")]
    pub is_enter_restricted: Option<bool>,
    #[prost(bool, optional, tag = "13")]
    pub can_enter: Option<bool>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct UserRemove {
    #[prost(uint32, required, tag = "1")]
    pub session: u32,
    #[prost(uint32, optional, tag = "2")]
    pub actor: Option<u32>,
    #[prost(string, optional, tag = "3")]
    pub reason: Option<String>,
    #[prost(bool, optional, tag = "4")]
    pub ban: Option<bool>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct UserState {
    #[prost(uint32, optional, tag = "1")]
    pub session: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub actor: Option<u32>,
    #[prost(string, optional, tag = "3")]
    pub name: Option<String>,
    /// Registration ID; absent for unregistered users.
    #[prost(uint32, optional, tag = "4")]
    pub user_id: Option<u32>,
    #[prost(uint32, optional, tag = "5")]
    pub channel_id: Option<u32>,
    #[prost(bool, optional, tag = "6")]
    pub mute: Option<bool>,
    #[prost(bool, optional, tag = "7")]
    pub deaf: Option<bool>,
    #[prost(bool, optional, tag = "8")]
    pub suppress: Option<bool>,
    #[prost(bool, optional, tag = "9")]
    pub self_mute: Option<bool>,
    #[prost(bool, optional, tag = "10")]
    pub self_deaf: Option<bool>,
    #[prost(bool, optional, tag = "18")]
    pub priority_speaker: Option<bool>,
    #[prost(bool, optional, tag = "19")]
    pub recording: Option<bool>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TextMessage {
    #[prost(uint32, optional, tag = "1")]
    pub actor: Option<u32>,
    #[prost(uint32, repeated, packed = "false", tag = "2")]
    pub session: Vec<u32>,
    #[prost(uint32, repeated, packed = "false", tag = "3")]
    pub channel_id: Vec<u32>,
    #[prost(uint32, repeated, packed = "false", tag = "4")]
    pub tree_id: Vec<u32>,
    #[prost(string, required, tag = "5")]
    pub message: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct PermissionDenied {
    #[prost(uint32, optional, tag = "1")]
    pub permission: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub channel_id: Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    pub session: Option<u32>,
    #[prost(string, optional, tag = "4")]
    pub reason: Option<String>,
    #[prost(int32, optional, tag = "5")]
    pub r#type: Option<i32>,
    #[prost(string, optional, tag = "6")]
    pub name: Option<String>,
}

/// Key material for the UDP voice channel. Decoded but not used until voice is built.
#[derive(Clone, PartialEq, prost::Message)]
pub struct CryptSetup {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub key: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub client_nonce: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub server_nonce: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct CodecVersion {
    #[prost(int32, required, tag = "1")]
    pub alpha: i32,
    #[prost(int32, required, tag = "2")]
    pub beta: i32,
    #[prost(bool, required, tag = "3")]
    pub prefer_alpha: bool,
    #[prost(bool, optional, tag = "4")]
    pub opus: Option<bool>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct ServerConfig {
    #[prost(uint32, optional, tag = "1")]
    pub max_bandwidth: Option<u32>,
    #[prost(string, optional, tag = "2")]
    pub welcome_text: Option<String>,
    #[prost(bool, optional, tag = "3")]
    pub allow_html: Option<bool>,
    #[prost(uint32, optional, tag = "4")]
    pub message_length: Option<u32>,
    #[prost(uint32, optional, tag = "5")]
    pub image_message_length: Option<u32>,
    #[prost(uint32, optional, tag = "6")]
    pub max_users: Option<u32>,
    #[prost(bool, optional, tag = "7")]
    pub recording_allowed: Option<bool>,
}
