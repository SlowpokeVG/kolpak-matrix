package com.klpq.kolpak

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Kolpak: keeps the app alive while it is connected to Mumble.
 *
 * Voice runs in Rust (crates/kolpak-mumble): the connection, the microphone and the speaker
 * are native threads, not the WebView. Without a foreground service Android stops the app's
 * networking and audio soon after the screen goes off. The service shows an ongoing
 * notification with a Leave button, holds a partial wake lock and a Wi-Fi lock so voice
 * packets keep flowing with the screen off, and is typed "microphone" when the microphone
 * permission is granted ("media playback" otherwise, for listening only).
 *
 * Swiping the app away from the recent apps leaves voice: the WebView that shows the voice
 * state is gone then, and a session nobody can see or end is worse than none.
 */
class VoiceService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  private external fun nativeLeaveVoice()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_LEAVE) {
      leaveVoice()
      return START_NOT_STICKY
    }

    try {
      createNotificationChannel()
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), serviceType())
    } catch (error: Exception) {
      // Android 12+ refuses to start a foreground service from the background, and 14+
      // refuses the microphone type without the permission. Voice still works while the
      // app is open.
      Log.e(TAG, "could not start the voice foreground service", error)
      stopSelf(startId)
      return START_NOT_STICKY
    }

    acquireLocks()
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    leaveVoice()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (running === this) running = null
    // The next session starts muted; the microphone says otherwise when it opens.
    transmitting = false
    releaseLocks()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun leaveVoice() {
    // Disconnects in Rust, which then calls stop() on this service through MainActivity.
    runCatching { nativeLeaveVoice() }
      .onFailure { Log.w(TAG, "could not leave voice: ${it.message}") }
    VoiceAudio.release(applicationContext)
    stopSelf()
  }

  private fun hasMicrophone(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun serviceType(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && hasMicrophone()) {
      type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return type
  }

  private fun buildNotification() =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_notification)
      .setContentTitle("Kolpak voice")
      .setContentText("Connected to Mumble")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(openAppIntent())
      .addAction(0, "Leave", leaveIntent())
      .build()

  private fun openAppIntent(): PendingIntent {
    val intent = Intent(this, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun leaveIntent(): PendingIntent {
    val intent = Intent(this, VoiceService::class.java).setAction(ACTION_LEAVE)
    return PendingIntent.getService(
      this, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun acquireLocks() {
    if (wakeLock?.isHeld != true) {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Kolpak:Voice").apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
    }
    applyWifiLock()
  }

  /**
   * Kolpak: Wi-Fi's low-latency mode (power saving off) only while the microphone is open,
   * that is while we may talk. Listening copes with Wi-Fi power saving.
   */
  private fun applyWifiLock() {
    if (!transmitting) {
      wifiLock?.let { if (it.isHeld) it.release() }
      wifiLock = null
      return
    }
    if (wifiLock?.isHeld != true) {
      val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        WifiManager.WIFI_MODE_FULL_LOW_LATENCY
      } else {
        @Suppress("DEPRECATION")
        WifiManager.WIFI_MODE_FULL_HIGH_PERF
      }
      wifiLock = runCatching {
        wm.createWifiLock(mode, "Kolpak:Voice").apply {
          setReferenceCounted(false)
          acquire()
        }
      }.getOrNull()
    }
  }

  private fun releaseLocks() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }
    wifiLock = null
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Voice", NotificationManager.IMPORTANCE_LOW)
    channel.description = "Shown while Kolpak is connected to Mumble"
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "kolpak_voice"
    private const val NOTIFICATION_ID = 1396
    private const val TAG = "KolpakVoice"
    private const val ACTION_LEAVE = "com.klpq.kolpak.voice.LEAVE"
    // Taken when the service starts; long enough for a long evening in voice. It keeps the
    // connection's pings going with the screen off.
    private const val WAKE_LOCK_TIMEOUT_MS = 12L * 60L * 60L * 1000L

    @Volatile
    private var transmitting = false

    @Volatile
    private var running: VoiceService? = null

    fun setTransmitting(on: Boolean) {
      transmitting = on
      running?.let { service -> android.os.Handler(service.mainLooper).post { service.applyWifiLock() } }
    }

    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, VoiceService::class.java))
      } catch (error: Exception) {
        Log.e(TAG, "could not start the voice service", error)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, VoiceService::class.java))
    }
  }
}
