import {
    ActiveProfileMessage,
    ConfirmedVideoDataSubtitleTrack,
    OpenAsbplayerSettingsMessage,
    SerializedSubtitleFile,
    SettingsUpdatedMessage,
    VideoData,
    VideoDataSubtitleTrack,
    VideoDataUiBridgeConfirmMessage,
    VideoDataUiBridgeCancelMessage,
    VideoDataUiBridgeOpenFileMessage,
    VideoDataUiBridgeSetOnlineSubtitleSourceConfigMessage,
    VideoDataUiModel,
    VideoDataUiOpenReason,
    VideoToExtensionCommand,
} from '@project/common';
import { AsbplayerSettings, SettingsProvider } from '@project/common/settings';
import { base64ToBlob, bufferToBase64 } from '@project/common/base64';
import Binding from '../services/binding';
import { currentPageDelegate } from '../services/pages';
import UiFrame, { uiFrameForHtml } from '../services/ui-frame';
import { fetchLocalization } from '../services/localization-fetcher';
import i18n from 'i18next';
import { ExtensionGlobalStateProvider } from '@/services/extension-global-state-provider';
import { isOnTutorialPage } from '@/services/tutorial';
import { extractExtension } from '@/pages/util';
import { v4 as uuidv4 } from 'uuid';

declare global {
    function cloneInto(obj: any, targetScope: any, options?: any): any;
}

