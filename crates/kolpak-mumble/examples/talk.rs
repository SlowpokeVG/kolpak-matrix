//! Connect to a Mumble server and send the microphone for a few seconds.
//!
//!     cargo run --example talk -- <host> [seconds] [username]
//!
//! Sends continuously (no key, no threshold) so that there is always something to hear,
//! prints the input level once a second, then leaves. `devices` as the host lists inputs.

use std::sync::Arc;
use std::time::Duration;

use kolpak_mumble::audio::{list_input_devices, pump_voice, Capture, Controls};
use kolpak_mumble::{connect, ConnectOptions, Event, TransmitMode, DEFAULT_PORT};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let host = args
        .next()
        .ok_or("usage: talk <host|devices> [seconds] [username]")?;

    if host == "devices" {
        for device in list_input_devices()? {
            println!(
                "{} {}",
                if device.is_default { "*" } else { " " },
                device.name
            );
        }
        return Ok(());
    }

    let seconds: u64 = match args.next() {
        Some(value) => value.parse()?,
        None => 5,
    };
    let username = args.next().unwrap_or_else(|| "kolpak-dev".to_owned());

    let mut connection = connect(ConnectOptions {
        host: host.clone(),
        port: DEFAULT_PORT,
        username,
        password: None,
        pinned_fingerprint: None,
        client_name: format!("Kolpak {} (spike)", env!("CARGO_PKG_VERSION")),
        join_muted: false,
        // Joining unmuted: this example exists to be heard.
        join_deafened: false,
    })
    .await?;

    // Wait until the server has let us in; audio sent before that is ignored.
    loop {
        match connection.events.recv().await {
            Some(Event::Synced { session, .. }) => {
                println!("synced as session {session}");
                break;
            }
            Some(Event::Disconnected(reason)) => return Err(format!("{reason:?}").into()),
            Some(_) => {}
            None => return Err("connection closed".into()),
        }
    }

    let controls = Arc::new(Controls::new(TransmitMode::Continuous));
    controls.set_muted(false);
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::unbounded_channel();
    let capture = Capture::start(None, controls.clone(), frame_tx)?;
    println!(
        "microphone: {} ({} Hz, {} ch)",
        capture.info.device_name, capture.info.sample_rate, capture.info.channels
    );

    // Count frames on the way through to the pump.
    let (count_tx, count_rx) = tokio::sync::mpsc::unbounded_channel();
    let client = connection.client.clone();
    tokio::spawn(pump_voice(client, count_rx));

    let deadline = tokio::time::sleep(Duration::from_secs(seconds));
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let (mut frames, mut bytes) = (0u64, 0u64);

    loop {
        tokio::select! {
            frame = frame_rx.recv() => match frame {
                Some(frame) => {
                    frames += 1;
                    bytes += frame.opus.len() as u64;
                    let _ = count_tx.send(frame);
                }
                None => break,
            },
            _ = tick.tick() => println!("level {:.3}  frames {frames}  bytes {bytes}", controls.level()),
            event = connection.events.recv() => {
                if let Some(Event::Disconnected(reason)) = event {
                    println!("disconnected: {reason:?}");
                    return Ok(());
                }
            }
            () = &mut deadline => break,
        }
    }

    drop(capture);
    println!(
        "sent {frames} frames, {bytes} bytes of Opus ({:.1} kbit/s)",
        if frames == 0 {
            0.0
        } else {
            bytes as f64 * 8.0 / (frames as f64 * 0.02) / 1000.0
        }
    );
    // Give the last packets a moment to leave before closing.
    tokio::time::sleep(Duration::from_millis(300)).await;
    connection.client.disconnect().await;
    Ok(())
}
