(() => {
    'use strict';

    const field = document.querySelector('#game-field');
    const status = document.querySelector('#game-status');
    if (!field || !status) return;

    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const canAnimate = Boolean(motionPreference && window.CSS?.supports?.('height', '1cqh'));
    let paused = false;

    function updateMotion() {
        const reducedMotion = motionPreference?.matches;
        field.classList.toggle('is-animated', canAnimate && !reducedMotion);
        field.classList.toggle('is-paused', paused || document.hidden);
        status.textContent = reducedMotion
            ? 'The octopuses stay still to match your reduced motion preference.'
            : !canAnimate ? 'Find Dr Orlow among the octopuses!'
            : paused ? 'Animation paused. Press P to resume.' : 'The octopuses are floating. Press P to pause.';
    }

    field.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing || event.key.toLowerCase() !== 'p' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
        if (!canAnimate || motionPreference.matches) return;
        event.preventDefault();
        paused = !paused;
        updateMotion();
    });

    if (motionPreference?.addEventListener) motionPreference.addEventListener('change', updateMotion);
    else motionPreference?.addListener?.(updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    window.addEventListener('pageshow', updateMotion);
    updateMotion();
})();
