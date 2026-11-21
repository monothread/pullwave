import { useEffect, useState, type DragEvent } from 'react';
import { useSmoothPercent } from '../hooks/useSmoothPercent';

export interface SmoothProgressBarProps {
    percent: number;
    label: string;
}

export function SmoothProgressBar({ percent, label }: SmoothProgressBarProps) {
    const shown = useSmoothPercent(percent);
    return (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={label}>
            <div className="progress__bar progress__bar--smooth" style={{ width: `${shown}%` }} />
        </div>
    );
}

export function carriesFiles(event: { dataTransfer: Pick<DataTransfer, 'types'> | null }): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export interface FileDropHandlers {
    dragging: boolean;
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
}

export function useFileDrop(busy: boolean, onFiles: (files: File[]) => void): FileDropHandlers {
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const keepAway = (event: globalThis.DragEvent): void => {
            if (carriesFiles(event)) {
                event.preventDefault();
            }
        };
        window.addEventListener('dragover', keepAway);
        window.addEventListener('drop', keepAway);
        return () => {
            window.removeEventListener('dragover', keepAway);
            window.removeEventListener('drop', keepAway);
        };
    }, []);

    function onDragEnter(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event)) {
            event.preventDefault();
            setDragging(true);
        }
    }

    function onDragOver(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        }
    }

    function onDragLeave(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event) && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
        }
    }

    function onDrop(event: DragEvent<HTMLElement>): void {
        if (!carriesFiles(event)) {
            return;
        }
        event.preventDefault();
        setDragging(false);
        if (busy) {
            return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
            return;
        }
        onFiles(files);
    }

    return { dragging, onDragEnter, onDragOver, onDragLeave, onDrop };
}
