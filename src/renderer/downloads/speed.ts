// The speeds the download programs print ("1.50MiB/s", "820KiB/s", "3.2MB/s"), as bytes per second, for the graph of the downloads.

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

// The speed in bytes per second, or null when the text is not a speed (empty, "Unknown", "N/A"...).
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

// A speed in bytes per second written for people, in the binary units yt-dlp uses.
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

// How many readings the graph keeps: one a second, the last minute.
export const SPEED_SAMPLES = 60;

// The readings after a new one is added: the oldest ones go when there are more than `limit`.
export function pushSample(samples: readonly number[], value: number, limit: number = SPEED_SAMPLES): number[] {
    return [...samples, value].slice(-limit);
}

// The points of the line of the graph in a box of `width` × `height`: the newest reading on the right, the highest at the top.
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
