import { describe, expect, it } from '@jest/globals';
import { nextRestoreStep, RestorePhase, videoPositionKey } from './video-position-restore';

describe('nextRestoreStep', () => {
    it('separates files with the same name and different metadata', () => {
        expect(videoPositionKey('movie.mp4', 100, 1)).not.toBe(videoPositionKey('movie.mp4', 100, 2));
        expect(videoPositionKey('movie.mp4', 100, 1)).not.toBe(videoPositionKey('movie.mp4', 200, 1));
    });

    it('waits for a finite duration', () => {
        expect(nextRestoreStep('pending', { storedPosition: 34, metadataReady: true, durationSeconds: NaN })).toEqual({
            phase: 'pending',
        });
    });

    it('ignores invalid saved times', () => {
        expect(nextRestoreStep('pending', { storedPosition: -1, metadataReady: true, durationSeconds: 90 })).toEqual({
            phase: 'decided',
        });
    });
    it('seeks to the stored position once metadata is ready', () => {
        const step = nextRestoreStep('pending', { storedPosition: 75.5, metadataReady: true, durationSeconds: 600 });

        expect(step).toEqual({ phase: 'decided', seekTo: 75.5 });
    });

    it('runs the decision only once per loaded video', () => {
        let phase: RestorePhase = 'pending';
        const first = nextRestoreStep(phase, { storedPosition: 10, metadataReady: true, durationSeconds: 600 });
        phase = first.phase;
        const second = nextRestoreStep(phase, { storedPosition: 10, metadataReady: true, durationSeconds: 600 });

        expect(first.seekTo).toBe(10);
        expect(second).toEqual({ phase: 'decided' });
        expect(second.seekTo).toBeUndefined();
    });

    it('restores a stored position of zero explicitly', () => {
        const step = nextRestoreStep('pending', { storedPosition: 0, metadataReady: true, durationSeconds: 600 });

        expect(step).toEqual({ phase: 'decided', seekTo: 0 });
    });

    it('clamps a stored position at the media end instead of restarting', () => {
        const step = nextRestoreStep('pending', { storedPosition: 600, metadataReady: true, durationSeconds: 599.2 });

        expect(step).toEqual({ phase: 'decided', seekTo: 599.2 });
    });

    it('waits with saving blocked when video metadata is not ready yet', () => {
        const step = nextRestoreStep('pending', {
            storedPosition: 75.5,
            metadataReady: false,
            durationSeconds: undefined,
        });

        expect(step).toEqual({ phase: 'pending' });
    });

    it('applies a pending restore once metadata becomes ready', () => {
        const step = nextRestoreStep('pending', { storedPosition: 30, metadataReady: true, durationSeconds: 120 });

        expect(step).toEqual({ phase: 'decided', seekTo: 30 });
    });

    it('decides there is nothing to restore when no position is stored', () => {
        const step = nextRestoreStep('pending', {
            storedPosition: undefined,
            metadataReady: true,
            durationSeconds: 600,
        });

        expect(step).toEqual({ phase: 'decided' });
    });

    it('ignores stored positions when the media has no usable duration', () => {
        const step = nextRestoreStep('pending', { storedPosition: 30, metadataReady: true, durationSeconds: 0 });

        expect(step).toEqual({ phase: 'pending' });
    });

    it('rejects non-finite stored positions as a contract violation', () => {
        for (const storedPosition of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
            const step = nextRestoreStep('pending', { storedPosition, metadataReady: true, durationSeconds: 600 });

            expect(step).toEqual({ phase: 'decided' });
            expect(step.seekTo).toBeUndefined();
        }
    });
});
