import { test } from '@playwright/test';

function useProjectDisplay(project: { metadata: { display?: unknown } }): void {
    process.env.PULLWAVE_E2E_DISPLAY = project.metadata.display === 'secondary' ? 'secondary' : 'primary';
}

// eslint-disable-next-line no-empty-pattern
test.beforeAll(({}, workerInfo) => {
    useProjectDisplay(workerInfo.project);
});

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
    useProjectDisplay(testInfo.project);
});
