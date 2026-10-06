// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import type { Mock } from 'vitest';
import userEvent from '@testing-library/user-event';
import { hasPlayerSettings, PlayerSettings, SUBTITLES_OFF, type SubtitleOption } from '@renderer/components/PlayerSettings';
import type { SubtitleStyle } from '@renderer/hooks/useSubtitleStyle';

const OPTIONS: SubtitleOption[] = [
    { id: 'default', label: 'English' },
    { id: 'subtitle-Japanese', label: 'Japanese' }
];

function makeStyle(overrides: Partial<SubtitleStyle> = {}): SubtitleStyle {
    return { scale: 1, resize: vi.fn(), ...overrides };
}

interface Props {
    open: boolean;
    selected: string | null;
    style: SubtitleStyle;
    onOpenChange: Mock<(open: boolean) => void>;
    onSelectSubtitle: Mock<(id: string | null) => void>;
}

function setup(overrides: Partial<Props> = {}): Props {
    const props: Props = { open: true, selected: 'default', style: makeStyle(), onOpenChange: vi.fn<(open: boolean) => void>(), onSelectSubtitle: vi.fn<(id: string | null) => void>(), ...overrides };
    render(
        <PlayerSettings
            open={props.open}
            onOpenChange={props.onOpenChange}
            subtitles={OPTIONS}
            selectedSubtitle={props.selected}
            onSelectSubtitle={props.onSelectSubtitle}
            subtitleStyle={props.style}
        />
    );
    return props;
}

describe('hasPlayerSettings', () => {
    it('is true when there are subtitles to set', () => {
        expect(hasPlayerSettings(OPTIONS)).toBe(true);
    });

    it('is false when there is nothing to set', () => {
        expect(hasPlayerSettings([])).toBe(false);
    });
});

describe('PlayerSettings', () => {
    it('shows only the gear while closed', () => {
        setup({ open: false });
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks to open and to close with the gear', async () => {
        const user = userEvent.setup();
        const closed = setup({ open: false });
        await user.click(screen.getByRole('button', { name: 'Settings' }));
        expect(closed.onOpenChange).toHaveBeenCalledTimes(1);
        expect(closed.onOpenChange).toHaveBeenCalledWith(true);
    });

    it('asks to close with the gear when it is open, with Escape and with a click outside', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = setup();
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
        await user.click(screen.getByRole('button', { name: 'Settings' }));
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        await user.keyboard('{Escape}');
        expect(onOpenChange).toHaveBeenCalledTimes(2);
        await user.click(document.body);
        expect(onOpenChange).toHaveBeenCalledTimes(3);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it('does not close with other keys or with a click inside the panel', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = setup();
        await user.keyboard('a');
        await user.click(screen.getByText('Subtitle size'));
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('does not listen to the keyboard or the mouse while closed', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = setup({ open: false });
        await user.keyboard('{Escape}');
        await user.click(document.body);
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('lists the subtitles with the option to turn them off, and tells the choice', async () => {
        const user = userEvent.setup();
        const { onSelectSubtitle } = setup();
        const select = within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('combobox', { name: 'Subtitles' });
        expect(select).toHaveValue('default');
        expect(
            within(select)
                .getAllByRole('option')
                .map((option) => {
                    return [option.getAttribute('value'), option.textContent];
                })
        ).toEqual([
            [SUBTITLES_OFF, 'Off'],
            ['default', 'English'],
            ['subtitle-Japanese', 'Japanese']
        ]);
        await user.selectOptions(select, 'subtitle-Japanese');
        expect(onSelectSubtitle).toHaveBeenLastCalledWith('subtitle-Japanese');
        await user.selectOptions(select, SUBTITLES_OFF);
        expect(onSelectSubtitle).toHaveBeenLastCalledWith(null);
    });

    it('shows "off" when no subtitle is selected', () => {
        setup({ selected: null });
        expect(screen.getByRole('combobox', { name: 'Subtitles' })).toHaveValue(SUBTITLES_OFF);
    });

    it('shows the size and asks for a step bigger or smaller', async () => {
        const user = userEvent.setup();
        const resize = vi.fn();
        setup({ style: makeStyle({ scale: 1.5, resize }) });
        expect(within(screen.getByRole('group', { name: 'Subtitle size' })).getByText('150%')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
        expect(resize).toHaveBeenLastCalledWith(1);
        await user.click(screen.getByRole('button', { name: 'Smaller subtitles' }));
        expect(resize).toHaveBeenLastCalledWith(-1);
        expect(resize).toHaveBeenCalledTimes(2);
    });

    it('turns off the button of a size that cannot go further', () => {
        setup({ style: makeStyle({ scale: 0.5 }) });
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeEnabled();
    });

    it('turns off the larger button at the largest size', () => {
        setup({ style: makeStyle({ scale: 3 }) });
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeEnabled();
    });

    it('has no color and no background control', () => {
        setup();
        expect(screen.queryByRole('combobox', { name: 'Subtitle color' })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Subtitle background' })).not.toBeInTheDocument();
    });
});
