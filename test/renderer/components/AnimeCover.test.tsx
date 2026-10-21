// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeCover } from '@renderer/components/AnimeCover';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const COVER = 'https://s4.anilist.co/cover/naruto.jpg';

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, covers: {} });
});

function image(container: HTMLElement): HTMLImageElement | null {
    return container.querySelector('img');
}

describe('AnimeCover with an address it was given', () => {
    it('shows the picture, as a decoration, at the size of a cover, and loads it lazily', () => {
        const { container } = render(<AnimeCover title="Naruto" url={COVER} />);

        const picture = image(container) as HTMLImageElement;
        expect(picture).toHaveAttribute('src', COVER);
        expect(picture).toHaveAttribute('alt', '');
        expect(picture).toHaveAttribute('loading', 'lazy');
        expect(picture).toHaveAttribute('width', '90');
        expect(picture).toHaveAttribute('height', '128');
        expect(picture).toHaveClass('cover');
        expect(screen.queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
    });

    it('does not look the cover up: it was given', () => {
        render(<AnimeCover title="Naruto" url={COVER} />);

        expect(mock.api.findAnimeCover).not.toHaveBeenCalled();
    });

    it('says the cover was not found when the anime has none', () => {
        const { container } = render(<AnimeCover title="Naruto" url={null} />);

        expect(image(container)).toBeNull();
        expect(screen.getByText('COVER NOT FOUND')).toHaveClass('cover', 'cover--none');
        expect(mock.api.findAnimeCover).not.toHaveBeenCalled();
    });

    it('says the cover was not found when the picture does not load', () => {
        const { container } = render(<AnimeCover title="Naruto" url={COVER} />);

        fireEvent.error(image(container) as HTMLImageElement);

        expect(image(container)).toBeNull();
        expect(screen.getByText('COVER NOT FOUND')).toHaveClass('cover', 'cover--none');
    });

    it('tries a new address after the one that failed', () => {
        const { container, rerender } = render(<AnimeCover title="Naruto" url={COVER} />);
        fireEvent.error(image(container) as HTMLImageElement);

        rerender(<AnimeCover title="Naruto" url="https://s4.anilist.co/cover/naruto-new.jpg" />);

        expect(image(container)).toHaveAttribute('src', 'https://s4.anilist.co/cover/naruto-new.jpg');
        expect(screen.queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
    });
});

describe('AnimeCover that looks the cover up by the title', () => {
    it('asks for the cover once, by the title, when it is shown', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);

        render(<AnimeCover title="Naruto" />);

        await vi.waitFor(() => {
            expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.findAnimeCover).toHaveBeenCalledWith('Naruto');
    });

    it('is a plain block, with nothing said, while the cover is being looked for', async () => {
        let answer: (url: string | null) => void = () => {
            return undefined;
        };
        mock.api.findAnimeCover.mockImplementation(() => {
            return new Promise((resolve) => {
                answer = resolve;
            });
        });

        const { container } = render(<AnimeCover title="Naruto" />);

        expect(image(container)).toBeNull();
        expect(container.querySelector('.cover--none')).toBeEmptyDOMElement();
        expect(screen.queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
        // The store only asks once for a title, as long as it has not been answered: this one is answered so the next test is not in its way.
        await act(async () => {
            answer(null);
        });
    });

    it('shows the picture once the cover is found', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);

        const { container } = render(<AnimeCover title="Naruto" />);

        await vi.waitFor(() => {
            expect(image(container)).toHaveAttribute('src', COVER);
        });
        expect(container.querySelector('.cover--none')).toBeNull();
    });

    it('says the cover was not found when the main process finds none', async () => {
        mock.api.findAnimeCover.mockResolvedValue(null);

        const { container } = render(<AnimeCover title="Unknown anime" />);

        expect(await screen.findByText('COVER NOT FOUND')).toHaveClass('cover', 'cover--none');
        expect(image(container)).toBeNull();
    });

    it('says the cover was not found when it could not be asked for', async () => {
        mock.api.findAnimeCover.mockRejectedValue(new Error('AniList answered with status 500.'));

        render(<AnimeCover title="Naruto" />);

        expect(await screen.findByText('COVER NOT FOUND')).toBeInTheDocument();
    });

    it('says it in the language of the app', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        mock.api.findAnimeCover.mockResolvedValue(null);

        render(<AnimeCover title="Naruto" />);

        expect(await screen.findByText('CAPA NÃO ENCONTRADA')).toBeInTheDocument();
    });

    it('shows what the store already knows at once, without asking again', () => {
        useAnimeStore.setState({ covers: { naruto: { status: 'found', url: COVER } } });

        const { container } = render(<AnimeCover title="  NARUTO " />);

        expect(image(container)).toHaveAttribute('src', COVER);
        expect(mock.api.findAnimeCover).not.toHaveBeenCalled();
    });

    it('shows the new address when the main process says the cover changed', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);
        const { container } = render(<AnimeCover title="Naruto" />);
        await vi.waitFor(() => {
            expect(image(container)).toHaveAttribute('src', COVER);
        });

        act(() => {
            useAnimeStore.setState({ covers: { naruto: { status: 'found', url: 'https://s4.anilist.co/cover/naruto-new.jpg' } } });
        });

        expect(image(container)).toHaveAttribute('src', 'https://s4.anilist.co/cover/naruto-new.jpg');
    });

    it('says the cover was not found when the picture does not load', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);
        const { container } = render(<AnimeCover title="Naruto" />);
        await vi.waitFor(() => {
            expect(image(container)).not.toBeNull();
        });

        fireEvent.error(image(container) as HTMLImageElement);

        expect(screen.getByText('COVER NOT FOUND')).toBeInTheDocument();
    });

    it('asks for the cover of the new title when the title changes', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);
        const { rerender } = render(<AnimeCover title="Naruto" />);
        await vi.waitFor(() => {
            expect(mock.api.findAnimeCover).toHaveBeenCalledWith('Naruto');
        });

        rerender(<AnimeCover title="Bleach" />);

        await vi.waitFor(() => {
            expect(mock.api.findAnimeCover).toHaveBeenCalledWith('Bleach');
        });
        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(2);
    });
});

