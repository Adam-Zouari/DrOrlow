'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function loadPage(htmlName, scriptName, reducedMotion = false, { supportsMotion = true, legacyMedia = false, mediaSupported = true } = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(publicDirectory, htmlName), 'utf8'), {
        url: `https://dr-orlow.test/${encodeURIComponent(htmlName)}`,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    const preferenceListeners = new Set();
    const motionPreference = {
        media: '(prefers-reduced-motion: reduce)',
        matches: reducedMotion,
    };
    if (legacyMedia) motionPreference.addListener = (listener) => preferenceListeners.add(listener);
    else motionPreference.addEventListener = (eventName, listener) => {
        assert.equal(eventName, 'change');
        preferenceListeners.add(listener);
    };
    window.matchMedia = mediaSupported ? () => motionPreference : undefined;
    window.CSS = { supports: () => supportsMotion };

    // Load local CSS without making network requests or executing HTML scripts.
    for (const link of window.document.querySelectorAll('link[rel="stylesheet"]')) {
        const style = window.document.createElement('style');
        const stylesheetPath = decodeURIComponent(new URL(link.href).pathname).replace(/^\/+/, '');
        style.textContent = fs.readFileSync(path.join(publicDirectory, stylesheetPath), 'utf8');
        window.document.head.append(style);
    }
    window.eval(fs.readFileSync(path.join(publicDirectory, 'assets', 'js', scriptName), 'utf8'));

    return {
        dom,
        window,
        document: window.document,
        changeMotionPreference(matches) {
            motionPreference.matches = matches;
            for (const listener of preferenceListeners) listener({ matches });
        },
    };
}

function visibleScene(document, attribute) {
    const scenes = Array.from(document.querySelectorAll(`[${attribute}]`));
    const visible = scenes.filter((scene) => !scene.hidden);
    assert.equal(visible.length, 1, 'exactly one scene should be visible');
    return visible[0];
}

const conversationBranches = [
    {
        name: 'a happy conversation',
        controls: ['button1', 'button3'],
        scenes: ['page2', 'page3'],
    },
    {
        name: 'encouragement after saying I am not fine',
        controls: ['button2', 'next'],
        scenes: ['sadtext1', 'sadtext2'],
    },
    {
        name: 'encouragement after saying I am not happy',
        controls: ['button1', 'button4', 'next'],
        scenes: ['page2', 'sadtext1', 'sadtext2'],
    },
];

for (const branch of conversationBranches) {
    test(`talk completes ${branch.name} and restarts with focus`, (t) => {
        const { dom, document } = loadPage('let_s talk.html', 'talk.js');
        t.after(() => dom.window.close());
        assert.equal(visibleScene(document, 'data-talk-scene').id, 'page1');
        assert.equal(document.querySelector('#restart').hidden, true);

        for (const [index, id] of branch.controls.entries()) {
            const button = document.getElementById(id);
            assert.equal(button.closest('[hidden]'), null, 'the next action should be immediately available');
            button.click();
            const scene = visibleScene(document, 'data-talk-scene');
            assert.equal(scene.id, branch.scenes[index]);
            assert.equal(document.activeElement, scene, 'focus should follow the conversation');
            assert.ok(scene.textContent.trim().length > 0);
            assert.equal(document.querySelector('#restart').hidden, index !== branch.controls.length - 1);
        }

        document.querySelector('#restart').click();
        assert.equal(visibleScene(document, 'data-talk-scene').id, 'page1');
        assert.equal(document.activeElement.id, 'page1');
        assert.equal(document.querySelector('#restart').hidden, true);
        document.querySelector('#button2').click();
        assert.equal(visibleScene(document, 'data-talk-scene').id, 'sadtext1');
        assert.equal(document.querySelector('#next').closest('[hidden]'), null);
    });
}

test('policy story has no waiting steps, keeps navigation visible, and ends with the home link', (t) => {
    const { dom, document, window } = loadPage('policy.html', 'policy.js');
    t.after(() => dom.window.close());

    function navigationIsAvailable() {
        for (const element of [document.querySelector('header'), document.querySelector('footer')]) {
            assert.equal(element.hidden, false);
            assert.notEqual(window.getComputedStyle(element).display, 'none');
        }
        assert.ok(document.querySelector('footer a[href="Home.html"]'));
    }

    assert.equal(document.body.classList.contains('viewport-page'), true);
    assert.equal(visibleScene(document, 'data-policy-scene').id, 'warning1');
    const steps = [
        ['#button1', 'warning2', 'button2'],
        ['#button2', 'warning3', 'button3'],
        ['#button3', 'angry-scene', 'angry-scene'],
        ['#button4', 'happy-scene', 'happy-scene'],
    ];

    navigationIsAvailable();
    for (const [control, sceneId, focusedId] of steps) {
        const button = document.querySelector(control);
        assert.equal(button.closest('[hidden]'), null);
        button.click();
        assert.equal(visibleScene(document, 'data-policy-scene').id, sceneId);
        assert.equal(document.activeElement.id, focusedId);
        navigationIsAvailable();
    }
    const ending = document.querySelector('#happy-scene');
    assert.equal(ending.querySelector('button'), null, 'the requested ending has no Play again button');
    assert.equal(ending.querySelectorAll('a').length, 1);
    assert.equal(document.querySelector('#button5').getAttribute('href'), 'Home.html');
    assert.equal(document.querySelector('#button5').closest('[hidden]'), null);
});

function pressKey(window, target, key = 'p', options = {}) {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
}

