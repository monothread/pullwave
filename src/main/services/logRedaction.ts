// What takes the place of a secret in the logs.
export const REDACTED = '***';

// A header that carries a credential, written as `Name: value`, `Name=value` or as a key of JSON or of Python (`"Name": "value"`,
// `'Name': 'value'`, the way yt-dlp prints its headers): everything after the name, up to a quote or the end of the line, is hidden (a value
// of a cookie or of an authorization can have spaces in it).
const SECRET_HEADER = /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key|api-key)(["']?\s*[:=]\s*["']?)([^"'\r\n]+)/gi;
// A token given after its kind, out of a header.
const BEARER_TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// A parameter of an address whose name says it is a secret (`?token=`, `&sig=`, `&X-Amz-Signature=`, `?key=`).
const SECRET_PARAMETER = /([?&;][\w.-]*?(?:token|key|sig|signature|auth|password|passwd|secret|session|hdnts|hdnea|policy|credential)[\w.-]*=)([^&#;\s"']+)/gi;
// The password in an address with a user (`https://user:password@host`).
const ADDRESS_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)(@)/gi;
// The options of a program whose next argument is a secret.
const SECRET_OPTIONS = new Set(['--password', '--video-password', '--ap-password', '--twofactor', '--client-certificate-password']);

// The text with the secrets it may carry (cookies, authorizations, tokens in addresses, passwords) hidden.
export function redactText(text: string): string {
    return text
        .replace(SECRET_HEADER, `$1$2${REDACTED}`)
        .replace(BEARER_TOKEN, `$1 ${REDACTED}`)
        .replace(SECRET_PARAMETER, `$1${REDACTED}`)
        .replace(ADDRESS_PASSWORD, `$1${REDACTED}$3`);
}

// `--password=value` keeps its name and loses its value; any other argument is only looked at as text.
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

// The arguments of a command with the secrets hidden: the value that follows an option of a password, and whatever the text rules find.
export function redactArgs(args: readonly string[]): string[] {
    return args.map((argument, index) => {
        const previous = index > 0 ? args[index - 1] : undefined;
        return redactArgument(argument, previous !== undefined && SECRET_OPTIONS.has(previous));
    });
}
