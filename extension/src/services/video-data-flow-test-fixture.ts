import { jest } from '@jest/globals';
import { MockStorageArea } from './mock-storage-area';

type RuntimeListener = (...args: unknown[]) => void;

export type TestFetchResponse = {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly text: () => Promise<string>;
    readonly json: () => Promise<unknown>;
    readonly arrayBuffer: () => Promise<ArrayBuffer>;
};

export type TestFetch = (url: string | URL | Request) => Promise<TestFetchResponse>;

export interface FrameStateUpdate {
    readonly frame: HTMLIFrameElement;
    readonly state: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export const responseFor = (body: string): TestFetchResponse => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => Uint8Array.from([...body].map((character) => character.charCodeAt(0))).buffer,
});

export const visibleVideoRect = (): DOMRect => ({
    bottom: 720,
    height: 720,
    left: 0,
    right: 1280,
    top: 0,
    width: 1280,
    x: 0,
    y: 0,
    toJSON: () => ({}),
});

export const offscreenVideoRect = (): DOMRect => ({
    bottom: window.innerHeight + 200,
    height: 100,
    left: 0,
    right: 100,
    top: window.innerHeight + 100,
    width: 100,
    x: 0,
    y: window.innerHeight + 100,
    toJSON: () => ({}),
});

export interface VideoDataFlowTestFixture {
    readonly storage: MockStorageArea;
    readonly frameStates: FrameStateUpdate[];
    readonly bindingConstructor: typeof import('./binding').default;
    beforeAll(): Promise<void>;
    beforeEach(fetchHandler: TestFetch): Promise<void>;
    prepareVideo(video: HTMLMediaElement, rect?: DOMRect): void;
    startFrameObserver(): void;
    afterEach(): void;
    afterAll(): void;
}

