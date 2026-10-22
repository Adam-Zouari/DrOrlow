(() => {
    'use strict';

    const form = document.getElementById('join-form');
    if (!form || typeof window.fetch !== 'function' || !window.FormData || !window.URLSearchParams) return;

    const status = document.getElementById('form-status');
    const submitButton = document.getElementById('submit-button');
    const resetButton = document.getElementById('reset-button');
    const birthday = document.getElementById('birthday');
    const fields = Array.from(form.elements).filter((field) => field.name);
    const controlsByName = new Map();
    for (const field of fields) {
        if (!controlsByName.has(field.name)) controlsByName.set(field.name, []);
        controlsByName.get(field.name).push(field);
    }
    const unconfirmedMessage = 'We could not confirm your form was sent. Please check your connection and try again. Your entries are still here.';
    let pendingRequest = null;

    // With JavaScript disabled, the browser still validates and posts the form.
    form.noValidate = true;
    function updateBirthdayLimit() {
        birthday.max = new Date().toISOString().slice(0, 10);
    }
    updateBirthdayLimit();
    birthday.addEventListener('focus', updateBirthdayLimit);
    window.addEventListener('pageshow', updateBirthdayLimit);

    function clearFieldError(name) {
        const error = document.getElementById(`${name}-error`);
        if (error) error.textContent = '';
        for (const field of controlsByName.get(name) || []) field.removeAttribute('aria-invalid');
    }

    function showFieldError(name, message) {
        const error = document.getElementById(`${name}-error`);
        if (!error) return;
        error.textContent = message;
        for (const field of controlsByName.get(name) || []) field.setAttribute('aria-invalid', 'true');
    }

    function clearErrors() {
        for (const name of controlsByName.keys()) clearFieldError(name);
        status.textContent = '';
    }

    function validateCustomFields() {
        for (const name of ['name', 'surname', 'join_reason']) {
            const field = form.elements.namedItem(name);
            field.setCustomValidity(field.value.trim() ? '' : 'Please complete this field.');
        }
    }

    function setBusy(busy) {
        submitButton.disabled = busy;
        resetButton.disabled = busy;
        submitButton.textContent = busy ? 'Sending…' : 'Send form';
        form.setAttribute('aria-busy', String(busy));
    }

    function finishRequest(request) {
        if (pendingRequest !== request) return false;
        window.clearTimeout(request.timeout);
        pendingRequest = null;
        setBusy(false);
        return true;
    }

    function showUnconfirmed(request, focus = true) {
        if (!finishRequest(request)) return;
        request.controller?.abort();
        status.textContent = unconfirmedMessage;
        if (focus) status.focus();
    }

    window.addEventListener('pagehide', () => {
        if (pendingRequest) showUnconfirmed(pendingRequest, false);
    });

    form.addEventListener('input', (event) => {
        if (!event.target.name) return;
        clearFieldError(event.target.name);
        validateCustomFields();
    });

    form.addEventListener('change', (event) => {
        if (event.target.name) clearFieldError(event.target.name);
    });

    form.addEventListener('reset', () => {
        clearErrors();
        for (const field of fields) {
            if (typeof field.setCustomValidity === 'function') field.setCustomValidity('');
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (pendingRequest) return;
        clearErrors();
        updateBirthdayLimit();
        validateCustomFields();

        if (!form.checkValidity()) {
            const invalidFields = fields.filter((field) => field.willValidate && !field.validity.valid);
            for (const field of invalidFields) showFieldError(field.name, field.validationMessage);
            status.textContent = 'Please check the highlighted fields before submitting.';
            if (invalidFields[0]) invalidFields[0].focus();
            return;
        }

        const request = {
            body: new URLSearchParams(new FormData(form)),
            controller: typeof window.AbortController === 'function' ? new window.AbortController() : null,
            timeout: null
        };
        pendingRequest = request;
        setBusy(true);
        status.textContent = 'Sending your details…';
        // The UI also recovers on older fetch implementations that cannot abort.
        request.timeout = window.setTimeout(() => showUnconfirmed(request), 20000);

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body: request.body,
                credentials: 'same-origin',
                ...(request.controller ? { signal: request.controller.signal } : {})
            });
            if (pendingRequest !== request) return;
            const result = await response.json();
            if (pendingRequest !== request) return;
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                throw new Error('Unexpected server response');
            }
            const currentBody = new URLSearchParams(new FormData(form));

            if (!response.ok) {
                const errors = result.errors && typeof result.errors === 'object' ? result.errors : {};
                for (const [name, message] of Object.entries(errors)) {
                    const submittedValues = request.body.getAll(name);
                    const currentValues = currentBody.getAll(name);
                    const unchanged = submittedValues.length === currentValues.length &&
                        submittedValues.every((value, index) => value === currentValues[index]);
                    if (unchanged && typeof message === 'string') showFieldError(name, message);
                }
                status.textContent = typeof result.message === 'string' ? result.message : 'We could not save your details. Please try again.';
                const invalidField = fields.find((field) => field.getAttribute('aria-invalid') === 'true');
                (invalidField || status).focus();
                return;
            }

            // Preserve a new draft if the friend edited it while the request ran.
            const unchanged = currentBody.toString() === request.body.toString();
            if (unchanged) form.reset();
            status.textContent = typeof result.message === 'string' ? result.message : 'Your form has been sent to Dr Orlow. Thank you, friend!';
            if (unchanged) status.focus();
        } catch {
            showUnconfirmed(request);
        } finally {
            finishRequest(request);
        }
    });
})();
