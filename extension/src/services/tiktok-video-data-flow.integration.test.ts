/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://www.tiktok.com/@creator/video/1234567890123456789"}
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { VideoDataUiOpenReason } from '@project/common';
import { installTikTokPageScript } from '../pages/tiktok';
import {
    createVideoDataFlowTestFixture,
    offscreenVideoRect,
    responseFor,
    visibleVideoRect,
} from './video-data-flow-test-fixture';

// This dependency is ESM-only and is not used by the WebVTT path exercised here.
jest.mock('@qgustavor/srt-parser', () => ({
    __esModule: true,
    default: class SrtParser {},
}));

const videoId = '1234567890123456789';
const nextVideoId = '9876543210987654321';
const videoSrc = 'blob:one';
const nextVideoSrc = 'blob:two';
const captionUrl = 'https://cdn.example/one.vtt';
const nextCaptionUrl = 'https://cdn.example/two.vtt';
const captionTrack = {
    id: `eng-us:eng-US:${captionUrl}`,
    label: 'eng-US',
    language: 'eng-us',
    url: captionUrl,
    extension: 'vtt',
};
const nextCaptionTrack = {
    id: `eng-us:eng-US:${nextCaptionUrl}`,
    label: 'eng-US',
    language: 'eng-us',
    url: nextCaptionUrl,
    extension: 'vtt',
};

const pageData = (id: string, description: string, url: string) => ({
    __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
            itemInfo: {
                itemStruct: {
                    id,
                    desc: description,
                    video: {
                        subtitleInfos: [
                            {
                                LanguageCodeName: 'eng-US',
                                Format: 'webvtt',
                                Url: url,
                            },
                        ],
                    },
                },
            },
        },
    },
});

const waitForMicrotasks = async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const waitForSubtitleRender = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
};

const recordWithString = (value: unknown, key: string): value is Record<string, string> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return typeof Reflect.get(value, key) === 'string';
};

