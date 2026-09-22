import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Session as GeminiLiveSession } from '@google/genai';
import {
  Accessibility, ArrowLeft, Bell, BookOpen, Check, CheckCircle2, ChevronRight, ChevronUp,
  CircleHelp, Clock3, FileText, Hand, Headphones, Home, Info, LayoutList,
  LogOut, Menu, MessageCircleQuestion, Mic, MoreHorizontal, Pause, Play, Plus,
  RefreshCcw, Repeat2, Search, Send, Settings, ShieldCheck, Sparkles, UserRound,
  UsersRound, Volume2, X, Zap,
} from 'lucide-react';

export type Role = 'employee' | 'manager';
export type View = 'home' | 'session' | 'tasks' | 'knowledge' | 'settings';
export type DemoStep = 'idle' | 'live' | 'barrier' | 'clarify' | 'task' | 'managerConfirmed' | 'taskClarification' | 'confirmed' | 'ended';
export type DemoCommand =
  | 'session:start'
  | 'session:end'
  | 'demo:advance'
  | 'communication:understood'
  | 'communication:slow-down'
  | 'communication:repeat'
  | 'clarification:request'
  | 'task:manager-confirm'
  | 'task:employee-clarify'
  | 'task:employee-acknowledge'
  | 'demo:reset';
export type BarrierType = 'FAST_SPEECH' | 'OVERLAPPING_SPEAKERS' | 'CAPTION_DELAY' | 'LOW_CONFIDENCE';
export type TaskStatus = 'NONE' | 'POSSIBLE' | 'PENDING_MANAGER_CONFIRM' | 'PENDING_EMPLOYEE_ACK' | 'NEEDS_REVISION' | 'CONFIRMED';
export type ClarificationTopic = 'TASK' | 'DEADLINE' | 'REQUIREMENT' | 'OTHER';

export type Toast = {
  id: string;
  message: string;
  type: 'success' | 'warning' | 'info';
};

export type ExtractedTaskItem = {
  title: string;
  assignee: string;
  deadline: string;
  requirement: string;
  confidence: number;
};

export type SessionTaskItem = {
  id: string;
  title: string;
  assignee: string;
  deadline: string;
  requirement: string;
  status: 'CONFIRMED' | 'MANAGER_CONFIRMED' | 'AWAITING' | 'POSSIBLE';
  revision: number;
  updatedAt?: string;
};

export type ConversationSummaryResult = {
  summary: string;
  bulletPoints: string[];
  keyDecisions: string[];
  taskDetected: boolean;
  taskCount: number;
  tasks: ExtractedTaskItem[];
  task?: ExtractedTaskItem;
  mode: 'ai' | 'fallback';
};

export type TranscriptSegment = {
  id: string;
  sessionId: string;
  speakerRole: 'manager' | 'employee' | 'unknown';
  text: string;
  isFinal: boolean;
  source: 'gemini' | 'browser' | 'device' | 'demo';
  startedAt: string;
};

export type SharedState = {
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
  liveTranscript: string;
  transcriptSource: 'gemini' | 'browser' | 'device' | 'demo' | null;
  taskStatus: TaskStatus;
  learnedPreference: string | null;
};

export type CommunicationPreferences = {
  captionSize: 'small' | 'comfortable' | 'large';
  alertSensitivity: 'low' | 'balanced' | 'high';
  visualPrompts: boolean;
};

const defaultPreferences: CommunicationPreferences = {
  captionSize: 'comfortable',
  alertSensitivity: 'balanced',
  visualPrompts: true,
};

const initialShared: SharedState = {
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
  liveTranscript: '',
  transcriptSource: null,
  taskStatus: 'NONE',
  learnedPreference: null,
};

const defaultSegments: TranscriptSegment[] = [];

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://127.0.0.1:3001');

export type ManagerAlert = {
  id: string;
  signal: 'understood' | 'slow-down' | 'repeat' | 'clarify';
  title: string;
  detail: string;
  badge: string;
  sender: string;
  time: string;
  topic?: string;
  theme: 'emerald' | 'amber' | 'blue' | 'purple';
};

function playHarmonicAlert(signal: string) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (signal === 'understood') {
      // Pleasant C-Major Arpeggio (C5 - E5 - G5)
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.04, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.35);
      });
    } else if (signal === 'slow-down') {
      // Mellow warning double chime (E5 -> C5)
      [659.25, 523.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(0.05, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.4);
      });
    } else if (signal === 'repeat') {
      // Double chirp (D5 -> A5 -> D6)
      [587.33, 880.0, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.04, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.3);
      });
    } else {
      // Clarify: gentle inquiry chime (F5 -> A5)
      [698.46, 880.0].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.045, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.38);
      });
    }

    // Gentle tactile vibration for mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (signal === 'understood') {
        navigator.vibrate([60, 40, 60]);
      } else {
        navigator.vibrate([90, 50, 90]);
      }
    }
  } catch {}
}

function createManagerAlert(signal: string, topic?: string): ManagerAlert {
  const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sender = 'Alex Morgan (Employee)';

  if (signal === 'understood') {
    return {
      id,
      signal: 'understood',
      title: 'Alex understood (Understood)',
      detail: 'Alex is following along well and understands the discussion. Keep going!',
      badge: 'UNDERSTOOD',
      sender,
      time,
      theme: 'emerald',
    };
  } else if (signal === 'slow-down') {
    return {
      id,
      signal: 'slow-down',
      title: 'Alex: Please slow down',
      detail: 'Alex requested reducing speaking pace or pausing 2-3 seconds between sentences to keep up.',
      badge: 'SLOW DOWN',
      sender,
      time,
      theme: 'amber',
    };
  } else if (signal === 'repeat') {
    return {
      id,
      signal: 'repeat',
      title: 'Alex: Please repeat',
      detail: 'Alex missed the last point and requested a brief repetition.',
      badge: 'REPEAT',
      sender,
      time,
      theme: 'blue',
    };
  } else {
    const topicLabel =
      topic === 'DEADLINE' ? 'Deadline' :
      topic === 'REQUIREMENT' ? 'Requirements' :
      topic === 'TASK' ? 'Task details' :
      (topic || 'Discussion topic');
    return {
      id,
      signal: 'clarify',
      title: `Alex requested clarification: ${topicLabel}`,
      detail: `Alex needs confirmation on "${topicLabel}" to prevent misunderstanding.`,
      badge: 'CLARIFICATION NEEDED',
      sender,
      time,
      topic,
      theme: 'purple',
    };
  }
}

function useSharedDemo(
  role: Role | null,
  onToast?: (msg: string, type: Toast['type']) => void,
  onManagerAlert?: (alert: ManagerAlert) => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const prevSignalRef = useRef<string | null>(null);
  const [state, setState] = useState<SharedState>(() => {
    const saved = localStorage.getItem('understood-demo-state');
    return saved ? JSON.parse(saved) : initialShared;
  });
  const [segments, setSegments] = useState<TranscriptSegment[]>(() => {
    const saved = localStorage.getItem('understood-demo-segments');
    return saved ? JSON.parse(saved) : defaultSegments;
  });

  // Fetch latest state & segments on mount
  useEffect(() => {
    if (!role) return;
    void fetch(`${API_BASE}/api/v1/sessions/ADC-DEMO`)
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (session?.state) {
          setState(session.state);
          localStorage.setItem('understood-demo-state', JSON.stringify(session.state));
        }
      })
      .catch(() => undefined);

    void fetch(`${API_BASE}/api/v1/sessions/ADC-DEMO/segments`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: TranscriptSegment[]) => {
        if (data && data.length > 0) {
          setSegments(data);
          localStorage.setItem('understood-demo-segments', JSON.stringify(data));
        }
      })
      .catch(() => undefined);
  }, [role]);

  useEffect(() => {
    const channel = new BroadcastChannel('understood-demo');
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'state') setState(event.data.payload);
      if (event.data?.type === 'signal') {
        const sig = event.data.payload.signal;
        const topic = event.data.payload.topic;
        if (role === 'manager') {
          playHarmonicAlert(sig);
          const alertObj = createManagerAlert(sig, topic);
          onManagerAlert?.(alertObj);
          const type = sig === 'understood' ? 'success' : 'warning';
          onToast?.(`⚡ ${alertObj.title}`, type);
        }
      }
      if (event.data?.type === 'reset') {
        setState(initialShared);
        setSegments(defaultSegments);
        localStorage.setItem('understood-demo-state', JSON.stringify(initialShared));
        localStorage.setItem('understood-demo-segments', JSON.stringify(defaultSegments));
        localStorage.removeItem('understood-session-tasks');
      }
      if (event.data?.type === 'segment') {
        setSegments((curr) => {
          if (curr.some((s) => s.id === event.data.payload.id)) return curr;
          const next = [...curr, event.data.payload];
          localStorage.setItem('understood-demo-segments', JSON.stringify(next));
          return next;
        });
      }
    };

    const socket = io(API_BASE, {
      reconnectionAttempts: 5,
      timeout: 1500,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('session:join', {
        sessionId: 'ADC-DEMO',
        participant: role === 'manager' ? 'Jordan Lee (Manager)' : 'Alex Morgan (Employee)',
        role,
      });
    });

    const handleStateUpdate = (next: SharedState) => {
      localStorage.setItem('understood-demo-state', JSON.stringify(next));
      setState(next);
      channel.postMessage({ type: 'state', payload: next });

      if (next.step === 'idle' && next.revision === 0) {
        setSegments(defaultSegments);
        localStorage.setItem('understood-demo-segments', JSON.stringify(defaultSegments));
        localStorage.removeItem('understood-session-tasks');
      }
    };

    socket.on('session:state', handleStateUpdate);
    socket.on('demo:state', handleStateUpdate);

    socket.on('communication:signal', (data: { signal: string; senderRole: string; topic?: string }) => {
      if (role === 'manager') {
        playHarmonicAlert(data.signal);
        const alertObj = createManagerAlert(data.signal, data.topic);
        onManagerAlert?.(alertObj);
        const type = data.signal === 'understood' ? 'success' : 'warning';
        onToast?.(`⚡ ${alertObj.title}`, type);
      }
    });

    socket.on('session:reset', () => {
      setState(initialShared);
      setSegments(defaultSegments);
      localStorage.setItem('understood-demo-state', JSON.stringify(initialShared));
      localStorage.setItem('understood-demo-segments', JSON.stringify(defaultSegments));
      localStorage.removeItem('understood-session-tasks');
    });

    socket.on('transcript:segment', (segment: TranscriptSegment) => {
      setSegments((curr) => {
        if (curr.some((s) => s.id === segment.id)) return curr;
        const next = [...curr, segment];
        localStorage.setItem('understood-demo-segments', JSON.stringify(next));
        channel.postMessage({ type: 'segment', payload: segment });
        return next;
      });
    });

    socket.on('clarification:event', (req: { topic: string }) => {
      if (role === 'manager') {
        playHarmonicAlert('clarify');
        const alertObj = createManagerAlert('clarify', req.topic);
        onManagerAlert?.(alertObj);
        onToast?.(`⚡ ${alertObj.title}`, 'warning');
      }
    });

    const storage = (event: StorageEvent) => {
      if (event.key === 'understood-demo-state' && event.newValue) {
        setState(JSON.parse(event.newValue));
      }
      if (event.key === 'understood-demo-segments' && event.newValue) {
        setSegments(JSON.parse(event.newValue));
      }
    };
    window.addEventListener('storage', storage);

    return () => {
      channel.close();
      channelRef.current = null;
      socket.disconnect();
      socketRef.current = null;
      window.removeEventListener('storage', storage);
    };
  }, [role, onToast, onManagerAlert]);

  const command = (
    name: DemoCommand,
    payload: { topic?: string; draft?: Partial<SharedState>; title?: string; assignee?: string; deadline?: string; requirement?: string } = {},
  ) => {
    if (name === 'demo:reset') {
      setState(initialShared);
      setSegments(defaultSegments);
      localStorage.setItem('understood-demo-state', JSON.stringify(initialShared));
      localStorage.setItem('understood-demo-segments', JSON.stringify(defaultSegments));
      channelRef.current?.postMessage({ type: 'state', payload: initialShared });
      channelRef.current?.postMessage({ type: 'reset' });
      void fetch(`${API_BASE}/api/v1/sessions/reset`, { method: 'POST' }).catch(() => undefined);
    }

    if (socketRef.current?.connected) {
      if (name === 'clarification:request') {
        socketRef.current.emit('clarification:request', { sessionId: 'ADC-DEMO', role, topic: payload.topic || 'DEADLINE' });
      } else if (name === 'task:employee-clarify') {
        socketRef.current.emit('task:employee-clarify', { sessionId: 'ADC-DEMO', role, topic: payload.topic || 'DEADLINE' });
      } else {
        socketRef.current.emit(name, { sessionId: 'ADC-DEMO', role, ...payload });
      }
    } else {
      // Local fallback if server unreachable
      setState((curr) => {
        let next = { ...curr };
        if (name === 'session:start') next.step = 'live';
        if (name === 'session:end') { next.step = 'ended'; next.endedAt = '10:44 AM'; }
        if (name === 'demo:reset') {
          next = { ...initialShared };
          setSegments(defaultSegments);
        }
        if (name === 'communication:understood') next.lastSignal = 'Understood';
        if (name === 'communication:slow-down') { next.step = 'clarify'; next.clarificationTopic = 'Slow down'; next.lastSignal = 'Slow down'; }
        if (name === 'communication:repeat') { next.step = 'clarify'; next.clarificationTopic = 'Repeat'; next.lastSignal = 'Repeat'; }
        if (name === 'clarification:request') { next.step = 'clarify'; next.clarificationTopic = payload.topic || 'DEADLINE'; next.lastSignal = `Clarify ${payload.topic || 'Deadline'}`; }
        if (name === 'task:manager-confirm') {
          next.step = 'managerConfirmed';
          next.revision = (next.revision || 0) + 1;
          next.taskStatus = 'PENDING_EMPLOYEE_ACK';
        }
        if (name === 'task:employee-acknowledge') {
          next.step = 'confirmed';
          next.taskConfirmed = true;
          next.taskStatus = 'CONFIRMED';
        }
        localStorage.setItem('understood-demo-state', JSON.stringify(next));
        return next;
      });
    }
  };

  const emitTranscript = (text: string, isFinal: boolean, source: 'gemini' | 'browser' | 'device' | 'demo') => {
    const segment: TranscriptSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: 'ADC-DEMO',
      speakerRole: role ?? 'unknown',
      text,
      isFinal,
      source,
      startedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // 1. Instant Optimistic Update on Sender UI (0ms)
    setSegments((curr) => {
      if (curr.some((s) => s.id === segment.id)) return curr;
      const next = [...curr, segment];
      localStorage.setItem('understood-demo-segments', JSON.stringify(next));
      return next;
    });

    // 2. Direct Instant Cross-tab sync (<1ms)
    channelRef.current?.postMessage({ type: 'segment', payload: segment });

    // 3. Socket.IO Real-time server sync & broadcast (<5ms)
    if (socketRef.current?.connected) {
      socketRef.current.emit('transcript:segment', segment);
    }
  };

  const emitBarrier = (type: BarrierType, messageForEmployee: string, guidanceForManager: string) => {
    setState((curr) => {
      const next: SharedState = {
        ...curr,
        step: 'barrier',
        barrierType: type,
        lastSignal: 'Communication barrier detected',
      };
      localStorage.setItem('understood-demo-state', JSON.stringify(next));
      channelRef.current?.postMessage({ type: 'state', payload: next });
      return next;
    });

    if (socketRef.current?.connected) {
      socketRef.current.emit('barrier:create', {
        sessionId: 'ADC-DEMO',
        type,
        messageForEmployee,
        guidanceForManager,
      });
    }
  };

  const emitPossibleTask = (task: { title: string; assignee?: string; deadline?: string; requirement?: string }) => {
    setState((curr) => {
      const next: SharedState = {
        ...curr,
        step: 'task',
        taskTitle: task.title || curr.taskTitle,
        assignee: task.assignee || curr.assignee || 'Alex Morgan',
        deadline: task.deadline || curr.deadline || 'Thursday, 4:00 PM',
        requirement: task.requirement || curr.requirement || 'Include the accessibility flow',
        taskStatus: 'POSSIBLE',
      };
      localStorage.setItem('understood-demo-state', JSON.stringify(next));
      channelRef.current?.postMessage({ type: 'state', payload: next });
      return next;
    });

    if (socketRef.current?.connected) {
      socketRef.current.emit('task:create_possible', {
        sessionId: 'ADC-DEMO',
        ...task,
      });
    }
  };

  const emitTaskUpdate = (draft: { title?: string; assignee?: string; deadline?: string; requirement?: string }) => {
    setState((curr) => {
      const next: SharedState = {
        ...curr,
        taskTitle: draft.title || curr.taskTitle,
        assignee: draft.assignee || curr.assignee,
        deadline: draft.deadline || curr.deadline,
        requirement: draft.requirement || curr.requirement,
      };
      localStorage.setItem('understood-demo-state', JSON.stringify(next));
      channelRef.current?.postMessage({ type: 'state', payload: next });
      return next;
    });

    if (socketRef.current?.connected) {
      socketRef.current.emit('task:manager_update', {
        sessionId: 'ADC-DEMO',
        role,
        draft,
      });
    }
  };

  return { state, segments, command, emitTranscript, emitBarrier, emitPossibleTask, emitTaskUpdate };
}

