import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Session as GeminiLiveSession } from '@google/genai';
import {
  Accessibility, ArrowLeft, Bell, BookOpen, Check, CheckCircle2, ChevronRight,
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

function playAudioChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

function useSharedDemo(role: Role | null, onToast?: (msg: string, type: Toast['type']) => void) {
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
        playAudioChime();
        onToast?.(`Alex requested clarification on: ${req.topic}`, 'warning');
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
  }, [role, onToast]);

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
      <span className="brand-mark"><Volume2 size={compact ? 18 : 22} strokeWidth={2.6} /></span>
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

function Shell({
  role,
  view,
  setView,
  onExit,
  children,
  notifications,
  toasts,
  onDismissToast,
}: {
  role: Role;
  view: View;
  setView: (view: View) => void;
  onExit: () => void;
  children: React.ReactNode;
  notifications: { title: string; time: string; type: string }[];
  toasts: Toast[];
  onDismissToast: (id: string) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const name = role === 'employee' ? 'Alex Morgan' : 'Jordan Lee';

  return (
    <div className="app-shell">
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
            <span>Demo Workspace</span>
            <small>{role === 'employee' ? 'Employee view (Alex)' : 'Manager view (Jordan)'}</small>
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
      setError('Trình duyệt chưa hỗ trợ Web Speech API. Vui lòng sử dụng Chrome, Edge hoặc Safari.');
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
      recognition.lang = langRef.current || 'vi-VN';

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
          setError('Quyền truy cập Microphone bị từ chối. Vui lòng cho phép quyền Micro trong trình duyệt.');
          setStatus('error');
        } else if (event.error === 'network') {
          setError('Lỗi kết nối mạng nhận diện giọng nói.');
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
      setError(err?.message || 'Không thể mở Microphone');
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
    onToast(`Đã chuyển tiêu điểm sang: "${task.title}"`, 'info');
  };

  const handleBatchConfirmAll = () => {
    const confirmedTasks = sessionTasks.map((t) => ({ ...t, status: 'CONFIRMED' as const }));
    updateAndBroadcastTasks(confirmedTasks);
    command('task:manager-confirm');
    command('task:employee-acknowledge');
    emitTranscript(`Jordan confirmed & Alex acknowledged all ${sessionTasks.length} session tasks (Mutually confirmed).`, true, 'demo');
    onToast(`Đã đồng thuận & xác nhận tất cả ${sessionTasks.length} nhiệm vụ!`, 'success');
  };

  const handleQuickConfirmSingleTask = (taskId: string) => {
    const next = sessionTasks.map((t) => (t.id === taskId ? { ...t, status: 'CONFIRMED' as const } : t));
    updateAndBroadcastTasks(next);
    const item = sessionTasks.find((t) => t.id === taskId);
    emitTranscript(`Mutually confirmed task: "${item?.title || 'Assignment'}" · Due ${item?.deadline}`, true, 'demo');
    onToast(`Đã xác nhận nhiệm vụ: "${item?.title}"`, 'success');
  };

  const handleRemoveTask = (taskId: string) => {
    if (sessionTasks.length <= 1) {
      onToast('Cần duy trì ít nhất 1 nhiệm vụ trong phiên', 'warning');
      return;
    }
    const next = sessionTasks.filter((t) => t.id !== taskId);
    updateAndBroadcastTasks(next);
    onToast('Đã loại trừ nhiệm vụ khỏi danh sách', 'info');
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
    onToast(`Đã tổng hợp ${newItems.length} nhiệm vụ vào danh sách cuộc họp!`, 'success');
  };

  const handleCreateNewTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskDraft.title.trim()) {
      onToast('Vui lòng nhập tên nhiệm vụ', 'warning');
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
    onToast(`Đã thêm nhiệm vụ mới: "${item.title}"`, 'success');
  };

  // Auto-scroll on new message
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  // Two-way instant microphone capture with VI / EN language support
  const voice = useRealtimeVoice((text, src) => {
    emitTranscript(text, true, src);

    // Auto-check for changed deadline when Manager speaks in live mode
    if (role === 'manager' && state.step === 'live') {
      const lower = text.toLowerCase();
      if (/actually|move|thursday|change|dời|đổi|thay đổi/.test(lower)) {
        emitBarrier('LOW_CONFIDENCE', 'A deadline or requirement has been updated.', 'Pause and acknowledge the changed detail clearly.');
      }
    }
  }, 'vi-VN');

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
      onToast('Trình duyệt chưa hỗ trợ nhận diện giọng nói. Hãy dùng Chrome hoặc Edge.', 'warning');
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
      onToast(`Đang nghe (${voice.language === 'vi-VN' ? 'Tiếng Việt' : 'English'})... Hãy nói nội dung`, 'info');
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
    onToast('Đã làm mới phiên trò chuyện', 'info');
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

  const handleSendQuickPrompt = (text: string) => {
    emitTranscript(text, true, 'demo');
    if (role === 'manager' && state.step === 'live') {
      const lower = text.toLowerCase();
      if (/actually|move|thursday|change|dời|đổi|thay đổi/.test(lower)) {
        emitBarrier('LOW_CONFIDENCE', 'A deadline or requirement has been updated.', 'Pause and acknowledge the changed detail clearly.');
      }
    }
    onToast(`${role === 'manager' ? 'Jordan' : 'Alex'} sent a message`, 'info');
  };

  const handleSignal = (sig: 'understood' | 'slow-down' | 'repeat') => {
    if (sig === 'understood') {
      command('communication:understood');
      onToast('Signal sent: "Understood" (Jordan notified)', 'success');
    } else if (sig === 'slow-down') {
      command('communication:slow-down');
      onToast('Signal sent: "Slow down" (Jordan notified)', 'warning');
    } else if (sig === 'repeat') {
      command('communication:repeat');
      onToast('Signal sent: "Repeat" (Jordan notified)', 'warning');
    }
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

    if (clarifyOpen === 'task') {
      command('task:employee-clarify', { topic });
      onToast(`Task clarification requested on "${topic}" (Jordan notified)`, 'info');
    } else {
      command('clarification:request', { topic });
      onToast(`Clarification requested on "${topic}" (Jordan notified)`, 'info');
    }
    setClarifyOpen(null);
  };

  const handleFocusDetails = () => {
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
      onToast('Chưa có tin nhắn nào trong hội thoại để AI phân tích. Hãy nói hoặc gửi tin nhắn trước.', 'warning');
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
          reason: 'AI trích xuất thành công nhiệm vụ từ cuộc trò chuyện.',
          taskDetected: true,
        });
        emitPossibleTask({
          title: data.task.title,
          assignee: data.task.assignee,
          deadline: data.task.deadline,
          requirement: data.task.requirement,
        });
        onToast('AI đã tóm tắt & trích xuất thành công nhiệm vụ!', 'success');
      } else {
        setAiResult({
          mode: data.mode,
          confidence: 0.9,
          reason: 'Đã hoàn tất tóm tắt cuộc trò chuyện.',
          taskDetected: false,
        });
        onToast('AI đã hoàn tất tóm tắt cuộc trò chuyện.', 'info');
      }
    } catch {
      onToast('Dịch vụ AI tóm tắt tạm thời bận, vui lòng thử lại.', 'warning');
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
        <button className="back-link"><ArrowLeft size={17} /> Overview</button>
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

  return (
    <div className="session-page">
      <div className="session-header">
        <div>
          <span className="presence-pill"><i /> 1:1 Live Connected</span>
          <strong>Jordan Lee & Alex Morgan</strong>
          <small>Session ADC-DEMO</small>
        </div>
        <div className="session-actions">
          <div className="voice-ctrl-group">
            <button
              className={`voice-button ${voice.status}`}
              onClick={() => void voice.start()}
              aria-label={voice.status === 'live' ? 'Dừng Micro' : 'Bật Micro Live Captions'}
              title={voice.error || (voice.status === 'live' ? 'Đang nhận diện giọng nói tức thì. Bấm để dừng.' : 'Bật Micro nhận diện giọng nói trực tiếp')}
            >
              <Mic size={16} />
              {voice.status === 'connecting'
                ? 'Đang kết nối...'
                : voice.status === 'live'
                ? `Đang nghe (${voice.language === 'vi-VN' ? 'VI' : 'EN'})`
                : voice.status === 'error'
                ? 'Thử lại Mic'
                : 'Bật Mic Live'}
            </button>
            <div className="voice-lang-picker" role="radiogroup" aria-label="Ngôn ngữ giọng nói">
              <button
                type="button"
                role="radio"
                aria-checked={voice.language === 'vi-VN'}
                className={`voice-lang-btn ${voice.language === 'vi-VN' ? 'active' : ''}`}
                onClick={() => voice.changeLanguage('vi-VN')}
                title="Tiếng Việt (Nhận diện tức thì)"
              >
                <span className="lang-tag">VI</span> Tiếng Việt
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={voice.language === 'en-US'}
                className={`voice-lang-btn ${voice.language === 'en-US' ? 'active' : ''}`}
                onClick={() => voice.changeLanguage('en-US')}
                title="English (Real-time transcription)"
              >
                <span className="lang-tag">EN</span> English
              </button>
            </div>
          </div>
          <button className="icon-button" onClick={reset} title="Khởi động lại phiên demo" aria-label="Restart demo session">
            <RefreshCcw size={16} />
          </button>
          <button
            className="end-button"
            onClick={() => {
              voice.stop();
              command('session:end');
              onToast(`Phiên họp đã kết thúc bởi ${role === 'manager' ? 'Jordan' : 'Alex'}`, 'info');
            }}
          >
            <Pause size={16} /> Kết thúc
          </button>
        </div>
      </div>

      <div className="session-grid">
        <section className={`conversation-panel caption-${preferences.captionSize} sensitivity-${preferences.alertSensitivity}`}>
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
              <button onClick={handleFocusDetails}>
                {state.step === 'clarify' && role === 'manager' ? 'View request' : 'Details'}
              </button>
            )}
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
                <strong>Chưa có nội dung trao đổi</strong>
                <p>Bật micro 🎙️ hoặc gõ tin nhắn bên dưới để bắt đầu. AI sẽ tự động phân tích & tóm tắt dựa trên toàn bộ câu thoại bạn trực tiếp trao đổi trong phiên.</p>
              </div>
            )}
            {segments.map((seg, idx) => (
              <div key={seg.id || idx} className={`transcript-turn ${seg.speakerRole} ${seg.speakerRole === role ? 'is-self' : 'is-other'}`}>
                <div className="speaker-avatar">
                  {seg.speakerRole === 'manager' ? 'JL' : 'AM'}
                </div>
                <div>
                  <div className="turn-header">
                    <strong>
                      {seg.speakerRole === 'manager' ? 'JORDAN LEE (Manager)' : 'ALEX MORGAN (Employee)'}
                      {seg.speakerRole === role && <span className="self-badge">You</span>}
                    </strong>
                    <small>{seg.startedAt || '10:40 AM'} · {seg.source === 'gemini' ? 'Gemini Live' : seg.source === 'browser' ? 'Browser' : seg.source === 'demo' ? 'Live Turn' : 'Mic'}</small>
                  </div>
                  <p style={{ whiteSpace: 'pre-line' }}>
                    {seg.text.includes('Thursday at 4 PM') ? (
                      <>
                        Actually, let's move the deadline to <mark className="diff-highlight">Thursday at 4 PM</mark>
                        <span className="diff-badge"><RefreshCcw size={10} /> Updated</span> and include the accessibility flow.
                      </>
                    ) : /thứ\s*Năm\s*lúc\s*16(?::00|h)?/i.test(seg.text) ? (
                      <>
                        Dời deadline sang <mark className="diff-highlight">thứ Năm lúc 16:00</mark>
                        <span className="diff-badge"><RefreshCcw size={10} /> Đã đổi hạn</span> kèm luồng trợ năng nhé.
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
            ))}

            {voice.status === 'live' && voice.transcript && (
              <div className={`transcript-turn ${role} is-self live-interim-card`}>
                <div className="speaker-avatar">{role === 'manager' ? 'JL' : 'AM'}</div>
                <div>
                  <div className="turn-header">
                    <strong>{role === 'manager' ? 'JORDAN LEE' : 'ALEX MORGAN'} <span className="self-badge">You</span> (Đang nói...)</strong>
                    <span className="live-pill"><span className="live-dot" /> Nhận diện tức thì ({voice.language === 'vi-VN' ? 'Tiếng Việt' : 'English'})</span>
                  </div>
                  <p className="interim-text">{voice.transcript}</p>
                </div>
              </div>
            )}
            {voice.status === 'live' && !voice.transcript && (
              <div className="voice-listening-bar">
                <span className="live-dot" /> Micro đang mở ({voice.language === 'vi-VN' ? '🇻🇳 Tiếng Việt' : '🇺🇸 English'}) · Đang lắng nghe giọng nói...
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>

          {/* AI Chat Utility Toolbar */}
          <div className="ai-chat-toolbar">
            <button
              type="button"
              className="ai-summary-pill-btn"
              onClick={() => void runAiSummarize()}
              disabled={aiLoading}
              title="AI tóm tắt toàn bộ cuộc trao đổi và trích xuất nhiệm vụ"
            >
              <Sparkles size={14} /> {aiLoading ? 'AI đang tóm tắt & trích xuất...' : '✨ AI Tóm tắt & Trích Task (AI Summary)'}
            </button>
            {aiSummary && (
              <button
                type="button"
                className="ai-post-chat-btn"
                onClick={() => {
                  const msg = `📌 **AI Summary:** ${aiSummary.summary}\n• ${aiSummary.bulletPoints.join('\n• ')}`;
                  emitTranscript(msg, true, 'demo');
                  onToast('Đã gửi tóm tắt AI vào đoạn chat', 'success');
                }}
                title="Gửi nội dung tóm tắt vào dòng hội thoại"
              >
                <Send size={12} /> Gửi tóm tắt vào chat
              </button>
            )}
          </div>

          {/* In-Session Text & Speech Input Bar */}
          <form className="transcript-input-bar" onSubmit={handleSendText}>
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isDictating ? 'Đang lắng nghe giọng nói của bạn...' : `Nói qua mic phía trên hoặc gõ ${role === 'manager' ? 'chỉ đạo công việc / trao đổi' : 'phản hồi / câu hỏi'}...`}
            />
            <button
              type="button"
              className={`dictate-btn ${isDictating ? 'active' : ''}`}
              onClick={toggleDictation}
              title={isDictating ? 'Dừng đọc' : 'Nói để tự điền văn bản vào ô chat'}
              aria-label="Dictate into text input"
            >
              <Mic size={18} />
            </button>
            <button type="submit" className="send-btn" title="Gửi nội dung vào hội thoại">
              <Send size={14} /> Gửi
            </button>
          </form>

          {/* Demo Quick Chat Prompt Chips */}
          <div className="quick-chat-chips">
            <span className="chips-label">Quick send:</span>
            {role === 'manager' ? (
              <>
                <button type="button" onClick={() => handleSendQuickPrompt("Actually, let's move the deadline to Thursday at 4 PM and include the accessibility flow.")}>
                  "Move deadline to Thu 4 PM"
                </button>
                <button type="button" onClick={() => handleSendQuickPrompt("Alex, please deliver the high-fidelity design prototype by Wednesday 3 PM.")}>
                  "Assign prototype task"
                </button>
                <button type="button" onClick={() => handleSendQuickPrompt("Dời deadline sang thứ Năm lúc 16:00 kèm luồng trợ năng nhé.")}>
                  (VI) "Dời hạn sang Thứ 5 16h"
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => handleSendQuickPrompt("Could we clarify the final deadline?")}>
                  "Clarify deadline?"
                </button>
                <button type="button" onClick={() => handleSendQuickPrompt("Understood, I will deliver the prototype by Thursday 4 PM.")}>
                  "Understood & accept"
                </button>
                <button type="button" onClick={() => handleSendQuickPrompt("Cho mình xin xác nhận lại thời hạn chót chính xác là khi nào?")}>
                  (VI) "Làm rõ deadline"
                </button>
              </>
            )}
          </div>

          {/* Quick Communication Actions for Employee */}
          {role === 'employee' ? (
            <div className="quick-actions" aria-label="Communication actions" style={{ marginTop: 12 }}>
              <button aria-label="Understood" onClick={() => handleSignal('understood')} title="Send Understood signal to Manager">
                <CheckCircle2 /><span>Understood</span>
              </button>
              <button aria-label="Slow down" onClick={() => handleSignal('slow-down')} title="Ask Manager to slow down">
                <Hand /><span>Slow down</span>
              </button>
              <button aria-label="Repeat" onClick={() => handleSignal('repeat')} title="Ask Manager to repeat detail">
                <Repeat2 /><span>Repeat</span>
              </button>
              <button aria-label="Ask for clarification" className="accent" onClick={() => setClarifyOpen('conversation')} title="Choose what to clarify">
                <CircleHelp /><span>Clarify</span>
              </button>
            </div>
          ) : preferences.visualPrompts ? (
            <div className="manager-guidance" style={{ marginTop: 12 }}>
              <Sparkles />
              <span>
                <strong>Quiet guidance</strong>
                <small>
                  {state.step === 'clarify'
                    ? `Restate the ${state.clarificationTopic?.toLowerCase() || 'requested detail'} clearly for Alex.`
                    : barrier
                    ? activeBarrier.detail
                    : 'Communication is clear. Both Jordan and Alex are connected.'}
                </small>
              </span>
            </div>
          ) : (
            <div className="manager-guidance muted" style={{ marginTop: 12 }}>
              <Bell />
              <span><strong>Private prompts are off</strong><small>Essential session status remains available above.</small></span>
            </div>
          )}
        </section>

        <aside className={`context-panel ${highlightPulse ? 'highlight-pulse' : ''}`} id="important-info">
          <div className="context-heading">
            <span className="section-kicker">Shared understanding</span>
            <h2>Key details</h2>
          </div>

          {/* Task View Mode Switcher */}
          <div className="task-mode-switcher">
            <button
              type="button"
              className={`task-mode-btn ${taskViewMode === 'focus' ? 'active' : ''}`}
              onClick={() => setTaskViewMode('focus')}
              title="Xem chi tiết 1 task chính"
            >
              <Sparkles size={13} />
              <span>Task chính (Focus)</span>
            </button>
            <button
              type="button"
              className={`task-mode-btn ${taskViewMode === 'list' ? 'active' : ''}`}
              onClick={() => setTaskViewMode('list')}
              title="Xem toàn bộ danh sách task cuộc họp"
            >
              <LayoutList size={13} />
              <span>Danh sách Task</span>
              <span className="task-badge-count">{sessionTasks.length}</span>
            </button>
          </div>

          {/* Live AI Conversation Summary Box */}
          {aiSummary && (
            <div className="ai-summary-box">
              <div className="ai-summary-box-header">
                <Sparkles size={16} />
                <span>AI Tóm tắt cuộc trao đổi</span>
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
                      {aiSummary.tasks.length > 1 ? `AI trích xuất ${aiSummary.tasks.length} nhiệm vụ:` : 'AI trích xuất 1 nhiệm vụ:'}
                    </small>
                    <button
                      type="button"
                      className="mini-action-btn primary"
                      style={{ fontSize: 9, padding: '3px 8px' }}
                      onClick={() => handleApplyAiTasksToSession(aiSummary.tasks)}
                      title="Đồng bộ tất cả nhiệm vụ này vào danh sách phiên họp"
                    >
                      <Check size={11} /> Áp dụng vào danh sách
                    </button>
                  </div>
                  {aiSummary.tasks.map((tItem: ExtractedTaskItem, idx: number) => (
                    <div
                      key={idx}
                      className="ai-task-item-card clickable"
                      onClick={() => {
                        emitPossibleTask(tItem);
                        setTaskViewMode('focus');
                        onToast(`Đã chọn nhiệm vụ: "${tItem.title}"`, 'info');
                      }}
                      title="Bấm để chọn làm tiêu điểm và xác nhận nhiệm vụ này"
                    >
                      <div className="ai-task-item-top">
                        <strong>{idx + 1}. {tItem.title}</strong>
                        <span className="mini-chip">{tItem.deadline}</span>
                      </div>
                      <small>Phụ trách: {tItem.assignee} · {tItem.requirement}</small>
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
                          title="Xem chi tiết & xác nhận từng bước"
                        >
                          <Sparkles size={11} /> Xem chi tiết
                        </button>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {!isConfirmed && (
                            <button
                              type="button"
                              className="mini-action-btn success"
                              onClick={() => handleQuickConfirmSingleTask(st.id)}
                              title="Xác nhận nhanh nhiệm vụ này"
                            >
                              <Check size={11} /> Xác nhận
                            </button>
                          )}
                          <button
                            type="button"
                            className="mini-action-btn danger"
                            onClick={() => handleRemoveTask(st.id)}
                            title="Loại trừ nhiệm vụ này"
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
                  title="Đồng thuận và xác nhận tất cả nhiệm vụ trong phiên"
                >
                  <CheckCircle2 size={15} /> Xác nhận tất cả ({sessionTasks.length}) Task
                </button>
                <button
                  type="button"
                  className="add-task-quick-btn"
                  onClick={() => setCreateTaskOpen(true)}
                  title="Thêm nhiệm vụ mới vào phiên"
                >
                  <Plus size={14} /> Thêm Task
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
                  <span><Sparkles /> {confirmed ? 'Confirmed task' : state.step === 'taskClarification' ? 'Clarification requested' : state.step === 'managerConfirmed' ? 'Manager confirmed' : 'Possible task detected'}</span>
                  <span className={confirmed ? 'status-dot green' : 'status-dot'}>{confirmed ? 'Confirmed' : state.step === 'managerConfirmed' ? 'Awaiting employee' : state.step === 'taskClarification' ? 'Needs revision' : 'Awaiting manager'}</span>
                </div>
                <dl>
                  <div><dt>Task</dt><dd>{state.taskTitle}</dd></div>
                  <div><dt>Assignee</dt><dd>{state.assignee || 'Alex Morgan'}</dd></div>
                  <div><dt>Deadline</dt><dd>{state.deadline}</dd><small className="change-note">Updated from Friday</small></div>
                  <div><dt>Requirement</dt><dd>{state.requirement}</dd></div>
                </dl>

                {role === 'manager' && (state.step === 'task' || state.step === 'taskClarification') && (
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
                          emitTranscript(`Jordan confirmed Assignment (Revision ${(state.revision || 0) + 1}): "${state.taskTitle}" · Due ${state.deadline}`, true, 'demo');
                          onToast('Task revision confirmed by Manager', 'success');
                        }}
                      >
                        <Check /> {state.step === 'taskClarification' ? 'Confirm revised task' : 'Confirm assignment'}
                      </button>
                    </div>
                  </>
                )}

                {role === 'manager' && state.step === 'managerConfirmed' && (
                  <div className="waiting-note"><Clock3 /> Waiting for Alex to acknowledge revision {state.revision || 1}</div>
                )}

                {role === 'employee' && state.step === 'managerConfirmed' && (
                  <div className="ack-area">
                    <p><CheckCircle2 /> Jordan confirmed revision {state.revision || 1}. Does it match your understanding?</p>
                    <button className="secondary-button" onClick={() => setClarifyOpen('task')}>Request clarification</button>
                    <button
                      className="primary-button"
                      onClick={() => {
                        command('task:employee-acknowledge');
                        emitTranscript(`Alex acknowledged & accepted: "${state.taskTitle}" (Mutually confirmed)`, true, 'demo');
                        onToast('Task mutually confirmed and accepted', 'success');
                      }}
                    >
                      <Check /> Understood & accept
                    </button>
                  </div>
                )}

                {role === 'employee' && state.step === 'taskClarification' && (
                  <div className="waiting-note"><Clock3 /> Clarification sent · waiting for Jordan to revise</div>
                )}

                {confirmed && (
                  <div className="confirmed-note"><CheckCircle2 /> Manager confirmed · Alex acknowledged (Revision {state.revision || 1})</div>
                )}
              </div>
            )
          )}

          <button className="demo-control ai-action-btn" disabled={aiLoading} onClick={() => void runAiSummarize()}>
            <Sparkles size={16} /> {aiLoading ? 'Đang tóm tắt…' : '✨ AI Tóm tắt & Trích Task'}
          </button>
        </aside>
      </div>

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
              <div><span className="section-kicker">Manager review</span><h2>Edit possible task</h2></div>
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

function KnowledgeView() {
  const [question, setQuestion] = useState('Chính sách hỗ trợ cho người khiếm thính như thế nào?');
  const [result, setResult] = useState<KnowledgeResult>({
    found: true,
    answer: 'Understood cung cấp chính sách hỗ trợ tiếp cận toàn diện, phụ đề tự động thời gian thực và thông dịch viên ngôn ngữ ký hiệu.',
    detail: 'Nhân viên khiếm thính được trang bị: (1) Công cụ phụ đề thời gian thực hai chiều trên mọi nền tảng họp; (2) Thông dịch viên ASL/VNL theo yêu cầu cho các cuộc họp quan trọng; (3) Ngân sách thiết bị trợ năng $1,500/năm (máy trợ thính, tai nghe chống ồn, đồng hồ báo rung); (4) Ưu tiên giao tiếp văn bản bất đồng bộ (asynchronous-first).',
    source: {
      title: 'Accessibility & Inclusion Charter',
      section: 'Accommodations & Assistive Tech · Section 2.1',
      updatedAt: 'Updated September 2026',
    },
    mode: 'fallback',
  });
  const [loading, setLoading] = useState(false);

  const suggestedQuestions = [
    'Chính sách hỗ trợ cho người khiếm thính?',
    'What is the remote & hybrid work policy?',
    'Làm sao để xin nghỉ phép & chế độ nghỉ ốm?',
    'Quy trình đánh giá hiệu suất & thưởng KPI?',
    'Where are the WCAG 2.2 design guidelines?',
    'Ngân sách trang thiết bị làm việc & máy tính?',
    'Who is my People Partner & HR contact?',
  ];

  const ask = async (suggested?: string) => {
    const submitted = (suggested ?? question).trim();
    if (!submitted) return;
    setQuestion(submitted);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submitted }),
      });
      if (!response.ok) throw new Error('Knowledge service unavailable');
      setResult(await response.json());
    } catch {
      setResult({
        found: false,
        answer: 'Không tìm thấy thông tin phù hợp trong kho dữ liệu doanh nghiệp.',
        detail: 'Dịch vụ AI kiến thức tạm thời không phản hồi. Vui lòng thử lại hoặc liên hệ People Operations.',
        source: null,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="content-stack">
      <PageHeading
        eyebrow="Enterprise AI Knowledge Copilot"
        title="Ask your workplace."
        copy="Tra cứu chính sách, quy chế và hỗ trợ tiếp cận chuẩn hóa của doanh nghiệp với AI Grounded RAG."
      />
      <section className="knowledge-card">
        <form className="knowledge-search" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          <Search />
          <input
            aria-label="Ask a workplace question"
            placeholder="Hỏi về làm việc từ xa, hỗ trợ tiếp cận, nghỉ phép, KPI, thiết bị..."
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button disabled={loading}>{loading ? 'Searching…' : 'Ask AI'}</button>
        </form>

        <div className="suggestions">
          <span>Gợi ý câu hỏi</span>
          {suggestedQuestions.map((item) => (
            <button key={item} type="button" onClick={() => void ask(item)}>{item}</button>
          ))}
        </div>

        <div className={`knowledge-answer ${result.found ? '' : 'not-found'}`}>
          <span className="answer-icon">{result.found ? <BookOpen /> : <CircleHelp />}</span>
          <div>
            <small style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {result.found ? (
                <>
                  <Sparkles size={13} color="#2a6fb3" />
                  <span>ANSWER FROM VERIFIED ENTERPRISE POLICY</span>
                  {result.mode === 'ai' && <span className="diff-badge" style={{ background: '#e3f2fd', color: '#1565c0' }}>Gemini RAG</span>}
                </>
              ) : (
                'NO APPROVED SOURCE FOUND'
              )}
            </small>
            <h3>{result.answer}</h3>
            <p style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{result.detail}</p>
            {result.source ? (
              <div className="source-card">
                <FileText />
                <span>
                  <strong>{result.source.title}</strong>
                  <small>{result.source.section} · {result.source.updatedAt}</small>
                </span>
                <ChevronRight />
              </div>
            ) : (
              <button type="button" className="contact-button" onClick={() => ask('Who is my People Partner & HR contact?')}>
                <UserRound /> Contact People Operations
              </button>
            )}
          </div>
        </div>
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
  const [notifications, setNotifications] = useState<{ title: string; time: string; type: string }[]>([
    { title: 'Session ADC-DEMO initialized', time: 'Just now', type: 'system' },
  ]);

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

  const { state, segments, command, emitTranscript, emitBarrier, emitPossibleTask, emitTaskUpdate } = useSharedDemo(role, showToast);
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
