'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDirectory = path.join(__dirname, '..', '..', 'public');
const settle = async () => { for (let count = 0; count < 8; count += 1) await new Promise(setImmediate); };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function loadRoom(t, handler) {
    const dom = new JSDOM(fs.readFileSync(path.join(publicDirectory, 'Super Orlow.html'), 'utf8'), {
        url: 'https://dr-orlow.test/super-orlow', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    const calls = [];
    const scrollCalls = [];
    window.scrollTo = (left, top) => {
        window.scrollX = left;
        window.scrollY = top;
        scrollCalls.push({ left, top });
    };
    window.fetch = async (url, options) => {
        calls.push({ url, options });
        return handler(url, options);
    };
    const timers = new Map();
    let timerId = 0;
    window.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
    window.clearTimeout = (id) => timers.delete(id);
    let clock = 100;
    Object.defineProperty(window.performance, 'now', { value: () => clock });
    window.eval(fs.readFileSync(path.join(publicDirectory, 'assets', 'js', 'super-orlow.js'), 'utf8'));
    t.after(() => window.close());
    return {
        window, document: window.document, calls, timers, scrollCalls,
        tick(milliseconds) { clock += milliseconds; },
        runTimer() {
            const [id, callback] = timers.entries().next().value || [];
            assert.ok(callback, 'a pending timer should exist');
            timers.delete(id);
            callback();
        },
        click(id) { window.document.getElementById(id).click(); }
    };
}

test('secret room requires authentication and renders submitted content as text', async (t) => {
    let loggedIn = false;
    const malicious = '<img src=x onerror=alert(1)>';
    const room = loadRoom(t, (url, options) => {
        if (url.endsWith('/session')) return reply({ authenticated: false });
        if (url.endsWith('/login')) {
            assert.equal(options.headers['Content-Type'], 'application/json');
            if (JSON.parse(options.body).password !== 'secret') return reply({ message: 'Wrong phrase.' }, 401);
            loggedIn = true;
            return reply({ authenticated: true, csrfToken: 'csrf-example' }, 201);
        }
        if (url.startsWith('/api/super/forms')) {
            assert.equal(loggedIn, true);
            return reply({ forms: [{ id: 1, name: malicious, surname: 'Friend', details: malicious, joinReason: 'Hello!', email: 'friend@example.test', createdAt: '2026-10-22T10:00:00Z' }], total: 1, page: 1, pageSize: 20 });
        }
        throw new Error(`Unexpected URL ${url}`);
    });
    await settle();
    const { document, window } = room;
    assert.equal(document.getElementById('super-login').hidden, false);
    assert.equal(document.body.classList.contains('is-unlocked'), false);
    assert.equal(document.getElementById('super-room').hidden, true);
    assert.equal(document.querySelectorAll('.memory-card').length, 0);
    const form = document.getElementById('super-login-form');
    document.getElementById('super-password').value = 'wrong';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(document.getElementById('super-status').textContent, 'Wrong phrase.');
    assert.equal(document.getElementById('super-password').value, '');
    document.getElementById('super-password').value = 'secret';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(document.getElementById('super-room').hidden, false);
    assert.equal(document.body.classList.contains('is-unlocked'), true);
    assert.equal(document.getElementById('super-password').value, '');
    assert.ok(document.getElementById('letter-title').textContent.includes(malicious));
    assert.ok(document.getElementById('letter-fields').textContent.includes(malicious));
    assert.equal(document.querySelector('#letter-detail img'), null);
    assert.equal(document.querySelector('#letters-list img'), null);
    for (const { options } of room.calls) {
        assert.equal(options.cache, 'no-store');
        assert.equal(options.credentials, 'same-origin');
    }
});

test('refresh keeps visible letters, the selected friend and current scroll position without reloading', async (t) => {
    let requests = 0;
    let finishRefresh;
    const firstForms = [
        { id: '2', name: 'New friend', details: 'First letter' },
        { id: '1', name: 'Selected friend', details: 'The letter being read' }
    ];
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) return reply({ authenticated: true, csrfToken: 'token' });
        assert.ok(url.startsWith('/api/super/forms?page=1&'), 'refresh stays on the current inbox page');
        requests += 1;
        if (requests === 1) return reply({ forms: firstForms, total: 2, page: 1, pageSize: 20 });
        if (requests === 2) return new Promise((resolve) => { finishRefresh = resolve; });
        if (requests === 3) return reply({ message: 'Connection lost.' }, 503);
        return reply({ forms: [], total: 0, page: 1, pageSize: 20 });
    });
    await settle();
    const { document, window } = room;
    document.querySelectorAll('.letter-button')[1].click();
    const firstItem = document.getElementById('letters-list').firstElementChild;
    const initialUrl = window.location.href;
    window.scrollY = 640;
    room.click('refresh-letters');
    await settle();
    assert.equal(document.getElementById('letters-list').firstElementChild, firstItem, 'loading does not collapse the list');
    assert.equal(document.getElementById('letter-detail').hidden, false);
    assert.equal(document.getElementById('letter-title').textContent, 'Selected friend');
    assert.match(document.getElementById('letter-fields').textContent, /The letter being read/);
    assert.equal(document.getElementById('letters-panel').getAttribute('aria-busy'), 'true');

    // A person can keep scrolling while the request is in progress.
    window.scrollY = 736;
    finishRefresh(reply({
        forms: [{ id: '3', name: 'Newest friend' }, firstForms[0], { ...firstForms[1], details: 'Updated selected letter' }],
        total: 3, page: 1, pageSize: 20
    }));
    await settle();
    assert.equal(document.getElementById('letter-title').textContent, 'Selected friend');
    assert.match(document.getElementById('letter-fields').textContent, /Updated selected letter/);
    assert.equal(document.querySelectorAll('.letter-button')[2].getAttribute('aria-pressed'), 'true');
    assert.equal(window.scrollY, 736);
    assert.deepEqual(room.scrollCalls.at(-1), { left: 0, top: 736 });
    assert.equal(window.location.href, initialUrl);
    assert.equal(document.getElementById('letters-panel').hasAttribute('aria-busy'), false);

    room.click('refresh-letters');
    await settle();
    assert.match(document.getElementById('letters-status').textContent, /Connection lost/);
    assert.equal(document.getElementById('letter-title').textContent, 'Selected friend');
    assert.equal(document.getElementById('letters-list').children.length, 3);
    assert.equal(window.scrollY, 736);
    assert.equal(document.getElementById('refresh-letters').disabled, false);

    room.click('refresh-letters');
    await settle();
    assert.equal(document.getElementById('letters-list').children.length, 0);
    assert.equal(document.getElementById('letter-fields').children.length, 0);
    assert.equal(document.getElementById('letter-detail').hidden, true);
});

