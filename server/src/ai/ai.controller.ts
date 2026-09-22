import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze-barrier')
  async analyzeBarrier(@Body() body: { transcript?: string }) {
    return this.aiService.analyzeBarrier(body.transcript ?? '');
  }

  @Post('extract-task')
  async extractTask(@Body() body: { transcript?: string }) {
    return this.aiService.extractTask(body.transcript ?? '');
  }

  @Post('summarize')
  async summarizeConversation(@Body() body: { transcript?: string }) {
    return this.aiService.summarizeConversation(body.transcript ?? '');
  }

  // Backward compatibility endpoint
  @Post('analyze-transcript')
  async analyzeTranscript(@Body() body: { transcript?: string }) {
    const transcript = body.transcript ?? '';
    const barrier = await this.aiService.analyzeBarrier(transcript);
    const task = await this.aiService.extractTask(transcript);

    return {
      taskDetected: task.taskDetected,
      taskReason: task.taskReason,
      taskTitle: task.task?.title || '',
      assignee: task.task?.assignee || '',
      deadline: task.task?.deadline || '',
      requirement: task.task?.requirement || '',
      barrierDetected: barrier.barrierDetected,
      barrierType: barrier.barrierType,
      barrierReason: barrier.reason,
      messageForEmployee: barrier.messageForEmployee,
      guidanceForManager: barrier.guidanceForManager,
      confidence: Math.max(barrier.confidence, task.task?.confidence || 0),
      mode: task.mode,
    };
  }
}
