// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SeriesCover } from '@renderer/components/SeriesCover';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const ONE = 'https://media.kitsu.app/anime/poster_images/1/large.jpg';
const TWO = 'https://s4.anilist.co/cover/two.jpg';
const THREE = 'https://s4.anilist.co/cover/three.jpg';

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, covers: {} });
});

function answers(table: Record<string, string | null>): void {
    mock.api.findAnimeCover.mockImplementation(async (title: string) => {
        return table[title] ?? null;
    });
}

describe('SeriesCover', () => {
    it('shows the cover of the first season, without looking the other seasons up', async () => {
        answers({ 'Season One': ONE, 'Season Two': TWO });
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two']} name="Series" />);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', ONE);
        });
        expect(mock.api.findAnimeCover.mock.calls).toEqual([['Season One']]);
    });

    it('shows the cover of the next season when the first has none', async () => {
        answers({ 'Season Two': TWO });
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two', 'Season Three']} name="Series" />);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', TWO);
        });
        expect(mock.api.findAnimeCover.mock.calls).toEqual([['Season One'], ['Season Two']]);
        expect(screen.queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
    });

    it('goes on to the third season when the first two have none', async () => {
        answers({ 'Season Three': THREE });
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two', 'Season Three']} name="Series" />);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', THREE);
        });
        expect(mock.api.findAnimeCover.mock.calls).toEqual([['Season One'], ['Season Two'], ['Season Three']]);
    });

    it('goes on to the next season when the first has a cover whose picture does not load', async () => {
        answers({ 'Season One': ONE, 'Season Two': TWO });
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two']} name="Series" />);
        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', ONE);
        });

        fireEvent.error(container.querySelector('img.cover') as HTMLImageElement);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', TWO);
        });
    });

    it('goes on to the next season when the first one could not be asked for', async () => {
        mock.api.findAnimeCover.mockImplementation(async (title: string) => {
            if (title === 'Season One') {
                throw new Error('AniList is down');
            }
            return TWO;
        });
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two']} name="Series" />);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', TWO);
        });
    });

    it('says the cover was not found, as the first season, when none of the seasons has one', async () => {
        answers({});
        const { container } = render(<SeriesCover titles={['Season One', 'Season Two']} name="Series" />);

        await waitFor(() => {
            expect(screen.getByText('COVER NOT FOUND')).toHaveClass('cover', 'cover--none');
        });
        expect(container.querySelector('img')).toBeNull();
        expect(mock.api.findAnimeCover.mock.calls).toEqual([['Season One'], ['Season Two']]);
    });

    it('looks the series up by its name when it has no season', async () => {
        answers({ Series: ONE });
        const { container } = render(<SeriesCover titles={[]} name="Series" />);

        await waitFor(() => {
            expect(container.querySelector('img.cover')).toHaveAttribute('src', ONE);
        });
        expect(mock.api.findAnimeCover.mock.calls).toEqual([['Series']]);
    });
});
