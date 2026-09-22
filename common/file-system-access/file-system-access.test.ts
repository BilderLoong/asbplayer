import { describe, expect, it } from '@jest/globals';
import { requestPermissions, resolveFiles } from './file-system-access';

function fileHandle(name: string): FileSystemFileHandle {
    return {
        kind: 'file',
        name,
        getFile: async () => new File(['data'], name),
        isSameEntry: async () => false,
        createWritable: async () => {
            throw new Error('Read-only test handle');
        },
    };
}

interface DeferredPermissionHandle {
    requests: number;
    resolveRequest?: (state: string) => void;
    rejectRequest?: (error: Error) => void;
}

const makeDeferredHandle = (name: string) => {
    const state: DeferredPermissionHandle = { requests: 0 };
    const handle = {
        id: 'id-' + name,
        handle: {
            ...fileHandle(name),
            requestPermission: () => {
                state.requests += 1;
                return new Promise<string>((resolve, reject) => {
                    state.resolveRequest = resolve;
                    state.rejectRequest = reject;
                });
            },
        },
    };
    return { state, handle };
};

const makeStaticHandle = (name: string, behavior: { requestState?: string; reject?: Error } = {}) => ({
    id: 'id-' + name,
    handle: {
        ...fileHandle(name),
        requestPermission: () =>
            behavior.reject !== undefined
                ? Promise.reject(behavior.reject)
                : Promise.resolve(behavior.requestState ?? 'granted'),
    },
});

describe('requestPermissions', () => {
    it('contains synchronous permission errors without skipping later requests', async () => {
        const broken = {
            id: 'broken',
            handle: {
                ...fileHandle('broken.mp4'),
                requestPermission: () => {
                    throw new Error('Unavailable');
                },
            },
        };
        const good = makeStaticHandle('good.srt');
        const result = await requestPermissions([broken, good]);
        expect(result.denied).toEqual([broken]);
        expect(result.granted).toEqual([good]);
    });
    it('starts every permission request synchronously before awaiting responses', async () => {
        const first = makeDeferredHandle('first.mkv');
        const second = makeDeferredHandle('second.srt');

        const result = requestPermissions([first.handle, second.handle]);

        // No await before this assertion: both requests must already be started.
        expect(first.state.requests).toBe(1);
        expect(second.state.requests).toBe(1);

        first.state.resolveRequest?.('granted');
        second.state.resolveRequest?.('granted');

        const { granted, denied } = await result;

        expect(granted.map((h) => h.handle.name)).toEqual(['first.mkv', 'second.srt']);
        expect(denied).toEqual([]);
    });

    it('maps granted responses without prompting again', async () => {
        const { granted, denied } = await requestPermissions([makeStaticHandle('ok.mkv', { requestState: 'granted' })]);

        expect(granted.map((h) => h.handle.name)).toEqual(['ok.mkv']);
        expect(denied).toEqual([]);
    });

    it('returns denials as values', async () => {
        const { granted, denied } = await requestPermissions([
            makeStaticHandle('denied.mkv', { requestState: 'denied' }),
        ]);

        expect(granted).toEqual([]);
        expect(denied.map((h) => h.handle.name)).toEqual(['denied.mkv']);
    });

    it('returns request rejections as values instead of rejections', async () => {
        const { granted, denied } = await requestPermissions([
            makeStaticHandle('throws.mkv', { reject: new Error('gesture lost') }),
        ]);

        expect(granted).toEqual([]);
        expect(denied.map((h) => h.handle.name)).toEqual(['throws.mkv']);
    });

    it('treats handles without requestPermission support as denied', async () => {
        const unsupported = {
            id: 'id-unsupported',
            handle: fileHandle('unsupported.mkv'),
        };

        const { granted, denied } = await requestPermissions([unsupported]);

        expect(granted).toEqual([]);
        expect(denied.map((h) => h.handle.name)).toEqual(['unsupported.mkv']);
    });
});

describe('resolveFiles', () => {
    it('separates resolved files from unreadable handles', async () => {
        const ok = makeStaticHandle('ok.mkv');
        const broken = {
            id: 'id-broken',
            handle: {
                ...fileHandle('broken.mkv'),
                getFile: async () => {
                    throw new Error('gone');
                },
            },
        };

        const { files, errors } = await resolveFiles([ok, broken]);

        expect(files.map((f) => f.file.name)).toEqual(['ok.mkv']);
        expect(errors.map((h) => h.handle.name)).toEqual(['broken.mkv']);
    });
});
