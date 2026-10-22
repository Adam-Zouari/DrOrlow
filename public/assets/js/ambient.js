(() => {
    'use strict';
    function updateVisibility() {
        document.documentElement.classList.toggle('animations-paused', document.hidden);
    }
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('pagehide', () => document.documentElement.classList.add('animations-paused'));
    window.addEventListener('pageshow', updateVisibility);
    updateVisibility();
})();
