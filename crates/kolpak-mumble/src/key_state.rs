//! Reading a key's state system-wide, for push to talk while another app has focus.
//!
//! Push to talk needs "is the key down right now", from anywhere, without taking the key
//! away from whatever the user is typing into. A registered global hotkey does the
//! opposite: it swallows the key. So on Windows we ask the system for the key's state.
//! Other platforms have no implementation yet and report `None`; there the app falls back
//! to a key listener that only works while its own window has focus.

/// Map a `KeyboardEvent.code` (the physical key, as the webview reports it) to a Windows
/// virtual-key code.
pub fn virtual_key_from_code(code: &str) -> Option<u16> {
    if let Some(letter) = code.strip_prefix("Key") {
        let mut chars = letter.chars();
        if let (Some(c @ 'A'..='Z'), None) = (chars.next(), chars.next()) {
            return Some(c as u16);
        }
        return None;
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        let mut chars = digit.chars();
        if let (Some(c @ '0'..='9'), None) = (chars.next(), chars.next()) {
            return Some(c as u16);
        }
        return None;
    }
    if let Some(digit) = code.strip_prefix("Numpad") {
        let mut chars = digit.chars();
        if let (Some(c @ '0'..='9'), None) = (chars.next(), chars.next()) {
            return Some(0x60 + (c as u16 - '0' as u16));
        }
    }
    if let Some(number) = code.strip_prefix('F') {
        if let Ok(n @ 1..=24) = number.parse::<u16>() {
            return Some(0x70 + n - 1);
        }
    }
    Some(match code {
        "Backspace" => 0x08,
        "Tab" => 0x09,
        "Enter" => 0x0d,
        "Pause" => 0x13,
        "CapsLock" => 0x14,
        "Space" => 0x20,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "End" => 0x23,
        "Home" => 0x24,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Insert" => 0x2d,
        "Delete" => 0x2e,
        "NumpadMultiply" => 0x6a,
        "NumpadAdd" => 0x6b,
        "NumpadSubtract" => 0x6d,
        "NumpadDecimal" => 0x6e,
        "NumpadDivide" => 0x6f,
        "ScrollLock" => 0x91,
        "ShiftLeft" => 0xa0,
        "ShiftRight" => 0xa1,
        "ControlLeft" => 0xa2,
        "ControlRight" => 0xa3,
        "AltLeft" => 0xa4,
        "AltRight" => 0xa5,
        "Semicolon" => 0xba,
        "Equal" => 0xbb,
        "Comma" => 0xbc,
        "Minus" => 0xbd,
        "Period" => 0xbe,
        "Slash" => 0xbf,
        "Backquote" => 0xc0,
        "BracketLeft" => 0xdb,
        "Backslash" => 0xdc,
        "BracketRight" => 0xdd,
        "Quote" => 0xde,
        _ => return None,
    })
}

/// Whether this platform can report key state system-wide.
pub const fn is_supported() -> bool {
    cfg!(windows)
}

/// Whether the key is held right now, anywhere on the system. `None` where unsupported.
#[cfg(windows)]
pub fn is_key_down(virtual_key: u16) -> Option<bool> {
    // SAFETY: GetAsyncKeyState takes a virtual-key code and has no other preconditions.
    let state = unsafe {
        windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(i32::from(virtual_key))
    };
    // The most significant bit is set while the key is down.
    Some(state < 0)
}

#[cfg(not(windows))]
pub fn is_key_down(_virtual_key: u16) -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_keys_people_bind_push_to_talk_to() {
        assert_eq!(virtual_key_from_code("KeyC"), Some(0x43));
        assert_eq!(virtual_key_from_code("KeyV"), Some(0x56));
        assert_eq!(virtual_key_from_code("Digit4"), Some(0x34));
        assert_eq!(virtual_key_from_code("CapsLock"), Some(0x14));
        assert_eq!(virtual_key_from_code("Backquote"), Some(0xc0));
        assert_eq!(virtual_key_from_code("F13"), Some(0x7c));
        assert_eq!(virtual_key_from_code("Numpad0"), Some(0x60));
        assert_eq!(virtual_key_from_code("NumpadAdd"), Some(0x6b));
        assert_eq!(virtual_key_from_code("ControlRight"), Some(0xa3));
        assert_eq!(virtual_key_from_code("AltLeft"), Some(0xa4));
    }

    #[test]
    fn rejects_codes_it_does_not_know() {
        assert_eq!(virtual_key_from_code(""), None);
        assert_eq!(virtual_key_from_code("KeyAB"), None);
        assert_eq!(virtual_key_from_code("Keya"), None);
        assert_eq!(virtual_key_from_code("Digit10"), None);
        assert_eq!(virtual_key_from_code("F25"), None);
        assert_eq!(virtual_key_from_code("F0"), None);
        assert_eq!(virtual_key_from_code("MediaPlayPause"), None);
    }

    #[test]
    fn reports_a_state_only_where_it_can_read_one() {
        // 0x87 is F24: nobody is holding it during a test run.
        assert_eq!(is_key_down(0x87), is_supported().then_some(false));
    }
}
