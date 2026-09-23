import { IndexedSubtitleModel, OffscreenDomCache } from '@project/common';
import { useCallback, useEffect, useMemo } from 'react';

export const useSubtitleDomCache = (
    subtitles: IndexedSubtitleModel[],
    render: (subtitle: IndexedSubtitleModel) => string
) => {
    // Callers must receive the replacement during this render, before effects
    // refresh the window. A deferred state update can refill a retired cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- These dependencies are cache invalidation keys.
    const domCache = useMemo(() => new OffscreenDomCache(), [subtitles, render]);

    useEffect(() => () => domCache.clear(), [domCache]);

    const refreshSubtitleDomCacheForSubtitles = useCallback(
        (windowSubtitles: IndexedSubtitleModel[]) => {
            const keep = new Set(windowSubtitles.map((s) => String(s.index)));
            for (const key of domCache.keys()) {
                if (!keep.has(key)) domCache.delete(key);
            }
            for (const subtitle of windowSubtitles) {
                const key = String(subtitle.index);
                if (!domCache.has(key)) domCache.add(key, render(subtitle));
            }
        },
        [domCache, render]
    );

    const updateSubtitleDomCache = useCallback(
        (updatedSubtitles: IndexedSubtitleModel[]) => {
            for (const subtitle of updatedSubtitles) {
                const key = String(subtitle.index);
                if (domCache.has(key)) domCache.add(key, render(subtitle)); // Re-render updated subtitles that already exist in the cache
            }
        },
        [domCache, render]
    );

    return {
        getSubtitleDomCache: () => domCache,
        refreshSubtitleDomCacheForSubtitles,
        updateSubtitleDomCache,
    };
};
