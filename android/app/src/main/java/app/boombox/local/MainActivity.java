package app.boombox.local;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/** Bundled-only HTTPS origin. No Internet, microphone or shared-storage permission. */
public class MainActivity extends Activity {
    WebView web;
    volatile int bundledLoads;
    private ValueCallback<Uri[]> chooser;
    private byte[] pendingExport;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new ExportBridge(), "BoomboxAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                if ("https://boombox.local/".equals(url)) bundledLoads++;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !"https://boombox.local/".equals(r.getUrl().toString());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!"https".equals(u.getScheme()) || !"boombox.local".equals(u.getHost()) || !"GET".equals(r.getMethod())) return blocked();
                String path = u.getPath();
                if (path == null || path.contains("..") || path.contains("\\")) return blocked();
                if (path.equals("/")) path = "/index.html";
                String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".webmanifest") ? "application/manifest+json" : path.endsWith(".html") ? "text/html" : "text/plain";
                try {
                    InputStream data = getAssets().open("web" + path);
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, data);
                } catch (Exception e) { return blocked(); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                android.util.Log.i("BoomboxWeb", message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                try {
                    Intent i = params.createIntent();
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(i, 10);
                    return true;
                } catch (Exception e) { chooser = null; return false; }
            }
        });
        web.loadUrl("https://boombox.local/");
    }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
    private class ExportBridge {
        @JavascriptInterface public void saveFile(String name, String mime, String base64) {
            if (base64 == null || base64.length() > 100_000_000) return;
            runOnUiThread(() -> {
                if (!"https://boombox.local/".equals(web.getUrl()) || pendingExport != null) return;
                try {
                    pendingExport = Base64.decode(base64, Base64.DEFAULT);
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime != null && mime.matches("[\\w.+-]+/[\\w.+-]+") ? mime : "application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE, name == null ? "boombox-export" : name.replaceAll("[^a-zA-Z0-9._-]", "_"));
                    startActivityForResult(i, 11);
                } catch (Exception e) { pendingExport = null; Toast.makeText(MainActivity.this, "Could not save file", Toast.LENGTH_LONG).show(); }
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 10 && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            chooser = null;
        }
        if (request == 11) {
            byte[] bytes = pendingExport; pendingExport = null;
            if (result == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                new Thread(() -> {
                    try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                        if (out == null) throw new java.io.IOException("No output stream");
                        out.write(bytes);
                        runOnUiThread(() -> Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show());
                    } catch (Exception e) { runOnUiThread(() -> Toast.makeText(this, "Save failed", Toast.LENGTH_LONG).show()); }
                }, "boombox-export").start();
            }
        }
    }
    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { if (web != null) { web.removeJavascriptInterface("BoomboxAndroid"); web.destroy(); } super.onDestroy(); }
}
