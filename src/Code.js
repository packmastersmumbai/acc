/**
 * Web-app entry. Routes ?p=<name> to src/pages/<name>.html.
 * Default page is 'home'. Mirrors the PackMastersQrAtt doGet pattern.
 */
function doGet(e) {
  const p = (e && e.parameter && e.parameter.p) || 'home';
  const t = HtmlService.createTemplateFromFile('pages/' + p);
  return t.evaluate()
    .setTitle('PackMasters Accounts')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Include a partial file inside a template: <?!= include('pages/shared/foo') ?> */
function include(f) {
  return HtmlService.createHtmlOutputFromFile(f).getContent();
}
