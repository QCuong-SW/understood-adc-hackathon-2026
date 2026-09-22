# Understood — Accessible Workplace Communication Copilot

Hackathon MVP for a closed-loop communication repair experience. The demo connects an employee and a manager across browser tabs, surfaces communication barriers, supports clarification, and requires mutual confirmation before a task is treated as confirmed.

## Run locally

```bash
npm install
npm run dev
```

For real-time sync through the NestJS server, run this in a second terminal:

```bash
cd server
npm install
npm run start:dev
```

Open two tabs. Choose **Manager** in one and **Employee** in the other. Both tabs share demo state through browser storage and `BroadcastChannel`.

## Demo flow

1. Manager starts a live session.
2. Advance the demo until the changed deadline appears.
3. Employee requests **Clarify deadline**.
4. Manager advances to the possible task, reviews it, then confirms.
5. Employee selects **Understood & accept**.
6. The task appears as mutually confirmed.

## Current scope

- Responsive React/TypeScript frontend
- Employee and manager modes
- Simulated live caption and barrier events
- Cross-tab real-time demo state through Socket.IO, with browser fallback
- Manager task review and confirmation
- Employee acknowledgement
- Task list, knowledge and preferences views

The NestJS server exposes `GET /api/v1/health`, session endpoints, and a Socket.IO room named `session:ADC-DEMO`. The browser fallback keeps the demo usable if the server is unavailable.

## AI, voice, and database

- SQLite data is created automatically at `server/data/understood.sqlite`.
- Copy `server/.env.example` to `server/.env` and set `GEMINI_API_KEY` for AI and Live voice.
- The browser receives only a short-lived Gemini Live token. The API key stays on the server.
- If the AI API is unavailable, company answers use deterministic approved-policy matches and remain cited.
- In a live session, click **Use mic** and allow microphone access to start WebRTC transcription.
