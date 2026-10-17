// 과목 파일 점검기: node tools/check.mjs <key> <PDF에서 뽑은 글 파일>
//   (글 파일은 node tools/extract-pdf.mjs <pdf> <out.txt> 로 만든다. pdfjs-dist가 필요: npm i pdfjs-dist@4.10.38)
// subjects/<key>.js 를 읽어 (1) 문법, (2) 모든 원문 문장·내용 요소가 PDF 글에 실제로 있는지(띄어쓰기 무시),
// (3) 빈칸 후보가 문장 안에 있는지, (4) 초등 성취기준 코드가 빠짐없이 들어갔고 문장이 PDF와 같은지,
// (5) 틀린 곳 짝(ox)의 열쇠와 바꿀 말이 실제 문장에 있는지, (6) tips()가 글을 돌려주는지 확인한다.
import fs from 'fs';
import vm from 'vm';
const [key, pdfFile] = process.argv.slice(2);
if (!key || !pdfFile) { console.error('usage: node tools/check.mjs <key> <pdf-text-file>'); process.exit(2); }
const proj = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const file = proj + 'subjects/' + key + '.js';
const pdf = fs.readFileSync(pdfFile, 'utf8');
const ws = s => s.replace(/[\s°\uE000-\uF8FF]+/g, ''); // 공백과, PDF 추출에서 빠지거나 깨지는 기호(°, 사용자 영역 글자)는 무시
// 쪽 경계의 머리말(과목명·쪽수)은 지우고 본문만 잇는다
const pdfBody = pdf.split('\n').filter(l => { const t = l.trim(); return t && !/^=== PAGE \d+ ===$/.test(t) && !/^\d+$/.test(t) && !/^(공통 교육과정|선택 중심 교육과정|[가-힣⋅·()]+ 교육과정)$/.test(t); }).join('\n');
const pdfNorm = ws(pdfBody);
// 문장이 쪽 경계(표가 끼어든 곳)에 걸치면 앞뒤 반쪽이 각각 있는지로 본다
const inPdf = s => { const n = ws(s); if (pdfNorm.includes(n)) return true; for (let i = 5; i <= n.length - 5; i++) if (pdfNorm.includes(n.slice(0, i)) && pdfNorm.includes(n.slice(i))) return 'split'; return false; };
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);

