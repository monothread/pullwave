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

function progress(percent, formatId = 'NA') {
    process.stdout.write(`CYBERPROG|${percent.toFixed(1).padStart(6)}%|1.00MiB/s|00:01|${Math.round(percent * 1000)}|${percent / 10}|False|${formatId}|${title}\n`);
}

function runStepsAfterDownload() {
    const step = (status, processor) => {
        process.stderr.write(`CYBERPP|${status}|${processor}\n`);
    };
    step('started', 'Merger');
    setTimeout(() => {
        step('finished', 'Merger');
        step('started', 'MoveFiles');
    }, 2500);
    setTimeout(() => {
        step('finished', 'MoveFiles');
        process.stdout.write(`CYBERFILE|${downloadDir}/${title} [abc].mp4\n`);
        process.exit(0);
    }, 3700);
}

function runTwoParts() {
    const parts = [
        { format_id: '137', url: 'https://cdn.test/video.mp4', protocol: 'https', vcodec: 'avc1.640028', acodec: 'none', height: 1080 },
        { format_id: '140', url: 'https://cdn.test/audio.m4a', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', resolution: 'audio only' }
    ];
    process.stdout.write(`CYBERSTREAM|${JSON.stringify({ is_live: false, protocol: 'https+https', requested_formats: parts })}\n`);
    const steps = [
        ...[0, 20, 40, 60, 80, 100].map((percent) => {
            return ['137', percent];
        }),
        ...[25, 50, 75, 100].map((percent) => {
            return ['140', percent];
        })
    ];
    let index = 0;
    const timer = setInterval(() => {
        const [formatId, percent] = steps[index];
        progress(percent, formatId);
        index += 1;
        if (index === steps.length) {
            clearInterval(timer);
            if (url.includes('steps')) {
                runStepsAfterDownload();
                return;
            }
            process.stdout.write(`CYBERFILE|${downloadDir}/${title} [abc].mp4\n`);
            process.exit(0);
        }
    }, 300);
}

if (url.includes('forbidden')) {
    process.stderr.write(`ERROR: [generic] ${url}: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)\n`);
    process.exit(1);
}

if (url.includes('unsupported')) {
    process.stderr.write(`ERROR: Unsupported URL: ${url}\n`);
    process.exit(1);
}

if (url.includes('noformat')) {
    process.stderr.write('ERROR: [generic] clip: Requested format is not available. Use --list-formats for a list of available formats\n');
    process.exit(1);
}

if (url.includes('fail') && !url.includes('partialfail') && !url.includes('livefail')) {
    process.stderr.write('ERROR: [youtube] abc: Video unavailable\n');
    process.exit(1);
}

if (url.includes('partialfail') || url.includes('livefail')) {
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
    process.on('SIGINT', () => {
        setTimeout(finish, 1200);
    });
    if (attempt) {
        setTimeout(goLive, 1500);
    } else {
        goLive();
        setTimeout(finish, 500);
    }
} else if (url.includes('livewait')) {
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
    const finalPath = `${downloadDir}/Slow Partial [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    process.stdout.write(`CYBERINFO|False|${finalPath}\n`);
    fs.writeFileSync(`${finalPath}.part`, 'unfinished');
    fs.writeFileSync(`${finalPath}.ytdl`, '{}');
    fs.writeFileSync(`${downloadDir}/Other Video [xyz].mp4.part`, 'belongs to another download');
    setInterval(() => {
        progress(50);
    }, 200);
} else if (url.includes('livehls')) {
    const port = url.match(/-(\d+)$/)[1];
    const finalPath = `${downloadDir}/Live Hls [abc].mp4`;
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.writeFileSync(`${finalPath}.part`, '');
    process.stdout.write(`CYBERINFO|True|${finalPath}\n`);
    const rendition = (name) => {
        return { url: `http://127.0.0.1:${port}/${name}/list.m3u8`, protocol: 'm3u8_native', http_headers: { 'User-Agent': 'FakeAgent' } };
    };
    process.stdout.write(`CYBERSTREAM|${JSON.stringify({ is_live: true, protocol: 'm3u8_native+m3u8_native', requested_formats: [rendition('video'), rendition('audio')] })}\n`);
    setInterval(() => {
        fs.appendFileSync(`${finalPath}.part`, Buffer.alloc(2048));
    }, 50);
    process.on('SIGINT', () => {
        fs.renameSync(`${finalPath}.part`, finalPath);
        process.stdout.write(`CYBERFILE|${finalPath}\n`);
        process.exit(0);
    });
} else if (url.includes('livestream')) {
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
} else if (url.includes('twoparts')) {
    runTwoParts();
} else {
    runOrdinaryDownload();
}

function runOrdinaryDownload() {
if (process.env.FAKE_YTDLP_THUMBNAIL) {
    process.stdout.write(`CYBERTHUMB|${process.env.FAKE_YTDLP_THUMBNAIL}\n`);
}
progress(10);
if (url.includes('quiet')) {
    setInterval(() => {}, 1000);
} else if (url.includes('slow')) {
    setInterval(() => {
        progress(50);
    }, 200);
} else if (url.includes('convert')) {
    progress(60);
    progress(100);
    const step = (status, processor) => {
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
    const finalPath = `${downloadDir}/${title} [abc].mp4`;
    if (url.includes('writefile')) {
        fs.mkdirSync(downloadDir, { recursive: true });
        fs.writeFileSync(finalPath, 'fake-mp4');
    }
    process.stdout.write(`CYBERFILE|${finalPath}\n`);
    process.exit(0);
}
}
