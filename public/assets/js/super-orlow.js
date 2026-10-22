'use strict';

(() => {
    const byId = (id) => document.getElementById(id);
    const login = byId('super-login');
    const room = byId('super-room');
    const status = byId('super-status');
    const password = byId('super-password');
    const loginButton = byId('unlock-button');
    const retryLock = byId('retry-lock');
    const lettersList = byId('letters-list');
    const lettersStatus = byId('letters-status');
    const detail = byId('letter-detail');
    const fields = byId('letter-fields');
    let csrfToken = '';
    let authenticated = false;
    let authPending = false;
    let restoreAfterAuth = false;
    let sessionVersion = 0;
    let formsRequest = null;
    let currentPage = 1;
    let forms = [];
    let selectedLetterId = null;
    let activeTab = 'letters';
    let activeGame = 'memory';
    let memoryTimer = null;
    let reactionTimer = null;
    let memoryCards = [];
    let flipped = [];
    let moves = 0;
    let pairs = 0;
    let reactionPhase = 'idle';
    let reactionStart = 0;
    let reactionScores = [];

    async function request(url, options = {}) {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        options.signal?.addEventListener('abort', cancel, { once: true });
        if (options.signal?.aborted) cancel();
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; cancel(); }, 15000);
        try {
            const response = await fetch(url, {
                credentials: 'same-origin', cache: 'no-store', ...options,
                signal: controller.signal, headers: { Accept: 'application/json', ...options.headers }
            });
            const body = await response.json().catch(() => null);
            if (controller.signal.aborted) throw new Error('The request was cancelled.');
            if (!response.ok) {
                const error = new Error(typeof body?.message === 'string' ? body.message : 'The sea is a little rough. Please try again.');
                error.status = response.status;
                throw error;
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('The response could not be read. Please try again.');
            return body;
        } catch (error) {
            if (timedOut) throw new Error('The request took too long. Please try again.');
            throw error;
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', cancel);
        }
    }

    function stopGames() {
        clearTimeout(memoryTimer);
        clearTimeout(reactionTimer);
        memoryTimer = null;
        reactionTimer = null;
    }

    function clearLetters() {
        formsRequest?.abort();
        formsRequest = null;
        forms = [];
        lettersList.replaceChildren();
        showLetter(-1);
        byId('letters-pagination').hidden = true;
        byId('refresh-letters').disabled = false;
        byId('letters-panel').removeAttribute('aria-busy');
        lettersStatus.textContent = '';
    }

    function closeRoom(message = 'The secret room is just for Dr Orlow.') {
        sessionVersion += 1;
        authenticated = false;
        csrfToken = '';
        stopGames();
        clearLetters();
        byId('memory-board').replaceChildren();
        byId('reaction-results').replaceChildren();
        password.value = '';
        retryLock.hidden = true;
        room.hidden = true;
        document.body.classList.remove('is-unlocked');
        login.hidden = false;
        status.textContent = message;
    }

    function openRoom(token) {
        authenticated = true;
        csrfToken = token;
        password.value = '';
        retryLock.hidden = true;
        login.hidden = true;
        room.hidden = false;
        document.body.classList.add('is-unlocked');
        status.textContent = 'Welcome home, Dr Orlow ^-^';
        selectTab('letters');
        loadLetters(1);
    }

    async function checkSession() {
        if (authPending) { restoreAfterAuth = true; return; }
        if (!retryLock.hidden) return;
        const version = sessionVersion;
        try {
            const data = await request('/api/super/session');
            if (version !== sessionVersion) return;
            if (data.authenticated && data.csrfToken) openRoom(data.csrfToken);
            else closeRoom();
        } catch (error) {
            if (version === sessionVersion) closeRoom(error.message);
        }
    }

    byId('super-login-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!password.value || authPending) return;
        authPending = true;
        const version = ++sessionVersion;
        loginButton.disabled = true;
        status.textContent = 'Trying the secret phrase…';
        try {
            const data = await request('/api/super/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password.value })
            });
            if (version !== sessionVersion) return;
            if (!data.authenticated || !data.csrfToken) throw new Error('The door could not open. Please try again.');
            openRoom(data.csrfToken);
            byId('letters-tab').focus();
        } catch (error) {
            if (version !== sessionVersion) return;
            password.value = '';
            status.textContent = error.message;
            password.focus();
        } finally {
            authPending = false;
            loginButton.disabled = false;
            const shouldRestore = restoreAfterAuth && version !== sessionVersion;
            restoreAfterAuth = false;
            if (shouldRestore) checkSession();
        }
    });

    async function lockDoor() {
        if (authPending) return;
        authPending = true;
        const token = csrfToken;
        closeRoom('Closing the secret door…');
        loginButton.disabled = true;
        try {
            await request('/api/super/logout', { method: 'POST', headers: { 'X-CSRF-Token': token } });
            status.textContent = 'The secret door is closed. See you soon ^-^';
        } catch (error) {
            if (error.status === 401) status.textContent = 'The secret door is closed. See you soon ^-^';
            else {
                status.textContent = 'Letters have been cleared from this page. The door could not be locked; please retry.';
                // Retry the server logout without restoring private data or reopening the room.
                csrfToken = token;
                retryLock.hidden = false;
            }
        } finally {
            authPending = false;
            restoreAfterAuth = false;
            loginButton.disabled = false;
        }
    }
    byId('logout-button').addEventListener('click', lockDoor);
    retryLock.addEventListener('click', lockDoor);

    function selectTab(name, focus = false) {
        stopGames();
        activeTab = name;
        for (const tab of ['letters', 'games']) {
            const selected = tab === name;
            byId(`${tab}-tab`).setAttribute('aria-selected', String(selected));
            byId(`${tab}-tab`).tabIndex = selected ? 0 : -1;
            byId(`${tab}-panel`).hidden = !selected;
        }
        if (name === 'games' && authenticated) selectGame(activeGame);
        if (focus) byId(`${name}-tab`).focus();
    }

    for (const name of ['letters', 'games']) {
        byId(`${name}-tab`).addEventListener('click', () => { if (authenticated) selectTab(name); });
        byId(`${name}-tab`).addEventListener('keydown', (event) => {
            if (!authenticated || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            selectTab(event.key === 'Home' ? 'letters' : event.key === 'End' ? 'games' : name === 'letters' ? 'games' : 'letters', true);
        });
    }

    const formatDate = (value) => {
        if (!value) return 'Date unavailable';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    };
    const display = (value) => value === null || value === undefined || value === '' ? 'Not shared' : String(value);
    const formName = (form) => `${display(form.name)} ${form.surname || ''}`.trim();
    const letterIndex = (id) => id == null ? -1 : forms.findIndex((form) => String(form.id) === String(id));
    const ratingLabels = { cute: 'He is cute', 'so-cute': 'He is so cute', 'so-so-cute': 'He is so so cute' };

    function showLetter(index, focus = false) {
        const form = forms[index];
        selectedLetterId = form?.id == null ? null : String(form.id);
        byId('letter-title').textContent = form ? formName(form) : '';
        fields.replaceChildren();
        detail.hidden = !form;
        if (!form) return;
        const interests = ['sports', 'science', 'arts'].filter((key) => form[key] === true || form[key] === 1 || form[key] === 'yes').map((key) => key[0].toUpperCase() + key.slice(1));
        const entries = [
            ['Received', formatDate(form.createdAt)], ['Email', form.email], ['Professional email', form.pemail],
            ['Gender', form.gender], ['Birthday', form.birthday ? String(form.birthday).slice(0, 10) : ''],
            ['About this friend', form.details], ['Interests', interests.join(', ')], ['Other interests', form.interests],
            ['Why they are here', form.joinReason], ['What they think of Dr Orlow', ratingLabels[form.rating] || form.rating]
        ];
        for (const [label, value] of entries) {
            const term = document.createElement('dt');
            const description = document.createElement('dd');
            term.textContent = label;
            description.textContent = display(value);
            fields.append(term, description);
        }
        lettersList.querySelectorAll('button').forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
        if (focus) byId('letter-title').focus({ preventScroll: true });
    }

    async function loadLetters(page, { preserveView = false } = {}) {
        if (!authenticated) return;
        formsRequest?.abort();
        const controller = new AbortController();
        formsRequest = controller;
        const version = sessionVersion;
        lettersStatus.textContent = preserveView ? 'Refreshing your letters…' : 'Gathering your letters…';
        byId('refresh-letters').disabled = true;
        byId('letters-panel').setAttribute('aria-busy', 'true');
        try {
            const data = await request(`/api/super/forms?page=${page}&pageSize=20`, { signal: controller.signal });
            if (controller.signal.aborted || version !== sessionVersion || !authenticated) return;
            if (!Array.isArray(data.forms) || data.forms.some((form) => !form || typeof form !== 'object' || Array.isArray(form)) ||
                !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || data.page < 1 ||
                !Number.isInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 100) {
                throw new Error('The letters could not be read. Please try again.');
            }
            const nextForms = data.forms;
            const nextPage = data.page;
            const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
            if (nextForms.length === 0 && nextPage > 1) return loadLetters(Math.min(nextPage - 1, totalPages), { preserveView });
            // Read at completion so scrolling or choosing a letter during the request is respected.
            const position = preserveView ? { left: window.scrollX, top: window.scrollY } : null;
            const focusedIndex = [...lettersList.querySelectorAll('button')].indexOf(document.activeElement);
            const focusedId = preserveView && focusedIndex >= 0 ? forms[focusedIndex]?.id : null;
            const preferredId = preserveView ? selectedLetterId : null;
            forms = nextForms;
            currentPage = nextPage;
            lettersStatus.textContent = data.total ? `${data.total} ${data.total === 1 ? 'friend has' : 'friends have'} left a letter.` : 'No letters yet. Your friends will find you soon ^-^';
            const items = document.createDocumentFragment();
            forms.forEach((form, index) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                const name = document.createElement('strong');
                const time = document.createElement('time');
                button.type = 'button';
                button.className = 'letter-button';
                name.textContent = formName(form);
                time.textContent = formatDate(form.createdAt);
                if (form.createdAt && !Number.isNaN(new Date(form.createdAt).getTime())) time.dateTime = new Date(form.createdAt).toISOString();
                button.append(name, time);
                button.addEventListener('click', () => showLetter(index, true));
                item.append(button);
                items.append(item);
            });
            lettersList.replaceChildren(items);
            byId('letters-pagination').hidden = totalPages <= 1;
            byId('page-number').textContent = `${currentPage} / ${totalPages}`;
            byId('previous-page').disabled = currentPage <= 1;
            byId('next-page').disabled = currentPage >= totalPages;
            const selectedIndex = letterIndex(preferredId);
            showLetter(selectedIndex >= 0 ? selectedIndex : 0);
            if (preserveView && focusedIndex >= 0) {
                const nextIndex = letterIndex(focusedId);
                const focusTarget = nextIndex >= 0 ? lettersList.querySelectorAll('button')[nextIndex] : byId('letters-panel');
                focusTarget.focus({ preventScroll: true });
            }
            if (position) window.scrollTo(position.left, position.top);
        } catch (error) {
            if (controller.signal.aborted || version !== sessionVersion) return;
            if (error.status === 401) closeRoom('The secret door has closed. Enter your phrase to come back in.');
            else lettersStatus.textContent = `${error.message} Press Refresh letters to try again.`;
        } finally {
            if (formsRequest === controller) {
                formsRequest = null;
                byId('refresh-letters').disabled = false;
                byId('letters-panel').removeAttribute('aria-busy');
            }
        }
    }
    byId('refresh-letters').addEventListener('click', () => loadLetters(currentPage, { preserveView: true }));
    byId('previous-page').addEventListener('click', () => loadLetters(Math.max(1, currentPage - 1)));
    byId('next-page').addEventListener('click', () => loadLetters(currentPage + 1));

    function selectGame(name) {
        stopGames();
        activeGame = name;
        for (const game of ['memory', 'reaction']) {
            byId(`${game}-game`).hidden = name !== game;
            byId(`choose-${game}`).setAttribute('aria-pressed', String(name === game));
        }
        if (name === 'memory') startMemory();
        else resetReaction();
    }
    for (const game of ['memory', 'reaction']) byId(`choose-${game}`).addEventListener('click', () => { if (authenticated) selectGame(game); });
    const canPlay = () => authenticated && activeTab === 'games' && !document.hidden;

    function startMemory() {
        clearTimeout(memoryTimer);
        flipped = [];
        moves = 0;
        pairs = 0;
        const artwork = [
            ['/assets/images/Octopus1.png', 'Little Orlow'], ['/assets/images/DrOrlow.png', 'Dr Orlow'], ['/assets/images/pinkii.png', 'Pinkii'],
            ['/assets/images/angryorlow.png', 'Grumpy Orlow'], ['/assets/images/FatherAndSon.png', 'Father and son'], ['/assets/images/bubble0.png', 'A bubble']
        ];
        const deck = artwork.flatMap(([src, name], pair) => [{ src, name, pair }, { src, name, pair }]);
        for (let index = deck.length - 1; index > 0; index -= 1) {
            const other = Math.floor(Math.random() * (index + 1));
            [deck[index], deck[other]] = [deck[other], deck[index]];
        }
        byId('memory-board').replaceChildren();
        memoryCards = deck.map((card, index) => {
            const button = document.createElement('button');
            const picture = document.createElement('img');
            const back = document.createElement('span');
            button.type = 'button';
            button.className = 'memory-card';
            button.setAttribute('aria-label', `Card ${index + 1}, face down`);
            picture.src = card.src;
            picture.alt = '';
            back.textContent = '?';
            back.setAttribute('aria-hidden', 'true');
            button.append(picture, back);
            const state = { ...card, button, matched: false };
            button.addEventListener('click', () => flipCard(state, index));
            byId('memory-board').append(button);
            return state;
        });
        byId('memory-status').textContent = 'Find the twins. 0 pairs, 0 turns.';
    }

    function flipCard(card, index) {
        if (!canPlay() || activeGame !== 'memory' || card.matched || flipped.includes(card) || flipped.length === 2) return;
        card.button.classList.add('is-open');
        card.button.setAttribute('aria-label', `Card ${index + 1}, ${card.name}`);
        flipped.push(card);
        if (flipped.length < 2) return;
        moves += 1;
        if (flipped[0].pair === flipped[1].pair) {
            pairs += 1;
            for (const match of flipped) {
                match.matched = true;
                match.button.classList.add('is-matched');
                match.button.setAttribute('aria-label', `${match.name}, matched`);
                match.button.setAttribute('aria-disabled', 'true');
            }
            flipped = [];
        } else {
            memoryTimer = setTimeout(() => {
                for (const wrong of flipped) {
                    wrong.button.classList.remove('is-open');
                    wrong.button.setAttribute('aria-label', `Card ${memoryCards.indexOf(wrong) + 1}, face down`);
                }
                flipped = [];
                memoryTimer = null;
            }, 1100);
        }
        byId('memory-status').textContent = pairs === 6 ? `All the twins are home! You found them in ${moves} turns ^-^` : `${pairs} of 6 pairs, ${moves} ${moves === 1 ? 'turn' : 'turns'}.`;
    }
    byId('memory-restart').addEventListener('click', () => { if (canPlay()) startMemory(); });

    function resetReaction() {
        clearTimeout(reactionTimer);
        reactionTimer = null;
        reactionPhase = 'idle';
        reactionScores = [];
        byId('reaction-results').replaceChildren();
        byId('reaction-target').classList.remove('is-ready', 'is-waiting');
        byId('reaction-label').textContent = 'Start';
        byId('reaction-status').textContent = 'Five bubbles to catch. Press Start, wait for green, then catch it!';
    }

    function waitForBubble() {
        reactionPhase = 'waiting';
        byId('reaction-target').classList.remove('is-ready');
        byId('reaction-target').classList.add('is-waiting');
        byId('reaction-label').textContent = 'Wait…';
        byId('reaction-status').textContent = `Bubble ${reactionScores.length + 1} of 5. Wait for green…`;
        reactionTimer = setTimeout(() => {
            if (!canPlay() || activeGame !== 'reaction') return;
            reactionPhase = 'ready';
            reactionStart = performance.now();
            byId('reaction-target').classList.replace('is-waiting', 'is-ready');
            byId('reaction-label').textContent = 'Catch!';
            byId('reaction-status').textContent = 'Green! Catch the bubble!';
            reactionTimer = null;
        }, 1200 + Math.random() * 2300);
    }

    byId('reaction-target').addEventListener('click', () => {
        if (!canPlay() || activeGame !== 'reaction') return;
        if (reactionPhase === 'waiting') {
            clearTimeout(reactionTimer);
            reactionTimer = null;
            reactionPhase = 'idle';
            byId('reaction-target').classList.remove('is-waiting');
            byId('reaction-label').textContent = 'Try again';
            byId('reaction-status').textContent = 'A little too eager ^-^ Wait for green. Your caught bubbles are safe.';
        } else if (reactionPhase === 'ready') {
            const time = Math.max(1, Math.round(performance.now() - reactionStart));
            reactionScores.push(time);
            const result = document.createElement('li');
            result.textContent = `${time} ms`;
            byId('reaction-results').append(result);
            byId('reaction-target').classList.remove('is-ready');
            reactionPhase = 'idle';
            if (reactionScores.length === 5) {
                const average = Math.round(reactionScores.reduce((sum, value) => sum + value, 0) / 5);
                byId('reaction-status').textContent = `Five bubbles caught! Average: ${average} ms. Fastest: ${Math.min(...reactionScores)} ms ^-^`;
                byId('reaction-label').textContent = 'Play again';
                reactionPhase = 'complete';
            } else {
                byId('reaction-status').textContent = `${time} ms! Ready for bubble ${reactionScores.length + 1}?`;
                byId('reaction-label').textContent = 'Next bubble';
            }
        } else {
            if (reactionPhase === 'complete') resetReaction();
            waitForBubble();
        }
    });
    byId('reaction-restart').addEventListener('click', () => { if (canPlay()) resetReaction(); });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        stopGames();
        if (authenticated && activeTab === 'games') {
            if (activeGame === 'memory') startMemory();
            else resetReaction();
        }
    });
    window.addEventListener('pagehide', () => {
        restoreAfterAuth = false;
        // Keep a failed logout retryable while still removing every private letter.
        const retry = !retryLock.hidden;
        const token = csrfToken;
        const message = status.textContent;
        closeRoom();
        if (retry) {
            csrfToken = token;
            retryLock.hidden = false;
            status.textContent = message;
        }
    });
    window.addEventListener('pageshow', (event) => { if (event.persisted) checkSession(); });
    checkSession();
})();
