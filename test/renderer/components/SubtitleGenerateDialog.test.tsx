// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeSubtitleTrack, SubtitleGenerateEstimateResponse, SubtitleGenerateResponse } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SubtitleGenerateDialog } from '@renderer/components/SubtitleGenerateDialog';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();

const ESTIMATE: SubtitleGenerateEstimateResponse = { ok: true, seconds: 24 * 60 + 3.52, parts: 3, approxBytes: 5_774_080 };
const AUDIO_TEXT = '24 min · about 5.5 MiB · 3 requests';
const GENERATED_TRACK: AnimeSubtitleTrack = { id: 'generated-Spanish', label: 'Spanish', kind: 'generated' };
const GENERATED: SubtitleGenerateResponse = { ok: true, tracks: [GENERATED_TRACK], generated: GENERATED_TRACK };
const MIB = 1024 * 1024;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({
        ...initialApp,
        settings: {
            ...DEFAULT_SETTINGS,
            transcribeProvider: 'openai',
            transcribeModel: 'whisper-1',
            translateProvider: 'anthropic',
            translateModel: 'my-model',
            translateLanguage: 'Spanish'
        }
    });
    mock.api.estimateAnimeSubtitleGeneration.mockResolvedValue(ESTIMATE);
});

function renderDialog() {
    const onGenerated = vi.fn();
    const onClose = vi.fn();
    render(<SubtitleGenerateDialog episodeId={7} onGenerated={onGenerated} onClose={onClose} />);
    return { onGenerated, onClose };
}

async function ready() {
    const result = renderDialog();
    await screen.findByText(AUDIO_TEXT);
    return result;
}

function optionValues(label: string): string[] {
    return Array.from(screen.getByLabelText(label).querySelectorAll('option')).map((option) => {
        return option.value;
    });
}

function facts(): HTMLElement {
    return screen.getByRole('region', { name: 'What will be sent' });
}