test('game keeps its visible surface minimal and supports scoped keyboard pause with three winning links', (t) => {
    const { dom, document, window } = loadPage('let_s play.html', 'play.js');
    t.after(() => dom.window.close());
    const field = document.querySelector('#game-field');
    const status = document.querySelector('#game-status');

    assert.equal(document.body.classList.contains('viewport-page'), true);
    assert.equal(document.querySelector('#motion-toggle'), null, 'remove the visible pause control');
    assert.equal(document.querySelector('.game-instructions'), null, 'remove visible instructions');
    assert.equal(status.classList.contains('sr-only'), true);
    assert.equal(document.querySelector('#game-instructions').classList.contains('sr-only'), true);
    assert.equal(field.getAttribute('aria-keyshortcuts'), 'P');
    assert.equal(field.tabIndex, 0);
    assert.equal(field.classList.contains('is-animated'), true);

    // The single-letter shortcut only acts inside the focused game component.
    pressKey(window, document, 'p');
    assert.equal(field.classList.contains('is-paused'), false);
    field.focus();
    assert.equal(pressKey(window, field).defaultPrevented, true);
    assert.equal(field.classList.contains('is-paused'), true);
    assert.match(status.textContent, /paused/i);

    const targets = Array.from(field.querySelectorAll('.catch-target'));
    assert.equal(field.querySelectorAll('img').length, 30, 'retain a sea of independently floating octopuses');
    assert.equal(field.querySelector('.game-row'), null, 'the sprites no longer move in rigid rows');
    assert.equal(targets.length, 3, 'retain the three winning octopuses');
    for (const target of targets) {
        assert.equal(target.tagName, 'A');
        assert.ok(target.tabIndex >= 0, 'a catch target should be in the native keyboard sequence');
        assert.ok(target.getAttribute('aria-label'));
        assert.equal(new URL(target.href).pathname, '/Congrats.html');
        assert.ok(fs.existsSync(path.join(publicDirectory, 'Congrats.html')));
        target.focus();
        assert.equal(document.activeElement, target);
        assert.equal(target.closest('[hidden]'), null);
    }

    pressKey(window, targets[0], 'P');
    assert.equal(field.classList.contains('is-paused'), false);
    for (const options of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
        assert.equal(pressKey(window, field, 'p', options).defaultPrevented, false);
        assert.equal(field.classList.contains('is-paused'), false);
    }
    const input = document.createElement('input');
    field.append(input);
    pressKey(window, input, 'p');
    assert.equal(field.classList.contains('is-paused'), false, 'typing should not trigger a shortcut');
});

test('game respects reduced motion at startup and when the preference changes', (t) => {
    const { dom, document, window, changeMotionPreference } = loadPage('let_s play.html', 'play.js', true);
    t.after(() => dom.window.close());
    const field = document.querySelector('#game-field');

    assert.equal(field.classList.contains('is-animated'), false);
    assert.match(document.querySelector('#game-status').textContent, /stay still/i);
    pressKey(window, field);
    assert.equal(field.classList.contains('is-animated'), false);
    assert.equal(field.classList.contains('is-paused'), false);
    for (const target of field.querySelectorAll('.catch-target')) {
        target.focus();
        assert.equal(document.activeElement, target);
    }

    changeMotionPreference(false);
    assert.equal(field.classList.contains('is-animated'), true);
    pressKey(window, field);
    assert.equal(field.classList.contains('is-paused'), true);

    changeMotionPreference(true);
    assert.equal(field.classList.contains('is-animated'), false);
    changeMotionPreference(false);
    assert.equal(field.classList.contains('is-paused'), true, 'keep the user\'s pause choice');
});

test('game pauses hidden tabs and preserves the player pause choice after returning', (t) => {
    const { dom, document, window } = loadPage('let_s play.html', 'play.js');
    t.after(() => dom.window.close());
    const field = document.querySelector('#game-field');
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    hidden = true;
    document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(field.classList.contains('is-paused'), true);
    hidden = false;
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(field.classList.contains('is-paused'), false);
    pressKey(window, field);
    hidden = true;
    document.dispatchEvent(new window.Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(field.classList.contains('is-paused'), true, 'visibility changes must not resume a user-paused game');
});

test('game keeps static native catch links without required animation APIs', (t) => {
    for (const options of [{ supportsMotion: false }, { mediaSupported: false }]) {
        const { dom, document, window } = loadPage('let_s play.html', 'play.js', false, options);
        t.after(() => dom.window.close());
        const field = document.querySelector('#game-field');
        assert.equal(field.classList.contains('is-animated'), false);
        assert.equal(field.querySelectorAll('a[href="Congrats.html"]').length, 3);
        assert.equal(pressKey(window, field).defaultPrevented, false);
        assert.equal(field.classList.contains('is-animated'), false);
    }
});

test('game responds to legacy reduced motion preference listeners', (t) => {
    const { dom, document, changeMotionPreference } = loadPage('let_s play.html', 'play.js', false, { legacyMedia: true });
    t.after(() => dom.window.close());
    const field = document.querySelector('#game-field');
    assert.equal(field.classList.contains('is-animated'), true);
    changeMotionPreference(true);
    assert.equal(field.classList.contains('is-animated'), false);
    changeMotionPreference(false);
    assert.equal(field.classList.contains('is-animated'), true);
});

test('policy and game styles use scalable units without fixed pixel dimensions', () => {
    for (const fileName of ['policy.css', 'let_s play.css']) {
        const css = fs.readFileSync(path.join(publicDirectory, 'assets', 'css', fileName), 'utf8');
        assert.doesNotMatch(css, /\b\d+(?:\.\d+)?px\b/i);
    }
});
