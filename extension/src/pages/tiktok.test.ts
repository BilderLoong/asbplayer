import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { installTikTokPageScript } from './tiktok';

const pageData = (videoId: string, url: string) => ({
    __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
            itemInfo: {
                itemStruct: {
                    id: videoId,
                    desc: 'A TikTok clip',
                    video: {
                        subtitleInfos: [
                            {
                                LanguageCodeName: 'eng-US',
                                LanguageName: 'English',
                                Format: 'webvtt',
                                Url: url,
                                UrlExpire: `${Math.floor(Date.now() / 1000) + 3600}`,
                            },
                        ],
                    },
                },
            },
        },
    },
});

const setPageData = (data: unknown) => {
    const script = document.querySelector<HTMLScriptElement>('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    script!.textContent = JSON.stringify(data);
};

const htmlForPageData = (data: unknown) =>
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(data)}</script>`;

describe('TikTok caption events', () => {
    let dispose: (() => void) | undefined;
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        document.body.innerHTML = `
            <div id="xgwrapper-0-1234567890123456789">
                <video src="blob:one"></video>
            </div>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"></script>
        `;
        setPageData(pageData('1234567890123456789', 'https://cdn.example/one.vtt'));
    });

    afterEach(() => {
        dispose?.();
        dispose = undefined;
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
        jest.restoreAllMocks();
        window.history.replaceState({}, '', '/');
        document.body.innerHTML = '';
    });

    it('publishes matching direct-page tracks for the requesting video binding', async () => {
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'request-one', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(details).toEqual([
            {
                requestId: 'request-one',
                videoSrc: 'blob:one',
                videoId: '1234567890123456789',
                error: '',
                basename: 'A TikTok clip',
                subtitles: [
                    {
                        id: 'eng-us:eng-US:https://cdn.example/one.vtt',
                        label: 'eng-US',
                        language: 'eng-us',
                        url: 'https://cdn.example/one.vtt',
                        extension: 'vtt',
                    },
                ],
            },
        ]);
    });

    it('converts a supplied creator-caption track when no WebVTT track is available', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Creator clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: 'https://cdn.example/creator.json',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        const creatorCaptionBody = JSON.stringify({
            utterances: [
                { text: 'First line', start_time: 44, end_time: 704 },
                { text: 'Second line', start_time: 1000, end_time: 1800 },
            ],
        });
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async () => ({
                ok: true,
                status: 200,
                text: async () => creatorCaptionBody,
            }),
        });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'creator-request', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => queueMicrotask(resolve));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const data = details[0] as {
            subtitles: Array<{ extension: string; url: string }>;
        };
        expect(data.subtitles).toHaveLength(1);
        expect(data.subtitles[0].extension).toBe('vtt');
        expect(decodeURIComponent(data.subtitles[0].url.split(',')[1])).toBe(
            'WEBVTT\n\n1\n00:00:00.044 --> 00:00:00.704\nFirst line\n\n2\n00:00:01.000 --> 00:00:01.800\nSecond line\n'
        );
    });

    it('reports malformed caption track data instead of treating it as no captions', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Malformed clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'webvtt',
                                        Url: 'not-a-valid-caption-url',
                                        UrlExpire: `${Math.floor(Date.now() / 1000) + 3600}`,
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'malformed-request', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'malformed-request',
            videoSrc: 'blob:one',
            videoId: '1234567890123456789',
            subtitles: [],
        });
        expect((details[0] as { error: string }).error).toContain('malformed');
    });

    it('reports a malformed subtitle track container instead of treating it as no captions', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Malformed container clip',
                            video: {
                                subtitleInfos: { LanguageCodeName: 'eng-US' },
                            },
                        },
                    },
                },
            },
        });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'malformed-container-request', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'malformed-container-request',
            videoSrc: 'blob:one',
            videoId: '1234567890123456789',
            subtitles: [],
        });
        expect((details[0] as { error: string }).error).toContain('malformed');
    });

    it('prefers WebVTT over a duplicate creator-caption representation', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Duplicate track clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: 'https://cdn.example/creator.json',
                                    },
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'webvtt',
                                        Url: 'https://cdn.example/preferred.vtt',
                                        UrlExpire: `${Math.floor(Date.now() / 1000) + 3600}`,
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        const fetchMock = jest.fn(async () => {
            throw new Error('creator-caption should not be fetched');
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'duplicate-request', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'duplicate-request',
            error: '',
            subtitles: [
                expect.objectContaining({
                    label: 'eng-US',
                    url: 'https://cdn.example/preferred.vtt',
                    extension: 'vtt',
                }),
            ],
        });
    });

    it('reports malformed creator-caption timing instead of dropping invalid cues', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Malformed creator clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: 'https://cdn.example/creator-malformed.json',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async () => ({
                ok: true,
                status: 200,
                text: async () =>
                    JSON.stringify({
                        utterances: [
                            { text: 'Valid line', start_time: 0, end_time: 500 },
                            { text: 'Backwards line', start_time: 900, end_time: 800 },
                        ],
                    }),
            }),
        });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'malformed-creator-request', videoSrc: 'blob:one' },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'malformed-creator-request',
            videoSrc: 'blob:one',
            videoId: '1234567890123456789',
            subtitles: [],
        });
        expect((details[0] as { error: string }).error).toContain('malformed');
    });

    it('fetches the requested direct canonical page when hydration is stale', async () => {
        const requestedVideoId = '9876543210987654321';
        window.history.replaceState({}, '', `/@creator/video/${requestedVideoId}`);
        document.body.innerHTML = `
            <div id="xgwrapper-0-${requestedVideoId}">
                <video src="blob:requested"></video>
            </div>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"></script>
        `;
        setPageData(pageData('1234567890123456789', 'https://cdn.example/stale.vtt'));
        const freshData = pageData(requestedVideoId, 'https://cdn.example/fresh.vtt');
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            expect(String(input)).toBe(`http://localhost/@creator/video/${requestedVideoId}`);
            return {
                ok: true,
                status: 200,
                text: async () => htmlForPageData(freshData),
            };
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'stale-hydration-request', videoSrc: 'blob:requested', videoId: requestedVideoId },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'stale-hydration-request',
            videoSrc: 'blob:requested',
            videoId: requestedVideoId,
            error: '',
            subtitles: [
                expect.objectContaining({
                    url: 'https://cdn.example/fresh.vtt',
                }),
            ],
        });
    });

    it('derives a canonical page from the enclosing feed section creator link', async () => {
        const requestedVideoId = '5555555555555555555';
        document.body.innerHTML = `
            <section data-e2e="feed-video">
                <a href="/@feedcreator">Feed creator</a>
                <div id="xgwrapper-0-${requestedVideoId}">
                    <video src="blob:feed"></video>
                </div>
            </section>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"></script>
        `;
        setPageData(pageData('1234567890123456789', 'https://cdn.example/stale.vtt'));
        const freshData = pageData(requestedVideoId, 'https://cdn.example/feed.vtt');
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            expect(String(input)).toBe(`http://localhost/@feedcreator/video/${requestedVideoId}`);
            return {
                ok: true,
                status: 200,
                text: async () => htmlForPageData(freshData),
            };
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'feed-request', videoSrc: 'blob:feed', videoId: requestedVideoId },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'feed-request',
            videoSrc: 'blob:feed',
            videoId: requestedVideoId,
            error: '',
            subtitles: [
                expect.objectContaining({
                    url: 'https://cdn.example/feed.vtt',
                }),
            ],
        });
    });

    it('keeps a paused clip selected and activates a preloaded clip when it becomes visible', () => {
        const firstVideoId = '1111111111111111111';
        const secondVideoId = '2222222222222222222';
        document.body.innerHTML = `
            <section data-e2e="feed-video">
                <a href="/@firstcreator">First creator</a>
                <div id="xgwrapper-0-${firstVideoId}"><video src="blob:first"></video></div>
            </section>
            <section data-e2e="feed-video">
                <a href="/@secondcreator">Second creator</a>
                <div id="xgwrapper-0-${secondVideoId}"><video src="blob:second"></video></div>
            </section>
        `;
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        const positions = [100, 900];
        videos.forEach((video, index) => {
            Object.defineProperty(video, 'getBoundingClientRect', {
                configurable: true,
                value: () => ({
                    top: positions[index],
                    bottom: positions[index] + 500,
                    left: 0,
                    right: 500,
                    width: 500,
                    height: 500,
                    x: 0,
                    y: positions[index],
                    toJSON: () => ({}),
                }),
            });
        });
        const contexts: unknown[] = [];
        document.addEventListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        dispose = installTikTokPageScript();

        expect(contexts).toEqual([{ videoSrc: 'blob:first', videoId: firstVideoId }]);

        videos[1].dispatchEvent(new Event('play'));
        expect(contexts).toEqual([{ videoSrc: 'blob:first', videoId: firstVideoId }]);

        videos[0].dispatchEvent(new Event('pause'));
        positions[0] = 900;
        positions[1] = 100;
        window.dispatchEvent(new Event('scroll'));

        expect(contexts).toEqual([
            { videoSrc: 'blob:first', videoId: firstVideoId },
            { videoSrc: 'blob:second', videoId: secondVideoId },
        ]);
    });

    it('discards delayed caption responses after A to B to A navigation', async () => {
        const firstVideoId = '1111111111111111111';
        const secondVideoId = '2222222222222222222';
        document.body.innerHTML = `
            <section data-e2e="feed-video">
                <a href="/@firstcreator">First creator</a>
                <div id="xgwrapper-0-${firstVideoId}"><video src="blob:first"></video></div>
            </section>
            <section data-e2e="feed-video">
                <a href="/@secondcreator">Second creator</a>
                <div id="xgwrapper-0-${secondVideoId}"><video src="blob:second"></video></div>
            </section>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"></script>
        `;
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        const positions = [100, 900];
        videos.forEach((video, index) => {
            Object.defineProperty(video, 'getBoundingClientRect', {
                configurable: true,
                value: () => ({
                    top: positions[index],
                    bottom: positions[index] + 500,
                    left: 0,
                    right: 500,
                    width: 500,
                    height: 500,
                    x: 0,
                    y: positions[index],
                    toJSON: () => ({}),
                }),
            });
        });
        const creatorPageData = (videoId: string, url: string) => ({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: videoId,
                            desc: videoId === firstVideoId ? 'First clip' : 'Second clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: url,
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        const pending = new Map<string, Array<(response: unknown) => void>>();
        const fetchMock = jest.fn(
            (input: RequestInfo | URL) =>
                new Promise((resolve) => {
                    const url = String(input);
                    pending.set(url, [...(pending.get(url) ?? []), resolve]);
                })
        );
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        const contexts: unknown[] = [];
        document.addEventListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        dispose = installTikTokPageScript();

        setPageData(creatorPageData(firstVideoId, 'https://cdn.example/first.json'));
        const details: unknown[] = [];
        document.addEventListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                details.push(event.detail);
            }
        });
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'first-request', videoSrc: 'blob:first', videoId: firstVideoId },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        positions[0] = 900;
        positions[1] = 100;
        window.dispatchEvent(new Event('scroll'));
        setPageData(creatorPageData(secondVideoId, 'https://cdn.example/second.json'));
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'second-request', videoSrc: 'blob:second', videoId: secondVideoId },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        positions[0] = 100;
        positions[1] = 900;
        window.dispatchEvent(new Event('scroll'));
        setPageData(creatorPageData(firstVideoId, 'https://cdn.example/first.json'));
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'first-return-request', videoSrc: 'blob:first', videoId: firstVideoId },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const response = (text: string) => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ utterances: [{ text, start_time: 0, end_time: 500 }] }),
        });
        pending.get('https://cdn.example/first.json')?.[0]?.(response('Old first'));
        pending.get('https://cdn.example/second.json')?.[0]?.(response('Second'));
        pending.get('https://cdn.example/first.json')?.[1]?.(response('Fresh first'));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(contexts).toEqual([
            { videoSrc: 'blob:first', videoId: firstVideoId },
            { videoSrc: 'blob:second', videoId: secondVideoId },
            { videoSrc: 'blob:first', videoId: firstVideoId },
        ]);
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'first-return-request',
            videoSrc: 'blob:first',
            videoId: firstVideoId,
        });
        expect(
            decodeURIComponent((details[0] as { subtitles: Array<{ url: string }> }).subtitles[0].url.split(',')[1])
        ).toContain('Fresh first');
    });

    it('stops pending work and event handling after disposal', async () => {
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: '1234567890123456789',
                            desc: 'Disposed clip',
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: 'https://cdn.example/disposed.json',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        let resolveFetch: ((response: unknown) => void) | undefined;
        const fetchMock = jest.fn(
            () =>
                new Promise((resolve) => {
                    resolveFetch = resolve;
                })
        );
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        const contexts: unknown[] = [];
        document.addEventListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                details.push(event.detail);
            }
        });
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'disposed-request', videoSrc: 'blob:one' },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        dispose();
        resolveFetch?.({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ utterances: [{ text: 'Late line', start_time: 0, end_time: 500 }] }),
        });
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'after-dispose-request', videoSrc: 'blob:one' },
            })
        );
        document.querySelector('video')?.dispatchEvent(new Event('play'));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(details).toEqual([]);
        expect(contexts).toEqual([{ videoSrc: 'blob:one', videoId: '1234567890123456789' }]);
    });

    it.each([
        ['/embed/1234567890123456789', 'embedded'],
        ['/live', 'LIVE'],
        ['/@creator/photo/1234567890123456789', 'photo'],
    ])('rejects %s TikTok videos at the page boundary', async (path, kind) => {
        const videoId = '1234567890123456789';
        window.history.replaceState({}, '', path);
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: `${kind}-request`, videoSrc: 'blob:one', videoId },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: `${kind}-request`,
            videoSrc: 'blob:one',
            videoId,
            subtitles: [],
        });
        expect((details[0] as { error: string }).error).toContain('unsupported');
    });

    it('refreshes matching hydration when its caption URL has expired', async () => {
        const videoId = '1234567890123456789';
        window.history.replaceState({}, '', `/@creator/video/${videoId}`);
        const expiredData = pageData(videoId, 'https://cdn.example/expired.vtt');
        expiredData.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct.video.subtitleInfos[0].UrlExpire = `${
            Math.floor(Date.now() / 1000) - 1
        }`;
        document.querySelector<HTMLVideoElement>('video')!.parentElement!.setAttribute('id', `xgwrapper-0-${videoId}`);
        setPageData(expiredData);
        const freshData = pageData(videoId, 'https://cdn.example/refreshed.vtt');
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            expect(String(input)).toBe(`http://localhost/@creator/video/${videoId}`);
            return {
                ok: true,
                status: 200,
                text: async () => htmlForPageData(freshData),
            };
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener(
            'asbplayer-synced-data',
            (event) => {
                if (event instanceof CustomEvent) {
                    details.push(event.detail);
                }
            },
            { once: true }
        );

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'expired-request', videoSrc: 'blob:one', videoId },
            })
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'expired-request',
            videoSrc: 'blob:one',
            videoId,
            error: '',
            subtitles: [
                expect.objectContaining({
                    url: 'https://cdn.example/refreshed.vtt',
                }),
            ],
        });
    });

    it('announces the current video when playback moves between preloaded videos', () => {
        document.body.innerHTML = `
            <div id="xgwrapper-0-1234567890123456789"><video src="blob:one"></video></div>
            <div id="xgwrapper-1-9876543210987654321"><video src="blob:two"></video></div>
        `;
        const videos = Array.from(document.querySelectorAll('video'));
        const contexts: unknown[] = [];
        document.addEventListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        dispose = installTikTokPageScript();

        videos[0].dispatchEvent(new Event('play'));
        videos[1].dispatchEvent(new Event('play'));

        expect(contexts).toEqual([
            { videoSrc: 'blob:one', videoId: '1234567890123456789' },
            { videoSrc: 'blob:two', videoId: '9876543210987654321' },
        ]);
    });

    it('replays the current video context to a late subscriber', () => {
        document.body.innerHTML = `
            <div id="xgwrapper-0-1234567890123456789"><video src="blob:one"></video></div>
        `;
        dispose = installTikTokPageScript();
        const contexts: unknown[] = [];
        document.addEventListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });

        document.dispatchEvent(new Event('asbplayer-get-tiktok-video-context'));

        expect(contexts).toEqual([{ videoSrc: 'blob:one', videoId: '1234567890123456789' }]);
    });

    it('aborts obsolete requests when the visible video changes while preserving the new request', async () => {
        const firstVideoId = '1111111111111111111';
        const secondVideoId = '2222222222222222222';
        document.body.innerHTML = `
            <section data-e2e="feed-video">
                <a href="/@firstcreator">First creator</a>
                <div id="xgwrapper-0-${firstVideoId}"><video src="blob:first"></video></div>
            </section>
            <section data-e2e="feed-video">
                <a href="/@secondcreator">Second creator</a>
                <div id="xgwrapper-1-${secondVideoId}"><video src="blob:second"></video></div>
            </section>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"></script>
        `;
        setPageData({
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {
                        itemStruct: {
                            id: firstVideoId,
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: 'eng-US',
                                        Format: 'creator_caption',
                                        Url: 'https://cdn.example/first.json',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        const positions = [100, 900];
        videos.forEach((video, index) => {
            Object.defineProperty(video, 'getBoundingClientRect', {
                configurable: true,
                value: () => ({
                    top: positions[index],
                    bottom: positions[index] + 500,
                    left: 0,
                    right: 500,
                    width: 500,
                    height: 500,
                    x: 0,
                    y: positions[index],
                    toJSON: () => ({}),
                }),
            });
        });
        const requests: Array<{ url: string; signal: AbortSignal | undefined }> = [];
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), signal: init?.signal ?? undefined });
            return new Promise(() => {});
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();

        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'first-request', videoSrc: 'blob:first', videoId: firstVideoId },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        positions[0] = 900;
        positions[1] = 100;
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(
            new CustomEvent('asbplayer-get-synced-data', {
                detail: { requestId: 'second-request', videoSrc: 'blob:second', videoId: secondVideoId },
            })
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(requests).toHaveLength(2);
        expect(requests[0]?.url).toBe('https://cdn.example/first.json');
        expect(requests[0]?.signal?.aborted).toBe(true);
        expect(requests[1]?.url).toBe('http://localhost/@secondcreator/video/2222222222222222222');
        expect(requests[1]?.signal?.aborted).toBe(false);
    });

    it('aborts a superseded same-context request without cancelling the replacement', async () => {
        const videoId = '1234567890123456789';
        const creatorData = pageData(videoId, 'https://cdn.example/creator.json');
        creatorData.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct.video.subtitleInfos[0].Format =
            'creator_caption';
        setPageData(creatorData);
        const pending: Array<{
            resolve: (response: unknown) => void;
            signal: AbortSignal | undefined;
        }> = [];
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe('https://cdn.example/creator.json');
            return new Promise((resolve) => {
                pending.push({ resolve, signal: init?.signal ?? undefined });
            });
        });
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
        dispose = installTikTokPageScript();
        const details: unknown[] = [];
        document.addEventListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                details.push(event.detail);
            }
        });

        const request = (requestId: string) =>
            document.dispatchEvent(
                new CustomEvent('asbplayer-get-synced-data', {
                    detail: { requestId, videoSrc: 'blob:one', videoId },
                })
            );
        request('first-request');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        request('second-request');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(pending).toHaveLength(2);
        expect(pending[0]?.signal?.aborted).toBe(true);
        expect(pending[1]?.signal?.aborted).toBe(false);

        const response = (text: string) => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ utterances: [{ text, start_time: 0, end_time: 500 }] }),
        });
        pending[0]?.resolve(response('obsolete first'));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(details).toEqual([]);

        pending[1]?.resolve(response('active second'));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({
            requestId: 'second-request',
            videoSrc: 'blob:one',
            videoId,
            error: '',
        });
        expect(
            decodeURIComponent((details[0] as { subtitles: Array<{ url: string }> }).subtitles[0].url.split(',')[1])
        ).toContain('active second');
    });
});
