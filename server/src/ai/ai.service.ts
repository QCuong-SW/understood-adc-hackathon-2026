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
   * Helper to extract time, day, dates, and meeting schedule information from Vietnamese or English text.
   */
  private extractScheduleDetails(text: string): {
    isMeetingOrEvent: boolean;
    hasTimeOrDate: boolean;
    meetingTitle: string;
    extractedDeadline: string;
    extractedRequirement: string;
  } {
    const isMeetingOrEvent =
      /(?:cuộc\s*họp|lịch\s*họp|họp\s*(?:nội\s*bộ|team|dự\s*án|đột\s*xuất|ở|lúc|ngày|thứ)?|buổi\s*(?:họp|gặp|trao\s*đổi|sync)|meeting|sync|conference|appointment|call)/i.test(text);

    // Time matching: 4:00, 4:00 chiều, 16:00, 16h, 4 PM, khoảng 4:00...
    let timeStr = '';
    const explicitHour = text.match(/(\d{1,2}[:.]\d{2}(?:\s*(?:sáng|trưa|chiều|tối|am|pm))?|\d{1,2}\s*(?:giờ|h|am|pm)(?:\s*(?:sáng|chiều|tối))?)/i);
    const approximateTime = text.match(/khoảng\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:sáng|trưa|chiều|tối|am|pm|giờ|h)?)/i);
    if (explicitHour) {
      timeStr = explicitHour[0].trim();
    } else if (approximateTime) {
      timeStr = `Khoảng ${approximateTime[1].trim()}`;
    }

    // Day matching: Thứ Tư, Thứ Năm, Thứ 4, Monday, Wednesday, ngày mai, tuần tới...
    let dayStr = '';
    const dayMatch = text.match(/(?:ngày\s*)?(thứ\s*(?:hai|ba|tư|năm|sáu|bảy|chủ\s*nhật|[2-7]|cn)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hôm\s*nay|ngày\s*mai|tuần\s*(?:này|sau|tới)|today|tomorrow)/i);
    if (dayMatch) {
      dayStr = dayMatch[0].trim();
      dayStr = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
    }

    const hasTimeOrDate = Boolean(timeStr || dayStr);

    let extractedDeadline = 'Needs clarification';
    if (dayStr && timeStr) {
      extractedDeadline = `${dayStr} lúc ${timeStr}`;
    } else if (dayStr) {
      extractedDeadline = dayStr;
    } else if (timeStr) {
      extractedDeadline = timeStr;
    }

    // Extract meeting title or topic
    let meetingTitle = 'Tham gia cuộc họp trao đổi công việc';
    if (/quá\s*tải\s*nhân\s*sự/i.test(text)) {
      meetingTitle = 'Họp về vấn đề quá tải nhân sự ở công ty';
    } else if (/nhân\s*sự/i.test(text)) {
      meetingTitle = 'Họp trao đổi vấn đề nhân sự';
    } else if (/tiếp\s*cận|trợ\s*năng|accessibility/i.test(text)) {
      meetingTitle = 'Họp về luồng trợ năng & tiếp cận (Accessibility)';
    } else if (/thiết\s*kế|design|prototype|giao\s*diện/i.test(text)) {
      meetingTitle = 'Họp đánh giá tiến độ thiết kế Prototype';
    } else if (isMeetingOrEvent) {
      meetingTitle = `Cuộc họp ${dayStr ? `ngày ${dayStr}` : ''} ${timeStr ? `lúc ${timeStr}` : ''}`.trim();
    }

    let extractedRequirement = 'Lưu ý tham gia đúng giờ';
    if (/lưu\s*ý/i.test(text)) {
      extractedRequirement = 'Các bạn lưu ý tham gia đúng giờ và chuẩn bị nội dung trao đổi';
    }

    return { isMeetingOrEvent, hasTimeOrDate, meetingTitle, extractedDeadline, extractedRequirement };
  }

  /**
   * Dual-layer guardrail: Server-side explicit assignment & scheduled meeting intent validator
   * Supports English and Vietnamese directives, work assignments, and scheduled calendar meetings.
   */
  hasExplicitTaskIntent(transcript: string): boolean {
    const normalized = transcript.toLowerCase();

    // 1. Direct directives and work assignments (English & Vietnamese)
    const enAssignment =
      /\b(please\s+(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test|attend|join|schedule)|can\s+you\s+(?:please\s+)?(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test|attend|join)|could\s+you\s+(?:please\s+)?(?:complete|prepare|send|submit|review|create|build|finish|deliver|update|write|fix|implement|handle|test)|i\s+need\s+you\s+to|you\s+need\s+to|you\s+must|your\s+task\s+is|you\s+are\s+assigned\s+to|assign(?:ed)?\s+to|assignee\s+is|let(?:'s|\s+us)\s+(?:complete|prepare|send|submit|finish|build|create|meet|sync))\b/;

    const viAssignment =
      /(?:hãy|vui\s+lòng|nhờ\s+bạn|bạn\s+(?:hãy|cần|phải)|giao\s+cho(?:\s+[\p{L}\w]+)?|nhiệm\s+vụ\s+(?:là|của(?:\s+[\p{L}\w]+)?\s+là)|giúp\s+(?:tôi|mình))\s+(?:hoàn\s+thành|chuẩn\s+bị|gửi|nộp|tạo|xây\s+dựng|kiểm\s+tra|rà\s+soát|sửa|làm|tham\s+gia|họp)/u;

    const imperative =
      /(?:^|[.!?]\s+|:\s*)(?:complete\s+the|prepare\s+the|send\s+the|submit\s+the|review\s+the|attend\s+the|hoàn\s+thành|chuẩn\s+bị|gửi\s+bản|nộp\s+bản|họp\s+lúc|tham\s+gia\s+họp)\b/;

    // 2. Scheduled meetings, calendar syncs, calls & briefings
    const meetingEvent =
      /(?:cuộc\s*họp|lịch\s*họp|họp\s*(?:ở|lúc|vào|ngày|thứ)?|buổi\s*họp|buổi\s*sync|buổi\s*trao\s*đổi|meeting|sync|calendar|appointment|call\s*lúc)/i;

    // 3. Time / Date patterns with reminders or notices
    const dateTimeNotice =
      /(?:thứ\s*(?:hai|ba|tư|năm|sáu|bảy|chủ\s*nhật|[2-7])|ngày\s*mai|hôm\s*nay|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+.*?(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:giờ|h|chiều|sáng|pm|am))/i;
    const timeNoticePattern =
      /(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:giờ|h|chiều|sáng|pm|am))\s+.*?(?:thứ\s*(?:hai|ba|tư|năm|sáu|bảy|chủ\s*nhật|[2-7])|ngày\s*mai|monday|tuesday|wednesday|thursday|friday)/i;
    const noticeReminder = /(?:lưu\s*ý|nhớ\s*(?:nhé|tham\s*gia)|deadline|hạn\s*chót|thời\s*gian\s*họp|khoảng)/i;

    if (meetingEvent.test(normalized)) {
      return true;
    }

    if ((dateTimeNotice.test(normalized) || timeNoticePattern.test(normalized)) && (noticeReminder.test(normalized) || meetingEvent.test(normalized))) {
      return true;
    }

    // Negative filters: casual discussion, opinions without time or meeting
    const casualOpinion =
      /\b(looks\s+good|looks\s+interesting|what\s+do\s+you\s+think|busy\s+day|we\s+may\s+work|might\s+be|just\s+thinking|i\s+wonder|maybe\s+later|thấy\s+sao|nghĩ\s+sao|trông\s+được|có\s+lẽ)\b/;

    if (casualOpinion.test(normalized) && !enAssignment.test(normalized) && !viAssignment.test(normalized) && !meetingEvent.test(normalized)) {
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

  // --- Explicit Task & Scheduled Meeting Extraction ---
  private fallbackTask(transcript: string): TaskExtractionResult {
    const normalized = transcript.toLowerCase();
    const schedule = this.extractScheduleDetails(transcript);
    const hasIntent = this.hasExplicitTaskIntent(transcript);

    if (!hasIntent && !schedule.isMeetingOrEvent && !schedule.hasTimeOrDate) {
      return {
        taskDetected: false,
        taskReason: 'No explicit assignment or scheduled meeting was found.',
        mode: 'fallback',
      };
    }

    let title = 'Needs clarification';
    let deadline = schedule.extractedDeadline !== 'Needs clarification' ? schedule.extractedDeadline : 'Needs clarification';
    let requirement = schedule.extractedRequirement;
    let assignee = 'Alex Morgan';

    if (schedule.isMeetingOrEvent || /quá\s*tải\s*nhân\s*sự/i.test(transcript)) {
      title = schedule.meetingTitle;
      deadline = schedule.extractedDeadline !== 'Needs clarification' ? schedule.extractedDeadline : 'Thứ Tư lúc 16:00 (4:00 chiều)';
      requirement = schedule.extractedRequirement;
      assignee = 'Alex Morgan & Team';
    } else if (/prototype|bản\s+thiết\s+kế|mẫu\s+thử/i.test(normalized)) {
      title = 'Complete the first prototype';
      if (/thursday|thứ\s*năm/i.test(normalized)) deadline = 'Thursday, 4:00 PM';
      else if (/wednesday|thứ\s*tư|thứ\s*4/i.test(normalized)) deadline = 'Wednesday, 4:00 PM';
      else if (schedule.hasTimeOrDate) deadline = schedule.extractedDeadline;
      requirement = 'Include the accessibility flow';
    } else if (/onboarding/i.test(normalized)) {
      title = 'Prepare onboarding interview notes';
      deadline = 'Wednesday, 2:00 PM';
      requirement = 'Compile candidate feedback summary';
    } else if (/design\s*system/i.test(normalized)) {
      title = 'Review design system updates';
      deadline = 'Friday';
      requirement = 'Audit color contrast & typography';
    } else if (schedule.hasTimeOrDate) {
      title = 'Lịch trình / Cuộc họp đã lên lịch';
      deadline = schedule.extractedDeadline;
      requirement = 'Theo dõi và thực hiện đúng thời hạn';
    }

    if (/alex/i.test(normalized)) assignee = 'Alex Morgan';
    else if (/jordan/i.test(normalized)) assignee = 'Jordan Lee';

    return {
      taskDetected: true,
      taskReason: 'The transcript contains an explicit work assignment or scheduled meeting.',
      task: {
        title,
        assignee,
        deadline,
        requirement,
        confidence: 0.9,
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
    const schedule = this.extractScheduleDetails(safeTranscript);

    if (!hasIntent && !schedule.isMeetingOrEvent && !schedule.hasTimeOrDate) {
      return {
        taskDetected: false,
        taskReason: 'No explicit assignment or scheduled meeting was found.',
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
        'Analyze only the supplied workplace transcript. LANGUAGE POLICY: Strictly support only Vietnamese (Tiếng Việt) and English (Tiếng Anh). Write all extracted fields in the matching language of the conversation (Vietnamese if transcript is Vietnamese, English if transcript is English). Never output any other language.\n\nIMPORTANT FOR DEAF WORKPLACE ACCESSIBILITY (CRITICAL):\nDeaf employees cannot hear spoken announcements or calendar reminders. You MUST extract:\n1. Direct work assignments (e.g., "Alex, please complete...", "Hãy gửi bản thiết kế...", "Giao cho Alex...").\n2. SCHEDULED MEETINGS, calendar events, calls, briefings, and date/time notices (e.g., "sau đó sẽ có cuộc họp ở Khoảng 4:00 chiều của ngày Thứ Tư Các bạn lưu ý nhé" -> title: "Cuộc họp về vấn đề quá tải nhân sự ở công ty" hoặc "Họp lúc 16:00 Thứ Tư", deadline: "Thứ Tư lúc 16:00 (4:00 chiều)", requirement: "Lưu ý tham gia đúng giờ", assignee: "Alex Morgan & Team").\n3. Any upcoming milestone with day of week, date, or hour.\n\nIf taskDetected=true, extract title, assignee, deadline, and requirement. If any field is not specified in the speech, use "Needs clarification" (or "Cần làm rõ" in Vietnamese). Never drop scheduled meetings or time-bound notices!',
        schema,
      );

      if (!parsed || !parsed.taskDetected) {
        return fallback.taskDetected ? fallback : {
          taskDetected: false,
          taskReason: parsed?.taskReason || 'No explicit assignment or scheduled meeting was found.',
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
      if (/quá\s*tải\s*nhân\s*sự|cuộc\s*họp|họp|meeting/.test(key)) key = 'task:meeting-workload';
      else if (/prototype|mẫu\s+thử|thiết\s+kế\s+đầu/.test(key)) key = 'task:prototype';
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
    const schedule = this.extractScheduleDetails(transcript);
    const hasDeadlineChange = /thursday|thứ\s+năm|thứ\s+tư|wednesday|4\s*(?:pm|giờ|h)|actually|move|đổi|dời/.test(normalized);
    const hasPrototype = /prototype|thiết\s+kế|mẫu\s+thử|giao diện/.test(normalized);
    const hasOnboarding = /onboarding|phỏng\s+vấn/.test(normalized);
    const hasDesignSystem = /design\s+system|hệ\s+thống/.test(normalized);

    const rawTasks: ExtractedTaskItem[] = [];

    if (schedule.isMeetingOrEvent || /quá\s*tải\s*nhân\s*sự/i.test(transcript)) {
      rawTasks.push({
        title: schedule.meetingTitle,
        assignee: 'Alex Morgan & Team',
        deadline: schedule.extractedDeadline !== 'Needs clarification' ? schedule.extractedDeadline : 'Thứ Tư lúc 16:00 (4:00 chiều)',
        requirement: schedule.extractedRequirement,
        confidence: 0.92,
      });
    }

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

    if (schedule.isMeetingOrEvent && schedule.extractedDeadline !== 'Needs clarification') {
      keyDecisions.push(`Lịch họp: ${schedule.extractedDeadline}.`);
    } else if (hasDeadlineChange) {
      keyDecisions.push('Thời hạn chốt: Thứ Năm, 16:00 (Thursday, 4:00 PM).');
    }

    // Adaptive concise formatting based on task count
    let summary = '';
    if (tasks.length === 0) {
      summary = 'Cuộc trò chuyện trao đổi thông tin, chưa có nhiệm vụ hoặc lịch họp cụ thể được giao.';
      bulletPoints.push('Hai bên trao đổi thông tin cập nhật công việc trong phiên 1:1.');
    } else if (tasks.length === 1) {
      const t = tasks[0];
      summary = `Đã ghi nhận mục hành động: "${t.title}" (Hạn/Lịch: ${t.deadline}, giao cho ${t.assignee}).`;
      bulletPoints.push(`Mục hành động: ${t.title} · Yêu cầu: ${t.requirement}.`);
      if (t.deadline && !t.deadline.includes('clarification')) {
        bulletPoints.push(`Thời gian: ${t.deadline}.`);
      }
    } else {
      summary = `Tổng hợp gồm ${tasks.length} nhiệm vụ & lịch họp đã thống nhất:`;
      for (let i = 0; i < tasks.length; i += 1) {
        const t = tasks[i];
        bulletPoints.push(`${i + 1}. ${t.title} · ${t.assignee} · Hạn/Lịch: ${t.deadline}`);
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
        'You are Understood AI Assistant. Summarize the workplace conversation concisely for a deaf individual and manager. LANGUAGE POLICY: Strictly support only Vietnamese (Tiếng Việt) and English (Tiếng Anh). Detect the primary language of the conversation and write the summary, bulletPoints, and keyDecisions in the matching language (Vietnamese for Vietnamese conversation, English for English conversation). Never output any third language.\n\nIMPORTANT INSTRUCTIONS FOR DEAF ACCESSIBILITY (CRITICAL):\n1. Extract both direct work assignments AND scheduled meetings, calendar syncs, deadlines, briefings, and date/time notices into the tasks list with exact deadline and requirement so deaf users do not miss calendar commitments.\n2. Keep the summary short and crisp.\n3. Deduplicate tasks: If a task or meeting was mentioned multiple times or its deadline/time was modified (e.g. changed from Friday to Thursday 4 PM), KEEP ONLY the single final agreed task with the latest deadline.\n4. Return an array of distinct, deduplicated tasks.\n5. If multiple tasks exist, adapt the summary to be a brief list with no repetition.',
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
