import { createContext, useContext } from "react";

export type Locale = "en" | "es";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.myPerformance": "My Performance",
    "nav.uploadCalls": "Upload Calls",
    "nav.transcripts": "Transcripts",
    "nav.search": "Search",
    "nav.sentiment": "Sentiment",
    "nav.performance": "Performance",
    "nav.reports": "Reports",
    "nav.insights": "Insights",
    "nav.teamAnalytics": "Team Analytics",
    "nav.agentCompare": "Agent Compare",
    "nav.heatmap": "Call Heatmap",
    "nav.clusters": "Call Clusters",
    "nav.employees": "Employees",
    "nav.coaching": "Coaching",
    "nav.admin": "Administration",
    "nav.promptTemplates": "Prompt Templates",
    "nav.modelTesting": "Model Testing",
    "nav.spendTracking": "Spend Tracking",
    "nav.security": "Security",

    // Section headers
    "section.analytics": "Analytics",
    "section.management": "Management",
    "section.admin": "Admin",

    // Common actions
    "action.upload": "Upload",
    "action.uploadAll": "Upload All",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.delete": "Delete",
    "action.search": "Search",
    "action.filter": "Filter",
    "action.export": "Export",
    "action.edit": "Edit",
    "action.close": "Close",
    "action.submit": "Submit",
    "action.signOut": "Sign out",
    "action.login": "Login",

    // Status labels
    "status.pending": "Pending",
    "status.processing": "Processing",
    "status.completed": "Completed",
    "status.failed": "Failed",
    "status.uploading": "Uploading",
    "status.transcribing": "Transcribing",
    "status.analyzing": "Analyzing",
    "status.awaitingAnalysis": "Awaiting Analysis",

    // Form labels
    "form.callType": "Call type",
    "form.assignToAgent": "Assign to agent",
    "form.language": "Language",
    "form.processingMode": "Processing mode",
    "form.employee": "Employee",
    "form.dateRange": "Date range",
    "form.selectEmployee": "Select employee",

    // Upload page
    "upload.title": "Upload Call Recordings",
    "upload.subtitle": "Upload audio files to analyze with AssemblyAI for transcription and sentiment analysis",
    "upload.dragDrop": "Drag & drop files here, or click to select files",
    "upload.dropHere": "Drop files here...",
    "upload.filesToUpload": "Files to Upload",
    "upload.complete": "Complete",
    "upload.inProgress": "in progress",
    "upload.instructions": "Upload Instructions",
    "upload.supportedFormats": "Supported Formats",
    "upload.processingFeatures": "Processing Features",
    "upload.processingNote": "Processing typically takes 2-3 minutes per audio file. You'll receive real-time updates on the transcription status.",
    "upload.applyToAll": "Apply to all pending files:",
    "upload.setAllCallTypes": "Set all call types",
    "upload.setAllAgents": "Set all agents",
    "upload.unassigned": "Unassigned (auto-detect)",
    "upload.batchLimit": "Batch limit",

    // Language options
    "lang.auto": "Auto-detect",
    "lang.en": "English",
    "lang.es": "Spanish",

    // Processing modes
    "mode.auto": "Auto (server schedule)",
    "mode.immediate": "Immediate (real-time)",
    "mode.batch": "Batch (50% savings)",

    // Dashboard
    "dashboard.title": "Call Analysis Dashboard",
    "dashboard.subtitle": "Monitor performance and sentiment across all customer interactions",
    "dashboard.searchCalls": "Search calls...",
    "dashboard.uploadCall": "Upload Call",
    "dashboard.needAttention": "Need Attention",
    "dashboard.exceptionalCalls": "Exceptional Calls",
    "dashboard.totalCalls": "Total Calls",
    "dashboard.avgScore": "Average Score",
    "dashboard.positiveSentiment": "Positive Sentiment",
    "dashboard.callsProcessed": "Calls Processed",

    // Metrics
    "metrics.totalCalls": "Total Calls",
    "metrics.avgSentiment": "Avg Sentiment",
    "metrics.transcriptionTime": "Transcription Time",
    "metrics.teamScore": "Team Score",
    "metrics.analyzed": "analyzed",
    "metrics.avgAcrossCalls": "Avg across calls",
    "metrics.avgPerCall": "Avg per call",
    "metrics.avgPerformance": "Avg performance",
    "metrics.failedToLoad": "Failed to load metrics",

    // Sentiment
    "sentiment.title": "Sentiment Analysis",
    "sentiment.positive": "Positive",
    "sentiment.neutral": "Neutral",
    "sentiment.negative": "Negative",

    // Transcript viewer
    "transcript.callTranscript": "Call Transcript",
    "transcript.export": "Export",
    "transcript.download": "Download",
    "transcript.playAudio": "Play Audio",
    "transcript.pause": "Pause",
    "transcript.callSummary": "Call Summary",
    "transcript.keyPoints": "Key Points",
    "transcript.keyTopics": "Key Topics",
    "transcript.actionItems": "Action Items",
    "transcript.aiFeedback": "AI Feedback",
    "transcript.strengths": "Strengths",
    "transcript.suggestions": "Suggestions",
    "transcript.flags": "Flags",
    "transcript.callParty": "Call Party",
    "transcript.aiConfidence": "AI Confidence",
    "transcript.needsReview": "Needs Review",
    "transcript.manuallyEdited": "Manually Edited",
    "transcript.processing": "Transcript is being processed...",
    "transcript.notAvailable": "Transcript not available",
    "transcript.callNotFound": "Call not found",

    // Calls table
    "table.date": "Date",
    "table.duration": "Duration",
    "table.score": "Score",
    "table.agent": "Agent",
    "table.status": "Status",
    "table.actions": "Actions",

    // Coaching
    "coaching.title": "Coaching & Action Plans",

    // Reports
    "reports.overallReport": "Overall Report",
    "reports.employeeReport": "Employee Report",

    // Misc
    "misc.notifications": "Notifications",
    "misc.noNotifications": "No notifications yet",
    "misc.markAllRead": "Mark all read",
    "misc.clear": "Clear",
    "misc.quickViewAgent": "Quick View Agent",
    "misc.jumpToAgentProfile": "Jump to agent profile...",
    "misc.proDashboard": "Pro Dashboard",
    "misc.keyboardShortcuts": "Keyboard Shortcuts",
  },
  es: {
    // Navigation
    "nav.dashboard": "Panel",
    "nav.myPerformance": "Mi Rendimiento",
    "nav.uploadCalls": "Subir Llamadas",
    "nav.transcripts": "Transcripciones",
    "nav.search": "Buscar",
    "nav.sentiment": "Sentimiento",
    "nav.performance": "Rendimiento",
    "nav.reports": "Informes",
    "nav.insights": "Perspectivas",
    "nav.teamAnalytics": "Analisis de Equipo",
    "nav.agentCompare": "Comparar Agentes",
    "nav.heatmap": "Mapa de Calor",
    "nav.clusters": "Agrupaciones",
    "nav.employees": "Empleados",
    "nav.coaching": "Coaching",
    "nav.admin": "Administracion",
    "nav.promptTemplates": "Plantillas de Prompts",
    "nav.modelTesting": "Pruebas de Modelo",
    "nav.spendTracking": "Seguimiento de Gastos",
    "nav.security": "Seguridad",

    // Section headers
    "section.analytics": "Analitica",
    "section.management": "Gestion",
    "section.admin": "Admin",

    // Common actions
    "action.upload": "Subir",
    "action.uploadAll": "Subir Todos",
    "action.save": "Guardar",
    "action.cancel": "Cancelar",
    "action.delete": "Eliminar",
    "action.search": "Buscar",
    "action.filter": "Filtrar",
    "action.export": "Exportar",
    "action.edit": "Editar",
    "action.close": "Cerrar",
    "action.submit": "Enviar",
    "action.signOut": "Cerrar sesion",
    "action.login": "Iniciar sesion",

    // Status labels
    "status.pending": "Pendiente",
    "status.processing": "Procesando",
    "status.completed": "Completado",
    "status.failed": "Fallido",
    "status.uploading": "Subiendo",
    "status.transcribing": "Transcribiendo",
    "status.analyzing": "Analizando",
    "status.awaitingAnalysis": "Esperando Analisis",

    // Form labels
    "form.callType": "Tipo de llamada",
    "form.assignToAgent": "Asignar a agente",
    "form.language": "Idioma",
    "form.processingMode": "Modo de procesamiento",
    "form.employee": "Empleado",
    "form.dateRange": "Rango de fechas",
    "form.selectEmployee": "Seleccionar empleado",

    // Upload page
    "upload.title": "Subir Grabaciones de Llamadas",
    "upload.subtitle": "Suba archivos de audio para analizar con AssemblyAI para transcripcion y analisis de sentimiento",
    "upload.dragDrop": "Arrastre y suelte archivos aqui, o haga clic para seleccionar",
    "upload.dropHere": "Suelte los archivos aqui...",
    "upload.filesToUpload": "Archivos para Subir",
    "upload.complete": "Completo",
    "upload.inProgress": "en progreso",
    "upload.instructions": "Instrucciones de Carga",
    "upload.supportedFormats": "Formatos Soportados",
    "upload.processingFeatures": "Funciones de Procesamiento",
    "upload.processingNote": "El procesamiento normalmente toma 2-3 minutos por archivo de audio. Recibira actualizaciones en tiempo real sobre el estado de la transcripcion.",
    "upload.applyToAll": "Aplicar a todos los archivos pendientes:",
    "upload.setAllCallTypes": "Establecer todos los tipos",
    "upload.setAllAgents": "Establecer todos los agentes",
    "upload.unassigned": "Sin asignar (auto-detectar)",
    "upload.batchLimit": "Limite de lote",

    // Language options
    "lang.auto": "Auto-detectar",
    "lang.en": "Ingles",
    "lang.es": "Espanol",

    // Processing modes
    "mode.auto": "Auto (programacion del servidor)",
    "mode.immediate": "Inmediato (tiempo real)",
    "mode.batch": "Lote (50% ahorro)",

    // Dashboard
    "dashboard.title": "Panel de Analisis de Llamadas",
    "dashboard.subtitle": "Monitorear rendimiento y sentimiento en todas las interacciones con clientes",
    "dashboard.searchCalls": "Buscar llamadas...",
    "dashboard.uploadCall": "Subir Llamada",
    "dashboard.needAttention": "Necesitan Atencion",
    "dashboard.exceptionalCalls": "Llamadas Excepcionales",
    "dashboard.totalCalls": "Total de Llamadas",
    "dashboard.avgScore": "Puntuacion Promedio",
    "dashboard.positiveSentiment": "Sentimiento Positivo",
    "dashboard.callsProcessed": "Llamadas Procesadas",

    // Metrics
    "metrics.totalCalls": "Total de Llamadas",
    "metrics.avgSentiment": "Sentimiento Promedio",
    "metrics.transcriptionTime": "Tiempo de Transcripcion",
    "metrics.teamScore": "Puntuacion del Equipo",
    "metrics.analyzed": "analizadas",
    "metrics.avgAcrossCalls": "Promedio entre llamadas",
    "metrics.avgPerCall": "Promedio por llamada",
    "metrics.avgPerformance": "Rendimiento promedio",
    "metrics.failedToLoad": "Error al cargar metricas",

    // Sentiment
    "sentiment.title": "Analisis de Sentimiento",
    "sentiment.positive": "Positivo",
    "sentiment.neutral": "Neutral",
    "sentiment.negative": "Negativo",

    // Transcript viewer
    "transcript.callTranscript": "Transcripcion de Llamada",
    "transcript.export": "Exportar",
    "transcript.download": "Descargar",
    "transcript.playAudio": "Reproducir Audio",
    "transcript.pause": "Pausar",
    "transcript.callSummary": "Resumen de Llamada",
    "transcript.keyPoints": "Puntos Clave",
    "transcript.keyTopics": "Temas Clave",
    "transcript.actionItems": "Elementos de Accion",
    "transcript.aiFeedback": "Retroalimentacion de IA",
    "transcript.strengths": "Fortalezas",
    "transcript.suggestions": "Sugerencias",
    "transcript.flags": "Alertas",
    "transcript.callParty": "Parte de la Llamada",
    "transcript.aiConfidence": "Confianza de IA",
    "transcript.needsReview": "Necesita Revision",
    "transcript.manuallyEdited": "Editado Manualmente",
    "transcript.processing": "La transcripcion esta siendo procesada...",
    "transcript.notAvailable": "Transcripcion no disponible",
    "transcript.callNotFound": "Llamada no encontrada",

    // Calls table
    "table.date": "Fecha",
    "table.duration": "Duracion",
    "table.score": "Puntuacion",
    "table.agent": "Agente",
    "table.status": "Estado",
    "table.actions": "Acciones",

    // Coaching
    "coaching.title": "Coaching y Planes de Accion",

    // Reports
    "reports.overallReport": "Informe General",
    "reports.employeeReport": "Informe de Empleado",

    // Misc
    "misc.notifications": "Notificaciones",
    "misc.noNotifications": "Sin notificaciones aun",
    "misc.markAllRead": "Marcar todo leido",
    "misc.clear": "Limpiar",
    "misc.quickViewAgent": "Vista Rapida de Agente",
    "misc.jumpToAgentProfile": "Ir al perfil del agente...",
    "misc.proDashboard": "Panel Pro",
    "misc.keyboardShortcuts": "Atajos de Teclado",
  },
};

export function getTranslation(locale: Locale, key: string): string {
  return translations[locale]?.[key] || translations.en[key] || key;
}

export function getSavedLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem("locale");
  if (saved === "es") return "es";
  return "en";
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem("locale", locale);
}

export const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key: string) => key,
});

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}
