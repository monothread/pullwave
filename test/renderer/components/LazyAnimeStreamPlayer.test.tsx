// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { LazyAnimeStreamPlayer } from '@renderer/components/LazyAnimeStreamPlayer';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, streaming: null });
});

describe('LazyAnimeStreamPlayer', () => {
    it('draws nothing while no stream is open', () => {
        const { container } = render(<LazyAnimeStreamPlayer />);
        expect(container).toBeEmptyDOMElement();
    });

    it('loads the player and shows the stream once one is opened', async () => {
        render(<LazyAnimeStreamPlayer />);
        act(() => {
            useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '2', status: 'loading', stream: null, error: null, nextEpisode: null } });
        });
        expect(await screen.findByRole('dialog', { name: 'Naruto · EP 2' })).toBeInTheDocument();
    });

    it('removes the player when the stream is closed', async () => {
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '2', status: 'loading', stream: null, error: null, nextEpisode: null } });
        const { container } = render(<LazyAnimeStreamPlayer />);
        expect(await screen.findByRole('dialog', { name: 'Naruto · EP 2' })).toBeInTheDocument();
        act(() => {
            useAnimeStore.getState().closeStream();
        });
        expect(container).toBeEmptyDOMElement();
    });
});
