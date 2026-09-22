import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsGateway } from './sessions/sessions.gateway';
import { SessionsService } from './sessions/sessions.service';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { PreferencesController } from './preferences/preferences.controller';
import { PreferencesService } from './preferences/preferences.service';
import { DatabaseService } from './database/database.service';
import { RealtimeController } from './realtime/realtime.controller';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { GeminiService } from './ai/gemini.service';

@Module({
  controllers: [HealthController, SessionsController, KnowledgeController, PreferencesController, RealtimeController, AiController],
  providers: [DatabaseService, SessionsService, SessionsGateway, KnowledgeService, PreferencesService, GeminiService, AiService],
})
export class AppModule {}