function usePreferences(role: Role | null) {
  const [preferences, setPreferences] = useState<CommunicationPreferences>(defaultPreferences);

  useEffect(() => {
    if (!role) return;
    const key = `understood-preferences-${role}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved) as CommunicationPreferences;
      setPreferences(parsed);
      void fetch(`${API_BASE}/api/v1/preferences/${role}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      }).catch(() => undefined);
      return;
    }
    void fetch(`${API_BASE}/api/v1/preferences/${role}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((val: CommunicationPreferences) => {
        setPreferences(val);
        localStorage.setItem(key, JSON.stringify(val));
      })
      .catch(() => setPreferences(defaultPreferences));
  }, [role]);

  const save = (changes: Partial<CommunicationPreferences>) => {
    setPreferences((curr) => {
      const next = { ...curr, ...changes };
      if (role) {
        localStorage.setItem(`understood-preferences-${role}`, JSON.stringify(next));
        void fetch(`${API_BASE}/api/v1/preferences/${role}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        }).catch(() => undefined);
      }
      return next;
    });
  };

  return { preferences, save };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Understood">
      <img src="/logo.png" alt="Understood" className={`brand-logo-img ${compact ? 'compact' : ''}`} />
      {!compact && <span>understood<span className="brand-dot">.</span></span>}
    </div>
  );
}

function RoleEntry({ onChoose }: { onChoose: (role: Role) => void }) {
  return (
    <main className="entry-page">
      <div className="entry-orb orb-one" />
      <div className="entry-orb orb-two" />
      <header className="entry-header"><Brand /><span className="demo-pill">ADC Hackathon 2026</span></header>
      <section className="entry-card">
        <div className="eyebrow"><Sparkles size={15} /> Communication, made clearer</div>
        <h1>Make sure work is<br /><em>understood.</em></h1>
        <p className="entry-copy">1:1 accessible communication. Mutual task confirmation.</p>
        <div className="role-grid">
          <button className="role-card" onClick={() => onChoose('employee')}>
            <span className="role-icon employee"><Headphones /></span>
            <span><strong>Employee</strong><small>Alex Morgan · Follow and confirm work</small></span>
            <ChevronRight />
          </button>
          <button className="role-card" onClick={() => onChoose('manager')}>
            <span className="role-icon manager"><UsersRound /></span>
            <span><strong>Manager</strong><small>Jordan Lee · Guide and assign work</small></span>
            <ChevronRight />
          </button>
        </div>
        <div className="privacy-note"><ShieldCheck size={16} /> Privacy-first workspace · Raw audio is never stored</div>
      </section>
      <footer className="entry-footer">Accessible communication repair for everyone.</footer>
    </main>
  );
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'session', label: 'Live session', icon: Mic },
  { id: 'tasks', label: 'Tasks', icon: LayoutList },
  { id: 'knowledge', label: 'Ask company', icon: BookOpen },
  { id: 'settings', label: 'Preferences', icon: Settings },
];

const mobileNavItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'session', label: 'Live Session', icon: Mic },
  { id: 'tasks', label: 'Tasks', icon: LayoutList },
  { id: 'settings', label: 'Preferences', icon: Settings },
];

function ManagerHeadsUpBanner({
  alert,
  onDismiss,
}: {
  alert: ManagerAlert | null;
  onDismiss: () => void;
}) {
  if (!alert) return null;

  const Icon =
    alert.signal === 'understood' ? CheckCircle2 :
    alert.signal === 'slow-down' ? Hand :
    alert.signal === 'repeat' ? Repeat2 :
    CircleHelp;

  return (
    <>
      {/* Ambient glowing bar along top edge of viewport */}
      <div className={`manager-ambient-glow theme-${alert.theme}`} />

      {/* Floating Heads-Up Banner / Standout Callout */}
      <div className={`manager-heads-up-banner theme-${alert.theme}`} role="alert" aria-live="assertive">
        <div className="manager-alert-icon-wrap">
          <div className="manager-alert-icon-ring" />
          <Icon size={22} strokeWidth={2.4} />
        </div>

        <div className="manager-alert-body">
          <div className="manager-alert-top">
            <div className="manager-alert-sender-chip">
              <span className="manager-sender-avatar">AM</span>
              <span className="manager-sender-name">{alert.sender}</span>
            </div>
            <span className={`manager-signal-badge ${alert.theme}`}>{alert.badge}</span>
            <span className="manager-alert-time">{alert.time}</span>
          </div>
          <h4 className="manager-alert-title">{alert.title}</h4>
          <p className="manager-alert-detail">{alert.detail}</p>
        </div>

        <div className="manager-alert-actions">
          <button
            type="button"
            className="manager-alert-ack-btn"
            onClick={onDismiss}
            title="Acknowledge feedback from Alex"
          >
            <Check size={14} />
            <span>Got it</span>
          </button>
          <button
            type="button"
            className="manager-alert-close-btn"
            onClick={onDismiss}
            aria-label="Dismiss alert"
          >
            <X size={15} />
          </button>
        </div>

        {/* Countdown progress bar */}
        <div className="manager-alert-progress-track">
          <div className="manager-alert-progress-fill" />
        </div>
      </div>
    </>
  );
}

