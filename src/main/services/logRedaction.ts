export const REDACTED = '***';

const SECRET_HEADER = /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key|api-key)(["']?\s*[:=]\s*["']?)([^"'\r\n]+)/gi;
const BEARER_TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const SECRET_PARAMETER = /([?&;][\w.-]*?(?:token|key|sig|signature|auth|password|passwd|secret|session|hdnts|hdnea|policy|credential)[\w.-]*=)([^&#;\s"']+)/gi;
const ADDRESS_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)(@)/gi;
const SECRET_OPTIONS = new Set(['--password', '--video-password', '--ap-password', '--twofactor', '--client-certificate-password']);

export function redactText(text: string): string {
    return text
        .replace(SECRET_HEADER, `$1$2${REDACTED}`)
        .replace(BEARER_TOKEN, `$1 ${REDACTED}`)
        .replace(SECRET_PARAMETER, `$1${REDACTED}`)
        .replace(ADDRESS_PASSWORD, `$1${REDACTED}$3`);
}

function redactArgument(argument: string, afterSecretOption: boolean): string {
    if (afterSecretOption) {
        return REDACTED;
    }
    const equals = argument.indexOf('=');
    if (equals > 0 && SECRET_OPTIONS.has(argument.slice(0, equals))) {
        return `${argument.slice(0, equals + 1)}${REDACTED}`;
    }
    return redactText(argument);
}

export function redactArgs(args: readonly string[]): string[] {
    return args.map((argument, index) => {
        const previous = index > 0 ? args[index - 1] : undefined;
        return redactArgument(argument, previous !== undefined && SECRET_OPTIONS.has(previous));
    });
}
