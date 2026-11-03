// The invented titles of the screenshots: none of them is a real work, and nothing comes from the data of an installed app.

export interface CoverStyle {
    title: string;
    from: string;
    to: string;
}

export const ANIME_TITLES: readonly CoverStyle[] = [
    { title: 'Neon Harbor Nights', from: '0x7b2ff7', to: '0x00d4ff' },
    { title: 'Clockwork Sparrow', from: '0xf9a825', to: '0xd81b60' },
    { title: 'Starlight Courier', from: '0x0f2027', to: '0x2c9fd9' },
    { title: 'The Lantern Cartographer', from: '0x134e5e', to: '0x71b280' },
    { title: 'Moonlit Ramen Club', from: '0x41295a', to: '0xe96443' },
    { title: 'Ashfall Academy', from: '0x232526', to: '0xcb2d3e' },
    { title: 'Neon Harbor Nights 2', from: '0xf857a6', to: '0x7b2ff7' }
];

export const MANGA_TITLES: readonly CoverStyle[] = [
    { title: 'Tidebound Chronicles', from: '0x1d976c', to: '0x0f2027' },
    { title: 'Paper Lantern Detective', from: '0xff512f', to: '0xdd2476' },
    { title: 'Orbit Cafe', from: '0x4776e6', to: '0x8e54e9' },
    { title: 'Hollow Crown Knights', from: '0x3a1c71', to: '0xffaf7b' },
    { title: 'Salt and Ember', from: '0xf12711', to: '0xf5af19' },
    { title: 'The Last Lantern Keeper', from: '0x56ab2f', to: '0x1b4332' }
];

export const VIDEO_TITLES: readonly string[] = ['Synthwave Mix - Night Drive', 'Neon City Drive - Night Ride 4K', 'Rainy Rooftop Lo-fi Session', 'Mountain Train Journey at Dawn'];

export const EPISODES = 12;
export const CHAPTERS = 6;
