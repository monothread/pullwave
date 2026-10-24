// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeRemove } from '@renderer/components/AnimeRemove';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

const TITLE = 'Remove "Naruto"?';
const MESSAGE = 'The anime leaves the library and its downloaded episodes are deleted from the disk too.';

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function setup() {
    const onRemove = vi.fn();
    render(<AnimeRemove label="REMOVE" ariaLabel="Remove: Naruto EP 1" title={TITLE} message={MESSAGE} onRemove={onRemove} />);
    return { onRemove, user: userEvent.setup() };
}

describe('AnimeRemove', () => {
    it('only shows the button at first', () => {
        const { onRemove } = setup();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toHaveTextContent('REMOVE');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('opens a window that names what goes and warns that the files go too, and removes only after it is confirmed', async () => {
        const { onRemove, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        const dialog = confirmDialog(TITLE);
        expect(within(dialog).getByText(MESSAGE)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'KEEP' })).toHaveFocus();
        expect(onRemove).not.toHaveBeenCalled();

        await answerDialog(user, TITLE, 'REMOVE');
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toBeInTheDocument();
    });

    it('goes back without removing with KEEP, with Esc and with a click outside the window', async () => {
        const { onRemove, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        await answerDialog(user, TITLE, 'KEEP');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toBeInTheDocument();
    });

    describe('when it cannot be removed', () => {
        const REASON = 'This anime gives its name to the series. To remove it, remove the whole series.';

        function setupBlocked() {
            const onRemove = vi.fn();
            render(<AnimeRemove label="REMOVE ANIME" ariaLabel="Remove anime: Frieren" title={TITLE} message={MESSAGE} onRemove={onRemove} blocked={REASON} />);
            return { onRemove, user: userEvent.setup() };
        }

        it('shows the button off, with the reason as its title', () => {
            setupBlocked();
            const button = screen.getByRole('button', { name: 'Remove anime: Frieren' });
            expect(button).toBeDisabled();
            expect(button).toHaveAttribute('title', REASON);
            expect(button).toHaveTextContent('REMOVE ANIME');
            expect(button).toHaveClass('btn', 'btn--small', 'btn--ghost');
        });

        it('does not open any window and does not remove when it is clicked', async () => {
            const { onRemove, user } = setupBlocked();
            await user.click(screen.getByRole('button', { name: 'Remove anime: Frieren' }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(onRemove).not.toHaveBeenCalled();
        });

        it('has no title and works as usual without a reason', async () => {
            const { onRemove, user } = setup();
            const button = screen.getByRole('button', { name: 'Remove: Naruto EP 1' });
            expect(button).toBeEnabled();
            expect(button).not.toHaveAttribute('title');
            await user.click(button);
            await answerDialog(user, TITLE, 'REMOVE');
            expect(onRemove).toHaveBeenCalledTimes(1);
        });
    });
});
