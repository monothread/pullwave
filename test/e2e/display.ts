import { test } from '@playwright/test';

// Tells the application which monitor to open its window on (see e2eDisplay in src/main/index.ts): the one of the project the test is in.
// Import it first in every spec file, so it runs before the hooks that open the application.
function useProjectDisplay(project: { metadata: { display?: unknown } }): void {
    process.env.PULLWAVE_E2E_DISPLAY = project.metadata.display === 'secondary' ? 'secondary' : 'primary';
}

// Playwright needs the first argument of a hook to be a destructuring pattern, even when no fixture is used.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(({}, workerInfo) => {
    useProjectDisplay(workerInfo.project);
});

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
    useProjectDisplay(testInfo.project);
});
