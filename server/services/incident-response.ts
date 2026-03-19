/**
 * Formal Incident Response Plan (IRP)
 *
 * Implements HIPAA §164.308(a)(6) — Security Incident Procedures
 * and §164.308(a)(7) — Contingency Plan requirements.
 *
 * Provides a structured incident lifecycle beyond breach reporting:
 * - Incident declaration and classification
 * - Escalation procedures and contact management
 * - Response phase tracking (detect → contain → eradicate → recover → lessons learned)
 * - Timeline logging with actor attribution
 * - Post-incident review and action items
 */

import { logPhiAccess } from "./audit-log";
import { getPool } from "../db/pool";

// --- Types ---

export type IncidentSeverity = "P1-critical" | "P2-high" | "P3-medium" | "P4-low";

export type IncidentPhase =
  | "detection"
  | "triage"
  | "containment"
  | "eradication"
  | "recovery"
  | "post-incident"
  | "closed";

export type IncidentCategory =
  | "data_breach"
  | "unauthorized_access"
  | "malware"
  | "denial_of_service"
  | "insider_threat"
  | "system_compromise"
  | "data_loss"
  | "policy_violation"
  | "phishing"
  | "other";

export interface EscalationContact {
  name: string;
  role: string;
  email?: string;
  phone?: string;
  notifyAt: IncidentSeverity[];
}

export interface TimelineEntry {
  timestamp: string;
  phase: IncidentPhase;
  action: string;
  actor: string;
  automated: boolean;
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  dueDate?: string;
  status: "open" | "in_progress" | "completed";
  completedAt?: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  currentPhase: IncidentPhase;
  declaredAt: string;
  declaredBy: string;
  updatedAt: string;
  closedAt?: string;
  affectedSystems: string[];
  affectedUsers: number;
  containmentActions: string[];
  eradicationActions: string[];
  recoveryActions: string[];
  lessonsLearned?: string;
  timeline: TimelineEntry[];
  actionItems: ActionItem[];
  linkedBreachId?: string;
  phiInvolved: boolean;
}

// --- In-Memory Store ---

const incidents: Incident[] = [];

// --- Escalation Contacts ---

// Default escalation contacts — can be overridden via API
const escalationContacts: EscalationContact[] = [
  {
    name: "System Administrator",
    role: "IT Admin / Incident Commander",
    notifyAt: ["P1-critical", "P2-high", "P3-medium", "P4-low"],
  },
  {
    name: "HIPAA Privacy Officer",
    role: "Compliance",
    notifyAt: ["P1-critical", "P2-high"],
  },
  {
    name: "Management",
    role: "Executive Sponsor",
    notifyAt: ["P1-critical"],
  },
];

// --- Response Procedures (Static Reference) ---

export interface ResponseProcedure {
  phase: IncidentPhase;
  title: string;
  steps: string[];
  timeTarget: string;
}

export const RESPONSE_PROCEDURES: ResponseProcedure[] = [
  {
    phase: "detection",
    title: "Detection & Identification",
    steps: [
      "Verify the alert is a real incident (not a false positive)",
      "Identify affected systems, data types, and scope",
      "Determine if PHI is potentially involved",
      "Classify severity (P1-P4) based on impact and urgency",
      "Declare the incident and assign an incident commander",
    ],
    timeTarget: "Within 1 hour of alert",
  },
  {
    phase: "triage",
    title: "Triage & Escalation",
    steps: [
      "Notify escalation contacts based on severity level",
      "If PHI is involved, notify HIPAA Privacy Officer immediately",
      "Document initial findings in the incident timeline",
      "Assign initial response team members",
      "Establish communication channel for incident updates",
    ],
    timeTarget: "Within 2 hours of detection",
  },
  {
    phase: "containment",
    title: "Containment",
    steps: [
      "Isolate affected systems to prevent further damage",
      "Block suspicious IP addresses or user accounts",
      "Preserve evidence (logs, screenshots, affected data snapshots)",
      "Implement temporary controls (additional monitoring, restricted access)",
      "Verify containment is effective — confirm no ongoing unauthorized access",
    ],
    timeTarget: "Within 4 hours for P1/P2, 24 hours for P3/P4",
  },
  {
    phase: "eradication",
    title: "Eradication",
    steps: [
      "Identify root cause of the incident",
      "Remove malware, unauthorized access, or vulnerability",
      "Patch affected systems and update configurations",
      "Reset compromised credentials",
      "Verify eradication with security scan",
    ],
    timeTarget: "Within 24 hours for P1, 72 hours for P2/P3",
  },
  {
    phase: "recovery",
    title: "Recovery",
    steps: [
      "Restore affected systems from clean backups if needed",
      "Verify system integrity before returning to production",
      "Monitor closely for recurrence (enhanced logging, alerts)",
      "Gradually restore normal operations",
      "Confirm with stakeholders that systems are operational",
    ],
    timeTarget: "Within 48 hours for P1, 1 week for P2/P3",
  },
  {
    phase: "post-incident",
    title: "Post-Incident Review",
    steps: [
      "Conduct post-incident review meeting within 5 business days",
      "Document root cause analysis and contributing factors",
      "Identify process improvements and preventive measures",
      "Create action items with owners and due dates",
      "Update incident response plan based on lessons learned",
      "If PHI breach confirmed, follow HIPAA breach notification timeline (60 days)",
    ],
    timeTarget: "Within 5 business days of recovery",
  },
];

