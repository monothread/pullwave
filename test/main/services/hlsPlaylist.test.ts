import { HlsUnsupportedError, parseHlsPlaylist } from '@main/services/hlsPlaylist';

const URL = 'https://edge.test/v1/edge/streams/origin.room/chunklist_4_video.m3u8?session=abc';

// A playlist of the low latency HLS, like the ones the sites give: parts, a hint and the reports of the other renditions come with the segments.
const LOW_LATENCY = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=2.430000',
    '#EXT-X-PART-INF:PART-TARGET=0.799000',
    '#EXT-X-MEDIA-SEQUENCE:5727',
    '#EXT-X-MAP:URI="/v1/edge/streams/origin.room/init_4_video.m4s?session=abc"',
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-22T10:43:50.866+00:00',
    '#EXTINF:0.832000,',
    '/v1/edge/streams/origin.room/seg_4_5727_video.m4s?session=abc',
    '#EXTINF:1.665000,',
    '/v1/edge/streams/origin.room/seg_4_5728_video.m4s?session=abc',
    '#EXT-X-PART:DURATION=0.799000,URI="/v1/edge/streams/origin.room/part_4_5729_0_video.m4s?session=abc",INDEPENDENT=YES',
    '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="/v1/edge/streams/origin.room/part_4_5729_1_video.m4s?session=abc"',
    '#EXT-X-RENDITION-REPORT:URI="/v1/edge/streams/origin.room/chunklist_0_video.m3u8"'
].join('\n');

describe('parseHlsPlaylist', () => {
    it('reads the segments of a low latency playlist, whole ones only, with their places and addresses', () => {
        expect(parseHlsPlaylist(LOW_LATENCY, URL)).toEqual({
            targetDurationSeconds: 2,
            initUrl: 'https://edge.test/v1/edge/streams/origin.room/init_4_video.m4s?session=abc',
            segments: [
                { sequence: 5727, url: 'https://edge.test/v1/edge/streams/origin.room/seg_4_5727_video.m4s?session=abc', durationSeconds: 0.832 },
                { sequence: 5728, url: 'https://edge.test/v1/edge/streams/origin.room/seg_4_5728_video.m4s?session=abc', durationSeconds: 1.665 }
            ],
            ended: false
        });
    });

    it('resolves addresses that are relative to the playlist, and keeps the ones that are absolute', () => {
        const playlist = parseHlsPlaylist(
            ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-MEDIA-SEQUENCE:10', '#EXTINF:4.0,', 'seg10.ts', '#EXTINF:4.0,', '../other/seg11.ts', '#EXTINF:4.0,', 'https://cdn.test/seg12.ts'].join('\n'),
            'https://site.test/live/index/playlist.m3u8'
        );
        expect(
            playlist.segments.map((segment) => {
                return segment.url;
            })
        ).toEqual(['https://site.test/live/index/seg10.ts', 'https://site.test/live/other/seg11.ts', 'https://cdn.test/seg12.ts']);
        expect(playlist.initUrl).toBeNull();
    });

    it('numbers the segments from the media sequence, and from zero when there is none', () => {
        const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.0,', 'a.ts', '#EXTINF:4.0,', 'b.ts'].join('\n');
        expect(
            parseHlsPlaylist(text, URL).segments.map((segment) => {
                return segment.sequence;
            })
        ).toEqual([0, 1]);
    });

    it('says the stream is over when the playlist ends', () => {
        expect(parseHlsPlaylist(['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.0,', 'a.ts', '#EXT-X-ENDLIST'].join('\n'), URL).ended).toBe(true);
        expect(parseHlsPlaylist(['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.0,', 'a.ts'].join('\n'), URL).ended).toBe(false);
    });

    it('reads a playlist with Windows line ends, blank lines and spaces around the lines', () => {
        const text = '#EXTM3U\r\n\r\n#EXT-X-TARGETDURATION:6\r\n  #EXT-X-MEDIA-SEQUENCE:3  \r\n#EXTINF:5.5,title\r\n  a.ts  \r\n';
        expect(parseHlsPlaylist(text, URL)).toEqual({
            targetDurationSeconds: 6,
            initUrl: null,
            segments: [{ sequence: 3, url: 'https://edge.test/v1/edge/streams/origin.room/a.ts', durationSeconds: 5.5 }],
            ended: false
        });
    });

    it('uses the target duration for a segment with no duration, and 6 seconds when there is no target either', () => {
        const withTarget = parseHlsPlaylist(['#EXTM3U', '#EXT-X-TARGETDURATION:3', 'a.ts'].join('\n'), URL);
        expect(withTarget.segments[0]?.durationSeconds).toBe(3);
        const without = parseHlsPlaylist(['#EXTM3U', 'a.ts'].join('\n'), URL);
        expect(without.targetDurationSeconds).toBe(6);
        expect(without.segments[0]?.durationSeconds).toBe(6);
    });

    it('does not take the duration of one segment for the next one', () => {
        const playlist = parseHlsPlaylist(['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:2.5,', 'a.ts', 'b.ts'].join('\n'), URL);
        expect(
            playlist.segments.map((segment) => {
                return segment.durationSeconds;
            })
        ).toEqual([2.5, 4]);
    });

    it('reads a playlist with no segment yet', () => {
        expect(parseHlsPlaylist(['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:9'].join('\n'), URL).segments).toEqual([]);
    });

    it('accepts segments that say they are not encrypted', () => {
        const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-KEY:METHOD=NONE', '#EXTINF:4.0,', 'a.ts'].join('\n');
        expect(parseHlsPlaylist(text, URL).segments).toHaveLength(1);
    });

    it('reads the initialization segment that is not quoted too', () => {
        const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-MAP:URI=init.mp4', '#EXTINF:4.0,', 'a.m4s'].join('\n');
        expect(parseHlsPlaylist(text, 'https://site.test/p/list.m3u8').initUrl).toBe('https://site.test/p/init.mp4');
    });

    it.each([
        ['text that is not a playlist', '<html>blocked</html>', 'The playlist is not an HLS playlist'],
        ['an empty text', '', 'The playlist is not an HLS playlist'],
        ['a playlist of playlists', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8', 'The playlist lists other playlists, not segments'],
        ['a playlist of key frames', '#EXTM3U\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1000,URI="x.m3u8"', 'The playlist lists other playlists, not segments'],
        ['encrypted segments', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\na.ts', 'The segments are encrypted'],
        ['segments encrypted by the session', '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key.bin"', 'The segments are encrypted'],
        ['segments that are byte ranges', '#EXTM3U\n#EXTINF:4,\n#EXT-X-BYTERANGE:1000@0\na.ts', 'The segments are byte ranges'],
        ['an initialization segment that is a byte range', '#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"\n#EXTINF:4,\na.ts', 'The initialization segment is a byte range']
    ])('refuses %s', (_label, text, message) => {
        expect(() => {
            return parseHlsPlaylist(text, URL);
        }).toThrow(HlsUnsupportedError);
        expect(() => {
            return parseHlsPlaylist(text, URL);
        }).toThrow(message);
    });
});
