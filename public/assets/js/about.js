(() => {
    'use strict';
    const main = document.querySelector('#main-content');
    if (!main || typeof window.IntersectionObserver !== 'function') return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) return;
    const targets = main.querySelectorAll('h2, #family p, main > p, .pinkii-story p, img');
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-revealed');
                observer.unobserve(entry.target);
            }
        }
    });
    for (const target of targets) {
        target.classList.add(target.tagName === 'IMG' ? 'image-reveal' : 'scroll-reveal');
        observer.observe(target);
    }
    main.classList.add('reveal-ready');
    const reduceMotion = (event) => {
        if (!event.matches) return;
        main.classList.remove('reveal-ready');
        observer.disconnect();
    };
    if (preference?.addEventListener) preference.addEventListener('change', reduceMotion);
    else preference?.addListener?.(reduceMotion);
})();
