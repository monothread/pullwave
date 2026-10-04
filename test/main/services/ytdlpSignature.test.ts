import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKey, readKey } from 'openpgp';
import { verifyYtdlpSums, YTDLP_SIGNING_KEY, YTDLP_SIGNING_KEY_FINGERPRINT } from '@main/services/ytdlpSignature';

// The checksums of the release 2026.08.19 of yt-dlp and the signature the project published for them.
const SUMS = readFileSync(resolve(__dirname, '../../fixtures/ytdlp/SHA2-256SUMS'));
const SIGNATURE = readFileSync(resolve(__dirname, '../../fixtures/ytdlp/SHA2-256SUMS.sig'));

describe('the key of the yt-dlp project', () => {
    it('is a public key with the fingerprint that was written down for it', async () => {
        const key = await readKey({ armoredKey: YTDLP_SIGNING_KEY });
        expect(key.isPrivate()).toBe(false);
        expect(key.getFingerprint()).toBe('ac0cbbe6848d6a873464af4e57cf65933b5a7581');
        expect(key.getFingerprint()).toBe(YTDLP_SIGNING_KEY_FINGERPRINT);
        expect(key.getUserIDs()).toEqual(['Simon Sawicki (yt-dlp signing key) <contact@grub4k.xyz>']);
    });

    it('does not expire', async () => {
        const key = await readKey({ armoredKey: YTDLP_SIGNING_KEY });
        expect(await key.getExpirationTime()).toBe(Infinity);
    });
});

describe('verifyYtdlpSums', () => {
    it('accepts the real signature of a real release', async () => {
        await expect(verifyYtdlpSums(SUMS, SIGNATURE)).resolves.toBe(true);
    });

    it('refuses the list when a byte is added, changed or taken away', async () => {
        await expect(verifyYtdlpSums(Buffer.concat([SUMS, Buffer.from('\n')]), SIGNATURE)).resolves.toBe(false);
        await expect(verifyYtdlpSums(Buffer.concat([Buffer.from('x'), SUMS]), SIGNATURE)).resolves.toBe(false);
        await expect(verifyYtdlpSums(SUMS.subarray(0, SUMS.length - 1), SIGNATURE)).resolves.toBe(false);
        const changed = Buffer.from(SUMS);
        changed[0] = (changed[0] as number) ^ 1;
        await expect(verifyYtdlpSums(changed, SIGNATURE)).resolves.toBe(false);
    });

    it('refuses the list when the hash of a binary in it was swapped for another', async () => {
        const text = SUMS.toString('utf-8');
        const [firstHash] = text.split(/\s+/);
        const swapped = text.replace(firstHash as string, '0'.repeat((firstHash as string).length));
        await expect(verifyYtdlpSums(Buffer.from(swapped), SIGNATURE)).resolves.toBe(false);
    });

    it('refuses a signature that was changed', async () => {
        const changed = Buffer.from(SIGNATURE);
        changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 1;
        await expect(verifyYtdlpSums(SUMS, changed)).resolves.toBe(false);
        await expect(verifyYtdlpSums(SUMS, SIGNATURE.subarray(0, 100))).resolves.toBe(false);
    });

    it.each([
        ['an empty signature', Buffer.alloc(0)],
        ['text that is not a signature', Buffer.from('not a signature')],
        ['the text of a key', Buffer.from(YTDLP_SIGNING_KEY)]
    ])('refuses %s', async (_name, signature) => {
        await expect(verifyYtdlpSums(SUMS, signature)).resolves.toBe(false);
    });

    it('refuses an empty list, with the real signature', async () => {
        await expect(verifyYtdlpSums(Buffer.alloc(0), SIGNATURE)).resolves.toBe(false);
    });

    it('refuses the signature when the key it was asked to trust is another one, even a good key', async () => {
        const other = await generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Someone else' }], format: 'armored' });
        const otherKey = await readKey({ armoredKey: other.publicKey });
        await expect(verifyYtdlpSums(SUMS, SIGNATURE, other.publicKey, otherKey.getFingerprint())).resolves.toBe(false);
    });

    it('refuses to trust a key whose text is not the one with the fingerprint that was written down', async () => {
        const other = await generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Someone else' }], format: 'armored' });
        // The right text with the wrong fingerprint, and a different key with the right fingerprint.
        await expect(verifyYtdlpSums(SUMS, SIGNATURE, YTDLP_SIGNING_KEY, '0'.repeat(40))).resolves.toBe(false);
        await expect(verifyYtdlpSums(SUMS, SIGNATURE, other.publicKey, YTDLP_SIGNING_KEY_FINGERPRINT)).resolves.toBe(false);
    });

    it.each([
        ['an empty key', ''],
        ['a damaged key', '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nnot a key\n-----END PGP PUBLIC KEY BLOCK-----']
    ])('refuses when the key is %s', async (_name, armoredKey) => {
        await expect(verifyYtdlpSums(SUMS, SIGNATURE, armoredKey)).resolves.toBe(false);
    });
});