// --- Incident Management Functions ---

/**
 * Declare a new security incident.
 */
export async function declareIncident(params: {
  title: string;
  description: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  declaredBy: string;
  affectedSystems?: string[];
  phiInvolved?: boolean;
  linkedBreachId?: string;
}): Promise<Incident> {
  const now = new Date().toISOString();
  const incident: Incident = {
    id: `INC-${Date.now()}`,
    title: params.title,
    description: params.description,
    severity: params.severity,
    category: params.category,
    currentPhase: "detection",
    declaredAt: now,
    declaredBy: params.declaredBy,
    updatedAt: now,
    affectedSystems: params.affectedSystems || [],
    affectedUsers: 0,
    containmentActions: [],
    eradicationActions: [],
    recoveryActions: [],
    timeline: [
      {
        timestamp: now,
        phase: "detection",
        action: `Incident declared: ${params.title}`,
        actor: params.declaredBy,
        automated: false,
      },
    ],
    actionItems: [],
    linkedBreachId: params.linkedBreachId,
    phiInvolved: params.phiInvolved || false,
  };

  incidents.push(incident);

  // Persist to database if available
  await persistIncident(incident);

  // Log to audit trail
  logPhiAccess({
    timestamp: now,
    event: "incident_declared",
    username: params.declaredBy,
    resourceType: "incident",
    resourceId: incident.id,
    detail: `${params.severity} incident: ${params.title} (PHI: ${params.phiInvolved ? "yes" : "no"})`,
  });

  console.error(`[INCIDENT] ${params.severity} incident declared: ${incident.id} — ${params.title}`);

  return incident;
}

/**
 * Advance an incident to the next phase.
 */
export async function advanceIncidentPhase(
  incidentId: string,
  newPhase: IncidentPhase,
  action: string,
  actor: string
): Promise<Incident | null> {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  incident.currentPhase = newPhase;
  incident.updatedAt = now;
  if (newPhase === "closed") {
    incident.closedAt = now;
  }

  incident.timeline.push({
    timestamp: now,
    phase: newPhase,
    action,
    actor,
    automated: false,
  });

  await persistIncident(incident);

  logPhiAccess({
    timestamp: now,
    event: `incident_phase_${newPhase}`,
    username: actor,
    resourceType: "incident",
    resourceId: incidentId,
    detail: action,
  });

  return incident;
}

/**
 * Add a timeline entry to an incident.
 */
export async function addIncidentTimelineEntry(
  incidentId: string,
  action: string,
  actor: string,
  automated: boolean = false
): Promise<Incident | null> {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  incident.updatedAt = now;
  incident.timeline.push({
    timestamp: now,
    phase: incident.currentPhase,
    action,
    actor,
    automated,
  });

  await persistIncident(incident);
  return incident;
}

/**
 * Add an action item to an incident's post-incident review.
 */
