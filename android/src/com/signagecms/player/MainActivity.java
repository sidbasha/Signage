package com.signagecms.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Kiosk shell around the web player (/player). The web player does the real work: pairing, sync,
 * offline media cache, schedules, SignalR. This activity adds what a browser can't:
 * boot start, always-on screen, full-screen kiosk mode, crash/offline recovery and real device info.
 */
public class MainActivity extends Activity {
    private static final String VERSION = "1.0.0";
    private static final long RETRY_MS = 15_000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private TextView status;
    private int backPresses;
    private long firstBackAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON  // also stops the TV screensaver
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        if (Prefs.serverUrl(this) == null) showSetup(null); else showPlayer();
    }

    // ------------------------------------------------------------------ first-run setup (D-pad and touch friendly)
    private void showSetup(String error) {
        destroyWeb();
        root.removeAllViews();
        exitImmersive();

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(0xFF18212B);

        TextView title = text("Signage Player", 28, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);
        TextView help = text("Enter the address of your Signage CMS server, for example 192.168.1.10:5080", 16, 0xB3FFFFFF);
        help.setPadding(0, dp(8), 0, dp(20));
        box.addView(help);

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(0x66FFFFFF);
        input.setHint("http://192.168.1.10:5080");
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        String saved = Prefs.serverUrl(this);
        if (saved != null) input.setText(saved);
        box.addView(input, new LinearLayout.LayoutParams(Math.min(dp(560), getResources().getDisplayMetrics().widthPixels - dp(64)), ViewGroup.LayoutParams.WRAP_CONTENT));

        final TextView msg = text(error == null ? "" : error, 15, 0xFFE8A33D);
        msg.setPadding(0, dp(12), 0, dp(12));
        box.addView(msg);

        final Button connect = button("Connect");
        box.addView(connect);
        final Runnable submit = new Runnable() { @Override public void run() {
            final String url = Prefs.normalize(input.getText().toString());
            if (url == null) { msg.setText("That doesn't look like a server address."); return; }
            msg.setTextColor(0xB3FFFFFF);
            msg.setText("Checking " + url + " …");
            connect.setEnabled(false);
            new Thread(new Runnable() { @Override public void run() {
                final String problem = checkServer(url);
                ui.post(new Runnable() { @Override public void run() {
                    connect.setEnabled(true);
                    if (problem == null) { Prefs.setServerUrl(MainActivity.this, url); showPlayer(); }
                    else { msg.setTextColor(0xFFE8A33D); msg.setText(problem); }
                }});
            }}).start();
        }};
        connect.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { submit.run(); } });
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(TextView v, int actionId, KeyEvent e) { submit.run(); return true; } });

        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            final Button overlay = button("Allow start on boot");
            overlay.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
                try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); }
                catch (Exception e) { msg.setText("Open Settings › Apps › Signage Player › Display over other apps."); }
            }});
            box.addView(overlay);
            TextView why = text("Android 10 and newer need \"Display over other apps\" to reopen the player after a restart.", 13, 0x80FFFFFF);
            why.setPadding(0, dp(6), 0, 0);
            box.addView(why);
        }

        TextView info = text(deviceTypeName() + " · " + Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE + " · v" + VERSION, 12, 0x59FFFFFF);
        info.setPadding(0, dp(24), 0, 0);
        box.addView(info);

        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout center = new LinearLayout(this);
        center.setGravity(Gravity.CENTER);
        center.setBackgroundColor(0xFF18212B);
        center.addView(box);
        scroll.addView(center);
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        input.requestFocus();
    }

    /** Returns null if the server answers /health, otherwise a human-readable reason. */
    private static String checkServer(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/health").openConnection();
            c.setConnectTimeout(6000); c.setReadTimeout(6000);
            int code = c.getResponseCode();
            if (code != 200) return "The server answered with HTTP " + code + ". Is this the Signage CMS address?";
            InputStream in = c.getInputStream(); byte[] b = new byte[32]; int n = in.read(b);
            String body = n > 0 ? new String(b, 0, n) : "";
            return body.startsWith("Healthy") ? null : "The server is reachable but not healthy (" + body + ").";
        } catch (java.net.UnknownHostException e) {
            return "Unknown host. Check the address.";
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            return "Can't reach the server. Check the address, that the TV is on the same network, and that the server listens on 0.0.0.0 (not localhost).";
        } catch (Exception e) {
            return "Connection failed: " + e.getMessage();
        } finally { if (c != null) c.disconnect(); }
    }

    // ------------------------------------------------------------------ player
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void showPlayer() {
        root.removeAllViews();
        destroyWeb();
        enterImmersive();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(false); // the remote's D-pad never needs to move focus into the page
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);            // localStorage: credentials, manifest, proof-of-play queue
        s.setDatabaseEnabled(true);              // IndexedDB: offline media
        s.setMediaPlaybackRequiresUserGesture(false); // videos autoplay without a tap
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " SignagePlayer/" + VERSION);
        web.addJavascriptInterface(new Bridge(), "SignageNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith(Prefs.serverUrl(MainActivity.this)); // stay inside the player
            }
            @Override public void onPageFinished(WebView view, String url) { hideStatus(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) onLoadFailed(String.valueOf(error.getDescription()));
            }
            @SuppressWarnings("deprecation")
            @Override public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(view.getUrl())) onLoadFailed(description);
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        status = text("", 14, 0xB3FFFFFF);
        status.setBackgroundColor(0x99000000);
        status.setPadding(dp(12), dp(6), dp(12), dp(6));
        status.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.START);
        lp.setMargins(dp(12), 0, 0, dp(12));
        root.addView(status, lp);

        load();
    }

    /** Online: normal HTTP caching. Offline: serve the player shell from the WebView cache so a rebooted screen still plays. */
    private void load() {
        if (web == null) return;
        web.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        web.loadUrl(Prefs.serverUrl(this) + "/player");
    }

    private void onLoadFailed(String why) {
        showStatus("Can't load the player (" + why + "). Retrying…");
        ui.removeCallbacks(retry);
        ui.postDelayed(retry, RETRY_MS);
    }
    private final Runnable retry = new Runnable() { @Override public void run() { load(); } };

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    /** Exposed to the page as window.SignageNative (see frontend/src/player/store.ts). */
    private class Bridge {
        @JavascriptInterface public String deviceType() { return isTv() ? "AndroidTv" : "AndroidTablet"; }
        @JavascriptInterface public String model() { return Build.MANUFACTURER + " " + Build.MODEL; }
        @JavascriptInterface public String osVersion() { return Build.VERSION.RELEASE; }
        @JavascriptInterface public String appVersion() { return VERSION; }
        @JavascriptInterface public String hardwareId() {
            String id = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
            return id != null ? "android-" + id : "android-unknown";
        }
        @JavascriptInterface public void reload() { ui.post(retry); }
        @JavascriptInterface public void openSettings() { ui.post(new Runnable() { @Override public void run() { showMenu(); } }); }
    }

    private boolean isTv() {
        UiModeManager m = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        if (m != null && m.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
        PackageManager pm = getPackageManager();
        return pm.hasSystemFeature("android.software.leanback") || !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
    }
    private String deviceTypeName() { return isTv() ? "Android TV" : "Android tablet"; }

    // ------------------------------------------------------------------ hidden menu: press Back 3 times within 2 s
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (web != null && (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE)) {
            long now = System.currentTimeMillis();
            if (now - firstBackAt > 2000) { firstBackAt = now; backPresses = 0; }
            if (++backPresses >= 3) { backPresses = 0; showMenu(); }
            return true; // kiosk: Back never leaves the player
        }
        if (web != null && keyCode == KeyEvent.KEYCODE_MENU) { showMenu(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    private void showMenu() {
        final boolean auto = Prefs.autoStart(this);
        String[] items = { "Reload player", "Change server  (" + Prefs.serverUrl(this) + ")", auto ? "Turn off start on boot" : "Turn on start on boot", "Exit" };
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Signage Player " + VERSION)
            .setItems(items, new android.content.DialogInterface.OnClickListener() { @Override public void onClick(android.content.DialogInterface d, int which) {
                if (which == 0) load();
                else if (which == 1) showSetup(null);
                else if (which == 2) Prefs.setAutoStart(MainActivity.this, !auto);
                else finishAndRemoveTask();
            }})
            .setNegativeButton("Close", null)
            .show();
    }

    // ------------------------------------------------------------------ lifecycle / kiosk
    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus && web != null) enterImmersive(); }
    @Override protected void onResume() { super.onResume(); if (web != null) { web.onResume(); web.resumeTimers(); } }
    // Deliberately no web.onPause(): if a notification or dialog covers the screen, playback must continue.
    @Override protected void onDestroy() { ui.removeCallbacksAndMessages(null); destroyWeb(); super.onDestroy(); }

    private void destroyWeb() {
        if (web == null) return;
        root.removeView(web);
        web.stopLoading(); web.destroy(); web = null;
    }

    private void enterImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }
    private void exitImmersive() { getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE); }

    private void showStatus(String s) { if (status != null) { status.setText(s); status.setVisibility(View.VISIBLE); } }
    private void hideStatus() { if (status != null) status.setVisibility(View.GONE); }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color); t.setGravity(Gravity.CENTER); return t;
    }
    private Button button(String label) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(320), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8); b.setLayoutParams(lp); b.setFocusable(true);
        return b;
    }
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
