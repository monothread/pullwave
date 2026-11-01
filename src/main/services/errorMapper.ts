import type { MessageKey } from '@shared/i18n';
import type { ErrorDetails } from '@shared/errorDetails';
import type { DownloadError, ErrorCode } from '@shared/types';
import { describeError } from './errorDetails';
import { translateMain } from './language';

type RuleCode = Exclude<ErrorCode, 'UNKNOWN' | 'BINARY_MISSING'>;

interface ErrorRule {
    code: RuleCode;
    patterns: RegExp[];
}

function titleKey(code: ErrorCode): MessageKey {
    return `error.${code}.title`;
}

function hintKey(code: ErrorCode): MessageKey {
    return `error.${code}.hint`;
}

const RAW_LIMIT = 4000;

const ERROR_RULES: ErrorRule[] = [
    {
        code: 'FILENAME_TOO_LONG',
        patterns: [/file name too long/i, /filename too long/i, /errno 36/i]
    },
    {
        code: 'FFMPEG_MISSING',
        patterns: [/ffmpeg (is )?not (found|installed)/i, /ffprobe and ffmpeg not found/i, /ffmpeg or avconv not found/i]
    },
    {
        code: 'LOGIN_REQUIRED',
        patterns: [/sign in/i, /log ?in (is )?required/i, /age[- ]restricted/i, /confirm you.{1,3}re not a bot/i, /members[- ]only/i]
    },
    {
        code: 'UNAVAILABLE',
        patterns: [/video unavailable/i, /private video/i, /has been removed/i, /not available/i, /does not exist/i, /is private/i]
    },
    {
        code: 'OUTDATED',
        patterns: [/unable to extract/i, /please update/i, /yt-dlp -u/i, /unsupported url/i]
    },
    {
        code: 'FORBIDDEN',
        patterns: [/http error (401|403|410)/i, /\b403\b.{0,20}forbidden/i, /forbidden/i]
    },
    {
        code: 'NETWORK',
        patterns: [
            /unable to download/i,
            /timed out/i,
            /temporary failure in name resolution/i,
            /network is unreachable/i,
            /connection (reset|refused|aborted)/i,
            /getaddrinfo/i,
            /http error 5\d\d/i
        ]
    }
];

function truncateRaw(text: string): string {
    const trimmed = text.trim();
    return trimmed.length > RAW_LIMIT ? trimmed.slice(-RAW_LIMIT) : trimmed;
}

function detailsOf(exitCode: number | null, known: Partial<ErrorDetails>): ErrorDetails {
    return { occurredAt: Date.now(), ...(exitCode === null ? {} : { exitCode }), ...known };
}

export function mapDownloadError(stderr: string, exitCode: number | null, known: Partial<ErrorDetails> = {}): DownloadError {
    const raw = truncateRaw(stderr);
    const details = detailsOf(exitCode, known);
    const matchedRule = ERROR_RULES.find((rule) => {
        return rule.patterns.some((pattern) => {
            return pattern.test(raw);
        });
    });
    if (matchedRule) {
        return { code: matchedRule.code, title: translateMain(titleKey(matchedRule.code)), hint: translateMain(hintKey(matchedRule.code)), raw, details };
    }
    return {
        code: 'UNKNOWN',
        title: translateMain(titleKey('UNKNOWN')),
        hint: translateMain(hintKey('UNKNOWN')),
        raw: raw.length > 0 ? raw : translateMain('error.exitCode', { code: exitCode ?? translateMain('error.exitCodeUnknown') }),
        details
    };
}

export function mapSpawnError(error: NodeJS.ErrnoException, known: Partial<ErrorDetails> = {}): DownloadError {
    const details = describeError(error, known);
    if (error.code === 'ENOENT') {
        return {
            code: 'BINARY_MISSING',
            title: translateMain(titleKey('BINARY_MISSING')),
            hint: translateMain(hintKey('BINARY_MISSING')),
            raw: error.message,
            details
        };
    }
    return { code: 'UNKNOWN', title: translateMain('error.spawn.title'), hint: translateMain(hintKey('UNKNOWN')), raw: error.message, details };
}
