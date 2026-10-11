// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaSourcePreference } from '@shared/manga';
import { MangaSourceSettings } from '@renderer/components/MangaSourceSettings';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore, type MangaSourceSettingsState } from '@renderer/store/mangaStore';
import { makeSource } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const BASE = { summary: '', enabled: true } as const;
const TEXT: MangaSourcePreference = { ...BASE, position: 0, type: 'text', key: 'Server URL Address', title: 'Server URL Address', summary: 'i.e. http://192.168.1.115:4567', value: '' };
const LIST: MangaSourcePreference = { ...BASE, position: 1, type: 'list', key: 'Login Mode', title: 'Login Mode', value: 'NONE', entries: ['None', 'Basic Authentication'], entryValues: ['NONE', 'BASIC_AUTH'] };
const SWITCH: MangaSourcePreference = { ...BASE, position: 2, type: 'switch', key: 'hq', title: 'High quality', value: false };
const CHECK: MangaSourcePreference = { ...BASE, position: 3, type: 'checkbox', key: 'safe', title: 'Safe mode', value: true };
const MULTI: MangaSourcePreference = { ...BASE, position: 4, type: 'multiselect', key: 'langs', title: 'Languages', summary: 'Pick some', value: ['en'], entries: ['English', 'Portuguese'], entryValues: ['en', 'pt'] };

function open(overrides: Partial<MangaSourceSettingsState> = {}): void {
    useMangaStore.setState({
        browse: { ...useMangaStore.getState().browse, sourceId: '5', sources: [makeSource({ id: '5', name: 'Suwayomi', isConfigurable: true })] },
        sourceSettings: { open: true, status: 'ready', preferences: [TEXT, LIST, SWITCH, CHECK, MULTI], error: null, saving: false, ...overrides }
    });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
    mock.api.manga.setSourcePreference.mockResolvedValue({ ok: true, value: [TEXT, LIST, SWITCH, CHECK, MULTI] });
});

