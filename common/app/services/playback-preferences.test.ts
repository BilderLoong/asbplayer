import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import PlaybackPreferences from './playback-preferences';

const makeSettings = (overrides: Record<string, unknown> = {}) => ({
    rememberSubtitleOffset: true,
    lastSubtitleOffset: 250,
    subtitleAlignment: 'bottom' as const,
    subtitlePositionOffset: 0,
    topSubtitlePositionOffset: 0,
    ...overrides,
});

const makeExtension = (supportsAppIntegration = false) => ({
    supportsAppIntegration,
    setSettings: jest.fn(async () => undefined),
});

beforeEach(() => {
    localStorage.clear();
});

describe('PlaybackPreferences', () => {
    it('reads fresh positions across player instances without discarding another video', () => {
        const first = new PlaybackPreferences(makeSettings(), makeExtension() as any);
        const second = new PlaybackPreferences(makeSettings(), makeExtension() as any);
        expect(first.getVideoPosition('a')).toBeUndefined();
        second.setVideoPosition('a', 34);
        expect(first.getVideoPosition('a')).toBe(34);
        first.setVideoPosition('b', 56);
        expect(second.getVideoPosition('b')).toBe(56);
        expect(second.getVideoPosition('a')).toBe(34);
    });

    it('moves legacy positions only to the explicitly restored session video', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);
        preferences.setVideoPosition('movie.mp4', 34);
        preferences.migrateVideoPosition('identity-a', 'movie.mp4');
        preferences.migrateVideoPosition('identity-b', 'movie.mp4');
        expect(preferences.getVideoPosition('identity-a')).toBe(34);
        expect(preferences.getVideoPosition('movie.mp4')).toBeUndefined();
        expect(preferences.getVideoPosition('identity-b')).toBeUndefined();
        preferences.setVideoPosition('movie.mp4', 12);
        preferences.migrateVideoPosition('identity-a', 'movie.mp4');
        expect(preferences.getVideoPosition('identity-a')).toBe(34);
    });

    it('rejects negative saved positions and malformed ordering data', () => {
        localStorage.setItem(
            'videoPositions',
            JSON.stringify({ bad: { position: -1 }, good: { position: 34, seq: -2 } })
        );
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);
        expect(preferences.getVideoPosition('bad')).toBeUndefined();
        expect(preferences.getVideoPosition('good')).toBe(34);
        preferences.setVideoPosition('next', 12);
        expect(preferences.getVideoPosition('next')).toBe(12);
    });
    it('uses user-facing defaults when storage is empty', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        expect(preferences.volume).toBe(100);
        expect(preferences.theaterMode).toBe(false);
        expect(preferences.hideSubtitleList).toBe(false);
        expect(preferences.displaySubtitles).toBe(true);
        expect(preferences.offset).toBe(0);
        expect(preferences.subtitlePlayerWidth).toBeUndefined();
        expect(preferences.playbackRate).toBe(1);
    });

    it('persists scalar playback preferences with their expected storage representation', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        preferences.volume = 65;
        preferences.theaterMode = true;
        preferences.hideSubtitleList = true;
        preferences.displaySubtitles = false;
        preferences.subtitlePlayerWidth = 720;
        preferences.offset = -125;
        preferences.playbackRate = 1.5;

        expect(preferences.volume).toBe(65);
        expect(preferences.theaterMode).toBe(true);
        expect(preferences.hideSubtitleList).toBe(true);
        expect(preferences.displaySubtitles).toBe(false);
        expect(preferences.subtitlePlayerWidth).toBe(720);
        expect(preferences.offset).toBe(-125);
        expect({ ...localStorage }).toEqual(
            expect.objectContaining({
                volume: '65',
                theaterMode: 'true',
                hideSubtitleList: 'true',
                displaySubtitles: 'false',
                subtitlePlayerWidth: '720',
                offset: '-125',
                playbackRate: '1.5',
            })
        );
    });

    it('falls back to the default playback rate for invalid stored values', () => {
        localStorage.setItem('playbackRate', 'abc');
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        expect(preferences.playbackRate).toBe(1);
    });

    it('ignores invalid assigned playback rates', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        preferences.playbackRate = 0;
        expect(preferences.playbackRate).toBe(1);

        preferences.playbackRate = 2;
        preferences.playbackRate = Number.NaN;
        expect(preferences.playbackRate).toBe(2);
    });

    it('persists per-video positions', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        expect(preferences.getVideoPosition('movie.mkv')).toBeUndefined();
        preferences.setVideoPosition('movie.mkv', 123.5);
        expect(preferences.getVideoPosition('movie.mkv')).toBe(123.5);
        preferences.setVideoPosition('movie.mkv', 0);
        expect(preferences.getVideoPosition('movie.mkv')).toBe(0);
        expect(preferences.getVideoPosition(undefined)).toBeUndefined();
    });

    it('keeps only the most recent video positions', () => {
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        for (let i = 0; i < 25; ++i) {
            preferences.setVideoPosition('video-' + i, i * 10);
        }

        expect(preferences.getVideoPosition('video-0')).toBeUndefined();
        expect(preferences.getVideoPosition('video-4')).toBeUndefined();
        expect(preferences.getVideoPosition('video-5')).toBe(50);
        expect(preferences.getVideoPosition('video-24')).toBe(240);
    });

    it('returns no position for corrupt stored data', () => {
        localStorage.setItem('videoPositions', 'not-json');
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        expect(preferences.getVideoPosition('movie.mkv')).toBeUndefined();
    });

    it('ignores malformed position entries without crashing', () => {
        localStorage.setItem('videoPositions', JSON.stringify({ 'movie.mkv': { position: '12' }, 'bad.mkv': 'nope' }));
        const preferences = new PlaybackPreferences(makeSettings(), makeExtension() as any);

        expect(preferences.getVideoPosition('movie.mkv')).toBeUndefined();
        expect(preferences.getVideoPosition('bad.mkv')).toBeUndefined();

        preferences.setVideoPosition('movie.mkv', 5);
        expect(preferences.getVideoPosition('movie.mkv')).toBe(5);
        expect(JSON.parse(localStorage.getItem('videoPositions')!)).toEqual({
            'movie.mkv': expect.objectContaining({ position: 5 }),
        });
    });

    it('ignores stored offsets when remembering is disabled', () => {
        localStorage.setItem('offset', '900');
        const preferences = new PlaybackPreferences(
            makeSettings({ rememberSubtitleOffset: false }),
            makeExtension() as any
        );

        expect(preferences.offset).toBe(0);
    });

    it('reads and writes the settings-backed offset for app integration', () => {
        localStorage.setItem('offset', '900');
        const extension = makeExtension(true);
        const preferences = new PlaybackPreferences(makeSettings({ lastSubtitleOffset: 375 }), extension as any);

        expect(preferences.offset).toBe(375);
        preferences.offset = 500;

        expect(extension.setSettings).toHaveBeenCalledWith({ lastSubtitleOffset: 500 });
        expect(localStorage.getItem('offset')).toBe('900');
    });
});
