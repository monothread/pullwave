// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HistoryEntry } from '@shared/types';
import { HistoryList } from '@renderer/components/HistoryList';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initial, history: [] });
});

const DONE: HistoryEntry = { id: 'h1', url: 'https://x.com/1', title: 'Done Video', filePath: '/d/Done Video.mp4', status: 'done', errorTitle: null, finishedAt: 1700000000000 };
const FAILED: HistoryEntry = { id: 'h2', url: 'https://x.com/2', title: 'Failed Video', filePath: null, status: 'error', errorTitle: 'Network failure', finishedAt: 1700000001000 };

describe('HistoryList', () => {
    it('shows an empty state', () => {
        render(<HistoryList />);
        expect(screen.getByText('// HISTORY IS EMPTY.')).toBeInTheDocument();
    });

    it('lists entries with status and the count', () => {
        useAppStore.setState({ history: [DONE, FAILED] });
        render(<HistoryList />);
        expect(screen.getByText('HISTORY [2]')).toBeInTheDocument();
        expect(screen.getByText('Done Video')).toHaveAttribute('title', 'https://x.com/1');
        expect(screen.getByText('Failed Video')).toBeInTheDocument();
        expect(screen.getByText(/^COMPLETE ·/)).toBeInTheDocument();
        expect(screen.getByText(/^FAILED — Network failure ·/)).toBeInTheDocument();
    });

    it('falls back to a generic label when the error title is missing', () => {
        useAppStore.setState({ history: [{ ...FAILED, errorTitle: null }] });
        render(<HistoryList />);
        expect(screen.getByText(/^FAILED — Unknown error ·/)).toBeInTheDocument();
    });

    it('shows the file only for entries with a path', async () => {
        useAppStore.setState({ history: [DONE, FAILED] });
        render(<HistoryList />);
        const buttons = screen.getAllByRole('button', { name: 'SHOW FILE' });
        expect(buttons).toHaveLength(1);
        await userEvent.setup().click(buttons[0] as HTMLElement);
        expect(mock.api.showItemInFolder).toHaveBeenCalledWith('/d/Done Video.mp4');
    });

    it('clears the history', async () => {
        useAppStore.setState({ history: [DONE] });
        render(<HistoryList />);
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        expect(mock.api.clearHistory).not.toHaveBeenCalled();
        expect(within(confirmDialog('Clear the history?')).getByText('Only the list goes. Downloaded files stay on the disk.')).toBeInTheDocument();
        await answerDialog(user, 'Clear the history?', 'CLEAR HISTORY');
        expect(mock.api.clearHistory).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().history).toEqual([]);
    });

    it('keeps the history when the user keeps it or presses Esc', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ history: [DONE] });
        render(<HistoryList />);
        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        await answerDialog(user, 'Clear the history?', 'KEEP');
        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.clearHistory).not.toHaveBeenCalled();
        expect(useAppStore.getState().history).toEqual([DONE]);
    });
});
