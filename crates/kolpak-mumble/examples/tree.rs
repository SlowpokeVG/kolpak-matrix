//! Connect to a Mumble server, print its channel tree, and leave.
//!
//!     cargo run --example tree -- <host> [port] [username] [pinned-fingerprint]
//!
//! Joins muted and deafened, stays a few seconds to show a ping, then disconnects.

use std::time::Duration;

use kolpak_mumble::{connect, ConnectOptions, Disconnect, Event, DEFAULT_PORT};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let host = args
        .next()
        .ok_or("usage: tree <host> [port] [username] [fingerprint]")?;
    let port = match args.next() {
        Some(port) => port.parse()?,
        None => DEFAULT_PORT,
    };
    let username = args.next().unwrap_or_else(|| "kolpak-dev".to_owned());
    let pinned_fingerprint = args.next();

    let mut connection = connect(ConnectOptions {
        host: host.clone(),
        port,
        username: username.clone(),
        password: None,
        pinned_fingerprint,
        client_name: format!("Kolpak {} (spike)", env!("CARGO_PKG_VERSION")),
        join_muted: true,
        join_deafened: true,
    })
    .await?;

    println!("connected to {host}:{port} as {username}");
    println!(
        "certificate sha256 {} ({})",
        connection.fingerprint,
        if connection.pinned {
            "matches the pin"
        } else {
            "accepted on first use, not pinned"
        }
    );

    let leave_after = tokio::time::sleep(Duration::from_secs(20));
    tokio::pin!(leave_after);
    let mut last_tree = String::new();
    let mut synced = false;

    loop {
        tokio::select! {
            event = connection.events.recv() => match event {
                Some(Event::ServerVersion { version, release, os }) => println!(
                    "server version {} ({}, {})",
                    version.unwrap_or_else(|| "?".into()),
                    release.unwrap_or_else(|| "?".into()),
                    os.unwrap_or_else(|| "?".into()),
                ),
                Some(Event::Synced { session, max_bandwidth, .. }) => {
                    synced = true;
                    println!(
                        "synced: session {session}, max bandwidth {} bit/s",
                        max_bandwidth.map_or_else(|| "?".into(), |b| b.to_string())
                    );
                    // Long enough for the muted/deafened state and a ping to come back.
                    leave_after.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(4));
                }
                Some(Event::State(snapshot)) => {
                    let tree = snapshot.render_tree();
                    if tree != last_tree {
                        println!(
                            "--- {} channels, {} users ---\n{tree}",
                            snapshot.channels.len(),
                            snapshot.users.len()
                        );
                        last_tree = tree;
                    }
                }
                Some(Event::Ping { rtt_ms }) => println!("ping {rtt_ms:.1} ms"),
                Some(Event::Udp { active }) => println!(
                    "voice transport: {}",
                    if active { "UDP" } else { "TCP tunnel" }
                ),
                Some(Event::Text { message, .. }) => println!("text message: {} chars", message.len()),
                Some(Event::Denied { reason }) => println!("denied: {reason}"),
                Some(Event::Disconnected(reason)) => {
                    match reason {
                        Disconnect::Requested => println!("disconnected"),
                        other => println!("disconnected: {other:?}"),
                    }
                    break;
                }
                None => break,
            },
            () = &mut leave_after => {
                if !synced {
                    println!("no sync from the server in time; leaving");
                }
                connection.client.disconnect().await;
            }
        }
    }
    Ok(())
}
