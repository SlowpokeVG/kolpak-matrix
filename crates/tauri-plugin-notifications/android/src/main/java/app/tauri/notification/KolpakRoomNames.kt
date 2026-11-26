package app.tauri.notification

import android.content.Context
import java.io.File
import org.json.JSONObject

/**
 * Kolpak: room names for pushes that carry none (some homeservers leave `room_name` out).
 * The app writes `{roomId: name}` next to its copy of the room keys
 * (src-tauri/src/push_keys.rs, `room-names.json` under the app's data directory).
 */
internal object KolpakRoomNames {
    private const val FILE = "kolpak-push-keys/room-names.json"

    @Volatile
    private var cached: Pair<Long, JSONObject>? = null

    fun lookup(context: Context, roomId: String): String {
        if (roomId.isEmpty()) return ""
        val file = File(context.dataDir, FILE)
        val modified = file.lastModified()
        if (modified == 0L) return ""
        val names = cached?.takeIf { it.first == modified }?.second
            ?: runCatching { JSONObject(file.readText()) }.getOrNull()?.also { cached = modified to it }
            ?: return ""
        return names.optString(roomId)
    }
}