// ── 과목 파일 실행 (index.html의 도우미를 흉내 낸 환경) ──
let captured = null;
const sandbox = {
  console,
  T: (s, kw = []) => ({ s, kw }),
  CATS: ["지식이해", "과정기능", "가치태도"],
  CAT_LABEL: { "지식이해": "지식·이해", "과정기능": "과정·기능", "가치태도": "가치·태도" },
  esc: s => String(s), sentHTML: t => t.s, shuffle: a => a.slice(), tipCard: (t, b) => `<div><h2>${t}</h2>${b}</div>`,
  $: () => null, document: { head: { insertAdjacentHTML() {} } },
  TABLES: {}, TS: {}, HOT: { art: {} }, OX_SWAP: {}, AREAS: [], GRADES: [], DATA: {}, hotFor: () => null, EXAM_NOTE: {}, SUBJECTS: {}, AREA_CLS: {}, SUBJECT_ORDER: [],
  collectSents: () => [],
  defineSubject: d => { captured = d; }
};
vm.createContext(sandbox);
try { vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
catch (e) { console.log('✖ 문법/실행 오류:', e.message); process.exit(1); }
if (!captured) { console.log('✖ defineSubject({...}) 호출이 없음'); process.exit(1); }
const d = captured;
if (d.key !== key) err(`key가 "${d.key}" — 파일 이름(${key})과 같아야 함`);
for (const f of ['name', 'short', 'sub', 'notice', 'landing', 'color', 'title', 'foot', 'areas', 'grades']) if (d[f] == null) err(`필수 항목 없음: ${f}`);

// ── 원문 문장 모으기 ──
const sents = []; // {s, kw, where}
const isT = x => x && typeof x === 'object' && typeof x.s === 'string' && Array.isArray(x.kw);
const walk = (x, where) => {
  if (isT(x)) { sents.push({ ...x, where }); return; }
  if (Array.isArray(x)) x.forEach((y, i) => walk(y, where + '[' + i + ']'));
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) if (k !== 'tsents') walk(x[k], where + '.' + k);
};
for (const part of ['overview', 'char', 'goal', 'ideas', 'note', 'extra', 'teach', 'eval', 'doc']) if (d[part]) walk(d[part], part);
// 성취기준
const sbCodes = new Map();
if (d.sb) for (const g of Object.keys(d.sb)) for (const grp of d.sb[g]) {
  if (!grp.title || !Array.isArray(grp.items)) { err(`sb[${g}] 묶음에 title/items 없음`); continue; }
  for (const it of grp.items) {
    const [code, s, kw, exp] = it;
    if (typeof code !== 'string' || typeof s !== 'string' || !Array.isArray(kw)) { err(`sb[${g}] "${grp.title}" 항목 형식 오류: ${JSON.stringify(it).slice(0, 60)}`); continue; }
    if (/[–—]/.test(code)) err(`성취기준 코드에 긴 줄표: ${code} (ASCII 하이픈으로)`);
    sbCodes.set(code.replace(/[–—]/g, '-'), s);
    sents.push({ s, kw, where: `sb[${g}] ${code}` });
    if (exp) exp.forEach((t, i) => { if (!isT(t)) err(`${code} 해설[${i}]이 T(...)가 아님`); else sents.push({ ...t, where: `${code} 해설[${i}]` }); });
  }
}
// doc을 직접 짠 옛 방식 과목(체육)은 doc 안의 "[4체01-01]" 항목을 성취기준으로 센다
const walkDocSb = x => {
  if (Array.isArray(x)) { x.forEach(walkDocSb); return; }
  if (!x || typeof x !== 'object') return;
  const m = typeof x.mk === 'string' && x.mk.match(/^\[(\d[가-힣()]+\d\d-\d\d)\]$/);
  if (m && Array.isArray(x.t) && isT(x.t[0])) sbCodes.set(m[1], x.t[0].s);
  for (const k of Object.keys(x)) if (k !== 't') walkDocSb(x[k]);
};
if (!d.sb && d.doc) walkDocSb(d.doc);
// 표 안 문장(tsents)
const walkTs = x => { if (Array.isArray(x)) x.forEach(walkTs); else if (x && typeof x === 'object') { if (Array.isArray(x.tsents)) x.tsents.forEach(([lab, t]) => sents.push({ ...t, where: 'tsents ' + lab })); for (const k of Object.keys(x)) if (k !== 'tsents') walkTs(x[k]); } };
walkTs(d.doc); walkTs(d.extra);

