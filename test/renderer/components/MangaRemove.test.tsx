// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaRemove } from '@renderer/components/MangaRemove';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function setup(overrides: Partial<Parameters<typeof MangaRemove>[0]> = {}) {
    const onRemove = vi.fn();
    render(<MangaRemove label="REMOVE" ariaLabel="REMOVE: One Piece" title="Remove One Piece?" message="The files go too." onRemove={onRemove} {...overrides} />);
    return { onRemove, user: userEvent.setup() };
}

describe('MangaRemove', () => {
    it('is a button that names what it removes, and asks nothing until it is clicked', () => {
        setup();
        const button = screen.getByRole('button', { name: 'REMOVE: One Piece' });
        expect(button).toHaveTextContent('REMOVE');
        expect(button).toHaveClass('btn', 'btn--small', 'btn--hot');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('can look like the other buttons of its row', () => {
        setup({ quiet: true });
        const button = screen.getByRole('button', { name: 'REMOVE: One Piece' });
        expect(button).toHaveClass('btn--ghost');
        expect(button).not.toHaveClass('btn--hot');
    });

    it('opens a window with the title and the warning, and removes when it is confirmed with the label of the button for it', async () => {
        const { user, onRemove } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        const dialog = screen.getByRole('dialog', { name: 'Remove One Piece?' });
        expect(dialog).toHaveTextContent('The files go too.');
        expect(onRemove).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: 'REMOVE' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('uses the label it is given for the confirming button', async () => {
        const { user } = setup({ confirmLabel: 'DELETE' });
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
    });

    it('keeps what it is about when the window is called off, and can ask again', async () => {
        const { user, onRemove } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'KEEP' }));
        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('is off and says why when it cannot be removed, and never opens a window', async () => {
        const { user, onRemove } = setup({ blocked: 'It gives its name to the series.' });
        const button = screen.getByRole('button', { name: 'REMOVE: One Piece' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'It gives its name to the series.');
        await user.click(button);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('speaks the language of the settings', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE: One Piece' }));
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'REMOVER' })).toBeInTheDocument();
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'MANTER' })).toBeInTheDocument();
    });
});
