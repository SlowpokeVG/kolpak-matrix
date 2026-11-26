package com.klpq.kolpak

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Kolpak: the audio system's side of Mumble voice in call mode.
 *
 * The Rust side opens its AAudio streams with the voice-communication preset and usage
 * (crates/kolpak-mumble/src/android_audio.rs). For the phone's echo canceller to engage and
 * for the sound to go where people expect, the audio system has to be in communication mode
 * and the route has to be chosen: a Bluetooth headset, then a wired or USB headset, then
 * the loudspeaker. Never the earpiece: nobody holds the phone to their ear for Mumble.
 * The route is picked again whenever a device comes or goes.
 *
 * In media mode none of this happens and the system routes as it would for music.
 */
object VoiceAudio {
  private const val TAG = "KolpakVoiceAudio"
  private val main = Handler(Looper.getMainLooper())
  private var callMode = false
  private var callback: AudioDeviceCallback? = null
  private var savedMode: Int? = null

  /** Enter (callMode = true) or leave call mode. Safe from any thread. */
  fun apply(context: Context, callMode: Boolean) {
    val app = context.applicationContext
    main.post {
      runCatching { if (callMode) enter(app) else leave(app) }
        .onFailure { Log.w(TAG, "audio mode change failed: ${it.message}") }
    }
  }

  /** Back to how the audio system was before voice. Safe from any thread. */
  fun release(context: Context) = apply(context, false)

  private fun audioManager(context: Context) =
    context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun enter(context: Context) {
    val am = audioManager(context)
    if (!callMode) {
      savedMode = am.mode
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      callMode = true
      val cb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = reroute(am)
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = reroute(am)
      }
      am.registerAudioDeviceCallback(cb, main)
      callback = cb
    }
    route(am)
  }

  private fun leave(context: Context) {
    if (!callMode) return
    val am = audioManager(context)
    callback?.let { am.unregisterAudioDeviceCallback(it) }
    callback = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      am.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      run {
        if (am.isBluetoothScoOn) {
          am.isBluetoothScoOn = false
          am.stopBluetoothSco()
        }
        am.isSpeakerphoneOn = false
      }
    }
    am.mode = savedMode ?: AudioManager.MODE_NORMAL
    savedMode = null
    callMode = false
  }

  private fun reroute(am: AudioManager) {
    if (callMode) runCatching { route(am) }.onFailure { Log.w(TAG, "reroute failed: ${it.message}") }
  }

  // Most wanted first.
  private val preference = listOf(
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
  )

  private fun route(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val available = am.availableCommunicationDevices
      val pick = preference.firstNotNullOfOrNull { type -> available.firstOrNull { it.type == type } }
      if (pick != null && am.communicationDevice?.id != pick.id) {
        val ok = am.setCommunicationDevice(pick)
        Log.i(TAG, "voice route: ${pick.productName} (type ${pick.type}) ${if (ok) "set" else "refused"}")
      }
      return
    }
    // Android 9 to 11: the older switches.
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
    val wired = outputs.any {
      it == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
        it == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
        it == AudioDeviceInfo.TYPE_USB_HEADSET
    }
    val bluetooth = outputs.contains(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    @Suppress("DEPRECATION")
    when {
      bluetooth -> {
        am.isSpeakerphoneOn = false
        am.startBluetoothSco()
        am.isBluetoothScoOn = true
      }
      wired -> {
        if (am.isBluetoothScoOn) {
          am.isBluetoothScoOn = false
          am.stopBluetoothSco()
        }
        am.isSpeakerphoneOn = false
      }
      else -> {
        if (am.isBluetoothScoOn) {
          am.isBluetoothScoOn = false
          am.stopBluetoothSco()
        }
        am.isSpeakerphoneOn = true
      }
    }
  }
}
