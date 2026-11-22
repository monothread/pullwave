// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { machineTimeZone } from '@shared/timezone';
import { useAppTimeZone } from '@renderer/hooks/useAppTimeZone';
import { useAppStore } from '@renderer/store/appStore';

const initialApp = useAppStore.getState();

function Probe() {
    const timeZone = useAppTimeZone();
    return <span data-testid="tz">{timeZone}</span>;
}

beforeEach(() => {
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

afterEach(() => {
    useAppStore.setState(initialApp);
});

describe('useAppTimeZone', () => {
    it('resolves device and invalid settings to the machine time zone', () => {
        render(<Probe />);
        expect(screen.getByTestId('tz')).toHaveTextContent(machineTimeZone());

        act(() => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, timeZone: 'Mars/Base' } });
        });
        expect(screen.getByTestId('tz')).toHaveTextContent(machineTimeZone());
    });

    it('returns the configured valid IANA time zone and updates reactively', () => {
        render(<Probe />);

        act(() => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, timeZone: 'Asia/Tokyo' } });
        });
        expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Tokyo');

        act(() => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, timeZone: 'America/Sao_Paulo' } });
        });
        expect(screen.getByTestId('tz')).toHaveTextContent('America/Sao_Paulo');
    });
});
