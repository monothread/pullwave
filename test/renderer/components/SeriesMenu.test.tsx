// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SeriesMenu } from '@renderer/components/SeriesMenu';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function setup() {
    const onRename = vi.fn();
    const onRemove = vi.fn();
    const view = render(
        <div>
            <button type="button">Outside</button>
            <SeriesMenu name="Frieren" onRename={onRename} onRemove={onRemove} />
        </div>
    );
    return { onRename, onRemove, user: userEvent.setup(), ...view };
}

describe('SeriesMenu', () => {
    it('is only a gear at first, which says what it is for and that it is closed', () => {
        setup();
        const gear = screen.getByRole('button', { name: 'Series options: Frieren' });
        expect(gear).toHaveAttribute('aria-expanded', 'false');
        expect(gear).toHaveAttribute('aria-haspopup', 'true');
        expect(gear).toHaveAttribute('title', 'Series options');
        expect(gear).toHaveClass('btn', 'btn--small', 'btn--ghost', 'series-menu__button');
        expect(gear.querySelector('span[aria-hidden="true"]')).toHaveTextContent('⚙');
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('opens a panel with RENAME SERIES and REMOVE SERIES, in that order', async () => {
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        const panel = screen.getByRole('group', { name: 'Series options: Frieren' });
        expect(panel).toHaveClass('series-menu__panel');
        expect(
            within(panel)
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['RENAME SERIES', 'REMOVE SERIES']);
        expect(screen.getByRole('button', { name: 'Series options: Frieren' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes when the gear is used again', async () => {
        const { user } = setup();
        const gear = screen.getByRole('button', { name: 'Series options: Frieren' });
        await user.click(gear);
        await user.click(gear);
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
        expect(gear).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes with Escape, and keeps the key to itself so nothing else reacts to it', async () => {
        const { user } = setup();
        const outer = vi.fn();
        window.addEventListener('keydown', outer);
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.keyboard('{Escape}');
        window.removeEventListener('keydown', outer);
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
        expect(outer).not.toHaveBeenCalled();
    });

    it('does not keep the key to itself while it is closed', async () => {
        const { user } = setup();
        const outer = vi.fn();
        window.addEventListener('keydown', outer);
        await user.keyboard('{Escape}');
        window.removeEventListener('keydown', outer);
        expect(outer).toHaveBeenCalledTimes(1);
    });

    it('closes with a click outside it, and stays open with a click inside', async () => {
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('group', { name: 'Series options: Frieren' }));
        expect(screen.getByRole('group')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
    });

    it('stops listening to the page once it is closed or removed', async () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        const { user, unmount } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        expect(add).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        expect(add).toHaveBeenCalledWith('mousedown', expect.any(Function));
        unmount();
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
        add.mockRestore();
        remove.mockRestore();
    });

    it('closes and asks to rename when RENAME SERIES is used', async () => {
        const { user, onRename, onRemove } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'RENAME SERIES: Frieren' }));
        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onRename).toHaveBeenCalledWith();
        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();
    });

    it('asks again before it removes, with the panel still open, and removes only after CONFIRM', async () => {
        const { user, onRemove } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));
        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.getByText('The files are deleted from the disk too.')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Series options: Frieren' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith();
    });

    it('goes back without removing when KEEP is used', async () => {
        const { user, onRemove } = setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'KEEP' }));
        expect(onRemove).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' })).toBeInTheDocument();
    });

    it('tells which series it is about in every name, whatever the series is called', () => {
        render(<SeriesMenu name="Pokémon: Journeys" onRename={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Series options: Pokémon: Journeys' })).toBeInTheDocument();
    });

    it('speaks the language of the settings', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        const user = userEvent.setup();
        render(<SeriesMenu name="Frieren" onRename={vi.fn()} onRemove={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Opções da série: Frieren' }));
        expect(screen.getByRole('button', { name: 'RENOMEAR SÉRIE: Frieren' })).toHaveTextContent('RENOMEAR SÉRIE');
        expect(screen.getByRole('button', { name: 'REMOVER SÉRIE: Frieren' })).toHaveTextContent('REMOVER SÉRIE');
    });
});
