// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeRemove } from '@renderer/components/AnimeRemove';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function setup() {
    const onRemove = vi.fn();
    render(<AnimeRemove label="REMOVE" ariaLabel="Remove: Naruto EP 1" onRemove={onRemove} />);
    return { onRemove, user: userEvent.setup() };
}

describe('AnimeRemove', () => {
    it('only shows the button at first', () => {
        const { onRemove } = setup();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toHaveTextContent('REMOVE');
        expect(screen.queryByRole('button', { name: 'CONFIRM' })).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('asks first, warning that the files go too, and then removes', async () => {
        const { onRemove, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        expect(screen.getByRole('group', { name: 'Remove: Naruto EP 1' })).toBeInTheDocument();
        expect(screen.getByText('The files are deleted from the disk too.')).toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toBeInTheDocument();
    });

    it('goes back without removing', async () => {
        const { onRemove, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Remove: Naruto EP 1' }));
        await user.click(screen.getByRole('button', { name: 'KEEP' }));

        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Remove: Naruto EP 1' })).toBeInTheDocument();
        expect(screen.queryByText('The files are deleted from the disk too.')).not.toBeInTheDocument();
    });

    describe('when it cannot be removed', () => {
        const REASON = 'This anime gives its name to the series. To remove it, remove the whole series.';

        function setupBlocked() {
            const onRemove = vi.fn();
            render(<AnimeRemove label="REMOVE ANIME" ariaLabel="Remove anime: Frieren" onRemove={onRemove} blocked={REASON} />);
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

        it('does not ask anything and does not remove when it is clicked', async () => {
            const { onRemove, user } = setupBlocked();
            await user.click(screen.getByRole('button', { name: 'Remove anime: Frieren' }));
            expect(screen.queryByRole('group')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CONFIRM' })).not.toBeInTheDocument();
            expect(screen.queryByText('The files are deleted from the disk too.')).not.toBeInTheDocument();
            expect(onRemove).not.toHaveBeenCalled();
        });

        it('has no title and works as usual without a reason', async () => {
            const { onRemove, user } = setup();
            const button = screen.getByRole('button', { name: 'Remove: Naruto EP 1' });
            expect(button).toBeEnabled();
            expect(button).not.toHaveAttribute('title');
            await user.click(button);
            await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
            expect(onRemove).toHaveBeenCalledTimes(1);
        });
    });
});
