import { Body, Controller, Post } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('query')
  query(@Body() body: { question?: string }) {
    return this.knowledge.query(body.question ?? '');
  }
}
