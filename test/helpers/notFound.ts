import type { NotFoundSize } from '@renderer/components/NotFound';

export function expectNotFound(text: HTMLElement, size: NotFoundSize): void {
    expect(text.tagName).toBe('P');
    expect(text.className).toBe('not-found__text');
    const box = text.closest<HTMLElement>('[data-testid="not-found"]');
    expect(box?.className).toBe(`not-found not-found--${size}`);
    const stage = box?.querySelector('.not-found__stage');
    expect(stage?.getAttribute('aria-hidden')).toBe('true');
    expect(stage?.querySelector('.not-found__lens svg .not-found__cross')).not.toBeNull();
    expect(stage?.querySelectorAll('.not-found__rows span')).toHaveLength(3);
    expect(box?.querySelector('.empty')).toBeNull();
}
