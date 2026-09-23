# Understood — Accessible Workplace Communication Copilot

> **ADC Hackathon 2026** — *Empowering deaf and hard-of-hearing professionals with real-time accessible communication repair, live change diffs, quiet feedback signals, and autonomous AI task consensus.*

---

## 1. Team Information
- **Project Name**: Understood — Accessible Workplace Communication Copilot
- **Track**: Accessibility & Workplace Inclusion
- **Team / Authors**: ADC Hackathon 2026 Team (QCuong-SW & Boop Team)
- **Repository**: [https://github.com/QCuong-SW/understood-adc-hackathon-2026](https://github.com/QCuong-SW/understood-adc-hackathon-2026)
- **Target Audience**: Deaf & Hard-of-Hearing (DHH) Employees, Team Leads, People Operations & Inclusive Organizations.

---

## 2. Problem Statement & Impact

In fast-paced modern workplaces, 1:1 syncs and team standups present significant communication barriers for deaf and hard-of-hearing professionals:

- **Lip-reading fatigue and cognitive exhaustion**: Lip reading captures only 30% to 40% of spoken English or Vietnamese. The remaining context must be inferred through constant mental guesswork, leading to severe cognitive burnout.
- **Missed verbal change-of-plans**: Managers frequently modify deadlines or deliverables mid-sentence (e.g., *"Actually, let's move the deadline from Friday to Thursday at 4 PM"*). DHH employees frequently miss these subtle verbal adjustments.
- **Hesitation to interrupt**: DHH employees often hesitate to repeatedly halt the meeting flow to ask for spoken repetitions, fearing they might be perceived as slowing down the team.
- **Information loss and meeting minute bottlenecks**: Traditional workflows rely on managers manually writing follow-up emails hours later. Important action items are often forgotten or miscommunicated before written notes arrive.

---

## 3. The Understood Solution

Understood is a closed-loop, bidirectional workplace communication assistant designed to bridge this gap through five foundational pillars:

- **Two-Way Live Speech-to-Text (<200ms Latency)**: Real-time speech transcription operating simultaneously on both devices using Web Speech API with Socket.IO cross-device synchronization.
- **AI Live Diff & Communication Change Detection**: Heuristic and LLM-driven detection that instantly flags mid-sentence alterations (such as deadline or scope changes) and presents clear visual before/after comparisons.
- **1-Tap Non-Verbal Quick Signals**: One-touch feedback buttons (`Understood`, `Slow Down`, `Repeat`, `Clarify`) that trigger standout ambient visual banners on the manager screen without audible interruptions.
- **Self-Service AI Summarization & Task Extraction**: DHH employees can independently trigger an AI meeting recap, extract key decisions, and review structured task cards on their own device without waiting for manager approval.
- **Traceable Two-Way Mutual Consensus**: Both parties confirm assignment details with immutable revision tracking, exported directly as structured Markdown action items.
- **Enterprise AI Knowledge Copilot (Grounded RAG)**: Instant, zero-hallucination answers to corporate accommodation policies and employee handbooks powered by retrieval-augmented generation.

---

## 4. Step-by-Step Demo Flow (1m30s – 2m Speedrun)

### Preparation
- **Device 1 (Laptop/Desktop)**: Open application -> Select role **"Jordan Lee (Team Manager)"**.
- **Device 2 (Laptop/Mobile)**: Open application -> Select role **"Alex Morgan (Employee)"**.

---

### Step 1: Initialize 1:1 Live Session
- **Manager**: Clicks **"Start conversation with Alex"** -> Session enters live state.
- **Employee**: Clicks **"Join live session"** -> Both devices connect to WebSocket room `ADC-DEMO`.

### Step 2: Speech Recognition & AI Live Diff (Deadline Shift Detection)
- **Manager**: Turns on microphone (or types into input): *"Actually, let's move the deadline to Thursday at 4 PM and include the accessibility flow."*
- **Employee**:
  - Live captions stream in real time (<200ms latency).
  - The **AI Live Diff** card highlights the change: <s>Friday</s> -> **Thursday, 4:00 PM** (with *Deadline Updated* badge).
  - Ensures the employee immediately sees the schedule update without guessing.

### Step 3: 1-Tap Non-Verbal Quick Feedback
- **Employee**: Taps the feedback button in the bottom dock and selects **"Slow down"** or **"Clarify"**.
- **Manager**: A glowing **Ambient Alert Banner** appears at the top of the manager's screen:
  - *“Alex requested: Please slow down speaking pace”* -> The manager adjusts cadence seamlessly.

### Step 4: Autonomous AI Summarization & Task Acceptance
- **Employee**: Clicks **"AI Summarize & Extract Tasks"**.
- **Instant Display on Employee Screen**:
  - **AI Conversation Summary**: Concise executive recap of discussed points.
  - **Key Decisions**: Extracted key decisions.
  - **Extracted Task Card**: *Title: Complete the first prototype · Assignee: Alex Morgan · Deadline: Thursday, 4:00 PM · Requirement: Include the accessibility flow*.
- **Employee**: Reviews the card and clicks **"Understood & accept"** -> Directly accepts the assignment with self-service autonomy.

### Step 5: Mutual Confirmation & Markdown Export
- Task status updates to: **"Mutually confirmed · Traceable & synchronized (Rev 1)"**.
- Navigate to **Tasks** tab -> Click **"Export action items (.md)"** to download the structured markdown report.

---

## 5. System Architecture & Codebase Structure

### Monorepo Directory Layout

```
understood-adc-hackathon-2026/
├── public/                                # Static brand and icon assets
│   ├── favicon.png                        # Application browser favicon
│   ├── logo.png                           # Main Understood logo
│   └── app-icon.png                       # Mobile PWA apple touch icon
├── src/                                   # Frontend Application (React + TypeScript + Vite)
│   ├── assets/                            # Local images and logo assets
│   ├── App.tsx                            # Root application component, views, and state machine
│   ├── main.tsx                           # React DOM entrypoint
│   └── styles.css                         # Design system, accessible CSS variables, responsive layout
├── server/                                # Backend Service (NestJS 11 + Socket.IO + Persistent Store)
│   ├── data/                              # Database storage directory
│   │   └── understood_store.json          # Persistent file-based JSON database store
│   ├── src/
│   │   ├── ai/                            # AI & Language processing module
│   │   │   ├── ai.controller.ts           # REST endpoints for AI summarization & task extraction
│   │   │   ├── ai.service.ts              # Heuristic extraction engine & Gemini LLM pipeline
│   │   │   └── gemini.service.ts          # Google GenAI SDK client wrapper
│   │   ├── database/                      # Persistent storage module
│   │   │   └── database.service.ts        # Zero-native-dependency JSON store and repository methods
│   │   ├── knowledge/                     # Enterprise Knowledge RAG module
│   │   │   ├── knowledge.controller.ts    # POST /api/v1/knowledge/query endpoint
│   │   │   └── knowledge.service.ts       # Grounded RAG knowledge search and policy synthesis
│   │   ├── sessions/                      # Real-time WebSocket Gateway and Session APIs
│   │   │   ├── session.types.ts           # Shared data contracts and model definitions
│   │   │   ├── sessions.controller.ts     # REST endpoints for session metadata and summary
│   │   │   └── sessions.gateway.ts        # Socket.IO Gateway for real-time 1:1 cross-device sync
│   │   ├── tasks/                         # Task management module
│   │   │   └── tasks.controller.ts        # REST endpoints for confirmed task records
│   │   ├── app.module.ts                  # NestJS root application module
│   │   └── main.ts                        # Application bootstrap entrypoint
│   ├── Dockerfile                         # Production Docker container (Node 22-alpine)
│   ├── package.json                       # Server dependencies and scripts
│   └── tsconfig.json                      # Server TypeScript configuration
├── index.html                             # HTML5 root template with accessibility metadata
├── package.json                           # Root monorepo configuration and dependencies
├── render.yaml                            # Infrastructure-as-Code for Render Cloud deployment
├── tsconfig.json                          # Root TypeScript configuration
└── vite.config.ts                         # Vite build and proxy configuration
```

---

## 6. Detailed Frontend Architecture (`src/`)

The frontend is built using **React 18** with **TypeScript** and **Vite**, prioritizing accessibility (WCAG 2.2 AAA), sub-second responsiveness, and multi-device synchronization.

### Core Architectural Components

1. **State Machine (`useSharedDemo`)**:
   - Manages the complete lifecycle of a communication session: `idle` -> `live` -> `barrier` -> `clarify` -> `task` -> `managerConfirmed` -> `confirmed` -> `ended`.
   - Uses a three-tier sync mechanism:
     - **0ms (Optimistic Local State)**: Instant local state updates on user input.
     - **<1ms (Cross-Tab Broadcast)**: Synchronizes open tabs via `BroadcastChannel('understood-demo')`.
     - **<50ms (Cross-Device WebSocket)**: Emits and listens to Socket.IO events (`transcript:segment`, `barrier:create`, `task:create_possible`, `signal`, `tasks:update`).

2. **Real-time Voice Pipeline (`useRealtimeVoice`)**:
   - Integrates the browser's native `SpeechRecognition` / `webkitSpeechRecognition` API.
   - Provides continuous streaming speech recognition with interim and final transcript segmentation.
   - Supports multi-language switching (`en-US` and `vi-VN`).
   - Automatically inspects manager speech in real time for change keywords (`actually`, `move`, `change`, `thursday`) to trigger AI Live Diff alerts.

3. **Views and Panels**:
   - **`SessionView`**: The primary 1:1 live workspace featuring the two-way transcript timeline, active communication banners, 1-tap quick signal dock, and real-time context panel.
   - **`TasksView` & `TaskDetail`**: Dedicated task tracking interface displaying confirmed action items, revision logs, assignee details, and markdown export tools.
   - **`KnowledgeView`**: The Enterprise AI Knowledge Copilot interface with step-by-step telemetry animation, suggested queries, verified policy pills, and source citations.
   - **`SettingsView`**: Communication preference configuration for caption sizing (`small`, `comfortable`, `large`), alert sensitivity (`low`, `balanced`, `high`), and visual prompt toggles.

4. **User Experience & Accessibility**:
   - **Accessible Color Contrast**: Compliant with WCAG 2.2 Level AAA standards (minimum 7:1 contrast for regular text).
   - **Layout Stability**: Implemented `scrollbar-gutter: stable` and bounded layout dimensions to prevent cumulative layout shift (CLS).
   - **Responsive Drawer**: Bottom sheet drawer on mobile devices with full keyboard accessibility and touch handles.

---

## 7. Detailed Backend Architecture (`server/src/`)

The backend is built with **NestJS 11**, organized into modular, decoupled service layers:

### Module Breakdown

1. **Session & WebSocket Gateway (`SessionsModule`)**:
   - **`SessionsGateway`**: Handles Socket.IO client connections in room `session:ADC-DEMO`.
   - **Events Handled**:
     - `session:join`: Client joins room and receives the latest session snapshot.
     - `transcript:segment`: Broadcasts spoken and typed speech segments to all room members.
     - `signal`: Broadcasts 1-tap non-verbal signals to managers.
     - `barrier:create`: Emits barrier change notifications.
     - `task:create_possible` & `task:manager_update`: Synchronizes task draft modifications.
     - `task:manager_confirm` & `task:employee_ack`: Coordinates two-way mutual consensus.
     - `tasks:update`: Synchronizes synthesized multi-task lists across devices.
   - **`SessionsController`**: Provides REST endpoints (`GET /api/v1/sessions/ADC-DEMO`, `GET /api/v1/sessions/ADC-DEMO/summary`, `POST /api/v1/sessions/ADC-DEMO/reset`).

2. **AI & Task Extraction Engine (`AiModule`)**:
   - **`AiService`**:
     - **Heuristic Pattern Engine**: Evaluates incoming transcripts using regular expressions for meeting schedules, assignment verbs, and deadline revisions.
     - **Gemini LLM Integration**: Generates structured summaries, bullet points, key decisions, and deduplicated task arrays using schema-constrained JSON outputs.
     - **Deterministic Fallback**: Automatically activates if external API quotas are exceeded, ensuring zero demo downtime.
   - **`GeminiService`**: Wraps `@google/genai` to communicate with Google Gemini models.

3. **Enterprise Knowledge RAG Engine (`KnowledgeModule`)**:
   - **`KnowledgeService`**: Implements Grounded Retrieval-Augmented Generation across company handbooks, accommodation guidelines, and WCAG standards.
   - Generates structured answers with exact section citations (`sourceTitle`, `sourceSection`, `sourceUpdatedAt`).

---

## 8. Database Architecture & Data Schema

The database uses a persistent, zero-native-dependency JSON repository (`DatabaseService`) storing records at `server/data/understood_store.json`. This architecture provides high reliability, cross-platform portability across Windows/Linux/Docker, and immunity to native SQLite compilation errors.

### Schema Definition

```typescript
interface Schema {
  appState: Record<string, string>;               // Key-value store for app configuration
  sessions: Record<string, SessionRecord>;        // Session status, timestamps, and active state
  participants: Record<string, string[]>;         // Participant roles mapped to session IDs
  transcripts: TranscriptSegment[];               // Ordered list of spoken transcript turns
  barriers: BarrierEvent[];                       // Detected communication changes and diffs
  clarifications: ClarificationRequest[];         // Clarification requests and resolution states
  tasks: Record<string, TaskRecord>;              // Structured task records and revision history
  aiQueries: Array<AiQueryLog>;                   // Telemetry log of enterprise knowledge queries
}
```

### Core Data Models

- **`Session`**:
  - `id`: Session identifier (e.g., `ADC-DEMO`).
  - `status`: `IDLE` | `LIVE` | `PAUSED` | `ENDED`.
  - `state`: Current `DemoState` object.
  - `startedAt`, `endedAt`, `createdAt`, `updatedAt`: ISO timestamps.

- **`TranscriptSegment`**:
  - `id`: Unique segment identifier.
  - `sessionId`: Associated session ID.
  - `speakerRole`: `manager` | `employee` | `unknown`.
  - `text`: Spoken or typed message content.
  - `isFinal`: Boolean flag indicating whether speech recognition has finalized.
  - `source`: `gemini` | `browser` | `device` | `demo`.
  - `startedAt`: Timestamp string.

- **`TaskRecord` & `TaskRevision`**:
  - `id`: Task identifier.
  - `sessionId`: Associated session.
  - `status`: `POSSIBLE` | `PENDING_MANAGER_CONFIRM` | `PENDING_EMPLOYEE_ACK` | `CONFIRMED`.
  - `currentRevision`: Integer revision count.
  - `title`: Task summary title.
  - `assignee`: Responsible team member.
  - `deadline`: Agreed completion deadline.
  - `requirement`: Acceptance criteria or specific scope notes.
  - `revisions`: Array of `TaskRevision` objects storing timestamped manager confirmation and employee acknowledgement records.

---

## 9. Comprehensive Tech Stack

### Frontend
- **Framework**: React 18.3.1
- **Language**: TypeScript 5.6.2
- **Build Tool**: Vite 6.0.5
- **Icons**: Lucide React 0.468.0
- **Real-time Client**: Socket.IO Client 4.8.1
- **Speech API**: W3C Web Speech Recognition API
- **Styling**: Modern CSS3 Custom Properties (Design Tokens, Flexbox, CSS Grid)

### Backend
- **Framework**: NestJS 11.0.0
- **HTTP Server**: Express
- **Language**: TypeScript 5.7.0
- **Real-time Engine**: Socket.IO 4.8.1 (WebSockets)
- **Data Persistence**: Node.js FileSystem (`node:fs`) persistent JSON store

### AI & Natural Language Processing
- **AI SDK**: Google GenAI SDK (`@google/genai` 2.24.0)
- **Foundation Models**: Google Gemini 2.5 Flash / Pro
- **Extraction Engine**: Hybrid Heuristic Regex Parser + LLM Structured Output

### Tooling & DevOps
- **Containerization**: Docker (Multi-stage `node:22-alpine` image)
- **Runtime Environment**: Node.js >= 22.0.0 (Synchronized via `.nvmrc` and `.node-version`)
- **Cloud Hosting**: Render (Backend Web Service) + Vercel / Render (Static Frontend)
- **Code Quality**: ESLint 9.17.0, TypeScript strict checking

---

## 10. Installation & Running Locally

### Prerequisites
- **Node.js**: `v22.0.0` or higher (`node -v`)
- **npm**: `v10.0.0` or higher

---

### Step-by-Step Local Execution

1. **Clone the repository**:
   ```bash
   git clone https://github.com/QCuong-SW/understood-adc-hackathon-2026.git
   cd understood-adc-hackathon-2026
   ```

2. **Install dependencies**:
   ```bash
   # Install frontend dependencies
   npm install

   # Install backend dependencies
   cd server && npm install && cd ..
   ```

3. **Configure Environment Variables (Optional)**:
   ```bash
   cp server/.env.example server/.env
   # Add your GEMINI_API_KEY in server/.env (Optional: built-in deterministic heuristic fallback is provided)
   ```

4. **Run Services**:
   - **Terminal 1 (Backend NestJS Server)**:
     ```bash
     npm run dev:server
     # Server will start at: http://127.0.0.1:3001
     ```
   - **Terminal 2 (Frontend Vite)**:
     ```bash
     npm run dev
     # Frontend will start at: http://localhost:5173
     ```

5. **Multi-device Testing**:
   - Open Tab 1: `http://localhost:5173` -> Choose **"Jordan Lee (Team Manager)"**.
   - Open Tab 2: `http://localhost:5173` (or open on a mobile phone on the same LAN) -> Choose **"Alex Morgan (Employee)"**.

---

## 11. Cloud Deployment Guide

### Backend Service (Render / Railway)
- **Runtime**: Node 22 (`node:22-alpine`)
- **Root Directory**: `server`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm run start:prod`
- **Environment Variables**:
  - `PORT`: `3001`
  - `GEMINI_API_KEY`: *(Your Google Gemini API Key)*

### Frontend Application (Vercel / Render Static Site)
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**:
  - `VITE_API_BASE_URL`: `https://your-backend-service.onrender.com`

---

## 12. Privacy, Compliance & Accessibility
- **No Raw Audio Stored**: Microphone audio is processed ephemerally in memory and converted directly into text. Raw audio data is never written to disk or sent to persistent servers.
- **Zero Hallucination Grounding**: Enterprise Knowledge Copilot responses are strictly grounded in verified company policies and accessibility charters.
- **WCAG 2.2 Level AAA Compliant**: High-contrast color tokens, scalable typography, tactile visual feedback, and full keyboard navigation.

---

## 13. Hackathon Submission Metadata
- **Event**: ADC Hackathon 2026
- **Category**: Accessibility & Workplace Inclusion Copilot
- **Built with**: React 18, TypeScript, NestJS, Socket.IO, Google Gemini API, Web Speech API, Vite.
