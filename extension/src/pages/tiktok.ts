import type { VideoData, VideoDataSubtitleTrack } from '@project/common';
import { trackFromDef } from './util';

interface TikTokCaptionRequest {
    readonly requestId?: string;
    readonly videoSrc?: string;
    readonly videoId?: string;
}

interface TikTokVideoData extends VideoData {
    readonly requestId?: string;
    readonly videoSrc?: string;
    readonly videoId?: string;
}

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;

const stringValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const numberValue = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
};

const captionUrl = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.trim() === '') {
        return undefined;
    }

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
    } catch {
        return undefined;
    }
};

const videoIdFromPath = (pathname: string): string | undefined => pathname.match(/\/video\/(\d+)/)?.[1];

const videoIdValue = (value: unknown): string | undefined =>
    typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;

const isUnsupportedPath = (pathname: string): boolean =>
    pathname.split('/').some((segment) => ['live', 'photo', 'embed'].includes(segment.toLowerCase()));

const videoIdFromElement = (video: HTMLVideoElement): string | undefined => {
    if (isUnsupportedPath(window.location.pathname)) {
        return undefined;
    }

    let element: Element | null = video;

    while (element !== null) {
        const id = element.getAttribute('id');
        const idMatch = id?.match(/^xgwrapper-\d+-(\d+)$/);
        if (idMatch?.[1] !== undefined) {
            return idMatch[1];
        }

        element = element.parentElement;
    }

    return document.querySelectorAll('video').length === 1 ? videoIdFromPath(window.location.pathname) : undefined;
};

const sourceForVideo = (video: HTMLVideoElement): string | undefined =>
    stringValue(video.src) ?? stringValue(video.currentSrc);

const visibleArea = (element: Element): number => {
    const rect = element.getBoundingClientRect();
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (width <= 0 || height <= 0) {
        return 0;
    }

    const viewportWidth = window.innerWidth > 0 ? window.innerWidth : Number.POSITIVE_INFINITY;
    const viewportHeight = window.innerHeight > 0 ? window.innerHeight : Number.POSITIVE_INFINITY;
    const widthInViewport = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const heightInViewport = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return widthInViewport * heightInViewport;
};

const visibleAreaForVideo = (video: HTMLVideoElement): number => {
    const section = video.closest('section');
    return Math.max(visibleArea(video), section === null ? 0 : visibleArea(section));
};

const videoForRequest = (request: TikTokCaptionRequest): HTMLVideoElement | undefined => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    const matchingVideos = videos.filter((video) => {
        const sourceMatches =
            request.videoSrc === undefined || video.src === request.videoSrc || video.currentSrc === request.videoSrc;
        const idMatches = request.videoId === undefined || videoIdFromElement(video) === request.videoId;
        return sourceMatches && idMatches;
    });
    if (matchingVideos.length === 1) {
        return matchingVideos[0];
    }

    return request.videoSrc === undefined && request.videoId === undefined && videos.length === 1
        ? videos[0]
        : undefined;
};

const hasExpiredCaptionUrl = (item: RecordValue, now: number): boolean => {
    const video = asRecord(item.video);
    const subtitleInfos = video?.subtitleInfos;
    if (!Array.isArray(subtitleInfos)) {
        return false;
    }

    return subtitleInfos.some((definition) => {
        const record = asRecord(definition);
        const expires = numberValue(record?.UrlExpire);
        if (expires === undefined) {
            return false;
        }

        return Number.isInteger(expires) && expires > 0 && expires < 1_000_000_000_000 && expires * 1000 <= now;
    });
};