describe('MangaSourceSettings', () => {
    it('shows nothing while the settings are closed', () => {
        const { container } = render(<MangaSourceSettings />);
        expect(container).toBeEmptyDOMElement();
    });

    it('is named after the source and explains why it is there', () => {
        open();
        render(<MangaSourceSettings />);
        expect(screen.getByRole('group', { name: 'Settings of Suwayomi' })).toBeInTheDocument();
        expect(screen.getByText('Settings of Suwayomi', { selector: 'legend' })).toBeInTheDocument();
        expect(screen.getByText('Some sources need to be set up here before they work.')).toBeInTheDocument();
    });

    it('shows every kind of setting with its title, its hint and its value', () => {
        open();
        render(<MangaSourceSettings />);
        expect(screen.getByLabelText('Server URL Address')).toHaveValue('');
        expect(screen.getByText('i.e. http://192.168.1.115:4567')).toBeInTheDocument();
        expect(screen.getByLabelText('Login Mode')).toHaveValue('NONE');
        expect(Array.from(screen.getByLabelText('Login Mode').querySelectorAll('option')).map((option) => {return [option.getAttribute('value'), option.textContent]})).toEqual([
            ['NONE', 'None'],
            ['BASIC_AUTH', 'Basic Authentication']
        ]);
        expect(screen.getByRole('switch', { name: 'High quality' })).not.toBeChecked();
        expect(screen.getByRole('switch', { name: 'Safe mode' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Languages: English' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Languages: Portuguese' })).not.toBeChecked();
        expect(screen.getByText('Pick some')).toBeInTheDocument();
    });

    it('says while the settings are loading, and when there are none', () => {
        open({ status: 'loading', preferences: [] });
        const { rerender } = render(<MangaSourceSettings />);
        expect(screen.getByText('LOADING SETTINGS…')).toBeInTheDocument();
        open({ status: 'ready', preferences: [] });
        rerender(<MangaSourceSettings />);
        expect(screen.getByText('This source has no settings.')).toBeInTheDocument();
    });

    it('explains why the settings could not be read or changed, with the details a hover away', () => {
        open({ status: 'error', preferences: [], error: { code: 'API_ERROR', message: 'Source not found' } });
        render(<MangaSourceSettings />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The site or the extension reported an error.');
        expect(alert).toHaveAttribute('title', 'Source not found');
    });

    it('saves a text setting when the user leaves the field, not at every key', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.type(screen.getByLabelText('Server URL Address'), 'http://x:4567');
        expect(mock.api.manga.setSourcePreference).not.toHaveBeenCalled();
        await user.tab();
        expect(mock.api.manga.setSourcePreference).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.setSourcePreference).toHaveBeenCalledWith({ sourceId: '5', position: 0, type: 'text', value: 'http://x:4567' });
    });

    it('saves a text setting with Enter', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.type(screen.getByLabelText('Server URL Address'), 'http://y:1{Enter}');
        expect(mock.api.manga.setSourcePreference).toHaveBeenCalledWith({ sourceId: '5', position: 0, type: 'text', value: 'http://y:1' });
    });

    it('does not save a text setting that did not change', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.click(screen.getByLabelText('Server URL Address'));
        await user.tab();
        expect(mock.api.manga.setSourcePreference).not.toHaveBeenCalled();
    });

    it('saves a list setting, a switch and a check box at once', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.selectOptions(screen.getByLabelText('Login Mode'), 'BASIC_AUTH');
        await user.click(screen.getByRole('switch', { name: 'High quality' }));
        await user.click(screen.getByRole('switch', { name: 'Safe mode' }));
        expect(mock.api.manga.setSourcePreference.mock.calls).toEqual([
            [{ sourceId: '5', position: 1, type: 'list', value: 'BASIC_AUTH' }],
            [{ sourceId: '5', position: 2, type: 'switch', value: true }],
            [{ sourceId: '5', position: 3, type: 'checkbox', value: false }]
        ]);
    });

    it('adds a choice to a multiple choice, and takes one away', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.click(screen.getByRole('checkbox', { name: 'Languages: Portuguese' }));
        await user.click(screen.getByRole('checkbox', { name: 'Languages: English' }));
        expect(mock.api.manga.setSourcePreference.mock.calls).toEqual([
            [{ sourceId: '5', position: 4, type: 'multiselect', value: ['en', 'pt'] }],
            [{ sourceId: '5', position: 4, type: 'multiselect', value: [] }]
        ]);
    });

    it('turns every field off while a change is being saved, and the ones the source disables', () => {
        open({ saving: true });
        const { rerender } = render(<MangaSourceSettings />);
        expect(screen.getByLabelText('Server URL Address')).toBeDisabled();
        expect(screen.getByLabelText('Login Mode')).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Languages: English' })).toBeDisabled();
        open({ saving: false, preferences: [{ ...TEXT, enabled: false }, LIST] });
        rerender(<MangaSourceSettings />);
        expect(screen.getByLabelText('Server URL Address')).toBeDisabled();
        expect(screen.getByLabelText('Login Mode')).toBeEnabled();
    });

    it('shows what the server gives back after a change', async () => {
        const user = userEvent.setup();
        open();
        mock.api.manga.setSourcePreference.mockResolvedValue({ ok: true, value: [{ ...TEXT, value: 'http://x:4567' }, LIST] });
        render(<MangaSourceSettings />);
        await user.type(screen.getByLabelText('Server URL Address'), 'http://x:4567{Enter}');
        await vi.waitFor(() => {
            expect(useMangaStore.getState().sourceSettings.preferences).toHaveLength(2);
        });
        expect(screen.getByLabelText('Server URL Address')).toHaveValue('http://x:4567');
        expect(screen.queryByLabelText('High quality')).not.toBeInTheDocument();
    });

    it('closes', async () => {
        const user = userEvent.setup();
        open();
        render(<MangaSourceSettings />);
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(useMangaStore.getState().sourceSettings.open).toBe(false);
    });
});
