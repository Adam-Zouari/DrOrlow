'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../../public/join me.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../../public/assets/js/join.js'), 'utf8');

function setup(t, fetch, prepareWindow = () => {}) {
    const dom = new JSDOM(html, {
        url: 'http://localhost:3000/join%20me.html', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    dom.window.fetch = fetch;
    prepareWindow(dom.window);
    dom.window.eval(script);
    const { document } = dom.window;
    const form = document.getElementById('join-form');
    const values = {
        name: 'Ada', surname: 'Lovelace', email: 'ada@example.com',
        join_reason: 'I would like to make a friend.'
    };
    Object.entries(values).forEach(([name, value]) => { form.elements.namedItem(name).value = value; });
    return {
        window: dom.window, document, form,
        submit: () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
        input: (name, value) => {
            const field = form.elements.namedItem(name);
            field.value = value;
            field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const failure = (status, result) => ({ ok: false, status, json: async () => result });

test('form asks for a submission without account identifiers or passwords', (t) => {
    const page = setup(t, async () => {});
    for (const field of ['id', 'psw', 'conf']) assert.equal(page.form.elements.namedItem(field), null);
    assert.equal(page.document.querySelector('input[type="password"]'), null);
    assert.doesNotMatch(page.document.body.textContent, /sign.?up|create your account/i);
    assert.equal(page.form.action, 'http://localhost:3000/submit');
    assert.equal(page.form.method, 'post');
});

test('form rejects whitespace-only required text before sending personal data', async (t) => {
    for (const name of ['name', 'surname', 'join_reason']) {
        await t.test(name, (t) => {
            let requests = 0;
            const page = setup(t, async () => { requests += 1; });
            page.input(name, '   ');
            page.submit();
            assert.equal(requests, 0);
            assert.equal(page.document.activeElement.name, name);
            assert.match(page.document.getElementById(`${name}-error`).textContent, /complete/i);
        });
    }
});

test('server errors focus the relevant field and preserve submitted entries for correction', async (t) => {
    let request;
    const page = setup(t, async (url, options) => {
        request = { url, options };
        return failure(422, { message: 'Please check your email.', errors: { email: 'Please enter a valid email address.' } });
    });
    page.form.elements.sports.checked = true;
    page.form.elements.science.checked = true;
    page.document.getElementById('t2').checked = true;
    page.submit();
    await flush();
    assert.equal(request.url, 'http://localhost:3000/submit');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Accept, 'application/json');
    assert.equal(request.options.body.get('sports'), 'yes');
    assert.equal(request.options.body.get('science'), 'yes');
    assert.equal(request.options.body.get('arts'), null);
    assert.equal(request.options.body.get('r1'), 'so-cute');
    for (const removed of ['id', 'psw', 'conf']) assert.equal(request.options.body.has(removed), false);
    assert.match(page.document.getElementById('email-error').textContent, /valid email/);
    assert.equal(page.form.elements.email.getAttribute('aria-invalid'), 'true');
    assert.equal(page.document.activeElement.id, 'email');
    assert.equal(page.form.elements.email.value, 'ada@example.com');
    assert.equal(page.document.getElementById('form-status').textContent, 'Please check your email.');
    assert.equal(page.document.getElementById('submit-button').disabled, false);
});

test('form blocks duplicate requests while pending and recovers from an outage', async (t) => {
    let requests = 0;
    let resolveRequest;
    const page = setup(t, () => {
        requests += 1;
        return new Promise((resolve) => { resolveRequest = resolve; });
    });
    page.submit();
    page.submit();
    assert.equal(requests, 1);
    assert.equal(page.document.getElementById('submit-button').disabled, true);
    assert.equal(page.document.getElementById('reset-button').disabled, true);
    assert.equal(page.form.getAttribute('aria-busy'), 'true');
    resolveRequest(failure(503, { message: 'The form is temporarily unavailable. Please try again later.' }));
    await flush();
    assert.match(page.document.getElementById('form-status').textContent, /temporarily unavailable/);
    assert.equal(page.document.activeElement.id, 'form-status');
    assert.equal(page.document.getElementById('submit-button').disabled, false);
    assert.equal(page.document.getElementById('reset-button').disabled, false);
    assert.equal(page.form.getAttribute('aria-busy'), 'false');
});

test('reset removes field errors, custom validity, and status text', (t) => {
    const page = setup(t, async () => { throw new Error('Should not submit'); });
    page.input('name', '  ');
    page.submit();
    assert.equal(page.form.elements.name.validity.customError, true);
    assert.ok(page.document.querySelector('[aria-invalid="true"]'));
    page.form.reset();
    assert.equal(page.form.elements.name.value, '');
    assert.equal(page.form.elements.name.validity.customError, false);
    assert.equal(page.document.querySelector('[aria-invalid="true"]'), null);
    assert.equal(page.document.getElementById('form-status').textContent, '');
    assert.equal(page.document.getElementById('name-error').textContent, '');
});

test('network errors retain entries, focus the explanation, and permit retry', async (t) => {
    let requests = 0;
    const page = setup(t, async () => {
        requests += 1;
        throw new TypeError('Network unavailable');
    });
    page.submit();
    await flush();
    assert.match(page.document.getElementById('form-status').textContent, /check your connection/i);
    assert.equal(page.form.elements.name.value, 'Ada');
    assert.equal(page.document.activeElement.id, 'form-status');
    assert.equal(page.document.getElementById('submit-button').disabled, false);
    page.submit();
    await flush();
    assert.equal(requests, 2);
});

test('confirmed form success clears personal details and announces success in place', async (t) => {
    const page = setup(t, async () => ({
        ok: true, status: 201,
        json: async () => ({ message: 'Your form has been sent to Dr Orlow. Thank you, friend!', redirect: '/Home.html?submitted=1' })
    }));
    page.form.elements.sports.checked = true;
    page.submit();
    await flush();
    assert.equal(page.form.elements.name.value, '');
    assert.equal(page.form.elements.email.value, '');
    assert.equal(page.form.elements.sports.checked, false);
    assert.match(page.document.getElementById('form-status').textContent, /form has been sent/);
    assert.equal(page.document.activeElement.id, 'form-status');
    assert.equal(page.document.getElementById('submit-button').disabled, false);
});

test('a successful submission preserves a new draft edited while the request was pending', async (t) => {
    let finish;
    let submitted;
    const page = setup(t, (url, options) => {
        submitted = options.body;
        return new Promise((resolve) => { finish = resolve; });
    });
    page.submit();
    page.form.elements.email.focus();
    page.input('email', 'new-draft@example.com');
    finish({ ok: true, json: async () => ({ message: 'Your form has been sent.' }) });
    await flush();
    assert.equal(submitted.get('email'), 'ada@example.com');
    assert.equal(page.form.elements.email.value, 'new-draft@example.com');
    assert.equal(page.form.elements.name.value, 'Ada');
    assert.equal(page.document.activeElement.name, 'email', 'a completed request must not interrupt typing a new draft');
    assert.match(page.document.getElementById('form-status').textContent, /form has been sent/);
    assert.equal(page.document.getElementById('submit-button').disabled, false);
});

test('late validation errors apply only to field values that were actually submitted', async (t) => {
    let finish;
    const page = setup(t, () => new Promise((resolve) => { finish = resolve; }));
    page.submit();
    page.input('email', 'corrected@example.com');
    finish(failure(422, { message: 'Please check your form details.', errors: { email: 'Old email error.', name: 'Please check your name.' } }));
    await flush();
    assert.equal(page.document.getElementById('email-error').textContent, '');
    assert.equal(page.form.elements.email.hasAttribute('aria-invalid'), false);
    assert.equal(page.document.getElementById('name-error').textContent, 'Please check your name.');
    assert.equal(page.document.activeElement.name, 'name');
});

test('malformed successful JSON does not erase personal details', async (t) => {
    for (const result of [null, [], 'unexpected']) {
        await t.test(JSON.stringify(result), async (t) => {
            const page = setup(t, async () => ({ ok: true, json: async () => result }));
            page.submit();
            await flush();
            assert.equal(page.form.elements.name.value, 'Ada');
            assert.equal(page.form.elements.email.value, 'ada@example.com');
            assert.match(page.document.getElementById('form-status').textContent, /could not confirm/);
            assert.equal(page.document.getElementById('submit-button').disabled, false);
        });
    }
});

test('timeout without AbortController restores controls and ignores a stale success during retry', async (t) => {
    const requests = [];
    const timers = new Map();
    let nextTimer = 0;
    const page = setup(t, (url, options) => new Promise((resolve) => requests.push({ options, resolve })), (window) => {
        window.AbortController = undefined;
        window.setTimeout = (callback) => { timers.set(++nextTimer, callback); return nextTimer; };
        window.clearTimeout = (id) => timers.delete(id);
    });
    page.submit();
    assert.equal(requests[0].options.signal, undefined);
    assert.equal(timers.size, 1);
    const timeout = [...timers.values()][0];
    timeout();
    assert.equal(timers.size, 0);
    assert.equal(page.document.getElementById('submit-button').disabled, false);
    assert.match(page.document.getElementById('form-status').textContent, /could not confirm/);

    page.input('email', 'retry@example.com');
    page.submit();
    requests[0].resolve({ ok: true, json: async () => ({ message: 'Old success.' }) });
    await flush();
    assert.equal(page.form.elements.email.value, 'retry@example.com');
    assert.equal(page.document.getElementById('submit-button').disabled, true);
    assert.doesNotMatch(page.document.getElementById('form-status').textContent, /Old success/);
    requests[1].resolve(failure(503, { message: 'Please try later.' }));
    await flush();
    assert.equal(page.document.getElementById('submit-button').disabled, false);
    assert.equal(timers.size, 0);
});

test('leaving a pending form aborts its request and cannot overwrite a restored page', async (t) => {
    const requests = [];
    const page = setup(t, (url, options) => new Promise((resolve) => requests.push({ options, resolve })));
    page.submit();
    page.window.dispatchEvent(new page.window.PageTransitionEvent('pagehide', { persisted: true }));
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(page.document.getElementById('submit-button').disabled, false);
    assert.equal(page.document.getElementById('reset-button').disabled, false);
    page.window.dispatchEvent(new page.window.PageTransitionEvent('pageshow', { persisted: true }));
    page.input('email', 'restored@example.com');
    page.submit();
    requests[0].resolve({ ok: true, json: async () => ({ message: 'Old success.' }) });
    await flush();
    assert.equal(page.form.elements.email.value, 'restored@example.com');
    assert.equal(page.document.getElementById('submit-button').disabled, true);
    requests[1].resolve(failure(503, { message: 'Please try later.' }));
    await flush();
    assert.equal(page.document.getElementById('submit-button').disabled, false);
});

test('birthday maximum updates when an open form crosses midnight or is restored', async (t) => {
    let now = '2026-10-22T23:59:00Z';
    let requests = 0;
    const page = setup(t, async () => {
        requests += 1;
        return failure(503, { message: 'Please try later.' });
    }, (window) => {
        const OriginalDate = window.Date;
        window.Date = class extends OriginalDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
        };
    });
    assert.equal(page.form.elements.birthday.max, '2026-10-22');
    now = '2026-10-23T00:01:00Z';
    page.form.elements.birthday.focus();
    assert.equal(page.form.elements.birthday.max, '2026-10-23', 'opening the date picker should refresh its bound');
    page.input('birthday', '2026-10-23');
    page.submit();
    await flush();
    assert.equal(requests, 1);
    assert.equal(page.form.elements.birthday.max, '2026-10-23');
    now = '2026-10-24T00:01:00Z';
    page.window.dispatchEvent(new page.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(page.form.elements.birthday.max, '2026-10-24');
});

test('missing fetch keeps native form validation and submission available', (t) => {
    const page = setup(t, undefined);
    assert.equal(page.form.noValidate, false);
    assert.equal(page.form.method, 'post');
    assert.equal(page.form.action, 'http://localhost:3000/submit');
    page.form.elements.name.value = '';
    assert.equal(page.form.checkValidity(), false);
});

test('client constraints match server email and birthday bounds', async (t) => {
    for (const [name, value] of [
        ['email', 'ada@localhost'], ['pemail', 'work@localhost'],
        ['birthday', '1899-12-31'], ['birthday', '2999-01-01']
    ]) {
        await t.test(`${name}: ${value}`, (t) => {
            let requests = 0;
            const page = setup(t, async () => { requests += 1; });
            page.input(name, value);
            page.submit();
            assert.equal(requests, 0);
            assert.equal(page.document.activeElement.name, name);
            assert.ok(page.document.getElementById(`${name}-error`).textContent);
        });
    }
});