const itemFromDocument = (sourceDocument: Document): RecordValue | undefined => {
    const script = sourceDocument.querySelector<HTMLScriptElement>('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    const text = script?.textContent;
    if (text === null || text === undefined || text.trim() === '') {
        return undefined;
    }

    try {
        const root = asRecord(JSON.parse(text));
        const defaultScope = asRecord(root?.__DEFAULT_SCOPE__);
        const videoDetail = asRecord(defaultScope?.['webapp.video-detail']);
        const itemInfo = asRecord(videoDetail?.itemInfo);
        return asRecord(itemInfo?.itemStruct);
    } catch {
        return undefined;
    }
};

const itemForVideo = (sourceDocument: Document, videoId: string): RecordValue | undefined => {
    const item = itemFromDocument(sourceDocument);
    return item?.id === videoId ? item : undefined;
};

interface CaptionDefinition {
    readonly language: string;
    readonly label: string;
    readonly url: string;
    readonly extension: 'vtt' | 'creator_caption';
}

const captionDefinition = (value: unknown, now: number): CaptionDefinition | undefined => {
    const record = asRecord(value);
    if (record === undefined) {
        throw new Error('TikTok caption track was malformed');
    }

    const language = stringValue(record.LanguageCodeName);
    const url = captionUrl(record.Url);
    const format = stringValue(record.Format);
    if (language === undefined || url === undefined || format === undefined) {
        throw new Error('TikTok caption track was malformed');
    }

    const expires = record.UrlExpire === undefined ? undefined : numberValue(record.UrlExpire);
    if (
        record.UrlExpire !== undefined &&
        (expires === undefined || !Number.isInteger(expires) || expires <= 0 || expires >= 1_000_000_000_000)
    ) {
        throw new Error('TikTok caption track expiration was malformed');
    }
    if (expires !== undefined) {
        if (expires * 1000 <= now) {
            return undefined;
        }
    }

    const extension = format === 'webvtt' ? 'vtt' : format === 'creator_caption' ? 'creator_caption' : undefined;
    if (extension === undefined) {
        throw new Error('TikTok caption format was unsupported');
    }

    return {
        language: language.toLowerCase(),
        label: language,
        url,
        extension,
    };
};

const vttTimestamp = (milliseconds: number): string => {
    const totalMilliseconds = Math.max(0, Math.round(milliseconds));
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const millis = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

const creatorCaptionText = (value: unknown): string | undefined => {
    const root = asRecord(value);
    const utterances = root?.utterances;
    if (!Array.isArray(utterances)) {
        return undefined;
    }

    const cues = utterances.map((utterance, index) => {
        const record = asRecord(utterance);
        const text = stringValue(record?.text);
        const start = record?.start_time;
        const end = record?.end_time;
        if (
            text === undefined ||
            typeof start !== 'number' ||
            !Number.isFinite(start) ||
            start < 0 ||
            typeof end !== 'number' ||
            !Number.isFinite(end) ||
            end <= start
        ) {
            throw new Error('TikTok creator caption data was malformed');
        }

        return `${index + 1}\n${vttTimestamp(start)} --> ${vttTimestamp(end)}\n${text}`;
    });

    return cues.length === 0 ? undefined : `WEBVTT\n\n${cues.join('\n\n')}\n`;
};

const creatorCaptionTrack = async (
    caption: CaptionDefinition,
    signal?: AbortSignal
): Promise<VideoDataSubtitleTrack> => {
    const response = await fetch(caption.url, { credentials: 'include', signal });
    if (!response.ok) {
        throw new Error(`TikTok caption request failed with status ${response.status}`);
    }

    const body = await response.text();
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new Error('TikTok creator caption data was malformed');
    }

    const vtt = creatorCaptionText(parsed);
    if (vtt === undefined) {
        throw new Error('TikTok creator caption data had no timed utterances');
    }

    const track = {
        ...caption,
        extension: 'vtt' as const,
        url: `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`,
    };
    return trackFromDef(track);
};

const captionsForItem = async (
    item: RecordValue,
    now: number,
    signal?: AbortSignal
): Promise<VideoDataSubtitleTrack[]> => {
    const video = asRecord(item.video);
    if (video === undefined) {
        return [];
    }

    const subtitleInfos = video.subtitleInfos;
    if (subtitleInfos === undefined) {
        return [];
    }
    if (!Array.isArray(subtitleInfos)) {
        throw new Error('TikTok subtitle track data was malformed');
    }

    const definitions = subtitleInfos;
    const candidatesByLanguage = new Map<string, CaptionDefinition[]>();

    for (const definition of definitions) {
        const caption = captionDefinition(definition, now);
        if (caption === undefined) {
            continue;
        }

        const candidates = candidatesByLanguage.get(caption.language) ?? [];
        candidatesByLanguage.set(caption.language, [...candidates, caption]);
    }

    const tracks: VideoDataSubtitleTrack[] = [];
    for (const candidates of candidatesByLanguage.values()) {
        const preferred = [...candidates].sort(
            (left, right) =>
                ({ vtt: 1, creator_caption: 0 })[right.extension] - { vtt: 1, creator_caption: 0 }[left.extension]
        )[0];
        if (preferred === undefined) {
            continue;
        }

        const track =
            preferred.extension === 'creator_caption'
                ? await creatorCaptionTrack(preferred, signal)
                : trackFromDef(preferred);
        tracks.push(track);
    }

    return tracks;
};

const responseForItem = async (
    item: RecordValue,
    request: TikTokCaptionRequest,
    videoId: string,
    now: number,
    fallbackBasename: string,
    signal?: AbortSignal
): Promise<TikTokVideoData> => ({
    requestId: request.requestId,
    videoSrc: request.videoSrc,
    videoId,
    error: '',
    basename: stringValue(item.desc) ?? fallbackBasename,
    subtitles: await captionsForItem(item, now, signal),
});

const canonicalUrl = (video: HTMLVideoElement | undefined, videoId: string): string => {
    if (isUnsupportedPath(window.location.pathname)) {
        throw new Error('TikTok video type is unsupported');
    }

    const directPath = window.location.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/);
    if (directPath?.[1] === videoId) {
        return `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
    }

    const section = video?.closest('section');
    const href = section?.querySelector<HTMLAnchorElement>('a[href^="/@"]')?.getAttribute('href');
    if (href !== null && href !== undefined) {
        try {
            const url = new URL(href, window.location.href);
            const creatorPath = url.pathname.match(/^\/@([^/]+)\/?$/);
            if (url.origin === window.location.origin && creatorPath?.[1] !== undefined) {
                return `${url.origin}/@${creatorPath[1]}/video/${videoId}`;
            }
        } catch {
            // Fall through to the explicit error below.
        }
    }

    throw new Error('Could not determine TikTok canonical video URL');
};

const itemFromCanonicalPage = async (
    video: HTMLVideoElement | undefined,
    videoId: string,
    signal?: AbortSignal
): Promise<RecordValue> => {
    const response = await fetch(canonicalUrl(video, videoId), { credentials: 'include', signal });
    if (!response.ok) {
        throw new Error(`TikTok video request failed with status ${response.status}`);
    }

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const item = itemForVideo(parsed, videoId);
    if (item === undefined) {
        throw new Error('TikTok response did not contain the requested video');
    }

    return item;
};

const readRequest = (event: Event): TikTokCaptionRequest => {
    const detail = event instanceof CustomEvent ? asRecord(event.detail) : undefined;
    return {
        requestId: stringValue(detail?.requestId),
        videoSrc: stringValue(detail?.videoSrc),
        videoId: videoIdValue(detail?.videoId),
    };
};

const publish = (data: TikTokVideoData) => {
    document.dispatchEvent(new CustomEvent('asbplayer-synced-data', { detail: data }));
};

export const installTikTokPageScript = (): (() => void) => {
    const videoListeners = new Map<HTMLVideoElement, EventListener>();
    const pendingRequests = new Map<AbortController, { contextVersion: number; videoId: string | undefined }>();
    let activeVideo: HTMLVideoElement | undefined;
    let lastContext: { videoSrc: string; videoId: string } | undefined;
    let contextVersion = 0;
    let disposed = false;

    const abortObsoleteRequests = (currentContextVersion: number) => {
        for (const [controller, request] of pendingRequests) {
            if (request.contextVersion < currentContextVersion) {
                controller.abort();
                pendingRequests.delete(controller);
            }
        }
    };

    const abortSupersededRequests = (requestContextVersion: number, videoId: string | undefined) => {
        for (const [controller, request] of pendingRequests) {
            if (request.contextVersion === requestContextVersion && request.videoId === videoId) {
                controller.abort();
                pendingRequests.delete(controller);
            }
        }
    };

    const publishVideoContext = (video: HTMLVideoElement) => {
        if (disposed) {
            return;
        }

        const videoSrc = sourceForVideo(video);
        const videoId = videoIdFromElement(video);
        if (videoSrc === undefined || videoId === undefined) {
            return;
        }

        const context = { videoSrc, videoId };
        if (lastContext?.videoSrc === context.videoSrc && lastContext.videoId === context.videoId) {
            activeVideo = video;
            return;
        }

        activeVideo = video;
        lastContext = context;
        contextVersion += 1;
        abortObsoleteRequests(contextVersion);
        document.dispatchEvent(new CustomEvent('asbplayer-tiktok-video-context', { detail: context }));
    };

    const currentVideoFor = (videos: HTMLVideoElement[], preferredVideo?: HTMLVideoElement) => {
        const visibleVideos = videos
            .map((video) => ({ video, area: visibleAreaForVideo(video) }))
            .filter(
                ({ video, area }) =>
                    videoIdFromElement(video) !== undefined && sourceForVideo(video) !== undefined && area > 0
            )
            .sort((left, right) => right.area - left.area);
        if (visibleVideos[0] !== undefined) {
            return visibleVideos[0].video;
        }

        const directVideoId = videoIdFromPath(window.location.pathname);
        const directVideo = videos.find((video) => videoIdFromElement(video) === directVideoId);
        if (directVideo !== undefined) {
            return directVideo;
        }

        if (preferredVideo !== undefined && videos.includes(preferredVideo)) {
            return preferredVideo;
        }

        if (activeVideo !== undefined && videos.includes(activeVideo)) {
            return activeVideo;
        }

        const playingVideo = videos.find((video) => !video.paused);
        if (playingVideo !== undefined) {
            return playingVideo;
        }

        return videos.length === 1 ? videos[0] : undefined;
    };

    function scanVideos(preferredVideo?: HTMLVideoElement) {
        if (disposed) {
            return;
        }

        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        for (const video of videos) {
            if (videoListeners.has(video)) {
                continue;
            }

            const listener = () => scanVideos(video);
            for (const eventName of ['play', 'pause', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied']) {
                video.addEventListener(eventName, listener);
            }
            videoListeners.set(video, listener);
        }

        for (const [video, listener] of videoListeners) {
            if (videos.includes(video)) {
                continue;
            }

            for (const eventName of ['play', 'pause', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied']) {
                video.removeEventListener(eventName, listener);
            }
            videoListeners.delete(video);
        }

        if (activeVideo !== undefined && !videos.includes(activeVideo)) {
            activeVideo = undefined;
            lastContext = undefined;
            contextVersion += 1;
            abortObsoleteRequests(contextVersion);
        }

        const currentVideo = currentVideoFor(videos, preferredVideo);
        if (currentVideo !== undefined) {
            publishVideoContext(currentVideo);
        }
    }

    const requestListener = (event: Event) => {
        if (disposed) {
            return;
        }

        const request = readRequest(event);
        if (isUnsupportedPath(window.location.pathname)) {
            publish({
                requestId: request.requestId,
                videoSrc: request.videoSrc,
                videoId: request.videoId,
                error: 'TikTok video type is unsupported',
                basename: '',
                subtitles: [],
            });
            return;
        }

        const video = videoForRequest(request);
        if (request.videoSrc !== undefined && request.videoId !== undefined && video === undefined) {
            publish({
                requestId: request.requestId,
                videoSrc: request.videoSrc,
                videoId: request.videoId,
                error: 'TikTok request did not match a video binding',
                basename: '',
                subtitles: [],
            });
            return;
        }

        const videoId = request.videoId ?? (video === undefined ? undefined : videoIdFromElement(video));
        const requestContextVersion = contextVersion;
        const requestContext = lastContext;
        const requestController = new AbortController();
        const requestIsCurrent = () => {
            if (disposed || requestController.signal.aborted || contextVersion !== requestContextVersion) {
                return false;
            }

            return (
                requestContext === undefined ||
                (requestContext.videoId === videoId &&
                    (request.videoSrc === undefined || requestContext.videoSrc === request.videoSrc))
            );
        };
        if (requestIsCurrent()) {
            abortSupersededRequests(requestContextVersion, videoId);
        }
        pendingRequests.set(requestController, { contextVersion: requestContextVersion, videoId });

        void (async () => {
            if (videoId === undefined) {
                publish({
                    requestId: request.requestId,
                    videoSrc: request.videoSrc,
                    error: 'Could not determine TikTok video ID',
                    basename: '',
                    subtitles: [],
                });
                return;
            }

            if (!requestIsCurrent()) {
                return;
            }

            const now = Date.now();
            const initialItem = itemForVideo(document, videoId);
            const item =
                initialItem !== undefined && hasExpiredCaptionUrl(initialItem, now)
                    ? await itemFromCanonicalPage(video, videoId, requestController.signal)
                    : (initialItem ?? (await itemFromCanonicalPage(video, videoId, requestController.signal)));
            const data = await responseForItem(
                item,
                request,
                videoId,
                Date.now(),
                document.title,
                requestController.signal
            );
            if (requestIsCurrent()) {
                publish(data);
            }
        })()
            .catch((error: unknown) => {
                if (requestIsCurrent()) {
                    publish({
                        requestId: request.requestId,
                        videoSrc: request.videoSrc,
                        videoId,
                        error: error instanceof Error ? error.message : String(error),
                        basename: '',
                        subtitles: [],
                    });
                }
            })
            .finally(() => {
                pendingRequests.delete(requestController);
            })
            .catch(() => {
                // Keep cleanup independent from a consumer's event handler.
            });
    };

    const contextRequestListener = () => {
        if (disposed) {
            return;
        }

        if (lastContext !== undefined) {
            document.dispatchEvent(new CustomEvent('asbplayer-tiktok-video-context', { detail: lastContext }));
            return;
        }

        scanVideos();
    };

    document.addEventListener('asbplayer-get-synced-data', requestListener, false);
    document.addEventListener('asbplayer-get-tiktok-video-context', contextRequestListener, false);
    const scanListener = () => scanVideos();
    for (const eventName of ['scroll', 'resize', 'fullscreenchange']) {
        window.addEventListener(eventName, scanListener, true);
    }
    scanVideos();
    const videoScanInterval = setInterval(scanVideos, 500);

    return () => {
        if (disposed) {
            return;
        }

        disposed = true;
        for (const controller of pendingRequests.keys()) {
            controller.abort();
        }
        pendingRequests.clear();
        document.removeEventListener('asbplayer-get-synced-data', requestListener, false);
        document.removeEventListener('asbplayer-get-tiktok-video-context', contextRequestListener, false);
        for (const eventName of ['scroll', 'resize', 'fullscreenchange']) {
            window.removeEventListener(eventName, scanListener, true);
        }
        clearInterval(videoScanInterval);
        for (const [video, listener] of videoListeners) {
            for (const eventName of ['play', 'pause', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied']) {
                video.removeEventListener(eventName, listener);
            }
        }
        videoListeners.clear();
    };
};
