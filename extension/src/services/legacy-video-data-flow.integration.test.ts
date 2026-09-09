/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://www.youtube.com/watch?v=legacy-video"}
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { VideoDataUiOpenReason } from '@project/common';
import { createVideoDataFlowTestFixture, responseFor, visibleVideoRect } from './video-data-flow-test-fixture';

// This dependency is ESM-only and is not used by the WebVTT path exercised here.
jest.mock('@qgustavor/srt-parser', () => ({
    __esModule: true,
    default: class SrtParser {},
}));

const videoSrc = 'https://cdn.example/one.mp4';
const captionUrl = 'https://cdn.example/legacy.vtt';
const captionTrack = {
    id: `en:English:${captionUrl}`,
    label: 'English',
    language: 'en',
    url: captionUrl,
    extension: 'vtt',
};

const waitForMicrotasks = async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('legacy page to binding caption flow', () => {
    const fixture = createVideoDataFlowTestFixture();
    let binding: import('./binding').default | undefined;
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

            throw new Error(`Unexpected fetch: ${String(url)}`);
        });
        document.body.innerHTML = `
            <video src="${videoSrc}"></video>
        `;
        const video = document.querySelector('video');
        if (!(video instanceof HTMLMediaElement)) {
            throw new Error('Test video was not created');
        }
        fixture.prepareVideo(video, visibleVideoRect());
        fixture.startFrameObserver();
        binding = new fixture.bindingConstructor(video, true);
    });

    afterEach(() => {
        binding?.unbind();
        binding = undefined;
        for (const dispose of eventDisposers.splice(0)) {
            dispose();
        }
        fixture.afterEach();
    });

    it('accepts a legacy unscoped page response and loads its timed track', async () => {
        if (binding === undefined) {
            throw new Error('Binding was not created');
        }

        const requests: unknown[] = [];
        const responses: unknown[] = [];
        const addDocumentListener = (type: string, listener: EventListener) => {
            document.addEventListener(type, listener);
            eventDisposers.push(() => document.removeEventListener(type, listener));
        };
        addDocumentListener('asbplayer-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                responses.push(event.detail);
            }
        });
        addDocumentListener('asbplayer-get-synced-data', (event) => {
            if (event instanceof CustomEvent) {
                requests.push(event.detail);
                document.dispatchEvent(
                    new CustomEvent('asbplayer-synced-data', {
                        detail: { basename: 'Legacy clip', subtitles: [captionTrack] },
                    })
                );
            }
        });
        binding.bind();
        for (let i = 0; i < 5; i++) {
            await waitForMicrotasks();
        }

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ requestId: expect.any(String) });
        expect(responses).toEqual([{ basename: 'Legacy clip', subtitles: [captionTrack] }]);

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
        expect(binding.subtitleController.subtitleFileNames?.[0]).toContain('Legacy clip');
    });
});
