import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";

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
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLY_AI_API_KEY || "",
      baseUrl: 'https://api.assemblyai.com/v2'
    };

    if (!this.config.apiKey) {
      throw new Error('AssemblyAI API key is required. Set ASSEMBLYAI_API_KEY or ASSEMBLY_AI_API_KEY environment variable.');
    }
  }

  async uploadAudioFile(audioBuffer: Buffer, fileName: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/octet-stream'
      },
      body: audioBuffer
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload audio file: ${error}`);
    }

    const result = await response.json();
    return result.upload_url;
  }

  async transcribeAudio(audioUrl: string, options: {
    sentiment_analysis?: boolean;
    auto_chapters?: boolean;
    iab_categories?: boolean;
    speaker_labels?: boolean;
  } = {}): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        sentiment_analysis: options.sentiment_analysis ?? true,
        auto_chapters: options.auto_chapters ?? true,
        iab_categories: options.iab_categories ?? true,
        speaker_labels: options.speaker_labels ?? true,
        punctuate: true,
        format_text: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start transcription: ${error}`);
    }

    const result = await response.json();
    return result.id;
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get transcript: ${error}`);
    }

    return await response.json();
  }

  async pollTranscript(transcriptId: string, maxAttempts = 60): Promise<AssemblyAIResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);
      
      if (transcript.status === 'completed') {
        return transcript;
      } else if (transcript.status === 'error') {
        throw new Error('Transcription failed');
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Transcription timed out');
  }

  processTranscriptData(response: AssemblyAIResponse, callId: string): {
    transcript: InsertTranscript;
    sentiment: InsertSentimentAnalysis;
    analysis: InsertCallAnalysis;
  } {
    if (!response.text) {
      throw new Error('No transcript text available');
    }

    // Process transcript
    const transcript: InsertTranscript = {
      callId,
      text: response.text,
      confidence: response.confidence || 0,
      words: response.words || []
    };

    // Process sentiment analysis
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    
    const sentiment: InsertSentimentAnalysis = {
      callId,
      overallSentiment: overallSentiment.sentiment,
      overallScore: overallSentiment.score,
      segments: sentimentResults.map(segment => ({
        text: segment.text,
        sentiment: segment.sentiment.toLowerCase(),
        confidence: segment.confidence,
        start: segment.start,
        end: segment.end
      }))
    };

    // Process call analysis
    const chapters = response.auto_chapters || [];
    const categories = response.iab_categories_result?.summary || {};
    
    const analysis: InsertCallAnalysis = {
      callId,
      performanceScore: this.calculatePerformanceScore(response),
      talkTimeRatio: this.calculateTalkTimeRatio(response),
      responseTime: this.calculateResponseTime(response),
      keywords: this.extractKeywords(response.text),
      topics: Object.keys(categories).slice(0, 5), // Top 5 categories
      summary: chapters.length > 0 ? chapters[0].summary : this.generateSummary(response.text),
      actionItems: this.extractActionItems(response.text),
      feedback: this.generateFeedback(response)
    };

    return { transcript, sentiment, analysis };
  }

  private calculateOverallSentiment(sentimentResults: any[]): { sentiment: string; score: number } {
    if (sentimentResults.length === 0) {
      return { sentiment: 'neutral', score: 0.5 };
    }

    let positiveScore = 0;
    let neutralScore = 0;
    let negativeScore = 0;
    let totalWeight = 0;

    sentimentResults.forEach(result => {
      const weight = result.end - result.start; // Duration-based weight
      totalWeight += weight;

      if (result.sentiment === 'POSITIVE') {
        positiveScore += weight * result.confidence;
      } else if (result.sentiment === 'NEUTRAL') {
        neutralScore += weight * result.confidence;
      } else {
        negativeScore += weight * result.confidence;
      }
    });

    const avgPositive = positiveScore / totalWeight;
    const avgNeutral = neutralScore / totalWeight;
    const avgNegative = negativeScore / totalWeight;

    if (avgPositive > avgNeutral && avgPositive > avgNegative) {
      return { sentiment: 'positive', score: avgPositive };
    } else if (avgNegative > avgNeutral) {
      return { sentiment: 'negative', score: avgNegative };
    } else {
      return { sentiment: 'neutral', score: avgNeutral };
    }
  }

  private calculatePerformanceScore(response: AssemblyAIResponse): number {
    // Simple scoring based on sentiment and other factors
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    
    let score = 5.0; // Base score
    
    // Sentiment contribution (up to 3 points)
    if (overallSentiment.sentiment === 'positive') {
      score += 2 + (overallSentiment.score * 1);
    } else if (overallSentiment.sentiment === 'neutral') {
      score += 1;
    }
    
    // Confidence contribution (up to 2 points)
    if (response.confidence) {
      score += response.confidence * 2;
    }
    
    return Math.min(10, Math.max(0, score));
  }

  private calculateTalkTimeRatio(response: AssemblyAIResponse): number {
    // Mock calculation - in real implementation, would analyze speaker labels
    return 0.6; // 60% agent talk time
  }

  private calculateResponseTime(response: AssemblyAIResponse): number {
    // Mock calculation - in real implementation, would analyze pauses between speakers
    return 2.5; // 2.5 seconds average response time
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - in production, would use more sophisticated NLP
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their']);
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word));
    
    const wordCount = new Map<string, number>();
    words.forEach(word => {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    });
    
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);
  }

  private generateSummary(text: string): string {
    // Simple summary generation - in production, would use more sophisticated summarization
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ').trim() + '.';
  }

  private extractActionItems(text: string): string[] {
    // Simple action item extraction based on keywords
    const actionKeywords = ['follow up', 'will call', 'send email', 'schedule', 'contact', 'check', 'review', 'update'];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    return sentences
      .filter(sentence => 
        actionKeywords.some(keyword => 
          sentence.toLowerCase().includes(keyword)
        )
      )
      .slice(0, 3);
  }

  private generateFeedback(response: AssemblyAIResponse): any {
    const sentimentResults = response.sentiment_analysis_results || [];
    const overallSentiment = this.calculateOverallSentiment(sentimentResults);
    
    const feedback = {
      strengths: [] as string[],
      improvements: [] as string[],
      suggestions: [] as string[]
    };

    if (overallSentiment.sentiment === 'positive') {
      feedback.strengths.push('Maintained positive customer interaction throughout the call');
    }

    if (response.confidence && response.confidence > 0.8) {
      feedback.strengths.push('Clear and articulate communication');
    } else {
      feedback.improvements.push('Consider speaking more clearly to improve transcription confidence');
    }

    // Add generic suggestions
    feedback.suggestions.push('Continue to use empathy phrases to build rapport');
    feedback.suggestions.push('Summarize key points before ending the call');

    return feedback;
  }
}

export const assemblyAIService = new AssemblyAIService();
