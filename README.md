# Understood — Accessible Workplace Communication Copilot

> **ADC Hackathon 2026** — *Empowering deaf and hard-of-hearing professionals with real-time accessible communication repair, live change diffs, quiet feedback signals, and autonomous AI task consensus.*

---

## Team Information
- **Project Name**: Understood — Accessible Workplace Communication Copilot
- **Team / Authors**: ADC Hackathon 2026 Team (QCuong-SW & Boop Team)
- **Repository**: [https://github.com/QCuong-SW/understood-adc-hackathon-2026](https://github.com/QCuong-SW/understood-adc-hackathon-2026)
- **Target Audience**: Deaf & Hard-of-Hearing (DHH) Employees, Team Leads, People Operations & Inclusive Organizations.

---

## The Problem
In fast-paced enterprise meetings and daily 1:1 syncs, deaf and hard-of-hearing team members constantly face critical barriers:
1. **Lip-reading fatigue & lost context**: Lip reading captures only 30–40% of spoken English/Vietnamese, leading to extreme cognitive exhaustion.
2. **Missed verbal change-of-plans**: Managers frequently modify deadlines or requirements mid-sentence (e.g., *"Actually, let's move the deadline from Friday to Thursday at 4 PM"*). DHH employees often miss these subtle shifts.
3. **Hesitation to interrupt**: Employees are often reluctant to disrupt the meeting flow repeatedly to ask for spoken repetitions or clarifications.
4. **Information bottleneck**: Traditional tools force employees to wait for manual manager meeting minutes, causing delays and misaligned deliverables.

---

## The Solution
**Understood** is a bidirectional, closed-loop workplace communication copilot that guarantees 100% shared understanding:
- **Two-Way Live Speech-to-Text (<200ms latency)**: Bidirectional captioning with instant Web Speech API and WebSocket synchronization.
- **AI Live Diff & Change Detection**: Automatically detects spoken requirement modifications and displays clear visual before/after diffs.
- **1-Tap Non-Verbal Quick Signals**: One-touch signals (`Understood`, `Slow Down`, `Repeat`, `Clarify`) with prominent ambient glowing callouts on the manager's screen.
- **Self-Service AI Summarization & Task Extraction**: Deaf employees can independently extract meeting recaps, key decisions, and action items at any point without waiting for manager gatekeeping.
- **Traceable Mutual Agreement & Export**: Both parties confirm matching details with full revision tracking, exported directly to Markdown.
- **Enterprise AI Knowledge Copilot (Grounded RAG)**: Instant, zero-hallucination answers to workplace accommodations and company policies.

---

## Detailed Demo Flow (Multi-Device Speedrun Flow)

### Preparation
- **Device 1 (Laptop/Desktop)**: Open web app -> Select role **"Jordan Lee (Team Manager)"**.
- **Device 2 (Laptop/Mobile)**: Open web app -> Select role **"Alex Morgan (Employee)"**.

---

### Step-by-Step Flow (1m30s – 2m)

#### 1. Initialize 1:1 Live Session
- **Manager**: Click **"Start conversation with Alex"** -> Screen transitions to shared live session.
- **Employee**: Click **"Join live session"** -> Both devices connect in real-time via WebSockets (Room: `ADC-DEMO`).

#### 2. Live Speech Recognition & AI Live Diff (Deadline Shift Detection)
- **Manager**: Turns on microphone (or sends message): *"Actually, let's move the deadline to Thursday at 4 PM and include the accessibility flow."*
- **Employee**: 
  - Live captions appear instantly (<200ms latency).
  - **AI Live Diff** card highlights the change:
    - <s>Friday</s> -> **Thursday, 4:00 PM** (With *Deadline Updated* badge).
  - Ensures deaf employees never miss mid-sentence requirement shifts.

#### 3. 1-Tap Non-Verbal Quick Signals
- **Employee**: Clicks the hand icon in the bottom dock to open quick feedback options:
  - Clicks **"Slow down"**, **"Understood"**, or **"Clarify"**.
- **Manager**: The manager's screen immediately renders a standout **Ambient Glowing Banner**:
  - *“Alex requested: Please slow down speaking pace”* -> The manager adjusts speech pace without interrupting conversation flow.

#### 4. Self-Service AI Summarization & Autonomous Task Acceptance
- **Employee**: Clicks **"AI Summarize & Extract Tasks"** in the banner or action dock.
- **Instant Display on Employee Screen**:
  - **AI Conversation Summary**: Concise 2–3 sentence executive recap.
  - **Key Decisions**: Bullet points of mutually agreed milestones.
  - **Extracted Task Card**: *Task: Complete the first prototype · Assignee: Alex Morgan · Deadline: Thursday, 4:00 PM · Requirement: Include the accessibility flow*.
- **Employee**: Reviews and clicks **"Understood & accept"** -> Confirms autonomously without waiting for manager gatekeeping.

#### 5. Two-Way Mutual Consensus & Markdown Export
- Task status transitions to: **"Mutually confirmed · Traceable & synchronized (Rev 1)"**.
- Navigate to **Tasks** tab -> Click **"Export action items (.md)"** to download the full markdown report and audit trail.

---

## Codebase Structure

```
understood-adc-hackathon-2026/
├── public/                      # Static brand assets
│   ├── favicon.png              # App favicon
│   ├── logo.png                 # Main Understood logo
│   └── app-icon.png             # Mobile PWA apple touch icon
├── src/                         # Frontend Application (React + TypeScript + Vite)
│   ├── assets/                  # Frontend images & logo imports
│   ├── App.tsx                  # Core application shell, SessionView, TaskDetail, KnowledgeView, Settings
│   ├── main.tsx                 # React DOM root entrypoint
│   └── styles.css               # Design system, accessible color contrast tokens & responsive layouts
├── server/                      # Backend Service (NestJS 11 + Socket.IO + Persistent Store)
│   ├── src/
│   │   ├── ai/                  # AI Services (Gemini 2.5 API integration, prompt templates, summarize engine)
│   │   │   ├── ai.controller.ts # REST endpoints for AI summarization & task extraction
│   │   │   ├── ai.service.ts    # Rule-based heuristics & Gemini LLM extraction pipeline
│   │   │   └── gemini.service.ts# Direct Google GenAI SDK wrapper
│   │   ├── database/            # Resilient database service
│   │   │   └── database.service.ts # Zero-native-dependency persistent JSON store (data/understood_store.json)
│   │   ├── knowledge/           # Enterprise AI Knowledge Copilot
│   │   │   ├── knowledge.controller.ts # POST /api/v1/knowledge/query
│   │   │   └── knowledge.service.ts    # Grounded RAG search over accessibility charters & handbooks
│   │   ├── sessions/            # Real-time WebSocket Gateway & REST APIs
│   │   │   ├── sessions.controller.ts  # Session status & summaries
│   │   │   └── sessions.gateway.ts     # Socket.IO Gateway for instant 1:1 cross-device sync
│   │   ├── tasks/               # Task management endpoints
│   │   │   └── tasks.controller.ts     # CRUD for confirmed tasks & action items
│   │   ├── app.module.ts        # Root NestJS module
│   │   └── main.ts              # Server bootstrap on PORT (default: 3001)
│   ├── data/                    # Persistent storage directory
│   ├── Dockerfile               # Production container definition (Node 22-alpine)
│   └── package.json             # Server dependencies & scripts
├── index.html                   # HTML5 Entrypoint with proper accessibility meta tags
├── package.json                 # Monorepo root scripts & frontend dependencies
├── render.yaml                  # Infrastructure-as-Code for Render Cloud deployment
├── tsconfig.json                # TypeScript compiler configuration
└── vite.config.ts               # Vite build & development proxy setup
```

---

## Installation & Running Locally

### Prerequisites
- **Node.js**: `v22.0.0` or later (`node -v`)
- **npm**: `v10.0.0` or later

---

### Step-by-Step Setup

1. **Clone repository**:
   ```bash
   git clone https://github.com/QCuong-SW/understood-adc-hackathon-2026.git
   cd understood-adc-hackathon-2026
   ```

2. **Install dependencies**:
   ```bash
   # Install frontend dependencies
   npm install

   # Install server dependencies
   cd server && npm install && cd ..
   ```

3. **Configure environment variables (Optional)**:
   ```bash
   cp server/.env.example server/.env
   # Set GEMINI_API_KEY in server/.env (Optional: app provides built-in heuristics fallback if key is omitted)
   ```

4. **Launch services**:
   - **Terminal 1 (Backend NestJS Server)**:
     ```bash
     npm run dev:server
     # Server runs on: http://127.0.0.1:3001 (Socket.IO + REST APIs)
     ```
   - **Terminal 2 (Frontend Vite)**:
     ```bash
     npm run dev
     # Frontend runs on: http://localhost:5173
     ```

5. **Multi-device / multi-tab testing**:
   - Open Tab 1: `http://localhost:5173` -> Choose **"Jordan Lee (Team Manager)"**.
   - Open Tab 2: `http://localhost:5173` (or open on mobile on same LAN) -> Choose **"Alex Morgan (Employee)"**.

---

## Deployment Guide

### 1. Backend Service (Render / Railway)
- **Runtime**: Node 22 (`node:22-alpine`)
- **Root Directory**: `server`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm run start:prod`
- **Environment Variables**:
  - `PORT`: `3001`
  - `GEMINI_API_KEY`: *(Your Google Gemini API Key)*

### 2. Frontend Application (Vercel / Render Static Site)
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**:
  - `VITE_API_BASE_URL`: `https://your-backend-service.onrender.com`

---

## Privacy & Compliance
- **No Raw Audio Stored**: Voice recognition processes ephemeral streams directly into text; raw microphone audio is never persisted.
- **Zero Hallucination Grounding**: Enterprise Knowledge Copilot restricts answers strictly to verified company handbooks and accessibility policies.
- **WCAG 2.2 Level AAA Compliant**: High-contrast color tokens, scalable typography, tactile visual feedback, and full keyboard navigation.

---

## Hackathon Submission Metadata
- **Event**: ADC Hackathon 2026
- **Category**: Accessibility & Workplace Inclusion Copilot
- **Built with**: React 18, TypeScript, NestJS, Socket.IO, Google Gemini API, Web Speech API, Vite.