// ── (2)(3) 문장·빈칸 점검 ──
let nSent = 0, nKw = 0;
for (const t of sents) {
  nSent++;
  const f = inPdf(t.s);
  if (!f) err(`원문에 없는 문장 (${t.where}): ${t.s.slice(0, 70)}…`);
  else if (f === 'split') warn(`쪽 경계에 걸친 문장 — 눈으로 한 번 확인 (${t.where}): ${t.s.slice(0, 50)}…`);
  for (const k of t.kw) {
    nKw++;
    const m = k.match(/^(.*)@(\d+)$/), w = m ? m[1] : k, nth = m ? +m[2] : 1;
    let st = -1, ok = true;
    for (let i = 0; i < nth; i++) { st = t.s.indexOf(w, st + 1); if (st < 0) { ok = false; break; } }
    if (!ok) err(`빈칸 후보가 문장에 없음 (${t.where}): "${k}"`);
  }
  if (!t.kw.length) warn(`빈칸 후보 없음 (퀴즈에서 빠짐) (${t.where}): ${t.s.slice(0, 50)}…`);
}
// ── 내용 요소 ──
let nEl = 0;
if (d.el) for (const ar of Object.keys(d.el)) for (const g of Object.keys(d.el[ar])) for (const c of Object.keys(d.el[ar][g])) for (const e of d.el[ar][g][c]) {
  nEl++;
  if (typeof e !== 'string') err(`내용 요소가 문자열이 아님: ${ar}/${g}/${c}`);
  else { const r = inPdf(e); if (!r) err(`원문에 없는 내용 요소 (${ar} · ${g} · ${c}): ${e}`); else if (r === 'split') warn(`쪽 경계에 걸친 내용 요소 — 눈으로 확인 (${ar} · ${g} · ${c}): ${e}`); }
}
if (d.el) for (const ar of d.areas) if (!d.el[ar]) warn(`영역 "${ar}"의 내용 요소가 없음`);
// ── (4) 성취기준 완전성 ──
const codeRe = /^\[([246])([가-힣()]+)(\d\d)[-–—](\d\d)\]\s*(.*)$/;
const lines = pdf.split('\n');
const pdfSb = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(codeRe);
  if (!m) continue;
  let s = m[5];
  for (let j = i + 1; j < lines.length && j < i + 6; j++) { const l = lines[j].trim(); if (!l) continue; if (/^\[|^\(가\)|^\(나\)|^\(\d\)|^<표|^[•●\uf000-\uf8ff]/.test(l) || /^[가-힣]\. |^\d\. /.test(l)) break; s += l; if (/[.다]$/.test(l)) break; }
  const code = `${m[1]}${m[2]}${m[3]}-${m[4]}`;
  if (!pdfSb.has(code)) pdfSb.set(code, s);
}
const only = (a, b) => [...a].filter(x => !b.has(x));
const missing = only(pdfSb.keys(), sbCodes), extra = only(sbCodes.keys(), pdfSb);
if (missing.length) err(`PDF에 있는데 빠진 초등 성취기준: ${missing.join(', ')}`);
if (extra.length) err(`PDF에서 못 찾은 성취기준 코드: ${extra.join(', ')}`);
for (const [code, s] of sbCodes) if (pdfSb.has(code) && ws(pdfSb.get(code)) !== ws(s)) {
  // PDF 쪽 문장 추출이 한 줄 더 붙었을 수 있으니 포함 관계면 경고로
  if (ws(pdfSb.get(code)).startsWith(ws(s)) || pdfNorm.includes(ws(s))) warn(`성취기준 ${code} 문장이 PDF 추출과 조금 다름(줄 이음 확인): 파일="${s.slice(0, 40)}…" / PDF="${pdfSb.get(code).slice(0, 40)}…`);
  else err(`성취기준 ${code} 문장이 PDF와 다름: 파일="${s}" / PDF="${pdfSb.get(code)}"`);
}
// ── 목록 ──
let nList = 0;
for (const L of d.lists || []) {
  nList++;
  if (!L.sec || !L.q || !Array.isArray(L.answers) || !L.answers.length) err(`목록 형식 오류: ${JSON.stringify(L).slice(0, 80)}`);
  for (const a of L.answers) if (!pdfNorm.includes(ws(a))) warn(`목록 답이 원문에 그대로는 없음 (${L.label}): ${a}`);
}
// ── (5) 틀린 곳 짝 ──
let nOx = 0;
for (const [k, pairs] of Object.entries(d.ox || {})) {
  nOx++;
  const hit = sents.filter(t => t.s.includes(k));
  if (!hit.length) { err(`ox 열쇠가 어느 문장에도 없음: "${k}"`); continue; }
  for (const [orig, fake] of pairs) {
    if (!hit.some(t => t.s.includes(orig))) err(`ox "${k}": 바꿀 원문 말 "${orig}"이 그 문장에 없음`);
    if (typeof fake !== 'string' || !fake) err(`ox "${k}": 바꿀 말이 비어 있음`);
  }
}
// ── (6) tips ──
try { const h = d.tips ? d.tips() : ''; if (typeof h !== 'string' || h.length < 100) warn('tips()가 너무 짧거나 문자열이 아님'); } catch (e) { err('tips() 실행 오류: ' + e.message); }
if (!d.examNote) warn('examNote 없음');

console.log(`[${key}] 문장 ${nSent}개 · 빈칸 후보 ${nKw}개 · 내용 요소 ${nEl}개 · 성취기준 ${sbCodes.size}개(PDF 초등 ${pdfSb.size}개) · 목록 ${nList}개 · ox ${nOx}개`);
warns.forEach(w => console.log('  ⚠ ' + w));
errors.forEach(e => console.log('  ✖ ' + e));
console.log(errors.length ? `✖ 오류 ${errors.length}개` : '✔ 오류 없음' + (warns.length ? ` (경고 ${warns.length}개)` : ''));
process.exit(errors.length ? 1 : 0);