test('letters paginate, handle expired sessions, and never restore a late response after logout', async (t) => {
    let formsMode = 'pages';
    let resolveLate;
    const room = loadRoom(t, (url, options) => {
        if (url.endsWith('/session')) return reply({ authenticated: true, csrfToken: 'csrf-example' });
        if (url.endsWith('/logout')) {
            assert.equal(options.headers['X-CSRF-Token'], 'csrf-example');
            return reply({ authenticated: false });
        }
        if (formsMode === 'late') return new Promise((resolve) => { resolveLate = resolve; });
        if (formsMode === 'expired') return reply({ message: 'Please log in.' }, 401);
        const page = new URL(url, 'https://dr-orlow.test').searchParams.get('page');
        return reply({ forms: [{ id: page, name: page === '1' ? 'New friend' : 'Older friend', details: 'Private letter' }], total: 21, page: Number(page), pageSize: 20 });
    });
    await settle();
    assert.equal(room.document.getElementById('previous-page').disabled, true);
    room.click('next-page');
    await settle();
    assert.equal(room.document.getElementById('letter-title').textContent, 'Older friend');
    assert.equal(room.document.getElementById('next-page').disabled, true);
    formsMode = 'late';
    room.click('refresh-letters');
    await settle();
    room.click('logout-button');
    await settle();
    resolveLate(reply({ forms: [{ name: 'Must stay private' }], total: 1, page: 1, pageSize: 20 }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, true);
    assert.equal(room.document.body.classList.contains('is-unlocked'), false);
    assert.equal(room.document.getElementById('letters-list').children.length, 0);
    assert.equal(room.document.getElementById('letter-fields').children.length, 0);
    assert.equal(room.document.body.textContent.includes('Must stay private'), false);

    // A separate restored session must close immediately when its API session expires.
    formsMode = 'expired';
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, true);
    assert.equal(room.document.getElementById('super-login').hidden, false);
});

