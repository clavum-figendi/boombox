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
        Bundle progress = new Bundle();progress.putString("stream", "EVAL: " + script + "\n");sendStatus(0, progress);
        ArrayBlockingQueue<String> q = new ArrayBlockingQueue<>(1);
        runOnMainSync(() -> {
            android.util.Log.i("BoomboxTest", "Submitting JS; URL=" + app.web.getUrl() + " progress=" + app.web.getProgress());
            app.web.evaluateJavascript(script, value -> {
                android.util.Log.i("BoomboxTest", "Callback: " + value);q.offer(value);
            });
            android.util.Log.i("BoomboxTest", "evaluateJavascript returned");
        });
        String result = q.poll(15, TimeUnit.SECONDS);
        if (result == null) {
            for (java.util.Map.Entry<Thread,StackTraceElement[]> entry : Thread.getAllStackTraces().entrySet()) {
                android.util.Log.e("BoomboxTest", "THREAD " + entry.getKey().getName() + " " + entry.getKey().getState());
                for (StackTraceElement frame : entry.getValue()) android.util.Log.e("BoomboxTest", "  " + frame);
            }
            throw new AssertionError("JavaScript callback timeout: " + script);
        }
        return result;
    }
    private void awaitBundledLoad(int previous) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
        while (app.bundledLoads <= previous) {
            if (System.nanoTime() > deadline) throw new AssertionError("Bundled document did not finish loading");
            Thread.sleep(100);
        }
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            Intent launch = new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app = (MainActivity) startActivitySync(launch);
            awaitBundledLoad(0);
            eval("1+1");
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
            int previousLoads = app.bundledLoads;
            runOnMainSync(() -> app.web.reload());
            awaitBundledLoad(previousLoads);
            end = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            while (!"true".equals(eval("document.documentElement.dataset.ready==='true' && !!window.boombox && window.boombox.settings.seed!==" + reloadSeed))) {
                if (System.nanoTime() > end) throw new AssertionError("Offline refresh did not produce a fresh sound");
                Thread.sleep(300);
            }
            if (!"false".equals(eval("window.boombox.engine.playing"))) throw new AssertionError("Refresh must not autoplay");
            String expanded = eval("(()=>{const scale=document.querySelector('#scale');scale.value='lydian';scale.dispatchEvent(new Event('input',{bubbles:true}));const lead=document.querySelector('[aria-label=\"lead instrument\"]');if(!lead)return false;lead.value='fm_bell';lead.dispatchEvent(new Event('change',{bubbles:true}));return boombox.settings.scale==='lydian'&&boombox.settings.channels.lead.instrument==='fm_bell';})()");
            if (!"true".equals(expanded)) throw new AssertionError("Expanded scale or instrument controls did not reach the engine");
            eval("(()=>{const minutes=document.querySelector('#variationMinutes');minutes.value='0.1';minutes.dispatchEvent(new Event('input',{bubbles:true}));minutes.dispatchEvent(new Event('change',{bubbles:true}));const enabled=document.querySelector('#autoVariation');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#play').click();return true;})()");
            String autoSeed = eval("window.boombox.settings.seed");
            end = System.nanoTime() + TimeUnit.SECONDS.toNanos(14);
            while (autoSeed.equals(eval("window.boombox.settings.seed"))) {
                if (System.nanoTime() > end) throw new AssertionError("Automatic variation did not run without a session timer");
                Thread.sleep(500);
            }
            if (!"true".equals(eval("window.boombox.engine.playing && document.querySelector('#timer').value==='0'"))) throw new AssertionError("Automatic variation should continue unlimited playback");
            eval("document.querySelector('#stop').click();true");
            result.putString("stream", "BOOMBOX_OFFLINE_AUDIO_PASS: cold launch, dark default, audio, stop, fresh reload, Lydian/FM controls and automatic variation with no stop timer\n");
            finish(ActivityResult.OK, result);
        } catch (Throwable e) { result.putString("stream", "FAIL: " + e + "\n"); finish(ActivityResult.FAIL, result); }
    }
    private static final class ActivityResult { static final int OK = -1; static final int FAIL = 0; }
}
