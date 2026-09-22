/**
 * File System Access API helpers (Chrome-only).
 * Provides showOpenFilePicker-based file selection that returns FileSystemFileHandle objects,
 * and utilities to re-acquire permissions and resolve handles back to File objects on revisit.
 */

import { FileWithId } from '../file-selector';
import { FileSystemFileHandleWithId } from './file-system-access-repository';
import { v4 as uuidv4 } from 'uuid';

export function supportsFileSystemAccess(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

// Start every request before awaiting responses: later prompts still need the click's activation.
export async function requestPermissions(
    handles: FileSystemFileHandleWithId[]
): Promise<{ granted: FileSystemFileHandleWithId[]; denied: FileSystemFileHandleWithId[] }> {
    const classified = await Promise.all(
        handles.map(async (handle) => {
            const nativeHandle = handle.handle;
            try {
                if (!('requestPermission' in nativeHandle) || typeof nativeHandle.requestPermission !== 'function') {
                    return { handle, granted: false };
                }
                const state: unknown = await nativeHandle.requestPermission({ mode: 'read' });
                return { handle, granted: state === 'granted' };
            } catch {
                return { handle, granted: false };
            }
        })
    );
    return {
        granted: classified.filter(({ granted }) => granted).map(({ handle }) => handle),
        denied: classified.filter(({ granted }) => !granted).map(({ handle }) => handle),
    };
}

export async function resolveFiles(
    handles: FileSystemFileHandleWithId[]
): Promise<{ files: FileWithId[]; errors: FileSystemFileHandleWithId[] }> {
    const settled = await Promise.all(
        handles.map(async (handle): Promise<{ file: FileWithId } | { error: FileSystemFileHandleWithId }> => {
            try {
                return { file: { id: handle.id, file: await handle.handle.getFile() } };
            } catch {
                return { error: handle };
            }
        })
    );
    return {
        files: settled.flatMap((result) => ('file' in result ? [result.file] : [])),
        errors: settled.flatMap((result) => ('error' in result ? [result.error] : [])),
    };
}

export async function showFilePicker(extensions: {
    videoExtensions: string[];
    audioExtensions: string[];
    subtitleExtensions: string[];
}): Promise<FileSystemFileHandleWithId[] | undefined> {
    if (!supportsFileSystemAccess()) {
        return undefined;
    }

    try {
        const handles = await (window as any).showOpenFilePicker({
            multiple: true,
            types: [
                {
                    description: 'Media and subtitle files',
                    accept: {
                        'video/*': extensions.videoExtensions,
                        'audio/*': extensions.audioExtensions,
                        'text/*': extensions.subtitleExtensions,
                    },
                },
            ],
        });
        return (handles as FileSystemFileHandle[]).map((handle) => ({ handle, id: uuidv4() }));
    } catch (e: any) {
        if (e.name === 'AbortError') {
            return undefined;
        }
        throw e;
    }
}
