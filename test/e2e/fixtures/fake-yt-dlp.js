#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
const logPath = process.env.FAKE_YTDLP_LOG;
if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify(args)}\n`);
    fs.writeFileSync(`${logPath}.env`, process.env.PATH ?? '');
}

if (args.includes('--version')) {
    process.stdout.write('fake-1.0\n');
    process.exit(0);
}
if (args.includes('-U')) {
    process.stdout.write('Fake yt-dlp is up to date\n');
    process.exit(0);
}

const url = args[args.length - 1];
const downloadDir = args[args.indexOf('-P') + 1];
const title = 'Fake Video';

function progress(percent) {
    process.stdout.write(`CYBERPROG|${percent.toFixed(1).padStart(6)}%|1.00MiB/s|00:01|${Math.round(percent * 1000)}|${percent / 10}|False|${title}\n`);
}

if (url.includes('forbidden')) {
    process.stderr.write(`ERROR: [generic] ${url}: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)\n`);
    process.exit(1);
}

if (url.includes('unsupported')) {
    process.stderr.write(`ERROR: Unsupported URL: ${url}\n`);
    process.exit(1);
}

if (url.includes('fail') && !url.includes('partialfail') && !url.includes('livefail')) {
    process.stderr.write('ERROR: [youtube] abc: Video unavailable\n');
    process.exit(1);
}

if (url.includes('partialfail') || url.includes('livefail')) {
    // Fails halfway, like a dropped connection: the unfinished files stay in the folder, as yt-dlp leaves them.
    const live = url.includes('livefail');
    const finalPath = `${downloadDir}/${live ? 'Live Fail' : 'Partial Fail'} [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    process.stdout.write(`CYBERINFO|${live ? 'True' : 'False'}|${finalPath}\n`);
    fs.writeFileSync(`${finalPath}.part`, 'unfinished');
    if (!live) {
        fs.writeFileSync(`${downloadDir}/Partial Fail [abc].f137.mp4.part`, 'unfinished');
        fs.writeFileSync(`${downloadDir}/Partial Fail [abc].mp4.ytdl`, '{}');
        fs.writeFileSync(`${downloadDir}/Other Video [xyz].mp4.part`, 'belongs to another download');
        fs.writeFileSync(`${downloadDir}/Finished [fin].mp4`, 'complete file');
    }
    setTimeout(() => {
        process.stderr.write('ERROR: unable to download video data: <urlopen error [Errno 104] Connection reset by peer>\n');
        process.exit(1);
    }, 300);
} else if (url.includes('liveend') || url.includes('liveback')) {
    // A live stream that stops by itself after a moment. The attempts that look for it again (they carry --match-filter)
    // find it offline for `liveend`, and live again for `liveback`, like a broadcaster who lost the connection and reconnected.
    const attempt = args.includes('--match-filter');
    const name = url.includes('liveback') ? 'Live Back' : 'Live End';
    fs.mkdirSync(downloadDir, { recursive: true });
    if (attempt && url.includes('liveend')) {
        process.exit(0);
    }
    const finalPath = `${downloadDir}/${name} [abc]${attempt ? ' (part 2)' : ''}.mp4`;
    let writer = null;
    const finish = () => {
        if (writer === null) {
            process.exit(0);
        }
        clearInterval(writer);
        fs.renameSync(`${finalPath}.part`, finalPath);
        process.stdout.write(`CYBERFILE|${finalPath}\n`);
        process.exit(0);
    };
    const goLive = () => {
        fs.writeFileSync(`${finalPath}.part`, '');
        process.stdout.write(`CYBERINFO|True|${finalPath}\n`);
        writer = setInterval(() => {
            fs.appendFileSync(`${finalPath}.part`, Buffer.alloc(2048));
        }, 50);
    };
    // Closing the file takes a moment, as it does for a real recording, so the "saving" state of the card can be seen.
    process.on('SIGINT', () => {
        setTimeout(finish, 1200);
    });
    if (attempt) {
        // Reconnecting takes a moment, as a real attempt does.
        setTimeout(goLive, 1500);
    } else {
        goLive();
        setTimeout(finish, 500);
    }
} else if (url.includes('livewait')) {
    // A scheduled live stream: waits (printing "[wait]" lines only when yt-dlp is not quiet, as the real one does) and
    // goes live after a while.
    const finalPath = `${downloadDir}/Live Wait [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    if (args.includes('--no-quiet')) {
        process.stdout.write('[wait] Waiting for 00:00:03 - Press Ctrl+C to try now\n');
    }
    let remaining = 3;
    const counter = setInterval(() => {
        remaining -= 1;
        if (args.includes('--no-quiet')) {
            process.stdout.write(`[wait] Remaining time until next attempt: 00:00:0${Math.max(remaining, 0)}\r`);
        }
    }, 500);
    setTimeout(() => {
        clearInterval(counter);
        fs.writeFileSync(`${finalPath}.part`, '');
        process.stdout.write(`CYBERINFO|True|${finalPath}\n`);
        setInterval(() => {
            fs.appendFileSync(`${finalPath}.part`, Buffer.alloc(2048));
        }, 50);
    }, 2500);
    process.on('SIGINT', () => {
        if (fs.existsSync(`${finalPath}.part`)) {
            fs.renameSync(`${finalPath}.part`, finalPath);
            process.stdout.write(`CYBERFILE|${finalPath}\n`);
        }
        process.exit(0);
    });
} else if (url.includes('liveorphan') || url.includes('liveleftover')) {
    // A live recording like the real one with ffmpeg: a child process (the "ffmpeg") that holds the pipes open and keeps on
    // running when yt-dlp is gone. `liveorphan` also ignores Ctrl+C, `liveleftover` exits on it but leaves the child behind.
    const finalPath = `${downloadDir}/Live Orphan [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.writeFileSync(`${finalPath}.part`, '');
    process.stdout.write(`CYBERINFO|True|${finalPath}\n`);
    const orphan = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    if (logPath) {
        fs.writeFileSync(`${logPath}.orphan`, String(orphan.pid));
    }
    setInterval(() => {
        fs.appendFileSync(`${finalPath}.part`, Buffer.alloc(2048));
    }, 50);
    process.on('SIGTERM', () => {
        process.exit(0);
    });
    if (url.includes('liveorphan')) {
        process.on('SIGINT', () => {
            return undefined;
        });
    } else {
        process.on('SIGINT', () => {
            fs.renameSync(`${finalPath}.part`, finalPath);
            process.stdout.write(`CYBERFILE|${finalPath}\n`);
            process.exit(0);
        });
    }
} else if (url.includes('slowpartial')) {
    // A download that is still going on: its unfinished files are in the folder, as yt-dlp keeps them while it downloads.
    const finalPath = `${downloadDir}/Slow Partial [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    process.stdout.write(`CYBERINFO|False|${finalPath}\n`);
    fs.writeFileSync(`${finalPath}.part`, 'unfinished');
    fs.writeFileSync(`${finalPath}.ytdl`, '{}');
    fs.writeFileSync(`${downloadDir}/Other Video [xyz].mp4.part`, 'belongs to another download');
    setInterval(() => {
        progress(50);
    }, 200);
} else if (url.includes('livestream')) {
    // Like a real live recording: announces it is live, grows a .part file and, on SIGINT, finishes and keeps the file.
    const finalPath = `${downloadDir}/Live Show [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.writeFileSync(`${finalPath}.part`, '');
    process.stdout.write(`CYBERINFO|True|${finalPath}\n`);
    setInterval(() => {
        fs.appendFileSync(`${finalPath}.part`, Buffer.alloc(2048));
    }, 50);
    process.on('SIGINT', () => {
        fs.renameSync(`${finalPath}.part`, finalPath);
        process.stdout.write(`CYBERFILE|${finalPath}\n`);
        process.exit(0);
    });
} else {
    runOrdinaryDownload();
}

function runOrdinaryDownload() {
progress(10);
if (url.includes('quiet')) {
    // Stays alive without writing anything, so it never notices that its parent is gone.
    setInterval(() => {}, 1000);
} else if (url.includes('slow')) {
    setInterval(() => {
        progress(50);
    }, 200);
} else if (url.includes('convert')) {
    // The download is complete and yt-dlp then converts the audio and moves the file; each step takes a moment, as with ffmpeg.
    progress(60);
    progress(100);
    const step = (status, processor) => {
        // The real yt-dlp writes these progress lines to stderr when it is quiet (it is, because of --print).
        process.stderr.write(`CYBERPP|${status}|${processor}\n`);
    };
    step('started', 'ExtractAudio');
    setTimeout(() => {
        step('finished', 'ExtractAudio');
        step('started', 'MoveFiles');
    }, 1500);
    setTimeout(() => {
        step('finished', 'MoveFiles');
        process.stdout.write(`CYBERFILE|${downloadDir}/${title} [abc].mp3\n`);
        process.exit(0);
    }, 2700);
} else {
    progress(60);
    progress(100);
    process.stdout.write(`CYBERFILE|${downloadDir}/${title} [abc].mp4\n`);
    process.exit(0);
}
}
