import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const [,, src, dst] = process.argv;
const data = new Uint8Array(fs.readFileSync(src));
const doc = await getDocument({ data, cMapUrl: new URL('./node_modules/pdfjs-dist/cmaps/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') + '/', cMapPacked: true, standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') + '/' }).promise;
let out = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  out += `\n=== PAGE ${i} ===\n`;
  let lastY = null, line = '';
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const y = Math.round(it.transform[5]);
    if (lastY !== null && Math.abs(y - lastY) > 2) { out += line + '\n'; line = ''; }
    line += it.str;
    if (it.hasEOL) { out += line + '\n'; line = ''; lastY = null; continue; }
    lastY = y;
  }
  out += line + '\n';
}
fs.writeFileSync(dst, out, 'utf8');
console.log('pages', doc.numPages, 'chars', out.length);
