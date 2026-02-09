import { Mood } from '../types';
import { LyriaGenerationConfig, LyriaWeightedPrompt } from '../lyria/types';

export type LyriaEvolutionStrength = 'subtle' | 'balanced' | 'strong';

export const DEFAULT_LYRIA_STYLE_ANCHOR = 'cinematic electronic soul with expressive harmonic movement, textured low-end groove, evolving melodic motifs, polished modern production, dynamic transitions, emotionally rich atmosphere';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeWeight(value: number): number {
    return Math.round(clamp(value, 0, 2) * 100) / 100;
}

function resolveStyleAnchor(anchor?: string): string {
    const normalized = (anchor || '').trim().replace(/\s+/g, ' ');
    if (normalized.length < 8) {
        return DEFAULT_LYRIA_STYLE_ANCHOR;
    }
    return normalized.substring(0, 280);
}

function resolveEvolutionStrength(value?: string): LyriaEvolutionStrength {
    if (value === 'subtle' || value === 'balanced' || value === 'strong') {
        return value;
    }
    return 'strong';
}

function getStrengthMultiplier(strength: LyriaEvolutionStrength): number {
    if (strength === 'subtle') return 0.75;
    if (strength === 'balanced') return 1;
    return 1.25;
}

/**
 * Convert mood + intensity (+ optional hints) into weighted prompts for Lyria.
 */
export function buildWeightedPrompts(params: {
    mood: Mood;
    intensity: number;
    promptHint?: string;
    projectThemePrompt?: string;
    styleAnchor?: string;
    evolutionStrength?: string;
    activityDensity?: number;
    moodDelta?: number;
    promptVariation?: string;
    skipVariation?: number;
}): LyriaWeightedPrompt[] {
    const intensity = clamp(params.intensity, 0, 100);
    const intensity01 = intensity / 100;
    const styleAnchor = resolveStyleAnchor(params.styleAnchor);
    const evolutionStrength = resolveEvolutionStrength(params.evolutionStrength);
    const strengthMultiplier = getStrengthMultiplier(evolutionStrength);
    const activityDensity = clamp(params.activityDensity ?? 0.15, 0, 1);
    const moodDelta = clamp(params.moodDelta ?? 0.2, 0, 1);
    const skipVariation = clamp(params.skipVariation ?? 0, 0, 1);
    const energy = clamp(intensity01 * 0.55 + activityDensity * 0.25 + moodDelta * 0.2, 0, 1);

    const moodPrompt: Record<Mood, string> = {
        epic: 'bold rhythmic propulsion, soaring hooks, wide cinematic spread, high-impact movement',
        tense: 'tight percussive pulse, suspended harmony, magnetic pressure, controlled urgency',
        triumphant: 'uplifting melodic arc, brighter chords, confident rise, celebratory momentum',
        focused: 'steady forward groove, clean rhythmic detail, immersive but clear arrangement',
        ambient: 'spacious atmospheric layers, slow-blooming textures, soft but intentional movement',
    };

    const transitionPrompt = moodDelta > 0.55
        ? 'strong scene transition with coherent handoff, fresh motif enters while groove continuity is preserved'
        : 'smooth adaptive transition, evolving motif and harmony while preserving flow';

    const variationPrompt = params.promptVariation && params.promptVariation.trim().length > 2
        ? `${styleAnchor}, variation cue ${params.promptVariation.trim().substring(0, 80)}, introduce a distinct phrase and timbral color`
        : undefined;

    const prompts: LyriaWeightedPrompt[] = [
        {
            text: `${styleAnchor}, ${moodPrompt[params.mood]}`,
            weight: normalizeWeight(1.05 + intensity01 * 0.22 + moodDelta * 0.2 * strengthMultiplier),
        },
        {
            text: intensity > 70
                ? `${styleAnchor}, stronger rhythmic drive, expressive dynamics, energetic but musical`
                : intensity < 30
                    ? `${styleAnchor}, sparse arrangement, softer dynamics, breathing space, gentle melodic movement`
                    : `${styleAnchor}, balanced dynamics, moderate rhythmic motion, stable forward motion`,
            weight: normalizeWeight(0.8 + energy * 0.12),
        },
        {
            text: `${styleAnchor}, ${transitionPrompt}`,
            weight: normalizeWeight(0.52 + moodDelta * 0.28 * strengthMultiplier),
        },
    ];

    if (params.projectThemePrompt && params.projectThemePrompt.trim().length > 10) {
        prompts.push({
            text: `${styleAnchor}, project context: ${params.projectThemePrompt.trim().substring(0, 190)}`,
            weight: normalizeWeight(0.62 + activityDensity * 0.14),
        });
    }

    if (params.promptHint && params.promptHint.trim().length > 4) {
        prompts.push({
            text: `${styleAnchor}, live activity context: ${params.promptHint.trim().replace(/\s+/g, ' ').substring(0, 130)}`,
            weight: normalizeWeight(0.45 + moodDelta * 0.2),
        });
    }

    if (variationPrompt) {
        prompts.push({
            text: variationPrompt,
            weight: normalizeWeight(0.4 + skipVariation * 0.35),
        });
    }

    return prompts;
}

/**
 * Map activity intensity to realtime generation controls.
 */
export function buildGenerationConfig(params: {
    mood: Mood;
    intensity: number;
    evolutionStrength?: string;
    activityDensity?: number;
    moodDelta?: number;
    skipVariation?: number;
    seed?: number;
}): LyriaGenerationConfig {
    const intensity = clamp(params.intensity, 0, 100);
    const intensity01 = intensity / 100;
    const evolutionStrength = resolveEvolutionStrength(params.evolutionStrength);
    const strengthMultiplier = getStrengthMultiplier(evolutionStrength);
    const activityDensity = clamp(params.activityDensity ?? 0.15, 0, 1);
    const moodDelta = clamp(params.moodDelta ?? 0.2, 0, 1);
    const skipVariation = clamp(params.skipVariation ?? 0, 0, 1);
    const deltaBoost = clamp(moodDelta * 0.6 + activityDensity * 0.4, 0, 1);

    const baseBrightness: Record<Mood, number> = {
        epic: 0.78,
        tense: 0.25,
        triumphant: 0.88,
        focused: 0.58,
        ambient: 0.44,
    };

    const baseDensity: Record<Mood, number> = {
        epic: 0.82,
        tense: 0.72,
        triumphant: 0.76,
        focused: 0.52,
        ambient: 0.36,
    };

    return {
        temperature: clamp(0.5 + intensity01 * 1.05 + deltaBoost * 0.22 * strengthMultiplier, 0.2, 2),
        guidance: clamp(2.0 + intensity01 * 2.4 + deltaBoost * 0.55, 1.2, 5),
        bpm: Math.round(84 + intensity01 * 36 + deltaBoost * 6 * strengthMultiplier),
        density: clamp(baseDensity[params.mood] * 0.58 + intensity01 * 0.46 + deltaBoost * 0.2, 0, 1),
        brightness: clamp(baseBrightness[params.mood] * 0.68 + intensity01 * 0.34 + moodDelta * 0.14, 0, 1),
        topK: Math.round(22 + intensity01 * 24 + skipVariation * 6),
        seed: typeof params.seed === 'number' ? Math.floor(params.seed) : undefined,
    };
}
