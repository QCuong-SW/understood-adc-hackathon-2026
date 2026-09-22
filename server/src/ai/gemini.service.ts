import { Injectable } from '@nestjs/common';
import { GoogleGenAI, Modality } from '@google/genai';

@Injectable()
export class GeminiService {
  private client() {
    const apiKey = process.env.GEMINI_API_KEY;
    return apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  async text(prompt: string, systemInstruction: string) {
    const client = this.client();
    if (!client) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.8-flash',
          contents: prompt,
          config: { systemInstruction },
        });
        return response.text?.trim() || null;
      } catch (error) {
        if ((error as { status?: number }).status !== 503 || attempt === 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
    return null;
  }

  async json<T>(prompt: string, systemInstruction: string, schema: Record<string, unknown>): Promise<T | null> {
    const client = this.client();
    if (!client) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.8-flash',
          contents: prompt,
          config: { systemInstruction, responseMimeType: 'application/json', responseJsonSchema: schema },
        });
        return response.text ? JSON.parse(response.text) as T : null;
      } catch (error) {
        if ((error as { status?: number }).status !== 503 || attempt === 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
    return null;
  }

  async liveToken() {
    const client = this.client();
    if (!client) return null;
    const model = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.8-live';
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model,
          config: { sessionResumption: {}, responseModalities: [Modality.AUDIO], inputAudioTranscription: {} },
        },
      },
    });
    return { provider: 'gemini', token: token.name, model };
  }
}