describe('SubtitleGenerateDialog: the choices', () => {
    it('opens a dialog that says what it does and that the audio is sent to the services of the settings', async () => {
        renderDialog();
        const dialog = screen.getByRole('dialog', { name: 'Create a subtitle' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'Create a subtitle' })).toBeInTheDocument();
        expect(screen.getByText('Choose the language spoken in the episode and the language you want to read. The subtitle is written from the audio, which is sent to the services you set up in the anime settings.')).toBeInTheDocument();
        await screen.findByText(AUDIO_TEXT);
    });

    it('asks which language is spoken in the audio, starting with Japanese since it is not a setting, and which one the subtitle is wanted in, starting with the one of the settings', async () => {
        await ready();
        expect(screen.getByLabelText('Language of the audio')).toHaveValue('Japanese');
        expect(screen.getByLabelText('Language of the subtitle')).toHaveValue('Spanish');
        expect(optionValues('Language of the audio')).toEqual(['Japanese', 'English', 'Chinese', 'Korean', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Russian', 'Arabic', 'Turkish', 'Indonesian']);
        expect(optionValues('Language of the subtitle')).toEqual(['Portuguese (Brazil)', 'Portuguese', 'Spanish', 'English', 'French', 'German', 'Italian', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Turkish', 'Indonesian']);
    });

    it('puts an arrow between the two choices, for the eyes only', async () => {
        await ready();
        const arrow = screen.getByText('→');
        expect(arrow).toHaveAttribute('aria-hidden', 'true');
        expect(arrow).toHaveClass('generate__arrow');
    });

    describe('saying how the subtitle will be made', () => {
        it('says the audio is transcribed and the text translated, when the languages are different', async () => {
            await ready();
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio is transcribed in Japanese, then the text is translated into Spanish.');
        });

        it('says the audio is only transcribed, when it is spoken in the language of the subtitle', async () => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'Japanese');
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio is transcribed in Japanese.');
        });

        it('takes Brazilian Portuguese for a subtitle of Portuguese audio', async () => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the audio'), 'Portuguese');
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'Portuguese (Brazil)');
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio is transcribed in Portuguese.');
        });

        it('says the service translates the audio into English at once, when the subtitle is wanted in English', async () => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'English');
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio, spoken in Japanese, is written in English at once by the speech service.');
        });

        it('only transcribes English audio for an English subtitle', async () => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the audio'), 'English');
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'English');
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio is transcribed in English.');
        });
    });

    describe('when the speech service is Gemini, which can write the audio in any language at once', () => {
        beforeEach(() => {
            useAppStore.setState({
                settings: { ...useAppStore.getState().settings, transcribeProvider: 'gemini', transcribeModel: 'a-gemini-model' }
            });
        });

        it('says the audio is written in the language of the subtitle at once, not only when it is English', async () => {
            await ready();
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio, spoken in Japanese, is written in Spanish at once by the speech service.');
        });

        it('shows no translation service, since the text is not translated afterwards, and names Gemini as the one that gets the audio', async () => {
            await ready();
            const card = within(facts());
            expect(card.queryByText('Translation (the text only)')).not.toBeInTheDocument();
            expect(card.getByText('Gemini (Google) · a-gemini-model')).toBeInTheDocument();
        });

        it('shows the steps with no translation of the text, and names the sending after the language of the subtitle', async () => {
            const user = userEvent.setup();
            mock.api.generateAnimeSubtitle.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            await ready();
            await user.click(screen.getByRole('button', { name: 'CREATE' }));
            const panel = screen.getByRole('region', { name: 'Progress' });
            expect(within(panel).getAllByRole('listitem')).toHaveLength(3);
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 0, total: 3, reason: null, phase: 'sending', plan: 'direct', sentBytes: 0, totalBytes: 6 * MIB });
            });
            expect(within(panel).getByText(/Sending the audio and receiving the subtitle in Spanish/)).toBeInTheDocument();
        });

        it('still only transcribes when the subtitle is in the language that is spoken', async () => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'Japanese');
            expect(screen.getByTestId('generate-plan')).toHaveTextContent('The audio is transcribed in Japanese.');
        });

        it('asks for the request with the languages chosen, whatever the plan is', async () => {
            const user = userEvent.setup();
            mock.api.generateAnimeSubtitle.mockResolvedValue(GENERATED);
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'Portuguese (Brazil)');
            await user.click(screen.getByRole('button', { name: 'CREATE' }));
            expect(mock.api.generateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 7, audioLanguage: 'Japanese', language: 'Portuguese (Brazil)' });
        });
    });

    describe('what will be sent', () => {
        it('says that only the audio is sent, never the video, how much of it, and to which service', async () => {
            await ready();
            const card = within(facts());
            expect(card.getByText('Only the audio of the episode is sent, never the video.')).toBeInTheDocument();
            expect(card.getByText('Audio')).toBeInTheDocument();
            expect(card.getByTestId('generate-estimate')).toHaveTextContent(AUDIO_TEXT);
            expect(card.getByText('Speech to text')).toBeInTheDocument();
            expect(card.getByText('OpenAI (Whisper) · whisper-1')).toBeInTheDocument();
            expect(card.getByText('Each service charges your account. The cost depends on the length of the episode.')).toBeInTheDocument();
        });

        it('shows the translation service too, when the text is translated afterwards, and says it is only the text that goes to it', async () => {
            await ready();
            const card = within(facts());
            expect(card.getByText('Translation (the text only)')).toBeInTheDocument();
            expect(card.getByText('Claude (Anthropic) · my-model')).toBeInTheDocument();
        });

        it.each([
            ['the audio is only transcribed', 'Japanese'],
            ['the service translates the audio into English at once', 'English']
        ])('does not show a translation service when %s', async (_name, language) => {
            const user = userEvent.setup();
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), language);
            expect(within(facts()).queryByText('Translation (the text only)')).not.toBeInTheDocument();
        });

        it('shows a dash for a model that is not set, and names the service of one\'s own', async () => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, transcribeProvider: 'custom', transcribeModel: '', translateProvider: 'custom', translateModel: '', translateLanguage: 'Spanish' } });
            await ready();
            expect(within(facts()).getAllByText('Other (OpenAI-compatible) · —')).toHaveLength(2);
        });

        it('says it is measuring the audio, then shows its minutes, size and requests, and only then offers CREATE', async () => {
            let answer: (value: SubtitleGenerateEstimateResponse) => void = () => {
                return undefined;
            };
            mock.api.estimateAnimeSubtitleGeneration.mockReturnValue(new Promise((resolve) => {
                answer = resolve;
            }));
            renderDialog();
            expect(within(facts()).getByText('Measuring the audio…')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CREATE' })).toBeDisabled();
            await act(async () => {
                answer(ESTIMATE);
            });
            expect(within(facts()).getByText(AUDIO_TEXT)).toBeInTheDocument();
            expect(screen.queryByText('Measuring the audio…')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CREATE' })).toBeEnabled();
            expect(mock.api.estimateAnimeSubtitleGeneration).toHaveBeenCalledTimes(1);
            expect(mock.api.estimateAnimeSubtitleGeneration).toHaveBeenCalledWith(7);
        });

        it.each([
            [5, 20_000, 1, '1 min · about 19.5 KiB · 1 requests'],
            [90, 360_000, 1, '2 min · about 351.6 KiB · 1 requests'],
            [3600, 14_400_000, 6, '60 min · about 13.7 MiB · 6 requests']
        ])('rounds %i seconds to whole minutes, with at least one, and writes the bytes in the unit that fits', async (seconds, approxBytes, parts, text) => {
            mock.api.estimateAnimeSubtitleGeneration.mockResolvedValue({ ok: true, seconds, parts, approxBytes });
            renderDialog();
            expect(await screen.findByText(text)).toBeInTheDocument();
        });

        it.each([
            ['missing', 'The video of this episode is not on the disk, so its subtitle cannot be created.'],
            ['no-audio', 'This video has no audio to transcribe.'],
            ['extract-failed', 'The audio could not be taken out of the video.']
        ] as const)('says why it could not be measured ("%s") and keeps CREATE off', async (reason, text) => {
            mock.api.estimateAnimeSubtitleGeneration.mockResolvedValue({ ok: false, reason });
            renderDialog();
            expect(await screen.findByText(text)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CREATE' })).toBeDisabled();
        });
    });

    it('moves the focus into the dialog and gives it back when it closes', async () => {
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        const { unmount } = render(<SubtitleGenerateDialog episodeId={7} onGenerated={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByLabelText('Language of the audio')).toHaveFocus();
        await screen.findByText(AUDIO_TEXT);
        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });
});

