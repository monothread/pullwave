import { useEffect, useRef, useState } from 'react';
import { pushSample, SPEED_SAMPLES } from '../downloads/speed';

export const SPEED_SAMPLE_MS = 1000;

export function useSpeedHistory(key: string, speed: number | null, active = true): number[] {
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
        if (!active) {
            return undefined;
        }
        const timer = setInterval(() => {
            setSamples((current) => {
                return pushSample(current, latest.current ?? 0, SPEED_SAMPLES);
            });
        }, SPEED_SAMPLE_MS);
        return () => {
            clearInterval(timer);
        };
    }, [key, active]);
    return samples;
}
