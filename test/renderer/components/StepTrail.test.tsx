// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { createTranslator } from '@shared/i18n';
import type { JobStatus } from '@shared/types';
import { StepTrail } from '@renderer/components/StepTrail';

const t = createTranslator('en');
const pt = createTranslator('pt');

// What each step of the trail shows: its name, its state and whether it is the step going on.
function stepsOf(container: HTMLElement): Array<[string, string | null, string | null, string]> {
    return Array.from(container.querySelectorAll<HTMLElement>('.steps__item')).map((item) => {
        const name = item.querySelector<HTMLElement>('.steps__name');
        return [name?.textContent || name?.getAttribute('data-text') || '', item.getAttribute('data-state'), item.getAttribute('aria-current'), item.className];
    });
}

describe('StepTrail', () => {
    it('lists the download, done, then each step that started, the last one going on while the download runs', () => {
        const { container } = render(<StepTrail steps={['Merger', 'Metadata']} status="running" t={t} />);
        const trail = screen.getByRole('list', { name: 'Steps of the download' });
        expect(trail.tagName).toBe('OL');
        expect(trail.className).toBe('steps');
        expect(trail.getAttribute('data-testid')).toBe('job-steps');
        expect(stepsOf(container)).toEqual([
            ['Download', 'done', null, 'steps__item steps__item--done'],
            ['Join', 'done', null, 'steps__item steps__item--done'],
            ['Metadata', 'now', 'step', 'steps__item steps__item--now']
        ]);
    });

    it('ticks every step once the download is complete', () => {
        const { container } = render(<StepTrail steps={['Merger', 'MoveFiles']} status="done" t={t} />);
        expect(stepsOf(container)).toEqual([
            ['Download', 'done', null, 'steps__item steps__item--done'],
            ['Join', 'done', null, 'steps__item steps__item--done'],
            ['Move', 'done', null, 'steps__item steps__item--done']
        ]);
    });

    it('shows nothing before any step started', () => {
        const { container } = render(<StepTrail steps={[]} status="running" t={t} />);
        expect(container.innerHTML).toBe('');
    });

    it.each(['error', 'cancelled', 'paused', 'queued'] as JobStatus[])('shows nothing for a download that is %s: the step it stopped at was not done', (status) => {
        const { container } = render(<StepTrail steps={['Merger']} status={status} t={t} />);
        expect(container.innerHTML).toBe('');
    });

    it('draws the names of the steps in the banner, which repeats the card', () => {
        const { container } = render(<StepTrail steps={['Merger']} status="running" t={t} drawn />);
        expect(Array.from(container.querySelectorAll('.steps__name')).map((name) => {
            return [name.className, name.getAttribute('data-text'), name.textContent];
        })).toEqual([
            ['drawn steps__name', 'Download', ''],
            ['drawn steps__name', 'Join', '']
        ]);
    });

    it('speaks the language of the app', () => {
        const { container } = render(<StepTrail steps={['Merger', 'FixupM3u8']} status="running" t={pt} />);
        expect(screen.getByRole('list', { name: 'Etapas do download' })).toBeTruthy();
        expect(stepsOf(container).map(([name]) => {
            return name;
        })).toEqual(['Download', 'Juntar', 'Corrigir']);
    });
});
