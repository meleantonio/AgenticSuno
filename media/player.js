// AgenticSuno Player - Enhanced JavaScript
(function () {
    const vscode = acquireVsCodeApi();

    let audioElement = null;
    let isPlaying = false;
    let currentMood = 'focused';
    let visualizerBars = [];
    let animationFrameId = null;
    let audioEnabled = false; // Track if user has enabled audio via gesture
    let queuedTrack = null;   // Track queued while waiting for user gesture
    let libraryTracks = [];  // Persisted library (from extension)
    let projectThemeAvailable = false;

    // Initialize on load
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // Get DOM elements
        audioElement = document.getElementById('audio-element');

        // Setup visualizer bars
        setupVisualizer();

        // Setup audio enable overlay
        setupAudioEnable();

        // Setup event listeners
        setupAudioEvents();
        setupControls();

        // Listen for messages from extension
        window.addEventListener('message', handleMessage);

        log('Player initialized');
    }

    function setupVisualizer() {
        const container = document.getElementById('visualizer-container');
        if (!container) return;

        // Create 30 bars for visualizer
        container.innerHTML = '';
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

        overlay.addEventListener('click', () => {
            log('User enabled audio');
            audioEnabled = true;
            overlay.style.display = 'none';

            // Play queued track if any
            if (queuedTrack) {
                playTrackInternal(queuedTrack.url, queuedTrack.title, queuedTrack.style, queuedTrack.mood);
                queuedTrack = null;
            }
        });
    }

    function setupAudioEvents() {
        if (!audioElement) return;

        audioElement.addEventListener('timeupdate', () => {
            const currentTime = audioElement.currentTime;
            const duration = audioElement.duration || 0;

            // Update progress bar
            const progressBar = document.getElementById('progress-bar');
            const progressThumb = document.getElementById('progress-thumb');
            if (progressBar && duration > 0) {
                const percent = (currentTime / duration) * 100;
                progressBar.style.width = `${percent}%`;
                progressThumb.style.left = `${percent}%`;
            }

            // Update time display
            const currentTimeEl = document.getElementById('current-time');
            const totalTimeEl = document.getElementById('total-time');
            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(duration);

            // Send to extension
            vscode.postMessage({
                type: 'timeUpdate',
                currentTime,
                duration,
                remainingTime: duration - currentTime
            });
        });

        audioElement.addEventListener('ended', () => {
            log('Track ended');
            isPlaying = false;
            updatePlayButton();
            stopVisualizer();
            vscode.postMessage({ type: 'ended' });
        });

        audioElement.addEventListener('play', () => {
            isPlaying = true;
            updatePlayButton();
            startVisualizer();
        });

        audioElement.addEventListener('pause', () => {
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
        // Play/Pause button
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', togglePlayPause);
        }

        // Skip button
        const skipBtn = document.getElementById('skip-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'skip' });
            });
        }

        // Play project theme button
        const playProjectThemeBtn = document.getElementById('play-project-theme-btn');
        if (playProjectThemeBtn) {
            playProjectThemeBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'playProjectTheme' });
            });
        }

        // Volume slider
        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseFloat(e.target.value);
                if (audioElement) {
                    audioElement.volume = volume;
                }
                updateVolumeIcon(volume);
                vscode.postMessage({ type: 'volumeChange', volume });
            });
        }

        // Volume icon click to mute/unmute
        const volumeIcon = document.getElementById('volume-icon');
        if (volumeIcon) {
            volumeIcon.addEventListener('click', toggleMute);
        }

        // Progress bar seeking
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
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
                if (audioElement) audioElement.pause();
                break;
            case 'resume':
                if (audioElement) audioElement.play();
                break;
            case 'stop':
                stopPlayback();
                break;
            case 'setVolume':
                if (audioElement) audioElement.volume = message.volume;
                const slider = document.getElementById('volume-slider');
                if (slider) slider.value = message.volume;
                updateVolumeIcon(message.volume);
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
            item.textContent = (track.title || 'Track ' + (index + 1)) + (track.mood ? ' · ' + track.mood : '');
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
        log('playTrack called: ' + url);

        // If audio not enabled by user gesture, queue the track and show overlay
        if (!audioEnabled) {
            log('Audio not enabled, queuing track');
            queuedTrack = { url, title, style, mood };
            const overlay = document.getElementById('audio-enable-overlay');
            if (overlay) overlay.style.display = 'flex';

            // Update UI to show track is ready
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
        log('Playing: ' + url);

        if (!audioElement) {
            audioElement = document.getElementById('audio-element');
        }

        if (audioElement) {
            // Allow CORS so remote CDN (e.g. musicfile.removeai.ai) can be loaded
            audioElement.crossOrigin = 'anonymous';
            // Use <source> with type so the browser doesn't fail format detection (Suno API typically returns MP3)
            audioElement.innerHTML = '';
            const source = document.createElement('source');
            source.src = url;
            source.type = 'audio/mpeg';
            audioElement.appendChild(source);
            audioElement.load();
            audioElement.play().catch(err => {
                log('Play error: ' + (err && err.message ? err.message : String(err)));
                vscode.postMessage({ type: 'error', message: err && err.message ? err.message : 'Playback failed' });
            });
        }

        // Update UI
        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = title || 'Now Playing';
        if (styleEl) styleEl.textContent = style || 'Generating...';

        // Update mood
        if (mood) {
            setMood(mood);
        }

        // Hide status message
        const statusMsg = document.getElementById('status-message');
        if (statusMsg) statusMsg.style.display = 'none';
    }

    function stopPlayback() {
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
            audioElement.innerHTML = '';
            audioElement.removeAttribute('src');
            audioElement.load();
        }
        isPlaying = false;
        updatePlayButton();
        stopVisualizer();

        // Show idle state
        const titleEl = document.getElementById('track-title');
        const styleEl = document.getElementById('track-style');
        if (titleEl) titleEl.textContent = 'Waiting for Agents...';
        if (styleEl) styleEl.textContent = 'Idle';
    }

    function togglePlayPause() {
        if (!audioElement) return;

        if (isPlaying) {
            audioElement.pause();
        } else {
            audioElement.play().catch(err => log('Play error: ' + err));
        }
    }

    function toggleMute() {
        if (!audioElement) return;

        audioElement.muted = !audioElement.muted;
        updateVolumeIcon(audioElement.muted ? 0 : audioElement.volume);
        vscode.postMessage({ type: 'mute', muted: audioElement.muted });
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

        if (volume === 0 || (audioElement && audioElement.muted)) {
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

        // Update visualizer colors based on mood
        const colorMap = {
            epic: 'linear-gradient(to top, #ff6b35, #ffc107)',
            tense: 'linear-gradient(to top, #dc3545, #ff6b6b)',
            triumphant: 'linear-gradient(to top, #28a745, #2ecc71)',
            focused: 'linear-gradient(to top, #6366f1, #8b5cf6)',
            ambient: 'linear-gradient(to top, #8b5cf6, #a78bfa)'
        };

        const gradient = colorMap[mood] || colorMap.focused;
        visualizerBars.forEach(bar => {
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

        // Insert at top
        feed.insertBefore(item, feed.firstChild);

        // Limit to 10 items
        while (feed.children.length > 10) {
            feed.removeChild(feed.lastChild);
        }
    }

    // Visualizer animation
    function startVisualizer() {
        if (animationFrameId) return;

        function animate() {
            if (!isPlaying) return;

            visualizerBars.forEach((bar, i) => {
                // Simple random animation (could be enhanced with Web Audio API)
                const height = Math.random() * 50 + 4;
                bar.style.height = height + 'px';
            });

            animationFrameId = requestAnimationFrame(animate);
        }

        // Slower animation rate
        setInterval(() => {
            if (isPlaying) animate();
        }, 100);
    }

    function stopVisualizer() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // Reset bars to minimal height
        visualizerBars.forEach(bar => {
            bar.style.height = '4px';
        });
    }

    // Utility functions
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

    // Initialize if DOM already loaded
    if (document.readyState !== 'loading') {
        init();
    }
})();