export const createVideoDataFlowTestFixture = (): VideoDataFlowTestFixture => {
    const storage = new MockStorageArea();
    const frameStates: FrameStateUpdate[] = [];
    let bindingConstructor: typeof import('./binding').default | undefined;
    let originalFetch: typeof fetch;
    let frameObserver: MutationObserver | undefined;
    let originalBrowserDescriptor: PropertyDescriptor | undefined;
    let originalChromeDescriptor: PropertyDescriptor | undefined;
    let originalFileTextDescriptor: PropertyDescriptor | undefined;
    let originalFileArrayBufferDescriptor: PropertyDescriptor | undefined;
    const frameListeners: Array<{ readonly window: Window; readonly listener: EventListener }> = [];
    const readyTimeouts: ReturnType<typeof setTimeout>[] = [];

    const restoreProperty = (target: object, key: string, descriptor: PropertyDescriptor | undefined) => {
        if (descriptor === undefined) {
            Reflect.deleteProperty(target, key);
        } else {
            Object.defineProperty(target, key, descriptor);
        }
    };

    const restoreFileMethods = () => {
        restoreProperty(File.prototype, 'text', originalFileTextDescriptor);
        restoreProperty(File.prototype, 'arrayBuffer', originalFileArrayBufferDescriptor);
    };

    const installFileMethods = () => {
        Object.defineProperty(File.prototype, 'text', {
            configurable: true,
            value(this: File) {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsText(this);
                });
            },
        });
        Object.defineProperty(File.prototype, 'arrayBuffer', {
            configurable: true,
            value(this: File) {
                return new Promise<ArrayBuffer>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        if (reader.result instanceof ArrayBuffer) {
                            resolve(reader.result);
                        } else {
                            reject(new Error('FileReader returned a non-buffer result'));
                        }
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsArrayBuffer(this);
                });
            },
        });
    };

    const prepareVideo = (video: HTMLMediaElement, rect = visibleVideoRect()) => {
        Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
        Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
        jest.spyOn(video, 'play').mockResolvedValue(undefined);
        jest.spyOn(video, 'pause').mockImplementation(() => undefined);
        video.getBoundingClientRect = () => rect;
    };

    const startFrameObserver = () => {
        frameObserver = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (!(node instanceof HTMLIFrameElement)) {
                        continue;
                    }

                    const frameWindow = node.contentWindow;
                    if (frameWindow !== null) {
                        const listener = (event: Event) => {
                            const data = Reflect.get(event, 'data');
                            if (!isRecord(data) || data.sender !== 'asbplayer-video' || !isRecord(data.message)) {
                                return;
                            }

                            const message = data.message.message;
                            if (!isRecord(message) || message.command !== 'updateState' || !isRecord(message.state)) {
                                return;
                            }

                            frameStates.push({ frame: node, state: message.state });
                        };
                        frameWindow.addEventListener('message', listener);
                        frameListeners.push({ window: frameWindow, listener });
                    }

                    readyTimeouts.push(
                        setTimeout(() => {
                            window.dispatchEvent(
                                new MessageEvent('message', {
                                    source: node.contentWindow,
                                    data: {
                                        sender: 'asbplayer-frame',
                                        message: { command: 'ready', frameId: 'test-frame' },
                                    },
                                })
                            );
                        }, 0)
                    );
                }
            }
        });
        frameObserver.observe(document.body, { childList: true });
    };

    const fixture = {
        storage,
        frameStates,
        get bindingConstructor() {
            if (bindingConstructor === undefined) {
                throw new Error('Binding constructor was not initialized');
            }
            return bindingConstructor;
        },
        async beforeAll() {
            originalBrowserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'browser');
            originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
            originalFileTextDescriptor = Object.getOwnPropertyDescriptor(File.prototype, 'text');
            originalFileArrayBufferDescriptor = Object.getOwnPropertyDescriptor(File.prototype, 'arrayBuffer');

            const listeners = new Set<RuntimeListener>();
            const sendMessage = jest.fn((...args: unknown[]) => {
                const callback = args.at(-1);
                if (typeof callback === 'function') {
                    callback(undefined);
                }
                return Promise.resolve(undefined);
            });
            const browserApi = {
                storage: { local: storage, session: storage },
                runtime: {
                    getURL: (path: string) => `https://extension.test${path}`,
                    getManifest: () => ({ version: 'test' }),
                    sendMessage,
                    lastError: undefined,
                    onMessage: {
                        addListener: (listener: RuntimeListener) => listeners.add(listener),
                        removeListener: (listener: RuntimeListener) => listeners.delete(listener),
                    },
                },
            };
            Object.defineProperty(globalThis, 'browser', { configurable: true, writable: true, value: browserApi });
            Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: browserApi });
            bindingConstructor = (await import('./binding')).default;
        },
        async beforeEach(fetchHandler: TestFetch) {
            await storage.clear();
            await storage.set({ streamingAutoSync: false });
            frameStates.length = 0;
            originalFetch = globalThis.fetch;
            Object.defineProperty(globalThis, 'fetch', {
                configurable: true,
                value: fetchHandler,
            });
            installFileMethods();
            jest.spyOn(window, 'focus').mockImplementation(() => undefined);
        },
        prepareVideo,
        startFrameObserver,
        afterEach() {
            frameObserver?.disconnect();
            frameObserver = undefined;
            for (const { window: frameWindow, listener } of frameListeners.splice(0)) {
                frameWindow.removeEventListener('message', listener);
            }
            for (const timeout of readyTimeouts.splice(0)) {
                clearTimeout(timeout);
            }
            restoreFileMethods();
            Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
            document.body.innerHTML = '';
            jest.restoreAllMocks();
        },
        afterAll() {
            restoreProperty(globalThis, 'browser', originalBrowserDescriptor);
            restoreProperty(globalThis, 'chrome', originalChromeDescriptor);
            restoreFileMethods();
        },
    } satisfies Omit<VideoDataFlowTestFixture, 'bindingConstructor'> & {
        readonly bindingConstructor: typeof import('./binding').default;
    };

    return fixture;
};
