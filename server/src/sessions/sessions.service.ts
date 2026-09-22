import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  BarrierEvent,
  ClarificationRequest,
  ClarificationTopic,
  DemoState,
  Role,
  Session,
  SessionSummary,
  TaskRecord,
  TaskRevision,
  TranscriptSegment,
} from './session.types';

const initialState: DemoState = {
  step: 'idle',
  taskTitle: '',
  assignee: 'Alex Morgan',
  requirement: '',
  deadline: '',
  revision: 0,
  clarificationTopic: null,
  lastSignal: null,
  taskConfirmed: false,
  endedAt: null,
  barrierType: null,
  activeBarrier: null,
  activeClarification: null,
  liveTranscript: '',
  transcriptSource: null,
  taskStatus: 'NONE',
  learnedPreference: null,
};

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly database: DatabaseService) {}

  findOrCreate(id = 'ADC-DEMO'): Session {
    if (!this.sessions.has(id)) {
      const stored = this.database.getSession(id);
      if (stored) {
        this.sessions.set(id, stored);
      } else {
        const newSession: Session = {
          id,
          status: 'CREATED',
          participants: [],
          state: { ...initialState },
          startedAt: null,
          endedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.database.saveSession(newSession);
        this.sessions.set(id, newSession);
      }
    }
    return this.sessions.get(id)!;
  }

  join(id: string, participantName: string, role?: Role): Session {
    const session = this.findOrCreate(id);
    if (!session.participants.includes(participantName)) {
      session.participants.push(participantName);
    }
    if (session.state.step !== 'idle' && session.status === 'CREATED') {
      session.status = 'ACTIVE';
    }
    this.database.saveSession(session);
    return session;
  }

  // --- Session Lifecycle ---
  startSession(id: string, role?: Role): { session: Session; accepted: boolean; reason?: string } {
    const session = this.findOrCreate(id);
    if (session.state.step === 'idle' || session.state.step === 'ended') {
      session.status = 'ACTIVE';
      session.startedAt = new Date().toISOString();
      session.state = {
        ...initialState,
        step: 'live',
        endedAt: null,
        taskConfirmed: false,
      };
      this.database.saveSession(session);
      return { session, accepted: true };
    }
    return { session, accepted: true };
  }

  endSession(id: string, role?: Role): { session: Session; accepted: boolean; reason?: string } {
    const session = this.findOrCreate(id);
    if (session.state.step !== 'idle') {
      const endedAt = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      session.status = 'ENDED';
      session.endedAt = new Date().toISOString();
      session.state = {
        ...session.state,
        step: 'ended',
        endedAt,
      };
      this.database.saveSession(session);
      return { session, accepted: true };
    }
    return { session, accepted: false, reason: 'Session is already idle' };
  }

  resetDemo(id = 'ADC-DEMO', role?: Role): { session: Session; accepted: boolean; reason?: string } {
    this.database.resetAll();
    const newSession: Session = {
      id,
      status: 'CREATED',
      participants: ['Jordan Lee (Manager)', 'Alex Morgan (Employee)'],
      state: { ...initialState },
      startedAt: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.database.saveSession(newSession);
    this.sessions.set(id, newSession);
    return { session: newSession, accepted: true };
  }

  // --- Transcript Segment Processing ---
  addTranscriptSegment(
    id: string,
    segmentData: Omit<TranscriptSegment, 'id' | 'sessionId' | 'startedAt'> & {
      id?: string;
      startedAt?: string;
    },
  ): { session: Session; segment: TranscriptSegment } {
    const session = this.findOrCreate(id);
    const segment: TranscriptSegment = {
      id: segmentData.id || `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: id,
      speakerRole: segmentData.speakerRole,
      text: segmentData.text,
      isFinal: segmentData.isFinal,
      source: segmentData.source,
      confidence: segmentData.confidence,
      startedAt: segmentData.startedAt || new Date().toISOString(),
      endedAt: segmentData.isFinal ? new Date().toISOString() : undefined,
    };

    if (segment.isFinal) {
      this.database.saveTranscriptSegment(segment);
    }

    session.state = {
      ...session.state,
      liveTranscript: segment.text,
      transcriptSource: segment.source,
    };

    this.database.saveSession(session);
    return { session, segment };
  }

  // --- Barrier & Clarification Flow ---
  addBarrier(
    id: string,
    barrierData: {
      type: BarrierEvent['type'];
      messageForEmployee: string;
      guidanceForManager: string;
      confidence?: number;
      evidenceSegmentIds?: string[];
    },
  ): { session: Session; barrier: BarrierEvent } {
    const session = this.findOrCreate(id);
    const barrier: BarrierEvent = {
      id: `barrier-${Date.now()}`,
      sessionId: id,
      type: barrierData.type,
      status: 'OPEN',
      messageForEmployee: barrierData.messageForEmployee,
      guidanceForManager: barrierData.guidanceForManager,
      confidence: barrierData.confidence ?? 0.85,
      evidenceSegmentIds: barrierData.evidenceSegmentIds,
      createdAt: new Date().toISOString(),
    };

    this.database.saveBarrierEvent(barrier);

    session.state = {
      ...session.state,
      step: session.state.step === 'live' ? 'barrier' : session.state.step,
      barrierType: barrier.type,
      activeBarrier: barrier,
    };

    this.database.saveSession(session);
    return { session, barrier };
  }

  createClarification(
    id: string,
    role: Role,
    topic: ClarificationTopic,
    context?: { relatedBarrierId?: string; relatedTaskId?: string },
  ): { session: Session; request: ClarificationRequest; accepted: boolean; reason?: string } {
    if (role !== 'employee') {
      return {
        session: this.findOrCreate(id),
        request: null as any,
        accepted: false,
        reason: 'Only Employee can request clarification',
      };
    }

    const session = this.findOrCreate(id);
    const req: ClarificationRequest = {
      id: `clarify-${Date.now()}`,
      sessionId: id,
      requestedBy: 'employee',
      topic,
      status: 'OPEN',
      relatedBarrierId: context?.relatedBarrierId || session.state.activeBarrier?.id,
      relatedTaskId: context?.relatedTaskId,
      createdAt: new Date().toISOString(),
    };

    this.database.saveClarificationRequest(req);

    const isTaskContext = session.state.step === 'managerConfirmed' || !!context?.relatedTaskId;

    session.state = {
      ...session.state,
      step: isTaskContext ? 'taskClarification' : 'clarify',
      clarificationTopic: topic,
      activeClarification: req,
      lastSignal: `Clarify ${topic}`,
      taskStatus: isTaskContext ? 'PENDING_MANAGER_CONFIRM' : session.state.taskStatus,
    };

    this.database.saveSession(session);
    return { session, request: req, accepted: true };
  }

  sendCommunicationSignal(
    id: string,
    role: Role,
    signal: 'understood' | 'slow-down' | 'repeat',
  ): { session: Session; accepted: boolean } {
    const session = this.findOrCreate(id);
    if (role !== 'employee') {
      return { session, accepted: false };
    }

    if (signal === 'understood') {
      session.state = { ...session.state, lastSignal: 'Understood' };
    } else if (signal === 'slow-down') {
      session.state = {
        ...session.state,
        step: session.state.step === 'barrier' ? 'clarify' : session.state.step,
        clarificationTopic: 'Slow down',
        lastSignal: 'Slow down',
      };
    } else if (signal === 'repeat') {
      session.state = {
        ...session.state,
        step: session.state.step === 'barrier' ? 'clarify' : session.state.step,
        clarificationTopic: 'Repeat',
        lastSignal: 'Repeat',
      };
    }

    this.database.saveSession(session);
    return { session, accepted: true };
  }

  // --- Task Confirmation Gate ---
  createPossibleTask(
    id: string,
    taskData: {
      title: string;
      assignee?: string;
      deadline?: string;
      requirement?: string;
    },
  ): { session: Session; task: TaskRecord } {
    const session = this.findOrCreate(id);
    const taskId = `task-${Date.now()}`;
    const initialRev: TaskRevision = {
      id: `rev-${Date.now()}-1`,
      taskId,
      revisionNumber: 1,
      title: taskData.title || 'Complete the first prototype',
      assignee: taskData.assignee || 'Alex Morgan',
      deadline: taskData.deadline || 'Thursday, 4:00 PM',
      requirement: taskData.requirement || 'Include the accessibility flow',
      confirmedByManagerAt: null,
      acknowledgedByEmployeeAt: null,
      createdAt: new Date().toISOString(),
    };

    const task: TaskRecord = {
      id: taskId,
      sessionId: id,
      status: 'POSSIBLE',
      currentRevision: 1,
      title: initialRev.title,
      assignee: initialRev.assignee,
      deadline: initialRev.deadline,
      requirement: initialRev.requirement,
      revisions: [initialRev],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.database.saveTask(task);

    session.state = {
      ...session.state,
      step: 'task',
      taskStatus: 'PENDING_MANAGER_CONFIRM',
      taskTitle: task.title,
      assignee: task.assignee,
      deadline: task.deadline,
      requirement: task.requirement,
      revision: 1,
    };

    this.database.saveSession(session);
    return { session, task };
  }

  managerUpdateTaskDraft(
    id: string,
    role: Role,
    draft: { title?: string; assignee?: string; deadline?: string; requirement?: string },
  ): { session: Session; accepted: boolean; reason?: string } {
    if (role !== 'manager') {
      return { session: this.findOrCreate(id), accepted: false, reason: 'Only Manager can edit task draft' };
    }

    const session = this.findOrCreate(id);
    session.state = {
      ...session.state,
      taskTitle: draft.title ?? session.state.taskTitle,
      assignee: draft.assignee ?? session.state.assignee,
      deadline: draft.deadline ?? session.state.deadline,
      requirement: draft.requirement ?? session.state.requirement,
    };

    this.database.saveSession(session);
    return { session, accepted: true };
  }

  managerConfirmTask(
    id: string,
    role: Role,
  ): { session: Session; task: TaskRecord; accepted: boolean; reason?: string } {
    if (role !== 'manager') {
      return {
        session: this.findOrCreate(id),
        task: null as any,
        accepted: false,
        reason: 'Only Manager can confirm task',
      };
    }

    const session = this.findOrCreate(id);
    const existingTasks = this.database.getTasksBySession(id);
    let task = existingTasks[0];

    const now = new Date().toISOString();
    const revisionNumber = (session.state.revision || 0) + 1;

    if (!task) {
      const taskId = `task-${Date.now()}`;
      task = {
        id: taskId,
        sessionId: id,
        status: 'PENDING_EMPLOYEE_ACK',
        currentRevision: revisionNumber,
        title: session.state.taskTitle,
        assignee: session.state.assignee,
        deadline: session.state.deadline,
        requirement: session.state.requirement,
        revisions: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    const newRev: TaskRevision = {
      id: `rev-${Date.now()}-${revisionNumber}`,
      taskId: task.id,
      revisionNumber,
      title: session.state.taskTitle,
      assignee: session.state.assignee,
      deadline: session.state.deadline,
      requirement: session.state.requirement,
      confirmedByManagerAt: now,
      acknowledgedByEmployeeAt: null,
      createdAt: now,
    };

    task.status = 'PENDING_EMPLOYEE_ACK';
    task.currentRevision = revisionNumber;
    task.title = newRev.title;
    task.assignee = newRev.assignee;
    task.deadline = newRev.deadline;
    task.requirement = newRev.requirement;
    task.revisions.push(newRev);

    this.database.saveTask(task);

    // Resolve any active clarification request
    if (session.state.activeClarification) {
      this.database.saveClarificationRequest({
        ...session.state.activeClarification,
        status: 'RESOLVED',
        resolvedAt: now,
      });
    }

    session.state = {
      ...session.state,
      step: 'managerConfirmed',
      revision: revisionNumber,
      clarificationTopic: null,
      activeClarification: null,
      taskStatus: 'PENDING_EMPLOYEE_ACK',
    };

    this.database.saveSession(session);
    return { session, task, accepted: true };
  }

  employeeAcknowledgeTask(
    id: string,
    role: Role,
  ): { session: Session; task: TaskRecord; accepted: boolean; reason?: string } {
    if (role !== 'employee') {
      return {
        session: this.findOrCreate(id),
        task: null as any,
        accepted: false,
        reason: 'Only Employee can acknowledge task',
      };
    }

    const session = this.findOrCreate(id);
    const existingTasks = this.database.getTasksBySession(id);
    const task = existingTasks[0];

    if (!task) {
      return {
        session,
        task: null as any,
        accepted: false,
        reason: 'No task found to acknowledge',
      };
    }

    const now = new Date().toISOString();
    task.status = 'CONFIRMED';
    const latestRev = task.revisions[task.revisions.length - 1];
    if (latestRev) {
      latestRev.acknowledgedByEmployeeAt = now;
    }

    this.database.saveTask(task);

    session.state = {
      ...session.state,
      step: 'confirmed',
      taskConfirmed: true,
      taskStatus: 'CONFIRMED',
      learnedPreference: `Confirm ${session.state.clarificationTopic ?? 'changed details'} explicitly`,
    };

    this.database.saveSession(session);
    return { session, task, accepted: true };
  }

  // --- Session Summary & Traceability ---
  getSessionSummary(id = 'ADC-DEMO'): SessionSummary {
    const session = this.findOrCreate(id);
    const tasks = this.database.getTasksBySession(id);
    const clarifications = this.database.getClarificationRequests(id);
    const confirmedTask = tasks.find((t) => t.status === 'CONFIRMED');

    const revisionHistory = (confirmedTask?.revisions || []).map((rev) => {
      let action = `Revision ${rev.revisionNumber} created`;
      if (rev.confirmedByManagerAt && rev.acknowledgedByEmployeeAt) {
        action = `Revision ${rev.revisionNumber} confirmed & acknowledged`;
      } else if (rev.confirmedByManagerAt) {
        action = `Revision ${rev.revisionNumber} confirmed by Jordan Lee`;
      }
      return {
        revision: rev.revisionNumber,
        action,
        timestamp: rev.confirmedByManagerAt || rev.createdAt,
        detail: `Deadline: ${rev.deadline} · Requirement: ${rev.requirement}`,
      };
    });

    return {
      sessionId: id,
      status: session.status,
      duration: '08:42',
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      clarificationsResolvedCount: clarifications.length,
      tasksConfirmedCount: confirmedTask ? 1 : 0,
      confirmedTask: confirmedTask
        ? {
            title: confirmedTask.title,
            assignee: confirmedTask.assignee,
            deadline: confirmedTask.deadline,
            requirement: confirmedTask.requirement,
            revision: confirmedTask.currentRevision,
            managerConfirmedAt:
              confirmedTask.revisions[confirmedTask.revisions.length - 1]?.confirmedByManagerAt || null,
            employeeAcknowledgedAt:
              confirmedTask.revisions[confirmedTask.revisions.length - 1]?.acknowledgedByEmployeeAt || null,
          }
        : null,
      revisionHistory,
      privacySummary: {
        retained: [
          'Confirmed task fields',
          'Confirmation timestamps',
          'Relevant conversation excerpts',
          'Accessibility preferences',
        ],
        discarded: ['Raw audio', 'Full private transcript', 'Unconfirmed casual discussion'],
      },
      learnedPreference: session.state.learnedPreference || 'Confirm changed details explicitly.',
    };
  }

  getSegments(sessionId = 'ADC-DEMO'): TranscriptSegment[] {
    return this.database.getTranscriptSegments(sessionId);
  }

  getAllTasks(sessionId?: string): TaskRecord[] {
    return this.database.getTasksBySession(sessionId);
  }

  getTaskById(id: string): TaskRecord | null {
    return this.database.getTaskById(id);
  }
}
