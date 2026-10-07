// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { TranslationSettings } from '@renderer/components/TranslationSettings';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
});

async function renderSettings(overrides: Partial<Settings> = {}) {
    const change = vi.fn();
    const edit = vi.fn();
    const changeMany = vi.fn();
    const view = render(<TranslationSettings draft={{ ...DEFAULT_SETTINGS, ...overrides }} change={change} edit={edit} changeMany={changeMany} />);
    await vi.waitFor(() => {
        expect(mock.api.getLlmStatus).toHaveBeenCalled();
    });
    return { change, edit, changeMany, ...view };
}

function optionsOf(label: string): Array<[string, string | null]> {
    return Array.from(screen.getByLabelText(label).querySelectorAll('option')).map((option) => {
        return [option.value, option.textContent];
    });
}

describe('TranslationSettings', () => {
    it('shows the stored values, what the token is for and that it is never shown again', async () => {
        await renderSettings({ translateProvider: 'gemini', translateModel: 'my-model', translateBaseUrl: 'http://x/v1', translateLanguage: 'Korean' });
        expect(screen.getByText('SUBTITLE TRANSLATION (LANGUAGE MODEL)')).toBeInTheDocument();
        expect(screen.getByText('Uses your own account with a provider. The token is kept encrypted on this computer and is never shown again.')).toBeInTheDocument();
        expect(screen.getByLabelText('Provider')).toHaveValue('gemini');
        expect(screen.getByLabelText('Model')).toHaveValue('my-model');
        expect(screen.getByLabelText('Address (optional)')).toHaveValue('http://x/v1');
        expect(screen.getByLabelText('Default language')).toHaveValue('Korean');
        expect(screen.getByText('The name the provider gives the model, as written on its model list.')).toBeInTheDocument();
        expect(screen.getByText('Only to use another address than the one of the provider. Required for "Other".')).toBeInTheDocument();
    });

    it('lists the providers by the names people know and the languages it can translate into', async () => {
        await renderSettings();
        expect(optionsOf('Provider')).toEqual([
            ['openai', 'ChatGPT (OpenAI)'],
            ['anthropic', 'Claude (Anthropic)'],
            ['gemini', 'Gemini (Google)'],
            ['deepseek', 'DeepSeek'],
            ['glm', 'GLM (Zhipu)'],
            ['kimi', 'Kimi (Moonshot)'],
            ['custom', 'Other (OpenAI-compatible)']
        ]);
        expect(optionsOf('Default language').map((option) => {
            return option[0];
        })).toEqual(['Portuguese (Brazil)', 'Portuguese', 'Spanish', 'English', 'French', 'German', 'Italian', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Turkish', 'Indonesian']);
    });

    it.each([
        ['openai', 'https://api.openai.com/v1'],
        ['anthropic', 'https://api.anthropic.com/v1'],
        ['gemini', 'https://generativelanguage.googleapis.com/v1beta'],
        ['deepseek', 'https://api.deepseek.com'],
        ['glm', 'https://open.bigmodel.cn/api/paas/v4'],
        ['kimi', 'https://api.moonshot.ai/v1'],
        ['custom', '']
    ] as const)('suggests the address of %s in the field of the address', async (translateProvider, address) => {
        await renderSettings({ translateProvider });
        expect(screen.getByLabelText('Address (optional)')).toHaveAttribute('placeholder', address);
    });

    it('saves the choices of the menus right away and the texts as they are typed', async () => {
        const { change, edit } = await renderSettings();
        fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'deepseek' } });
        expect(change).toHaveBeenLastCalledWith('translateProvider', 'deepseek');
        fireEvent.change(screen.getByLabelText('Default language'), { target: { value: 'French' } });
        expect(change).toHaveBeenLastCalledWith('translateLanguage', 'French');
        fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'chat-1' } });
        expect(edit).toHaveBeenLastCalledWith('translateModel', 'chat-1');
        fireEvent.change(screen.getByLabelText('Address (optional)'), { target: { value: 'http://localhost:1234/v1' } });
        expect(edit).toHaveBeenLastCalledWith('translateBaseUrl', 'http://localhost:1234/v1');
        expect(change).toHaveBeenCalledTimes(2);
        expect(edit).toHaveBeenCalledTimes(2);
    });

    describe('the token', () => {
        it('says there is none for the provider, and has no button to remove one', async () => {
            await renderSettings();
            expect(screen.getByText('No token is saved for this provider.')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'REMOVE TOKEN' })).not.toBeInTheDocument();
            expect(screen.getByLabelText('Token (API key)')).toHaveValue('');
        });

        it('hides what is typed, as a password, without letting the browser fill it in', async () => {
            await renderSettings();
            const field = screen.getByLabelText('Token (API key)');
            expect(field).toHaveAttribute('type', 'password');
            expect(field).toHaveAttribute('autocomplete', 'off');
            expect(field).toHaveAttribute('spellcheck', 'false');
        });

        it('keeps SAVE TOKEN off until something is typed', async () => {
            const user = userEvent.setup();
            await renderSettings();
            expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeDisabled();
            await user.type(screen.getByLabelText('Token (API key)'), '   ');
            expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeDisabled();
            await user.type(screen.getByLabelText('Token (API key)'), 'sk-1');
            expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeEnabled();
        });

        it('sends the token of the provider to the app, empties the field and says it is saved', async () => {
            const user = userEvent.setup();
            await renderSettings({ translateProvider: 'anthropic' });
            mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['anthropic'] });
            await user.type(screen.getByLabelText('Token (API key)'), 'sk-ant-1');
            await user.click(screen.getByRole('button', { name: 'SAVE TOKEN' }));
            expect(mock.api.setLlmToken).toHaveBeenCalledTimes(1);
            expect(mock.api.setLlmToken).toHaveBeenCalledWith('anthropic', 'sk-ant-1');
            expect(await screen.findByText('A token is saved for this provider.')).toBeInTheDocument();
            expect(screen.getByLabelText('Token (API key)')).toHaveValue('');
            expect(screen.getByRole('button', { name: 'REMOVE TOKEN' })).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('says it was not saved, and keeps what was typed, when the app could not save it', async () => {
            const user = userEvent.setup();
            mock.api.setLlmToken.mockResolvedValue(false);
            await renderSettings();
            await user.type(screen.getByLabelText('Token (API key)'), 'sk-1');
            await user.click(screen.getByRole('button', { name: 'SAVE TOKEN' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('The token could not be saved.');
            expect(screen.getByLabelText('Token (API key)')).toHaveValue('sk-1');
            expect(screen.getByText('No token is saved for this provider.')).toBeInTheDocument();
        });

        it('says there is a token for the provider that has one, and removes it', async () => {
            const user = userEvent.setup();
            mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['openai', 'gemini'] });
            await renderSettings({ translateProvider: 'gemini' });
            expect(await screen.findByText('A token is saved for this provider.')).toBeInTheDocument();
            mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['openai'] });
            await user.click(screen.getByRole('button', { name: 'REMOVE TOKEN' }));
            expect(mock.api.clearLlmToken).toHaveBeenCalledTimes(1);
            expect(mock.api.clearLlmToken).toHaveBeenCalledWith('gemini');
            expect(await screen.findByText('No token is saved for this provider.')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'REMOVE TOKEN' })).not.toBeInTheDocument();
        });

        it('says there is no token for a provider that has none, even when another one has', async () => {
            mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['openai'] });
            await renderSettings({ translateProvider: 'kimi' });
            await vi.waitFor(() => {
                expect(mock.api.getLlmStatus).toHaveBeenCalledTimes(1);
            });
            expect(screen.getByText('No token is saved for this provider.')).toBeInTheDocument();
        });

        it('forgets what was typed when the provider changes', async () => {
            const user = userEvent.setup();
            const { rerender, change, edit, changeMany } = await renderSettings({ translateProvider: 'openai' });
            await user.type(screen.getByLabelText('Token (API key)'), 'sk-1');
            rerender(<TranslationSettings draft={{ ...DEFAULT_SETTINGS, translateProvider: 'kimi' }} change={change} edit={edit} changeMany={changeMany} />);
            expect(screen.getByLabelText('Token (API key)')).toHaveValue('');
        });

        it('forgets the message that it was not saved when the provider changes', async () => {
            const user = userEvent.setup();
            mock.api.setLlmToken.mockResolvedValue(false);
            const { rerender, change, edit, changeMany } = await renderSettings({ translateProvider: 'openai' });
            await user.type(screen.getByLabelText('Token (API key)'), 'sk-1');
            await user.click(screen.getByRole('button', { name: 'SAVE TOKEN' }));
            await screen.findByRole('alert');
            rerender(<TranslationSettings draft={{ ...DEFAULT_SETTINGS, translateProvider: 'kimi' }} change={change} edit={edit} changeMany={changeMany} />);
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('warns that the token cannot be kept, and turns the field and SAVE TOKEN off, when the system has no keyring', async () => {
            mock.api.getLlmStatus.mockResolvedValue({ canStore: false, providers: [] });
            await renderSettings();
            expect(await screen.findByRole('alert')).toHaveTextContent('This system has no keyring to keep the token safely, so it cannot be saved. Install one (such as GNOME Keyring or KWallet) and restart the app.');
            expect(screen.getByLabelText('Token (API key)')).toBeDisabled();
            expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeDisabled();
        });

        it('does not warn about the keyring when the system has one', async () => {
            await renderSettings();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Token (API key)')).toBeEnabled();
        });
    });

    it('does not set the state of a screen that is gone when the status arrives late', async () => {
        let answer: (value: { canStore: boolean; providers: [] }) => void = () => {
            return undefined;
        };
        mock.api.getLlmStatus.mockReturnValue(new Promise((resolve) => {
            answer = resolve;
        }));
        const { unmount } = await renderSettings();
        unmount();
        answer({ canStore: false, providers: [] });
        await Promise.resolve();
        expect(mock.api.getLlmStatus).toHaveBeenCalledTimes(1);
    });

    describe('the speech to text', () => {
        it('shows the stored values, with what it is for', async () => {
            await renderSettings({ transcribeProvider: 'custom', transcribeModel: 'whisper-large', transcribeBaseUrl: 'http://stt/v1' });
            expect(screen.getByText('SUBTITLE CREATION (SPEECH TO TEXT)')).toBeInTheDocument();
            expect(screen.getByText('For episodes with no subtitle: the audio is sent to this service, which writes the subtitle. Uses your own account; the token is kept encrypted on this computer and is never shown again.')).toBeInTheDocument();
            expect(screen.getByLabelText('Speech-to-text service')).toHaveValue('custom');
            expect(screen.getByLabelText('Speech-to-text model')).toHaveValue('whisper-large');
            expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveValue('http://stt/v1');
            expect(screen.queryByLabelText('Language spoken in the audio')).not.toBeInTheDocument();
            expect(screen.getByText('With OpenAI, the model has to answer in WebVTT (whisper-1 does). With Gemini, write the name of a Gemini model that takes audio.')).toBeInTheDocument();
            expect(screen.getByText('Only to use another address than the one of the service. Required for "Other". The service has to speak the protocol of OpenAI (/audio/transcriptions).')).toBeInTheDocument();
        });

        it('starts with the defaults of the settings', async () => {
            await renderSettings();
            expect(screen.getByLabelText('Speech-to-text service')).toHaveValue('openai');
            expect(screen.getByLabelText('Speech-to-text model')).toHaveValue('whisper-1');
            expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveValue('');
        });

        it('does not ask for the language spoken in the audio: it is chosen each time, in the window that makes the subtitle', async () => {
            await renderSettings();
            expect(screen.queryByLabelText('Language spoken in the audio')).not.toBeInTheDocument();
        });

        it('lists the services that speak the protocol of OpenAI and Gemini', async () => {
            await renderSettings();
            expect(optionsOf('Speech-to-text service')).toEqual([
                ['openai', 'OpenAI (Whisper)'],
                ['gemini', 'Gemini (Google)'],
                ['custom', 'Other (OpenAI-compatible)']
            ]);
        });

        it.each([
            ['openai', 'https://api.openai.com/v1'],
            ['gemini', 'https://generativelanguage.googleapis.com/v1beta'],
            ['custom', '']
        ] as const)('suggests the address of %s in the field of the address', async (transcribeProvider, address) => {
            await renderSettings({ transcribeProvider });
            expect(screen.getByLabelText('Speech-to-text address (optional)')).toHaveAttribute('placeholder', address);
        });

        it('saves the service right away and the texts as they are typed, apart from the translation ones', async () => {
            const { change, edit, changeMany } = await renderSettings();
            fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'custom' } });
            expect(changeMany).toHaveBeenLastCalledWith({ transcribeProvider: 'custom' });
            fireEvent.change(screen.getByLabelText('Speech-to-text model'), { target: { value: 'whisper-2' } });
            expect(edit).toHaveBeenLastCalledWith('transcribeModel', 'whisper-2');
            fireEvent.change(screen.getByLabelText('Speech-to-text address (optional)'), { target: { value: 'http://localhost:9000/v1' } });
            expect(edit).toHaveBeenLastCalledWith('transcribeBaseUrl', 'http://localhost:9000/v1');
            expect(changeMany).toHaveBeenCalledTimes(1);
            expect(change).not.toHaveBeenCalled();
            expect(edit).toHaveBeenCalledTimes(2);
        });

        describe('the model when the service changes', () => {
            it('is taken away when Gemini is chosen and the model is the one of OpenAI that is there by default, since the models have other names', async () => {
                const { changeMany } = await renderSettings({ transcribeModel: 'whisper-1' });
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'gemini' } });
                expect(changeMany).toHaveBeenCalledTimes(1);
                expect(changeMany).toHaveBeenCalledWith({ transcribeProvider: 'gemini', transcribeModel: '' });
            });

            it('is kept when Gemini is chosen and the user wrote another model', async () => {
                const { changeMany } = await renderSettings({ transcribeModel: 'my-gemini-model' });
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'gemini' } });
                expect(changeMany).toHaveBeenCalledWith({ transcribeProvider: 'gemini' });
            });

            it('is put back as whisper-1 when a service of the protocol of OpenAI is chosen and the model is empty', async () => {
                const { changeMany } = await renderSettings({ transcribeProvider: 'gemini', transcribeModel: '' });
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'openai' } });
                expect(changeMany).toHaveBeenCalledWith({ transcribeProvider: 'openai', transcribeModel: 'whisper-1' });
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'custom' } });
                expect(changeMany).toHaveBeenLastCalledWith({ transcribeProvider: 'custom', transcribeModel: 'whisper-1' });
            });

            it('is kept when a service of the protocol of OpenAI is chosen and the model is not empty', async () => {
                const { changeMany } = await renderSettings({ transcribeProvider: 'gemini', transcribeModel: 'a-model' });
                fireEvent.change(screen.getByLabelText('Speech-to-text service'), { target: { value: 'openai' } });
                expect(changeMany).toHaveBeenCalledWith({ transcribeProvider: 'openai' });
            });
        });

        it.each([
            ['openai', 'speech-openai'],
            ['gemini', 'speech-gemini'],
            ['custom', 'speech-custom']
        ] as const)('keeps the token of %s in the slot %s', async (transcribeProvider, slot) => {
            const user = userEvent.setup();
            await renderSettings({ transcribeProvider });
            await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'key-1');
            await user.click(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' }));
            expect(mock.api.setLlmToken).toHaveBeenCalledWith(slot, 'key-1');
        });

        describe('its token', () => {
            it('says there is none for the service, and has no button to remove one', async () => {
                await renderSettings();
                expect(screen.getByText('No token is saved for this service.')).toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'REMOVE SPEECH TOKEN' })).not.toBeInTheDocument();
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveValue('');
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveAttribute('type', 'password');
            });

            it('keeps SAVE SPEECH TOKEN off until something is typed', async () => {
                const user = userEvent.setup();
                await renderSettings();
                expect(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' })).toBeDisabled();
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), '  ');
                expect(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' })).toBeDisabled();
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'sk-1');
                expect(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' })).toBeEnabled();
            });

            it.each([
                ['openai', 'speech-openai'],
                ['custom', 'speech-custom']
            ] as const)('sends the token of %s to the app in a slot of its own (%s), empties the field and says it is saved', async (transcribeProvider, slot) => {
                const user = userEvent.setup();
                await renderSettings({ transcribeProvider });
                mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: [slot] });
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'sk-speech');
                await user.click(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' }));
                expect(mock.api.setLlmToken).toHaveBeenCalledTimes(1);
                expect(mock.api.setLlmToken).toHaveBeenCalledWith(slot, 'sk-speech');
                expect(await screen.findByText('A token is saved for this service.')).toBeInTheDocument();
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveValue('');
                expect(screen.getByRole('button', { name: 'REMOVE SPEECH TOKEN' })).toBeInTheDocument();
            });

            it('says it was not saved, and keeps what was typed, when the app could not save it', async () => {
                const user = userEvent.setup();
                mock.api.setLlmToken.mockResolvedValue(false);
                await renderSettings();
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'sk-1');
                await user.click(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' }));
                expect(await screen.findByRole('alert')).toHaveTextContent('The token could not be saved.');
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveValue('sk-1');
                expect(screen.getByText('No token is saved for this service.')).toBeInTheDocument();
            });

            it('removes the token of the service that has one', async () => {
                const user = userEvent.setup();
                mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['speech-openai'] });
                await renderSettings();
                expect(await screen.findByText('A token is saved for this service.')).toBeInTheDocument();
                mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: [] });
                await user.click(screen.getByRole('button', { name: 'REMOVE SPEECH TOKEN' }));
                expect(mock.api.clearLlmToken).toHaveBeenCalledTimes(1);
                expect(mock.api.clearLlmToken).toHaveBeenCalledWith('speech-openai');
                expect(await screen.findByText('No token is saved for this service.')).toBeInTheDocument();
            });

            it('keeps the token of the service apart from the one of the language model of the same name', async () => {
                mock.api.getLlmStatus.mockResolvedValue({ canStore: true, providers: ['custom'] });
                await renderSettings({ translateProvider: 'custom', transcribeProvider: 'custom' });
                expect(await screen.findByText('A token is saved for this provider.')).toBeInTheDocument();
                expect(screen.getByText('No token is saved for this service.')).toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'REMOVE TOKEN' })).toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'REMOVE SPEECH TOKEN' })).not.toBeInTheDocument();
            });

            it('does not mix what is typed in one field with the other', async () => {
                const user = userEvent.setup();
                await renderSettings();
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'for-speech');
                expect(screen.getByLabelText('Token (API key)')).toHaveValue('');
                expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeDisabled();
                expect(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' })).toBeEnabled();
            });

            it('forgets what was typed when the service changes', async () => {
                const user = userEvent.setup();
                const { rerender, change, edit, changeMany } = await renderSettings({ transcribeProvider: 'openai' });
                await user.type(screen.getByLabelText('Speech-to-text token (API key)'), 'sk-1');
                rerender(<TranslationSettings draft={{ ...DEFAULT_SETTINGS, transcribeProvider: 'custom' }} change={change} edit={edit} changeMany={changeMany} />);
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toHaveValue('');
            });

            it('turns both fields and both buttons off, and warns once, when the system has no keyring', async () => {
                mock.api.getLlmStatus.mockResolvedValue({ canStore: false, providers: [] });
                await renderSettings();
                expect(await screen.findByRole('alert')).toHaveTextContent('This system has no keyring to keep the token safely, so it cannot be saved. Install one (such as GNOME Keyring or KWallet) and restart the app.');
                expect(screen.getAllByRole('alert')).toHaveLength(1);
                expect(screen.getByLabelText('Speech-to-text token (API key)')).toBeDisabled();
                expect(screen.getByLabelText('Token (API key)')).toBeDisabled();
                expect(screen.getByRole('button', { name: 'SAVE SPEECH TOKEN' })).toBeDisabled();
                expect(screen.getByRole('button', { name: 'SAVE TOKEN' })).toBeDisabled();
            });
        });
    });
});

