import { expect, type Locator } from '@playwright/test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Linux keeps a disk of its own, in memory, in this folder.
const SHARED_MEMORY = '/dev/shm';

// A new empty folder on another disk than the one `reference` is on, or null when the machine has no other disk to offer (only Linux
// has the folder above). Whoever asked for it removes it.
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

// The length of a part of the ring: the first number of its dash array ("<length> <rest>").
async function lengthOf(segment: Locator): Promise<number> {
    const dashes = await segment.getAttribute('stroke-dasharray');
    return Number((dashes ?? '0 0').split(' ')[0]);
}

// Once the ring has grown, the part of the folder of the other section starts where the part of the folder ends.
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

// The folder of the other section is not a part of the ring (it is on another disk, or the folders overlap).
export async function expectNoSiblingInRing(chart: Locator): Promise<void> {
    await expect(chart.locator('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
}
