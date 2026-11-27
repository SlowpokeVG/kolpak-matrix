// Native status-bar tinting. The webview draws edge-to-edge under a transparent
// status bar, so only Window.setStatusBarColor can color that region. Rust can't
// reach the Activity directly (ndk-context isn't populated by Tauri), so
// MainActivity hands us the JavaVM on create and we call back into a static
// method that owns the window.

use std::sync::OnceLock;

use jni::objects::{JClass, JObject, JValue};
use jni::refs::Global;
use jni::strings::JNIString;
use jni::{jni_sig, jni_str, EnvUnowned, JavaVM};
use tauri::{AppHandle, Emitter};

static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
/// MainActivity's class, looked up on the Java thread that creates the activity. `FindClass`
/// from a native thread (a Tokio worker running an async command, say) only sees system
/// classes on Android, so calls that may come from such a thread go through this. Kolpak.
static ACTIVITY_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();

pub fn set_app_handle(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

// Called by MainActivity.onCreate to cache the JavaVM for later callbacks.
#[no_mangle]
pub extern "system" fn Java_com_klpq_kolpak_MainActivity_nativeInitStatusBar(
    mut env: EnvUnowned,
    this: JObject,
) {
    let _ = env.with_env(|env| {
        let vm = env.get_java_vm()?;
        let _ = JAVA_VM.set(vm);
        if ACTIVITY_CLASS.get().is_none() {
            let class = env.get_object_class(&this)?;
            let _ = ACTIVITY_CLASS.set(env.new_global_ref(&class)?);
        }
        Ok::<_, jni::errors::Error>(())
    });
}

#[no_mangle]
pub extern "system" fn Java_com_klpq_kolpak_MainActivity_nativeShareReceived(
    _env: EnvUnowned,
    _this: JObject,
) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("share-received", ());
    }
}

/// Kolpak: the Leave button on the voice notification, or the app swiped away while in voice.
#[no_mangle]
pub extern "system" fn Java_com_klpq_kolpak_VoiceService_nativeLeaveVoice(
    _env: EnvUnowned,
    _this: JObject,
) {
    if let Some(app) = APP_HANDLE.get() {
        crate::mumble::leave_voice(app.clone());
    }
}

/// A constant, not a literal in the emit call: the bindings generator turns literal event
/// names into function names, and `kolpak://pip` is not a valid one.
const EVENT_PIP: &str = "kolpak://pip";

/// Kolpak: the stream's picture-in-picture window opened or closed (`dismissed` when the
/// user closed it rather than expanding it back).
#[no_mangle]
pub extern "system" fn Java_com_klpq_kolpak_MainActivity_nativePipChanged(
    _env: EnvUnowned,
    _this: JObject,
    active: jni::sys::jboolean,
    dismissed: jni::sys::jboolean,
) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(
            EVENT_PIP,
            serde_json::json!({ "active": active, "dismissed": dismissed }),
        );
    }
}

/// Kolpak: put the app into picture in picture, shaped like the video (`width` by `height`).
#[tauri::command]
pub fn kolpak_enter_pip(width: u32, height: u32) -> Result<(), String> {
    let clamp = |v: u32| i32::try_from(v).unwrap_or(0);
    call_activity_static(
        "enterPipNative",
        jni_sig!("(II)V"),
        &[JValue::Int(clamp(width)), JValue::Int(clamp(height))],
    )
}

/// Kolpak: open Android's settings for the "Background connection" notification channel.
#[tauri::command]
pub fn kolpak_open_background_connection_settings() -> Result<(), String> {
    call_activity_static(
        "openBackgroundConnectionSettingsNative",
        jni_sig!("()V"),
        &[],
    )
}

/// `color` is a packed ARGB int (as produced by Android's `Color`).
#[tauri::command]
pub fn set_status_bar_color(color: u32) -> Result<(), String> {
    call_bar_color("setStatusBarColorNative", color)
}

/// `color` is a packed ARGB int (as produced by Android's `Color`).
#[tauri::command]
pub fn set_navigation_bar_color(color: u32) -> Result<(), String> {
    call_bar_color("setNavigationBarColorNative", color)
}

/// `color` is a packed ARGB int (as produced by Android's `Color`).
#[tauri::command]
pub fn set_window_background_color(color: u32) -> Result<(), String> {
    call_bar_color("setWindowBackgroundColorNative", color)
}

#[tauri::command]
pub fn set_immersive_mode(enabled: bool) -> Result<(), String> {
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(
            jni_str!("com/klpq/kolpak/MainActivity"),
            jni_str!("setImmersiveModeNative"),
            jni_sig!("(Z)V"),
            &[JValue::Bool(enabled)],
        );
        if result.is_err() {
            env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_call_foreground_service() -> Result<(), String> {
    call_static_method("startCallForegroundServiceNative")
}

#[tauri::command]
pub fn stop_call_foreground_service() -> Result<(), String> {
    call_static_method("stopCallForegroundServiceNative")
}

/// `kind` is "notification" or "invite"; mapped to an int to avoid JNI string
/// marshalling (mirrors set_*_bar_color).
pub(crate) fn play_notification_sound(kind: String) -> Result<(), String> {
    let code = match kind.as_str() {
        "invite" => 1,
        _ => 0,
    };
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(
            jni_str!("com/klpq/kolpak/MainActivity"),
            jni_str!("playNotificationSoundNative"),
            jni_sig!("(I)V"),
            &[JValue::Int(code)],
        );
        if result.is_err() {
            env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|e| e.to_string())
}

fn call_bar_color(method: &str, color: u32) -> Result<(), String> {
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(
            jni_str!("com/klpq/kolpak/MainActivity"),
            JNIString::new(method),
            jni_sig!("(I)V"),
            &[JValue::Int(color as i32)],
        );
        if result.is_err() {
            env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|e| e.to_string())
}

fn call_static_method(method: &str) -> Result<(), String> {
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(
            jni_str!("com/klpq/kolpak/MainActivity"),
            JNIString::new(method),
            jni_sig!("()V"),
            &[],
        );
        if result.is_err() {
            env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|e| e.to_string())
}

/// Kolpak: the Mumble voice session. Starts the voice foreground service (keeps the
/// connection and audio alive with the screen off, shows the "in voice" notification) and,
/// in call mode, puts the audio system in communication mode with the route picked for
/// voice. Calling it again switches the mode. Safe from any thread.
pub(crate) fn start_voice_session(call_mode: bool) -> Result<(), String> {
    call_activity_static(
        "startVoiceSessionNative",
        jni_sig!("(Z)V"),
        &[JValue::Bool(call_mode)],
    )
}

/// Kolpak: ends the voice session: the service stops and the audio mode goes back to normal.
pub(crate) fn stop_voice_session() -> Result<(), String> {
    call_activity_static("stopVoiceSessionNative", jni_sig!("()V"), &[])
}

/// Kolpak: the microphone opened or closed; the voice service keeps Wi-Fi in its
/// low-latency mode only while it is open.
pub(crate) fn set_voice_transmit(on: bool) -> Result<(), String> {
    call_activity_static(
        "setVoiceTransmitNative",
        jni_sig!("(Z)V"),
        &[JValue::Bool(on)],
    )
}

fn call_activity_static(
    method: &str,
    sig: jni::signature::MethodSignature<'static, 'static>,
    args: &[JValue],
) -> Result<(), String> {
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    let class = ACTIVITY_CLASS
        .get()
        .ok_or("activity class not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(class, JNIString::new(method), &sig, args);
        if result.is_err() {
            env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|e| e.to_string())
}
