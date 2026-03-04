# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant call analysis tool for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription
- **Storage**: AWS S3 (`ums-call-archive` bucket) — employees, calls, transcripts, analyses, audio, coaching, prompt templates
- **Auth**: Session-based with bcrypt, role-based (viewer/manager/admin)
- **Hosting**: Render.com

## Commands
```bash
npm run dev          # Dev server (tsx watch)
npm run build        # Vite frontend + esbuild backend → dist/
npm run start        # Production server
npm run check        # TypeScript type check
npm run test         # Run tests
npx vite build       # Frontend-only build (useful for quick verification)
```

## Architecture

### Key Directories
```
client/src/pages/        # Route pages (dashboard, transcripts, employees, etc.)
client/src/components/   # UI components (ui/ = shadcn, tables/, transcripts/, dashboard/)
server/services/         # AI providers, S3/GCS clients, AssemblyAI, WebSocket
server/routes.ts         # All API routes + audio processing pipeline
server/storage.ts        # Storage abstraction (memory, S3, GCS backends)
server/auth.ts           # Authentication middleware
shared/schema.ts         # Zod schemas shared between client/server
```

### Audio Processing Pipeline (server/routes.ts → processAudioFile)
1. Upload audio to S3
2. Send to AssemblyAI for transcription (with polling)
3. Load custom prompt template by call category (if configured)
4. Send transcript to Bedrock for AI analysis
5. Process results: normalize data, compute confidence scores, detect agent name, set flags
6. Store transcript, sentiment, and analysis to S3
7. Auto-assign call to employee if agent name detected

### AI Analysis Data Flow
- Bedrock returns JSON with: summary, topics[], sentiment, performance_score, sub_scores, action_items[], feedback{strengths[], suggestions[]}, flags[], detected_agent_name
- `ai-provider.ts` builds the prompt (with custom template support) and parses JSON response
- `assemblyai.ts:processTranscriptData()` normalizes AI output into storage format
- **Important**: AI may return objects instead of strings in arrays — server normalizes with `normalizeStringArray()`, frontend has `toDisplayString()` safety

### Storage Backend Selection (server/storage.ts)
- `STORAGE_BACKEND=s3` or `S3_BUCKET` env var → S3
- `STORAGE_BACKEND=gcs` or GCS creds → Google Cloud Storage
- Otherwise → in-memory (non-persistent)

## Environment Variables
```
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (default: us-east-1)
AWS_SESSION_TOKEN (optional, for IAM roles)
S3_BUCKET (default: ums-call-archive)
BEDROCK_MODEL (default: us.anthropic.claude-sonnet-4-6)
ASSEMBLYAI_API_KEY
SESSION_SECRET
```

## Key Design Decisions
- **No AWS SDK**: Both S3 and Bedrock use raw REST APIs with manual SigV4 signing
- **Custom prompt templates**: Per-call-category evaluation criteria, required phrases, scoring weights
- **Dark mode**: Toggle in settings; chart text fixed via global CSS in index.css (.dark .recharts-*)
- **Hooks ordering**: All React hooks in transcript-viewer.tsx MUST be called before early returns (isLoading/!call guards)
- **HIPAA**: Audit logging, rate limiting, account lockout, CSP headers, session security

## Common Gotchas
- Bedrock AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` on server when rendering/storing AI data
- The same IAM user is shared across 3 projects (CallAnalyzer, RAG Tool, PMD Questionnaire) — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- The `useQuery` key format is `["/api/calls", callId]` — TanStack Query uses the key for caching
