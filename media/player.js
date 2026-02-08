// AgenticSuno Player - URL + realtime stream playback
(function () {
    const vscode = acquireVsCodeApi();

    const STREAM_MAX_QUEUE = 96;
    const STREAM_PREBUFFER_SECONDS = 0.12;

    let audioElement = null;
    let audioContext = null;
    let streamGainNode = null;

    let isPlaying = false;
    let currentMood = 'focused';
    let visualizerBars = [];
    let visualizerIntervalId = null;
    let streamTelemetryIntervalId = null;

    let audioEnabled = false;
    let queuedTrack = null;
    let libraryTracks = [];
    let projectThemeAvailable = false;

    let playbackMode = 'none'; // 'none' | 'url' | 'stream'
    let currentVolume = 0.7;
    let streamMuted = false;

    const streamState = {
        sessionId: null,
        sampleRateHz: 48000,
        channels: 2,
        mimeType: 'audio/pcm;rate=48000;channels=2',
        hasLoggedChunkFormat: false,
        pendingChunks: [],
        scheduledSources: [],
        isDecoding: false,
        nextPlayTime: 0,
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        audioElement = document.getElementById('audio-element');

        setupVisualizer();
        setupAudioEnable();
        setupAudioEvents();
        setupControls();

        window.addEventListener('message', handleMessage);

        log('Player initialized');
        vscode.postMessage({ type: 'webviewReady' });
    }

    function setupVisualizer() {
        const container = document.getElementById('visualizer-container');
        if (!container) return;

        container.innerHTML = '';
        visualizerBars = [];

        for (let i = 0; i < 30; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            bar.style.height = '4px';
            container.appendChild(bar);
            visualizerBars.push(bar);
        }
    }

    function setupAudioEnable() {
        const overlay = document.getElementById('audio-enable-overlay');
        if (!overlay) return;

        overlay.addEventListener('click', async () => {
            log('User enabled audio');
            await markAudioEnabledFromGesture();

            if (queuedTrack) {
                playTrackInternal(queuedTrack.url, queuedTrack.title, queuedTrack.style, queuedTrack.mood);
                queuedTrack = null;
            }

            if (playbackMode === 'stream') {
                await resumeStreamPlayback();
            }
        });
    }

    function setupAudioEvents() {
        if (!audioElement) return;

        audioElement.addEventListener('timeupdate', () => {
            if (playbackMode !== 'url') return;

            const currentTime = audioElement.currentTime;
            const duration = audioElement.duration || 0;

            const progressBar = document.getElementById('progress-bar');
            const progressThumb = document.getElementById('progress-thumb');
            if (progressBar && duration > 0) {
                const percent = (currentTime / duration) * 100;
                progressBar.style.width = `${percent}%`;
                progressThumb.style.left = `${percent}%`;
            }

            const currentTimeEl = document.getElementById('current-time');
            const totalTimeEl = document.getElementById('total-time');
            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(duration);

            vscode.postMessage({
                type: 'timeUpdate',
                currentTime,
                duration,
                remainingTime: duration - currentTime,
            });
        });

        audioElement.addEventListener('ended', () => {
            if (playbackMode !== 'url') return;
            log('Track ended');
            isPlaying = false;
            updatePlayButton();
            stopVisualizer();
            vscode.postMessage({ type: 'ended' });
        });

        audioElement.addEventListener('play', () => {
            if (playbackMode !== 'url') return;
            isPlaying = true;
            updatePlayButton();
            startVisualizer();
        });

        audioElement.addEventListener('pause', () => {
            if (playbackMode !== 'url') return;
            isPlaying = false;
            updatePlayButton();
            stopVisualizer();
        });

        audioElement.addEventListener('error', (e) => {
            const target = e.target;
            const code = target && target.error ? target.error.code : -1;
            const msg = target && target.error ? target.error.message : (e.message || 'Unknown error');
            const codeNames = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
            log('Audio error: ' + msg + ' (code ' + code + (codeNames[code] ? ': ' + codeNames[code] : '') + ')');
            vscode.postMessage({ type: 'error', message: 'Audio playback error: ' + msg });
        });
    }

    function setupControls() {
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', togglePlayPause);
        }

        const skipBtn = document.getElementById('skip-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'skip' });
            });
        }

        const playProjectThemeBtn = document.getElementById('play-project-theme-btn');
        if (playProjectThemeBtn) {
            playProjectThemeBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'playProjectTheme' });
            });
        }

        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                currentVolume = parseFloat(e.target.value);
                if (audioElement) {
                    audioElement.volume = currentVolume;
                }
                applyStreamVolume();
                updateVolumeIcon(currentVolume);
                vscode.postMessage({ type: 'volumeChange', volume: currentVolume });
            });
        }

        const volumeIcon = document.getElementById('volume-icon');
        if (volumeIcon) {
            volumeIcon.addEventListener('click', toggleMute);
        }

        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                if (playbackMode !== 'url') return;

                const rect = progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                if (audioElement && audioElement.duration) {
                    audioElement.currentTime = percent * audioElement.duration;
                }
            });
        }
    }

    function handleMessage(event) {
        const message = event.data;
        log('Received message: ' + message.type);

        switch (message.type) {
            case 'play':
                playTrack(message.url, message.title, message.style, message.mood);
                break;
            case 'pause':
                if (playbackMode === 'stream') {
                    pauseStreamPlayback();
                } else if (audioElement) {
                    audioElement.pause();
                }
                break;
            case 'resume':
                if (playbackMode === 'stream') {
                    resumeStreamPlayback();
                } else if (audioElement) {
                    audioElement.play().catch((err) => log('Play error: ' + err));
                }
                break;
            case 'stop':
                stopPlayback();
                break;
            case 'setVolume':
                currentVolume = Number(message.volume);
                if (audioElement) audioElement.volume = currentVolume;
                const slider = document.getElementById('volume-slider');
                if (slider) slider.value = currentVolume;
                applyStreamVolume();
                updateVolumeIcon(currentVolume);
                break;
            case 'updateState':
                updateUIState(message);
                break;
            case 'addActivity':
                addActivityItem(message.activity);
                break;
            case 'generatingUpdate':
                showGeneratingTimer(message.elapsedSeconds);
                break;
            case 'generationComplete':
                showGenerationComplete(message.totalSeconds);
                break;
            case 'setLibrary':
                libraryTracks = message.tracks || [];
                renderLibraryList();
                break;
            case 'setProjectThemeAvailable':
                projectThemeAvailable = !!message.available;
                updateProjectThemeButton();
                break;
            case 'streamInit':
                handleStreamInit(message);
                break;
            case 'streamChunk':
                handleStreamChunk(message);
                break;
            case 'streamPause':
                pauseStreamPlayback();
                break;
            case 'streamResume':
                resumeStreamPlayback();
                break;
            case 'streamStop':
                stopStreamPlayback(true);
                break;
            case 'streamReset':
                resetStreamContext();
                break;
            case 'streamError':
                log('Stream error: ' + (message.message || 'unknown'));
                break;
        }
    }

    function updateProjectThemeButton() {
        const btn = document.getElementById('play-project-theme-btn');
        const hint = document.getElementById('no-project-theme-hint');
        if (btn) btn.style.display = projectThemeAvailable ? 'block' : 'none';
        if (hint) hint.style.display = projectThemeAvailable ? 'none' : 'block';
    }

    function renderLibraryList() {
        const list = document.getElementById('library-list');
        if (!list) return;
        list.innerHTML = '';
        libraryTracks.slice(0, 20).forEach((track, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'library-track-item';
            item.textContent = (track.title || 'Track ' + (index + 1)) + (track.mood ? ' · ' + track.mood : '') + (track.engine ? ' · ' + track.engine : '');
            item.addEventListener('click', () => {
                vscode.postMessage({ type: 'playLibraryTrack', index });
            });
            list.appendChild(item);
        });
    }

    function showGeneratingTimer(elapsedSeconds) {
        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = 'Generating Music...';
        if (styleEl) styleEl.textContent = `⏱️ ${formatTime(elapsedSeconds)} elapsed`;
    }

    function showGenerationComplete(totalSeconds) {
        const styleEl = document.getElementById('track-style');
        if (styleEl) styleEl.textContent = `✅ Generated in ${totalSeconds.toFixed(1)}s`;
    }

    function playTrack(url, title, style, mood) {
        if (!url) return;

        if (!audioEnabled) {
            log('Audio not enabled, queuing URL track');
            queuedTrack = { url, title, style, mood };
            const overlay = document.getElementById('audio-enable-overlay');
            if (overlay) overlay.style.display = 'flex';

            const titleEl = document.getElementById('track-title');
            const styleEl = document.getElementById('track-style');
            if (titleEl) titleEl.textContent = title || 'Ready to Play';
            if (styleEl) styleEl.textContent = 'Click "Enable Audio" to start';
            if (mood) setMood(mood);
            return;
        }

        playTrackInternal(url, title, style, mood);
    }

    function playTrackInternal(url, title, style, mood) {
        playbackMode = 'url';
        stopStreamPlayback(true);

        if (!audioElement) {
            audioElement = document.getElementById('audio-element');
        }

        if (audioElement) {
            audioElement.pause();
            audioElement.crossOrigin = 'anonymous';
            audioElement.innerHTML = '';
            const source = document.createElement('source');
            source.src = url;
            source.type = 'audio/mpeg';
            audioElement.appendChild(source);
            audioElement.load();
            audioElement.volume = currentVolume;
            audioElement.muted = false;
            audioElement.play().catch((err) => {
                const msg = err && err.message ? err.message : String(err);
                if (msg.toLowerCase().includes('interrupted')) {
                    return;
                }
                log('Play error: ' + msg);
                vscode.postMessage({ type: 'error', message: msg || 'Playback failed' });
            });
        }

        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = title || 'Now Playing';
        if (styleEl) styleEl.textContent = style || 'Generating...';

        if (mood) {
            setMood(mood);
        }

        const statusMsg = document.getElementById('status-message');
        if (statusMsg) statusMsg.style.display = 'none';
    }

    function handleStreamInit(message) {
        playbackMode = 'stream';
        stopUrlPlaybackOnly();

        streamState.sessionId = message.sessionId || null;
        streamState.sampleRateHz = Number(message.sampleRateHz) || 48000;
        streamState.channels = Number(message.channels) || 2;
        streamState.mimeType = message.mimeType || 'audio/pcm;rate=48000;channels=2';
        streamState.hasLoggedChunkFormat = false;

        resetStreamContext();

        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = 'Lyria Realtime Session';
        if (styleEl) styleEl.textContent = 'Streaming low-latency audio';

        if (!audioEnabled) {
            const overlay = document.getElementById('audio-enable-overlay');
            if (overlay) overlay.style.display = 'flex';
            return;
        }

        resumeStreamPlayback();
    }

    function handleStreamChunk(message) {
        if (playbackMode !== 'stream') {
            return;
        }

        if (!message || typeof message.data !== 'string' || message.data.length === 0) {
            return;
        }

        if (streamState.pendingChunks.length >= STREAM_MAX_QUEUE) {
            streamState.pendingChunks.shift();
            log('Dropped oldest stream chunk due to queue limit');
        }

        streamState.pendingChunks.push({
            data: message.data,
            mimeType: message.mimeType || streamState.mimeType,
            sampleRateHz: Number(message.sampleRateHz) || streamState.sampleRateHz,
            channels: Number(message.channels) || streamState.channels,
            sequence: Number(message.sequence) || 0,
        });

        if (!streamState.hasLoggedChunkFormat) {
            streamState.hasLoggedChunkFormat = true;
            log(
                'First stream chunk format: mime=' +
                String(message.mimeType || streamState.mimeType) +
                ', rate=' + String(message.sampleRateHz || streamState.sampleRateHz) +
                ', channels=' + String(message.channels || streamState.channels) +
                ', bytes(base64)=' + String(message.data.length)
            );
        }

        if (audioEnabled) {
            processStreamQueue();
        }
    }

    async function ensureAudioContext() {
        if (!audioContext) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {
                throw new Error('Web Audio API is not available in this webview.');
            }
            audioContext = new Ctx();
            streamGainNode = audioContext.createGain();
            streamGainNode.connect(audioContext.destination);
            applyStreamVolume();
        }

        if (audioEnabled && audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        return audioContext;
    }

    function applyStreamVolume() {
        if (!streamGainNode) return;
        streamGainNode.gain.value = streamMuted ? 0 : currentVolume;
    }

    async function processStreamQueue() {
        if (streamState.isDecoding || playbackMode !== 'stream' || !audioEnabled) {
            return;
        }

        streamState.isDecoding = true;

        try {
            const context = await ensureAudioContext();

            while (streamState.pendingChunks.length > 0 && playbackMode === 'stream' && audioEnabled) {
                const chunk = streamState.pendingChunks.shift();
                const audioBuffer = await decodeStreamChunk(context, chunk);
                scheduleStreamBuffer(context, audioBuffer);
            }
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            log('Stream decode/schedule error: ' + message);
            vscode.postMessage({ type: 'error', message: 'Stream playback error: ' + message });
        } finally {
            streamState.isDecoding = false;
        }
    }

    async function decodeStreamChunk(context, chunk) {
        const bytes = base64ToBytes(chunk.data);
        const mimeType = (chunk.mimeType || streamState.mimeType || '').toLowerCase();
        const sampleRate = Number(chunk.sampleRateHz) || streamState.sampleRateHz;
        const channels = Number(chunk.channels) || streamState.channels;

        if (isLikelyPcmMime(mimeType)) {
            return decodePcmToAudioBuffer(context, bytes, mimeType, sampleRate, channels);
        }

        const audioData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return await context.decodeAudioData(audioData.slice(0));
    }

    function scheduleStreamBuffer(context, audioBuffer) {
        if (!audioBuffer || playbackMode !== 'stream') {
            return;
        }

        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(streamGainNode || context.destination);

        const startAt = Math.max(context.currentTime + STREAM_PREBUFFER_SECONDS, streamState.nextPlayTime || context.currentTime + STREAM_PREBUFFER_SECONDS);
        source.start(startAt);

        streamState.nextPlayTime = startAt + audioBuffer.duration;
        streamState.scheduledSources.push(source);

        source.onended = () => {
            streamState.scheduledSources = streamState.scheduledSources.filter((node) => node !== source);
        };

        if (!isPlaying) {
            isPlaying = true;
            updatePlayButton();
            startVisualizer();
        }

        updateStreamTimeDisplay();
        ensureStreamTelemetry();
    }

    async function pauseStreamPlayback() {
        if (playbackMode !== 'stream') return;

        try {
            const context = await ensureAudioContext();
            if (context.state === 'running') {
                await context.suspend();
            }
        } catch (error) {
            log('Failed to pause stream: ' + error);
        }

        isPlaying = false;
        updatePlayButton();
        stopVisualizer();
    }

    async function resumeStreamPlayback() {
        if (playbackMode !== 'stream') return;

        if (!audioEnabled) {
            const overlay = document.getElementById('audio-enable-overlay');
            if (overlay) overlay.style.display = 'flex';
            return;
        }

        try {
            const context = await ensureAudioContext();
            if (context.state === 'suspended') {
                await context.resume();
            }
            processStreamQueue();
            if (streamState.scheduledSources.length > 0 || streamState.pendingChunks.length > 0) {
                isPlaying = true;
                updatePlayButton();
                startVisualizer();
            }
            ensureStreamTelemetry();
        } catch (error) {
            log('Failed to resume stream: ' + error);
        }
    }

    function resetStreamContext() {
        streamState.pendingChunks = [];
        streamState.scheduledSources.forEach((source) => {
            try {
                source.stop();
                source.disconnect();
            } catch {
                // no-op
            }
        });
        streamState.scheduledSources = [];

        if (audioContext) {
            streamState.nextPlayTime = audioContext.currentTime + STREAM_PREBUFFER_SECONDS;
        } else {
            streamState.nextPlayTime = 0;
        }

        const styleEl = document.getElementById('track-style');
        if (styleEl && playbackMode === 'stream') {
            styleEl.textContent = 'Steering realtime session...';
        }

        isPlaying = false;
        updatePlayButton();
        stopVisualizer();
        updateStreamTimeDisplay();
    }

    function stopStreamPlayback(resetUi) {
        if (playbackMode !== 'stream' && !resetUi) {
            return;
        }

        resetStreamContext();
        clearStreamTelemetry();

        if (resetUi) {
            playbackMode = 'none';
            const currentTimeEl = document.getElementById('current-time');
            const totalTimeEl = document.getElementById('total-time');
            if (currentTimeEl) currentTimeEl.textContent = '0:00';
            if (totalTimeEl) totalTimeEl.textContent = '0:00';
        }
    }

    function stopUrlPlaybackOnly() {
        if (!audioElement) return;
        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.innerHTML = '';
        audioElement.removeAttribute('src');
        audioElement.load();
    }

    function stopPlayback() {
        if (playbackMode === 'stream') {
            stopStreamPlayback(true);
        } else {
            stopUrlPlaybackOnly();
        }

        playbackMode = 'none';
        isPlaying = false;
        updatePlayButton();
        stopVisualizer();

        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = 'Waiting for Agents...';
        if (styleEl) styleEl.textContent = 'Idle';
    }

    function togglePlayPause() {
        if (playbackMode === 'stream') {
            vscode.postMessage({ type: isPlaying ? 'pause' : 'resume' });
            return;
        }

        if (!audioEnabled) {
            // First press on Play counts as a valid user gesture to unlock audio.
            void markAudioEnabledFromGesture();
        }

        if (!audioElement) return;

        if (isPlaying) {
            audioElement.pause();
        } else {
            const hasSource = audioElement.src && audioElement.src.length > 0;
            if (!hasSource) {
                vscode.postMessage({ type: 'startOrResume' });
                return;
            }
            audioElement.play().catch((err) => {
                const msg = err && err.message ? err.message : String(err);
                if (!msg.toLowerCase().includes('interrupted')) {
                    log('Play error: ' + msg);
                }
            });
        }
    }

    function toggleMute() {
        if (playbackMode === 'stream') {
            streamMuted = !streamMuted;
            applyStreamVolume();
            updateVolumeIcon(streamMuted ? 0 : currentVolume);
            vscode.postMessage({ type: 'mute', muted: streamMuted });
            return;
        }

        if (!audioElement) return;

        audioElement.muted = !audioElement.muted;
        updateVolumeIcon(audioElement.muted ? 0 : audioElement.volume);
        vscode.postMessage({ type: 'mute', muted: audioElement.muted });
    }

    async function markAudioEnabledFromGesture() {
        if (audioEnabled) {
            return;
        }

        audioEnabled = true;
        const overlay = document.getElementById('audio-enable-overlay');
        if (overlay) overlay.style.display = 'none';

        try {
            await ensureAudioContext();
        } catch (error) {
            log('Failed to initialize audio context from user gesture: ' + error);
        }
    }

    function updatePlayButton() {
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.textContent = isPlaying ? '⏸' : '▶';
        }
    }

    function updateVolumeIcon(volume) {
        const icon = document.getElementById('volume-icon');
        if (!icon) return;

        if (volume === 0 || streamMuted || (audioElement && audioElement.muted)) {
            icon.textContent = '🔇';
        } else if (volume < 0.5) {
            icon.textContent = '🔉';
        } else {
            icon.textContent = '🔊';
        }
    }

    function setMood(mood) {
        currentMood = mood;

        const badge = document.getElementById('mood-badge');
        if (badge) {
            badge.className = 'mood-badge ' + mood;
            badge.textContent = mood.toUpperCase();
        }

        const colorMap = {
            epic: 'linear-gradient(to top, #ff6b35, #ffc107)',
            tense: 'linear-gradient(to top, #dc3545, #ff6b6b)',
            triumphant: 'linear-gradient(to top, #28a745, #2ecc71)',
            focused: 'linear-gradient(to top, #6366f1, #8b5cf6)',
            ambient: 'linear-gradient(to top, #8b5cf6, #a78bfa)',
        };

        const gradient = colorMap[mood] || colorMap.focused;
        visualizerBars.forEach((bar) => {
            bar.style.background = gradient;
        });
    }

    function updateUIState(state) {
        if (state.mood) setMood(state.mood);
        if (state.intensity !== undefined) {
            const fill = document.getElementById('intensity-fill');
            const value = document.getElementById('intensity-value');
            if (fill) fill.style.width = state.intensity + '%';
            if (value) value.textContent = state.intensity + '%';
        }
        if (state.agentCount !== undefined) {
            const count = document.getElementById('agent-count');
            if (count) count.textContent = state.agentCount + ' active';
        }
    }

    function addActivityItem(activity) {
        const feed = document.getElementById('activity-feed');
        if (!feed) return;

        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
            <span class="activity-time">${formatActivityTime(activity.timestamp)}</span>
            <span class="activity-text">${activity.text}</span>
            <span class="activity-agent">${activity.agentType}</span>
        `;

        feed.insertBefore(item, feed.firstChild);

        while (feed.children.length > 10) {
            feed.removeChild(feed.lastChild);
        }
    }

    function startVisualizer() {
        if (visualizerIntervalId) return;

        visualizerIntervalId = setInterval(() => {
            if (!isPlaying) return;
            visualizerBars.forEach((bar) => {
                const height = Math.random() * 50 + 4;
                bar.style.height = height + 'px';
            });
        }, 90);
    }

    function stopVisualizer() {
        if (visualizerIntervalId) {
            clearInterval(visualizerIntervalId);
            visualizerIntervalId = null;
        }

        visualizerBars.forEach((bar) => {
            bar.style.height = '4px';
        });
    }

    function ensureStreamTelemetry() {
        if (streamTelemetryIntervalId) return;

        streamTelemetryIntervalId = setInterval(() => {
            if (playbackMode !== 'stream' || !audioContext) return;
            updateStreamTimeDisplay();
        }, 500);
    }

    function clearStreamTelemetry() {
        if (streamTelemetryIntervalId) {
            clearInterval(streamTelemetryIntervalId);
            streamTelemetryIntervalId = null;
        }
    }

    function updateStreamTimeDisplay() {
        if (playbackMode !== 'stream' || !audioContext) {
            return;
        }

        const buffered = Math.max(0, streamState.nextPlayTime - audioContext.currentTime);
        const currentTimeEl = document.getElementById('current-time');
        const totalTimeEl = document.getElementById('total-time');
        const progressBar = document.getElementById('progress-bar');
        const progressThumb = document.getElementById('progress-thumb');

        if (currentTimeEl) currentTimeEl.textContent = 'LIVE';
        if (totalTimeEl) totalTimeEl.textContent = `${formatTime(buffered)} buffered`;
        if (progressBar) progressBar.style.width = `${Math.min(100, buffered * 20)}%`;
        if (progressThumb) progressThumb.style.left = `${Math.min(100, buffered * 20)}%`;

        vscode.postMessage({
            type: 'timeUpdate',
            currentTime: 0,
            duration: buffered,
            remainingTime: buffered,
        });
    }

    function base64ToBytes(base64) {
        let normalized = String(base64 || '').trim();
        const commaIndex = normalized.indexOf(',');
        if (normalized.startsWith('data:') && commaIndex > -1) {
            normalized = normalized.slice(commaIndex + 1);
        }
        normalized = normalized.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');

        const remainder = normalized.length % 4;
        if (remainder !== 0) {
            normalized += '='.repeat(4 - remainder);
        }

        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function isLikelyPcmMime(mimeType) {
        return /(pcm|l16|raw|s16|s24|f32|float)/i.test(String(mimeType || ''));
    }

    function parsePcmSpec(mimeType, sampleRate, channels) {
        const text = String(mimeType || '').toLowerCase();
        const rateMatch = /(?:rate|samplerate|sample_rate)=(\d+)/i.exec(text);
        const channelsMatch = /channels=(\d+)/i.exec(text);
        const bitsMatch = /(?:bits|bitdepth|bit_depth)=(\d+)/i.exec(text);

        let bitsPerSample = bitsMatch ? Number(bitsMatch[1]) : 16;
        let format = 's16';
        let littleEndian = true;

        if (/f32|float32|float/.test(text)) {
            format = 'f32';
            bitsPerSample = 32;
        } else if (/s24|pcm24/.test(text)) {
            format = 's24';
            bitsPerSample = 24;
        } else if (/u8|pcm8/.test(text)) {
            format = 'u8';
            bitsPerSample = 8;
        } else if (/s16|pcm16|l16|pcm/.test(text)) {
            format = 's16';
            bitsPerSample = 16;
        }

        if (/be/.test(text) && !/le/.test(text)) {
            littleEndian = false;
        }

        return {
            format,
            bitsPerSample,
            littleEndian,
            sampleRate: rateMatch ? Number(rateMatch[1]) : sampleRate,
            channels: channelsMatch ? Number(channelsMatch[1]) : channels,
        };
    }

    function decodePcmToAudioBuffer(context, bytes, mimeType, sampleRate, channels) {
        const spec = parsePcmSpec(mimeType, sampleRate, channels);
        const safeChannels = Math.max(1, Math.min(8, spec.channels || channels || 2));
        const safeSampleRate = Math.max(8000, Math.min(192000, spec.sampleRate || sampleRate || 48000));

        const bytesPerSample = spec.bitsPerSample / 8;
        const bytesPerFrame = bytesPerSample * safeChannels;
        if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
            throw new Error('Invalid PCM frame size.');
        }

        const frameCount = Math.floor(bytes.byteLength / bytesPerFrame);
        if (frameCount <= 0) {
            throw new Error('PCM chunk too small to decode.');
        }

        const usableByteLength = frameCount * bytesPerFrame;
        const view = new DataView(bytes.buffer, bytes.byteOffset, usableByteLength);
        const audioBuffer = context.createBuffer(safeChannels, frameCount, safeSampleRate);

        for (let ch = 0; ch < safeChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let frame = 0; frame < frameCount; frame++) {
                const sampleOffset = frame * bytesPerFrame + ch * bytesPerSample;
                let value = 0;

                if (spec.format === 'f32') {
                    value = view.getFloat32(sampleOffset, spec.littleEndian);
                } else if (spec.format === 's24') {
                    value = readInt24(view, sampleOffset, spec.littleEndian) / 8388608;
                } else if (spec.format === 'u8') {
                    value = (view.getUint8(sampleOffset) - 128) / 128;
                } else {
                    value = view.getInt16(sampleOffset, spec.littleEndian) / 32768;
                }

                if (value > 1) value = 1;
                if (value < -1) value = -1;
                channelData[frame] = value;
            }
        }

        return audioBuffer;
    }

    function readInt24(view, offset, littleEndian) {
        let b0;
        let b1;
        let b2;

        if (littleEndian) {
            b0 = view.getUint8(offset);
            b1 = view.getUint8(offset + 1);
            b2 = view.getUint8(offset + 2);
        } else {
            b2 = view.getUint8(offset);
            b1 = view.getUint8(offset + 1);
            b0 = view.getUint8(offset + 2);
        }

        let value = b0 | (b1 << 8) | (b2 << 16);
        if (value & 0x800000) {
            value |= 0xff000000;
        }
        return value;
    }

    function writeAscii(view, offset, text) {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    function pcm16ToWav(pcmBytes, sampleRate, channels) {
        const dataLength = pcmBytes.byteLength;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeAscii(view, 8, 'WAVE');
        writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        const byteRate = sampleRate * channels * 2;
        view.setUint32(28, byteRate, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        new Uint8Array(buffer, 44).set(pcmBytes);
        return buffer;
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function formatActivityTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function log(message) {
        console.log('[AgenticSuno Player]', message);
        vscode.postMessage({ type: 'log', message });
    }

    if (document.readyState !== 'loading') {
        init();
    }
})();
