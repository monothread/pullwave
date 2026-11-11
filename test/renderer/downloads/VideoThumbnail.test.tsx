// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { VideoThumbnail } from '@renderer/downloads/VideoThumbnail';

describe('VideoThumbnail', () => {
    it('shows the picture the app serves, as a cover, for the eye only and not to be dragged', () => {
        const { container } = render(<VideoThumbnail src="pullwave-thumb://job/job-1?v=2" />);
        const picture = container.querySelector('img');
        expect(picture).toHaveAttribute('src', 'pullwave-thumb://job/job-1?v=2');
        expect(picture).toHaveAttribute('class', 'cover download-hero__thumbnail');
        expect(picture).toHaveAttribute('alt', '');
        expect(picture).toHaveAttribute('draggable', 'false');
        expect(container.querySelector('.tile__generated')).toBeNull();
    });

    it('gives way to the picture of the section when the picture cannot be shown', () => {
        const { container } = render(<VideoThumbnail src="pullwave-thumb://job/gone?v=1" />);
        fireEvent.error(container.querySelector('img') as HTMLImageElement);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.tile__generated svg')).toHaveClass('section-icon--downloads');
    });
});
