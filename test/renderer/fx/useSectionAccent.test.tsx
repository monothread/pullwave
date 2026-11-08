// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { useSectionAccent } from '@renderer/fx/useSectionAccent';
import type { Tab } from '@renderer/store/appStore';

function Screen({ tab }: { tab: Tab }) {
    useSectionAccent(tab);
    return null;
}

describe('useSectionAccent', () => {
    it('puts the section on <html> and follows it', () => {
        const { rerender } = render(<Screen tab="anime" />);
        expect(document.documentElement.dataset.section).toBe('anime');
        rerender(<Screen tab="manga" />);
        expect(document.documentElement.dataset.section).toBe('manga');
    });

    it('takes it away when the app goes away', () => {
        const { unmount } = render(<Screen tab="home" />);
        unmount();
        expect(document.documentElement.dataset.section).toBeUndefined();
    });
});
