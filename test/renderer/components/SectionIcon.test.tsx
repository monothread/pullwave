// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { SectionIcon, type SectionIconName } from '@renderer/components/SectionIcon';

const PATHS: Record<SectionIconName, string> = {
    home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
    downloads: 'M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    anime: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 14.5zM10 8.5v4l3.5-2zM8 21h8',
    manga: 'M12 6.5C10.3 5 7.8 4.5 4 4.5v13c3.8 0 6.3.5 8 2 1.7-1.5 4.2-2 8-2v-13c-3.8 0-6.3.5-8 2zm0 0v13',
    settings:
        'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
};

describe('SectionIcon', () => {
    it.each(Object.entries(PATHS) as Array<[SectionIconName, string]>)('draws the %s picture with the colour of the text, hidden from the screen readers', (name, path) => {
        const { container } = render(<SectionIcon name={name} />);
        const svg = container.querySelector('svg') as SVGSVGElement;
        expect(svg).toHaveAttribute('class', `section-icon section-icon--${name}`);
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('focusable', 'false');
        expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
        expect(svg).toHaveAttribute('width', '22');
        expect(svg).toHaveAttribute('height', '22');
        expect(svg).toHaveAttribute('fill', 'none');
        expect(svg).toHaveAttribute('stroke', 'currentColor');
        expect(svg).toHaveAttribute('stroke-width', '2');
        expect(svg).toHaveAttribute('stroke-linecap', 'round');
        expect(svg).toHaveAttribute('stroke-linejoin', 'round');
        const paths = svg.querySelectorAll('path');
        expect(paths).toHaveLength(1);
        expect(paths[0]).toHaveAttribute('d', path);
        expect(svg.textContent).toBe('');
    });
});
