// @vitest-environment jsdom
interface FakeParam {
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
}

function fakeParam(): FakeParam {
    return { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

const oscillators: Array<{ type: string; frequency: FakeParam; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = [];
const gains: Array<{ gain: FakeParam; connect: ReturnType<typeof vi.fn> }> = [];
let contexts = 0;

class FakeAudioContext {
    currentTime = 10;
    destination = { kind: 'speakers' };
    constructor() {
        contexts += 1;
    }
    createOscillator() {
        const gainNode = { gain: fakeParam(), connect: vi.fn() };
        const oscillator = { type: '', frequency: fakeParam(), start: vi.fn(), stop: vi.fn(), connect: vi.fn(() => { return gainNode; }) };
        oscillators.push(oscillator);
        gainNode.connect.mockReturnValue(this.destination);
        return oscillator;
    }
    createGain() {
        const gain = { gain: fakeParam(), connect: vi.fn(() => { return this.destination; }) };
        gains.push(gain);
        return gain;
    }
}

beforeEach(() => {
    oscillators.length = 0;
    gains.length = 0;
    contexts = 0;
    vi.resetModules();
});

afterEach(() => {
    Reflect.deleteProperty(window, 'AudioContext');
});

describe('the tones of the sounds', () => {
    it('are short notes, quiet', async () => {
        const { UI_SOUND_TONES, UI_SOUND_VOLUME } = await import('@renderer/sound/uiSound');
        expect(UI_SOUND_VOLUME).toBe(0.06);
        expect(UI_SOUND_TONES).toEqual({
            move: [{ frequency: 880, start: 0, duration: 0.05 }],
            select: [
                { frequency: 1046.5, start: 0, duration: 0.06 },
                { frequency: 1568, start: 0.05, duration: 0.08 }
            ],
            back: [
                { frequency: 659.3, start: 0, duration: 0.06 },
                { frequency: 440, start: 0.05, duration: 0.08 }
            ],
            open: [
                { frequency: 523.3, start: 0, duration: 0.07 },
                { frequency: 659.3, start: 0.05, duration: 0.07 },
                { frequency: 784, start: 0.1, duration: 0.1 }
            ]
        });
    });
});

describe('playUiSound', () => {
    it('does nothing where the window has no audio', async () => {
        const { playUiSound } = await import('@renderer/sound/uiSound');
        expect(() => {
            playUiSound('select');
        }).not.toThrow();
        expect(contexts).toBe(0);
    });

    it('plays each note of the sound with an envelope, on one audio context made once', async () => {
        Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
        const { playUiSound, UI_SOUND_VOLUME } = await import('@renderer/sound/uiSound');
        playUiSound('select');
        playUiSound('move');
        expect(contexts).toBe(1);
        expect(oscillators).toHaveLength(3);
        const first = oscillators[0];
        const firstGain = gains[0];
        expect(first?.type).toBe('triangle');
        expect(first?.frequency.setValueAtTime).toHaveBeenCalledWith(1046.5, 10);
        expect(firstGain?.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
        expect(firstGain?.gain.linearRampToValueAtTime.mock.calls[0]?.[0]).toBe(UI_SOUND_VOLUME);
        expect(firstGain?.gain.linearRampToValueAtTime.mock.calls[0]?.[1]).toBeCloseTo(10.01, 9);
        expect(firstGain?.gain.exponentialRampToValueAtTime.mock.calls[0]?.[0]).toBe(0.0001);
        expect(firstGain?.gain.exponentialRampToValueAtTime.mock.calls[0]?.[1]).toBeCloseTo(10.06, 9);
        expect(first?.connect).toHaveBeenCalledWith(firstGain);
        expect(first?.start).toHaveBeenCalledWith(10);
        expect(first?.stop.mock.calls[0]?.[0]).toBeCloseTo(10.08, 9);
        expect(oscillators[1]?.frequency.setValueAtTime.mock.calls[0]?.[0]).toBe(1568);
        expect(oscillators[1]?.frequency.setValueAtTime.mock.calls[0]?.[1]).toBeCloseTo(10.05, 9);
        expect(oscillators[2]?.frequency.setValueAtTime).toHaveBeenCalledWith(880, 10);
    });
});
