const UNIT_BYTES: Readonly<Record<string, number>> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3
};

const SPEED_PATTERN = /^\s*([\d.,]+)\s*([kmg]?i?b)\s*\/\s*s\s*$/i;

export function parseSpeed(text: string | null | undefined): number | null {
    const match = SPEED_PATTERN.exec(text ?? '');
    if (match === null) {
        return null;
    }
    const value = Number((match[1] ?? '').replace(',', '.'));
    const unit = UNIT_BYTES[(match[2] ?? '').toLowerCase()];
    if (!Number.isFinite(value) || unit === undefined) {
        return null;
    }
    return value * unit;
}

export function formatSpeed(bytesPerSecond: number): string {
    const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
    let value = bytesPerSecond;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index] ?? 'B/s'}`;
}

export const SPEED_SAMPLES = 60;

export function pushSample(samples: readonly number[], value: number, limit: number = SPEED_SAMPLES): number[] {
    return [...samples, value].slice(-limit);
}

export function graphPoints(samples: readonly number[], width: number, height: number): string {
    if (samples.length === 0) {
        return '';
    }
    const peak = Math.max(...samples, 1);
    const step = samples.length > 1 ? width / (samples.length - 1) : 0;
    return samples
        .map((sample, index) => {
            const x = samples.length > 1 ? index * step : width;
            const y = height - (sample / peak) * height;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
}

export const FLOW_SLOWEST_SECONDS = 2.4;
export const FLOW_FASTEST_SECONDS = 0.5;
export const FLOW_NORMAL_SECONDS = 1.4;
export const FLOW_TOP_BYTES_PER_SECOND = 20 * 1024 ** 2;

export function flowSeconds(bytesPerSecond: number | null): number {
    if (bytesPerSecond === null) {
        return FLOW_NORMAL_SECONDS;
    }
    const share = Math.min(1, Math.max(0, bytesPerSecond / FLOW_TOP_BYTES_PER_SECOND));
    return Number((FLOW_SLOWEST_SECONDS - share * (FLOW_SLOWEST_SECONDS - FLOW_FASTEST_SECONDS)).toFixed(2));
}
