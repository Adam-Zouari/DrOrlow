'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const localOrigin = 'http://localhost';

function inventory(directory, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...inventory(path.join(directory, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

const files = inventory(publicDir);
const fileNames = new Set(files);
const pages = files.filter((file) => file.endsWith('.html'));
const pageDoms = new Map();
const errors = [];
let checkedReferences = 0;

function check(condition, message) {
  if (!condition) errors.push(message);
}

function pageDom(file) {
  if (!pageDoms.has(file)) {
    pageDoms.set(file, new JSDOM(fs.readFileSync(path.join(publicDir, file), 'utf8')));
  }
  return pageDoms.get(file);
}

function resolveReference(file, reference) {
  try {
    const containingFile = `${localOrigin}/${file.split('/').map(encodeURIComponent).join('/')}`;
    return new URL(reference, containingFile);
  } catch {
    check(false, `${file}: invalid URL ${reference}`);
    return null;
  }
}

function checkReference(file, reference, document, attribute) {
  const url = resolveReference(file, reference);
  if (!url || url.origin !== localOrigin) return;
  // This endpoint is a POST action rather than a static file.
  if (url.pathname === '/submit' && attribute === 'action') return;
  let name;
  let anchor;
  try {
    name = decodeURIComponent(url.pathname.slice(1));
    anchor = decodeURIComponent(url.hash.slice(1));
  } catch {
    check(false, `${file}: invalid URL encoding ${reference}`);
    return;
  }
  if (url.pathname === '/') name = 'Home.html';
  if (url.pathname === '/super-orlow' || url.pathname === '/super-orlow/') name = 'Super Orlow.html';
  // Exact names matter on Linux even though Windows file lookups ignore case.
  const exists = fileNames.has(name);
  check(exists, `${file}: missing or incorrectly cased asset ${reference}`);
  if (exists && anchor && name.endsWith('.html')) {
    const targetDocument = name === file && document ? document : pageDom(name).window.document;
    check(Boolean(targetDocument.getElementById(anchor)), `${file}: missing anchor ${reference}`);
  }
  if (!reference.startsWith('#')) checkedReferences += 1;
}

for (const page of pages) {
  const dom = pageDom(page);
  const document = dom.window.document;
  check(Boolean(document.doctype), `${page}: missing doctype`);
  check(document.documentElement.lang === 'en', `${page}: missing language`);
  check(document.querySelectorAll('main').length === 1, `${page}: needs one main landmark`);
  check(document.querySelectorAll('h1').length === 1, `${page}: needs one page title`);
  check(Boolean(document.querySelector('meta[name="description"]')?.content), `${page}: missing description`);
  check(Boolean(document.querySelector('meta[name="viewport"]')), `${page}: missing viewport`);
  check(Boolean(document.querySelector('title')?.textContent.trim()), `${page}: missing title`);
  check(Boolean(document.querySelector('.skip-link[href="#main-content"]')), `${page}: missing skip link`);
  check(document.querySelector('#main-content')?.getAttribute('tabindex') === '-1', `${page}: skip target must be focusable`);
  check(Boolean(document.querySelector('footer[role="navigation"][aria-label]')), `${page}: footer navigation needs a label`);
  const firstStylesheet = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
  const stylesheetUrl = firstStylesheet ? resolveReference(page, firstStylesheet) : null;
  check(stylesheetUrl?.origin === localOrigin && stylesheetUrl.pathname === '/assets/css/common.css', `${page}: shared stylesheet must load first`);
  const ids = new Set();
  for (const element of document.querySelectorAll('*')) {
    if (element.id) {
      check(!ids.has(element.id), `${page}: duplicate id ${element.id}`);
      ids.add(element.id);
    }
    for (const attribute of element.attributes) {
      check(!/^on/i.test(attribute.name) && attribute.name !== 'style', `${page}: inline ${attribute.name} is blocked by the content security policy`);
    }
    for (const attribute of ['src', 'href', 'action']) {
      if (element.hasAttribute(attribute)) checkReference(page, element.getAttribute(attribute), document, attribute);
    }
  }
  for (const image of document.images) check(image.hasAttribute('alt'), `${page}: image needs alt text`);
  for (const script of document.scripts) check(Boolean(script.src), `${page}: inline script is blocked by the content security policy`);
  for (const control of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    check(control.labels.length > 0, `${page}: control ${control.name} has no label`);
  }
  for (const element of document.querySelectorAll('[aria-describedby], [aria-labelledby]')) {
    for (const attribute of ['aria-describedby', 'aria-labelledby']) {
      for (const id of (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) {
        check(Boolean(document.getElementById(id)), `${page}: missing accessibility reference ${id}`);
      }
    }
  }
}

for (const file of files.filter((name) => name.endsWith('.css'))) {
  const css = fs.readFileSync(path.join(publicDir, file), 'utf8');
  check(!/-?(?:\d*\.)?\d+px\b/i.test(css), `${file}: use relative units for responsive sizing`);
  // Quoted URLs can include spaces in retained image or font filenames.
  for (const match of css.matchAll(/url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^'"\s)][^)]*?))\s*\)/gi)) {
    checkReference(file, (match[1] ?? match[2] ?? match[3]).trim());
  }
}

for (const dom of pageDoms.values()) dom.window.close();

function checkJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) checkJavaScript(filename);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
      check(result.status === 0, `${path.relative(root, filename)}: ${result.stderr || result.error || 'invalid JavaScript'}`);
    }
  }
}
for (const directory of ['public', 'server', 'scripts', 'tests']) {
  if (fs.existsSync(path.join(root, directory))) checkJavaScript(path.join(root, directory));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${pages.length} pages, ${checkedReferences} local links/assets, accessibility structure, CSP compatibility, and JavaScript syntax.`);
}
