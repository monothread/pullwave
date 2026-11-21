import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CoverStyle } from './catalog';

const FFMPEG = resolve(__dirname, '../../resources/bin/ffmpeg');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';

function ffmpeg(args: readonly string[]): void {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function fileNameOf(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function wrapped(title: string): string[] {
    const words = title.split(' ');
    const lines: string[] = [];
    words.forEach((word) => {
        const last = lines[lines.length - 1];
        if (last !== undefined && `${last} ${word}`.length <= 12) {
            lines[lines.length - 1] = `${last} ${word}`;
        } else {
            lines.push(word);
        }
    });
    return lines;
}

export function makeCover(directory: string, style: CoverStyle): string {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${fileNameOf(style.title)}.png`);
    const lines = wrapped(style.title);
    const texts = lines.map((line, index) => {
        const safe = line.replaceAll("'", '').replaceAll(':', '\\:');
        return `drawtext=fontfile=${FONT}:text='${safe}':fontsize=32:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${String(270 + index * 42)}`;
    });
    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `gradients=s=300x450:c0=${style.from}:c1=${style.to}:x0=0:y0=0:x1=300:y1=450:nb_colors=2:type=linear:seed=1,format=rgb24`,
        '-vf',
        texts.join(','),
        '-frames:v',
        '1',
        file
    ]);
    return file;
}

interface AniListCoverItem {
    coverImage?: {
        extraLarge?: string | null;
        large?: string | null;
    } | null;
}

async function fetchCoverUrls(items: readonly CoverStyle[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (items.length === 0) {
        return urls;
    }
    const fields = items
        .map((item, index) => {
            return `c${String(index)}: Media(id: ${String(item.anilistId)}, type: ${item.mediaType}) { coverImage { extraLarge large } }`;
        })
        .join(' ');
    try {
        const response = await fetch(ANILIST_GRAPHQL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `{ ${fields} }` }),
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
            return urls;
        }
        const payload = (await response.json()) as { data?: Record<string, AniListCoverItem | null> };
        const data = payload.data;
        if (data === undefined) {
            return urls;
        }
        items.forEach((item, index) => {
            const media = data[`c${String(index)}`];
            const url = media?.coverImage?.extraLarge ?? media?.coverImage?.large ?? null;
            if (url !== null) {
                urls.set(`${item.mediaType}:${String(item.anilistId)}`, url);
            }
        });
    } catch {
        return urls;
    }
    return urls;
}

async function downloadCoverImage(url: string, targetFile: string): Promise<boolean> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
            return false;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) {
            return false;
        }
        writeFileSync(targetFile, bytes);
        return true;
    } catch {
        return false;
    }
}

export async function prepareCovers(animeDir: string, mangaDir: string, anime: readonly CoverStyle[], manga: readonly CoverStyle[]): Promise<void> {
    mkdirSync(animeDir, { recursive: true });
    mkdirSync(mangaDir, { recursive: true });
    const cacheDir = process.env['PULLWAVE_SHOT_COVERS_DIR'];
    const entries: Array<{ style: CoverStyle; target: string; directory: string }> = [
        ...anime.map((style) => {
            return { style, directory: animeDir, target: join(animeDir, `${fileNameOf(style.title)}.png`) };
        }),
        ...manga.map((style) => {
            return { style, directory: mangaDir, target: join(mangaDir, `${fileNameOf(style.title)}.png`) };
        })
    ];
    const missing: Array<{ style: CoverStyle; target: string; directory: string }> = [];
    for (const entry of entries) {
        const cached = cacheDir !== undefined ? join(cacheDir, entry.style.mediaType.toLowerCase(), `${fileNameOf(entry.style.title)}.img`) : null;
        if (cached !== null && existsSync(cached)) {
            copyFileSync(cached, entry.target);
        } else {
            missing.push(entry);
        }
    }
    if (missing.length === 0) {
        return;
    }
    const urls = await fetchCoverUrls(
        missing.map((entry) => {
            return entry.style;
        })
    );
    await Promise.all(
        missing.map(async (entry) => {
            const url = urls.get(`${entry.style.mediaType}:${String(entry.style.anilistId)}`);
            if (url !== undefined && (await downloadCoverImage(url, entry.target))) {
                return;
            }
            makeCover(entry.directory, entry.style);
        })
    );
}

export function makePage(directory: string, number: number): string {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `page-${String(number)}.png`);
    const panels = [
        'drawbox=x=40:y=40:w=720:h=330:color=black:t=6',
        'drawbox=x=40:y=400:w=340:h=380:color=black:t=6',
        'drawbox=x=420:y=400:w=340:h=380:color=black:t=6',
        'drawbox=x=40:y=810:w=720:h=350:color=black:t=6',
        'drawbox=x=120:y=120:w=200:h=200:color=black@0.85:t=fill',
        'drawbox=x=500:y=470:w=180:h=240:color=black@0.7:t=fill',
        'drawbox=x=300:y=900:w=420:h=180:color=black@0.5:t=fill',
        `drawtext=fontfile=${FONT}:text='${String(number)}':fontsize=40:fontcolor=black:x=w-80:y=h-60`
    ];
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=800x1200', '-vf', panels.join(','), '-frames:v', '1', file]);
    return file;
}

export function makeVideo(directory: string, name: string, seconds: number): string {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${name}.mp4`);
    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `gradients=s=1280x720:c0=0x1b2735:c1=0x7b2ff7:c2=0x00d4ff:nb_colors=3:speed=0.02:rate=24:d=${String(seconds)}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=220:duration=${String(seconds)}`,
        '-vf',
        `drawtext=fontfile=${FONT}:text='%{pts\\:hms}':fontsize=64:fontcolor=white@0.85:x=(w-text_w)/2:y=(h-text_h)/2`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        file
    ]);
    return file;
}

export function readBytes(file: string): Buffer {
    return readFileSync(file);
}

export { fileNameOf };
