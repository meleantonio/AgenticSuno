import * as assert from 'assert';
import { buildGenerationConfig, buildWeightedPrompts, DEFAULT_LYRIA_STYLE_ANCHOR } from '../../music/LyriaSteering';

suite('Lyria Steering Suite', () => {
    test('high intensity increases bpm and guidance', () => {
        const low = buildGenerationConfig({ mood: 'focused', intensity: 15 });
        const high = buildGenerationConfig({ mood: 'focused', intensity: 90 });

        assert.ok((high.bpm || 0) > (low.bpm || 0));
        assert.ok((high.guidance || 0) > (low.guidance || 0));
    });

    test('weighted prompts include project theme and hint', () => {
        const prompts = buildWeightedPrompts({
            mood: 'ambient',
            intensity: 45,
            projectThemePrompt: 'Project uses deterministic CI pipelines and static analysis.',
            promptHint: 'writing parser tests',
        });

        assert.ok(prompts.length >= 3);
        assert.ok(prompts.some((p) => p.text.includes('deterministic CI')));
        assert.ok(prompts.some((p) => p.text.includes('writing parser tests')));
        assert.ok(prompts.every((p) => p.text.includes(DEFAULT_LYRIA_STYLE_ANCHOR)));
    });

    test('custom style anchor is applied to every prompt', () => {
        const customAnchor = 'sleek berlin afterhours lounge, analog synth shimmer';
        const prompts = buildWeightedPrompts({
            mood: 'focused',
            intensity: 50,
            styleAnchor: customAnchor,
            promptHint: 'iterating architecture docs',
        });

        assert.ok(prompts.length >= 2);
        assert.ok(prompts.every((p) => p.text.includes(customAnchor)));
    });
});
