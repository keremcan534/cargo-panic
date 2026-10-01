package com.keremcan534.cargopanic;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The game, full screen: the status and navigation bars stay hidden, so a
 * crate dragged to the bottom row or a tap on the HUD never lands on a system
 * bar. A swipe from the edge shows them for a moment and they hide again by
 * themselves; they are hidden again whenever the game comes back into focus
 * (after a dialog, the recents screen or another app). The screen stays on
 * while the game is in front: a player thinking over a stack touches nothing
 * for a while, and the screen should not dim mid-level.
 *
 * Insets: with the bars hidden only a display cutout is left; the WebView
 * reports it as env(safe-area-inset-*) (the page uses viewport-fit=cover),
 * which the game's CSS already adds to its top and bottom offsets.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}
