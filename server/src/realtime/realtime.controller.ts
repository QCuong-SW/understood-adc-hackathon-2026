import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { GeminiService } from '../ai/gemini.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly gemini: GeminiService) {}

  @Get('token')
  async token() {
    try {
      const token = await this.gemini.liveToken();
      if (!token) throw new Error('GEMINI_API_KEY is not configured');
      return token;
    } catch {
      throw new ServiceUnavailableException('Unable to create Gemini Live session');
    }
  }
}
