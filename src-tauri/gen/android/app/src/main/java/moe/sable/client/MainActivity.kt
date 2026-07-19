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

    private fun isLight(color: Int): Boolean {
      val luminance =
        (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0
      return luminance > 0.5
    }
  }
}
