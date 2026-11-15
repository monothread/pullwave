import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export function confirmDialog(title: string | RegExp): HTMLElement {
    return screen.getByRole('dialog', { name: title });
}

export async function answerDialog(user: UserEvent, title: string | RegExp, answer: string): Promise<void> {
    await user.click(within(confirmDialog(title)).getByRole('button', { name: answer }));
}
