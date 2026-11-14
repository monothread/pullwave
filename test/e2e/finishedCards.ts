import { DONE_LINGER_MS } from '../../src/renderer/store/doneLinger';

// How long to wait for the card of a download to leave the list: a download that completed stays there, green, for DONE_LINGER_MS before
// it leaves (D-196), so the default wait of an assertion (5 s) is not enough for it.
export const FINISHED_CARD_TIMEOUT = DONE_LINGER_MS + 5000;
