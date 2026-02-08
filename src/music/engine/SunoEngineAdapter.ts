import { Mood } from '../../types';
import { SunoClient } from '../../suno/SunoClient';
import { MusicGenerationEngine } from './MusicEngine';

/**
 * Adapter that exposes SunoClient via the engine contract.
 */
export class SunoEngineAdapter implements MusicGenerationEngine {
    public readonly id = 'suno';

    constructor(private readonly client: SunoClient = new SunoClient()) { }

    public generate(prompt: string, instrumental?: boolean, silent?: boolean) {
        return this.client.generate(prompt, instrumental, silent);
    }

    public extend(audioId: string, prompt: string, continueAt?: number) {
        return this.client.extend(audioId, prompt, continueAt);
    }

    public getMockTrackForMood(mood: Mood) {
        return this.client.getMockTrackForMood(mood);
    }
}
