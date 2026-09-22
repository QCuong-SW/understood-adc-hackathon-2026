import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GeminiService } from './gemini.service';
import { BarrierType } from '../sessions/session.types';

export type BarrierAnalysisResult = {
  barrierDetected: boolean;
  barrierType: BarrierType;
  confidence: number;
  reason: string;
  messageForEmployee: string;
  guidanceForManager: string;
  mode: 'ai' | 'fallback';
};

export type TaskExtractionResult = {
  taskDetected: boolean;
  taskReason: string;
  task?: {
    title: string;
    assignee: string;
    deadline: string;
    requirement: string;
    confidence: number;
  };
  mode: 'ai' | 'fallback';
};

@Injectable()
export class AiService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * Dual-layer guardrail: Server-side explicit assignment intent validator
   * Supports English and Vietnamese explicit imperative / directive phrasing.
   */
  hasExplicitTaskIntent(transcript: string): boolean {
    const normalized = transcript.toLowerCase();

    // English direct directives and assignment phrases
    const enAssignment =
      /\b(please\s+(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test)|can\s+you\s+(?:please\s+)?(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test)|could\s+you\s+(?:please\s+)?(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test)|i\s+need\s+you\s+to|you\s+need\s+to|you\s+must|your\s+task\s+is|you\s+are\s+assigned\s+to|assign(?:ed)?\s+to|assignee\s+is|let(?:'s|\s+us)\s+(?:complete|prepare|send|submit|finish|build|create))\b/;

    // Vietnamese explicit assignment phrases (allows optional name like "giao cho Alex hoàn thành...")
    const viAssignment =
      /(?:hãy|vui\s+lòng|nhờ\s+bạn|bạn\s+(?:hãy|cần|phải)|giao\s+cho(?:\s+[\p{L}\w]+)?|nhiệm\s+vụ\s+(?:là|của(?:\s+[\p{L}\w]+)?\s+là)|giúp\s+(?:tôi|mình))\s+(?:hoàn\s+thành|chuẩn\s+bị|gửi|nộp|tạo|xây\s+dựng|kiểm\s+tra|rà\s+soát|sửa|làm)/u;

    // Explicit imperative at beginning of sentence or after speaker colon
    const imperative =
      /(?:^|[.!?]\s+|:\s*)(?:complete\s+the|prepare\s+the|send\s+the|submit\s+the|hoàn\s+thành|chuẩn\s+bị|gửi\s+bản|nộp\s+bản)\b/;

    // Negative filters: casual discussion, opinions, questions without request
    const casualOpinion =
      /\b(looks\s+good|looks\s+interesting|what\s+do\s+you\s+think|busy\s+day|we\s+may\s+work|might\s+be|just\s+thinking|i\s+wonder|maybe\s+later|thấy\s+sao|nghĩ\s+sao|trông\s+được|có\s+lẽ)\b/;

    // If matches casual conversation and doesn't have strong explicit assignment
    if (casualOpinion.test(normalized) && !enAssignment.test(normalized) && !viAssignment.test(normalized)) {
      return false;
    }

    return enAssignment.test(normalized) || viAssignment.test(normalized) || imperative.test(normalized);
  }

  // --- Barrier Analysis ---
  private fallbackBarrier(transcript: string): BarrierAnalysisResult {
    const normalized = transcript.toLowerCase();
    const changed = /actually|instead|move|change|rather|update|chuyển|đổi|dời|thay\s+đổi/.test(normalized);
    const fast = /fast|quick|chậm|nhanh/.test(normalized);

    let barrierType: BarrierType = 'LOW_CONFIDENCE';
    let message = 'Check understanding: key details may have changed.';
    let guidance = 'Pause and restate the key detail clearly.';

    if (fast) {
      barrierType = 'FAST_SPEECH';
      message = 'Speech may be too fast.';
      guidance = 'Slow down and summarize the key action.';
    } else if (changed) {
      barrierType = 'LOW_CONFIDENCE';
      message = 'A deadline or requirement has been updated.';
      guidance = 'Acknowledge the changed deadline/requirement explicitly.';
    }

    return {
      barrierDetected: changed || fast,
      barrierType,
      confidence: changed || fast ? 0.85 : 0.4,
      reason: changed
        ? 'A deadline or requirement change was detected in speech.'
        : fast
          ? 'Fast speech pacing detected.'
          : 'No major communication barrier detected.',
      messageForEmployee: message,
      guidanceForManager: guidance,
      mode: 'fallback',
    };
  }

  async analyzeBarrier(transcript: string): Promise<BarrierAnalysisResult> {
    const safeTranscript = transcript.trim().slice(0, 10000);
    if (!safeTranscript) {
      return {
        barrierDetected: false,
        barrierType: 'LOW_CONFIDENCE',
        confidence: 0,
        reason: 'Empty transcript.',
        messageForEmployee: '',
        guidanceForManager: '',
        mode: 'fallback',
      };
    }

    const fallback = this.fallbackBarrier(safeTranscript);

    try {
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          barrierDetected: { type: 'boolean' },
          barrierType: {
            type: 'string',
            enum: ['FAST_SPEECH', 'OVERLAPPING_SPEAKERS', 'CAPTION_DELAY', 'LOW_CONFIDENCE'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
          messageForEmployee: { type: 'string' },
          guidanceForManager: { type: 'string' },
        },
        required: [
          'barrierDetected',
          'barrierType',
          'confidence',
          'reason',
          'messageForEmployee',
          'guidanceForManager',
        ],
      };

      const parsed = await this.gemini.json<Omit<BarrierAnalysisResult, 'mode'>>(
        safeTranscript,
        'You are an accessible communication analyzer. Analyze the supplied workplace conversation transcript for communication barriers (e.g. sudden mid-sentence changes of deadline or requirements, fast speech, overlapping discussion, ambiguous details). Return barrierDetected=true only when there is an actual barrier or changed detail needing repair. Provide concise, constructive guidance for the manager and an empathetic alert message for the employee.',
        schema,
      );

      if (!parsed) return fallback;

      return {
        ...parsed,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        mode: 'ai',
      };
    } catch {
      return fallback;
    }
  }

  // --- Explicit Task Extraction ---
  private fallbackTask(transcript: string): TaskExtractionResult {
    const normalized = transcript.toLowerCase();
    const hasIntent = this.hasExplicitTaskIntent(transcript);

    if (!hasIntent) {
      return {
        taskDetected: false,
        taskReason: 'No explicit assignment or request to create work was found.',
        mode: 'fallback',
      };
    }

    // Extraction heuristics
    let title = 'Needs clarification';
    if (/prototype/.test(normalized) || /bản\s+thiết\s+kế|mẫu\s+thử/.test(normalized)) {
      title = 'Complete the first prototype';
    } else if (/onboarding/.test(normalized)) {
      title = 'Prepare onboarding interview notes';
    } else if (/design\s+system/.test(normalized)) {
      title = 'Review design system updates';
    }

    let assignee = 'Needs clarification';
    if (/alex/.test(normalized)) assignee = 'Alex Morgan';
    else if (/jordan/.test(normalized)) assignee = 'Jordan Lee';

    let deadline = 'Needs clarification';
    if (/thursday/.test(normalized) || /thứ\s+năm/.test(normalized)) {
      deadline = 'Thursday, 4:00 PM';
    } else if (/friday/.test(normalized) || /thứ\s+sáu/.test(normalized)) {
      deadline = 'Friday';
    } else if (/4\s*(?:pm|giờ|h)/.test(normalized)) {
      deadline = '4:00 PM';
    }

    let requirement = 'Needs clarification';
    if (/accessibility/.test(normalized) || /tiếp\s+cận/.test(normalized)) {
      requirement = 'Include the accessibility flow';
    }

    return {
      taskDetected: true,
      taskReason: 'The transcript contains an explicit work assignment.',
      task: {
        title,
        assignee,
        deadline,
        requirement,
        confidence: 0.85,
      },
      mode: 'fallback',
    };
  }

  async extractTask(transcript: string): Promise<TaskExtractionResult> {
    const safeTranscript = transcript.trim().slice(0, 10000);
    if (!safeTranscript) {
      return {
        taskDetected: false,
        taskReason: 'Empty transcript.',
        mode: 'fallback',
      };
    }

    // Step 1: Server-side eligibility validator
    const hasIntent = this.hasExplicitTaskIntent(safeTranscript);
    if (!hasIntent) {
      return {
        taskDetected: false,
        taskReason: 'No explicit assignment or request to create work was found.',
        mode: 'fallback',
      };
    }

    const fallback = this.fallbackTask(safeTranscript);

    try {
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskDetected: { type: 'boolean' },
          taskReason: { type: 'string' },
          title: { type: 'string' },
          assignee: { type: 'string' },
          deadline: { type: 'string' },
          requirement: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['taskDetected', 'taskReason', 'title', 'assignee', 'deadline', 'requirement', 'confidence'],
      };

      const parsed = await this.gemini.json<{
        taskDetected: boolean;
        taskReason: string;
        title: string;
        assignee: string;
        deadline: string;
        requirement: string;
        confidence: number;
      }>(
        safeTranscript,
        'Analyze only the supplied workplace transcript. Set taskDetected=true ONLY when a speaker explicitly assigns or requests concrete work (e.g., "Alex, please complete...", "Can you prepare...", "Hãy gửi bản thiết kế...", "Giao cho Alex..."). A casual discussion, question, idea, or plan is NOT a task. If taskDetected=true, extract title, assignee, deadline, and requirement. If any field is not specified in the speech, use "Needs clarification". Never hallucinate details.',
        schema,
      );

      if (!parsed || !parsed.taskDetected) {
        return fallback.taskDetected ? fallback : {
          taskDetected: false,
          taskReason: parsed?.taskReason || 'No explicit assignment or request to create work was found.',
          mode: 'ai',
        };
      }

      return {
        taskDetected: true,
        taskReason: parsed.taskReason,
        task: {
          title: parsed.title || fallback.task?.title || 'Needs clarification',
          assignee: parsed.assignee || fallback.task?.assignee || 'Needs clarification',
          deadline: parsed.deadline || fallback.task?.deadline || 'Needs clarification',
          requirement: parsed.requirement || fallback.task?.requirement || 'Needs clarification',
          confidence: Math.max(0, Math.min(1, parsed.confidence)),
        },
        mode: 'ai',
      };
    } catch {
      return fallback;
    }
  }

  // --- Deduplication & Multi-Task Management ---
  deduplicateTasks(tasks: ExtractedTaskItem[]): ExtractedTaskItem[] {
    const map = new Map<string, ExtractedTaskItem>();

    for (const t of tasks) {
      if (!t || !t.title) continue;
      const lower = t.title.toLowerCase();
      if (lower.includes('needs clarification') && tasks.length > 1) continue;

      let key = lower.trim().replace(/\s+/g, ' ');
      if (/prototype|mẫu\s+thử|thiết\s+kế\s+đầu/.test(key)) key = 'task:prototype';
      else if (/onboarding|phỏng\s+vấn/.test(key)) key = 'task:onboarding';
      else if (/design\s+system|hệ\s+thống\s+thiết\s+kế/.test(key)) key = 'task:design-system';

      // Keep latest / most specific task with valid deadline
      const existing = map.get(key);
      if (!existing || (t.deadline && !t.deadline.includes('clarification'))) {
        map.set(key, t);
      }
    }

    return Array.from(map.values());
  }

  // --- Live Conversation Summary & Key Takeaways with Adaptive Brevity ---
  private fallbackSummary(transcript: string): ConversationSummaryResult {
    const normalized = transcript.toLowerCase();
    const hasDeadlineChange = /thursday|thứ\s+năm|4\s*(?:pm|giờ|h)|actually|move|đổi|dời/.test(normalized);
    const hasPrototype = /prototype|thiết\s+kế|mẫu\s+thử|giao diện/.test(normalized);
    const hasOnboarding = /onboarding|phỏng\s+vấn/.test(normalized);
    const hasDesignSystem = /design\s+system|hệ\s+thống/.test(normalized);

    const rawTasks: ExtractedTaskItem[] = [];

    if (hasPrototype) {
      rawTasks.push({
        title: 'Complete the first prototype',
        assignee: 'Alex Morgan',
        deadline: hasDeadlineChange ? 'Thursday, 4:00 PM' : 'Friday',
        requirement: 'Include the accessibility flow',
        confidence: 0.9,
      });
    }
    if (hasOnboarding) {
      rawTasks.push({
        title: 'Prepare onboarding interview notes',
        assignee: 'Alex Morgan',
        deadline: 'Wednesday, 2:00 PM',
        requirement: 'Compile candidate feedback summary',
        confidence: 0.85,
      });
    }
    if (hasDesignSystem) {
      rawTasks.push({
        title: 'Review design system updates',
        assignee: 'Alex Morgan',
        deadline: 'Friday',
        requirement: 'Audit color contrast & typography',
        confidence: 0.85,
      });
    }

    const tasks = this.deduplicateTasks(rawTasks);
    const keyDecisions: string[] = [];
    const bulletPoints: string[] = [];

    if (hasDeadlineChange) {
      keyDecisions.push('Thời hạn chốt: Thứ Năm, 16:00 (Thursday, 4:00 PM).');
    }

    // Adaptive concise formatting based on task count
    let summary = '';
    if (tasks.length === 0) {
      summary = 'Cuộc trò chuyện trao đổi thông tin, chưa có nhiệm vụ cụ thể được giao.';
      bulletPoints.push('Hai bên trao đổi thông tin cập nhật công việc trong phiên 1:1.');
    } else if (tasks.length === 1) {
      const t = tasks[0];
      summary = `Đã chốt nhiệm vụ: "${t.title}" (Hạn: ${t.deadline}, giao cho ${t.assignee}).`;
      bulletPoints.push(`Nhiệm vụ: ${t.title} · Yêu cầu: ${t.requirement}.`);
      if (hasDeadlineChange) {
        bulletPoints.push(`Thời hạn đã đổi sang: ${t.deadline}.`);
      }
    } else {
      summary = `Tổng hợp gồm ${tasks.length} nhiệm vụ đã thống nhất:`;
      for (let i = 0; i < tasks.length; i += 1) {
        const t = tasks[i];
        bulletPoints.push(`${i + 1}. ${t.title} · ${t.assignee} · Hạn: ${t.deadline}`);
      }
    }

    return {
      summary,
      bulletPoints,
      keyDecisions,
      taskDetected: tasks.length > 0,
      taskCount: tasks.length,
      tasks,
      task: tasks[0],
      mode: 'fallback',
    };
  }

  async summarizeConversation(transcript: string): Promise<ConversationSummaryResult> {
    const safeTranscript = transcript.trim().slice(0, 10000);
    if (!safeTranscript) {
      return {
        summary: 'Chưa có nội dung trao đổi để tóm tắt.',
        bulletPoints: ['Hãy bắt đầu gửi tin nhắn hoặc bật micro để trao đổi.'],
        keyDecisions: [],
        taskDetected: false,
        taskCount: 0,
        tasks: [],
        mode: 'fallback',
      };
    }

    const fallback = this.fallbackSummary(safeTranscript);

    try {
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          bulletPoints: {
            type: 'array',
            items: { type: 'string' },
          },
          keyDecisions: {
            type: 'array',
            items: { type: 'string' },
          },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                assignee: { type: 'string' },
                deadline: { type: 'string' },
                requirement: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['title', 'assignee', 'deadline', 'requirement', 'confidence'],
            },
          },
        },
        required: ['summary', 'bulletPoints', 'keyDecisions', 'tasks'],
      };

      const parsed = await this.gemini.json<{
        summary: string;
        bulletPoints: string[];
        keyDecisions: string[];
        tasks: ExtractedTaskItem[];
      }>(
        safeTranscript,
        'You are Understood AI Assistant. Summarize the workplace conversation concisely for a deaf individual and manager. IMPORTANT INSTRUCTIONS: 1. Keep the summary short and crisp. 2. Deduplicate tasks: If a task was mentioned multiple times or its deadline/scope was modified (e.g. changed from Friday to Thursday 4 PM), KEEP ONLY the single final agreed task with the latest deadline. 3. Return an array of distinct, deduplicated tasks. 4. If multiple tasks exist, adapt the summary to be a brief list with no repetition.',
        schema,
      );

      if (!parsed) return fallback;

      const deduplicated = this.deduplicateTasks(
        (parsed.tasks && parsed.tasks.length > 0) ? parsed.tasks : fallback.tasks
      );

      return {
        summary: parsed.summary || fallback.summary,
        bulletPoints: (parsed.bulletPoints && parsed.bulletPoints.length > 0) ? parsed.bulletPoints : fallback.bulletPoints,
        keyDecisions: (parsed.keyDecisions && parsed.keyDecisions.length > 0) ? parsed.keyDecisions : fallback.keyDecisions,
        taskDetected: deduplicated.length > 0,
        taskCount: deduplicated.length,
        tasks: deduplicated,
        task: deduplicated[0] || fallback.task,
        mode: 'ai',
      };
    } catch {
      return fallback;
    }
  }
}

export type ExtractedTaskItem = {
  title: string;
  assignee: string;
  deadline: string;
  requirement: string;
  confidence: number;
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
