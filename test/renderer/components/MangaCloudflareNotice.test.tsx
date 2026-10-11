// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaCloudflareNotice } from '@renderer/components/MangaCloudflareNotice';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, cloudflare: [] });
});

describe('MangaCloudflareNotice', () => {
    it('shows nothing while no check of Cloudflare is going on', () => {
        const { container } = render(<MangaCloudflareNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says which site is being checked, politely, with a bar that is not a percentage', () => {
        useMangaStore.setState({ cloudflare: [{ id: 1, host: 'manganato.com', startedAt: 1 }] });
        render(<MangaCloudflareNotice />);
        const notice = screen.getByRole('status');
        expect(notice).toHaveAttribute('aria-live', 'polite');
        expect(notice).toHaveTextContent('Passing the Cloudflare check of manganato.com… this can take up to a minute.');
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveClass('progress--cloudflare');
        expect(bar).not.toHaveAttribute('aria-valuenow');
    });

    it('lists the sites once each when several checks go on', () => {
        useMangaStore.setState({
            cloudflare: [
                { id: 1, host: 'manganato.com', startedAt: 1 },
                { id: 2, host: 'manhwaread.com', startedAt: 2 },
                { id: 3, host: 'manganato.com', startedAt: 3 }
            ]
        });
        render(<MangaCloudflareNotice />);
        expect(screen.getByRole('status')).toHaveTextContent('Passing the Cloudflare check of manganato.com, manhwaread.com…');
    });

    it('says it without a site when the site is not known', () => {
        useMangaStore.setState({ cloudflare: [{ id: 1, host: '', startedAt: 1 }] });
        render(<MangaCloudflareNotice />);
        expect(screen.getByRole('status')).toHaveTextContent('Passing a Cloudflare check… this can take up to a minute.');
    });

    it('goes away when the check ends', () => {
        useMangaStore.setState({ cloudflare: [{ id: 1, host: 'manganato.com', startedAt: 1 }] });
        const { container, rerender } = render(<MangaCloudflareNotice />);
        useMangaStore.setState({ cloudflare: [] });
        rerender(<MangaCloudflareNotice />);
        expect(container).toBeEmptyDOMElement();
    });
});
