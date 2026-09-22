export type RestorePhase = 'pending' | 'decided';

export interface RestoreInputs {
    readonly storedPosition: number | undefined;
    readonly metadataReady: boolean;
    readonly durationSeconds: number | undefined;
}

export interface RestoreStep {
    readonly phase: RestorePhase;
    // Seconds to seek to, when a restore can be applied now.
    readonly seekTo?: number;
}

// Pure restore decision: stored=end clamps to the real media duration (paused
// at the end is preserved as such), metadata must be ready before seeking, and
// the decision runs once per loaded video.
export function nextRestoreStep(phase: RestorePhase, inputs: RestoreInputs): RestoreStep {
    const storedPosition = inputs.storedPosition;

    if (phase === 'decided' || storedPosition === undefined || !Number.isFinite(storedPosition) || storedPosition < 0) {
        return { phase: 'decided' };
    }

    if (
        !inputs.metadataReady ||
        inputs.durationSeconds === undefined ||
        !Number.isFinite(inputs.durationSeconds) ||
        inputs.durationSeconds <= 0
    ) {
        return { phase: 'pending' };
    }

    return {
        phase: 'decided',
        seekTo: Math.min(storedPosition, inputs.durationSeconds),
    };
}

export function videoPositionKey(name: string, size: number, lastModified: number): string {
    return JSON.stringify([name, size, lastModified]);
}