export async function addActionItem(
  incidentId: string,
  description: string,
  assignee: string,
  dueDate?: string
): Promise<Incident | null> {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  incident.actionItems.push({
    id: `AI-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description,
    assignee,
    dueDate,
    status: "open",
  });
  incident.updatedAt = now;

  await persistIncident(incident);
  return incident;
}

/**
 * Update an action item status.
 */
export async function updateActionItem(
  incidentId: string,
  actionItemId: string,
  status: ActionItem["status"]
): Promise<Incident | null> {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const item = incident.actionItems.find((ai) => ai.id === actionItemId);
  if (!item) return null;

  item.status = status;
  if (status === "completed") {
    item.completedAt = new Date().toISOString();
  }
  incident.updatedAt = new Date().toISOString();

  await persistIncident(incident);
  return incident;
}

/**
 * Update incident details (containment/eradication/recovery actions, lessons learned, etc.).
 */
export async function updateIncidentDetails(
  incidentId: string,
  updates: Partial<Pick<Incident, "containmentActions" | "eradicationActions" | "recoveryActions" | "lessonsLearned" | "affectedUsers" | "severity">>,
  actor: string
): Promise<Incident | null> {
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const now = new Date().toISOString();
  Object.assign(incident, updates);
  incident.updatedAt = now;

  const changedFields = Object.keys(updates).join(", ");
  incident.timeline.push({
    timestamp: now,
    phase: incident.currentPhase,
    action: `Updated: ${changedFields}`,
    actor,
    automated: false,
  });

  await persistIncident(incident);
  return incident;
}

// --- Query Functions ---

export async function getAllIncidents(): Promise<Incident[]> {
  // Try loading from DB first
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query("SELECT * FROM incidents ORDER BY declared_at DESC");
      if (result.rows.length > 0) {
        return result.rows.map(rowToIncident);
      }
    } catch {
      // Table may not exist — fall through to in-memory
    }
  }
  return [...incidents].reverse();
}

export async function getIncident(id: string): Promise<Incident | null> {
  // Check in-memory first
  const memIncident = incidents.find((i) => i.id === id);
  if (memIncident) return memIncident;

  // Try DB
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query("SELECT * FROM incidents WHERE id = $1", [id]);
      if (result.rows.length > 0) return rowToIncident(result.rows[0]);
    } catch {
      // Table may not exist
    }
  }
  return null;
}

export function getEscalationContacts(): EscalationContact[] {
  return [...escalationContacts];
}

export function getResponseProcedures(): ResponseProcedure[] {
  return RESPONSE_PROCEDURES;
}

// --- Persistence ---

async function persistIncident(incident: Incident): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO incidents (id, title, description, severity, category, current_phase, declared_at, declared_by, updated_at, closed_at, affected_systems, affected_users, containment_actions, eradication_actions, recovery_actions, lessons_learned, timeline, action_items, linked_breach_id, phi_involved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (id) DO UPDATE SET
         current_phase = EXCLUDED.current_phase,
         updated_at = EXCLUDED.updated_at,
         closed_at = EXCLUDED.closed_at,
         affected_users = EXCLUDED.affected_users,
         severity = EXCLUDED.severity,
         containment_actions = EXCLUDED.containment_actions,
         eradication_actions = EXCLUDED.eradication_actions,
         recovery_actions = EXCLUDED.recovery_actions,
         lessons_learned = EXCLUDED.lessons_learned,
         timeline = EXCLUDED.timeline,
         action_items = EXCLUDED.action_items`,
      [
        incident.id, incident.title, incident.description, incident.severity,
        incident.category, incident.currentPhase, incident.declaredAt, incident.declaredBy,
        incident.updatedAt, incident.closedAt || null,
        JSON.stringify(incident.affectedSystems), incident.affectedUsers,
        JSON.stringify(incident.containmentActions), JSON.stringify(incident.eradicationActions),
        JSON.stringify(incident.recoveryActions), incident.lessonsLearned || null,
        JSON.stringify(incident.timeline), JSON.stringify(incident.actionItems),
        incident.linkedBreachId || null, incident.phiInvolved,
      ]
    );
  } catch {
    // Table may not exist yet — incidents still live in-memory
  }
}

function rowToIncident(r: any): Incident {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    currentPhase: r.current_phase,
    declaredAt: r.declared_at,
    declaredBy: r.declared_by,
    updatedAt: r.updated_at,
    closedAt: r.closed_at || undefined,
    affectedSystems: typeof r.affected_systems === "string" ? JSON.parse(r.affected_systems) : (r.affected_systems || []),
    affectedUsers: r.affected_users || 0,
    containmentActions: typeof r.containment_actions === "string" ? JSON.parse(r.containment_actions) : (r.containment_actions || []),
    eradicationActions: typeof r.eradication_actions === "string" ? JSON.parse(r.eradication_actions) : (r.eradication_actions || []),
    recoveryActions: typeof r.recovery_actions === "string" ? JSON.parse(r.recovery_actions) : (r.recovery_actions || []),
    lessonsLearned: r.lessons_learned || undefined,
    timeline: typeof r.timeline === "string" ? JSON.parse(r.timeline) : (r.timeline || []),
    actionItems: typeof r.action_items === "string" ? JSON.parse(r.action_items) : (r.action_items || []),
    linkedBreachId: r.linked_breach_id || undefined,
    phiInvolved: r.phi_involved || false,
  };
}
