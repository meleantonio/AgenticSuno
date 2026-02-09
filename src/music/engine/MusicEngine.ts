import { GenerateResult, MusicTrack } from '../../suno/SunoClient';
import { Mood } from '../../types';

/**
 * Contract for URL-track generation engines (Suno today, alternatives later).
 * Keeps MusicManager decoupled from specific API clients.
 */
export interface MusicGenerationEngine {
    readonly id: string;
    generate(prompt: string, instrumental?: boolean, silent?: boolean): Promise<GenerateResult>;
    extend(audioId: string, prompt: string, continueAt?: number): Promise<GenerateResult>;
    getMockTrackForMood(mood: Mood): MusicTrack;
}
