# Design Specification

> **Guidance:**
> - Edit ruthlessly (remove over-engineering).
> - Check for circular dependencies.
> - Ensure alignment with Steering docs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            VS Code Extension Host                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │ Activity Monitor │───▶│ Mood Classifier │───▶│ Music Orchestrator      │  │
│  │                 │    │                 │    │                         │  │
│  │ • OutputChannel │    │ • KeywordMatch  │    │ • GenerationQueue       │  │
│  │ • Terminal      │    │ • IntensityCalc │    │ • ExtensionScheduler    │  │
│  │ • FileWatcher   │    │ • AgentTracker  │    │ • TransitionManager     │  │
│  └─────────────────┘    └─────────────────┘    └───────────┬─────────────┘  │
│                                                            │                 │
│                                                            ▼                 │
│                              ┌──────────────────────────────────────────┐   │
│                              │           Suno API Client               │   │
│                              │                                          │   │
│                              │ • generate(prompt, style, duration)     │   │
│                              │ • extend(audioId, continueAt, prompt)   │   │
│                              │ • getStatus(taskId) → AudioClip         │   │
│                              └───────────────────────┬──────────────────┘   │
│                                                      │                       │
│                                                      ▼                       │
│                              ┌──────────────────────────────────────────┐   │
│                              │          Audio Manager                   │   │
│                              │                                          │   │
│                              │ • ClipCache (LRU, max 20 clips)         │   │
│                              │ • PlaybackQueue                          │   │
│                              │ • CrossfadeEngine                        │   │
│                              └───────────────────────┬──────────────────┘   │
│                                                      │                       │
├──────────────────────────────────────────────────────┼───────────────────────┤
│                           Webview (Player Panel)     │                       │
│  ┌───────────────────────────────────────────────────▼──────────────────┐   │
│  │                        Player UI                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  [Audio Visualizer]  |  Now Playing: "Epic Debugging Suite"    │ │   │
│  │  │  ▶ ■ ⏭  |  ───●───────  2:34 / 4:00  |  🔊 ────●──             │ │   │
│  │  │  Mood: EPIC  |  Intensity: 78%  |  Agents: 2                   │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Activity Feed                                                   │ │   │
│  │  │  • 13:21 - Antigravity started "Planning AgenticSuno Specs"    │ │   │
│  │  │  • 13:20 - Detected implementation plan artifact                │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Communication

```
Extension Host ◀────postMessage────▶ Webview
                   (commands, state)
```

---

## Data Models

```typescript
// ========== Agent Activity ==========

interface AgentActivity {
  id: string;
  agentType: 'antigravity' | 'gemini' | 'cursor' | 'claude' | 'copilot' | 'unknown';
  source: 'output_channel' | 'terminal' | 'file_system';
  timestamp: number;
  rawText: string;
  classification: ActivityClassification;
}

interface ActivityClassification {
  mood: Mood;
  intensity: number;  // 0-100
  taskPhase: 'planning' | 'execution' | 'verification' | 'idle';
  signals: string[];  // Keywords that triggered classification
}

type Mood = 'epic' | 'focused' | 'tense' | 'triumphant' | 'ambient';

// ========== Music State ==========

interface MusicState {
  status: 'idle' | 'generating' | 'playing' | 'paused' | 'error';
  currentClip: AudioClip | null;
  queue: AudioClip[];
  projectTheme: ProjectTheme | null;
  volume: number;  // 0-1
  muted: boolean;
}

interface AudioClip {
  id: string;
  sunoAudioId: string;
  url: string;
  duration: number;  // seconds
  mood: Mood;
  intensity: number;
  generatedAt: number;
  isExtension: boolean;
  parentClipId?: string;
}

interface ProjectTheme {
  name: string;
  prompt: string;  // Base prompt for Suno
  style: string;   // Musical style descriptor
  generatedFrom: string;  // Source (README, package.json, etc.)
}

// ========== Suno API ==========

interface SunoGenerateRequest {
  prompt: string;
  style: string;
  model: 'v4' | 'v4.5' | 'v5';
  duration?: number;  // 30-240 seconds
  instrumental?: boolean;
}

interface SunoExtendRequest {
  audioId: string;
  continueAt?: number;  // seconds
  prompt?: string;
  style?: string;
  model: 'v4' | 'v4.5' | 'v5';
}

interface SunoTaskResponse {
  taskId: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  audioId?: string;
  audioUrl?: string;
  duration?: number;
}

// ========== Configuration ==========

interface ExtensionConfig {
  sunoApiKey: string;
  autoPlayOnActivity: boolean;
  monitoredChannels: string[];  // Regex patterns
  preferredStyle: string;
  intensitySensitivity: number;  // 0.5 - 2.0 multiplier
  mockMode: boolean;
  volume: number;
}
```

