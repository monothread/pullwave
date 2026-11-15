import { expect, type Locator } from '@playwright/test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHARED_MEMORY = '/dev/shm';

export function makeFolderOnAnotherDisk(reference: string): string | null {
    try {
        const folder = mkdtempSync(join(SHARED_MEMORY, 'pullwave-e2e-'));
        if (statSync(folder).dev === statSync(reference).dev) {
            rmSync(folder, { recursive: true, force: true });
            return null;
        }
        return folder;
    } catch {
        return null;
    }
}

async function lengthOf(segment: Locator): Promise<number> {
    const dashes = await segment.getAttribute('stroke-dasharray');
    return Number((dashes ?? '0 0').split(' ')[0]);
}

export async function expectSiblingAfterFolder(chart: Locator): Promise<void> {
    await expect
        .poll(
            async () => {
                const folderLength = await lengthOf(chart.locator('.disk__segment--folder'));
                const offset = await chart.locator('.disk__segment--sibling').getAttribute('stroke-dashoffset');
                return folderLength > 0 && offset === String(-folderLength);
            },
            { timeout: 10000 }
        )
        .toBe(true);
}

export async function expectNoSiblingInRing(chart: Locator): Promise<void> {
    await expect(chart.locator('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
}