test('an older session check cannot close a freshly unlocked room', async (t) => {
    let finishSessionCheck;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) return new Promise((resolve) => { finishSessionCheck = resolve; });
        if (url.endsWith('/login')) return reply({ authenticated: true, csrfToken: 'token' });
        return reply({ forms: [], total: 0, page: 1, pageSize: 20 });
    });
    room.document.getElementById('super-password').value = 'secret';
    room.document.getElementById('super-login-form').dispatchEvent(new room.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, false);
    finishSessionCheck(reply({ authenticated: false }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, false);
});

test('restoring the page during login cannot overwrite the pending authentication', async (t) => {
    let finishLogin;
    let sessionChecks = 0;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) {
            sessionChecks += 1;
            return reply({ authenticated: false });
        }
        if (url.endsWith('/login')) return new Promise((resolve) => { finishLogin = resolve; });
        return reply({ forms: [], total: 0, page: 1, pageSize: 20 });
    });
    await settle();
    room.document.getElementById('super-password').value = 'secret';
    room.document.getElementById('super-login-form').dispatchEvent(new room.window.Event('submit', { cancelable: true }));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    assert.equal(sessionChecks, 1);
    finishLogin(reply({ authenticated: true, csrfToken: 'token' }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, false);
    assert.equal(room.document.getElementById('unlock-button').disabled, false);
});

test('restoring the page during logout keeps letters cleared and preserves a failed logout retry', async (t) => {
    let finishLogout;
    let sessionChecks = 0;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) {
            sessionChecks += 1;
            return reply({ authenticated: true, csrfToken: 'token' });
        }
        if (url.endsWith('/logout')) return new Promise((resolve) => { finishLogout = resolve; });
        return reply({ forms: [{ id: '1', name: 'Private friend' }], total: 1, page: 1, pageSize: 20 });
    });
    await settle();
    room.click('logout-button');
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pagehide'));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    assert.equal(sessionChecks, 1);
    assert.equal(room.document.getElementById('super-room').hidden, true);
    finishLogout(reply({ message: 'Old logout failed.' }, 503));
    await settle();
    assert.equal(room.document.getElementById('retry-lock').hidden, false);
    assert.equal(room.document.getElementById('letter-fields').children.length, 0);
    assert.equal(room.document.getElementById('unlock-button').disabled, false);
});

test('a pending login is rechecked after leaving and restoring the page', async (t) => {
    let finishLogin;
    let authenticated = false;
    let checks = 0;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) {
            checks += 1;
            return reply(authenticated ? { authenticated: true, csrfToken: 'token' } : { authenticated: false });
        }
        if (url.endsWith('/login')) return new Promise((resolve) => { finishLogin = resolve; });
        return reply({ forms: [], total: 0, page: 1, pageSize: 20 });
    });
    await settle();
    room.document.getElementById('super-password').value = 'secret';
    room.document.getElementById('super-login-form').dispatchEvent(new room.window.Event('submit', { cancelable: true }));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pagehide'));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    authenticated = true;
    finishLogin(reply({ authenticated: true, csrfToken: 'token' }));
    await settle();
    assert.equal(checks, 2);
    assert.equal(room.document.getElementById('super-room').hidden, false);
    assert.equal(room.document.getElementById('unlock-button').disabled, false);
});

test('login timeout releases the controls and lets the owner try again', async (t) => {
    let shouldHang = true;
    const room = loadRoom(t, (url, options) => {
        if (url.endsWith('/session')) return reply({ authenticated: false });
        if (url.endsWith('/login') && shouldHang) return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        });
        if (url.endsWith('/login')) return reply({ authenticated: true, csrfToken: 'token' });
        return reply({ forms: [], total: 0, page: 1, pageSize: 20 });
    });
    await settle();
    const { document, window } = room;
    document.getElementById('super-password').value = 'secret';
    document.getElementById('super-login-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    room.runTimer();
    await settle();
    assert.match(document.getElementById('super-status').textContent, /took too long/);
    assert.equal(document.getElementById('unlock-button').disabled, false);
    assert.equal(room.timers.size, 0);
    shouldHang = false;
    document.getElementById('super-password').value = 'secret';
    document.getElementById('super-login-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('super-room').hidden, false);
});