describe('TikTok page to binding caption flow', () => {
    const fixture = createVideoDataFlowTestFixture();
    let binding: import('./binding').default | undefined;
    let bindingB: import('./binding').default | undefined;
    let disposePageScript: (() => void) | undefined;
    const eventDisposers: Array<() => void> = [];

    beforeAll(() => fixture.beforeAll());
    afterAll(() => fixture.afterAll());

    beforeEach(async () => {
        await fixture.beforeEach(async (url) => {
            if (String(url).includes('/asbplayer-locales/')) {
                return responseFor('{}');
            }

            if (String(url) === captionUrl) {
                return responseFor('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
            }

            if (String(url) === nextCaptionUrl) {
                return responseFor('WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nNext\n');
            }

            throw new Error(`Unexpected fetch: ${String(url)}`);
        });
        document.body.innerHTML = `
            <div id="xgwrapper-0-${videoId}">
                <video src="${videoSrc}"></video>
            </div>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(
                pageData(videoId, 'A TikTok clip', captionUrl)
            )}</script>
        `;
        const video = document.querySelector('video');
        if (!(video instanceof HTMLMediaElement)) {
            throw new Error('Test video was not created');
        }
        fixture.prepareVideo(video, visibleVideoRect());
        fixture.startFrameObserver();
        disposePageScript = installTikTokPageScript();
        binding = new fixture.bindingConstructor(video, true);
    });

    afterEach(() => {
        binding?.unbind();
        binding = undefined;
        bindingB?.unbind();
        bindingB = undefined;
        disposePageScript?.();
        disposePageScript = undefined;
        for (const dispose of eventDisposers.splice(0)) {
            dispose();
        }
        fixture.afterEach();
    });

    it('replays a page context published before binding and loads its timed track', async () => {
        if (binding === undefined) {
            throw new Error('Binding was not created');
        }

        const requests: unknown[] = [];
        const responses: unknown[] = [];
        const contexts: unknown[] = [];
        const addDocumentListener = (type: string, listener: EventListener) => {
            document.addEventListener(type, listener);
            eventDisposers.push(() => document.removeEventListener(type, listener));
        };
        addDocumentListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        addDocumentListener('asbplayer-get-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                requests.push(event.detail);
            }
        });
        addDocumentListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                responses.push(event.detail);
            }
        });
        binding.bind();
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        const firstResponse = responses[0];
        if (firstResponse === undefined) {
            throw new Error('TikTok page did not publish caption data');
        }
        if (!recordWithString(requests[0], 'requestId') || !recordWithString(firstResponse, 'requestId')) {
            throw new Error('TikTok caption exchange did not include a request token');
        }
        expect(requests).toHaveLength(1);
        expect(contexts).toContainEqual({ videoSrc, videoId });
        expect(firstResponse).toMatchObject({
            requestId: requests[0].requestId,
            videoSrc,
            videoId,
            subtitles: [captionTrack],
        });

        await binding.videoDataSyncController.show({ reason: VideoDataUiOpenReason.userRequested });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        const openModel = fixture.frameStates.find(({ state }) => state.open === true);
        if (openModel === undefined) {
            throw new Error('Video data picker did not publish a model');
        }
        const { frame, state: model } = openModel;
        const requestId = model.requestId;
        if (typeof requestId !== 'string' || frame.contentWindow === null) {
            throw new Error('Video data picker model did not include a request token');
        }
        expect(model.subtitles).toEqual([captionTrack]);

        window.dispatchEvent(
            new MessageEvent('message', {
                source: frame.contentWindow,
                data: {
                    sender: 'asbplayer-frame',
                    message: {
                        command: 'onServerMessage',
                        message: {
                            command: 'confirm',
                            requestId,
                            data: [captionTrack],
                            shouldRememberTrackChoices: false,
                        },
                    },
                },
            })
        );
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        expect(binding.subtitleController.subtitles).toHaveLength(1);
        expect(binding.subtitleController.subtitles[0]).toMatchObject({
            text: 'Hello',
            start: 1000,
            end: 2000,
            track: 0,
        });
        expect(binding.subtitleController.subtitleFileNames?.[0]).toContain('A TikTok clip');
    });

    it('rejects picker actions from the previous request after an A-to-B transition', async () => {
        if (binding === undefined) {
            throw new Error('Binding was not created');
        }

        const requests: unknown[] = [];
        const responses: unknown[] = [];
        const contexts: unknown[] = [];
        const addDocumentListener = (type: string, listener: EventListener) => {
            document.addEventListener(type, listener);
            eventDisposers.push(() => document.removeEventListener(type, listener));
        };
        addDocumentListener('asbplayer-tiktok-video-context', (event) => {
            if (event instanceof CustomEvent) {
                contexts.push(event.detail);
            }
        });
        addDocumentListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                responses.push(event.detail);
            }
        });
        addDocumentListener('asbplayer-get-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                requests.push(event.detail);
            }
        });

        const oldVideo = document.querySelector('video');
        const hydrationScript = document.querySelector<HTMLScriptElement>('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (oldVideo === null || hydrationScript === null) {
            throw new Error('TikTok transition fixture was not available');
        }
        const nextWrapper = document.createElement('div');
        nextWrapper.id = `xgwrapper-0-${nextVideoId}`;
        const nextVideo = document.createElement('video');
        nextVideo.src = nextVideoSrc;
        fixture.prepareVideo(nextVideo, offscreenVideoRect());
        nextWrapper.appendChild(nextVideo);
        document.body.appendChild(nextWrapper);
        const bindingForB = new fixture.bindingConstructor(nextVideo, true);
        bindingB = bindingForB;
        Object.defineProperty(nextVideo, 'currentTime', { configurable: true, value: 3.5 });

        binding.bind();
        bindingForB.bind();
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }
        expect(requests).toHaveLength(1);
        expect(responses[0]).toMatchObject({ videoId, videoSrc, subtitles: [captionTrack] });

        await binding.videoDataSyncController.show({ reason: VideoDataUiOpenReason.userRequested });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        const firstOpenModelA = fixture.frameStates.find(({ state }) => state.open === true);
        if (
            firstOpenModelA === undefined ||
            typeof firstOpenModelA.state.requestId !== 'string' ||
            firstOpenModelA.frame.contentWindow === null
        ) {
            throw new Error('Initial TikTok picker model was not available');
        }
        const { frame: frameA, state: firstModelA } = firstOpenModelA;
        expect(firstModelA.subtitles).toEqual([captionTrack]);
        Object.defineProperty(oldVideo, 'currentTime', { configurable: true, value: 1 });
        window.dispatchEvent(
            new MessageEvent('message', {
                source: frameA.contentWindow,
                data: {
                    sender: 'asbplayer-frame',
                    message: {
                        command: 'onServerMessage',
                        message: {
                            command: 'confirm',
                            requestId: firstModelA.requestId,
                            data: [captionTrack],
                            shouldRememberTrackChoices: false,
                        },
                    },
                },
            })
        );
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }
        await waitForSubtitleRender();
        expect(binding.subtitleController.subtitles).toHaveLength(1);
        expect(document.querySelector('.asbplayer-subtitles-container-bottom')?.textContent).toContain('Hello');

        await binding.videoDataSyncController.show({ reason: VideoDataUiOpenReason.userRequested });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }
        const openModelsA = fixture.frameStates.filter(({ state }) => state.open === true);
        const openModelA = openModelsA.at(-1);
        if (
            openModelA === undefined ||
            typeof openModelA.state.requestId !== 'string' ||
            openModelA.frame.contentWindow === null
        ) {
            throw new Error('Reopened TikTok picker model was not available');
        }
        const requestIdA = openModelA.state.requestId;
        expect(openModelA.state.subtitles).toEqual([captionTrack]);

        oldVideo.getBoundingClientRect = offscreenVideoRect;
        hydrationScript.textContent = JSON.stringify(pageData(nextVideoId, 'Next TikTok clip', nextCaptionUrl));
        nextVideo.getBoundingClientRect = visibleVideoRect;
        window.dispatchEvent(new Event('scroll'));
        for (let i = 0; i < 10 && requests.length < 2; i++) {
            await waitForMicrotasks();
        }

        expect(requests).toHaveLength(2);
        expect(requests[1]).toMatchObject({ videoId: nextVideoId, videoSrc: nextVideoSrc });
        expect(contexts).toContainEqual({ videoSrc: nextVideoSrc, videoId: nextVideoId });
        expect(responses).toHaveLength(2);
        expect(responses[1]).toMatchObject({
            videoId: nextVideoId,
            videoSrc: nextVideoSrc,
            subtitles: [nextCaptionTrack],
        });
        expect(document.querySelector('.asbplayer-subtitles-container-bottom')?.textContent ?? '').not.toContain(
            'Hello'
        );

        await bindingForB.videoDataSyncController.show({ reason: VideoDataUiOpenReason.userRequested });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }
        const openModels = fixture.frameStates.filter(({ state }) => state.open === true);
        const openModelB = openModels.at(-1);
        if (
            openModelB === undefined ||
            typeof openModelB.state.requestId !== 'string' ||
            openModelB.frame.contentWindow === null
        ) {
            throw new Error('Updated TikTok picker model was not available');
        }
        const { frame: frameB, state: modelB } = openModelB;
        expect(frameB).not.toBe(frameA);
        expect(modelB.requestId).not.toBe(requestIdA);
        expect(modelB.subtitles).toEqual([nextCaptionTrack]);

        const dispatchPickerMessage = (frame: HTMLIFrameElement, message: Record<string, unknown>) => {
            if (frame.contentWindow === null) {
                throw new Error('Video data picker frame was not available');
            }
            window.dispatchEvent(
                new MessageEvent('message', {
                    source: frame.contentWindow,
                    data: {
                        sender: 'asbplayer-frame',
                        message: { command: 'onServerMessage', message },
                    },
                })
            );
        };
        dispatchPickerMessage(frameA, { command: 'cancel', requestId: requestIdA });
        await waitForMicrotasks();
        expect(binding.videoDataSyncController.pickerVisible).toBe(false);
        expect(bindingForB.videoDataSyncController.pickerVisible).toBe(true);

        dispatchPickerMessage(frameA, {
            command: 'confirm',
            requestId: requestIdA,
            data: [captionTrack],
            shouldRememberTrackChoices: false,
        });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        expect(binding.videoDataSyncController.pickerVisible).toBe(false);
        expect(bindingForB.videoDataSyncController.pickerVisible).toBe(true);
        expect(binding.subtitleController.subtitles).toHaveLength(0);

        dispatchPickerMessage(frameB, {
            command: 'confirm',
            requestId: modelB.requestId,
            data: [nextCaptionTrack],
            shouldRememberTrackChoices: false,
        });
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        expect(bindingForB.videoDataSyncController.pickerVisible).toBe(false);
        expect(bindingForB.subtitleController.subtitles).toHaveLength(1);
        expect(bindingForB.subtitleController.subtitles[0]).toMatchObject({
            text: 'Next',
            start: 3000,
            end: 4000,
            track: 0,
        });
        await waitForSubtitleRender();
        expect(document.querySelector('.asbplayer-subtitles-container-bottom')?.textContent ?? '').toContain('Next');
    });
});
