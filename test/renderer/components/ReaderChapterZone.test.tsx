// @vitest-environment jsdom
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { ReaderChapterZone } from '@renderer/components/ReaderChapterZone';
import { useAppStore } from '@renderer/store/appStore';

const initialApp = useAppStore.getState();

beforeEach(() => {
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function zone(props: Partial<React.ComponentProps<typeof ReaderChapterZone>> = {}) {
    const onGo = vi.fn();
    const zoneRef = createRef<HTMLDivElement>();
    const view = render(<ReaderChapterZone edge="end" title="The Great Race" progress={0.4} automatic height={468} onGo={onGo} zoneRef={zoneRef} {...props} />);
    return { ...view, onGo, zoneRef };
}

describe('ReaderChapterZone the zone at the end', () => {
    it('says which chapter comes next, with a bar that shows how far the user is and a hint', () => {
        const { zoneRef } = zone();
        const region = screen.getByRole('region', { name: 'NEXT CHAPTER' });
        expect(region).toHaveClass('reader__zone', 'reader__zone--end');
        expect(region).toHaveAttribute('data-testid', 'reader-zone-end');
        expect(region).toHaveStyle({ height: '468px' });
        expect(zoneRef.current).toBe(region);
        expect(within(region).getByText('The Great Race')).toBeInTheDocument();
        const bar = within(region).getByRole('progressbar', { name: 'Going to the other chapter' });
        expect(bar).toHaveAttribute('aria-valuenow', '40');
        expect(bar.firstElementChild).toHaveStyle({ width: '40%' });
        expect(bar.firstElementChild).toHaveClass('progress__bar', 'progress__bar--smooth');
        expect(within(region).getByText('Keep scrolling to go to the next chapter, or scroll back up to stay.')).toBeInTheDocument();
    });

    it('has a button that goes at once, which is the only way when the chapter does not switch by itself', async () => {
        const user = userEvent.setup();
        const { onGo, unmount } = zone();
        await user.click(screen.getByRole('button', { name: 'GO TO THE NEXT CHAPTER' }));
        expect(onGo).toHaveBeenCalledTimes(1);
        unmount();
        const manual = zone({ automatic: false });
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByText(/Keep scrolling/)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'GO TO THE NEXT CHAPTER' }));
        expect(manual.onGo).toHaveBeenCalledTimes(1);
    });

    it('rounds the progress for the screen readers and fills the bar with the exact one', () => {
        zone({ progress: 0.666 });
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '67');
        expect(bar.firstElementChild).toHaveStyle({ width: '66.60000000000001%' });
    });

    it('only says there is no next chapter when there is none, with no bar and no button', () => {
        zone({ title: null });
        expect(screen.getByText('This is the last chapter.')).toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('ReaderChapterZone the zone at the start', () => {
    it('says which chapter comes before, and has its own hint and button', async () => {
        const user = userEvent.setup();
        const { onGo } = zone({ edge: 'start', title: 'Romance Dawn', progress: 1 });
        const region = screen.getByRole('region', { name: 'PREVIOUS CHAPTER' });
        expect(region).toHaveClass('reader__zone--start');
        expect(region).toHaveAttribute('data-testid', 'reader-zone-start');
        expect(within(region).getByText('Romance Dawn')).toBeInTheDocument();
        expect(within(region).getByText('Keep scrolling up to go to the previous chapter, or scroll back down to stay.')).toBeInTheDocument();
        expect(within(region).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
        await user.click(screen.getByRole('button', { name: 'GO TO THE PREVIOUS CHAPTER' }));
        expect(onGo).toHaveBeenCalledTimes(1);
    });

    it('only says there is no previous chapter when there is none', () => {
        zone({ edge: 'start', title: null });
        expect(screen.getByText('This is the first chapter.')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('ReaderChapterZone in the language of the app', () => {
    it('speaks Portuguese', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        zone();
        expect(screen.getByRole('region', { name: 'PRÓXIMO CAPÍTULO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'IR PARA O PRÓXIMO CAPÍTULO' })).toBeInTheDocument();
    });
});
