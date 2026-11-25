//! Connect, go to the busiest channel, and report incoming voice for a few seconds.
//! Nothing is played; this only measures what the server sends us.
//!
//!     cargo run --example listen -- <host> [seconds] [username] [stay]
//!
//! With `stay` it remains in the channel it lands in instead of moving.

use std::collections::HashMap;
use std::time::Duration;

use kolpak_mumble::voice::decode_audio_packet;
use kolpak_mumble::{connect, ConnectOptions, Event, DEFAULT_PORT};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let host = args
        .next()
        .ok_or("usage: listen <host> [seconds] [username]")?;
    let seconds: u64 = match args.next() {
        Some(value) => value.parse()?,
        None => 10,
    };
    let username = args.next().unwrap_or_else(|| "kolpak-dev".to_owned());
    let stay = args.next().as_deref() == Some("stay");

    let mut connection = connect(ConnectOptions {
        host,
        port: DEFAULT_PORT,
        username,
        password: None,
        pinned_fingerprint: None,
        client_name: format!("Kolpak {} (spike)", env!("CARGO_PKG_VERSION")),
        join_muted: true,
        join_deafened: false,
    })
    .await?;

    let deadline = tokio::time::sleep(Duration::from_secs(seconds + 5));
    tokio::pin!(deadline);
    let mut session = None;
    let mut moved = false;
    let mut packets = 0u64;
    let mut bytes = 0u64;
    let mut undecodable = 0u64;
    let mut per_sender: HashMap<u32, u64> = HashMap::new();
    let mut names: HashMap<u32, String> = HashMap::new();

    loop {
        tokio::select! {
            event = connection.events.recv() => match event {
                Some(Event::Synced { session: ours, .. }) => {
                    session = Some(ours);
                    println!("synced as session {ours}");
                }
                Some(Event::State(snapshot)) => {
                    for user in &snapshot.users {
                        names.insert(user.session, user.name.clone());
                    }
                    if !moved && !stay {
                        // Go to wherever the most other people are.
                        let mut counts: HashMap<u32, usize> = HashMap::new();
                        for user in snapshot.users.iter().filter(|user| Some(user.session) != session) {
                            *counts.entry(user.channel_id).or_default() += 1;
                        }
                        if let Some((channel, count)) = counts.into_iter().max_by_key(|(_, count)| *count) {
                            let name = snapshot.channels.iter().find(|c| c.id == channel).map(|c| c.name.clone());
                            println!("moving to {:?} ({count} others), listening for {seconds} s", name.unwrap_or_default());
                            connection.client.join_channel(channel).await;
                            moved = true;
                            deadline.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(seconds));
                        }
                    }
                }
                Some(Event::Udp { active }) => {
                    println!("voice transport: {}", if active { "UDP" } else { "TCP tunnel" });
                }
                Some(Event::Disconnected(reason)) => {
                    println!("disconnected: {reason:?}");
                    break;
                }
                Some(_) => {}
                None => break,
            },
            packet = connection.voice.recv() => {
                let Some(packet) = packet else { break };
                packets += 1;
                bytes += packet.len() as u64;
                match decode_audio_packet(&packet) {
                    Some(audio) => *per_sender.entry(audio.sender_session).or_default() += 1,
                    None => {
                        undecodable += 1;
                        if undecodable <= 3 {
                            println!("unrecognised packet, first bytes {:02x?}", &packet[..packet.len().min(8)]);
                        }
                    }
                }
            }
            () = &mut deadline => break,
        }
    }

    println!("voice packets: {packets} ({bytes} bytes), not recognised: {undecodable}");
    let mut senders: Vec<_> = per_sender.into_iter().collect();
    senders.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    for (sender, count) in senders {
        println!(
            "  {} packets from {}",
            count,
            names.get(&sender).map_or("someone", String::as_str)
        );
    }
    connection.client.disconnect().await;
    Ok(())
}
