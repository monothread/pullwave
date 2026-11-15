import { fireEvent, screen } from '@testing-library/react';

interface SettingsNames {
    gear: string;
    menu: string;
}

const ENGLISH: SettingsNames = { gear: 'Settings', menu: 'Subtitles' };

export async function openPlayerSettings(names: SettingsNames = ENGLISH): Promise<void> {
    const gear = await screen.findByRole('button', { name: names.gear });
    if (gear.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(gear);
    }
}

export async function subtitleMenu(names: SettingsNames = ENGLISH): Promise<HTMLElement> {
    await openPlayerSettings(names);
    return screen.findByRole('combobox', { name: names.menu });
}

export function openedSubtitleMenu(names: SettingsNames = ENGLISH): HTMLElement {
    const gear = screen.getByRole('button', { name: names.gear });
    if (gear.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(gear);
    }
    return screen.getByRole('combobox', { name: names.menu });
}

export async function subtitleOption(name: string): Promise<HTMLElement> {
    await openPlayerSettings();
    return screen.findByRole('option', { name });
}

export function openedPlayerSettings(names: SettingsNames = ENGLISH): HTMLElement {
    const gear = screen.getByRole('button', { name: names.gear });
    if (gear.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(gear);
    }
    return screen.getByRole('dialog', { name: names.gear });
}
