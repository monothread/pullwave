// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubtitleSizeControl } from '@renderer/components/SubtitleSizeControl';
import type { SubtitleStyle } from '@renderer/hooks/useSubtitleStyle';

function setup(scale: number) {
    const resize = vi.fn<(direction: 1 | -1) => void>();
    const style: SubtitleStyle = { scale, resize };
    render(<SubtitleSizeControl subtitleStyle={style} groupClassName="the-group" buttonClassName="the-button" valueClassName="the-value" />);
    return { resize };
}

describe('SubtitleSizeControl', () => {
    it('is a group named after the size, with the two buttons and the percent between them, in the classes it is given', () => {
        setup(1.25);
        const group = screen.getByRole('group', { name: 'Subtitle size' });
        expect(group).toHaveClass('the-group');
        expect(Array.from(group.children).map((child) => {
            return [child.tagName, child.className, child.textContent];
        })).toEqual([
            ['BUTTON', 'the-button', 'A−'],
            ['SPAN', 'the-value', '125%'],
            ['BUTTON', 'the-button', 'A+']
        ]);
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toHaveTextContent('A−');
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toHaveTextContent('A+');
    });

    it('makes the subtitles smaller and bigger one step at a time', async () => {
        const user = userEvent.setup();
        const { resize } = setup(1);
        await user.click(screen.getByRole('button', { name: 'Smaller subtitles' }));
        expect(resize.mock.calls).toEqual([[-1]]);
        await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
        await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
        expect(resize.mock.calls).toEqual([[-1], [1], [1]]);
    });

    it('turns the smaller button off at the smallest size, and leaves the other on', async () => {
        const user = userEvent.setup();
        const { resize } = setup(0.5);
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeEnabled();
        expect(screen.getByRole('group', { name: 'Subtitle size' })).toHaveTextContent('50%');
        await user.click(screen.getByRole('button', { name: 'Smaller subtitles' }));
        expect(resize).not.toHaveBeenCalled();
    });

    it('turns the bigger button off at the biggest size, and leaves the other on', async () => {
        const user = userEvent.setup();
        const { resize } = setup(3);
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeEnabled();
        expect(screen.getByRole('group', { name: 'Subtitle size' })).toHaveTextContent('300%');
        await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
        expect(resize).not.toHaveBeenCalled();
    });

    it('has both buttons on between the limits', () => {
        setup(1);
        expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeEnabled();
    });
});
