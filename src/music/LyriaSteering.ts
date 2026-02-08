import { Mood } from '../types';
import { LyriaGenerationConfig, LyriaWeightedPrompt } from '../lyria/types';

export const DEFAULT_LYRIA_STYLE_ANCHOR = 'midnight ocean penthouse ambiance, executive deep-focus groove, polished downtempo electronic, warm bassline, soft keys, subtle percussion, no vocals';

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

/**
 * Convert mood + intensity (+ optional hints) into weighted prompts for Lyria.
 */
export function buildWeightedPrompts(params: {
    mood: Mood;
    intensity: number;
    promptHint?: string;
    projectThemePrompt?: string;
    styleAnchor?: string;
}): LyriaWeightedPrompt[] {
    const intensity = clamp(params.intensity, 0, 100);
    const intensity01 = intensity / 100;
    const styleAnchor = resolveStyleAnchor(params.styleAnchor);

    const moodPrompt: Record<Mood, string> = {
        epic: 'confident rise, expansive synth layers, decisive momentum, premium modern energy',
        tense: 'night-drive tension, controlled pulse, crisp low-end pressure, restrained suspense',
        triumphant: 'clean uplift, confident major texture, forward motion, sophisticated optimism',
        focused: 'steady hypnotic groove, minimal distraction, precise momentum, smooth modern polish',
        ambient: 'calm atmospheric bed, spacious reverb, gentle motion, late-night luxury calm',
    };

    const prompts: LyriaWeightedPrompt[] = [
        {
            text: `${styleAnchor}, ${moodPrompt[params.mood]}`,
            weight: normalizeWeight(1.05 + intensity01 * 0.25),
        },
        {
            text: intensity > 70
                ? `${styleAnchor}, stronger rhythmic drive, tighter drums, energetic but smooth`
                : intensity < 30
                    ? `${styleAnchor}, sparse arrangement, softer dynamics, low tension, airy space`
                    : `${styleAnchor}, balanced dynamics, moderate rhythmic motion, stable focus`,
            weight: normalizeWeight(0.85),
        },
    ];

    if (params.projectThemePrompt && params.projectThemePrompt.trim().length > 10) {
        prompts.push({
            text: `${styleAnchor}, project context: ${params.projectThemePrompt.trim().substring(0, 190)}`,
            weight: normalizeWeight(0.75),
        });
    }

    if (params.promptHint && params.promptHint.trim().length > 4) {
        prompts.push({
            text: `${styleAnchor}, live activity context: ${params.promptHint.trim().replace(/\s+/g, ' ').substring(0, 130)}`,
            weight: normalizeWeight(0.55),
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
}): LyriaGenerationConfig {
    const intensity = clamp(params.intensity, 0, 100);
    const intensity01 = intensity / 100;

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
        temperature: clamp(0.58 + intensity01 * 1.1, 0.2, 2),
        guidance: clamp(2.2 + intensity01 * 2.6, 1.2, 5),
        bpm: Math.round(86 + intensity01 * 34),
        density: clamp(baseDensity[params.mood] * 0.6 + intensity01 * 0.5, 0, 1),
        brightness: clamp(baseBrightness[params.mood] * 0.7 + intensity01 * 0.35, 0, 1),
        topK: Math.round(22 + intensity01 * 26),
    };
}
