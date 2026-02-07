import { Mood, AgentActivity, ActivityClassification, TaskPhase } from '../types';

/**
 * MoodClassifier - Analyzes text and activity patterns to classify mood.
 * Uses keyword matching and weighted scoring to determine the emotional state
 * that should be reflected in the music.
 */
export class MoodClassifier {
    // Keyword dictionaries with weights
    private readonly moodKeywords: Map<Mood, { keywords: string[]; weight: number }[]> = new Map([
        ['epic', [
            { keywords: ['implement', 'create', 'build', 'architecture', 'design'], weight: 2 },
            { keywords: ['major', 'large', 'refactor', 'overhaul', 'rewrite'], weight: 3 },
            { keywords: ['planning', 'phase', 'strategy', 'specification'], weight: 2 },
        ]],
        ['tense', [
            { keywords: ['error', 'failed', 'exception', 'crash', 'broken'], weight: 3 },
            { keywords: ['bug', 'fix', 'debug', 'issue', 'problem'], weight: 2 },
            { keywords: ['retry', 'timeout', 'null', 'undefined'], weight: 1 },
            { keywords: ['critical', 'urgent', 'blocking'], weight: 3 },
        ]],
        ['triumphant', [
            { keywords: ['success', 'complete', 'done', 'finished', 'passed'], weight: 3 },
            { keywords: ['verified', 'validated', 'approved', 'resolved'], weight: 2 },
            { keywords: ['deployed', 'released', 'shipped'], weight: 3 },
        ]],
        ['focused', [
            { keywords: ['working', 'processing', 'analyzing', 'reading'], weight: 1 },
            { keywords: ['writing', 'editing', 'modifying', 'updating'], weight: 1 },
            { keywords: ['checking', 'testing', 'reviewing'], weight: 1 },
        ]],
        ['ambient', [
            { keywords: ['idle', 'waiting', 'paused', 'stopped'], weight: 2 },
            { keywords: ['ready', 'standby'], weight: 1 },
        ]],
    ]);

    private readonly phaseKeywords: Map<TaskPhase, string[]> = new Map([
        ['planning', ['planning', 'design', 'analyzing', 'researching', 'investigating', 'requirements', 'spec']],
        ['execution', ['implementing', 'writing', 'creating', 'building', 'coding', 'executing', 'running']],
        ['verification', ['testing', 'verifying', 'checking', 'validating', 'reviewing', 'examining']],
        ['idle', ['idle', 'waiting', 'paused', 'ready']],
    ]);

    // Mood transition smoothing - prevents jarring changes
    private lastMood: Mood = 'ambient';
    private moodHistory: Mood[] = [];
    private readonly historySize = 5;

    constructor() {
        console.log('MoodClassifier: Initialized');
    }

    /**
     * Classify a text input into mood and intensity
     */
    classify(text: string): ActivityClassification {
        const lowerText = text.toLowerCase();
        const signals: string[] = [];

        // Score each mood
        const moodScores = new Map<Mood, number>();
        for (const mood of ['epic', 'tense', 'triumphant', 'focused', 'ambient'] as Mood[]) {
            moodScores.set(mood, 0);
        }

        for (const [mood, keywordGroups] of this.moodKeywords) {
            for (const group of keywordGroups) {
                for (const keyword of group.keywords) {
                    if (lowerText.includes(keyword)) {
                        moodScores.set(mood, (moodScores.get(mood) || 0) + group.weight);
                        signals.push(keyword);
                    }
                }
            }
        }

        // Find winning mood
        let maxScore = 0;
        let detectedMood: Mood = 'focused';
        for (const [mood, score] of moodScores) {
            if (score > maxScore) {
                maxScore = score;
                detectedMood = mood;
            }
        }

        // If no strong signals, default to focused
        if (maxScore === 0) {
            detectedMood = 'focused';
        }

        // Smooth mood transitions
        const smoothedMood = this.smoothMoodTransition(detectedMood, maxScore);

        // Detect task phase
        const taskPhase = this.detectPhase(lowerText);

        // Calculate intensity
        const intensity = this.calculateIntensityFromMood(smoothedMood, signals.length, text.length);

        return {
            mood: smoothedMood,
            intensity,
            taskPhase,
            signals,
        };
    }

    /**
     * Calculate overall intensity from multiple recent activities
     */
    calculateIntensityFromActivities(activities: AgentActivity[], windowMs: number = 60000): number {
        const now = Date.now();
        const recentActivities = activities.filter(a => now - a.timestamp < windowMs);

        if (recentActivities.length === 0) {
            return 20; // Low intensity when idle
        }

        const activityCount = recentActivities.length;
        const avgIntensity = recentActivities.reduce((sum, a) => sum + a.classification.intensity, 0) / activityCount;

        // Calculate activity frequency (activities per minute)
        const frequency = (activityCount / windowMs) * 60000;

        // Combine factors
        let intensity = avgIntensity;

        // Higher frequency = higher intensity
        if (frequency > 10) {
            intensity = Math.min(100, intensity * 1.3);
        } else if (frequency > 5) {
            intensity = Math.min(100, intensity * 1.15);
        }

        return Math.round(intensity);
    }

    /**
     * Detect if a significant mood transition has occurred
     */
    detectMoodTransition(prev: Mood, current: Mood): boolean {
        // Define significant transitions
        const significantTransitions: [Mood | 'any', Mood][] = [
            ['focused', 'tense'],
            ['focused', 'epic'],
            ['tense', 'triumphant'],
            ['any', 'triumphant'],
        ];

        for (const [from, to] of significantTransitions) {
            if ((from === 'any' || from === prev) && to === current) {
                return true;
            }
        }

        return false;
    }

    private smoothMoodTransition(detectedMood: Mood, confidence: number): Mood {
        // Add to history
        this.moodHistory.push(detectedMood);
        if (this.moodHistory.length > this.historySize) {
            this.moodHistory.shift();
        }

        // If high confidence, accept immediately
        if (confidence >= 5) {
            this.lastMood = detectedMood;
            return detectedMood;
        }

        // Count occurrences in history
        const counts = new Map<Mood, number>();
        for (const mood of this.moodHistory) {
            counts.set(mood, (counts.get(mood) || 0) + 1);
        }

        // Find most frequent mood
        let maxCount = 0;
        let dominantMood = this.lastMood;
        for (const [mood, count] of counts) {
            if (count > maxCount) {
                maxCount = count;
                dominantMood = mood;
            }
        }

        // Only change mood if it appears 3+ times or with high confidence
        if (maxCount >= 3 || confidence >= 3) {
            this.lastMood = dominantMood;
            return dominantMood;
        }

        return this.lastMood;
    }

    private detectPhase(text: string): TaskPhase {
        for (const [phase, keywords] of this.phaseKeywords) {
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    return phase;
                }
            }
        }
        return 'execution'; // Default
    }

    private calculateIntensityFromMood(mood: Mood, signalCount: number, textLength: number): number {
        // Base intensity by mood
        const baseIntensity: Record<Mood, number> = {
            epic: 70,
            tense: 75,
            triumphant: 60,
            focused: 45,
            ambient: 20,
        };

        let intensity = baseIntensity[mood];

        // Adjust for signal strength (more signals = more confident = higher intensity)
        intensity += Math.min(signalCount * 3, 20);

        // Longer text might indicate more complex work
        if (textLength > 500) {
            intensity += 5;
        }

        return Math.max(10, Math.min(100, intensity));
    }
}
