#!/usr/bin/env node
// Stands in for yt-dlp in the screenshots. What it does is told by the link: `?title=<name>&percent=<n>` is a download that stays at that
// percentage (the screenshot is taken while it goes on), `?title=<name>&fail=<kind>` fails like yt-dlp does, and `?title=<name>` ends well.
const fs = require('node:fs');

const args = process.argv.slice(2);
if (args.includes('--version')) {
    process.stdout.write('2026.10.01\n');
    process.exit(0);
}
if (args.includes('-U')) {
    process.stdout.write('yt-dlp is up to date\n');
    process.exit(0);
}

const link = new URL(args[args.length - 1]);
const title = link.searchParams.get('title') ?? 'Untitled video';
const percent = Number(link.searchParams.get('percent') ?? '100');
const fail = link.searchParams.get('fail');
const downloadDir = args[args.indexOf('-P') + 1];
const finalPath = `${downloadDir}/${title} [abc].mp4`;

function progress(value, speed, eta) {
    process.stdout.write(`CYBERPROG|${value.toFixed(1).padStart(6)}%|${speed}|${eta}|${Math.round(value * 40000)}|${(value * 4).toFixed(1)}|False|${title}\n`);
}

if (fail === 'unavailable') {
    process.stderr.write('ERROR: [youtube] abc: Video unavailable\n');
    process.exit(1);
}
if (fail === 'forbidden') {
    process.stderr.write(`ERROR: [generic] ${link.href}: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)\n`);
    process.exit(1);
}

fs.mkdirSync(downloadDir, { recursive: true });
if (percent < 100) {
    process.stdout.write(`CYBERINFO|False|${finalPath}\n`);
    const speed = link.searchParams.get('speed') ?? '8.41MiB/s';
    const eta = link.searchParams.get('eta') ?? '00:36';
    progress(percent, speed, eta);
    setInterval(() => {
        progress(percent, speed, eta);
    }, 500);
    process.on('SIGINT', () => {
        process.exit(0);
    });
} else {
    progress(100, '9.00MiB/s', '00:00');
    process.stdout.write(`CYBERFILE|${finalPath}\n`);
    process.exit(0);
}