---

## Component Interfaces

### ActivityMonitor

```typescript
class ActivityMonitor {
  // Events
  onActivity: Event<AgentActivity>;
  onAgentStart: Event<{agentType: string}>;
  onAgentEnd: Event<{agentType: string, duration: number}>;
  
  // Methods
  start(): void;
  stop(): void;
  getActiveAgents(): string[];
}
```

### MoodClassifier

```typescript
class MoodClassifier {
  classify(text: string): ActivityClassification;
  calculateIntensity(activities: AgentActivity[], windowMs: number): number;
  detectMoodTransition(prev: Mood, current: Mood): boolean;
}
```

### MusicOrchestrator

```typescript
class MusicOrchestrator {
  // Events
  onStateChange: Event<MusicState>;
  
  // Methods
  start(): Promise<void>;
  stop(): void;
  transitionMood(mood: Mood, intensity: number): Promise<void>;
  skip(): Promise<void>;
  
  // Internal
  private scheduleExtension(): void;
  private generateClip(mood: Mood, intensity: number): Promise<AudioClip>;
}
```

### SunoApiClient

```typescript
class SunoApiClient {
  constructor(apiKey: string);
  
  generate(request: SunoGenerateRequest): Promise<SunoTaskResponse>;
  extend(request: SunoExtendRequest): Promise<SunoTaskResponse>;
  getTaskStatus(taskId: string): Promise<SunoTaskResponse>;
  waitForCompletion(taskId: string, timeoutMs?: number): Promise<AudioClip>;
}
```

### AudioManager

```typescript
class AudioManager {
  // Communicates with Webview via postMessage
  play(clip: AudioClip): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setVolume(volume: number): void;
  queueClip(clip: AudioClip): void;
  crossfadeTo(clip: AudioClip, durationMs: number): void;
  
  // Events from Webview
  onPlaybackProgress: Event<{currentTime: number, duration: number}>;
  onClipEnded: Event<void>;
}
```

---

## Error Handling

| Error Type | Handling Strategy |
|------------|-------------------|
| Suno API rate limit | Exponential backoff, fallback to cached clips |
| Suno API failure | Log error, continue with existing clip, show non-blocking notification |
| Invalid API key | Show setup notification, disable music features |
| Network offline | Use cached clips only, queue generation requests |
| Webview crash | Recreate webview, resume playback from saved state |
| Out of credits | Notify user, switch to mock mode |

---

## Security Considerations

1. **API Key Storage**: Use `context.secrets.store()` for Suno API key
2. **No Filesystem Secrets**: Never write API keys to config files
3. **Webview CSP**: Strict Content-Security-Policy allowing only Suno CDN
4. **URL Validation**: Validate all audio URLs before loading

---

## Performance Considerations

1. **Debounce Activity Parsing**: Parse output channel changes at most every 500ms
2. **Lazy Initialization**: Don't initialize Suno client until first activity detected
3. **Background Generation**: Use `setTimeout` to not block extension host
4. **Clip Cache Size**: Limit to 20 clips (~200MB max), LRU eviction
5. **Web Worker for Audio Processing**: Offload visualization calculations

---

## State Transitions

```
                ┌────────────────────────────────────────────────────┐
                │                                                    │
                ▼                                                    │
┌─────────┐  activity   ┌────────────┐  clip ready  ┌─────────┐     │
│  IDLE   │────────────▶│ GENERATING │─────────────▶│ PLAYING │     │
└─────────┘             └────────────┘              └────┬────┘     │
     ▲                        │                          │          │
     │                        │ error                    │ pause    │
     │                        ▼                          ▼          │
     │                  ┌─────────┐                ┌────────┐       │
     │                  │  ERROR  │                │ PAUSED │       │
     │                  └────┬────┘                └───┬────┘       │
     │                       │ retry                   │ resume    │
     │                       └─────────────────────────┴───────────┘
     │                                                              
     └──────────────────────── stop ────────────────────────────────
```