describe('AnimeCover that has no cover yet', () => {
    it('asks again each time it is shown, and shows the picture once one is found', async () => {
        mock.api.findAnimeCover.mockResolvedValueOnce(null).mockResolvedValueOnce(COVER);

        const first = render(<AnimeCover title="Naruto" />);
        expect(await screen.findByText('COVER NOT FOUND')).toBeInTheDocument();
        first.unmount();
        const second = render(<AnimeCover title="Naruto" />);

        await vi.waitFor(() => {
            expect(image(second.container)).toHaveAttribute('src', COVER);
        });
        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(2);
        expect(mock.api.findAnimeCover).toHaveBeenNthCalledWith(1, 'Naruto');
        expect(mock.api.findAnimeCover).toHaveBeenNthCalledWith(2, 'Naruto');
    });

    it('takes the picture when the main process finds the cover in the background', async () => {
        mock.api.getAnimeStatus.mockResolvedValue({ ...initialAnime.status, supported: true });
        await useAnimeStore.getState().init();
        mock.api.findAnimeCover.mockResolvedValue(null);

        const { container } = render(<AnimeCover title="Naruto" />);
        expect(await screen.findByText('COVER NOT FOUND')).toBeInTheDocument();
        act(() => {
            mock.emitAnimeCover({ title: 'Naruto', url: COVER });
        });

        expect(image(container)).toHaveAttribute('src', COVER);
        expect(screen.queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
    });

    it('tries the picture again when it is shown again after it failed to load', () => {
        const first = render(<AnimeCover title="Naruto" url={COVER} />);
        fireEvent.error(image(first.container) as HTMLImageElement);
        expect(image(first.container)).toBeNull();
        first.unmount();

        const second = render(<AnimeCover title="Naruto" url={COVER} />);

        expect(image(second.container)).toHaveAttribute('src', COVER);
    });
});
