'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..', 'public');
const aboutScript = fs.readFileSync(path.join(root, 'assets', 'js', 'about.js'), 'utf8');

function aboutPage(t, { reducedMotion = false, supported = true, legacyMedia = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'About me.html'), 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(root, 'assets', 'css', 'About me.css'), 'utf8');
  dom.window.document.head.append(style);
  const observed = new Set();
  let intersection;
  let preferenceChange;
  let observerOptions;
  dom.window.matchMedia = () => legacyMedia
    ? { matches: reducedMotion, addListener(listener) { preferenceChange = listener; } }
    : { matches: reducedMotion, addEventListener(type, listener) { preferenceChange = listener; } };
  if (supported) dom.window.IntersectionObserver = class {
    constructor(callback, options = {}) { intersection = callback; observerOptions = options; }
    observe(element) { observed.add(element); }
    unobserve(element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  };
  dom.window.eval(aboutScript);
  return { window: dom.window, document: dom.window.document, observed, observerOptions, reveal: (element) => intersection([{ target: element, isIntersecting: true }]), reduce: () => preferenceChange({ matches: true }) };
}

test('About text reveals when it enters the viewport and is observed only once', (t) => {
  const page = aboutPage(t);
  const paragraph = page.document.querySelector('main > p');
  assert.ok(page.observed.has(paragraph));
  assert.ok(page.document.querySelector('main').classList.contains('reveal-ready'));
  assert.equal(paragraph.classList.contains('is-revealed'), false);
  page.reveal(paragraph);
  assert.ok(paragraph.classList.contains('is-revealed'));
  assert.equal(page.observed.has(paragraph), false);
});

test('the reveal observer keeps a visible region in a wide, short viewport', (t) => {
  const page = aboutPage(t);
  const viewportWidth = 3840;
  const viewportHeight = 200;
  const margins = (page.observerOptions.rootMargin || '0px').split(/\s+/);
  const bottom = margins[2] || margins[0];
  // IntersectionObserver resolves percentage root margins against root width,
  // even for the vertical edges. A negative percentage could erase this region.
  const bottomInset = parseFloat(bottom) * (bottom.endsWith('%') ? viewportWidth / 100 : 1);
  assert.ok(viewportHeight + bottomInset > 0, 'scroll targets must be able to intersect the observer');
});

test('About content images and arrows fade once without animating the logo or bubbles', (t) => {
  const page = aboutPage(t);
  const images = [...page.document.querySelectorAll('main img')];
  assert.equal(images.length, 5);
  for (const image of images) {
    assert.ok(page.observed.has(image));
    assert.ok(image.classList.contains('image-reveal'));
    assert.equal(image.classList.contains('scroll-reveal'), false, 'image reveals must not apply text translation');
    assert.equal(page.window.getComputedStyle(image).opacity, '0');
    assert.equal(page.window.getComputedStyle(image).transition, 'opacity 2s ease');
    page.reveal(image);
    assert.equal(page.window.getComputedStyle(image).opacity, '1');
    assert.equal(page.observed.has(image), false);
  }
  for (const image of page.document.querySelectorAll('header img, .bubble img')) {
    assert.equal(page.observed.has(image), false);
    assert.equal(image.classList.contains('image-reveal'), false);
  }
});

test('image reveals preserve mirrored and portrait arrow transforms', (t) => {
  const page = aboutPage(t);
  // JSDOM does not evaluate viewport media queries. Activate the existing
  // portrait arrow rule directly to check its interaction with reveal classes.
  const portraitMedia = [...page.document.styleSheets[0].cssRules].find((rule) => rule.conditionText === '(max-width: 43.75rem)');
  const portraitArrow = [...portraitMedia.cssRules].find((rule) => rule.selectorText === '#rarrow2');
  const portraitStyle = page.document.createElement('style');
  portraitStyle.textContent = portraitArrow.cssText;
  page.document.head.append(portraitStyle);

  for (const [id, transform] of [['larrow', 'scaleX(-1)'], ['rarrow2', 'rotate(90deg)']]) {
    const image = page.document.getElementById(id);
    assert.equal(page.window.getComputedStyle(image).transform, transform);
    page.reveal(image);
    assert.equal(page.window.getComputedStyle(image).transform, transform);
  }
  const familyPicture = page.document.getElementById('fas');
  assert.doesNotMatch(page.window.getComputedStyle(familyPicture).transform, /translate/);
  page.reveal(familyPicture);
  assert.doesNotMatch(page.window.getComputedStyle(familyPicture).transform, /translate/);
});

test('About content remains visible when scroll observers are unavailable or reduced motion is enabled', (t) => {
  for (const options of [{ supported: false }, { reducedMotion: true }]) {
    const page = aboutPage(t, options);
    assert.equal(page.document.querySelector('main').classList.contains('reveal-ready'), false);
    assert.equal(page.observed.size, 0);
    for (const image of page.document.querySelectorAll('main img')) {
      assert.notEqual(page.window.getComputedStyle(image).opacity, '0');
    }
  }
});

test('enabling reduced motion during a visit reveals all remaining text and images', (t) => {
  const page = aboutPage(t);
  assert.ok(page.observed.size > 0);
  page.reduce();
  assert.equal(page.observed.size, 0);
  assert.equal(page.document.querySelector('main').classList.contains('reveal-ready'), false);
  for (const image of page.document.querySelectorAll('main img')) {
    assert.notEqual(page.window.getComputedStyle(image).opacity, '0');
  }
});

test('legacy motion preference listeners also reveal remaining About content', (t) => {
  const page = aboutPage(t, { legacyMedia: true });
  assert.ok(page.observed.size > 0);
  page.reduce();
  assert.equal(page.observed.size, 0);
  assert.equal(page.document.querySelector('main').classList.contains('reveal-ready'), false);
});

test('ambient animation pauses when its tab is hidden and resumes when visible', (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  let hidden = false;
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden });
  dom.window.eval(fs.readFileSync(path.join(root, 'assets', 'js', 'ambient.js'), 'utf8'));
  hidden = true;
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.ok(dom.window.document.documentElement.classList.contains('animations-paused'));
  hidden = false;
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.equal(dom.window.document.documentElement.classList.contains('animations-paused'), false);
  dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.ok(dom.window.document.documentElement.classList.contains('animations-paused'));
  dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(dom.window.document.documentElement.classList.contains('animations-paused'), false);
});
