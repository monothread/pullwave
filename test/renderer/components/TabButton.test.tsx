// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SETTINGS_ICON, TabButton } from '@renderer/components/TabButton';

describe('TabButton', () => {
    it('shows its label as text and marks the current tab', () => {
        render(<TabButton label="QUEUE" active onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'QUEUE' });
        expect(button).toHaveTextContent('QUEUE');
        expect(button).toHaveClass('tab', 'tab--active');
        expect(button).not.toHaveClass('tab--icon');
        expect(button).toHaveAttribute('aria-current', 'page');
        expect(button).not.toHaveAttribute('aria-label');
        expect(button).not.toHaveAttribute('title');
    });

    it('is not marked as current when it is not the active one', () => {
        render(<TabButton label="HISTORY" active={false} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'HISTORY' });
        expect(button).toHaveClass('tab');
        expect(button).not.toHaveClass('tab--active');
        expect(button).not.toHaveAttribute('aria-current');
    });

    it('shows only the glyph when it has an icon, and keeps the label as its name and tooltip', () => {
        render(<TabButton label="SETTINGS (GLOBAL)" icon={SETTINGS_ICON} active={false} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' });
        expect(button).toHaveTextContent(SETTINGS_ICON);
        expect(button).not.toHaveTextContent('SETTINGS');
        expect(button).toHaveAttribute('aria-label', 'SETTINGS (GLOBAL)');
        expect(button).toHaveAttribute('title', 'SETTINGS (GLOBAL)');
        expect(button).toHaveClass('tab', 'tab--icon');
        expect(button.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
    });

    it('marks an icon tab as current too', () => {
        render(<TabButton label="SETTINGS" icon={SETTINGS_ICON} active onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'SETTINGS' });
        expect(button).toHaveClass('tab', 'tab--icon', 'tab--active');
        expect(button).toHaveAttribute('aria-current', 'page');
    });

    it('calls onClick once per click', async () => {
        const onClick = vi.fn();
        render(<TabButton label="QUEUE" active={false} onClick={onClick} />);
        await userEvent.click(screen.getByRole('button', { name: 'QUEUE' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('uses a gear drawn as text', () => {
        expect(SETTINGS_ICON).toBe('\u2699\uFE0E');
    });
});

describe('TabButton with a picture', () => {
    it('shows the picture before the label, hidden from the screen readers, and keeps the label as its name', () => {
        render(<TabButton label="ANIME" active={false} decoration={<svg data-testid="picture" />} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'ANIME' });
        expect(button).toHaveTextContent(/^ANIME$/);
        expect(button).not.toHaveAttribute('aria-label');
        expect(button).not.toHaveAttribute('title');
        expect(button).toHaveClass('tab');
        expect(button).not.toHaveClass('tab--icon');
        const parts = Array.from(button.children);
        expect(parts.map((part) => {
            return part.className;
        })).toEqual(['tab__decoration', 'tab__label']);
        expect(parts[0]).toHaveAttribute('aria-hidden', 'true');
        expect(parts[0]).toContainElement(screen.getByTestId('picture'));
        expect(parts[1]).toHaveTextContent('ANIME');
        expect(parts[1]).not.toHaveAttribute('aria-hidden');
    });

    it('marks a tab with a picture as current', () => {
        render(<TabButton label="MANGA" active decoration={<svg />} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'MANGA' });
        expect(button).toHaveClass('tab', 'tab--active');
        expect(button).toHaveAttribute('aria-current', 'page');
    });

    it('calls onClick when the picture is clicked', async () => {
        const onClick = vi.fn();
        render(<TabButton label="MANGA" active={false} decoration={<svg data-testid="picture" />} onClick={onClick} />);
        await userEvent.click(screen.getByTestId('picture'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows only the glyph when it has both a glyph and a picture', () => {
        render(<TabButton label="SETTINGS" icon={SETTINGS_ICON} active={false} decoration={<svg data-testid="picture" />} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'SETTINGS' });
        expect(button).toHaveTextContent(SETTINGS_ICON);
        expect(screen.queryByTestId('picture')).not.toBeInTheDocument();
        expect(button.querySelector('.tab__decoration')).toBeNull();
        expect(button.querySelector('.tab__label')).toBeNull();
    });

    it('shows the label as plain text, with no wrapper, when it has no picture', () => {
        render(<TabButton label="QUEUE" active={false} onClick={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'QUEUE' });
        expect(button.children).toHaveLength(0);
        expect(button.textContent).toBe('QUEUE');
    });
});