test('leaving again cancels a queued login restoration before private content can return', async (t) => {
    let finishLogin;
    let checks = 0;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) {
            checks += 1;
            return reply({ authenticated: false });
        }
        if (url.endsWith('/login')) return new Promise((resolve) => { finishLogin = resolve; });
        throw new Error('A hidden page must not reload private letters.');
    });
    await settle();
    room.document.getElementById('super-password').value = 'secret';
    room.document.getElementById('super-login-form').dispatchEvent(new room.window.Event('submit', { cancelable: true }));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pagehide'));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pagehide'));
    finishLogin(reply({ authenticated: true, csrfToken: 'token' }));
    await settle();
    assert.equal(checks, 1);
    assert.equal(room.document.getElementById('super-room').hidden, true);
    assert.equal(room.document.getElementById('letters-list').children.length, 0);
});

test('refresh timeout retains the current letter and permits another refresh', async (t) => {
    let shouldHang = false;
    const room = loadRoom(t, (url, options) => {
        if (url.endsWith('/session')) return reply({ authenticated: true, csrfToken: 'token' });
        if (shouldHang) return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        });
        return reply({ forms: [{ id: '1', name: 'Saved friend' }], total: 1, page: 1, pageSize: 20 });
    });
    await settle();
    shouldHang = true;
    room.click('refresh-letters');
    room.runTimer();
    await settle();
    assert.equal(room.document.getElementById('letter-title').textContent, 'Saved friend');
    assert.match(room.document.getElementById('letters-status').textContent, /took too long/);
    assert.equal(room.document.getElementById('refresh-letters').disabled, false);
    assert.equal(room.document.getElementById('letters-panel').hasAttribute('aria-busy'), false);
    assert.equal(room.timers.size, 0);
});

test('malformed successful responses never erase previously loaded letters', async (t) => {
    let response = { forms: [{ id: '1', name: 'Saved friend' }], total: 1, page: 1, pageSize: 20 };
    const room = loadRoom(t, (url) => url.endsWith('/session')
        ? reply({ authenticated: true, csrfToken: 'token' }) : reply(response));
    await settle();
    for (const malformed of [null, [], {}, { forms: [null], total: 1, page: 1, pageSize: 20 }, { forms: [], total: 0, page: 1, pageSize: 0 }]) {
        response = malformed;
        room.click('refresh-letters');
        await settle();
        assert.equal(room.document.getElementById('letter-title').textContent, 'Saved friend');
        assert.equal(room.document.getElementById('letters-list').children.length, 1);
        assert.match(room.document.getElementById('letters-status').textContent, /could not be read/);
        assert.equal(room.document.getElementById('refresh-letters').disabled, false);
    }
});

test('an inbox that shrinks skips directly to the last available page', async (t) => {
    let empty = false;
    const requestedPages = [];
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) return reply({ authenticated: true, csrfToken: 'token' });
        const page = Number(new URL(url, 'https://dr-orlow.test').searchParams.get('page'));
        requestedPages.push(page);
        return reply({ forms: empty ? [] : [{ id: String(page), name: 'Friend' }], total: empty ? 0 : 81, page, pageSize: 20 });
    });
    await settle();
    for (let page = 2; page <= 4; page += 1) {
        room.click('next-page');
        await settle();
    }
    empty = true;
    requestedPages.length = 0;
    room.click('refresh-letters');
    await settle();
    assert.deepEqual(requestedPages, [4, 1]);
    assert.equal(room.document.getElementById('letters-list').children.length, 0);
    assert.equal(room.document.getElementById('letters-pagination').hidden, true);
    assert.equal(room.document.getElementById('refresh-letters').disabled, false);
});

