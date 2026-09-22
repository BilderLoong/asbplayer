import { liveQuery } from 'dexie';
import { useCallback, useEffect, useState } from 'react';
import {
    FileSessionRecord,
    FileSystemFileHandleWithId,
    IndexedDBFileSessionRepository,
    supportsFileSystemAccess,
} from '../../file-system-access';

let _repository: IndexedDBFileSessionRepository | undefined;
const getRepository = () => {
    if (_repository === undefined && supportsFileSystemAccess()) {
        _repository = new IndexedDBFileSessionRepository();
    }
    return _repository;
};

export const useFileSession = () => {
    const fileSessionRepository = getRepository();
    const [sessionRecord, setSessionRecord] = useState<FileSessionRecord>();

    useEffect(() => {
        if (!fileSessionRepository) return;
        // Keep the record ready before the click, including changes from other player frames.
        const subscription = liveQuery(() => fileSessionRepository.fetch()).subscribe({
            next: setSessionRecord,
            error: (error: unknown) => console.error('Failed to load file session:', error),
        });
        return () => subscription.unsubscribe();
    }, [fileSessionRepository]);

    const getPreloadedSessionRecord = useCallback(() => sessionRecord, [sessionRecord]);
    const canRestoreLastSession = Boolean(sessionRecord?.videoHandle || sessionRecord?.subtitleHandles.length);

    const saveSession = useCallback(
        async ({ videoHandle, subtitleHandles }: Omit<FileSessionRecord, 'id' | 'timestamp'>) => {
            if (!fileSessionRepository) return;

            if (!videoHandle && subtitleHandles.length === 0) {
                return;
            }

            await fileSessionRepository.merge({ videoHandle, subtitleHandles });
        },
        [fileSessionRepository]
    );

    const saveBufferedHandlesToSession = useCallback(
        async (bufferedSubtitleHandles: FileSystemFileHandleWithId[]) => {
            await fileSessionRepository?.merge({
                subtitleHandles: [],
                bufferedSubtitleHandles: bufferedSubtitleHandles,
            });
        },
        [fileSessionRepository]
    );

    const promoteBufferedHandlesInSession = useCallback(
        async (ids: string[]) => {
            await fileSessionRepository?.promoteBuffered(ids);
        },
        [fileSessionRepository]
    );

    const clearBufferedHandlesInSession = useCallback(async () => {
        await fileSessionRepository?.clearBuffered();
    }, [fileSessionRepository]);

    useEffect(() => {
        if (!fileSessionRepository) return;

        void fileSessionRepository.clearBuffered().catch(console.error);
    }, [fileSessionRepository]);

    const retainHandlesInSession = useCallback(
        async (ids: string[]) => {
            await fileSessionRepository?.retain(ids);
        },
        [fileSessionRepository]
    );

    return {
        canRestoreLastSession,
        getPreloadedSessionRecord,
        saveSession,
        saveBufferedHandlesToSession,
        promoteBufferedHandlesInSession,
        clearBufferedHandlesInSession,
        retainHandlesInSession,
    };
};
