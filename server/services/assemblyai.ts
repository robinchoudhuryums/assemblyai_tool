import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";
import type { GeminiAnalysis } from "./gemini";

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface AssemblyAIResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  confidence?: number;
  words?: TranscriptWord[];
  sentiment_analysis_results?: Array<{
    text: string;
    sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    confidence: number;
    start: number;
    end: number;
  }>;
  auto_chapters?: Array<{
    summary: string;
    headline: string;
    start: number;
    end: number;
  }>;
  iab_categories_result?: {
    summary: Record<string, number>;
  };
  error?: string;
}

export interface LeMURResponse {
  request_id: string;
  response: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || "",
      baseUrl: 'https://api.assemblyai.com/v2'
    };
    if (!this.config.apiKey) {
      console.warn('ASSEMBLYAI_API_KEY is not set. Audio processing will fail.');
    }
  }

  async uploadAudioFile(audioBuffer: Buffer, fileName: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/octet-stream' },
      body: audioBuffer
    });
    if (!response.ok) throw new Error(`Failed to upload audio file: ${await response.text()}`);
    return (await response.json()).upload_url;
  }

  async transcribeAudio(audioUrl: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_model: "best",
        speaker_labels: true,
        punctuate: true,
        format_text: true,
        sentiment_analysis: true,
      })
    });
    if (!response.ok) throw new Error(`Failed to start transcription: ${await response.text()}`);
    return (await response.json()).id;
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      headers: { 'Authorization': this.config.apiKey }
    });
    if (!response.ok) throw new Error(`Failed to get transcript: ${await response.text()}`);
    return await response.json();
  }

  async pollTranscript(transcriptId: string, maxAttempts = 60): Promise<AssemblyAIResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);

      if (transcript.status === 'completed') {
        return transcript;
      }
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error || 'Unknown error'}`);
      }

      // Wait with backoff: 3s for first 10 attempts, then 5s
      const delay = attempt < 10 ? 3000 : 5000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Transcription polling timed out');
  }

  // LeMUR task endpoint is synchronous - it returns the result directly
  async submitLeMURTask(transcriptId: string): Promise<LeMURResponse> {
    console.log(`[${transcriptId}] Submitting task to LeMUR...`);
    const response = await fetch(`https://api.assemblyai.com/lemur/v3/generate/task`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt: `Analyze this customer service call for a medical supply company. Provide your response in the following JSON format only, with no additional text:
{
  "summary": "A concise one-paragraph summary of the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": ["strength1", "strength2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

For sentiment_score, use 0.0-1.0 where 1.0 is most positive.
For performance_score, use 0.0-10.0 where 10.0 is best.
Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols.`,
      })
    });
    if (!response.ok) throw new Error(`Failed to submit LeMUR task: ${await response.text()}`);
    const result = await response.json();
    console.log(`[${transcriptId}] LeMUR task complete. Request ID: ${result.request_id}`);
    return result;
  }

  processTranscriptData(
    transcriptResponse: AssemblyAIResponse,
    aiAnalysis: GeminiAnalysis | null,
    callId: string
  ): { transcript: InsertTranscript; sentiment: InsertSentimentAnalysis; analysis: InsertCallAnalysis } {
    // Build transcript record
    const transcript: InsertTranscript = {
      callId,
      text: transcriptResponse.text || '',
      confidence: transcriptResponse.confidence?.toString(),
      words: transcriptResponse.words || [],
    };

    // Determine sentiment: prefer Gemini analysis, fall back to AssemblyAI sentiment results
    let overallSentiment = aiAnalysis?.sentiment || 'neutral';
    let overallScore = aiAnalysis?.sentiment_score ?? 0.5;

    // If no AI analysis, derive sentiment from AssemblyAI's built-in sentiment results
    if (!aiAnalysis && transcriptResponse.sentiment_analysis_results?.length) {
      const sentiments = transcriptResponse.sentiment_analysis_results;
      const positiveCount = sentiments.filter(s => s.sentiment === 'POSITIVE').length;
      const negativeCount = sentiments.filter(s => s.sentiment === 'NEGATIVE').length;
      const total = sentiments.length;

      if (positiveCount > total * 0.5) overallSentiment = 'positive';
      else if (negativeCount > total * 0.3) overallSentiment = 'negative';
      else overallSentiment = 'neutral';

      const avgConfidence = sentiments.reduce((sum, s) => {
        const weight = s.sentiment === 'POSITIVE' ? s.confidence : s.sentiment === 'NEGATIVE' ? (1 - s.confidence) : 0.5;
        return sum + weight;
      }, 0) / total;
      overallScore = Math.round(avgConfidence * 100) / 100;
    }

    const sentiment: InsertSentimentAnalysis = {
      callId,
      overallSentiment,
      overallScore: overallScore.toString(),
      segments: transcriptResponse.sentiment_analysis_results || [],
    };

    // Build analysis record
    const performanceScore = aiAnalysis?.performance_score ?? 5.0;
    const words = transcriptResponse.words || [];

    // Calculate talk time ratio (if speaker labels exist)
    let talkTimeRatio = 0.5;
    if (words.length > 0) {
      const speakerATime = words
        .filter((w: TranscriptWord) => w.speaker === 'A')
        .reduce((sum: number, w: TranscriptWord) => sum + (w.end - w.start), 0);
      const totalTime = words[words.length - 1].end - words[0].start;
      if (totalTime > 0) {
        talkTimeRatio = Math.round((speakerATime / totalTime) * 100) / 100;
      }
    }

    const analysis: InsertCallAnalysis = {
      callId,
      performanceScore: performanceScore.toString(),
      talkTimeRatio: talkTimeRatio.toString(),
      responseTime: undefined,
      keywords: aiAnalysis?.topics || [],
      topics: aiAnalysis?.topics || [],
      summary: aiAnalysis?.summary || transcriptResponse.text?.slice(0, 500) || '',
      actionItems: aiAnalysis?.action_items || [],
      feedback: aiAnalysis?.feedback || { strengths: [], suggestions: [] },
      lemurResponse: undefined,
    };

    return { transcript, sentiment, analysis };
  }
}

export const assemblyAIService = new AssemblyAIService();
