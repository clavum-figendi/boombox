package app.boombox.local;

import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Intent;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Real bundled WebView test, with networking disabled by the CI harness. */
public class OfflineTest extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private MainActivity app;
    private String eval(String script) throws Exception {
        ArrayBlockingQueue<String> q = new ArrayBlockingQueue<>(1);
        runOnMainSync(() -> app.web.evaluateJavascript(script, q::offer));
        String result = q.poll(15, TimeUnit.SECONDS);
        if (result == null) throw new AssertionError("JavaScript callback timeout");
        return result;
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            Intent launch = new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app = (MainActivity) startActivitySync(launch);
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            while (!"true".equals(eval("location.href==='https://boombox.local/' && document.documentElement.dataset.ready==='true' && !!window.boombox"))) {
                if (System.nanoTime() > end) throw new AssertionError("Bundled offline UI not ready");
                Thread.sleep(300);
            }
            if (!"true".equals(eval("boombox.settings.style==='techno' && boombox.settings.channels.lead.gain<=0.1 && boombox.settings.channels.kick.gain>=0.7 && !boombox.engine.playing"))) throw new AssertionError("Expected quiet, dark techno default without autoplay");
            String clicked = eval("(()=>{let b=document.querySelector('#playButton')||document.querySelector('#play')||Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Play');if(!b)return false;b.click();return true})()");
            if (!"true".equals(clicked)) throw new AssertionError("Play button missing");
            Thread.sleep(1800);
            if (!"true".equals(eval("window.boombox.engine.playing"))) throw new AssertionError("Real UI did not start playback");
            String energy = eval("(()=>{let a=window.boombox.engine.analyser;if(!a)return false;let v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.some(x=>Math.abs(x)>.0001)})()");
            if (!"true".equals(energy)) throw new AssertionError("No synthesized audio signal");
            eval("window.boombox.engine.stop();true");
            String seed = eval("window.boombox.settings.seed");
            eval("document.querySelector('#variation').click();true");
            if (seed.equals(eval("window.boombox.settings.seed"))) throw new AssertionError("Variation did not change the seed");
            String reloadSeed = eval("window.boombox.settings.seed");
            runOnMainSync(() -> app.web.reload());
            end = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            while (!"true".equals(eval("document.documentElement.dataset.ready==='true' && !!window.boombox && window.boombox.settings.seed!==" + reloadSeed))) {
                if (System.nanoTime() > end) throw new AssertionError("Offline refresh did not produce a fresh sound");
                Thread.sleep(300);
            }
            if (!"false".equals(eval("window.boombox.engine.playing"))) throw new AssertionError("Refresh must not autoplay");
            result.putString("stream", "BOOMBOX_OFFLINE_AUDIO_PASS: bundled cold launch, dark default, real play button, nonzero audio, stop, variation and fresh offline reload\n");
            finish(ActivityResult.OK, result);
        } catch (Throwable e) { result.putString("stream", "FAIL: " + e + "\n"); finish(ActivityResult.FAIL, result); }
    }
    private static final class ActivityResult { static final int OK = -1; static final int FAIL = 0; }
}
