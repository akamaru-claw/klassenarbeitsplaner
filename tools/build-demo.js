/*
 * Baut eine einzelne HTML-Datei mit Beispieldaten, die ohne Server läuft.
 * Aufruf: node tools/build-demo.js  →  dist/klassenarbeitsplaner-demo.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pub = f => path.join(root, 'public', f);
const read = f => fs.readFileSync(f, 'utf8');
const dataUri = (f, type) => `data:${type};base64,${fs.readFileSync(pub(f)).toString('base64')}`;
const inlineScript = s => `<script>\n${s.replace(/<\/script/gi, '<\\/script')}\n</script>`;

let css = read(pub('app.css')).replace("url('fonts/atkinson-next.woff2')", `url('${dataUri('fonts/atkinson-next.woff2', 'font/woff2')}')`);
let app = read(pub('app.js'));
for (const img of ['img/logo-green.png', 'img/emblem-white.png']) app = app.split(img).join(dataUri(img, 'image/png'));

let html = read(pub('index.html'))
  .replace(/<link rel="stylesheet" href="app\.css[^"]*">/, () => `<style>\n${css}\n</style>`)
  .replace('href="img/icon-64.png"', () => `href="${dataUri('img/icon-64.png', 'image/png')}"`)
  .replace('href="img/icon-180.png"', () => `href="${dataUri('img/icon-180.png', 'image/png')}"`)
  .replace('<title>Klassenarbeitsplaner – Mauritius-Gymnasium Büren</title>', '<title>Klassenarbeitsplaner (Demo) – Mauritius-Gymnasium Büren</title>')
  .replace(/<script src="core\.js[^"]*"><\/script>/, () => inlineScript(read(pub('core.js'))) + '\n' +
    inlineScript(read(path.join(__dirname, 'demo-data.js'))) + '\n' + inlineScript(read(path.join(__dirname, 'demo-shim.js'))))
  .replace(/<script src="app\.js[^"]*"><\/script>/, () => inlineScript(app));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'klassenarbeitsplaner-demo.html');
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
