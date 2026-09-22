import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { Role } from './session.types';

@Controller()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly gateway: SessionsGateway,
  ) {}

  @Post('sessions')
  createSession(@Body() body?: { sessionId?: string }) {
    return this.sessions.findOrCreate(body?.sessionId ?? 'ADC-DEMO');
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return this.sessions.findOrCreate(id);
  }

  @Post('sessions/:id/join')
  join(
    @Param('id') id: string,
    @Body() body?: { participant?: string; role?: Role },
  ) {
    return this.sessions.join(id, body?.participant ?? 'guest', body?.role);
  }

  @Get('sessions/:id/summary')
  getSummary(@Param('id') id: string) {
    return this.sessions.getSessionSummary(id);
  }

  @Get('sessions/:id/segments')
  getSegments(@Param('id') id: string) {
    return this.sessions.getSegments(id);
  }

  @Post('sessions/reset')
  resetDemo(@Body() body?: { sessionId?: string; role?: Role }) {
    const sessionId = body?.sessionId ?? 'ADC-DEMO';
    const result = this.sessions.resetDemo(sessionId, body?.role ?? 'manager');
    try {
      this.gateway.server?.to(`session:${sessionId}`).emit('session:reset', { ok: true });
      this.gateway.server?.to(`session:${sessionId}`).emit('session:state', result.session.state);
      this.gateway.server?.to(`session:${sessionId}`).emit('demo:state', result.session.state);
    } catch {}
    return result;
  }

  @Get('tasks')
  getTasks(@Query('sessionId') sessionId?: string) {
    return this.sessions.getAllTasks(sessionId);
  }

  @Get('tasks/:id')
  getTaskById(@Param('id') id: string) {
    const task = this.sessions.getTaskById(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
