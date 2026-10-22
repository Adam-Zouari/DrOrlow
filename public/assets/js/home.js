(() => {
    'use strict';
    const notice = document.getElementById('form-notice');
    if (notice && new URLSearchParams(window.location.search).get('submitted') === '1') {
        notice.hidden = false;
    }
})();
