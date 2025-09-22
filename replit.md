# Overview

CallAnalyzer is a comprehensive call analysis platform that transcribes audio recordings and provides AI-powered insights including sentiment analysis, performance scoring, and detailed transcript review. The application integrates with AssemblyAI for speech-to-text processing and uses a PostgreSQL database to store call data, transcripts, and analysis results.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The client-side is built using React with TypeScript and follows a modern component-based architecture:

- **UI Framework**: React with TypeScript for type safety
- **Styling**: Tailwind CSS with a custom design system based on shadcn/ui components
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state management and caching
- **Build Tool**: Vite for fast development and optimized builds

The frontend is organized into logical directories:
- `/pages` - Route components for different application views
- `/components` - Reusable UI components organized by feature
- `/hooks` - Custom React hooks for shared logic
- `/lib` - Utility functions and configuration

## Backend Architecture

The server uses Express.js with TypeScript in an ESM configuration:

- **Framework**: Express.js for HTTP server and API routing
- **Database**: PostgreSQL with Neon serverless driver
- **ORM**: Drizzle ORM for type-safe database operations
- **File Upload**: Multer middleware for handling audio file uploads
- **API Integration**: AssemblyAI service for speech transcription and analysis

The backend follows a service-oriented architecture with clear separation of concerns:
- Route handlers manage HTTP requests/responses
- Storage layer abstracts database operations
- Service layer handles external API integrations

## Data Storage Solutions

**Database Schema**: PostgreSQL with the following core entities:
- `employees` - Staff members who handle calls
- `calls` - Audio file metadata and processing status
- `transcripts` - Speech-to-text results with confidence scores
- `sentiment_analysis` - AI-generated sentiment scores and segments
- `call_analysis` - Performance metrics and keyword extraction

**File Storage**: Audio files are stored locally in an `uploads/` directory with metadata tracked in the database.

## Authentication and Authorization

The application currently uses a simple session-based approach without complex authentication. The architecture supports future implementation of user authentication and role-based access control.

# External Dependencies

## Third-Party Services

**AssemblyAI API**: Primary integration for speech processing capabilities:
- Speech-to-text transcription with word-level timestamps
- Real-time sentiment analysis on transcript segments
- Topic detection and keyword extraction
- Speaker identification for multi-party calls

## Database

**Neon PostgreSQL**: Serverless PostgreSQL database hosting:
- Managed database service with automatic scaling
- Connection pooling and edge optimization
- Backup and disaster recovery handled by provider

## UI Component Library

**shadcn/ui + Radix UI**: Comprehensive component system:
- Accessible UI primitives from Radix UI
- Styled with Tailwind CSS for consistent design
- Form handling with React Hook Form and Zod validation
- Chart components using Recharts for data visualization

## Development Tools

**Replit Integration**: Development environment optimizations:
- Custom Vite plugins for Replit-specific features
- Error overlay and development banner
- Cartographer plugin for enhanced debugging

## Build and Deployment

**Build Pipeline**: Vite for frontend bundling and esbuild for server compilation:
- Fast hot module replacement in development
- Optimized production builds with code splitting
- TypeScript compilation and type checking