import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  BarrierEvent,
  ClarificationTopic,
  Role,
  TranscriptSegment,
} from './session.types';
import { SessionsService } from './sessions.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SessionsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly sessions: SessionsService) {}

  private broadcastState(sessionId: string) {
    const session = this.sessions.findOrCreate(sessionId);
    this.server.to(`session:${sessionId}`).emit('session:state', session.state);
    this.server.to(`session:${sessionId}`).emit('demo:state', session.state);
    return session;
  }

  handleConnection(client: Socket) {
    client.emit('server:ready', { connected: true });
  }

  @SubscribeMessage('session:join')
  join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; participant: string; role?: Role },
  ) {
    const session = this.sessions.join(payload.sessionId, payload.participant, payload.role);
    client.join(`session:${payload.sessionId}`);
    client.emit('session:state', session.state);
    this.server.to(`session:${payload.sessionId}`).emit('session:participants', session.participants);
    return { ok: true, sessionId: payload.sessionId, step: session.state.step };
  }

  @SubscribeMessage('session:start')
  start(@MessageBody() payload: { sessionId: string; role?: Role }) {
    const result = this.sessions.startSession(payload.sessionId, payload.role);
    if (result.accepted) this.broadcastState(payload.sessionId);
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('session:end')
  end(@MessageBody() payload: { sessionId: string; role?: Role }) {
    const result = this.sessions.endSession(payload.sessionId, payload.role);
    if (result.accepted) this.broadcastState(payload.sessionId);
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('demo:reset')
  reset(@MessageBody() payload: { sessionId: string; role?: Role }) {
    const result = this.sessions.resetDemo(payload.sessionId, payload.role);
    if (result.accepted) {
      this.server.to(`session:${payload.sessionId}`).emit('session:reset', { ok: true });
      this.broadcastState(payload.sessionId);
    }
    return { ok: result.accepted, reason: result.reason };
  }

  // --- Transcript Pipeline ---
  @SubscribeMessage('transcript:segment')
  transcriptSegment(
    @MessageBody()
    payload: {
      sessionId: string;
      speakerRole: 'manager' | 'employee' | 'unknown';
      text: string;
      isFinal: boolean;
      source: 'gemini' | 'browser' | 'device' | 'demo';
      confidence?: number;
    },
  ) {
    const { session, segment } = this.sessions.addTranscriptSegment(payload.sessionId, payload);
    this.server.to(`session:${payload.sessionId}`).emit('transcript:segment', segment);
    this.server.to(`session:${payload.sessionId}`).emit('session:state', session.state);
    return { ok: true, segmentId: segment.id };
  }

  // --- Barrier Flow ---
  @SubscribeMessage('barrier:create')
  barrierCreate(
    @MessageBody()
    payload: {
      sessionId: string;
      type: BarrierEvent['type'];
      messageForEmployee: string;
      guidanceForManager: string;
      confidence?: number;
    },
  ) {
    const { session, barrier } = this.sessions.addBarrier(payload.sessionId, payload);
    this.server.to(`session:${payload.sessionId}`).emit('barrier:event', barrier);
    this.broadcastState(payload.sessionId);
    return { ok: true, barrierId: barrier.id };
  }

  // --- Clarification Requests ---
  @SubscribeMessage('clarification:request')
  clarify(
    @MessageBody()
    payload: {
      sessionId: string;
      role: Role;
      topic: ClarificationTopic;
      relatedBarrierId?: string;
      relatedTaskId?: string;
    },
  ) {
    const result = this.sessions.createClarification(payload.sessionId, payload.role, payload.topic, {
      relatedBarrierId: payload.relatedBarrierId,
      relatedTaskId: payload.relatedTaskId,
    });
    if (result.accepted) {
      this.server.to(`session:${payload.sessionId}`).emit('clarification:event', result.request);
      this.broadcastState(payload.sessionId);
    }
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('communication:signal')
  communicationSignal(
    @MessageBody()
    payload: {
      sessionId: string;
      role: Role;
      signal: 'understood' | 'slow-down' | 'repeat';
    },
  ) {
    const result = this.sessions.sendCommunicationSignal(payload.sessionId, payload.role, payload.signal);
    if (result.accepted) this.broadcastState(payload.sessionId);
    return { ok: result.accepted };
  }

  // Backward-compatible individual signals
  @SubscribeMessage('communication:understood')
  understood(@MessageBody() payload: { sessionId: string; role: Role }) {
    return this.communicationSignal({ ...payload, signal: 'understood' });
  }

  @SubscribeMessage('communication:slow-down')
  slowDown(@MessageBody() payload: { sessionId: string; role: Role }) {
    return this.communicationSignal({ ...payload, signal: 'slow-down' });
  }

  @SubscribeMessage('communication:repeat')
  repeat(@MessageBody() payload: { sessionId: string; role: Role }) {
    return this.communicationSignal({ ...payload, signal: 'repeat' });
  }

  // --- Task Confirmation Gate ---
  @SubscribeMessage('task:create_possible')
  createPossibleTask(
    @MessageBody()
    payload: {
      sessionId: string;
      title: string;
      assignee?: string;
      deadline?: string;
      requirement?: string;
    },
  ) {
    const { session, task } = this.sessions.createPossibleTask(payload.sessionId, payload);
    this.server.to(`session:${payload.sessionId}`).emit('task:event', task);
    this.broadcastState(payload.sessionId);
    return { ok: true, taskId: task.id };
  }

  @SubscribeMessage('task:manager_update')
  managerUpdate(
    @MessageBody()
    payload: {
      sessionId: string;
      role: Role;
      draft: { title?: string; assignee?: string; deadline?: string; requirement?: string };
    },
  ) {
    const result = this.sessions.managerUpdateTaskDraft(payload.sessionId, payload.role, payload.draft);
    if (result.accepted) this.broadcastState(payload.sessionId);
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('task:manager-confirm')
  managerConfirm(@MessageBody() payload: { sessionId: string; role: Role }) {
    const result = this.sessions.managerConfirmTask(payload.sessionId, payload.role);
    if (result.accepted) {
      this.server.to(`session:${payload.sessionId}`).emit('task:event', result.task);
      this.broadcastState(payload.sessionId);
    }
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('task:employee-clarify')
  employeeClarify(
    @MessageBody()
    payload: {
      sessionId: string;
      role: Role;
      topic?: ClarificationTopic;
    },
  ) {
    const result = this.sessions.createClarification(
      payload.sessionId,
      payload.role,
      payload.topic ?? 'DEADLINE',
    );
    if (result.accepted) {
      this.server.to(`session:${payload.sessionId}`).emit('clarification:event', result.request);
      this.broadcastState(payload.sessionId);
    }
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('task:employee-acknowledge')
  employeeAcknowledge(@MessageBody() payload: { sessionId: string; role: Role }) {
    const result = this.sessions.employeeAcknowledgeTask(payload.sessionId, payload.role);
    if (result.accepted) {
      this.server.to(`session:${payload.sessionId}`).emit('task:event', result.task);
      this.broadcastState(payload.sessionId);
    }
    return { ok: result.accepted, reason: result.reason };
  }

  @SubscribeMessage('demo:advance')
  demoAdvance(@MessageBody() payload: { sessionId: string; role?: Role }) {
    const session = this.sessions.findOrCreate(payload.sessionId);
    if (session.state.step === 'live') {
      return this.barrierCreate({
        sessionId: payload.sessionId,
        type: 'LOW_CONFIDENCE',
        messageForEmployee: 'A deadline or requirement has been updated.',
        guidanceForManager: 'Pause and acknowledge the changed detail clearly.',
      });
    }
    if (session.state.step === 'clarify') {
      return this.createPossibleTask({
        sessionId: payload.sessionId,
        title: session.state.taskTitle || 'Complete the first prototype',
        assignee: 'Alex Morgan',
        deadline: session.state.deadline || 'Thursday, 4:00 PM',
        requirement: session.state.requirement || 'Include the accessibility flow',
      });
    }
    return { ok: true };
  }
}
