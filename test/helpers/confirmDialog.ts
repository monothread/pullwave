import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

// The window that asks before something is taken away (see ConfirmDialog), by its title.
export function confirmDialog(title: string | RegExp): HTMLElement {
    return screen.getByRole('dialog', { name: title });
}

// Answers the window that is open: the button of the answer, by what it says.
export async function answerDialog(user: UserEvent, title: string | RegExp, answer: string): Promise<void> {
    await user.click(within(confirmDialog(title)).getByRole('button', { name: answer }));
}
