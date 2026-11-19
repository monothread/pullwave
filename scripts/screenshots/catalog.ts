export type MediaKind = 'ANIME' | 'MANGA';

export interface CoverStyle {
    title: string;
    from: string;
    to: string;
    anilistId: number;
    mediaType: MediaKind;
}

export interface MangaEntry extends CoverStyle {
    mediaType: 'MANGA';
    author: string;
    artist: string;
    description: string;
    genres: readonly string[];
    status: 'ONGOING' | 'COMPLETED';
}

export const ANIME_TITLES: readonly CoverStyle[] = [
    { title: 'Jujutsu Kaisen', from: '0x1e3c72', to: '0xe94057', anilistId: 113415, mediaType: 'ANIME' },
    { title: 'Jujutsu Kaisen Season 2', from: '0x2b1055', to: '0x00d4ff', anilistId: 145064, mediaType: 'ANIME' },
    { title: 'Jujutsu Kaisen 0', from: '0x1a1a2e', to: '0xe94560', anilistId: 131573, mediaType: 'ANIME' },
    { title: "Frieren: Beyond Journey's End", from: '0x134e5e', to: '0x71b280', anilistId: 154587, mediaType: 'ANIME' },
    { title: 'Demon Slayer: Kimetsu no Yaiba', from: '0x0f2027', to: '0x2c9fd9', anilistId: 101922, mediaType: 'ANIME' },
    { title: 'Attack on Titan', from: '0x232526', to: '0xcb2d3e', anilistId: 16498, mediaType: 'ANIME' },
    { title: 'One Piece', from: '0xf9a825', to: '0xd81b60', anilistId: 21, mediaType: 'ANIME' },
    { title: 'Solo Leveling', from: '0x3a1c71', to: '0x00d4ff', anilistId: 151807, mediaType: 'ANIME' }
];

export const MANGA_TITLES: readonly MangaEntry[] = [
    {
        title: 'One Piece',
        from: '0xf9a825',
        to: '0xd81b60',
        anilistId: 30013,
        mediaType: 'MANGA',
        author: 'Eiichiro Oda',
        artist: 'Eiichiro Oda',
        description: 'Monkey D. Luffy sets sail with the Straw Hat Pirates across the Grand Line in search of the legendary treasure known as One Piece.',
        genres: ['Action', 'Adventure', 'Fantasy'],
        status: 'ONGOING'
    },
    {
        title: 'Chainsaw Man',
        from: '0xff512f',
        to: '0xdd2476',
        anilistId: 105778,
        mediaType: 'MANGA',
        author: 'Tatsuki Fujimoto',
        artist: 'Tatsuki Fujimoto',
        description: 'Denji merges with his chainsaw devil companion Pochita and joins the Public Safety Devil Hunters in a brutal world overrun by devils.',
        genres: ['Action', 'Dark Fantasy', 'Supernatural'],
        status: 'ONGOING'
    },
    {
        title: 'Berserk',
        from: '0x232526',
        to: '0x8e0e00',
        anilistId: 30002,
        mediaType: 'MANGA',
        author: 'Kentaro Miura',
        artist: 'Kentaro Miura',
        description: 'Guts, the Black Swordsman, wanders a dark medieval world battling demonic apostles on a relentless quest for vengeance and survival.',
        genres: ['Action', 'Dark Fantasy', 'Drama'],
        status: 'ONGOING'
    },
    {
        title: 'Vagabond',
        from: '0x1d976c',
        to: '0x0f2027',
        anilistId: 30656,
        mediaType: 'MANGA',
        author: 'Takehiko Inoue',
        artist: 'Takehiko Inoue',
        description: 'A sweeping retelling of the life of Miyamoto Musashi, Japan’s most renowned swordsman, on his journey toward mastery and enlightenment.',
        genres: ['Action', 'Adventure', 'Historical'],
        status: 'ONGOING'
    },
    {
        title: 'One-Punch Man',
        from: '0xf12711',
        to: '0xf5af19',
        anilistId: 74347,
        mediaType: 'MANGA',
        author: 'ONE',
        artist: 'Yusuke Murata',
        description: 'Saitama trained so hard to become a hero for fun that he now defeats every monster and villain with a single punch.',
        genres: ['Action', 'Comedy', 'Sci-Fi'],
        status: 'ONGOING'
    },
    {
        title: 'Solo Leveling',
        from: '0x3a1c71',
        to: '0x00d4ff',
        anilistId: 105398,
        mediaType: 'MANGA',
        author: 'Chugong',
        artist: 'DUBU',
        description: 'Once known as the weakest hunter of all mankind, Sung Jinwoo awakens a mysterious system that allows him to level up without limits.',
        genres: ['Action', 'Adventure', 'Fantasy'],
        status: 'COMPLETED'
    }
];

export const VIDEO_TITLES: readonly string[] = ['Synthwave Mix - Night Drive', 'Neon City Drive - Night Ride 4K', 'Rainy Rooftop Lo-fi Session', 'Mountain Train Journey at Dawn'];

export const EPISODES = 12;
export const CHAPTERS = 6;