async function html(lang: string) {
    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>asbplayer - Video Data Sync</title>
                <style>
                    @import url(${browser.runtime.getURL('/fonts/fonts.css')});
                </style>
            </head>
            <body>
                <div id="root" style="width:100%;height:100vh;"></div>
                <script type="application/json" id="loc">${JSON.stringify(await fetchLocalization(lang))}</script>
                <script type="module" src="${browser.runtime.getURL('/video-data-sync-ui.js')}"></script>
            </body>
            </html>`;
}

interface ShowOptions {
    reason: VideoDataUiOpenReason;
    fromAsbplayerId?: string;
}

const fetchDataForLanguageOnDemand = (language: string): Promise<VideoData> => {
    return new Promise((resolve) => {
        const listener = (event: Event) => {
            const data = (event as CustomEvent).detail as VideoData;
            resolve(data);
            document.removeEventListener('asbplayer-synced-language-data', listener, false);
        };
        document.addEventListener('asbplayer-synced-language-data', listener, false);
        document.dispatchEvent(new CustomEvent('asbplayer-get-synced-language-data', { detail: language }));
    });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const isSubtitleUrl = (value: unknown): value is string | string[] =>
    (typeof value === 'string' && value.length > 0) ||
    (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string' && part.length > 0));

const isVideoDataSubtitleTrack = (value: unknown): value is VideoDataSubtitleTrack => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        typeof value.label === 'string' &&
        (value.language === undefined || typeof value.language === 'string') &&
        (value.file === undefined || value.file instanceof File) &&
        isSubtitleUrl(value.url) &&
        typeof value.extension === 'string'
    );
};

const isVideoData = (value: unknown): value is VideoData => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.basename === 'string' &&
        (value.error === undefined || typeof value.error === 'string') &&
        (value.requestId === undefined || typeof value.requestId === 'string') &&
        (value.videoSrc === undefined || typeof value.videoSrc === 'string') &&
        (value.videoId === undefined || typeof value.videoId === 'string') &&
        (value.subtitles === undefined ||
            (Array.isArray(value.subtitles) && value.subtitles.every(isVideoDataSubtitleTrack)))
    );
};

const globalStateProvider = new ExtensionGlobalStateProvider();

export default class VideoDataSyncController {
    private readonly _context: Binding;
    private readonly _domain: string;
    private readonly _frame: UiFrame;
    private readonly _settings: SettingsProvider;

    private _autoSync?: boolean;
    private _lastLanguagesSynced: { [key: string]: string[] };
    private _emptySubtitle: VideoDataSubtitleTrack;
    private _syncedData?: VideoData;
    private _wasPaused?: boolean;
    private _playBlocker?: () => void;
    private _openedLocation?: string;
    private _fullscreenElement?: Element;
    private _activeElement?: Element;
    private _autoSyncAttempted: boolean = false;
    private _dataReceivedListener?: (event: Event) => void;
    private _activeRequestId?: string;
    private _scopedRequests = false;
    private _isTutorial: boolean;

    constructor(context: Binding, settings: SettingsProvider) {
        this._context = context;
        this._settings = settings;
        this._autoSync = false;
        this._lastLanguagesSynced = {};
        this._emptySubtitle = {
            id: '-',
            language: '-',
            url: '-',
            label: i18n.t('extension.videoDataSync.emptySubtitleTrack'),
            extension: 'srt',
        };
        this._domain = new URL(window.location.href).host;
        this._frame = uiFrameForHtml(html);
        this._isTutorial = isOnTutorialPage();
    }

    private get lastLanguagesSynced(): string[] {
        return this._lastLanguagesSynced[this._domain] ?? [];
    }

    private set lastLanguagesSynced(value: string[]) {
        this._lastLanguagesSynced[this._domain] = value;
    }

    unbind() {
        if (this._dataReceivedListener) {
            document.removeEventListener('asbplayer-synced-data', this._dataReceivedListener, false);
        }

        this._dataReceivedListener = undefined;
        this._syncedData = undefined;
        this._activeRequestId = undefined;
        this._scopedRequests = false;
        this._cleanupPlayBlocker();
        this._openedLocation = undefined;
    }

    updateSettings({ streamingAutoSync, streamingLastLanguagesSynced }: AsbplayerSettings) {
        this._autoSync = streamingAutoSync;
        this._lastLanguagesSynced = streamingLastLanguagesSynced;

        if (this._frame.clientIfLoaded !== undefined) {
            void this._context.settings.getSingle('themeType').then((themeType) => {
                const profilesPromise = this._context.settings.profiles();
                const activeProfilePromise = this._context.settings.activeProfile();
                void Promise.all([profilesPromise, activeProfilePromise]).then(([profiles, activeProfile]) => {
                    this._frame.clientIfLoaded?.updateState({
                        settings: {
                            themeType,
                            profiles,
                            activeProfile: activeProfile?.name,
                        },
                    });
                });
            });
        }
    }

    get pickerVisible(): boolean {
        return !this._frame.hidden;
    }

    get openedLocation(): string | undefined {
        return this._openedLocation;
    }

    invalidatePendingRequest(dismissPicker = false) {
        if (dismissPicker && this.pickerVisible) {
            this._hideAndResume(false);
        }
        this._activeRequestId = undefined;
        this._syncedData = undefined;
        this._autoSyncAttempted = false;
    }

    async requestSubtitles(videoId?: string, force = false) {
        if (!this._context.hasPageScript) {
            return;
        }

        // While the picker is open on the same location, skip refresh so
        // player events do not clobber an in-progress user selection. On a
        // true soft-navigation, dismiss the stale picker and continue.
        if (this.pickerVisible) {
            if (force) {
                this._hideAndResume(false);
            } else if (this.openedLocation !== undefined && window.location.href !== this.openedLocation) {
                this._hideAndResume();
            } else {
                return;
            }
        }

        const requestId = uuidv4();
        this._activeRequestId = requestId;
        this._syncedData = undefined;
        this._autoSyncAttempted = false;

        const pageDelegate = await currentPageDelegate();

        if (this._activeRequestId !== requestId || !pageDelegate?.isVideoPage()) {
            return;
        }

        this._scopedRequests = pageDelegate.config.key === 'tiktok';

        if (!this._dataReceivedListener) {
            this._dataReceivedListener = (event: Event) => {
                const detail = event instanceof CustomEvent ? event.detail : undefined;
                if (!isRecord(detail)) {
                    return;
                }

                const data = {
                    ...detail,
                    basename: typeof detail.basename === 'string' ? detail.basename : '',
                };
                if (!isVideoData(data)) {
                    return;
                }

                const activeRequestId = this._activeRequestId;
                if (activeRequestId === undefined) {
                    return;
                }
                if (data.requestId !== undefined && data.requestId !== activeRequestId) {
                    return;
                }
                if (this._scopedRequests && data.requestId !== activeRequestId) {
                    return;
                }
                void this._setSyncedData(data, activeRequestId);
            };
            document.addEventListener('asbplayer-synced-data', this._dataReceivedListener, false);
        }

        if (pageDelegate.config.key === 'youtube') {
            const targetTranslationLanguageCodes =
                (await this._settings.getSingle('streamingPages')).youtube.targetLanguages ?? [];
            if (this._activeRequestId !== requestId) {
                return;
            }
            let payload: Record<string, unknown> = { targetTranslationLanguageCodes, requestId, videoId };
            if (typeof cloneInto === 'function') {
                payload = cloneInto(payload, document.defaultView);
            }
            document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data', { detail: payload }));
        } else {
            document.dispatchEvent(
                new CustomEvent('asbplayer-get-synced-data', {
                    detail: { requestId, videoSrc: this._context.registeredVideoSrc, videoId },
                })
            );
        }
    }

    async show({ reason, fromAsbplayerId }: ShowOptions, requestId = this._activeRequestId) {
        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }
        const client = await this._client(requestId === undefined);
        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }
        const additionalFields: Partial<VideoDataUiModel> = {
            open: true,
            openReason: reason,
        };

        if (fromAsbplayerId !== undefined) {
            additionalFields.openedFromAsbplayerId = fromAsbplayerId;
        }

        const model = await this._buildModel(additionalFields);
        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }
        this._prepareShow();
        if (requestId !== undefined) {
            this._frame.show();
        }
        client.updateState(model);
    }

    private async _buildModel(additionalFields: Partial<VideoDataUiModel>) {
        const requestId = this._activeRequestId;
        const subtitleTrackChoices = this._syncedData?.subtitles ?? [];
        const subs = this._matchLastSyncedWithAvailableTracks();
        const autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks;
        const autoSelectedTrackIds = this._isTutorial
            ? // '1' is the ID of the non-empty track in the tutorial
              // See asbplayer-tutorial-page.ts
              ['1', '-', '-']
            : autoSelectedTracks.map((subtitle) => subtitle.id || '-');
        const defaultCheckboxState = !this._isTutorial && subs.completeMatch;
        const themeType = await this._context.settings.getSingle('themeType');
        const profilesPromise = this._context.settings.profiles();
        const activeProfilePromise = this._context.settings.activeProfile();
        const globalState = await globalStateProvider.get([
            'ftueHasSeenSubtitleTrackSelector',
            'onlineSubtitleSourceConfig',
        ]);
        const hasSeenFtue = globalState.ftueHasSeenSubtitleTrackSelector;
        const onlineSubtitleSourceConfig = globalState.onlineSubtitleSourceConfig;
        const hideRememberTrackPreferenceToggle = this._isTutorial || (await this._pageHidesTrackPrefToggle());
        return this._syncedData
            ? {
                  requestId,
                  isLoading: this._syncedData.subtitles === undefined,
                  suggestedName: this._syncedData.basename,
                  selectedSubtitle: autoSelectedTrackIds,
                  subtitles: subtitleTrackChoices,
                  error: this._syncedData.error,
                  defaultCheckboxState: defaultCheckboxState,
                  openedFromAsbplayerId: '',
                  settings: {
                      themeType: themeType,
                      profiles: await profilesPromise,
                      activeProfile: (await activeProfilePromise)?.name,
                  },
                  hasSeenFtue,
                  hideRememberTrackPreferenceToggle,
                  onlineSubtitleSourceConfig,
                  ...additionalFields,
              }
            : {
                  requestId,
                  isLoading: this._context.hasPageScript,
                  suggestedName: document.title,
                  selectedSubtitle: autoSelectedTrackIds,
                  error: '',
                  subtitles: subtitleTrackChoices,
                  defaultCheckboxState: defaultCheckboxState,
                  openedFromAsbplayerId: '',
                  settings: {
                      themeType: themeType,
                      profiles: await profilesPromise,
                      activeProfile: (await activeProfilePromise)?.name,
                  },
                  hasSeenFtue,
                  hideRememberTrackPreferenceToggle,
                  onlineSubtitleSourceConfig,
                  ...additionalFields,
              };
    }

    private _matchLastSyncedWithAvailableTracks() {
        const subtitleTrackChoices = this._syncedData?.subtitles ?? [];
        const tracks = {
            autoSelectedTracks: [this._emptySubtitle, this._emptySubtitle, this._emptySubtitle],
            completeMatch: false,
        };

        const emptyChoice = this.lastLanguagesSynced.some((lang) => lang !== '-') === undefined;

        if (!subtitleTrackChoices.length && emptyChoice) {
            tracks.completeMatch = true;
        } else {
            let matches: number = 0;
            for (let i = 0; i < this.lastLanguagesSynced.length; i++) {
                const language = this.lastLanguagesSynced[i];
                for (let j = 0; j < subtitleTrackChoices.length; j++) {
                    if (language === '-') {
                        matches++;
                        break;
                    } else if (language === subtitleTrackChoices[j].language) {
                        tracks.autoSelectedTracks[i] = subtitleTrackChoices[j];
                        matches++;
                        break;
                    }
                }
            }
            if (matches === this.lastLanguagesSynced.length) {
                tracks.completeMatch = true;
            }
        }

        return tracks;
    }

    private _defaultVideoName(basename: string | undefined, subtitleTrack: VideoDataSubtitleTrack) {
        if (subtitleTrack.url === '-') {
            return basename ?? '';
        }

        if (basename) {
            return `${basename} - ${subtitleTrack.label}`;
        }

        return subtitleTrack.label;
    }

    private async _setSyncedData(data: VideoData, requestId: string) {
        if (this._activeRequestId !== requestId) {
            return;
        }

        const wasLoading = this._syncedData?.subtitles === undefined;
        this._syncedData = data;

        if (this._syncedData?.subtitles !== undefined && (await this._canAutoSync())) {
            if (this._activeRequestId !== requestId) {
                return;
            }

            if (!this._autoSyncAttempted) {
                this._autoSyncAttempted = true;
                const subs = this._matchLastSyncedWithAvailableTracks();

                if (subs.completeMatch && !this.pickerVisible) {
                    const autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks;
                    await this._syncData(autoSelectedTracks, undefined, requestId);
                } else if (!subs.completeMatch && !this.pickerVisible) {
                    const shouldPrompt = await this._settings.getSingle('streamingAutoSyncPromptOnFailure');

                    if (shouldPrompt && this._activeRequestId === requestId) {
                        await this.show({ reason: VideoDataUiOpenReason.failedToAutoLoadPreferredTrack }, requestId);
                    }
                } else if (wasLoading) {
                    // Picker is open in loading state. Populate it now that tracks have arrived.
                    if (this._activeRequestId === requestId) {
                        const model = await this._buildModel({});
                        if (this._activeRequestId === requestId) {
                            this._frame.clientIfLoaded?.updateState(model);
                        }
                    }
                }
            }
        } else if ((!this.pickerVisible || wasLoading) && this._activeRequestId === requestId) {
            const model = await this._buildModel({});
            if (this._activeRequestId === requestId) {
                this._frame.clientIfLoaded?.updateState(model);
            }
        }
    }

    private async _canAutoSync(): Promise<boolean> {
        const page = await currentPageDelegate();

        if (page === undefined) {
            return this._autoSync ?? false;
        }

        return this._autoSync === true && page.canAutoSync(this._context.video);
    }

    private async _pageHidesTrackPrefToggle() {
        return (await currentPageDelegate())?.config?.hideRememberTrackPreferenceToggle ?? false;
    }

    private async _client(show = true) {
        this._frame.language = await this._settings.getSingle('language');
        const isNewClient = await this._frame.bind();
        const client = await this._frame.client();

        if (isNewClient) {
            client.onMessage((message) => {
                void (async () => {
                    if ('openSettings' === message.command) {
                        const openSettingsCommand: VideoToExtensionCommand<OpenAsbplayerSettingsMessage> = {
                            sender: 'asbplayer-video',
                            message: {
                                command: 'open-asbplayer-settings',
                            },
                            src: this._context.registeredVideoSrc,
                        };
                        void browser.runtime.sendMessage(openSettingsCommand);
                        return;
                    }

                    if ('activeProfile' === message.command) {
                        const activeProfileMessage = message as ActiveProfileMessage;
                        await this._context.settings.setActiveProfile(activeProfileMessage.profile);
                        const settingsUpdatedCommand: VideoToExtensionCommand<SettingsUpdatedMessage> = {
                            sender: 'asbplayer-video',
                            message: {
                                command: 'settings-updated',
                            },
                            src: this._context.registeredVideoSrc,
                        };
                        void browser.runtime.sendMessage(settingsUpdatedCommand);
                        return;
                    }

                    if ('dismissFtue' === message.command) {
                        globalStateProvider.set({ ftueHasSeenSubtitleTrackSelector: true }).catch(console.error);
                        return;
                    }

                    if ('setOnlineSubtitleSourceConfig' === message.command) {
                        const setOnlineSubtitleSourceConfigMessage =
                            message as VideoDataUiBridgeSetOnlineSubtitleSourceConfigMessage;
                        const currentOnlineSubtitleSourceConfig = (
                            await globalStateProvider.get(['onlineSubtitleSourceConfig'])
                        ).onlineSubtitleSourceConfig;

                        await globalStateProvider.set({
                            onlineSubtitleSourceConfig: {
                                ...currentOnlineSubtitleSourceConfig,
                                ...setOnlineSubtitleSourceConfigMessage.state,
                            },
                        });
                        return;
                    }

                    const requestId = this._activeRequestId;

                    if ('cancel' === message.command) {
                        const cancelMessage = message as VideoDataUiBridgeCancelMessage;
                        if (cancelMessage.requestId !== requestId) {
                            return;
                        }
                        this._hideAndResume();
                        return;
                    }

                    let dataWasSynced = true;

                    if ('confirm' === message.command) {
                        const confirmMessage = message as VideoDataUiBridgeConfirmMessage;
                        if (confirmMessage.requestId !== requestId) {
                            return;
                        }
                        const data = confirmMessage.data;

                        dataWasSynced = await this._syncData(data, confirmMessage.syncWithAsbplayerId, requestId);
                        if (dataWasSynced && confirmMessage.shouldRememberTrackChoices) {
                            this.lastLanguagesSynced = data
                                .map((track) => track.language)
                                .filter((language) => language !== undefined);
                            await this._context.settings
                                .set({ streamingLastLanguagesSynced: this._lastLanguagesSynced })
                                .catch(() => {});
                        }
                    } else if ('openFile' === message.command) {
                        const openFileMessage = message as VideoDataUiBridgeOpenFileMessage;
                        if (openFileMessage.requestId !== requestId) {
                            return;
                        }
                        const subtitles = openFileMessage.subtitles;

                        try {
                            dataWasSynced = await this._syncSubtitles(
                                subtitles,
                                false,
                                undefined,
                                requestId === undefined ? undefined : () => this._activeRequestId === requestId
                            );
                        } catch (e) {
                            dataWasSynced = false;
                            if (
                                e instanceof Error &&
                                (requestId === undefined || this._activeRequestId === requestId)
                            ) {
                                await this._reportError(e.message, requestId);
                            }
                        }
                    }

                    if (dataWasSynced && (requestId === undefined || this._activeRequestId === requestId)) {
                        this._hideAndResume();
                    }
                })().catch(console.error);
            });
        }

        if (show) {
            this._frame.show();
        }
        return client;
    }

    private _prepareShow() {
        this._openedLocation = window.location.href;
        this._wasPaused = this._wasPaused ?? this._context.video.paused;
        this._context.pause();

        // Some players (e.g. Hulu) call video.play() on an internal timer that
        // ignores the picker being open. Re-pause on any play event until the
        // picker is dismissed.
        if (!this._playBlocker) {
            this._playBlocker = () => {
                this._context.pause();
            };
            this._context.video.addEventListener('play', this._playBlocker);
        }

        if (document.fullscreenElement) {
            this._fullscreenElement = document.fullscreenElement;
            void document.exitFullscreen();
        }

        if (document.activeElement) {
            this._activeElement = document.activeElement;
        }

        this._context.keyBindings.unbind();
        this._context.subtitleController.forceHideSubtitles = true;
        this._context.mobileVideoOverlayController.forceHide = true;
    }

    private _cleanupPlayBlocker() {
        if (this._playBlocker) {
            this._context.video.removeEventListener('play', this._playBlocker);
            this._playBlocker = undefined;
        }
    }

    private _hideAndResume(resume = true) {
        this._cleanupPlayBlocker();
        this._openedLocation = undefined;
        this._context.keyBindings.bind(this._context);
        this._context.subtitleController.forceHideSubtitles = false;
        this._context.mobileVideoOverlayController.forceHide = false;
        this._frame?.hide();

        if (this._fullscreenElement) {
            void this._fullscreenElement.requestFullscreen();
            this._fullscreenElement = undefined;
        }

        if (this._activeElement) {
            if (typeof (this._activeElement as HTMLElement).focus === 'function') {
                (this._activeElement as HTMLElement).focus();
            }

            this._activeElement = undefined;
        } else {
            window.focus();
        }

        if (resume && !this._wasPaused) {
            void this._context.play();
        }

        this._wasPaused = undefined;
    }

    private async _syncData(
        data: (VideoDataSubtitleTrack | ConfirmedVideoDataSubtitleTrack)[],
        syncWithAsbplayerId?: string,
        requestId?: string
    ) {
        try {
            if (requestId !== undefined && this._activeRequestId !== requestId) {
                return false;
            }

            const subtitles: SerializedSubtitleFile[] = [];

            for (let i = 0; i < data.length; i++) {
                const track = data[i];
                const { extension, url, language, file } = track;
                if (url === undefined) {
                    throw new Error('Subtitle track has no URL');
                }
                const subtitleFiles = await this._subtitlesForUrl(
                    'name' in track ? track.name : this._defaultVideoName(this._syncedData?.basename, track),
                    language,
                    extension,
                    url,
                    file !== undefined,
                    requestId === undefined ? undefined : () => this._activeRequestId === requestId
                );
                if (requestId !== undefined && this._activeRequestId !== requestId) {
                    return false;
                }
                if (subtitleFiles !== undefined) {
                    subtitles.push(...subtitleFiles);
                }
            }

            if (requestId !== undefined && this._activeRequestId !== requestId) {
                return false;
            }

            return await this._syncSubtitles(
                subtitles,
                data.some((track) => typeof track.url === 'object'),
                syncWithAsbplayerId,
                requestId === undefined ? undefined : () => this._activeRequestId === requestId
            );
        } catch (error) {
            if (error instanceof Error && (requestId === undefined || this._activeRequestId === requestId)) {
                await this._reportError(`Data Sync failed: ${error.message}`, requestId);
            }

            return false;
        }
    }

    private async _syncSubtitles(
        serializedFiles: SerializedSubtitleFile[],
        flatten: boolean,
        syncWithAsbplayerId?: string,
        shouldApply?: () => boolean
    ): Promise<boolean> {
        if (shouldApply !== undefined && !shouldApply()) {
            return false;
        }

        const files: File[] = await Promise.all(
            serializedFiles.map(async (f) => new File([base64ToBlob(f.base64, 'text/plain')], f.name))
        );
        if (shouldApply !== undefined && !shouldApply()) {
            return false;
        }
        await this._context.loadSubtitles(files, flatten, syncWithAsbplayerId, shouldApply);
        return shouldApply === undefined || shouldApply();
    }

    private async _subtitlesForUrl(
        name: string,
        language: string | undefined,
        extension: string,
        url: string | string[],
        localFile: boolean | undefined,
        shouldApply?: () => boolean
    ): Promise<SerializedSubtitleFile[] | undefined> {
        if (shouldApply !== undefined && !shouldApply()) {
            return undefined;
        }

        if (url === '-') {
            return [
                {
                    name: `${name}.${extension}`,
                    base64: '',
                },
            ];
        }

        if (url === 'lazy') {
            if (language === undefined) {
                if (shouldApply === undefined || shouldApply()) {
                    await this._reportError('Unable to determine language');
                }
                return undefined;
            }

            const data = await fetchDataForLanguageOnDemand(language);
            if (shouldApply !== undefined && !shouldApply()) {
                return undefined;
            }

            if (data.error) {
                if (shouldApply === undefined || shouldApply()) {
                    await this._reportError(data.error);
                }
                return undefined;
            }

            const lazilyFetchedUrl = data.subtitles?.find((t) => t.language === language)?.url;

            if (lazilyFetchedUrl === undefined) {
                if (shouldApply === undefined || shouldApply()) {
                    await this._reportError('Failed to fetch subtitles for specified language');
                }
                return undefined;
            }

            url = lazilyFetchedUrl;
        }

        if (typeof url === 'string') {
            let response: Response | undefined;
            try {
                response = await fetch(url);
            } catch (error) {
                if (shouldApply === undefined || shouldApply()) {
                    const message = error instanceof Error ? error.message : String(error);
                    await this._reportError(message);
                }
            } finally {
                if (localFile) {
                    URL.revokeObjectURL(url);
                }
            }

            if (!response) {
                return undefined;
            }

            if (!response.ok) {
                throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`);
            }

            const base64 = bufferToBase64(await response.arrayBuffer());
            if (shouldApply !== undefined && !shouldApply()) {
                return undefined;
            }

            return [
                {
                    name: `${name}.${extension}`,
                    base64,
                },
            ];
        }

        // `url` is an array

        const firstUri = url[0];
        const partExtension = extractExtension(firstUri, extension);
        const fileName = `${name}.${partExtension}`;
        const promises = url.map((u) => fetch(u));
        const tracks = [];
        const totalPromises = promises.length;
        let finishedPromises = 0;

        for (const p of promises) {
            const response = await p;

            if (shouldApply !== undefined && !shouldApply()) {
                return undefined;
            }

            if (!response.ok) {
                throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`);
            }

            ++finishedPromises;
            this._context.subtitleController.notification({
                text: `${fileName} (${Math.floor((finishedPromises / totalPromises) * 100)}%)`,
            });

            const base64 = bufferToBase64(await response.arrayBuffer());
            if (shouldApply !== undefined && !shouldApply()) {
                return undefined;
            }

            tracks.push({
                name: fileName,
                base64,
            });
        }

        return tracks;
    }

    private async _reportError(error: string, requestId = this._activeRequestId) {
        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }

        const client = await this._client(false);
        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }
        const themeType = await this._context.settings.getSingle('themeType');

        if (requestId !== undefined && this._activeRequestId !== requestId) {
            return;
        }

        this._prepareShow();
        this._frame.show();

        return client.updateState({
            requestId,
            open: true,
            isLoading: false,
            error,
            themeType: themeType,
        });
    }
}
