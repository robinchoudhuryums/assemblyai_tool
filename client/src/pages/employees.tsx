import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CaretDown, CaretRight, Eye, FileText, GitDiff, PencilSimple, UploadSimple, UserPlus, Users, Warning, X } from "@phosphor-icons/react";
import { Link } from "wouter";
import { POWER_MOBILITY_SUBTEAMS } from "@shared/schema";
import type { Employee } from "@shared/schema";

// ─────────────────────────────────────────────────────────────
// Server is the source of truth for department → sub-team taxonomy
// (see GET /api/employees/teams). We keep this constant as a fallback
// for the first render before the query resolves.
// ─────────────────────────────────────────────────────────────
const FALLBACK_DEPARTMENTS_WITH_SUBTEAMS: Record<string, readonly string[]> = {
  "Intake - Power Mobility": POWER_MOBILITY_SUBTEAMS,
  "Power Mobility": POWER_MOBILITY_SUBTEAMS,
};

interface TeamsConfig {
  departmentsWithSubTeams: Record<string, string[]>;
}

interface DepartmentGroup {
  department: string;
  subTeams?: { name: string; employees: Employee[] }[];
  employees: Employee[];
}

function groupByDepartment(
  employees: Employee[],
  deptsWithSubTeams: Record<string, readonly string[]>,
): DepartmentGroup[] {
  const deptMap = new Map<string, Employee[]>();
  for (const emp of employees) {
    const dept = emp.role || "Unassigned";
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept)!.push(emp);
  }

  const groups: DepartmentGroup[] = [];
  const sortedDepts = Array.from(deptMap.keys()).sort((a, b) => a.localeCompare(b));

  for (const dept of sortedDepts) {
    const deptEmployees = deptMap.get(dept)!;
    const subTeamDefs = deptsWithSubTeams[dept];

    if (subTeamDefs) {
      const subTeamMap = new Map<string, Employee[]>();
      const unassigned: Employee[] = [];

      for (const emp of deptEmployees) {
        if (emp.subTeam && (subTeamDefs as readonly string[]).includes(emp.subTeam)) {
          if (!subTeamMap.has(emp.subTeam)) subTeamMap.set(emp.subTeam, []);
          subTeamMap.get(emp.subTeam)!.push(emp);
        } else {
          unassigned.push(emp);
        }
      }

      const subTeams = subTeamDefs
        .filter((st) => subTeamMap.has(st))
        .map((st) => ({ name: st, employees: subTeamMap.get(st)! }));

      groups.push({ department: dept, subTeams, employees: unassigned });
    } else {
      groups.push({ department: dept, employees: deptEmployees });
    }
  }

  return groups;
}

function getAllDepartments(employees: Employee[]): string[] {
  const set = new Set<string>();
  for (const emp of employees) {
    if (emp.role) set.add(emp.role);
  }
  return Array.from(set).sort();
}

// ─────────────────────────────────────────────────────────────
// Warm-paper primitives — mirror the admin / reports vocabulary so the
// two pages look like one book. Not extracted to a shared module yet
// because each installment has been slightly different; the Batch B
// analytics push will consolidate these.
// ─────────────────────────────────────────────────────────────

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {children}
    </div>
  );
}

