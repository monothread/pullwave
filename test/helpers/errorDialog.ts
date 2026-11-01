import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export const ERROR_DIALOG_NAME = 'ERROR DETAILS';

// Clicks the words of an error (they open the window with its details) and gives the window.
export async function openErrorDialog(user: UserEvent, summary: string): Promise<HTMLElement> {
    await user.click(screen.getByRole('button', { name: summary }));
    return screen.getByRole('dialog', { name: ERROR_DIALOG_NAME });
}