describe('SubtitleGenerateDialog: creating', () => {
    it('asks for the subtitle with the two languages chosen and gives the new subtitles when it is done', async () => {
        const user = userEvent.setup();
        mock.api.generateAnimeSubtitle.mockResolvedValue(GENERATED);
        const { onGenerated, onClose } = await ready();
        await user.selectOptions(screen.getByLabelText('Language of the audio'), 'Japanese');
        await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'French');
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        expect(mock.api.generateAnimeSubtitle).toHaveBeenCalledTimes(1);
        expect(mock.api.generateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 7, audioLanguage: 'Japanese', language: 'French' });
        await vi.waitFor(() => {
            expect(onGenerated).toHaveBeenCalledTimes(1);
        });
        expect(onGenerated).toHaveBeenCalledWith([GENERATED_TRACK], GENERATED_TRACK);
        expect(onClose).not.toHaveBeenCalled();
    });

    describe('while it goes on', () => {
        async function started() {
            const user = userEvent.setup();
            let finish: (value: SubtitleGenerateResponse) => void = () => {
                return undefined;
            };
            mock.api.generateAnimeSubtitle.mockReturnValue(new Promise((resolve) => {
                finish = resolve;
            }));
            const handlers = await ready();
            await user.click(screen.getByRole('button', { name: 'CREATE' }));
            return { user, finish, ...handlers };
        }

        it('shows the progress at once, waiting for its turn, with every step waiting', async () => {
            await started();
            const panel = screen.getByRole('region', { name: 'Progress' });
            expect(within(panel).getByText('Waiting for its turn…')).toBeInTheDocument();
            expect(within(panel).getAllByRole('listitem')).toHaveLength(4);
            expect(within(panel).getByRole('progressbar', { name: 'Progress of the subtitle' })).toHaveAttribute('aria-valuenow', '0');
        });

        it('turns the choices off, replaces CREATE by CANCEL and does not let the dialog be closed', async () => {
            await started();
            expect(screen.getByLabelText('Language of the audio')).toBeDisabled();
            expect(screen.getByLabelText('Language of the subtitle')).toBeDisabled();
            expect(screen.queryByRole('button', { name: 'CREATE' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CANCEL' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'CLOSE' })).toBeDisabled();
        });

        it('follows each step of the job: the audio, the parts that were sent with their bytes, the translation and the saving', async () => {
            await started();
            const panel = (): HTMLElement => {
                return screen.getByRole('region', { name: 'Progress' });
            };
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 0, total: 1, reason: null, phase: 'extracting', plan: 'transcribe-translate' });
            });
            expect(within(panel()).getByText('This happens on your computer.')).toBeInTheDocument();
            expect(within(panel()).getByTestId('generate-elapsed')).toHaveTextContent('Elapsed time: 00:00');

            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 1, total: 3, reason: null, phase: 'sending', plan: 'transcribe-translate', sentBytes: 2 * MIB, totalBytes: 6 * MIB });
            });
            expect(within(panel()).getByText('Part 1 of 3 · 2.0 MiB of 6.0 MiB sent')).toBeInTheDocument();
            expect(within(panel()).getByText('3 parts, 6.0 MiB')).toBeInTheDocument();
            expect(within(panel()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '22');

            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 60, total: 120, reason: null, phase: 'translating', plan: 'transcribe-translate', sentBytes: 6 * MIB, totalBytes: 6 * MIB });
            });
            expect(within(panel()).getByText('Line 60 of 120')).toBeInTheDocument();
            expect(within(panel()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');

            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 0, total: 1, reason: null, phase: 'saving', plan: 'transcribe-translate', sentBytes: 6 * MIB, totalBytes: 6 * MIB });
            });
            expect(within(panel()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '95');
            expect(within(panel()).getAllByText(/\(Done\)/)).toHaveLength(3);
        });

        it('ignores the progress of other episodes', async () => {
            await started();
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 8, language: 'Spanish', status: 'running', done: 2, total: 5, reason: null, phase: 'sending', plan: 'transcribe-translate', sentBytes: MIB, totalBytes: 6 * MIB });
            });
            expect(screen.getByText('Waiting for its turn…')).toBeInTheDocument();
            expect(screen.queryByText(/of 6.0 MiB sent/)).not.toBeInTheDocument();
        });

        it('warns, and shows the translation service, when the service did not translate the audio at once and it is transcribed instead', async () => {
            const user = userEvent.setup();
            mock.api.generateAnimeSubtitle.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            await ready();
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'English');
            expect(within(facts()).queryByText('Translation (the text only)')).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'CREATE' }));
            expect(screen.queryByText('The service does not translate the audio directly, so it is being transcribed first and the text translated afterwards.')).not.toBeInTheDocument();
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'English', status: 'running', done: 0, total: 3, reason: null, phase: 'sending', plan: 'transcribe-translate', sentBytes: 0, totalBytes: 6 * MIB });
            });
            expect(screen.getByText('The service does not translate the audio directly, so it is being transcribed first and the text translated afterwards.')).toBeInTheDocument();
            expect(within(facts()).getByText('Translation (the text only)')).toBeInTheDocument();
            expect(within(screen.getByRole('region', { name: 'Progress' })).getAllByRole('listitem')).toHaveLength(4);
        });

        it('does not warn when the plan is the one that was chosen', async () => {
            await started();
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 0, total: 3, reason: null, phase: 'sending', plan: 'transcribe-translate', sentBytes: 0, totalBytes: 6 * MIB });
            });
            expect(screen.queryByText(/does not translate the audio directly/)).not.toBeInTheDocument();
        });

        it('cancels the subtitle of this episode', async () => {
            const { user } = await started();
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));
            expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledTimes(1);
            expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledWith(7);
        });

        it('takes the progress away and offers CREATE again when it ends', async () => {
            const { finish, onGenerated } = await started();
            act(() => {
                mock.emitSubtitleGeneration({ episodeId: 7, language: 'Spanish', status: 'running', done: 1, total: 3, reason: null, phase: 'sending', plan: 'transcribe-translate', sentBytes: 2 * MIB, totalBytes: 6 * MIB });
            });
            await act(async () => {
                finish(GENERATED);
            });
            expect(onGenerated).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('region', { name: 'Progress' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CREATE' })).toBeEnabled();
            expect(screen.getByLabelText('Language of the audio')).toBeEnabled();
        });
    });

    it('says nothing when it was cancelled, and goes back to offering CREATE', async () => {
        const user = userEvent.setup();
        mock.api.generateAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'cancelled' });
        const { onGenerated } = await ready();
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'CREATE' })).toBeEnabled();
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onGenerated).not.toHaveBeenCalled();
    });

    it.each([
        [{ ok: false, reason: 'no-token' }, 'There is no token for this service. Add one in the anime settings.'],
        [{ ok: false, reason: 'no-model' }, 'No model is set. Write the name of the model in the anime settings.'],
        [{ ok: false, reason: 'no-address' }, 'This service needs an address. Write it in the anime settings.'],
        [{ ok: false, reason: 'no-translation-token' }, 'There is no token for the translation. Add one in the anime settings.'],
        [{ ok: false, reason: 'no-translation-model' }, 'No model is set for the translation. Write the name of the model in the anime settings.'],
        [{ ok: false, reason: 'no-translation-address' }, 'The translation provider needs an address. Write it in the anime settings.'],
        [{ ok: false, reason: 'no-audio' }, 'This video has no audio to transcribe.'],
        [{ ok: false, reason: 'no-speech' }, 'No speech was recognized in the audio, so no subtitle was created.'],
        [{ ok: false, reason: 'extract-failed' }, 'The audio could not be taken out of the video.'],
        [{ ok: false, reason: 'unreadable' }, 'The subtitle file could not be saved.'],
        [{ ok: false, reason: 'busy' }, 'This episode is being worked on already.'],
        [{ ok: false, reason: 'missing' }, 'The video of this episode is not on the disk, so its subtitle cannot be created.'],
        [{ ok: false, reason: 'failed', error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } }, 'The subtitle could not be created. The account has no credit or quota left.']
    ] as const)('says why when it did not work (%j), takes the progress away and lets the user try again', async (response, text) => {
        const user = userEvent.setup();
        mock.api.generateAnimeSubtitle.mockResolvedValue(response);
        const { onGenerated } = await ready();
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(text);
        expect(screen.getByRole('button', { name: 'CREATE' })).toBeEnabled();
        expect(screen.queryByRole('region', { name: 'Progress' })).not.toBeInTheDocument();
        expect(onGenerated).not.toHaveBeenCalled();
    });

    it('clears the message when it tries again', async () => {
        const user = userEvent.setup();
        mock.api.generateAnimeSubtitle.mockResolvedValueOnce({ ok: false, reason: 'no-token' });
        mock.api.generateAnimeSubtitle.mockReturnValueOnce(new Promise(() => {
            return undefined;
        }));
        await ready();
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        await screen.findByRole('alert');
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('SubtitleGenerateDialog: closing', () => {
    it('closes with the CLOSE button', async () => {
        const user = userEvent.setup();
        const { onClose } = await ready();
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes with Esc, without the player behind hearing it', async () => {
        const { onClose } = await ready();
        const onWindowKey = vi.fn();
        window.addEventListener('keydown', onWindowKey);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        window.removeEventListener('keydown', onWindowKey);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onWindowKey).not.toHaveBeenCalled();
    });

    it('does not close with Esc while it is working: the way out is to cancel', async () => {
        const user = userEvent.setup();
        mock.api.generateAnimeSubtitle.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        const { onClose } = await ready();
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps Tab inside the dialog, from the last control to the first and back', async () => {
        await ready();
        const dialog = screen.getByRole('dialog');
        const first = screen.getByLabelText('Language of the audio');
        const last = screen.getByRole('button', { name: 'CLOSE' });
        last.focus();
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(first).toHaveFocus();
        fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
    });

    it('does not show an estimate that arrives after the dialog was closed, and stops listening for the progress', async () => {
        let answer: (value: SubtitleGenerateEstimateResponse) => void = () => {
            return undefined;
        };
        mock.api.estimateAnimeSubtitleGeneration.mockReturnValue(new Promise((resolve) => {
            answer = resolve;
        }));
        const { unmount } = render(<SubtitleGenerateDialog episodeId={7} onGenerated={vi.fn()} onClose={vi.fn()} />);
        expect(mock.api.onSubtitleGenerationUpdate).toHaveBeenCalledTimes(1);
        unmount();
        expect(mock.unsubscribers[0]).toHaveBeenCalledTimes(1);
        answer(ESTIMATE);
        await Promise.resolve();
        expect(screen.queryByText(AUDIO_TEXT)).not.toBeInTheDocument();
    });
});