function ActionChip({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background border border-foreground"
          : "bg-card border border-border text-foreground hover:bg-secondary"
      }`}
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const isActive = status === "Active";
  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-sm px-2 py-0.5"
      style={{
        fontSize: 9,
        letterSpacing: "0.1em",
        background: isActive ? "var(--sage-soft)" : "var(--paper-2)",
        border: `1px solid ${
          isActive
            ? "color-mix(in oklch, var(--sage), transparent 55%)"
            : "var(--border)"
        }`,
        color: isActive
          ? "color-mix(in oklch, var(--sage), var(--ink) 25%)"
          : "var(--muted-foreground)",
      }}
    >
      {status}
    </span>
  );
}

function AvatarInitials({ employee, size = 28 }: { employee: Employee; size?: number }) {
  const initials = employee.initials || employee.name?.slice(0, 2).toUpperCase() || "??";
  return (
    <span
      className="rounded-full inline-flex items-center justify-center shrink-0 font-mono"
      style={{
        width: size,
        height: size,
        background: "var(--copper-soft)",
        border: "1px solid color-mix(in oklch, var(--accent), transparent 65%)",
        color: "var(--accent)",
        fontSize: size >= 32 ? 11 : 10,
        letterSpacing: "0.02em",
        fontWeight: 600,
      }}
    >
      {initials}
    </span>
  );
}

interface AgentProfileData {
  totalCalls: number;
  avgPerformanceScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
}

function CompareCard({ employee }: { employee: Employee }) {
  const { data: profile, isLoading } = useQuery<AgentProfileData>({
    queryKey: [`/api/reports/agent-profile/${employee.id}`],
  });

  return (
    <div
      className="rounded-sm p-5 border border-border"
      style={{ background: "var(--paper-2)" }}
    >
      <div className="flex items-center gap-3 mb-4">
        <AvatarInitials employee={employee} size={36} />
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm truncate">{employee.pseudonym || employee.name}</p>
          <p
            className="font-mono uppercase text-muted-foreground mt-0.5"
            style={{ fontSize: 9, letterSpacing: "0.1em" }}
          >
            {employee.role || "Unassigned"}
          </p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading stats…</p>
      ) : profile ? (
        <div className="grid grid-cols-2 gap-4">
          <CompareStat label="Total calls" value={profile.totalCalls.toString()} />
          <CompareStat
            label="Avg score"
            value={profile.avgPerformanceScore?.toFixed(1) ?? "—"}
            color="var(--accent)"
          />
          <CompareStat
            label="High"
            value={profile.highScore?.toFixed(1) ?? "—"}
            color="var(--sage)"
          />
          <CompareStat
            label="Low"
            value={profile.lowScore?.toFixed(1) ?? "—"}
            color="var(--destructive)"
          />
          <div className="col-span-2">
            <div
              className="font-mono uppercase text-muted-foreground mb-1.5"
              style={{ fontSize: 9, letterSpacing: "0.1em" }}
            >
              Sentiment
            </div>
            <div
              className="font-mono tabular-nums flex gap-3 text-xs"
              style={{ letterSpacing: "0.02em" }}
            >
              <span style={{ color: "var(--sage)" }}>
                {profile.sentimentBreakdown?.positive ?? 0}+
              </span>
              <span className="text-muted-foreground">
                {profile.sentimentBreakdown?.neutral ?? 0}~
              </span>
              <span style={{ color: "var(--destructive)" }}>
                {profile.sentimentBreakdown?.negative ?? 0}−
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No data available</p>
      )}
      <Link href={`/reports?employee=${employee.id}`}>
        <Button size="sm" variant="outline" className="w-full mt-4 text-xs">
          <Eye className="w-3.5 h-3.5 mr-1.5" /> Full profile
        </Button>
      </Link>
    </div>
  );
}

function CompareStat({
  label,
  value,
  color = "var(--foreground)",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground mb-0.5"
        style={{ fontSize: 9, letterSpacing: "0.1em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums"
        style={{ fontSize: 20, letterSpacing: "-0.2px", color }}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);

  // Add form
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [subTeam, setSubTeam] = useState("");
  const [status, setStatus] = useState("Active");

  // Edit form
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editSubTeam, setEditSubTeam] = useState("");
  const [editStatus, setEditStatus] = useState("Active");
  const [editPseudonym, setEditPseudonym] = useState("");
  const [editExtension, setEditExtension] = useState("");

  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [showSubTeam, setShowSubTeam] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const { data: employees, isLoading, error: employeesError } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: teamsConfig } = useQuery<TeamsConfig>({
    queryKey: ["/api/employees/teams"],
    staleTime: Infinity,
  });
  const deptsWithSubTeams = teamsConfig?.departmentsWithSubTeams ?? FALLBACK_DEPARTMENTS_WITH_SUBTEAMS;

  const departments = useMemo(() => {
    if (!employees) return [];
    return groupByDepartment(employees, deptsWithSubTeams);
  }, [employees, deptsWithSubTeams]);

  const allDepartments = useMemo(() => {
    if (!employees) return [];
    return getAllDepartments(employees);
  }, [employees]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      email: string;
      role?: string;
      initials?: string;
      status?: string;
      subTeam?: string;
    }) => {
      const res = await apiRequest("POST", "/api/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee added", description: "The employee has been added successfully." });
      resetAddForm();
      setAddOpen(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee updated", description: "Changes saved successfully." });
      setEditOpen(false);
      setEditEmployee(null);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/employees/import-csv");
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Import complete", description: data.message });
    },
    onError: (error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const resetAddForm = () => {
    setName("");
    setRole("");
    setSubTeam("");
    setStatus("Active");
  };

  const openEditDialog = (emp: Employee) => {
    setEditEmployee(emp);
    setEditName(emp.name);
    setEditRole(emp.role || "");
    setEditSubTeam(emp.subTeam || "");
    setEditStatus(emp.status || "Active");
    setEditPseudonym(emp.pseudonym || "");
    setEditExtension(emp.extension || "");
    setEditOpen(true);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    const trimmedName = name.trim();
    const nameParts = trimmedName.split(/\s+/);
    const initials =
      nameParts.length >= 2
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : trimmedName.slice(0, 2).toUpperCase();

    const localPart = trimmedName
      .toLowerCase()
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/\.{2,}/g, ".")
      .replace(/^\.+|\.+$/g, "") || "user";
    const autoEmail = `${localPart}@company.com`;

    createMutation.mutate({
      name: trimmedName,
      email: autoEmail,
      role: role.trim() || undefined,
      initials,
      status,
      subTeam: subTeam && subTeam !== "none" ? subTeam : undefined,
    });
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEmployee) return;
    updateMutation.mutate({
      id: editEmployee.id,
      updates: {
        name: editName.trim(),
        role: editRole.trim() || undefined,
        subTeam: editSubTeam && editSubTeam !== "none" ? editSubTeam : undefined,
        status: editStatus,
        pseudonym: editPseudonym.trim() || undefined,
        extension: editExtension.trim() || undefined,
      },
    });
  };

  const getSubTeamsForDept = (dept: string): readonly string[] | undefined => deptsWithSubTeams[dept];

  const totalActive = employees?.filter((e) => e.status === "Active").length || 0;
  const totalInactive = (employees?.length || 0) - totalActive;

  // ── Renderers ──

  const renderEmployeeRow = (emp: Employee) => {
    const isSelected = compareIds.includes(emp.id);
    return (
      <div
        key={emp.id}
        className="flex items-center gap-4 px-5 py-3 border-t border-border"
        style={{
          background: isSelected ? "var(--copper-soft)" : "transparent",
          borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
        }}
      >
        <AvatarInitials employee={emp} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {emp.pseudonym || emp.name}
            </span>
            {emp.extension && (
              <span
                className="font-mono text-muted-foreground tabular-nums"
                style={{ fontSize: 10, letterSpacing: "0.02em" }}
              >
                ext. {emp.extension}
              </span>
            )}
          </div>
          {emp.pseudonym && emp.pseudonym !== emp.name && (
            <div
              className="font-mono text-muted-foreground mt-0.5"
              style={{ fontSize: 10, letterSpacing: "0.02em" }}
            >
              {emp.name}
            </div>
          )}
        </div>
        {showSubTeam && (
          <div
            className="font-mono uppercase text-muted-foreground shrink-0 min-w-[120px]"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            {emp.subTeam || "—"}
          </div>
        )}
        <StatusPill status={emp.status || "Active"} />
        <div className="flex items-center gap-0.5 shrink-0">
          <Link href={`/reports?employee=${emp.id}`}>
            <Button size="sm" variant="ghost" title="View agent profile" aria-label="View agent profile">
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Link href={`/scorecard/${emp.id}`}>
            <Button size="sm" variant="ghost" title="View scorecard" aria-label="View scorecard">
              <FileText className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleCompare(emp.id)}
            title={isSelected ? "Remove from comparison" : "Compare"}
            aria-label="Compare agent"
            style={{
              color: isSelected ? "var(--accent)" : undefined,
            }}
          >
            <GitDiff className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Edit agent" onClick={() => openEditDialog(emp)}>
            <PencilSimple className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  const renderSubTeamHeader = (label: string, count: number) => (
    <div
      className="flex items-center gap-3 px-5 py-2 border-t border-border"
      style={{ background: "var(--paper-2)" }}
    >
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </span>
      <span
        className="font-mono uppercase text-muted-foreground tabular-nums"
        style={{ fontSize: 9, letterSpacing: "0.1em" }}
      >
        · {count}
      </span>
    </div>
  );

  const renderDepartmentField = (value: string, onChange: (v: string) => void, id: string) => (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id}>Department</FieldLabel>
      <Select
        value={value || "custom"}
        onValueChange={(v) => {
          if (v !== "custom") onChange(v);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select department" />
        </SelectTrigger>
        <SelectContent>
          {allDepartments.map((dept) => (
            <SelectItem key={dept} value={dept}>
              {dept}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Or type a new department…" />
    </div>
  );

  const renderSubTeamField = (dept: string, value: string, onChange: (v: string) => void) => {
    const subTeams = getSubTeamsForDept(dept);
    if (!subTeams) return null;
    return (
      <div className="space-y-1.5">
        <FieldLabel>Sub-team</FieldLabel>
        <Select value={value || "none"} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select sub-team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No sub-team</SelectItem>
            {subTeams.map((st) => (
              <SelectItem key={st} value={st}>
                {st}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="employees-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Employees</span>
        </nav>
        <div className="flex-1" />
        {employees && (
          <span
            className="font-mono uppercase tabular-nums text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            {employees.length} total · {totalActive} active
            {totalInactive > 0 ? ` · ${totalInactive} inactive` : ""}
          </span>
        )}
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <SectionKicker>Directory</SectionKicker>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Employees
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Manage the directory that powers call assignment, scorecards, and team analytics. Agents are grouped by
          department and sub-team; hidden / inactive agents stay visible in the archive view below.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 px-7 py-3 bg-background border-b border-border">
        <ActionChip active={showSubTeam} onClick={() => setShowSubTeam((p) => !p)}>
          {showSubTeam ? "Sub-teams ON" : "Sub-teams OFF"}
        </ActionChip>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
        >
          <UploadSimple className="w-4 h-4 mr-1.5" />
          {importMutation.isPending ? "Importing…" : "Import CSV"}
        </Button>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Add employee
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add new employee</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="add-name">Full name *</FieldLabel>
                <Input
                  id="add-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              {renderDepartmentField(role, setRole, "add-role")}
              {renderSubTeamField(role, subTeam, setSubTeam)}
              <div className="space-y-1.5">
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding…" : "Add employee"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditEmployee(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit employee</DialogTitle>
          </DialogHeader>
          {editEmployee && (
            <form onSubmit={handleEdit} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="edit-name">Full name</FieldLabel>
                <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="edit-pseudonym">Display name (with pseudonym)</FieldLabel>
                <Input
                  id="edit-pseudonym"
                  value={editPseudonym}
                  onChange={(e) => setEditPseudonym(e.target.value)}
                  placeholder="e.g. Camila (Cheshta) Bhutani"
                />
                <p
                  className="font-mono text-muted-foreground mt-1"
                  style={{ fontSize: 10, letterSpacing: "0.02em", lineHeight: 1.5 }}
                >
                  How this agent appears in reports / 8x8. Blank → uses the name above.
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="edit-ext">8x8 extension</FieldLabel>
                <Input
                  id="edit-ext"
                  value={editExtension}
                  onChange={(e) => setEditExtension(e.target.value)}
                  placeholder="e.g. 1234"
                />
              </div>
              {renderDepartmentField(editRole, setEditRole, "edit-role")}
              {renderSubTeamField(editRole, editSubTeam, setEditSubTeam)}
              <div className="space-y-1.5">
                <FieldLabel>Status</FieldLabel>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Compare panel */}
      {compareIds.length === 2 &&
        employees &&
        (() => {
          const emp1 = employees.find((e) => e.id === compareIds[0]);
          const emp2 = employees.find((e) => e.id === compareIds[1]);
          if (!emp1 || !emp2) return null;
          return (
            <div className="mx-7 mt-6">
              <div
                className="rounded-sm border bg-card"
                style={{
                  borderColor: "color-mix(in oklch, var(--accent), transparent 60%)",
                }}
              >
                <div className="flex items-center justify-between gap-4 p-5 border-b border-border">
                  <div>
                    <SectionKicker>Side-by-side</SectionKicker>
                    <div
                      className="font-display font-medium text-foreground mt-1 flex items-center gap-2"
                      style={{ fontSize: 18 }}
                    >
                      <GitDiff style={{ width: 16, height: 16, color: "var(--accent)" }} />
                      Comparing agents
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCompareIds([])}
                    title="Clear comparison"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
                  <CompareCard employee={emp1} />
                  <CompareCard employee={emp2} />
                </div>
              </div>
            </div>
          );
        })()}

      {/* Body */}
      <div className="p-7">
        {isLoading ? (
          <div className="text-center py-16">
            <p
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Loading directory…
            </p>
          </div>
        ) : employeesError ? (
          <div
            className="flex items-start gap-3 rounded-sm"
            style={{
              background: "var(--warm-red-soft)",
              border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
              borderLeft: "3px solid var(--destructive)",
              padding: "14px 18px",
            }}
          >
            <Warning
              style={{ width: 16, height: 16, color: "var(--destructive)", marginTop: 1, flexShrink: 0 }}
            />
            <div>
              <div
                className="font-mono uppercase"
                style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--destructive)" }}
              >
                Load failed
              </div>
              <p className="text-sm text-foreground mt-1">{employeesError.message}</p>
            </div>
          </div>
        ) : !employees || employees.length === 0 ? (
          <div className="text-center py-16">
            <Users
              style={{ width: 40, height: 40, margin: "0 auto", color: "var(--muted-foreground)" }}
            />
            <SectionKicker>
              <span className="mt-4 block">Empty directory</span>
            </SectionKicker>
            <div
              className="font-display font-medium text-foreground mt-2"
              style={{ fontSize: 18 }}
            >
              No employees yet
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 mb-5">
              Import from CSV or add an employee manually.
            </p>
            <Button
              variant="outline"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
            >
              <UploadSimple className="w-4 h-4 mr-1.5" />
              {importMutation.isPending ? "Importing…" : "Import from CSV"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {departments.map(({ department, subTeams, employees: deptEmployees }) => {
              const isCollapsed = collapsedDepts.has(department);
              const allInDept = [
                ...deptEmployees,
                ...(subTeams?.flatMap((st) => st.employees) || []),
              ];
              const activeCount = allInDept.filter((e) => e.status === "Active").length;
              const hasSubTeams = subTeams && subTeams.length > 0;

              return (
                <div
                  key={department}
                  className="rounded-sm border border-border bg-card overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleDept(department)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${department}`}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isCollapsed ? (
                        <CaretRight className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <CaretDown className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span
                        className="font-display font-medium text-foreground"
                        style={{ fontSize: 15, letterSpacing: "-0.1px" }}
                      >
                        {department}
                      </span>
                    </div>
                    <span
                      className="font-mono uppercase tabular-nums text-muted-foreground"
                      style={{ fontSize: 10, letterSpacing: "0.1em" }}
                    >
                      {activeCount} active · {allInDept.length} total
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div>
                      {hasSubTeams &&
                        subTeams!.map(({ name: stName, employees: stEmps }) => (
                          <div key={stName}>
                            {renderSubTeamHeader(stName, stEmps.length)}
                            {stEmps.map(renderEmployeeRow)}
                          </div>
                        ))}
                      {deptEmployees.length > 0 && (
                        <div>
                          {hasSubTeams && renderSubTeamHeader("Unassigned sub-team", deptEmployees.length)}
                          {deptEmployees.map(renderEmployeeRow)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared warm-paper field label — mono uppercase kicker used in the
// Add/Edit employee dialogs. Mirrors the AdminFieldLabel pattern in
// admin.tsx; duplicated here to avoid a cross-page extraction ahead of
// Batch B.
// ─────────────────────────────────────────────────────────────
function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono uppercase text-muted-foreground block"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </label>
  );
}
