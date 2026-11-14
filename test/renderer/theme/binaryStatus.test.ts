import { mediaStyleOf, readStylesheet, styleOf } from '../../helpers/cssRules';

const cyberpunk = readStylesheet('cyberpunk.css');
const NARROWER_THAN_1280 = '@media (max-width: 1279px)';

describe('the chips of the programs in the top bar', () => {
    it('lays the chips out in a row that can wrap, 8 pixels apart', () => {
        expect(styleOf(cyberpunk, '.binary-status')).toEqual({ display: 'flex', 'align-items': 'center', 'flex-wrap': 'wrap', gap: '8px' });
    });

    it('takes no room when there is no chip', () => {
        expect(styleOf(cyberpunk, '.binary-status:empty')).toEqual({ display: 'none' });
    });

    it('hides the summary on a window 1280 pixels wide or wider, where each chip is shown', () => {
        expect(styleOf(cyberpunk, '.binary-status__summary')).toEqual({ display: 'none' });
        expect(styleOf(cyberpunk, '.binary-status__detail')).toEqual({});
    });

    it('shows the summary in place of the chips on a window narrower than 1280 pixels, only when there is a summary', () => {
        expect(mediaStyleOf(cyberpunk, NARROWER_THAN_1280, '.binary-status__summary')).toEqual({ display: 'inline-block' });
        expect(mediaStyleOf(cyberpunk, NARROWER_THAN_1280, '.binary-status:has(.binary-status__summary) .binary-status__detail')).toEqual({ display: 'none' });
    });

    it('has no other rule in that media query', () => {
        const selectors = cyberpunk.rules
            .filter((rule) => {
                return rule.media === NARROWER_THAN_1280;
            })
            .map((rule) => {
                return rule.selector;
            });
        expect(selectors).toEqual(['.binary-status__summary', '.binary-status:has(.binary-status__summary) .binary-status__detail']);
    });
});
