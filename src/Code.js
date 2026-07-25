/**
 * Web-app entry. Routes ?p=<name> to src/pages/<name>.html.
 * Default page is 'home'. Mirrors the PackMastersQrAtt doGet pattern.
 */
function doGet(e) {
  const p = (e && e.parameter && e.parameter.p) || 'home';
  const t = HtmlService.createTemplateFromFile('pages/' + p);
  t.appUrl = ScriptApp.getService().getUrl();  // pages use this to navigate (top.location)
  t.qs = (e && e.parameter) || {};
  t.page = p;  // authoritative: the client cannot read the wrapper's URL (cross-origin)
  return t.evaluate()
    .setTitle('PackMasters Accounts')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Include a partial file inside a template: <?!= include('pages/shared/foo') ?> */
function include(f) {
  return HtmlService.createHtmlOutputFromFile(f).getContent();
}
