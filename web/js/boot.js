// One import, one caught startup boundary. Retry reloads without clearing local data.
function startupFailure(error) {
  if(document.documentElement.dataset.ready==='true')return;
  // Avoid exposing URLs, project text or file names in shareable diagnostics.
  window.boomboxBootError = error instanceof SyntaxError ? 'Startup syntax error' : 'Startup module could not load or initialize';
  const panel=document.querySelector('#startupFailure');
  panel.hidden=false;
  document.querySelector('#status').textContent='Boombox could not start. Use Retry / reload to try again; your saved project stays on this device.';
  document.querySelector('#startupDiagnostics').textContent=[
    `Browser: ${navigator.userAgent}`,
    `Secure context: ${window.isSecureContext}`,
    `Startup error: ${window.boomboxBootError}`
  ].join('\n');
}
document.querySelector('#retryStartup').addEventListener('click',()=>location.reload());
import('./app.js').catch(startupFailure);
