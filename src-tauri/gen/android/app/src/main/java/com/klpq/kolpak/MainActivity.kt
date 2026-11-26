package com.klpq.kolpak

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.util.Rational
import androidx.lifecycle.Lifecycle
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private external fun nativeInitStatusBar()
  private external fun nativeShareReceived()
  // Kolpak: tells the webview the stream picture-in-picture window opened or closed.
  private external fun nativePipChanged(active: Boolean, dismissed: Boolean)

  // Route the hardware back button through the web app (see onWebViewCreate).
  override val handleBackNavigation: Boolean = false
  private var webView: WebView? = null
  private var handlingBack = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Load app_lib before calling our JNI bridge, but before Tauri creates the WebView.
    Rust.javaClass
    runCatching { nativeInitStatusBar() }
    super.onCreate(savedInstanceState)
    instance = this
    appContext = applicationContext
    stageShareIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    stageShareIntent(intent)
  }

  private fun stageShareIntent(intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return
    Thread {
      runCatching { stageShareIntentOnWorker(intent, action) }
        .onFailure { android.util.Log.w("ShareTarget", "stage failed: ${it.message}") }
    }.start()
  }

  private fun stageShareIntentOnWorker(intent: Intent, action: String) {
    val batchDir = File(File(dataDir, "share_inbox"), "${System.currentTimeMillis()}-${UUID.randomUUID()}")
    if (!batchDir.mkdirs() && !batchDir.isDirectory) {
      android.util.Log.w("ShareTarget", "could not create share batch directory")
      return
    }
    val items = JSONArray()

    when (action) {
      Intent.ACTION_SEND -> {
        when (intent.type) {
          "text/plain" -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let { addTextItem(items, it) }
          else -> {
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
              ?.let { stageFile(it, 0, batchDir, items) }
            intent.getStringExtra(Intent.EXTRA_TEXT)?.let { addTextItem(items, it) }
          }
        }
      }
      Intent.ACTION_SEND_MULTIPLE -> {
        IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
          ?.forEachIndexed { i, uri -> stageFile(uri, i, batchDir, items) }
      }
    }

    if (items.length() == 0) {
      batchDir.deleteRecursively()
      return
    }
    File(batchDir, "share.json").writeText(
      JSONObject().apply {
        put("version", 1)
        put("items", items)
      }.toString()
    )
    runCatching { nativeShareReceived() }
      .onFailure { android.util.Log.w("ShareTarget", "notification failed: ${it.message}") }
  }

  private fun addTextItem(items: JSONArray, text: String) {
    items.put(JSONObject().apply {
      put("kind", if (text.startsWith("http://") || text.startsWith("https://")) "url" else "text")
      put("text", text)
    })
  }

  private fun stageFile(uri: Uri, index: Int, batchDir: File, items: JSONArray) {
    val resolver = contentResolver
    var displayName = "shared-$index"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) {
        val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (i >= 0) displayName = c.getString(i)
      }
    }
    val sanitized = displayName
      .replace("/", "_").replace("\\", "_").replace("\u0000", "")
      .take(120)
      .let { if (it.isEmpty() || it == "." || it == "..") "shared" else it }

    val fileName = "$index-$sanitized"
    val dest = File(batchDir, fileName)
    val input = resolver.openInputStream(uri)
    if (input == null) {
      android.util.Log.w("ShareTarget", "provider returned no stream for $uri")
      return
    }
    try {
      input.use { FileOutputStream(dest).use { output -> it.copyTo(output) } }
      items.put(JSONObject().apply {
        put("kind", "file")
        put("fileName", fileName)
        put("mime", resolver.getType(uri) ?: "application/octet-stream")
      })
    } catch (e: Exception) {
      android.util.Log.w("ShareTarget", "stage failed: ${e.message}")
      dest.delete()
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (handlingBack) return
          val wv = this@MainActivity.webView
          if (wv == null) {
            moveTaskToBack(true)
            return
          }
          handlingBack = true
          // If the web app didn't consume the back press, background the app.
          wv.evaluateJavascript(
            "(typeof window.__sableAndroidBack === 'function' && window.__sableAndroidBack() === true)"
          ) { result ->
            handlingBack = false
            if (result != "true") moveTaskToBack(true)
          }
        }
      }
    )
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  // Kolpak: the stream's picture in picture. The whole activity shrinks into the floating
  // window; the webview then shows only the video (src/kolpak/streams/pip.ts). Closing the
  // window leaves the activity stopped, which is how a dismissal differs from expanding it.
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    val dismissed = !isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED
    // Closed rather than expanded: the activity is stopped, so let the webview rest as it
    // would have after an ordinary onPause (see onPause below).
    if (dismissed) webView?.onPause()
    runCatching { nativePipChanged(isInPictureInPictureMode, dismissed) }
      .onFailure { android.util.Log.w("KolpakPip", "notify failed: ${it.message}") }
  }

  // Entering picture in picture pauses the activity, and WryActivity.onPause pauses the
  // webview with it: no more frames, so the floating window would show a frozen picture of
  // the page. In picture in picture the webview has to keep running; undo that pause.
  override fun onPause() {
    super.onPause()
    if (isInPictureInPictureMode) webView?.onResume()
  }

  companion object {
    private var instance: MainActivity? = null
    // Kolpak: outlives the activity, for the voice session (which does too).
    private var appContext: Context? = null
    private var notificationPlayer: MediaPlayer? = null
    private var immersiveSystemBarsBehavior: Int? = null
    private var immersiveDepth = 0

    // Bars stay transparent (edge-to-edge plugin) so the webview strips supply the color
    // on every version; these only adapt icon contrast. setStatusBarColor/setNavigationBarColor
    // are no-ops under enforced edge-to-edge on Android 15+, so we avoid them.
    @JvmStatic
    fun setStatusBarColorNative(color: Int) {
      val activity = instance ?: return
      activity.runOnUiThread {
        val window = activity.window
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars =
          isLight(color)
      }
    }

    @JvmStatic
    fun setNavigationBarColorNative(color: Int) {
      val activity = instance ?: return
      activity.runOnUiThread {
        val window = activity.window
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars =
          isLight(color)
      }
    }

    @JvmStatic
    fun setWindowBackgroundColorNative(color: Int) {
      val activity = instance ?: return
      activity.runOnUiThread {
        activity.window.setBackgroundDrawable(ColorDrawable(color))
      }
    }

    @JvmStatic
    fun setImmersiveModeNative(enabled: Boolean) {
      val activity = instance ?: return
      activity.runOnUiThread {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        if (enabled) {
          immersiveDepth += 1
          if (immersiveDepth > 1) return@runOnUiThread
          if (immersiveSystemBarsBehavior == null) {
            immersiveSystemBarsBehavior = controller.systemBarsBehavior
          }
          controller.systemBarsBehavior =
            androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
          immersiveDepth = maxOf(0, immersiveDepth - 1)
          if (immersiveDepth > 0) return@runOnUiThread
          controller.show(WindowInsetsCompat.Type.systemBars())
          immersiveSystemBarsBehavior?.let { controller.systemBarsBehavior = it }
          immersiveSystemBarsBehavior = null
        }
      }
    }

    @JvmStatic
    fun startCallForegroundServiceNative() {
      val activity = checkNotNull(instance) { "MainActivity is unavailable" }
      check(
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED
      ) { "Microphone permission is not granted" }
      ContextCompat.startForegroundService(activity, Intent(activity, CallForegroundService::class.java))
    }

    // Kolpak: Mumble voice. Called from Rust (src-tauri/src/mobile.rs) on any thread when
    // joining voice, when switching between call and media audio, and when leaving.
    @JvmStatic
    fun startVoiceSessionNative(callMode: Boolean) {
      val context = appContext ?: return
      VoiceAudio.apply(context, callMode)
      VoiceService.start(context)
    }

    @JvmStatic
    fun stopVoiceSessionNative() {
      val context = appContext ?: return
      VoiceService.stop(context)
      VoiceAudio.release(context)
    }

    // Kolpak: picture in picture for the stream, at the video's own shape (kept inside the
    // range Android accepts, about 1:2.39 to 2.39:1).
    @JvmStatic
    fun enterPipNative(width: Int, height: Int) {
      val activity = instance ?: return
      activity.runOnUiThread {
        runCatching {
          val w = if (width > 0) width else 16
          val h = if (height > 0) height else 9
          val ratio = (w.toDouble() / h).coerceIn(1 / 2.39, 2.39)
          val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational((ratio * 1000).toInt(), 1000))
            .build()
          activity.enterPictureInPictureMode(params)
        }.onFailure { android.util.Log.w("KolpakPip", "enter failed: ${it.message}") }
      }
    }

    @JvmStatic
    fun stopCallForegroundServiceNative() {
      val activity = checkNotNull(instance) { "MainActivity is unavailable" }
      activity.stopService(Intent(activity, CallForegroundService::class.java))
    }

    private fun isLight(color: Int): Boolean {
      val luminance =
        (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0
      return luminance > 0.5
    }

    @JvmStatic
    fun playNotificationSoundNative(code: Int) {
      val activity = instance ?: return
      val resId = if (code == 1) R.raw.invite else R.raw.notification
      activity.runOnUiThread {
        // A message burst should produce one alert, not overlapping players.
        if (notificationPlayer != null) return@runOnUiThread

        val mp = MediaPlayer()
        try {
          val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
          mp.setAudioAttributes(attrs)
          activity.resources.openRawResourceFd(resId).use { afd ->
            mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
          }
          notificationPlayer = mp
          mp.setOnCompletionListener {
            if (notificationPlayer === it) notificationPlayer = null
            it.release()
          }
          mp.setOnErrorListener { player, _, _ ->
            if (notificationPlayer === player) notificationPlayer = null
            player.release()
            true
          }
          mp.prepare()
          mp.start()
        } catch (e: Exception) {
          if (notificationPlayer === mp) notificationPlayer = null
          mp.release()
          android.util.Log.w("NotificationSound", "play failed: ${e.message}")
        }
      }
    }

  }
}
