(() => {
    'use strict';

    const story = document.querySelector('#policy-story');
    if (!story) return;

    const scenes = Array.from(story.querySelectorAll('[data-policy-scene]'));

    story.addEventListener('click', (event) => {
        const button = event.target.closest('[data-policy-next]');
        if (!button) return;

        const nextScene = scenes.find((scene) => scene.id === button.dataset.policyNext);
        if (!nextScene) return;

        for (const scene of scenes) scene.hidden = scene !== nextScene;
        // Read the character's response before moving on to its next action.
        const focusTarget = nextScene.hasAttribute('tabindex')
            ? nextScene : nextScene.querySelector('button, a');
        if (focusTarget) focusTarget.focus({ preventScroll: true });
    });
})();
