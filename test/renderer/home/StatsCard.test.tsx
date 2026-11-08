// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';

vi.mock('@renderer/fx/CountUp', () => {
    return {
        CountUp: ({ value }: { value: number }) => {
            return <span className="count-up">{value}</span>;
        }
    };
});

import { STAT_LINES, StatsCard } from '@renderer/home/StatsCard';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import { makeChapterRecord, makeLibraryManga, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

function at(days: number, hour = 9): number {
    return new Date(2026, 10, 7 - days, hour, 0, 0).getTime();
}

beforeEach(() => {
    installMockApi();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 14, 0, 0));
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS }, history: [] });
    useAnimeStore.setState({ ...initialAnime, history: [] });
    useMangaStore.setState({ ...initialManga, history: [], library: [], browse: { ...initialManga.browse, sources: [], sourcesStatus: 'ready' } });
});

afterEach(() => {
    vi.useRealTimers();
});

function numbers(): Record<string, string> {
    const card = screen.getByTestId('home-stats');
    return Object.fromEntries(
        Array.from(card.querySelectorAll('.stats__number')).map((item) => {
            return [item.getAttribute('data-stat') as string, within(item as HTMLElement).getByText(/^\d+$/).textContent as string];
        })
    );
}

describe('StatsCard', () => {
    it('has the lines of the week in order', () => {
        expect(STAT_LINES.map((line) => { return line.key; })).toEqual(['downloads', 'watched', 'read', 'streak']);
    });

    it('is a region named for the screen readers, with a greeting for the hour and the title of the period', () => {
        render(<StatsCard />);
        const card = screen.getByRole('region', { name: 'Your week in numbers' });
        expect(card).toHaveClass('stats');
        expect(card.querySelector('.stats__greeting')).toHaveTextContent('Good afternoon');
        expect(card.querySelector('.stats__title')).toHaveTextContent('LAST 7 DAYS');
        expect(card.querySelector('.stats__greeting')?.tagName).toBe('P');
    });

    it('greets by the part of the day and changes it as the clock goes on', () => {
        vi.setSystemTime(new Date(2026, 10, 7, 8, 0, 0));
        render(<StatsCard />);
        expect(screen.getByTestId('home-stats').querySelector('.stats__greeting')).toHaveTextContent('Good morning');
        act(() => {
            vi.setSystemTime(new Date(2026, 10, 7, 20, 0, 0));
            vi.advanceTimersByTime(5000);
        });
        expect(screen.getByTestId('home-stats').querySelector('.stats__greeting')).toHaveTextContent('Good evening');
    });

    it('starts with zeros, and has no achievements', () => {
        render(<StatsCard />);
        expect(numbers()).toEqual({ downloads: '0', watched: '0', read: '0', streak: '0' });
        expect(screen.getByTestId('home-stats').querySelector('ul')).toBeNull();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('counts the downloads, the episodes watched and the chapters read of the week, and the days in a row', () => {
        useAppStore.setState({
            history: [
                { id: 'a', url: 'u', title: 'A', filePath: null, status: 'done', errorTitle: null, finishedAt: at(0) },
                { id: 'b', url: 'u', title: 'B', filePath: null, status: 'done', errorTitle: null, finishedAt: at(1) },
                { id: 'c', url: 'u', title: 'C', filePath: null, status: 'error', errorTitle: 'x', finishedAt: at(1) }
            ]
        });
        useAnimeStore.setState({ history: [makeAnimeHistory({ id: 1, openedAt: at(2) }), makeAnimeHistory({ id: 2, openedAt: at(2, 10), episode: null })] });
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ id: 1 })], { id: 1 })],
            history: [makeReading({ id: 1, readAt: at(0, 8), sourceId: 'safe' })],
            browse: { ...initialManga.browse, sources: [makeSource({ id: 'safe', contentWarning: 'SAFE' })], sourcesStatus: 'ready' }
        });
        render(<StatsCard />);
        expect(numbers()).toEqual({ downloads: '2', watched: '1', read: '1', streak: '3' });
    });

    it('draws the numbers as terms and definitions', () => {
        render(<StatsCard />);
        const card = screen.getByTestId('home-stats');
        expect(
            Array.from(card.querySelectorAll('dt')).map((term) => {
                return term.textContent;
            })
        ).toEqual(['Downloads', 'Episodes watched', 'Chapters read', 'Days in a row']);
    });
});
