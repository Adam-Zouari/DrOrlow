(() => {
    'use strict';

    const conversation = document.querySelector('#conversation');
    if (!conversation) return;

    const scenes = Array.from(conversation.querySelectorAll('[data-talk-scene]'));
    const restart = document.querySelector('#restart');

    function showScene(id) {
        const nextScene = scenes.find((scene) => scene.id === id);
        if (!nextScene) return;

        for (const scene of scenes) scene.hidden = scene !== nextScene;
        restart.hidden = id !== 'page3' && id !== 'sadtext2';
        nextScene.focus();
    }

    conversation.addEventListener('click', (event) => {
        const button = event.target.closest('[data-talk-next]');
        if (button) showScene(button.dataset.talkNext);
    });

    restart.addEventListener('click', () => showScene('page1'));
})();