test('memory game can be completed and restarted; leaving the playroom cancels timers', async (t) => {
    const room = loadRoom(t, (url) => url.endsWith('/session')
        ? reply({ authenticated: true, csrfToken: 'token' })
        : reply({ forms: [], total: 0, page: 1, pageSize: 20 }));
    await settle();
    room.click('games-tab');
    const { document } = room;
    const cards = [...document.querySelectorAll('.memory-card')];
    assert.equal(cards.length, 12);
    const pairs = new Map();
    for (const card of cards) {
        const image = card.querySelector('img');
        const source = image.getAttribute('src');
        const imageUrl = new URL(image.src);
        assert.equal(imageUrl.origin, room.window.location.origin);
        assert.ok(imageUrl.pathname.startsWith('/assets/images/'), 'generated game artwork uses the image asset directory');
        const relativeImagePath = decodeURIComponent(imageUrl.pathname).replace(/^\/+/, '');
        assert.ok(fs.statSync(path.join(publicDirectory, relativeImagePath)).isFile(), `generated game artwork exists: ${relativeImagePath}`);
        if (!pairs.has(source)) pairs.set(source, []);
        pairs.get(source).push(card);
    }
    assert.equal(pairs.size, 6, 'the game keeps its six distinct artwork pairs');
    for (const pair of pairs.values()) for (const card of pair) card.click();
    assert.equal(document.querySelectorAll('.is-matched').length, 12);
    assert.match(document.getElementById('memory-status').textContent, /6 turns/);
    room.click('memory-restart');
    assert.equal(document.querySelectorAll('.is-matched').length, 0);
    const fresh = [...document.querySelectorAll('.memory-card')];
    fresh[0].click();
    fresh.find((card) => card.querySelector('img').src !== fresh[0].querySelector('img').src).click();
    assert.equal(room.timers.size, 1);
    room.click('letters-tab');
    assert.equal(room.timers.size, 0);
    room.click('games-tab');
    assert.equal(document.querySelectorAll('.is-open').length, 0);
});

test('a failed logout keeps private content cleared and offers a working retry', async (t) => {
    let logoutAttempts = 0;
    const room = loadRoom(t, (url) => {
        if (url.endsWith('/session')) return reply({ authenticated: true, csrfToken: 'token' });
        if (url.endsWith('/logout')) {
            logoutAttempts += 1;
            return logoutAttempts === 1 ? Promise.reject(new Error('Connection lost')) : reply({ authenticated: false });
        }
        return reply({ forms: [{ name: 'Private friend' }], total: 1, page: 1, pageSize: 20 });
    });
    await settle();
    room.click('logout-button');
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, true);
    assert.equal(room.document.getElementById('letter-fields').children.length, 0);
    assert.equal(room.document.getElementById('retry-lock').hidden, false);
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pagehide'));
    room.window.dispatchEvent(new room.window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    assert.equal(room.document.getElementById('super-room').hidden, true);
    assert.equal(room.document.getElementById('retry-lock').hidden, false);
    room.click('retry-lock');
    await settle();
    assert.equal(logoutAttempts, 2);
    assert.equal(room.document.getElementById('retry-lock').hidden, true);
    assert.match(room.document.getElementById('super-status').textContent, /secret door is closed/);
});

test('reaction game rejects early clicks, scores five catches, and resets on visibility changes', async (t) => {
    const room = loadRoom(t, (url) => url.endsWith('/session')
        ? reply({ authenticated: true, csrfToken: 'token' })
        : reply({ forms: [], total: 0, page: 1, pageSize: 20 }));
    await settle();
    room.click('games-tab');
    room.click('choose-reaction');
    room.click('reaction-target');
    room.click('reaction-target');
    assert.match(room.document.getElementById('reaction-status').textContent, /too eager/);
    assert.equal(room.timers.size, 0);
    for (let round = 0; round < 5; round += 1) {
        room.click('reaction-target');
        room.runTimer();
        room.tick(200 + round * 10);
        room.click('reaction-target');
    }
    assert.equal(room.document.getElementById('reaction-results').children.length, 5);
    assert.match(room.document.getElementById('reaction-status').textContent, /Average: 220 ms. Fastest: 200 ms/);
    room.click('reaction-target');
    assert.equal(room.document.getElementById('reaction-results').children.length, 0);
    assert.equal(room.timers.size, 1);
    Object.defineProperty(room.document, 'hidden', { value: true, configurable: true });
    room.document.dispatchEvent(new room.window.Event('visibilitychange'));
    assert.equal(room.timers.size, 0);
    assert.equal(room.document.getElementById('reaction-label').textContent, 'Start');
});
