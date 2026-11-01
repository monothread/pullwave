import { useEffect, useRef, useState } from 'react';
import { pushSample, SPEED_SAMPLES } from '../downloads/speed';

// How often a reading of the speed is kept.
export const SPEED_SAMPLE_MS = 1000;

// The speeds of a download over the last minute, one reading a second; they start again when it is another download (`key`).
export function useSpeedHistory(key: string, speed: number | null): number[] {
    const latest = useRef(speed);
    const [samples, setSamples] = useState<number[]>([]);
    const [sampledKey, setSampledKey] = useState(key);
    if (sampledKey !== key) {
        setSampledKey(key);
        setSamples([]);
    }
    useEffect(() => {
        latest.current = speed;
    }, [speed]);
    useEffect(() => {
        const timer = setInterval(() => {
            setSamples((current) => {
                return pushSample(current, latest.current ?? 0, SPEED_SAMPLES);
            });
        }, SPEED_SAMPLE_MS);
        return () => {
            clearInterval(timer);
        };
    }, [key]);
    return samples;
}
