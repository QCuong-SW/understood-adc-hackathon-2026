import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BarrierEvent,
  ClarificationRequest,
  Session,
  TaskRecord,
  TranscriptSegment,
} from '../sessions/session.types';

interface Schema {
  appState: Record<string, string>;
  sessions: Record<string, any>;
  participants: Record<string, string[]>;
  transcripts: TranscriptSegment[];
  barriers: BarrierEvent[];
  clarifications: ClarificationRequest[];
  tasks: Record<string, TaskRecord>;
  aiQueries: Array<{ question: string; answer: string; sourceTitle?: string }>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly dataDir: string;
  private readonly dbFilePath: string;
  private state: Schema = {
    appState: {},
    sessions: {},
    participants: {},
    transcripts: [],
    barriers: [],
    clarifications: [],
    tasks: {},
    aiQueries: [],
  };
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.dataDir = join(process.cwd(), 'data');
    this.dbFilePath = join(this.dataDir, 'understood_store.json');

    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      if (existsSync(this.dbFilePath)) {
        const raw = readFileSync(this.dbFilePath, 'utf8');
        this.state = { ...this.state, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn('Initial store load note:', err);
    }
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        if (!existsSync(this.dataDir)) {
          mkdirSync(this.dataDir, { recursive: true });
        }
        writeFileSync(this.dbFilePath, JSON.stringify(this.state, null, 2), 'utf8');
      } catch (err) {
        console.warn('Persist error:', err);
      }
    }, 200);
  }

  // --- App State (Legacy / KV) ---
  get<T>(namespace: string, key: string): T | null {
    const val = this.state.appState[`${namespace}:${key}`];
    return val ? (JSON.parse(val) as T) : null;
  }

  set(namespace: string, key: string, value: unknown) {
    this.state.appState[`${namespace}:${key}`] = JSON.stringify(value);
    this.schedulePersist();
  }

  // --- Sessions Repository ---
  saveSession(session: Session) {
    this.state.sessions[session.id] = {
      id: session.id,
      status: session.status,
      state: session.state,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.participants[session.id] = [...new Set(session.participants)];
    this.schedulePersist();
  }

  getSession(id: string): Session | null {
    const s = this.state.sessions[id];
    if (!s) return null;
    return {
      id: s.id,
      status: s.status,
      participants: this.state.participants[id] || ['Alex Morgan', 'Jordan Lee'],
      state: s.state,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  // --- Transcript Segments ---
  saveTranscriptSegment(segment: TranscriptSegment) {
    const idx = this.state.transcripts.findIndex((s) => s.id === segment.id);
    if (idx >= 0) {
      this.state.transcripts[idx] = segment;
    } else {
      this.state.transcripts.push(segment);
    }
    this.schedulePersist();
  }

  getTranscriptSegments(sessionId: string, finalOnly = false): TranscriptSegment[] {
    return this.state.transcripts.filter(
      (s) => s.sessionId === sessionId && (!finalOnly || s.isFinal),
    );
  }

  // --- Barrier Events ---
  saveBarrierEvent(event: BarrierEvent) {
    const idx = this.state.barriers.findIndex((b) => b.id === event.id);
    if (idx >= 0) {
      this.state.barriers[idx] = event;
    } else {
      this.state.barriers.push(event);
    }
    this.schedulePersist();
  }

  getBarrierEvents(sessionId: string): BarrierEvent[] {
    return this.state.barriers.filter((b) => b.sessionId === sessionId);
  }

  // --- Clarification Requests ---
  saveClarificationRequest(req: ClarificationRequest) {
    const idx = this.state.clarifications.findIndex((c) => c.id === req.id);
    if (idx >= 0) {
      this.state.clarifications[idx] = req;
    } else {
      this.state.clarifications.push(req);
    }
    this.schedulePersist();
  }

  getClarificationRequests(sessionId: string): ClarificationRequest[] {
    return this.state.clarifications.filter((c) => c.sessionId === sessionId);
  }

  // --- Tasks & Revisions ---
  saveTask(task: TaskRecord) {
    this.state.tasks[task.id] = task;
    this.schedulePersist();
  }

  getTasksBySession(sessionId?: string): TaskRecord[] {
    const allTasks = Object.values(this.state.tasks);
    return sessionId ? allTasks.filter((t) => t.sessionId === sessionId) : allTasks;
  }

  getTaskById(id: string): TaskRecord | null {
    return this.state.tasks[id] || null;
  }

  // --- Reset All for Clean Demo State ---
  resetAll() {
    this.state = {
      appState: {},
      sessions: {},
      participants: {},
      transcripts: [],
      barriers: [],
      clarifications: [],
      tasks: {},
      aiQueries: [],
    };
    this.schedulePersist();
  }

  logAiQuery(question: string, answer: string, sourceTitle?: string) {
    this.state.aiQueries.push({ question, answer, sourceTitle });
    this.schedulePersist();
  }

  onModuleDestroy() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }
      writeFileSync(this.dbFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }
}
