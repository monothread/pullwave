// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import type { SubtitleGenerationJob } from '@shared/anime';
import { GenerateProgressPanel } from '@renderer/components/GenerateProgressPanel';

const MIB = 1024 * 1024;

function job(overrides: Partial<SubtitleGenerationJob> = {}): SubtitleGenerationJob {
    return { episodeId: 7, language: 'Spanish', status: 'running', done: 0, total: 0, reason: null, ...overrides };
}

function renderPanel(props: Partial<Parameters<typeof GenerateProgressPanel>[0]> = {}) {
    return render(<GenerateProgressPanel plan="transcribe-translate" job={null} language="Spanish" parts={3} approxBytes={6 * MIB} {...props} />);
}

function steps(): HTMLElement[] {
    return within(screen.getByRole('list')).getAllByRole('listitem');
}

function stepTexts(): string[] {
    return steps().map((step) => {
        return step.textContent ?? '';
    });
}

describe('GenerateProgressPanel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('while the job waits for its turn', () => {
        it.each([
            ['it has not been told of yet', null],
            ['it is queued', job({ status: 'queued' })]
        ])('says so, and shows every step as waiting, when %s', (_name, current) => {
            renderPanel({ job: current });
            expect(screen.getByText('Waiting for its turn…')).toBeInTheDocument();
            expect(screen.queryByText(/Elapsed time/)).not.toBeInTheDocument();
            expect(stepTexts()).toEqual([
                'Taking the audio out of the video (Waiting)',
                'Sending the audio and receiving the text (Waiting)',
                'Translating the text into Spanish (Waiting)',
                'Saving the subtitle next to the video (Waiting)'
            ]);
            expect(screen.getByRole('progressbar', { name: 'Progress of the subtitle' })).toHaveAttribute('aria-valuenow', '0');
        });
    });

    it('has a region and a bar that tell the percentage, to the screen readers and to the eyes', () => {
        renderPanel({ job: job({ phase: 'sending', done: 1, total: 2, sentBytes: 3 * MIB, totalBytes: 6 * MIB }) });
        expect(screen.getByRole('region', { name: 'Progress' })).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Progress of the subtitle' });
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-valuenow', '30');
        expect(bar.firstElementChild).toHaveStyle({ width: '30%' });
    });

    it('shows the audio being taken out of the video as going on, and says it happens on the computer', () => {
        renderPanel({ job: job({ phase: 'extracting', plan: 'transcribe-translate', done: 0, total: 1 }) });
        expect(stepTexts()[0]).toBe('Taking the audio out of the video (In progress)This happens on your computer.');
        expect(steps()[0]).toHaveAttribute('aria-current', 'step');
        expect(steps()[0]).toHaveClass('generate__step--active');
        expect(steps()[0]?.querySelector('.generate__spinner')).not.toBeNull();
        expect(steps()[1]).not.toHaveAttribute('aria-current');
    });

    it('shows how many parts were sent and answered and how many bytes of audio went, with the audio that is ready as done', () => {
        renderPanel({ job: job({ phase: 'sending', plan: 'transcribe-translate', done: 1, total: 3, sentBytes: 2 * MIB, totalBytes: 6 * MIB }) });
        expect(stepTexts()).toEqual([
            '✓Taking the audio out of the video (Done)3 parts, 6.0 MiB',
            'Sending the audio and receiving the text (In progress)Part 1 of 3 · 2.0 MiB of 6.0 MiB sent',
            'Translating the text into Spanish (Waiting)',
            'Saving the subtitle next to the video (Waiting)'
        ]);
        expect(steps()[0]).toHaveClass('generate__step--done');
        expect(steps()[0]).toHaveTextContent('✓');
        expect(steps()[0]?.querySelector('.generate__spinner')).toBeNull();
    });

    it('says nothing sent yet at the start of the parts', () => {
        renderPanel({ job: job({ phase: 'sending', plan: 'transcribe-translate', done: 0, total: 3, sentBytes: 0, totalBytes: 6 * MIB }) });
        expect(stepTexts()[1]).toBe('Sending the audio and receiving the text (In progress)Part 0 of 3 · 0 B of 6.0 MiB sent');
    });

    it('uses the size the measure of the audio gave when the job did not say it yet', () => {
        renderPanel({ approxBytes: 9 * MIB, job: job({ phase: 'sending', plan: 'transcribe-translate', done: 0, total: 3 }) });
        expect(stepTexts()[1]).toBe('Sending the audio and receiving the text (In progress)Part 0 of 3 · 0 B of 9.0 MiB sent');
        expect(stepTexts()[0]).toContain('3 parts, 9.0 MiB');
    });

    it('shows how many lines were translated, with the parts that were sent as all sent', () => {
        renderPanel({ job: job({ phase: 'translating', plan: 'transcribe-translate', done: 40, total: 120, sentBytes: 6 * MIB, totalBytes: 6 * MIB }) });
        expect(stepTexts()).toEqual([
            '✓Taking the audio out of the video (Done)3 parts, 6.0 MiB',
            '✓Sending the audio and receiving the text (Done)Part 3 of 3 · 6.0 MiB of 6.0 MiB sent',
            'Translating the text into Spanish (In progress)Line 40 of 120',
            'Saving the subtitle next to the video (Waiting)'
        ]);
    });

    it('shows the saving as going on, with everything before it done', () => {
        renderPanel({ job: job({ phase: 'saving', plan: 'transcribe-translate', done: 0, total: 1, sentBytes: 6 * MIB, totalBytes: 6 * MIB }) });
        expect(
            steps().map((step) => {
                return step.className;
            })
        ).toEqual(['generate__step generate__step--done', 'generate__step generate__step--done', 'generate__step generate__step--done', 'generate__step generate__step--active']);
        expect(stepTexts()[3]).toBe('Saving the subtitle next to the video (In progress)');
    });

    describe('the steps of each plan', () => {
        it('has no step of translating the text, and names the sending after the text, when the audio is only transcribed', () => {
            renderPanel({ plan: 'transcribe', job: job({ phase: 'sending', plan: 'transcribe', done: 0, total: 1, sentBytes: 0, totalBytes: MIB }) });
            expect(
                steps().map((step) => {
                    return step.querySelector('.generate__step-label')?.firstChild?.textContent;
                })
            ).toEqual(['Taking the audio out of the video', 'Sending the audio and receiving the text', 'Saving the subtitle next to the video']);
        });

        it('names the sending after the language of the subtitle when the service writes the audio in it at once', () => {
            renderPanel({ plan: 'direct', language: 'English', job: job({ language: 'English', phase: 'sending', plan: 'direct', done: 0, total: 1, sentBytes: 0, totalBytes: MIB }) });
            expect(steps()).toHaveLength(3);
            expect(stepTexts()[1]).toContain('Sending the audio and receiving the subtitle in English (In progress)');
        });

        it('writes the sending in the language of the subtitle, whichever it is, when the audio is written in it at once', () => {
            renderPanel({ plan: 'direct', language: 'Portuguese (Brazil)', job: job({ language: 'Portuguese (Brazil)', phase: 'sending', plan: 'direct', done: 0, total: 1, sentBytes: 0, totalBytes: MIB }) });
            expect(stepTexts()[1]).toContain('Sending the audio and receiving the subtitle in Portuguese (Brazil) (In progress)');
        });

        it('names the language of the subtitle in the step of the translation', () => {
            renderPanel({ language: 'Portuguese (Brazil)' });
            expect(stepTexts()[2]).toBe('Translating the text into Portuguese (Brazil) (Waiting)');
        });
    });

    describe('the time that has passed', () => {
        it('counts from the moment the panel opened, as minutes and seconds, once the job is running', async () => {
            renderPanel({ job: job({ phase: 'extracting', plan: 'transcribe-translate', done: 0, total: 1 }) });
            expect(screen.getByTestId('generate-elapsed')).toHaveTextContent('Elapsed time: 00:00');
            await act(async () => {
                await vi.advanceTimersByTimeAsync(65000);
            });
            expect(screen.getByTestId('generate-elapsed')).toHaveTextContent('Elapsed time: 01:05');
        });

        it('keeps counting while the job waits for its turn, and shows the time when it starts', async () => {
            const { rerender } = renderPanel({ job: null });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(7000);
            });
            expect(screen.getByTestId('generate-elapsed')).toHaveTextContent('Waiting for its turn…');
            rerender(<GenerateProgressPanel plan="transcribe-translate" job={job({ phase: 'extracting', plan: 'transcribe-translate', done: 0, total: 1 })} language="Spanish" parts={3} approxBytes={6 * MIB} />);
            expect(screen.getByTestId('generate-elapsed')).toHaveTextContent('Elapsed time: 00:07');
        });
    });
});
