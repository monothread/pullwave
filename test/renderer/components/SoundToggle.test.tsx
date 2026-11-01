// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundToggle } from '@renderer/components/SoundToggle';
import { SOUNDS_STORAGE_KEY, useUiPrefsStore } from '@renderer/store/uiPrefsStore';

afterEach(() => {
    useUiPrefsStore.setState({ sounds: true });
    window.localStorage.removeItem(SOUNDS_STORAGE_KEY);
});

describe('SoundToggle', () => {
    it('says the sounds are on and turns them off', () => {
        render(<SoundToggle />);
        const button = screen.getByRole('button', { name: 'Turn the sounds off' });
        expect(button).toHaveClass('topbar__button', 'sound-toggle');
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(button).toHaveAttribute('title', 'Turn the sounds off');
        expect(button.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
        expect(button).toHaveTextContent('🔊︎');
        fireEvent.click(button);
        expect(useUiPrefsStore.getState().sounds).toBe(false);
        expect(window.localStorage.getItem(SOUNDS_STORAGE_KEY)).toBe('off');
    });

    it('says the sounds are off and turns them on', () => {
        useUiPrefsStore.setState({ sounds: false });
        render(<SoundToggle />);
        const button = screen.getByRole('button', { name: 'Turn the sounds on' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveTextContent('🔇︎');
        fireEvent.click(button);
        expect(useUiPrefsStore.getState().sounds).toBe(true);
    });
});