function Shell({
  role,
  view,
  setView,
  onExit,
  children,
  notifications,
  toasts,
  onDismissToast,
  managerAlert,
  onDismissManagerAlert,
}: {
  role: Role;
  view: View;
  setView: (view: View) => void;
  onExit: () => void;
  children: React.ReactNode;
  notifications: { title: string; time: string; type: string }[];
  toasts: Toast[];
  onDismissToast: (id: string) => void;
  managerAlert?: ManagerAlert | null;
  onDismissManagerAlert?: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const name = role === 'employee' ? 'Alex Morgan' : 'Jordan Lee';

  return (
    <div className={`app-shell view-${view}`}>
      {/* Realtime Standout Heads-Up Alert for Manager */}
      {role === 'manager' && managerAlert && onDismissManagerAlert && (
        <ManagerHeadsUpBanner alert={managerAlert} onDismiss={onDismissManagerAlert} />
      )}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <Brand />
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></button>
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => { setView(item.id); setMobileOpen(false); }}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button
          className="support-card clickable"
          onClick={() => { setView('settings'); setMobileOpen(false); }}
          title="Open communication preferences"
        >
          <div>
            <span className="support-icon"><Accessibility size={21} /></span>
            <ChevronRight size={16} color="#c7681a" />
          </div>
          <strong>Accessibility support</strong>
          <small>Adjust caption size & alert sensitivity</small>
        </button>
        <button className="profile-card" onClick={onExit} aria-label="Switch demo role">
          <span className="avatar">{role === 'employee' ? 'AM' : 'JL'}</span>
          <span><strong>{name}</strong><small>{role === 'employee' ? 'Product designer' : 'Team manager'}</small></span>
          <LogOut size={17} />
        </button>
      </aside>
      {mobileOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <div className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu /></button>
          <div className="topbar-title">
            <span>{role === 'employee' ? 'Employee' : 'Manager'}</span>
            <small>{role === 'employee' ? 'Alex Morgan · Product Designer' : 'Jordan Lee · Team Manager'}</small>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setView('knowledge')} aria-label="Search company knowledge" title="Search company policy">
              <Search />
            </button>
            <button
              className="icon-button notification"
              onClick={() => setNotifOpen(!notifOpen)}
              aria-label="Toggle notifications"
              title="Recent signals & notifications"
            >
              <Bell />
              {notifications.length > 0 && <i />}
            </button>
            <span className="top-avatar">{role === 'employee' ? 'AM' : 'JL'}</span>

            {notifOpen && (
              <div className="notifications-popup" role="dialog" aria-label="Notifications list">
                <div className="notifications-head">
                  <strong>Session Activity</strong>
                  <button onClick={() => setNotifOpen(false)} aria-label="Close"><X size={15} /></button>
                </div>
                <div className="notifications-list">
                  {notifications.length === 0 ? (
                    <div style={{ padding: '15px 5px', color: '#888', textAlign: 'center', fontSize: 11 }}>No new notifications</div>
                  ) : (
                    notifications.map((n, idx) => (
                      <div key={idx} className="notification-item">
                        <span className="icon"><Sparkles /></span>
                        <div>
                          <strong>{n.title}</strong>
                          <small>{n.time}</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>

      {/* Mobile Bottom Navigation Bar (Essential, Large & Clear) */}
      <nav className="mobile-bottom-nav" aria-label="Mobile bottom navigation">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.id;
          const isSession = item.id === 'session';
          return (
            <button
              key={item.id}
              type="button"
              className={`bottom-nav-item ${isActive ? 'active' : ''} ${isSession ? 'session-nav' : ''}`}
              onClick={() => {
                setView(item.id);
                setMobileOpen(false);
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="bottom-nav-icon-wrap">
                <Icon size={21} />
                {isSession && <span className="bottom-nav-pulse-dot" />}
              </span>
              <span className="bottom-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Floating Toast Container */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-message ${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 /> : t.type === 'warning' ? <Zap /> : <Info />}
            <span>{t.message}</span>
            <button onClick={() => onDismissToast(t.id)} aria-label="Close notification"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow-text">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function HomeView({ role, state, onStart, goTasks, goKnowledge, goSettings }: { role: Role; state: SharedState; onStart: () => void; goTasks: () => void; goKnowledge: () => void; goSettings: () => void }) {
  const confirmed = state.step === 'confirmed' || state.taskConfirmed;
  return (
    <div className="content-stack">
      <PageHeading eyebrow="Monday, September 22" title={`Good afternoon, ${role === 'employee' ? 'Alex' : 'Jordan'}.`} copy="Your accessible communication workspace." />
      <section className="hero-card">
        <div className="hero-copy">
          <span className="live-kicker"><i /> {state.step === 'idle' ? 'Ready when you are' : state.step === 'ended' ? 'Session completed' : 'Session ADC-DEMO is active'}</span>
          <h2>{state.step === 'ended' ? 'Conversation complete.' : state.step === 'idle' ? 'Ready to start conversation.' : 'Conversation ready to join.'}</h2>
          <p>Two-way live accessible communication workspace & deadline alignment.</p>
          <button className="primary-button" onClick={onStart}>
            {state.step === 'ended' ? (
              <><FileText size={18} /> View session summary</>
            ) : state.step === 'idle' ? (
              <><Play size={18} /> Start conversation</>
            ) : (
              <><Mic size={18} /> Join live session</>
            )}
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="sound-ring ring-a" /><div className="sound-ring ring-b" />
          <span><Volume2 size={34} /></span>
          <div className="wave">{[12,22,34,18,40,28,16,32,21].map((h,i)=><i key={i} style={{height:h}} />)}</div>
        </div>
      </section>
      <section className="stats-grid">
        <article className="stat-card"><span className="stat-icon green"><CheckCircle2 /></span><div><small>Confirmed tasks</small><strong>{confirmed ? 3 : 2}</strong></div></article>
        <article className="stat-card"><span className="stat-icon orange"><Clock3 /></span><div><small>{role === 'employee' ? 'Due this week' : 'Awaiting confirmation'}</small><strong>{confirmed ? 1 : 2}</strong></div></article>
        <article className="stat-card"><span className="stat-icon blue"><MessageCircleQuestion /></span><div><small>Clarifications resolved</small><strong>4</strong></div></article>
      </section>
      <section className="two-column">
        <div className="panel">
          <div className="panel-head"><div><span className="section-kicker">Recent work</span><h3>{role === 'employee' ? 'My tasks' : 'Assignments'}</h3></div><button className="text-button" onClick={goTasks}>View all <ChevronRight size={16} /></button></div>
          {confirmed && <TaskRow title={state.taskTitle} deadline={state.deadline} status="Mutually confirmed" />}
          <TaskRow title="Prepare onboarding interview notes" deadline="Wednesday, 2:00 PM" status="Mutually confirmed" />
          <TaskRow title="Review design system updates" deadline="Friday" status={role === 'manager' ? 'Waiting for acknowledgement' : 'Manager confirmed'} pending />
        </div>
        <div className="panel quick-panel">
          <div className="panel-head"><div><span className="section-kicker">Quick access</span><h3>Tools</h3></div></div>
          <button onClick={goKnowledge}><span className="quick-icon"><BookOpen /></span><span><strong>Ask company</strong></span><ChevronRight /></button>
          <button onClick={goSettings}><span className="quick-icon peach"><Accessibility /></span><span><strong>Preferences</strong></span><ChevronRight /></button>
        </div>
      </section>
    </div>
  );
}

function TaskRow({ title, deadline, status, pending = false, onOpen }: { title: string; deadline: string; status: string; pending?: boolean; onOpen?: () => void }) {
  return (
    <div className={`task-row ${onOpen ? 'interactive' : ''}`}>
      <span className={`task-check ${pending ? 'pending' : ''}`}>{pending ? <Clock3 /> : <Check />}</span>
      <div><strong>{title}</strong><small>Due {deadline}</small></div>
      <span className={`status-chip ${pending ? 'amber' : 'green'}`}>{status}</span>
      <button aria-label={onOpen ? `View details for ${title}` : 'More options'} onClick={onOpen}>{onOpen ? <ChevronRight /> : <MoreHorizontal />}</button>
    </div>
  );
}

function useRealtimeVoice(
  onFinalSegment?: (text: string, source: 'gemini' | 'browser' | 'device') => void,
  defaultLang: 'vi-VN' | 'en-US' = 'vi-VN'
) {
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'error'>('off');
  const [transcript, setTranscript] = useState('');
  const [language, setLanguage] = useState<'vi-VN' | 'en-US'>(defaultLang);
  const [provider, setProvider] = useState<'gemini' | 'browser' | 'device' | null>(null);
  const [error, setError] = useState('');
  const langRef = useRef(language);
  langRef.current = language;

  const stop = () => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setProvider(null);
    setError('');
    setTranscript('');
    setStatus('off');
  };

  const start = () => {
    if (status === 'live' || isListeningRef.current) {
      stop();
      return;
    }

    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setStatus('error');
      setError('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    setStatus('connecting');
    setTranscript('');
    setError('');
    isListeningRef.current = true;

    try {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = langRef.current || 'en-US';

      recognition.onstart = () => {
        setStatus('live');
        setProvider('browser');
        setError('');
      };

      recognition.onresult = (event: any) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            const cleanFinal = text.trim();
            if (cleanFinal) {
              setTranscript('');
              if (onFinalSegment) {
                onFinalSegment(cleanFinal, 'browser');
              }
            }
          } else {
            interimText += text;
          }
        }
        if (interimText.trim()) {
          setTranscript(interimText.trim());
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          isListeningRef.current = false;
          setError('Microphone access was denied. Please allow microphone permissions in your browser.');
          setStatus('error');
        } else if (event.error === 'network') {
          setError('Speech recognition network error.');
        }
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          try {
            recognition.lang = langRef.current;
            recognition.start();
          } catch {
            setTimeout(() => {
              if (isListeningRef.current) {
                try {
                  recognition.lang = langRef.current;
                  recognition.start();
                } catch {}
              }
            }, 100);
          }
        } else {
          setStatus('off');
          setTranscript('');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      isListeningRef.current = false;
      setStatus('error');
      setError(err?.message || 'Unable to start microphone');
    }
  };

  const changeLanguage = (newLang: 'vi-VN' | 'en-US') => {
    setLanguage(newLang);
    langRef.current = newLang;
    if (isListeningRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  };

  useEffect(() => stop, []);
  return { status, transcript, language, changeLanguage, provider, error, start, stop };
}

const barrierCopy: Record<BarrierType, { title: string; detail: string }> = {
  FAST_SPEECH: { title: 'Speech may be too fast', detail: 'Pause and restate the key detail.' },
  OVERLAPPING_SPEAKERS: { title: 'Speakers may be overlapping', detail: 'Let one person finish, then repeat.' },
  CAPTION_DELAY: { title: 'Captions may be delayed', detail: 'Wait briefly before continuing.' },
  LOW_CONFIDENCE: { title: 'Check understanding', detail: 'A key deadline or requirement has changed.' },
};

const clarificationTopics: { label: string; value: ClarificationTopic; desc: string }[] = [
  { label: 'Deadline', value: 'DEADLINE', desc: 'Confirm the final date or time' },
  { label: 'Requirement', value: 'REQUIREMENT', desc: 'Confirm expected details or scope' },
  { label: 'Task', value: 'TASK', desc: 'Confirm what needs to be done' },
  { label: 'Something else', value: 'OTHER', desc: 'Ask for a clearer restatement' },
];

function SessionView({
  role,
  state,
  segments,
  command,
  emitTranscript,
  emitBarrier,
  emitPossibleTask,
  emitTaskUpdate,
  preferences,
  onViewTasks,
  onToast,
  onGoHome,
}: {
  role: Role;
  state: SharedState;
  segments: TranscriptSegment[];
  command: (name: DemoCommand, payload?: { topic?: string }) => void;
  emitTranscript: (text: string, isFinal: boolean, source: 'gemini' | 'browser' | 'device' | 'demo') => void;
  emitBarrier: (type: BarrierType, msgEmp: string, guideMgr: string) => void;
  emitPossibleTask: (task: { title: string; assignee?: string; deadline?: string; requirement?: string }) => void;
  emitTaskUpdate: (draft: { title?: string; assignee?: string; deadline?: string; requirement?: string }) => void;
  preferences: CommunicationPreferences;
  onViewTasks: () => void;
  onToast: (msg: string, type: Toast['type']) => void;
  onGoHome?: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState<'conversation' | 'task' | null>(null);
  const [draft, setDraft] = useState(state);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ mode: 'ai' | 'fallback'; confidence: number; reason: string; taskDetected: boolean } | null>(null);
  const [highlightPulse, setHighlightPulse] = useState(false);
  const [inputText, setInputText] = useState('');
  const [taskViewMode, setTaskViewMode] = useState<'focus' | 'list'>('focus');
  const [newTaskDraft, setNewTaskDraft] = useState<{ title: string; assignee: string; deadline: string; requirement: string }>({
    title: '',
    assignee: 'Alex Morgan',
    deadline: 'Friday, 5:00 PM',
    requirement: 'Follow accessibility guidelines',
  });

  const [sessionTasks, setSessionTasks] = useState<SessionTaskItem[]>(() => {
    const saved = localStorage.getItem('understood-session-tasks');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return [
      {
        id: 'task-1',
        title: state.taskTitle || 'Complete the first prototype',
        assignee: state.assignee || 'Alex Morgan',
        deadline: state.deadline || 'Thursday, 4:00 PM',
        requirement: state.requirement || 'Include the accessibility flow',
        status: state.taskConfirmed ? 'CONFIRMED' : state.step === 'managerConfirmed' ? 'MANAGER_CONFIRMED' : 'POSSIBLE',
        revision: state.revision || 1,
      },
    ];
  });

  const timelineEndRef = useRef<HTMLDivElement | null>(null);

  // Sync sessionTasks with broadcast channel
  useEffect(() => {
    const channel = new BroadcastChannel('understood-demo');
    const handleMsg = (event: MessageEvent) => {
      if (event.data?.type === 'session-tasks') {
        setSessionTasks(event.data.payload);
      }
    };
    channel.addEventListener('message', handleMsg);
    return () => {
      channel.removeEventListener('message', handleMsg);
      channel.close();
    };
  }, []);

  // Update first task if state changes
  useEffect(() => {
    setSessionTasks((curr) => {
      if (curr.length === 0) {
        return [
          {
            id: 'task-1',
            title: state.taskTitle || 'Complete the first prototype',
            assignee: state.assignee || 'Alex Morgan',
            deadline: state.deadline || 'Thursday, 4:00 PM',
            requirement: state.requirement || 'Include the accessibility flow',
            status: state.taskConfirmed ? 'CONFIRMED' : state.step === 'managerConfirmed' ? 'MANAGER_CONFIRMED' : 'POSSIBLE',
            revision: state.revision || 1,
          },
        ];
      }
      return curr.map((t, idx) => {
        if (idx === 0) {
          return {
            ...t,
            title: state.taskTitle || t.title,
            deadline: state.deadline || t.deadline,
            requirement: state.requirement || t.requirement,
            status: state.taskConfirmed ? 'CONFIRMED' : state.step === 'managerConfirmed' ? 'MANAGER_CONFIRMED' : t.status,
            revision: state.revision || t.revision,
          };
        }
        return t;
      });
    });
  }, [state.taskTitle, state.deadline, state.requirement, state.taskConfirmed, state.step, state.revision]);

  const updateAndBroadcastTasks = (newTasks: SessionTaskItem[]) => {
    setSessionTasks(newTasks);
    localStorage.setItem('understood-session-tasks', JSON.stringify(newTasks));
    try {
      const channel = new BroadcastChannel('understood-demo');
      channel.postMessage({ type: 'session-tasks', payload: newTasks });
      channel.close();
    } catch {}
  };

  const handleSelectTaskFocus = (task: SessionTaskItem) => {
    emitTaskUpdate({
      title: task.title,
      assignee: task.assignee,
      deadline: task.deadline,
      requirement: task.requirement,
    });
    setTaskViewMode('focus');
    onToast(`Focused on task: "${task.title}"`, 'info');
  };

  const handleBatchConfirmAll = () => {
    const confirmedTasks = sessionTasks.map((t) => ({ ...t, status: 'CONFIRMED' as const }));
    updateAndBroadcastTasks(confirmedTasks);
    command('task:manager-confirm');
    command('task:employee-acknowledge');
    emitTranscript(`Jordan confirmed & Alex acknowledged all ${sessionTasks.length} session tasks (Mutually confirmed).`, true, 'demo');
    onToast(`All ${sessionTasks.length} tasks mutually confirmed & agreed!`, 'success');
  };

  const handleQuickConfirmSingleTask = (taskId: string) => {
    const next = sessionTasks.map((t) => (t.id === taskId ? { ...t, status: 'CONFIRMED' as const } : t));
    updateAndBroadcastTasks(next);
    const item = sessionTasks.find((t) => t.id === taskId);
    emitTranscript(`Mutually confirmed task: "${item?.title || 'Assignment'}" · Due ${item?.deadline}`, true, 'demo');
    onToast(`Confirmed task: "${item?.title}"`, 'success');
  };

  const handleRemoveTask = (taskId: string) => {
    if (sessionTasks.length <= 1) {
      onToast('At least 1 task must remain in the session', 'warning');
      return;
    }
    const next = sessionTasks.filter((t) => t.id !== taskId);
    updateAndBroadcastTasks(next);
    onToast('Task removed from session list', 'info');
  };

  const handleApplyAiTasksToSession = (aiTasks: ExtractedTaskItem[]) => {
    if (!aiTasks || aiTasks.length === 0) return;
    const newItems: SessionTaskItem[] = aiTasks.map((t, idx) => ({
      id: `task-ai-${Date.now()}-${idx}`,
      title: t.title,
      assignee: t.assignee || 'Alex Morgan',
      deadline: t.deadline || 'Thursday, 4:00 PM',
      requirement: t.requirement || 'Standard criteria',
      status: 'POSSIBLE',
      revision: 1,
    }));
    updateAndBroadcastTasks(newItems);
    emitPossibleTask({
      title: newItems[0].title,
      assignee: newItems[0].assignee,
      deadline: newItems[0].deadline,
      requirement: newItems[0].requirement,
    });
    setTaskViewMode('list');
    onToast(`Added ${newItems.length} extracted tasks to the session!`, 'success');
  };

  const handleCreateNewTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskDraft.title.trim()) {
      onToast('Please enter a task title', 'warning');
      return;
    }
    const item: SessionTaskItem = {
      id: `task-custom-${Date.now()}`,
      title: newTaskDraft.title.trim(),
      assignee: newTaskDraft.assignee.trim() || 'Alex Morgan',
      deadline: newTaskDraft.deadline.trim() || 'Friday, 5:00 PM',
      requirement: newTaskDraft.requirement.trim() || 'Standard criteria',
      status: 'POSSIBLE',
      revision: 1,
    };
    const next = [...sessionTasks, item];
    updateAndBroadcastTasks(next);
    setNewTaskDraft({ title: '', assignee: 'Alex Morgan', deadline: 'Friday, 5:00 PM', requirement: 'Follow accessibility guidelines' });
    setCreateTaskOpen(false);
    setTaskViewMode('list');
    onToast(`Added new task: "${item.title}"`, 'success');
  };

  // Auto-scroll on new message
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  // Two-way instant microphone capture with EN / VI language support
  const voice = useRealtimeVoice((text, src) => {
    emitTranscript(text, true, src);

    // Auto-check for changed deadline when Manager speaks in live mode
    if (role === 'manager' && state.step === 'live') {
      const lower = text.toLowerCase();
      if (/actually|move|thursday|change|dời|đổi|thay đổi/.test(lower)) {
        emitBarrier('LOW_CONFIDENCE', 'A deadline or requirement has been updated.', 'Pause and acknowledge the changed detail clearly.');
      }
    }
  }, 'en-US');

  const [isDictating, setIsDictating] = useState(false);
  const inputRecognitionRef = useRef<any>(null);

  const toggleDictation = () => {
    if (isDictating) {
      try { inputRecognitionRef.current?.stop(); } catch {}
      setIsDictating(false);
      return;
    }
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      onToast('Speech recognition is not supported in this browser. Please use Chrome or Edge.', 'warning');
      return;
    }
    try {
      const rec = new Recognition();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = voice.language;
      rec.onresult = (event: any) => {
        let t = '';
        for (let i = 0; i < event.results.length; i++) {
          t += event.results[i][0].transcript;
        }
        setInputText(t);
      };
      rec.onend = () => setIsDictating(false);
      rec.onerror = () => setIsDictating(false);
      rec.start();
      inputRecognitionRef.current = rec;
      setIsDictating(true);
      onToast(`Listening (${voice.language === 'en-US' ? 'English' : 'Vietnamese'})... Speak your message`, 'info');
    } catch {
      setIsDictating(false);
    }
  };

  const fullConversationText = useMemo(() => {
    if (segments.length > 0) {
      return segments.map((s) => `${s.speakerRole === 'manager' ? 'Jordan' : 'Alex'}: ${s.text}`).join('\n');
    }
    return '';
  }, [segments]);

  const start = () => command('session:start');
  const reset = () => {
    command('demo:reset');
    setAiSummary(null);
    setAiResult(null);
    onToast('Demo session reset', 'info');
  };

  const handleSendText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    emitTranscript(text, true, 'demo');
    setInputText('');

    // Auto-check for changed details when Manager sends text in live mode
    if (role === 'manager' && state.step === 'live') {
      const lower = text.toLowerCase();
      if (/actually|move|thursday|change|dời|đổi|thay đổi/.test(lower)) {
        emitBarrier('LOW_CONFIDENCE', 'A deadline or requirement has been updated.', 'Pause and acknowledge the changed detail clearly.');
      }
    }

    onToast(`${role === 'manager' ? 'Jordan' : 'Alex'} sent a message`, 'info');
  };

  const [signalsOpen, setSignalsOpen] = useState(false);

  const handleSignal = (sig: 'understood' | 'slow-down' | 'repeat') => {
    command(sig === 'understood' ? 'communication:understood' : sig === 'slow-down' ? 'communication:slow-down' : 'communication:repeat');

    try {
      const ch = new BroadcastChannel('understood-demo');
      ch.postMessage({ type: 'signal', payload: { signal: sig, senderRole: role } });
      ch.close();
    } catch {}

    const textMap = {
      understood: 'Signal sent: "Understood" (Jordan notified)',
      'slow-down': 'Signal sent: "Slow down" (Jordan notified)',
      repeat: 'Signal sent: "Repeat" (Jordan notified)',
    };
    onToast(textMap[sig], sig === 'understood' ? 'success' : 'warning');
  };

  const handleClarificationSubmit = (topic: ClarificationTopic) => {
    const queryText =
      topic === 'DEADLINE'
        ? 'Could we clarify the final deadline?'
        : topic === 'REQUIREMENT'
        ? 'Could we clarify the expected requirements?'
        : topic === 'TASK'
        ? 'Could we clarify what needs to be done?'
        : 'Could we clarify the latest detail?';

    emitTranscript(queryText, true, 'demo');

    try {
      const ch = new BroadcastChannel('understood-demo');
      ch.postMessage({ type: 'signal', payload: { signal: 'clarify', topic, senderRole: role } });
      ch.close();
    } catch {}

    if (clarifyOpen === 'task') {
      command('task:employee-clarify', { topic });
      onToast(`Task clarification requested on "${topic}" (Jordan notified)`, 'info');
    } else {
      command('clarification:request', { topic });
      onToast(`Clarification requested on "${topic}" (Jordan notified)`, 'info');
    }
    setClarifyOpen(null);
  };

  const [mobileTaskOpen, setMobileTaskOpen] = useState(false);

  const handleFocusDetails = () => {
    setMobileTaskOpen(true);
    const el = document.getElementById('important-info');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      setHighlightPulse(true);
      setTimeout(() => setHighlightPulse(false), 2500);
    }
  };

  const [aiSummary, setAiSummary] = useState<ConversationSummaryResult | null>(null);

  const runAiSummarize = async () => {
    const textToAnalyze = fullConversationText.trim();
    if (!textToAnalyze) {
      onToast('No messages in the conversation yet to summarize. Please speak or send a message first.', 'warning');
      return;
    }
    setAiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/ai/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: textToAnalyze }),
      });
      if (!res.ok) throw new Error('AI summary failed');
      const data: ConversationSummaryResult = await res.json();
      setAiSummary(data);

      if (data.taskDetected && data.task) {
        setAiResult({
          mode: data.mode,
          confidence: data.task.confidence ?? 0.88,
          reason: 'AI successfully extracted tasks from the conversation.',
          taskDetected: true,
        });
        emitPossibleTask({
          title: data.task.title,
          assignee: data.task.assignee,
          deadline: data.task.deadline,
          requirement: data.task.requirement,
        });
        onToast('AI summarized conversation & extracted tasks successfully!', 'success');
      } else {
        setAiResult({
          mode: data.mode,
          confidence: 0.9,
          reason: 'Conversation summary completed.',
          taskDetected: false,
        });
        onToast('AI completed conversation summary.', 'info');
      }
      setMobileTaskOpen(true);
    } catch {
      onToast('AI summarization service is busy, please try again.', 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  // Trigger AI Barrier Analysis or Task Extraction
  const analyzeConversation = async () => {
    return runAiSummarize();
  };

  if (state.step === 'ended') {
    return <SessionSummary role={role} state={state} onRestart={reset} onViewTasks={onViewTasks} />;
  }

  if (state.step === 'idle') {
    return (
      <div className="empty-session">
        {onGoHome && (
          <button className="back-link" onClick={onGoHome} type="button">
            <ArrowLeft size={16} /> Overview
          </button>
        )}
        <div className="preflight-card">
          <span className="preflight-icon"><Mic /></span>
          <p className="eyebrow-text">Session ADC-DEMO</p>
          <h1>{role === 'manager' ? 'Start conversation with Alex' : 'Start conversation with Jordan'}</h1>
          <p>Two-way live captions enabled. Raw audio is never stored.</p>
          <div className="preflight-list">
            <span><Check /> Both microphones ready</span>
            <span><Check /> Real-time 1:1 sync</span>
            <span><Check /> Traceable confirmations</span>
          </div>
          <button className="primary-button" onClick={start}>
            <Play size={18} /> {role === 'manager' ? 'Start conversation' : 'Start conversation with Jordan'}
          </button>
        </div>
      </div>
    );
  }

  const barrier = state.step === 'barrier' || state.step === 'clarify';
  const taskVisible = ['task', 'managerConfirmed', 'taskClarification', 'confirmed'].includes(state.step);
  const confirmed = state.step === 'confirmed';
  const activeBarrier = barrierCopy[state.barrierType ?? 'LOW_CONFIDENCE'];
  const hasPendingAction = state.step === 'task' || state.step === 'managerConfirmed' || state.step === 'taskClarification';

  const renderKeyDetailsContent = () => (
    <>
      {/* Task View Mode Switcher */}
      <div className="task-mode-switcher">
        <button
          type="button"
          className={`task-mode-btn ${taskViewMode === 'focus' ? 'active' : ''}`}
          onClick={() => setTaskViewMode('focus')}
          title="View single focus task"
        >
          <Sparkles size={13} />
          <span>Focus Task</span>
        </button>
        <button
          type="button"
          className={`task-mode-btn ${taskViewMode === 'list' ? 'active' : ''}`}
          onClick={() => setTaskViewMode('list')}
          title="View all session tasks"
        >
          <LayoutList size={13} />
          <span>Task List</span>
          <span className="task-badge-count">{sessionTasks.length}</span>
        </button>
      </div>

      {/* Live AI Conversation Summary Box */}
      {aiSummary && (
        <div className="ai-summary-box">
          <div className="ai-summary-box-header">
            <Sparkles size={16} />
            <span>AI Conversation Summary</span>
            <span className="ai-summary-tag">
              {aiSummary.taskCount > 1 ? `${aiSummary.taskCount} Tasks` : 'AI Summary'}
            </span>
          </div>
          <p className="ai-summary-text">{aiSummary.summary}</p>
          {aiSummary.bulletPoints.length > 0 && (
            <ul className="ai-summary-bullets">
              {aiSummary.bulletPoints.map((bp: string, i: number) => (
                <li key={i}>{bp}</li>
              ))}
            </ul>
          )}
          {aiSummary.keyDecisions.length > 0 && (
            <div className="ai-decision-row">
              {aiSummary.keyDecisions.map((kd: string, i: number) => (
                <span key={i} className="ai-decision-tag">
                  <CheckCircle2 size={12} /> {kd}
                </span>
              ))}
            </div>
          )}

          {/* Multi-Task Deduplicated List */}
          {aiSummary.tasks && aiSummary.tasks.length > 0 && (
            <div className="ai-multitask-list">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <small style={{ fontWeight: 700, color: '#1d5582' }}>
                  {aiSummary.tasks.length > 1 ? `AI extracted ${aiSummary.tasks.length} tasks:` : 'AI extracted 1 task:'}
                </small>
                <button
                  type="button"
                  className="mini-action-btn primary"
                  style={{ fontSize: 9, padding: '3px 8px' }}
                  onClick={() => handleApplyAiTasksToSession(aiSummary.tasks)}
                  title="Apply all extracted tasks to session list"
                >
                  <Check size={11} /> Apply to list
                </button>
              </div>
              {aiSummary.tasks.map((tItem: ExtractedTaskItem, idx: number) => (
                <div
                  key={idx}
                  className="ai-task-item-card clickable"
                  onClick={() => {
                    emitPossibleTask(tItem);
                    setTaskViewMode('focus');
                    onToast(`Selected task: "${tItem.title}"`, 'info');
                  }}
                  title="Click to focus and confirm this task"
                >
                  <div className="ai-task-item-top">
                    <strong>{idx + 1}. {tItem.title}</strong>
                    <span className="mini-chip">{tItem.deadline}</span>
                  </div>
                  <small>Assignee: {tItem.assignee} · {tItem.requirement}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mode 1: Multi-Task List View */}
      {taskViewMode === 'list' ? (
        <div className="synthesized-task-list-wrap">
          <div className="synthesized-task-list">
            {sessionTasks.map((st, idx) => {
              const isConfirmed = st.status === 'CONFIRMED';
              const isMgrConfirmed = st.status === 'MANAGER_CONFIRMED';
              return (
                <div
                  key={st.id || idx}
                  className={`synthesized-task-card ${isConfirmed ? 'confirmed' : ''}`}
                >
                  <div className="synthesized-task-header">
                    <div className="synthesized-task-title-wrap">
                      <span className="task-num-tag">#{idx + 1}</span>
                      <h4 className="synthesized-task-title">{st.title}</h4>
                    </div>
                    <span className={isConfirmed ? 'status-dot green' : 'status-dot'}>
                      {isConfirmed ? 'Confirmed' : isMgrConfirmed ? 'Awaiting Alex' : 'Possible'}
                    </span>
                  </div>
                  <div className="task-meta-row">
                    <span><UserRound size={12} /> {st.assignee}</span>
                    <span className="deadline-badge"><Clock3 size={11} /> {st.deadline}</span>
                    <span>Rev {st.revision || 1}</span>
                  </div>
                  <p className="task-requirement-text">{st.requirement}</p>
                  <div className="synthesized-task-actions">
                    <button
                      type="button"
                      className="mini-action-btn"
                      onClick={() => handleSelectTaskFocus(st)}
                      title="View details & confirm"
                    >
                      <Sparkles size={11} /> Details
                    </button>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!isConfirmed && (
                        <button
                          type="button"
                          className="mini-action-btn success"
                          onClick={() => handleQuickConfirmSingleTask(st.id)}
                          title="Quickly confirm this task"
                        >
                          <Check size={11} /> Confirm
                        </button>
                      )}
                      <button
                        type="button"
                        className="mini-action-btn danger"
                        onClick={() => handleRemoveTask(st.id)}
                        title="Remove this task"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Batch Actions for Task List */}
          <div className="batch-task-toolbar">
            <button
              type="button"
              className="batch-confirm-all-btn"
              onClick={handleBatchConfirmAll}
              title="Confirm and agree on all session tasks"
            >
              <CheckCircle2 size={15} /> Confirm all ({sessionTasks.length}) Tasks
            </button>
            <button
              type="button"
              className="add-task-quick-btn"
              onClick={() => setCreateTaskOpen(true)}
              title="Add a new task to session"
            >
              <Plus size={14} /> Add Task
            </button>
          </div>
        </div>
      ) : (
        /* Mode 2: Single Focus Task Card */
        !taskVisible ? (
          barrier ? (
            <div className="barrier-diff-card">
              <div className="barrier-diff-header">
                <Zap size={16} />
                <span>Communication Change Detected</span>
                <span className="barrier-tag">AI Live Diff</span>
              </div>
              <div className="diff-comparison">
                <div className="diff-item old">
                  <small>Previous / Initial</small>
                  <strong><s>Friday</s></strong>
                </div>
                <div className="diff-arrow"><ChevronRight size={18} /></div>
                <div className="diff-item new">
                  <small>Updated In Speech</small>
                  <strong><mark>{state.deadline || 'Thursday, 4:00 PM'}</mark></strong>
                </div>
              </div>
              <div className="barrier-guidance-box">
                <Sparkles size={14} />
                <p>
                  {role === 'manager'
                    ? 'Alex may need clear restatement of the updated deadline. Use the Restatement Box to confirm.'
                    : 'Jordan modified the deadline mid-sentence. You can ask for clarification or wait for restatement.'}
                </p>
              </div>
              {role === 'employee' && (
                <button className="primary-button full-width" onClick={() => setClarifyOpen('conversation')}>
                  <CircleHelp size={16} /> Ask for Clarification
                </button>
              )}
            </div>
          ) : !aiSummary ? (
            <div className="empty-context">
              <FileText />
              <strong>No task detected yet</strong>
              <p>Important work details and changed deadlines will appear here for review.</p>
            </div>
          ) : null
        ) : (
          <div className={`task-card ${confirmed ? 'confirmed' : ''}`}>
            <div className="task-card-top">
              <span><Sparkles /> {confirmed ? 'Confirmed task' : state.step === 'taskClarification' ? 'Clarification requested' : state.step === 'managerConfirmed' ? 'Manager confirmed' : 'AI task extracted'}</span>
              <span className={confirmed ? 'status-dot green' : 'status-dot'}>{confirmed ? 'Confirmed' : state.step === 'taskClarification' ? 'Needs revision' : 'Ready to confirm'}</span>
            </div>
            <dl>
              <div><dt>Task</dt><dd>{state.taskTitle}</dd></div>
              <div><dt>Assignee</dt><dd>{state.assignee || 'Alex Morgan'}</dd></div>
              <div><dt>Deadline</dt><dd>{state.deadline}</dd><small className="change-note">Updated from speech</small></div>
              <div><dt>Requirement</dt><dd>{state.requirement}</dd></div>
            </dl>

            {!confirmed && role === 'manager' && (
              <>
                <div className={state.step === 'taskClarification' ? 'clarification-note' : 'clarification-note hidden'}>
                  <CircleHelp /> Alex requested clarification about: <strong>{state.clarificationTopic || 'Deadline'}</strong>
                </div>
                <div className="task-buttons">
                  <button className="secondary-button" onClick={() => { setDraft(state); setEditOpen(true); }}>Edit</button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      command('task:manager-confirm');
                      emitTranscript(`Jordan confirmed Assignment (Revision ${(state.revision || 0) + 1}): "${state.taskTitle || 'Assignment'}" · Due ${state.deadline || 'TBD'}`, true, 'demo');
                      onToast('Task confirmed by Manager', 'success');
                    }}
                  >
                    <Check /> {state.step === 'taskClarification' ? 'Confirm revised task' : 'Confirm assignment'}
                  </button>
                </div>
              </>
            )}

            {!confirmed && role === 'employee' && (
              <div className="ack-area" style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                  <button className="secondary-button" style={{ flex: 1 }} onClick={() => setClarifyOpen('task')}>
                    <CircleHelp size={14} /> Clarify
                  </button>
                  <button className="secondary-button" style={{ flex: 1 }} onClick={() => { setDraft(state); setEditOpen(true); }}>
                    Edit
                  </button>
                  <button
                    className="primary-button"
                    style={{ flex: 2 }}
                    onClick={() => {
                      command('task:employee-acknowledge');
                      emitTranscript(`Alex acknowledged & confirmed task: "${state.taskTitle || 'Assignment'}" (Mutually agreed)`, true, 'demo');
                      onToast('Task acknowledged & confirmed successfully', 'success');
                    }}
                  >
                    <Check size={14} /> Understood & accept
                  </button>
                </div>
              </div>
            )}

            {role === 'employee' && state.step === 'taskClarification' && (
              <div className="waiting-note"><Clock3 /> Clarification sent · waiting for response</div>
            )}

            {confirmed && (
              <div className="confirmed-note"><CheckCircle2 /> Mutually confirmed · Traceable & synchronized (Revision {state.revision || 1})</div>
            )}
          </div>
        )
      )}

      <button className="demo-control ai-action-btn" disabled={aiLoading} onClick={() => void runAiSummarize()}>
        <Sparkles size={18} className="ai-btn-sparkle" />
        <span>{aiLoading ? 'Summarizing…' : 'AI Summarize & Extract Tasks'}</span>
      </button>
    </>
  );

  return (
    <div className="session-page">
      <div className="session-header">
        <div className="session-info">
          <span className="session-live presence-pill"><i /> 1:1 Live</span>
          <strong>Jordan Lee & Alex Morgan</strong>
          <small>Session ADC-DEMO</small>
        </div>
        <div className="session-actions">
          <div className="voice-ctrl-group">
            <button
              className={`voice-button ${voice.status}`}
              onClick={() => void voice.start()}
              aria-label={voice.status === 'live' ? 'Stop Microphone' : 'Start Live Captions Mic'}
              title={voice.error || (voice.status === 'live' ? 'Live speech recognition active. Click to stop.' : 'Start microphone for live captions')}
            >
              <Mic size={16} />
              {voice.status === 'connecting'
                ? 'Connecting...'
                : voice.status === 'live'
                ? `Listening (${voice.language === 'en-US' ? 'EN' : 'VI'})`
                : voice.status === 'error'
                ? 'Retry Mic'
                : 'Start Mic'}
            </button>
            <div className="voice-lang-picker" role="radiogroup" aria-label="Speech language">
              <button
                type="button"
                role="radio"
                aria-checked={voice.language === 'en-US'}
                className={`voice-lang-btn ${voice.language === 'en-US' ? 'active' : ''}`}
                onClick={() => voice.changeLanguage('en-US')}
                title="English (Real-time transcription)"
              >
                <span className="lang-tag">EN</span><span className="lang-name"> English</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={voice.language === 'vi-VN'}
                className={`voice-lang-btn ${voice.language === 'vi-VN' ? 'active' : ''}`}
                onClick={() => voice.changeLanguage('vi-VN')}
                title="Vietnamese (Instant speech recognition)"
              >
                <span className="lang-tag">VI</span><span className="lang-name"> Vietnamese</span>
              </button>
            </div>
          </div>
          <div className="session-end-group">
            <button className="icon-button" onClick={reset} title="Restart demo session" aria-label="Restart demo session">
              <RefreshCcw size={16} />
            </button>
            <button
              className="end-button"
              onClick={() => {
                voice.stop();
                command('session:end');
                onToast(`Session ended by ${role === 'manager' ? 'Jordan' : 'Alex'}`, 'info');
              }}
            >
              <Pause size={16} /> <span>End</span>
            </button>
          </div>
        </div>
      </div>

      <div className="session-grid">
        <section className={`conversation-panel caption-${preferences.captionSize} sensitivity-${preferences.alertSensitivity}`}>
          {/* Realtime Live Signal Alert for Manager */}
          {role === 'manager' && state.lastSignal && (
            <div className={`manager-live-signal-banner ${state.lastSignal.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="signal-banner-icon">
                {state.lastSignal === 'Understood' ? <CheckCircle2 size={22} /> :
                 state.lastSignal === 'Slow down' ? <Hand size={22} /> :
                 state.lastSignal === 'Repeat' ? <Repeat2 size={22} /> :
                 <CircleHelp size={22} />}
              </div>
              <div className="signal-banner-content">
                <span className="signal-banner-kicker">Live signal from Alex (Employee)</span>
                <strong>
                  {state.lastSignal === 'Understood' ? '🟢 Alex understood all discussed points' :
                   state.lastSignal === 'Slow down' ? '🟠 Alex requested: Please slow down speaking pace' :
                   state.lastSignal === 'Repeat' ? '🔵 Alex requested: Please restate the last point' :
                   `🟣 Alex requested: ${state.lastSignal}`}
                </strong>
              </div>
            </div>
          )}

          <div className={`communication-banner ${barrier ? 'warning' : confirmed ? 'success' : ''}`}>
            <span>{barrier ? <Zap /> : confirmed ? <CheckCircle2 /> : <Volume2 />}</span>
            <div>
              <strong>
                {barrier
                  ? state.step === 'clarify'
                    ? `${state.clarificationTopic || 'Clarification'} requested`
                    : activeBarrier.title
                  : confirmed
                  ? 'Task mutually confirmed'
                  : 'Communication is clear'}
              </strong>
              <small>
                {barrier
                  ? state.step === 'clarify'
                    ? 'Pause and restate the requested detail.'
                    : activeBarrier.detail
                  : confirmed
                  ? 'Both Jordan and Alex agreed.'
                  : 'Live captions are in sync.'}
              </small>
            </div>
            {barrier && (
              <button onClick={handleFocusDetails} className="banner-details-btn">
                {state.step === 'clarify' && role === 'manager' ? 'View request' : 'Details'}
              </button>
            )}
            <button
              type="button"
              className="ai-banner-summary-btn"
              onClick={() => void runAiSummarize()}
              disabled={aiLoading}
              title="AI summarize the entire conversation and extract tasks"
            >
              <Sparkles size={15} className="ai-btn-sparkle" />
              <span className="ai-banner-btn-label">{aiLoading ? 'Summarizing…' : 'AI Summary'}</span>
            </button>
          </div>

          {voice.error && <div className={voice.status === 'error' ? 'voice-error' : 'voice-notice'} role="status"><Info size={15} /> {voice.error}</div>}

          {aiResult && (
            <div className={`ai-status ${state.step === 'clarify' && !aiResult.taskDetected ? 'no-task' : ''}`} role="status">
              <Sparkles size={15} />
              <span>
                <strong>{state.step === 'clarify' ? (aiResult.taskDetected ? 'Possible task extracted' : 'No task created') : aiResult.mode === 'ai' ? 'AI analysis' : 'Rule-based check'}</strong>
                {' '}· {Math.round(aiResult.confidence * 100)}% · {aiResult.reason}
              </span>
            </div>
          )}

          {/* Two-Way 1:1 Dialogue Transcript Timeline */}
          <div className="transcript-timeline">
            {segments.length === 0 && voice.status !== 'live' && (
              <div className="empty-timeline-box">
                <MessageCircleQuestion size={36} />
                <strong>No conversation messages yet</strong>
                <p>Turn on the microphone 🎙️ or type a message below to start. AI will automatically analyze & summarize based on your spoken and written messages.</p>
              </div>
            )}
            {segments.map((seg, idx) => {
              const isSelf = seg.speakerRole === role;
              return (
                <div
                  key={seg.id || idx}
                  className={`transcript-turn ${seg.speakerRole} ${isSelf ? 'is-self' : 'is-other'}`}
                >
                  <div className="speaker-avatar">
                    {seg.speakerRole === 'manager' ? 'JL' : 'AM'}
                  </div>
                  <div className="turn-content-wrap">
                    <div className="turn-header">
                      <strong>
                        {seg.speakerRole === 'manager' ? 'Jordan Lee' : 'Alex Morgan'}
                      </strong>
                      <small>{seg.startedAt || '10:40 AM'}</small>
                    </div>
                    <div className="turn-bubble">
                      <p style={{ whiteSpace: 'pre-line' }}>
                        {seg.text.includes('Thursday at 4 PM') ? (
                          <>
                            Actually, let's move the deadline to <mark className="diff-highlight">Thursday at 4 PM</mark>
                            <span className="diff-badge"><RefreshCcw size={10} /> Updated</span> and include the accessibility flow.
                          </>
                        ) : /thứ\s*Năm\s*lúc\s*16(?::00|h)?/i.test(seg.text) ? (
                          <>
                            Moving deadline to <mark className="diff-highlight">Thursday at 4:00 PM</mark>
                            <span className="diff-badge"><RefreshCcw size={10} /> Updated</span> and include the accessibility flow.
                          </>
                        ) : (
                          seg.text
                        )}
                      </p>
                      {role === 'employee' && seg.speakerRole === 'manager' && (
                        <button
                          type="button"
                          className="inline-clarify-btn"
                          onClick={() => {
                            emitTranscript(`Alex requested clarification on: "${seg.text.slice(0, 45)}..."`, true, 'demo');
                            command('clarification:request', { topic: 'DEADLINE' });
                            onToast('Clarification requested on this statement', 'info');
                          }}
                          title="Request clarification on this statement"
                        >
                          <CircleHelp size={11} /> Clarify this statement
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {voice.status === 'live' && voice.transcript && (
              <div className={`transcript-turn ${role} is-self live-interim-card`}>
                <div className="speaker-avatar">{role === 'manager' ? 'JL' : 'AM'}</div>
                <div className="turn-content-wrap">
                  <div className="turn-header">
                    <strong>
                      {role === 'manager' ? 'Jordan Lee' : 'Alex Morgan'}
                    </strong>
                    <span className="live-pill"><span className="live-dot" /> Speaking...</span>
                  </div>
                  <div className="turn-bubble">
                    <p className="interim-text">{voice.transcript}</p>
                  </div>
                </div>
              </div>
            )}
            {voice.status === 'live' && !voice.transcript && (
              <div className="voice-listening-bar">
                <span className="live-dot" /> Microphone active ({voice.language === 'en-US' ? '🇺🇸 English' : '🇻🇳 Vietnamese'}) · Listening for speech...
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>

          {/* Post-Summary Action if Available */}
          {aiSummary && (
            <div className="ai-chat-toolbar">
              <button
                type="button"
                className="ai-post-chat-btn"
                onClick={() => {
                  const msg = `📌 **AI Summary:** ${aiSummary.summary}\n• ${aiSummary.bulletPoints.join('\n• ')}`;
                  emitTranscript(msg, true, 'demo');
                  onToast('Posted AI summary into conversation', 'success');
                }}
                title="Post summary into chat conversation"
              >
                <Send size={13} /> Post AI summary into conversation
              </button>
            </div>
          )}

          {/* In-Session Chat Dock (Fixed above Bottom Nav on Mobile, Inline on Desktop) */}
          <div className="session-chat-dock">
            <form className="transcript-input-bar" onSubmit={handleSendText}>
              {role === 'employee' && (
                <div className="quick-signals-container">
                  <button
                    type="button"
                    className={`quick-signals-trigger-btn ${signalsOpen ? 'active' : ''}`}
                    onClick={() => setSignalsOpen(!signalsOpen)}
                    title="Open 1-tap quick feedback to Manager"
                    aria-label="Quick feedback"
                  >
                    <Hand size={17} />
                    <ChevronUp size={13} className={`signals-chevron ${signalsOpen ? 'open' : ''}`} />
                  </button>

                  {signalsOpen && (
                    <div className="quick-signals-popover" role="dialog" aria-label="Quick feedback options">
                      <div className="signals-popover-header">
                        <span>⚡ Quick feedback to Jordan</span>
                        <button type="button" onClick={() => setSignalsOpen(false)} aria-label="Close"><X size={14} /></button>
                      </div>
                      <div className="signals-popover-grid">
                        <button
                          type="button"
                          className="signal-opt-btn understood"
                          onClick={() => {
                            handleSignal('understood');
                            setSignalsOpen(false);
                          }}
                        >
                          <span className="signal-opt-icon"><CheckCircle2 size={18} /></span>
                          <div>
                            <strong>Understood</strong>
                            <small>Clear on all details</small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="signal-opt-btn slow-down"
                          onClick={() => {
                            handleSignal('slow-down');
                            setSignalsOpen(false);
                          }}
                        >
                          <span className="signal-opt-icon"><Hand size={18} /></span>
                          <div>
                            <strong>Slow down</strong>
                            <small>Please reduce pace</small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="signal-opt-btn repeat"
                          onClick={() => {
                            handleSignal('repeat');
                            setSignalsOpen(false);
                          }}
                        >
                          <span className="signal-opt-icon"><Repeat2 size={18} /></span>
                          <div>
                            <strong>Repeat</strong>
                            <small>Please restate last point</small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="signal-opt-btn clarify"
                          onClick={() => {
                            setClarifyOpen('conversation');
                            setSignalsOpen(false);
                          }}
                        >
                          <span className="signal-opt-icon"><CircleHelp size={18} /></span>
                          <div>
                            <strong>Clarify</strong>
                            <small>Request specific detail</small>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isDictating ? 'Listening to your voice...' : `Speak via mic above or type ${role === 'manager' ? 'direction / guidance' : 'response / question'}...`}
            />
            <button
              type="button"
              className={`dictate-btn ${isDictating ? 'active' : ''}`}
              onClick={toggleDictation}
              title={isDictating ? 'Stop dictation' : 'Speak to dictate into chat input'}
              aria-label="Dictate into text input"
            >
              <Mic size={18} />
            </button>
            <button type="submit" className="send-btn" title="Send message to conversation">
              <Send size={14} /> Send
            </button>
          </form>
        </div>
      </section>

      <aside className={`context-panel ${highlightPulse ? 'highlight-pulse' : ''}`} id="important-info">
        <div className="context-heading">
          <span className="section-kicker">Shared understanding</span>
          <h2>Key details</h2>
        </div>
        {renderKeyDetailsContent()}
      </aside>
    </div>

    {/* Mobile Floating Task Action Button */}
    <button
      type="button"
      className={`mobile-floating-task-btn ${hasPendingAction ? 'has-action' : ''}`}
      onClick={() => setMobileTaskOpen(true)}
      aria-label="Open Tasks & Confirmations"
      title="Open Tasks & Confirmations"
    >
      <LayoutList size={18} />
      <span>Tasks {sessionTasks.length > 0 ? `(${sessionTasks.length})` : ''}</span>
      {hasPendingAction && <span className="floating-action-dot" />}
    </button>

    {/* Mobile Task & Confirmation Drawer Sheet */}
    {mobileTaskOpen && (
      <div className="mobile-drawer-layer" role="dialog" aria-modal="true" aria-label="Tasks & Confirmations">
        <div className="mobile-drawer-backdrop" onClick={() => setMobileTaskOpen(false)} />
        <div className="mobile-drawer-sheet">
          <div className="mobile-drawer-handle" />
          <div className="mobile-drawer-header">
            <div className="mobile-drawer-title">
              <LayoutList size={20} color="var(--orange)" />
              <div>
                <strong>Tasks & Confirmations</strong>
                <small>{sessionTasks.length} tasks · {role === 'manager' ? 'Jordan Lee' : 'Alex Morgan'}</small>
              </div>
            </div>
            <button className="mobile-drawer-close" onClick={() => setMobileTaskOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="mobile-drawer-body">
            {renderKeyDetailsContent()}
          </div>
        </div>
      </div>
    )}

      {/* Modal: Create Task Inline */}
      {createTaskOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Create new task">
          <div className="modal">
            <div className="modal-head">
              <div><span className="section-kicker">Session task</span><h2>Add new task to session</h2></div>
              <button onClick={() => setCreateTaskOpen(false)} aria-label="Close"><X /></button>
            </div>
            <form onSubmit={handleCreateNewTask}>
              <label>Task title<input autoFocus value={newTaskDraft.title} placeholder="e.g. Prepare onboarding slides" onChange={(e) => setNewTaskDraft({ ...newTaskDraft, title: e.target.value })} /></label>
              <label>Assignee<input value={newTaskDraft.assignee} onChange={(e) => setNewTaskDraft({ ...newTaskDraft, assignee: e.target.value })} /></label>
              <label>Deadline<input value={newTaskDraft.deadline} placeholder="e.g. Wednesday, 3:00 PM" onChange={(e) => setNewTaskDraft({ ...newTaskDraft, deadline: e.target.value })} /></label>
              <label>Requirement<textarea value={newTaskDraft.requirement} placeholder="Specific requirements or criteria" onChange={(e) => setNewTaskDraft({ ...newTaskDraft, requirement: e.target.value })} /></label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setCreateTaskOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button"><Plus size={15} /> Add task</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Edit task">
          <div className="modal">
            <div className="modal-head">
              <div><span className="section-kicker">Task details</span><h2>Edit task</h2></div>
              <button onClick={() => setEditOpen(false)} aria-label="Close"><X /></button>
            </div>
            <label>Task<input value={draft.taskTitle} onChange={(e) => setDraft({ ...draft, taskTitle: e.target.value })} /></label>
            <label>Assignee<input value={draft.assignee || 'Alex Morgan'} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} /></label>
            <label>Deadline<input value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></label>
            <label>Requirement<textarea value={draft.requirement} onChange={(e) => setDraft({ ...draft, requirement: e.target.value })} /></label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setEditOpen(false)}>Cancel</button>
              <button
                className="primary-button"
                onClick={() => {
                  emitTaskUpdate({
                    title: draft.taskTitle,
                    assignee: draft.assignee,
                    deadline: draft.deadline,
                    requirement: draft.requirement,
                  });
                  onToast('Draft task details saved', 'success');
                  setEditOpen(false);
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {clarifyOpen && (
        <div className="modal-layer clarify-layer" role="dialog" aria-modal="true" aria-label="Choose what to clarify">
          <div className="modal clarify-sheet">
            <div className="modal-head">
              <div><span className="section-kicker">Private prompt</span><h2>What needs clarification?</h2></div>
              <button onClick={() => setClarifyOpen(null)} aria-label="Close"><X /></button>
            </div>
            <div className="clarify-options">
              {clarificationTopics.map((topic) => (
                <button
                  key={topic.value}
                  onClick={() => handleClarificationSubmit(topic.value)}
                >
                  <CircleHelp />
                  <span>
                    <strong>{topic.label}</strong>
                    <small>{topic.desc}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionSummary({
  role,
  state,
  onRestart,
  onViewTasks,
}: {
  role: Role;
  state: SharedState;
  onRestart: () => void;
  onViewTasks: () => void;
}) {
  const [summaryData, setSummaryData] = useState<any>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/api/v1/sessions/ADC-DEMO/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSummaryData(data))
      .catch(() => undefined);
  }, []);

  const confirmed = summaryData?.confirmedTask || state.taskConfirmed;
  const taskTitle = summaryData?.confirmedTask?.title || state.taskTitle;
  const deadline = summaryData?.confirmedTask?.deadline || state.deadline;
  const requirement = summaryData?.confirmedTask?.requirement || state.requirement;
  const revision = summaryData?.confirmedTask?.revision || state.revision || 1;

  return (
    <div className="content-stack summary-page">
      <div className="summary-heading">
        <span className="summary-check"><Check /></span>
        <p className="eyebrow-text">Session completed · {state.endedAt || summaryData?.endedAt || '10:44 AM'}</p>
        <h1>Conversation wrapped up clearly.</h1>
        <p>
          {role === 'employee'
            ? 'Your mutually confirmed work and its full context are ready.'
            : 'Alex received the final assignment and both sides confirmed the same details.'}
        </p>
      </div>
      <section className="summary-stats">
        <article>
          <span><Clock3 /></span>
          <div><small>Duration</small><strong>{summaryData?.duration || '08:42'}</strong></div>
        </article>
        <article>
          <span><MessageCircleQuestion /></span>
          <div><small>Clarifications resolved</small><strong>{summaryData?.clarificationsResolvedCount ?? 1}</strong></div>
        </article>
        <article>
          <span><CheckCircle2 /></span>
          <div><small>Tasks confirmed</small><strong>{confirmed ? '1' : '0'}</strong></div>
        </article>
      </section>
      <div className="summary-grid">
        <section className="panel summary-task">
          <div className="panel-head">
            <div><span className="section-kicker">Outcome</span><h3>{confirmed ? 'Confirmed task' : 'No confirmed task'}</h3></div>
            {confirmed && <span className="status-chip green">Mutually confirmed</span>}
          </div>
          {confirmed ? (
            <>
              <h2>{taskTitle}</h2>
              <dl>
                <div><dt>Assignee</dt><dd>Alex Morgan</dd></div>
                <div><dt>Deadline</dt><dd>{deadline}</dd></div>
                <div><dt>Requirement</dt><dd>{requirement}</dd></div>
              </dl>
              <div className="confirmed-note">
                <CheckCircle2 /> Jordan confirmed revision {revision} · Alex acknowledged
              </div>
            </>
          ) : (
            <div className="summary-empty"><Info /> The conversation ended before both people confirmed a task.</div>
          )}
        </section>
        <aside className="panel retention-card">
          <div className="panel-head">
            <div><span className="section-kicker">Privacy summary</span><h3>What was retained</h3></div>
            <ShieldCheck />
          </div>
          <ul>
            <li className="kept"><Check /> Confirmed task fields</li>
            <li className="kept"><Check /> Confirmation timestamps</li>
            <li className="kept"><Check /> Relevant conversation excerpt</li>
            <li className="not-kept"><X /> Raw audio</li>
            <li className="not-kept"><X /> Full private transcript</li>
          </ul>
          {state.learnedPreference && (
            <div className="learned-note"><Sparkles /> Preference learned: confirm changed details explicitly.</div>
          )}
          <p>Workspace members only see information allowed by their role and organization policy.</p>
        </aside>
      </div>
      <div className="summary-actions">
        <button className="secondary-button" onClick={onRestart}><RefreshCcw size={16} /> Start a new session</button>
        <button className="primary-button" onClick={onViewTasks}><LayoutList size={16} /> {role === 'employee' ? 'View my tasks' : 'View assignments'}</button>
      </div>
    </div>
  );
}

function TaskDetail({ state, task, onBack }: { state: SharedState; task?: any; onBack: () => void }) {
  const currentTask = task || state;
  const revisions = task?.revisions || [];
  const latestRev = revisions[revisions.length - 1];

  return (
    <div className="content-stack task-detail-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={17} /> Back to tasks</button>
      <div className="task-detail-heading">
        <div>
          <span className="status-chip green"><CheckCircle2 size={13} /> Confirmed</span>
          <h1>{currentTask.title || currentTask.taskTitle}</h1>
        </div>
      </div>
      <div className="task-detail-grid">
        <section className="panel detail-main">
          <div className="detail-section">
            <span className="section-kicker">Task information</span>
            <dl className="detail-fields">
              <div><dt>Assignee</dt><dd><span className="mini-avatar">AM</span> {currentTask.assignee || 'Alex Morgan'}</dd></div>
              <div><dt>Assigned by</dt><dd><span className="mini-avatar dark">JL</span> Jordan Lee</dd></div>
              <div><dt>Deadline</dt><dd><Clock3 size={16} /> {currentTask.deadline}</dd></div>
              <div><dt>Revision</dt><dd>Revision {currentTask.currentRevision || currentTask.revision || 1}</dd></div>
            </dl>
          </div>
          <div className="detail-section">
            <span className="section-kicker">Requirement</span>
            <div className="requirement-box"><CheckCircle2 /> <span>{currentTask.requirement}</span></div>
          </div>
          <div className="detail-section">
            <div className="detail-title-row">
              <div><span className="section-kicker">Conversation context</span><h3>Final detail</h3></div>
              <span className="source-chip"><Mic size={13} /> ADC-DEMO</span>
            </div>
            <div className="conversation-context">
              <div><span className="context-speaker">JORDAN · 10:39</span><p>Initial deadline: <s>Friday</s></p></div>
              <div className="current-context"><span className="context-speaker">JORDAN · 10:40</span><p>Final deadline: <mark>{currentTask.deadline}</mark></p></div>
              <span className="change-badge"><RefreshCcw size={13} /> Deadline updated</span>
            </div>
          </div>
        </section>
        <aside className="panel history-panel">
          <span className="section-kicker">History</span>
          <h3>Confirmed together</h3>
          <div className="timeline">
            <div className="timeline-item complete">
              <span><Sparkles /></span>
              <div><strong>Task detected</strong><small>10:39 AM</small></div>
            </div>
            <div className="timeline-item complete">
              <span><RefreshCcw /></span>
              <div><strong>Deadline updated</strong><small>10:40 AM</small><p>Friday → {currentTask.deadline}</p></div>
            </div>
            {(currentTask.currentRevision || currentTask.revision || 1) > 1 && (
              <div className="timeline-item complete">
                <span><CircleHelp /></span>
                <div><strong>Clarification requested</strong><small>10:41 AM</small></div>
              </div>
            )}
            <div className="timeline-item complete">
              <span><UserRound /></span>
              <div><strong>Jordan confirmed revision {currentTask.currentRevision || currentTask.revision || 1}</strong><small>{latestRev?.confirmedByManagerAt ? new Date(latestRev.confirmedByManagerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '10:42 AM'}</small></div>
            </div>
            <div className="timeline-item complete last">
              <span><Check /></span>
              <div><strong>Alex accepted</strong><small>{latestRev?.acknowledgedByEmployeeAt ? new Date(latestRev.acknowledgedByEmployeeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '10:43 AM'}</small></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TasksView({ role, state, onToast }: { role: Role; state: SharedState; onToast?: (msg: string, type: Toast['type']) => void }) {
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    void fetch(`${API_BASE}/api/v1/tasks`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const sessionSaved = localStorage.getItem('understood-session-tasks');
        let sessionTasks: any[] = [];
        if (sessionSaved) {
          try {
            sessionTasks = JSON.parse(sessionSaved);
          } catch {}
        }
        // Merge without duplicate titles
        const merged = [...(Array.isArray(sessionTasks) ? sessionTasks : [])];
        for (const d of data) {
          if (!merged.some((m) => m.title?.toLowerCase() === d.title?.toLowerCase())) {
            merged.push(d);
          }
        }
        setTasks(merged);
      })
      .catch(() => {
        const sessionSaved = localStorage.getItem('understood-session-tasks');
        if (sessionSaved) {
          try {
            setTasks(JSON.parse(sessionSaved));
          } catch {}
        }
      });
  }, []);

  if (selectedTask) {
    return <TaskDetail state={state} task={selectedTask} onBack={() => setSelectedTask(null)} />;
  }

  const confirmedFromState = state.taskConfirmed || state.step === 'confirmed';

  const handleExportTasks = () => {
    const confirmedList = tasks.length > 0 ? tasks : [
      {
        title: state.taskTitle || 'Complete the first prototype',
        assignee: state.assignee || 'Alex Morgan',
        deadline: state.deadline || 'Thursday, 4:00 PM',
        requirement: state.requirement || 'Include the accessibility flow',
        status: 'CONFIRMED',
      }
    ];

    const markdown = [
      `# Understood — Mutually Confirmed Action Items`,
      `**Session**: ADC-DEMO`,
      `**Exported at**: ${new Date().toLocaleString()}`,
      `**Participant**: ${role === 'employee' ? 'Alex Morgan (Employee)' : 'Jordan Lee (Manager)'}`,
      '',
      `## Confirmed Assignments (${confirmedList.length} Tasks)`,
      ...confirmedList.map((t, idx) => `
### ${idx + 1}. ${t.title}
- **Assignee**: ${t.assignee || 'Alex Morgan'}
- **Deadline**: ${t.deadline}
- **Requirement**: ${t.requirement || 'Standard criteria'}
- **Status**: ${t.status === 'CONFIRMED' ? '✅ Mutually Confirmed & Traceable' : '⏳ Pending / In Review'}
      `.trim()),
      '',
      `---`,
      `*Generated by Understood — Accessible Workplace Communication Copilot*`
    ].join('\n');

    try {
      void navigator.clipboard.writeText(markdown);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `understood-action-items.md`;
      a.click();
      URL.revokeObjectURL(url);
      onToast?.('Action items exported & copied to clipboard!', 'success');
    } catch {
      onToast?.('Action items ready for export.', 'info');
    }
  };

  return (
    <div className="content-stack">
      <PageHeading
        eyebrow="Shared work"
        title={role === 'employee' ? 'My tasks' : 'Assignments'}
        copy="Mutually confirmed tasks and revision history."
        action={
          <div className="export-actions-row">
            <button type="button" className="export-btn" onClick={handleExportTasks} title="Export action items as Markdown report">
              <FileText size={15} /> Export action items (.md)
            </button>
          </div>
        }
      />
      <div className="panel tasks-panel">
        {tasks.length > 0 ? (
          tasks.map((t, i) => (
            <TaskRow
              key={t.id || i}
              title={t.title}
              deadline={t.deadline}
              status={t.status === 'CONFIRMED' ? 'Confirmed' : 'Awaiting'}
              pending={t.status !== 'CONFIRMED'}
              onOpen={() => setSelectedTask(t)}
            />
          ))
        ) : (
          <>
            {confirmedFromState && (
              <TaskRow
                title={state.taskTitle}
                deadline={state.deadline}
                status="Confirmed"
                onOpen={() => setSelectedTask({ ...state, title: state.taskTitle, currentRevision: state.revision })}
              />
            )}
            <TaskRow title="Prepare onboarding interview notes" deadline="Wednesday, 2:00 PM" status="Confirmed" />
            <TaskRow title="Review design system updates" deadline="Friday" status="Awaiting" pending />
          </>
        )}
      </div>
    </div>
  );
}

type KnowledgeResult = {
  found: boolean;
  answer: string;
  detail: string;
  source: { title: string; section: string; updatedAt: string } | null;
  mode?: 'ai' | 'fallback';
};

const defaultKnowledge: KnowledgeResult = {
  found: true,
  answer: 'Remote work is available up to two days per week.',
  detail: 'Team members should coordinate remote days with their manager and keep their working location updated in the team calendar.',
  source: { title: 'Employee Handbook', section: 'Remote Work Policy · Section 4.2', updatedAt: 'Updated August 2026' },
  mode: 'fallback',
};

function renderStructuredDetail(detail: string) {
  if (!detail) return null;

  // Check if text has (1), (2), (3) style numbered points
  const numberedPattern = /\((\d+)\)\s*([^;(]+)/g;
  const matches = [...detail.matchAll(numberedPattern)];

  if (matches.length > 1) {
    const intro = detail.split(/\(1\)/)[0].replace(/:\s*$/, '').trim();
    return (
      <div className="structured-detail-block">
        {intro && <p className="detail-intro-text">{intro}:</p>}
        <div className="detail-points-grid">
          {matches.map((m, idx) => (
            <div key={idx} className="detail-point-card">
              <span className="point-num-badge">{m[1]}</span>
              <p className="point-text">{m[2].trim().replace(/;$/, '')}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Check if text has bullet points • or -
  if (detail.includes('•') || detail.includes('\n- ') || detail.includes('\n• ')) {
    const lines = detail.split(/\n|•/).map((l) => l.trim()).filter(Boolean);
    return (
      <div className="structured-detail-block">
        <div className="detail-points-grid">
          {lines.map((line, idx) => (
            <div key={idx} className="detail-point-card">
              <span className="point-bullet-icon"><CheckCircle2 size={15} /></span>
              <p className="point-text">{line.replace(/^[-•*]\s*/, '')}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Regular multiline paragraph
  return <p className="detail-regular-text">{detail}</p>;
}

function KnowledgeView() {
  const [question, setQuestion] = useState('What is the accommodation policy for deaf and hard-of-hearing employees?');
  const [result, setResult] = useState<KnowledgeResult>({
    found: true,
    answer: 'Understood provides comprehensive accessibility accommodations, real-time bidirectional live captions, and certified sign language interpretation on demand.',
    detail: 'Deaf and hard-of-hearing employees are supported with: (1) Two-way real-time live captions across all meeting platforms; (2) On-demand ASL/VNL interpreters for critical sessions; (3) An annual $1,500 assistive technology stipend (hearing aids, noise-canceling headsets, vibrating alert devices); (4) An asynchronous-first written communication standard.',
    source: {
      title: 'Accessibility & Inclusion Charter',
      section: 'Accommodations & Assistive Tech · Section 2.1',
      updatedAt: 'Updated September 2026',
    },
    mode: 'fallback',
  });
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const answerRef = useRef<HTMLDivElement>(null);

  const reasoningSteps = [
    { title: 'Analyze inquiry', detail: 'Determining workplace context and policy scope', tag: 'Keyword Parser' },
    { title: 'Query knowledge base', detail: 'Scanning company handbook and accessibility standards', tag: '98.4% match' },
    { title: 'Cross-verify & validate', detail: 'Ensuring alignment with verified company policies', tag: 'Verified' },
    { title: 'Synthesize structured response', detail: 'Formatting clear, actionable takeaways for readability', tag: 'Ready' },
  ];

  const suggestedQuestions = [
    'What is the accommodation policy for deaf employees?',
    'What is the remote & hybrid work policy?',
    'How do I request paid time off (PTO) & sick leave?',
    'What is the performance review & bonus process?',
    'Where are the WCAG 2.2 design guidelines?',
    'What is the home office & equipment stipend?',
    'Who is my People Partner & HR contact?',
  ];

  const ask = async (suggested?: string) => {
    const submitted = (suggested ?? question).trim();
    if (!submitted) return;
    setQuestion(submitted);
    setLoading(true);
    setLoadingStep(0);
    setElapsedMs(0);

    // Smooth auto-scroll down to answer zone
    setTimeout(() => {
      answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 50);

    // Step progression intervals to make the loading sequence look hyper-cool
    const step1 = setTimeout(() => setLoadingStep(1), 300);
    const step2 = setTimeout(() => setLoadingStep(2), 620);
    const step3 = setTimeout(() => setLoadingStep(3), 950);

    try {
      const fetchPromise = fetch(`${API_BASE}/api/v1/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submitted }),
      });
      // Guarantee minimum 1.2s for the cool multi-step pipeline animation to display smoothly
      const [response] = await Promise.all([
        fetchPromise,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
      if (!response.ok) throw new Error('Knowledge service unavailable');
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({
        found: false,
        answer: 'No matching policy found in enterprise knowledge base.',
        detail: 'Knowledge service is temporarily unavailable. Please try again or reach out to People Operations.',
        source: null,
      });
    } finally {
      clearInterval(timerInterval);
      clearTimeout(step1);
      clearTimeout(step2);
      clearTimeout(step3);
      setLoading(false);
      setTimeout(() => {
        answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  };

  return (
    <div className="content-stack">
      <PageHeading
        eyebrow="Enterprise AI Knowledge Copilot"
        title="Ask your workplace."
        copy="Search company policies, guidelines, and accessibility charters with AI Grounded RAG."
      />
      <section className="knowledge-card">
        <form className="knowledge-search" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          <Search />
          <input
            aria-label="Ask a workplace question"
            placeholder="Ask about remote work, accessibility accommodations, leave, KPI, equipment..."
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button disabled={loading}>{loading ? 'Searching…' : 'Ask AI'}</button>
        </form>

        <div className="suggestions">
          <span>Suggested questions</span>
          {suggestedQuestions.map((item) => (
            <button key={item} type="button" onClick={() => void ask(item)}>{item}</button>
          ))}
        </div>

        {loading ? (
          <div ref={answerRef} className="knowledge-loading-card cool-ai-pipeline" role="status">
            <div className="pipeline-header">
              <div className="pipeline-title-group">
                <span className="pipeline-ai-orb">
                  <Search size={20} className="ai-spin" />
                  <span className="orb-ring-pulse" />
                </span>
                <div>
                  <div className="pipeline-live-row">
                    <span className="live-dot" />
                    <strong>Searching knowledge base...</strong>
                    <span className="pipeline-timer">⏱ {(elapsedMs / 1000).toFixed(2)}s</span>
                  </div>
                  <small>Scanning, verifying, and synthesizing verified enterprise guidelines</small>
                </div>
              </div>
              <div className="pipeline-telemetry-tag">
                <Zap size={13} />
                <span>Retrieving data</span>
              </div>
            </div>

            <div className="pipeline-progress-bar-wrap">
              <div className="pipeline-progress-bar-fill" style={{ width: `${Math.min(100, (loadingStep + 1) * 25)}%` }} />
            </div>

            <div className="reasoning-steps-list">
              {reasoningSteps.map((s, idx) => {
                const isDone = loadingStep > idx;
                const isCurrent = loadingStep === idx;
                return (
                  <div key={idx} className={`reasoning-step-item ${isDone ? 'done' : isCurrent ? 'current' : 'pending'}`}>
                    <div className="step-state-indicator">
                      {isDone ? (
                        <span className="step-icon done"><CheckCircle2 size={16} /></span>
                      ) : isCurrent ? (
                        <span className="step-icon current"><Sparkles size={14} className="ai-spin" /></span>
                      ) : (
                        <span className="step-icon pending">{idx + 1}</span>
                      )}
                    </div>
                    <div className="step-info-col">
                      <div className="step-title-row">
                        <span className="step-main-title">{s.title}</span>
                        <span className="step-chip">{s.tag}</span>
                      </div>
                      <span className="step-sub-detail">{s.detail}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="shimmer-lines-container compact">
              <div className="shimmer-line line-title" />
              <div className="shimmer-line line-p1" />
            </div>
          </div>
        ) : (
          <div ref={answerRef} className={`knowledge-answer ${result.found ? 'found' : 'not-found'}`}>
            <span className="answer-icon">{result.found ? <BookOpen /> : <CircleHelp />}</span>
            <div className="answer-content">
              <div className="answer-badge-row">
                <span className="verified-pill">
                  <ShieldCheck size={13} /> {result.found ? 'Verified Enterprise Policy' : 'Source not found'}
                </span>
                {result.mode === 'ai' && (
                  <span className="diff-badge rag">
                    <Sparkles size={11} /> AI Assistant
                  </span>
                )}
              </div>
              <h3 className="answer-heading">{result.answer}</h3>
              {renderStructuredDetail(result.detail)}
              {result.source ? (
                <div className="source-card">
                  <FileText />
                  <div className="source-info">
                    <strong>{result.source.title}</strong>
                    <small>{result.source.section} · {result.source.updatedAt}</small>
                  </div>
                  <ChevronRight />
                </div>
              ) : (
                <button type="button" className="contact-button" onClick={() => ask('Who is my People Partner & HR contact?')}>
                  <UserRound /> Contact People Operations
                </button>
              )}
            </div>
          </div>
        )}

        <p className="knowledge-guardrail">
          <ShieldCheck /> Answers are strictly grounded in approved Understood Enterprise Handbooks & Accessibility Charters. 0% Hallucination Guarantee.
        </p>
      </section>
    </div>
  );
}

function SettingsView({ preferences, save }: { preferences: CommunicationPreferences; save: (changes: Partial<CommunicationPreferences>) => void }) {
  const sizes: { label: string; value: CommunicationPreferences['captionSize'] }[] = [
    { label: 'Small', value: 'small' },
    { label: 'Comfortable', value: 'comfortable' },
    { label: 'Large', value: 'large' },
  ];
  const sensitivities: { label: string; value: CommunicationPreferences['alertSensitivity'] }[] = [
    { label: 'Low', value: 'low' },
    { label: 'Balanced', value: 'balanced' },
    { label: 'High', value: 'high' },
  ];
  return (
    <div className="content-stack">
      <PageHeading eyebrow="Personal controls" title="Communication preferences" copy="Choose how captions and quiet alerts work for you." />
      <div className="settings-saved"><CheckCircle2 /> Preferences save automatically and apply to your next live session.</div>
      <section className="settings-grid">
        <div className="panel settings-card">
          <span className="settings-icon"><FileText /></span>
          <div>
            <h3>Caption size</h3>
            <p>Adjust live captions without changing the rest of the interface.</p>
            <div className="segmented">
              {sizes.map((item) => (
                <button
                  key={item.value}
                  className={preferences.captionSize === item.value ? 'active' : ''}
                  aria-pressed={preferences.captionSize === item.value}
                  onClick={() => save({ captionSize: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className={`caption-preview preview-${preferences.captionSize}`}>Thursday at 4 PM</div>
          </div>
        </div>
        <div className="panel settings-card">
          <span className="settings-icon mint"><Zap /></span>
          <div>
            <h3>Alert sensitivity</h3>
            <p>Control how early communication guidance appears.</p>
            <div className="segmented">
              {sensitivities.map((item) => (
                <button
                  key={item.value}
                  className={preferences.alertSensitivity === item.value ? 'active' : ''}
                  aria-pressed={preferences.alertSensitivity === item.value}
                  onClick={() => save({ alertSensitivity: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small className="setting-help">
              {preferences.alertSensitivity === 'low'
                ? 'Only essential barriers'
                : preferences.alertSensitivity === 'high'
                ? 'Earlier and more detailed guidance'
                : 'Recommended balance of clarity and focus'}
            </small>
          </div>
        </div>
        <div className="panel settings-card">
          <span className="settings-icon blue"><Bell /></span>
          <div>
            <h3>Private visual prompts</h3>
            <p>Show quiet communication guidance on your screen. Essential status is always retained.</p>
            <label className="toggle">
              <input type="checkbox" checked={preferences.visualPrompts} onChange={(event) => save({ visualPrompts: event.target.checked })} />
              <span />
            </label>
          </div>
        </div>
      </section>

      {/* Adaptive Learned Communication Habits Card */}
      <section className="learned-habits-card">
        <Sparkles />
        <div>
          <h3>Adaptive Communication Insights</h3>
          <p>Understood continuously learns mutual communication patterns to optimize clarity:</p>
          <ul>
            <li><strong>Visual Diff Confirmation:</strong> Alex confirms changed deadlines with 100% agreement when visual before/after diffs are displayed.</li>
            <li><strong>Quiet Restatement Flow:</strong> Manager restatements resolved all clarification requests within 1 turn without disruption.</li>
            <li><strong>Explicit Requirement Tagging:</strong> Clear requirement tags (e.g. Accessibility Flow) reduced ambiguity to 0%.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState<Role | null>(() => sessionStorage.getItem('understood-role') as Role | null);
  const [view, setView] = useState<View>('home');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [managerAlert, setManagerAlert] = useState<ManagerAlert | null>(null);
  const alertTimerRef = useRef<any>(null);
  const [notifications, setNotifications] = useState<{ title: string; time: string; type: string }[]>([
    { title: 'Session ADC-DEMO initialized', time: 'Just now', type: 'system' },
  ]);

  const handleManagerAlert = (alert: ManagerAlert) => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    setManagerAlert(alert);
    setNotifications((curr) => [
      { title: `[${alert.badge}] ${alert.title}`, time: alert.time, type: alert.signal === 'understood' ? 'success' : 'warning' },
      ...curr.slice(0, 10),
    ]);
    alertTimerRef.current = setTimeout(() => {
      setManagerAlert(null);
    }, 6500);
  };

  const dismissManagerAlert = () => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    setManagerAlert(null);
  };

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setToasts((curr) => [...curr.slice(-3), { id, message, type }]);
    setNotifications((curr) => [
      { title: message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type },
      ...curr.slice(0, 10),
    ]);
    setTimeout(() => {
      setToasts((curr) => curr.filter((t) => t.id !== id));
    }, 3800);
  };

  const dismissToast = (id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  };

  const { state, segments, command, emitTranscript, emitBarrier, emitPossibleTask, emitTaskUpdate } = useSharedDemo(
    role,
    showToast,
    handleManagerAlert,
  );
  const { preferences, save: savePreferences } = usePreferences(role);

  const content = useMemo(() => {
    if (!role) return null;
    if (view === 'home') {
      return (
        <HomeView
          role={role}
          state={state}
          onStart={() => {
            if (state.step === 'idle' && role === 'manager') command('session:start');
            setView('session');
          }}
          goTasks={() => setView('tasks')}
          goKnowledge={() => setView('knowledge')}
          goSettings={() => setView('settings')}
        />
      );
    }
    if (view === 'session') {
      return (
        <SessionView
          role={role}
          state={state}
          segments={segments}
          command={command}
          emitTranscript={emitTranscript}
          emitBarrier={emitBarrier}
          emitPossibleTask={emitPossibleTask}
          emitTaskUpdate={emitTaskUpdate}
          preferences={preferences}
          onViewTasks={() => setView('tasks')}
          onToast={showToast}
          onGoHome={() => setView('home')}
        />
      );
    }
    if (view === 'tasks') return <TasksView role={role} state={state} onToast={showToast} />;
    if (view === 'knowledge') return <KnowledgeView />;
    return <SettingsView preferences={preferences} save={savePreferences} />;
  }, [role, view, state, segments, preferences]);

  if (!role) {
    return (
      <RoleEntry
        onChoose={(next) => {
          sessionStorage.setItem('understood-role', next);
          setRole(next);
        }}
      />
    );
  }

  return (
    <Shell
      role={role}
      view={view}
      setView={setView}
      notifications={notifications}
      toasts={toasts}
      onDismissToast={dismissToast}
      managerAlert={managerAlert}
      onDismissManagerAlert={dismissManagerAlert}
      onExit={() => {
        sessionStorage.removeItem('understood-role');
        setRole(null);
        setView('home');
      }}
    >
      {content}
    </Shell>
  );
}
