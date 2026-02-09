import * as assert from 'assert';
import { parseAudioFormatFromMime, parseLyriaServerMessage } from '../../lyria/LyriaClient';

suite('LyriaClient Parser Suite', () => {
    test('parseAudioFormatFromMime reads sample rate and channels', () => {
        const parsed = parseAudioFormatFromMime('audio/pcm;rate=44100;channels=1');
        assert.strictEqual(parsed.sampleRateHz, 44100);
        assert.strictEqual(parsed.channels, 1);
    });

    test('parseLyriaServerMessage handles setupComplete', () => {
        const parsed = parseLyriaServerMessage({ setupComplete: {} });
        assert.strictEqual(parsed.setupComplete, true);
        assert.strictEqual(parsed.audioPayloads.length, 0);
    });

    test('parseLyriaServerMessage handles camelCase audio chunks', () => {
        const parsed = parseLyriaServerMessage({
            serverContent: {
                audioChunks: [{ data: 'ZmFrZQ==', mimeType: 'audio/pcm;rate=48000;channels=2' }],
            },
        });

        assert.strictEqual(parsed.audioPayloads.length, 1);
        assert.strictEqual(parsed.audioPayloads[0].sampleRateHz, 48000);
        assert.strictEqual(parsed.audioPayloads[0].channels, 2);
    });

    test('parseLyriaServerMessage handles snake_case audio chunks', () => {
        const parsed = parseLyriaServerMessage({
            server_content: {
                audio_chunks: [{ data: 'ZmFrZQ==', mime_type: 'audio/pcm;rate=32000;channels=1' }],
            },
        });

        assert.strictEqual(parsed.audioPayloads.length, 1);
        assert.strictEqual(parsed.audioPayloads[0].sampleRateHz, 32000);
        assert.strictEqual(parsed.audioPayloads[0].channels, 1);
    });
});
