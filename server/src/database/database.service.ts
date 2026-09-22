import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BarrierEvent,
  ClarificationRequest,
  Session,
  TaskRecord,
  TaskRevision,
  TranscriptSegment,
} from '../sessions/session.types';

// Safe dynamic loader for node:sqlite across Node 20 and Node 22+
let DatabaseSyncClass: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseSyncClass = require('node:sqlite')?.DatabaseSync;
} catch {
  // node:sqlite is available on Node 22.5.0+
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly db: any = null;
  private readonly isMemoryFallback: boolean = false;

  // In-memory fallback stores
  private readonly memoryAppState = new Map<string, string>();
  private readonly memorySessions = new Map<string, any>();
  private readonly memoryParticipants = new Map<string, string[]>();
  private readonly memoryTranscripts: TranscriptSegment[] = [];
  private readonly memoryBarriers: BarrierEvent[] = [];
  private readonly memoryClarifications: ClarificationRequest[] = [];
  private readonly memoryTasks = new Map<string, TaskRecord>();
  private readonly memoryAiQueries: Array<{ question: string; answer: string; sourceTitle?: string }> = [];

  constructor() {
    if (DatabaseSyncClass) {
      try {
        const dataDir = join(process.cwd(), 'data');
        mkdirSync(dataDir, { recursive: true });
        this.db = new DatabaseSyncClass(join(dataDir, 'understood.sqlite'));
        this.db.exec(`
          PRAGMA journal_mode = WAL;

          CREATE TABLE IF NOT EXISTS app_state (
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (namespace, key)
          );

          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            state_json TEXT NOT NULL,
            started_at TEXT,
            ended_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS session_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            participant_name TEXT NOT NULL,
            role TEXT NOT NULL,
            joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, participant_name)
          );

          CREATE TABLE IF NOT EXISTS transcript_segments (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            speaker_role TEXT NOT NULL,
            text TEXT NOT NULL,
            is_final INTEGER NOT NULL,
            source TEXT NOT NULL,
            confidence REAL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS barrier_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            message_for_employee TEXT NOT NULL,
            guidance_for_manager TEXT NOT NULL,
            confidence REAL NOT NULL,
            evidence_segment_ids TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT
          );

          CREATE TABLE IF NOT EXISTS clarification_requests (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            requested_by TEXT NOT NULL,
            topic TEXT NOT NULL,
            status TEXT NOT NULL,
            related_barrier_id TEXT,
            related_task_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT
          );

          CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            current_revision INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            assignee TEXT NOT NULL,
            deadline TEXT NOT NULL,
            requirement TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS task_revisions (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            revision_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            assignee TEXT NOT NULL,
            deadline TEXT NOT NULL,
            requirement TEXT NOT NULL,
            confirmed_by_manager_at TEXT,
            acknowledged_by_employee_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS user_preferences (
            role TEXT PRIMARY KEY,
            caption_size TEXT NOT NULL DEFAULT 'comfortable',
            alert_sensitivity TEXT NOT NULL DEFAULT 'balanced',
            visual_prompts INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS ai_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            source_title TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);
        return;
      } catch (err) {
        console.warn('SQLite init warning, falling back to memory store:', err);
      }
    }

    this.isMemoryFallback = true;
    console.log('Database running in high-performance memory fallback mode');
  }

  // --- App State (Legacy / KV) ---
  get<T>(namespace: string, key: string): T | null {
    if (this.isMemoryFallback || !this.db) {
      const val = this.memoryAppState.get(`${namespace}:${key}`);
      return val ? (JSON.parse(val) as T) : null;
    }
    const row = this.db
      .prepare('SELECT value FROM app_state WHERE namespace = ? AND key = ?')
      .get(namespace, key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(namespace: string, key: string, value: unknown) {
    if (this.isMemoryFallback || !this.db) {
      this.memoryAppState.set(`${namespace}:${key}`, JSON.stringify(value));
      return;
    }
    this.db
      .prepare(
        `INSERT INTO app_state(namespace, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(namespace, key, JSON.stringify(value));
  }

  // --- Sessions Repository ---
  saveSession(session: Session) {
    if (this.isMemoryFallback || !this.db) {
      this.memorySessions.set(session.id, {
        id: session.id,
        status: session.status,
        state: session.state,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      this.memoryParticipants.set(session.id, [...new Set(session.participants)]);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO sessions (id, status, state_json, started_at, ended_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           state_json = excluded.state_json,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        session.id,
        session.status,
        JSON.stringify(session.state),
        session.startedAt,
        session.endedAt,
        session.createdAt || new Date().toISOString(),
      );

    // Save participants
    for (const p of session.participants) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO session_participants (session_id, participant_name, role)
           VALUES (?, ?, ?)`,
        )
        .run(session.id, p, p);
    }
  }

  getSession(id: string): Session | null {
    if (this.isMemoryFallback || !this.db) {
      const s = this.memorySessions.get(id);
      if (!s) return null;
      return {
        id: s.id,
        status: s.status,
        participants: this.memoryParticipants.get(id) || ['Alex Morgan', 'Jordan Lee'],
        state: s.state,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    }

    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as
      | {
          id: string;
          status: 'CREATED' | 'ACTIVE' | 'ENDED';
          state_json: string;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    const participants = (
      this.db
        .prepare('SELECT participant_name FROM session_participants WHERE session_id = ?')
        .all(id) as { participant_name: string }[]
    ).map((p) => p.participant_name);

    return {
      id: row.id,
      status: row.status,
      participants,
      state: JSON.parse(row.state_json),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Transcript Segments ---
  saveTranscriptSegment(segment: TranscriptSegment) {
    if (this.isMemoryFallback || !this.db) {
      const idx = this.memoryTranscripts.findIndex((s) => s.id === segment.id);
      if (idx >= 0) {
        this.memoryTranscripts[idx] = segment;
      } else {
        this.memoryTranscripts.push(segment);
      }
      return;
    }
    this.db
      .prepare(
        `INSERT INTO transcript_segments (id, session_id, speaker_role, text, is_final, source, confidence, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           is_final = excluded.is_final,
           confidence = excluded.confidence,
           ended_at = excluded.ended_at`,
      )
      .run(
        segment.id,
        segment.sessionId,
        segment.speakerRole,
        segment.text,
        segment.isFinal ? 1 : 0,
        segment.source,
        segment.confidence ?? null,
        segment.startedAt,
        segment.endedAt ?? null,
      );
  }

  getTranscriptSegments(sessionId: string, finalOnly = false): TranscriptSegment[] {
    if (this.isMemoryFallback || !this.db) {
      return this.memoryTranscripts.filter((s) => s.sessionId === sessionId && (!finalOnly || s.isFinal));
    }
    const query = finalOnly
      ? 'SELECT * FROM transcript_segments WHERE session_id = ? AND is_final = 1 ORDER BY created_at ASC'
      : 'SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY created_at ASC';
    const rows = this.db.prepare(query).all(sessionId) as {
      id: string;
      session_id: string;
      speaker_role: 'manager' | 'employee' | 'unknown';
      text: string;
      is_final: number;
      source: 'gemini' | 'browser' | 'device' | 'demo';
      confidence: number | null;
      started_at: string;
      ended_at: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      speakerRole: r.speaker_role,
      text: r.text,
      isFinal: r.is_final === 1,
      source: r.source,
      confidence: r.confidence ?? undefined,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
    }));
  }

  // --- Barrier Events ---
  saveBarrierEvent(event: BarrierEvent) {
    if (this.isMemoryFallback || !this.db) {
      const idx = this.memoryBarriers.findIndex((b) => b.id === event.id);
      if (idx >= 0) {
        this.memoryBarriers[idx] = event;
      } else {
        this.memoryBarriers.push(event);
      }
      return;
    }
    this.db
      .prepare(
        `INSERT INTO barrier_events (id, session_id, type, status, message_for_employee, guidance_for_manager, confidence, evidence_segment_ids, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           resolved_at = excluded.resolved_at`,
      )
      .run(
        event.id,
        event.sessionId,
        event.type,
        event.status,
        event.messageForEmployee,
        event.guidanceForManager,
        event.confidence,
        event.evidenceSegmentIds ? JSON.stringify(event.evidenceSegmentIds) : null,
        event.createdAt,
        event.resolvedAt ?? null,
      );
  }

  getBarrierEvents(sessionId: string): BarrierEvent[] {
    if (this.isMemoryFallback || !this.db) {
      return this.memoryBarriers.filter((b) => b.sessionId === sessionId);
    }
    const rows = this.db
      .prepare('SELECT * FROM barrier_events WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as {
      id: string;
      session_id: string;
      type: BarrierEvent['type'];
      status: BarrierEvent['status'];
      message_for_employee: string;
      guidance_for_manager: string;
      confidence: number;
      evidence_segment_ids: string | null;
      created_at: string;
      resolved_at: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      type: r.type,
      status: r.status,
      messageForEmployee: r.message_for_employee,
      guidanceForManager: r.guidance_for_manager,
      confidence: r.confidence,
      evidenceSegmentIds: r.evidence_segment_ids ? JSON.parse(r.evidence_segment_ids) : undefined,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at ?? undefined,
    }));
  }

  // --- Clarification Requests ---
  saveClarificationRequest(req: ClarificationRequest) {
    if (this.isMemoryFallback || !this.db) {
      const idx = this.memoryClarifications.findIndex((c) => c.id === req.id);
      if (idx >= 0) {
        this.memoryClarifications[idx] = req;
      } else {
        this.memoryClarifications.push(req);
      }
      return;
    }
    this.db
      .prepare(
        `INSERT INTO clarification_requests (id, session_id, requested_by, topic, status, related_barrier_id, related_task_id, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           resolved_at = excluded.resolved_at`,
      )
      .run(
        req.id,
        req.sessionId,
        req.requestedBy,
        req.topic,
        req.status,
        req.relatedBarrierId ?? null,
        req.relatedTaskId ?? null,
        req.createdAt,
        req.resolvedAt ?? null,
      );
  }

  getClarificationRequests(sessionId: string): ClarificationRequest[] {
    if (this.isMemoryFallback || !this.db) {
      return this.memoryClarifications.filter((c) => c.sessionId === sessionId);
    }
    const rows = this.db
      .prepare('SELECT * FROM clarification_requests WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as {
      id: string;
      session_id: string;
      requested_by: string;
      topic: ClarificationRequest['topic'];
      status: ClarificationRequest['status'];
      related_barrier_id: string | null;
      related_task_id: string | null;
      created_at: string;
      resolved_at: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      requestedBy: r.requested_by,
      topic: r.topic,
      status: r.status,
      relatedBarrierId: r.related_barrier_id ?? undefined,
      relatedTaskId: r.related_task_id ?? undefined,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at ?? undefined,
    }));
  }

  // --- Tasks & Revisions ---
  saveTask(task: TaskRecord) {
    if (this.isMemoryFallback || !this.db) {
      this.memoryTasks.set(task.id, task);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO tasks (id, session_id, status, current_revision, title, assignee, deadline, requirement, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           current_revision = excluded.current_revision,
           title = excluded.title,
           assignee = excluded.assignee,
           deadline = excluded.deadline,
           requirement = excluded.requirement,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        task.id,
        task.sessionId,
        task.status,
        task.currentRevision,
        task.title,
        task.assignee,
        task.deadline,
        task.requirement,
        task.createdAt || new Date().toISOString(),
      );

    for (const rev of task.revisions) {
      this.db
        .prepare(
          `INSERT INTO task_revisions (id, task_id, revision_number, title, assignee, deadline, requirement, confirmed_by_manager_at, acknowledged_by_employee_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             assignee = excluded.assignee,
             deadline = excluded.deadline,
             requirement = excluded.requirement,
             confirmed_by_manager_at = excluded.confirmed_by_manager_at,
             acknowledged_by_employee_at = excluded.acknowledged_by_employee_at`,
        )
        .run(
          rev.id,
          rev.taskId,
          rev.revisionNumber,
          rev.title,
          rev.assignee,
          rev.deadline,
          rev.requirement,
          rev.confirmedByManagerAt,
          rev.acknowledgedByEmployeeAt,
          rev.createdAt || new Date().toISOString(),
        );
    }
  }

  getTasksBySession(sessionId?: string): TaskRecord[] {
    if (this.isMemoryFallback || !this.db) {
      const allTasks = Array.from(this.memoryTasks.values());
      return sessionId ? allTasks.filter((t) => t.sessionId === sessionId) : allTasks;
    }
    const query = sessionId
      ? 'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM tasks ORDER BY created_at DESC';
    const rows = (sessionId ? this.db.prepare(query).all(sessionId) : this.db.prepare(query).all()) as {
      id: string;
      session_id: string;
      status: TaskRecord['status'];
      current_revision: number;
      title: string;
      assignee: string;
      deadline: string;
      requirement: string;
      created_at: string;
      updated_at: string;
    }[];

    return rows.map((r) => {
      const revRows = this.db
        .prepare('SELECT * FROM task_revisions WHERE task_id = ? ORDER BY revision_number ASC')
        .all(r.id) as {
        id: string;
        task_id: string;
        revision_number: number;
        title: string;
        assignee: string;
        deadline: string;
        requirement: string;
        confirmed_by_manager_at: string | null;
        acknowledged_by_employee_at: string | null;
        created_at: string;
      }[];

      const revisions: TaskRevision[] = revRows.map((rev) => ({
        id: rev.id,
        taskId: rev.task_id,
        revisionNumber: rev.revision_number,
        title: rev.title,
        assignee: rev.assignee,
        deadline: rev.deadline,
        requirement: rev.requirement,
        confirmedByManagerAt: rev.confirmed_by_manager_at,
        acknowledgedByEmployeeAt: rev.acknowledged_by_employee_at,
        createdAt: rev.created_at,
      }));

      return {
        id: r.id,
        sessionId: r.session_id,
        status: r.status,
        currentRevision: r.current_revision,
        title: r.title,
        assignee: r.assignee,
        deadline: r.deadline,
        requirement: r.requirement,
        revisions,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  getTaskById(id: string): TaskRecord | null {
    if (this.isMemoryFallback || !this.db) {
      return this.memoryTasks.get(id) || null;
    }
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | {
          id: string;
          session_id: string;
          status: TaskRecord['status'];
          current_revision: number;
          title: string;
          assignee: string;
          deadline: string;
          requirement: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    const revRows = this.db
      .prepare('SELECT * FROM task_revisions WHERE task_id = ? ORDER BY revision_number ASC')
      .all(row.id) as {
      id: string;
      task_id: string;
      revision_number: number;
      title: string;
      assignee: string;
      deadline: string;
      requirement: string;
      confirmed_by_manager_at: string | null;
      acknowledged_by_employee_at: string | null;
      created_at: string;
    }[];

    const revisions: TaskRevision[] = revRows.map((rev) => ({
      id: rev.id,
      taskId: rev.task_id,
      revisionNumber: rev.revision_number,
      title: rev.title,
      assignee: rev.assignee,
      deadline: rev.deadline,
      requirement: rev.requirement,
      confirmedByManagerAt: rev.confirmed_by_manager_at,
      acknowledgedByEmployeeAt: rev.acknowledged_by_employee_at,
      createdAt: rev.created_at,
    }));

    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status,
      currentRevision: row.current_revision,
      title: row.title,
      assignee: row.assignee,
      deadline: row.deadline,
      requirement: row.requirement,
      revisions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Reset All for Clean Demo State ---
  resetAll() {
    if (this.isMemoryFallback || !this.db) {
      this.memorySessions.clear();
      this.memoryParticipants.clear();
      this.memoryTranscripts.length = 0;
      this.memoryBarriers.length = 0;
      this.memoryClarifications.length = 0;
      this.memoryTasks.clear();
      this.memoryAppState.clear();
      this.memoryAiQueries.length = 0;
      return;
    }
    this.db.exec(`
      DELETE FROM sessions;
      DELETE FROM session_participants;
      DELETE FROM transcript_segments;
      DELETE FROM barrier_events;
      DELETE FROM clarification_requests;
      DELETE FROM tasks;
      DELETE FROM task_revisions;
      DELETE FROM app_state;
    `);
  }

  logAiQuery(question: string, answer: string, sourceTitle?: string) {
    if (this.isMemoryFallback || !this.db) {
      this.memoryAiQueries.push({ question, answer, sourceTitle });
      return;
    }
    this.db
      .prepare('INSERT INTO ai_queries(question, answer, source_title) VALUES (?, ?, ?)')
      .run(question, answer, sourceTitle ?? null);
  }

  onModuleDestroy() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
    }
  }
}
