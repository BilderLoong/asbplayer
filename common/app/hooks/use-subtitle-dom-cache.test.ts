import { act, createElement, StrictMode, useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { IndexedSubtitleModel } from '../../src/model';
import { useSubtitleDomCache } from './use-subtitle-dom-cache';

const subtitles: IndexedSubtitleModel[] = Array.from({ length: 3 }, (_, index) => ({
    index,
    track: 0,
    text: `Line ${index}`,
    start: index * 1000,
    end: index * 1000 + 900,
    originalStart: index * 1000,
    originalEnd: index * 1000 + 900,
}));

interface Props {
    lines: IndexedSubtitleModel[];
    render: (subtitle: IndexedSubtitleModel) => string;
    index?: number;
    visible?: boolean;
}

function CacheConsumer({ lines, render, index = 0, visible = true }: Props) {
    const refresh = useRef<((lines: IndexedSubtitleModel[]) => void) | undefined>(undefined);
    // VideoPlayer registers its window refresh before the cache hook.
    useEffect(() => {
        refresh.current?.(lines);
    }, [lines, render, index]);
    const cache = useSubtitleDomCache(lines, render);
    refresh.current = cache.refreshSubtitleDomCacheForSubtitles;
    return visible
        ? createElement('div', {
              'data-testid': 'showing',
              ref: (element: HTMLDivElement | null) => {
                  if (!element) return;
                  const domCache = cache.getSubtitleDomCache();
                  while (element.lastElementChild instanceof HTMLElement) {
                      domCache.return(element.lastElementChild);
                  }
                  element.appendChild(domCache.get(String(lines[index].index), () => render(lines[index])));
              },
          })
        : null;
}

describe('subtitle DOM cache lifetime', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        document.body.replaceChildren();
    });

    it('replaces rendered subtitles without leaving retired cache containers behind', async () => {
        for (let step = 0; step < 20; step++) {
            const render = (subtitle: IndexedSubtitleModel) =>
                `<span data-blurred="${step % 2 === 0}">${subtitle.text}</span>`;
            await act(async () => root.render(createElement(CacheConsumer, { lines: subtitles, render })));
            expect(host.querySelector('span')?.getAttribute('data-blurred')).toBe(String(step % 2 === 0));
        }
        expect(document.querySelectorAll('.asbplayer-offscreen')).toHaveLength(1);
    });

    it('replaces subtitle data and removes all cached DOM when the player is removed', async () => {
        const render = (subtitle: IndexedSubtitleModel) => `<span>${subtitle.text}</span>`;
        for (let step = 0; step < 20; step++) {
            const lines = subtitles.map((subtitle) => ({ ...subtitle, text: `Replacement ${step}` }));
            await act(async () => root.render(createElement(CacheConsumer, { lines, render })));
            expect(host.textContent).toBe(`Replacement ${step}`);
        }
        expect(document.querySelectorAll('.asbplayer-offscreen')).toHaveLength(1);
        await act(async () => root.render(null));
        expect(document.querySelectorAll('.asbplayer-offscreen')).toHaveLength(0);
    });

    it('keeps subtitle navigation and show/hide working across style changes in StrictMode', async () => {
        for (let step = 0; step < 20; step++) {
            const render = (subtitle: IndexedSubtitleModel) => `<span data-style="${step}">${subtitle.text}</span>`;
            for (const visible of [false, true]) {
                await act(async () =>
                    root.render(
                        createElement(
                            StrictMode,
                            null,
                            createElement(CacheConsumer, {
                                lines: subtitles,
                                render,
                                index: step % subtitles.length,
                                visible,
                            })
                        )
                    )
                );
                expect(host.textContent?.trim()).toBe(visible ? `Line ${step % subtitles.length}` : '');
                if (visible) expect(host.querySelector('span')?.getAttribute('data-style')).toBe(String(step));
                expect(document.querySelectorAll('.asbplayer-offscreen')).toHaveLength(1);
            }
        }
        await act(async () => root.render(null));
        expect(document.querySelectorAll('.asbplayer-offscreen')).toHaveLength(0);
    });
});
