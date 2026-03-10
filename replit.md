# Overview

CallAnalyzer is a HIPAA-compliant call analysis platform for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment analysis, and coaching insights.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The client-side is built using React with TypeScript and follows a modern component-based architecture:

- **UI Framework**: React 18 with TypeScript for type safety
- **Styling**: Tailwind CSS with a custom design system based on shadcn/ui components
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state management and caching
- **Build Tool**: Vite for fast development and optimized builds
- **Charts**: Recharts for data visualization

The frontend is organized into logical directories:
- `client/src/pages/` - Route components for different application views
- `client/src/components/` - Reusable UI components organized by feature (ui/, tables/, transcripts/, dashboard/)
- `client/src/hooks/` - Custom React hooks for shared logic
- `client/src/lib/` - Utility functions and configuration

## Backend Architecture

The server uses Express.js with TypeScript in an ESM configuration:

- **Framework**: Express.js for HTTP server and API routing
- **AI Services**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription
- **Storage**: AWS S3 (`ums-call-archive` bucket) for all persistent data — no traditional database
- **File Upload**: Multer middleware for handling audio file uploads
- **Real-time**: WebSocket for live processing status updates
- **Auth**: Session-based with bcrypt, role-based access control (viewer/manager/admin)

The backend follows a service-oriented architecture with clear separation of concerns:
- `server/routes.ts` - Route handlers manage HTTP requests/responses and the audio processing pipeline
- `server/storage.ts` - Storage abstraction layer (supports S3, GCS, or in-memory backends)
- `server/services/` - External API integrations (AssemblyAI, Bedrock, S3, WebSocket, audit logging)
- `server/auth.ts` - Authentication middleware and session management

## Data Storage Solutions

**AWS S3**: All data is stored as JSON objects in S3 (bucket: `ums-call-archive`):
- `employees/` - Staff members who handle calls
- `calls/` - Call metadata and processing status
- `transcripts/` - Speech-to-text results with timestamps
- `sentiment/` - AI-generated sentiment scores and segments
- `analysis/` - Performance metrics, scoring, and AI feedback
- `coaching/` - Coaching session records
- `prompt-templates/` - Custom AI prompt templates per call category
- `audio/` - Uploaded call recordings

**No traditional database** — the app uses S3 as a document store. Falls back to in-memory storage if no cloud credentials are configured (data lost on restart).

## Authentication and Authorization

Session-based authentication with bcrypt password hashing. Role hierarchy: admin > manager > viewer.
- Users configured via `AUTH_USERS` environment variable
- 15-minute idle timeout + 8-hour absolute session max
- Rate limiting: 5 login attempts per 15 minutes per IP
- Access request system for new users (admin approval required)

# External Dependencies

## Third-Party Services

**AssemblyAI API**: Speech processing capabilities:
- Speech-to-text transcription with word-level timestamps
- Sentiment analysis on transcript segments
- Speaker identification for multi-party calls

**AWS Bedrock**: AI analysis via Claude Sonnet:
- Performance scoring with sub-scores
- Compliance checking and flag detection
- Coaching feedback (strengths and suggestions)
- Agent name detection for auto-assignment

**AWS S3**: Primary data storage for all application data.

## UI Component Library

**shadcn/ui + Radix UI**: Comprehensive component system:
- Accessible UI primitives from Radix UI
- Styled with Tailwind CSS for consistent design
- Form handling with React Hook Form and Zod validation
- Chart components using Recharts for data visualization

## Build and Deployment

**Build Pipeline**: Vite for frontend bundling and esbuild for server compilation:
- Fast hot module replacement in development
- Optimized production builds with code splitting
- TypeScript compilation and type checking

**Hosting**: Render.com (primary), EC2 with pm2 (secondary/testing)

**Key Design Decision**: No AWS SDK — both S3 and Bedrock use raw REST APIs with manual SigV4 signing to reduce bundle size.
