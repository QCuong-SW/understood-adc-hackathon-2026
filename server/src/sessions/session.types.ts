export type Role = 'manager' | 'employee';

export type DemoStep =
  | 'idle'
  | 'live'
  | 'barrier'
  | 'clarify'
  | 'task'
  | 'managerConfirmed'
  | 'taskClarification'
  | 'confirmed'
  | 'ended';

export type TaskStatus =
  | 'NONE'
  | 'POSSIBLE'
  | 'PENDING_MANAGER_CONFIRM'
  | 'PENDING_EMPLOYEE_ACK'
  | 'NEEDS_REVISION'
  | 'CONFIRMED';

export type BarrierType =
  | 'FAST_SPEECH'
  | 'OVERLAPPING_SPEAKERS'
  | 'CAPTION_DELAY'
  | 'LOW_CONFIDENCE';

export type ClarificationTopic = 'TASK' | 'DEADLINE' | 'REQUIREMENT' | 'OTHER';

export type TranscriptSource = 'gemini' | 'browser' | 'device' | 'demo' | null;

export type TranscriptSegment = {
  id: string;
  sessionId: string;
  speakerRole: 'manager' | 'employee' | 'unknown';
  text: string;
  isFinal: boolean;
  startedAt: string;
  endedAt?: string;
  confidence?: number;
  source: 'gemini' | 'browser' | 'device' | 'demo';
};

export type BarrierEvent = {
  id: string;
  sessionId: string;
  type: BarrierType;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  messageForEmployee: string;
  guidanceForManager: string;
  evidenceSegmentIds?: string[];
  confidence: number;
  createdAt: string;
  resolvedAt?: string;
};

export type ClarificationRequest = {
  id: string;
  sessionId: string;
  requestedBy: Role | string;
  topic: ClarificationTopic;
  status: 'OPEN' | 'RESOLVED';
  relatedBarrierId?: string;
  relatedTaskId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type TaskRevision = {
  id: string;
  taskId: string;
  revisionNumber: number;
  title: string;
  assignee: string;
  deadline: string;
  requirement: string;
  confirmedByManagerAt: string | null;
  acknowledgedByEmployeeAt: string | null;
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  sessionId: string;
  status: TaskStatus;
  currentRevision: number;
  title: string;
  assignee: string;
  deadline: string;
  requirement: string;
  revisions: TaskRevision[];
  createdAt: string;
  updatedAt: string;
};

export type DemoState = {
  step: DemoStep;
  taskTitle: string;
  assignee: string;
  requirement: string;
  deadline: string;
  revision: number;
  clarificationTopic: string | null;
  lastSignal: string | null;
  taskConfirmed: boolean;
  endedAt: string | null;
  barrierType: BarrierType | null;
  activeBarrier: BarrierEvent | null;
  activeClarification: ClarificationRequest | null;
  liveTranscript: string;
  transcriptSource: TranscriptSource;
  taskStatus: TaskStatus;
  learnedPreference: string | null;
};

export type Session = {
  id: string;
  status: 'CREATED' | 'ACTIVE' | 'ENDED';
  participants: string[];
  state: DemoState;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionSummary = {
  sessionId: string;
  status: 'CREATED' | 'ACTIVE' | 'ENDED';
  duration: string;
  startedAt: string | null;
  endedAt: string | null;
  clarificationsResolvedCount: number;
  tasksConfirmedCount: number;
  confirmedTask: {
    title: string;
    assignee: string;
    deadline: string;
    requirement: string;
    revision: number;
    managerConfirmedAt: string | null;
    employeeAcknowledgedAt: string | null;
  } | null;
  revisionHistory: {
    revision: number;
    action: string;
    timestamp: string;
    detail: string;
  }[];
  privacySummary: {
    retained: string[];
    discarded: string[];
  };
  learnedPreference: string | null;
};
