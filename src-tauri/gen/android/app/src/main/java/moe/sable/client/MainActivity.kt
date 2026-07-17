package moe.sable.client

import android.graphics.Color
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  private external fun nativeInitStatusBar()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    instance = this
    runCatching { nativeInitStatusBar() }
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    private var instance: MainActivity? = null

    // Called from Rust (JNI) to tint the status bar and adapt icon contrast.
    @JvmStatic
    fun setStatusBarColorNative(color: Int) {
      val activity = instance ?: return
      activity.runOnUiThread {
        val window = activity.window
        window.statusBarColor = color
        val luminance =
          (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars =
          luminance > 0.5
      }
    }
  }
}
