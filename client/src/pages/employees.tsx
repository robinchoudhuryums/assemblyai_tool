import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus, Users, Upload, ChevronDown, ChevronRight, Pencil, Eye, GitCompare } from "lucide-react";
import { Link } from "wouter";
import { POWER_MOBILITY_SUBTEAMS } from "@shared/schema";
import type { Employee } from "@shared/schema";

// Departments that use sub-teams
const DEPARTMENTS_WITH_SUBTEAMS: Record<string, readonly string[]> = {
  "Intake - Power Mobility": POWER_MOBILITY_SUBTEAMS,
  "Power Mobility": POWER_MOBILITY_SUBTEAMS,
};

interface DepartmentGroup {
  department: string;
  subTeams?: { name: string; employees: Employee[] }[];
  employees: Employee[]; // employees without a sub-team (or dept has no sub-teams)
}

function groupByDepartment(employees: Employee[]): DepartmentGroup[] {
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
    const subTeamDefs = DEPARTMENTS_WITH_SUBTEAMS[dept];

    if (subTeamDefs) {
      const subTeamMap = new Map<string, Employee[]>();
      const unassigned: Employee[] = [];

      for (const emp of deptEmployees) {
        if (emp.subTeam && subTeamDefs.includes(emp.subTeam as any)) {
          if (!subTeamMap.has(emp.subTeam)) subTeamMap.set(emp.subTeam, []);
          subTeamMap.get(emp.subTeam)!.push(emp);
        } else {
          unassigned.push(emp);
        }
      }

      // Order sub-teams by the defined chronological order
      const subTeams = subTeamDefs
        .filter(st => subTeamMap.has(st))
        .map(st => ({ name: st, employees: subTeamMap.get(st)! }));

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
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
          {employee.initials || employee.name?.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <p className="font-semibold text-sm">{employee.name}</p>
          <p className="text-xs text-muted-foreground">{employee.role || "No department"}</p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading stats...</p>
      ) : profile ? (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total Calls</p>
            <p className="font-bold">{profile.totalCalls}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Score</p>
            <p className="font-bold text-primary">{profile.avgPerformanceScore?.toFixed(1) ?? "N/A"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">High / Low</p>
            <p className="font-bold">
              <span className="text-green-600">{profile.highScore?.toFixed(1) ?? "—"}</span>
              {" / "}
              <span className="text-red-600">{profile.lowScore?.toFixed(1) ?? "—"}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sentiment</p>
            <div className="flex gap-1 text-xs">
              <span className="text-green-600">{profile.sentimentBreakdown?.positive ?? 0}+</span>
              <span className="text-gray-500">{profile.sentimentBreakdown?.neutral ?? 0}~</span>
              <span className="text-red-600">{profile.sentimentBreakdown?.negative ?? 0}-</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No data available</p>
      )}
      <Link href={`/reports?employee=${employee.id}`}>
        <Button size="sm" variant="outline" className="w-full mt-3 text-xs">
          <Eye className="w-3 h-3 mr-1" /> Full Profile
        </Button>
      </Link>
    </div>
  );
}

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

  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // Replace oldest
      return [...prev, id];
    });
  };

  const { data: employees, isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const departments = useMemo(() => {
    if (!employees) return [];
    return groupByDepartment(employees);
  }, [employees]);

  const allDepartments = useMemo(() => {
    if (!employees) return [];
    return getAllDepartments(employees);
  }, [employees]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; role?: string; initials?: string; status?: string; subTeam?: string; }) => {
      const res = await apiRequest("POST", "/api/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee Added", description: "The employee has been added successfully." });
      resetAddForm();
      setAddOpen(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Employee Updated", description: "Changes saved successfully." });
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
      toast({ title: "Import Complete", description: data.message });
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const resetAddForm = () => {
    setName(""); setRole(""); setSubTeam(""); setStatus("Active");
  };

  const openEditDialog = (emp: Employee) => {
    setEditEmployee(emp);
    setEditName(emp.name);
    setEditRole(emp.role || "");
    setEditSubTeam(emp.subTeam || "");
    setEditStatus(emp.status || "Active");
    setEditOpen(true);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return;
    }
    const trimmedName = name.trim();
    const nameParts = trimmedName.split(/\s+/);
    const initials = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : trimmedName.slice(0, 2).toUpperCase();

    // Auto-generate email from name for backend storage
    const autoEmail = `${trimmedName.toLowerCase().replace(/\s+/g, ".")}@company.com`;

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
      },
    });
  };

  const getSubTeamsForDept = (dept: string): readonly string[] | undefined => {
    return DEPARTMENTS_WITH_SUBTEAMS[dept];
  };

  const totalActive = employees?.filter(e => e.status === "Active").length || 0;

  const renderEmployeeRow = (emp: Employee) => (
    <tr key={emp.id} className={`hover:bg-muted/30 ${compareIds.includes(emp.id) ? "bg-primary/5" : ""}`}>
      <td className="px-4 py-2.5 text-sm font-medium text-foreground">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
            {emp.initials || emp.name?.slice(0, 2).toUpperCase()}
          </span>
          {emp.name}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">{emp.subTeam || "—"}</td>
      <td className="px-4 py-2.5 text-sm">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          emp.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
        }`}>
          {emp.status || "Active"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm">
        <div className="flex items-center gap-1">
          <Link href={`/reports?employee=${emp.id}`}>
            <Button size="sm" variant="ghost" title="View Agent Profile">
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Button
            size="sm"
            variant={compareIds.includes(emp.id) ? "default" : "ghost"}
            onClick={() => toggleCompare(emp.id)}
            title="Compare"
            className="w-7 h-7 p-0"
          >
            <GitCompare className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEditDialog(emp)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );

  const renderTable = (emps: Employee[]) => (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border">
          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Sub-Team</th>
          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-12"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {emps.map(renderEmployeeRow)}
      </tbody>
    </table>
  );

  const renderDepartmentField = (value: string, onChange: (v: string) => void, id: string) => (
    <div>
      <Label htmlFor={id}>Department</Label>
      <Select value={value || "custom"} onValueChange={(v) => { if (v !== "custom") onChange(v); }}>
        <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
        <SelectContent>
          {allDepartments.map(dept => (
            <SelectItem key={dept} value={dept}>{dept}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or type a new department..."
      />
    </div>
  );

  const renderSubTeamField = (dept: string, value: string, onChange: (v: string) => void) => {
    const subTeams = getSubTeamsForDept(dept);
    if (!subTeams) return null;
    return (
      <div>
        <Label>Sub-Team</Label>
        <Select value={value || "none"} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select sub-team" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No sub-team</SelectItem>
            {subTeams.map(st => (
              <SelectItem key={st} value={st}>{st}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="min-h-screen" data-testid="employees-page">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Employees</h2>
          <p className="text-muted-foreground">
            {employees ? `${employees.length} total, ${totalActive} active` : "Manage employees for call assignment"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            <Upload className="w-4 h-4 mr-2" />
            {importMutation.isPending ? "Importing..." : "Import from CSV"}
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4 mt-2">
                <div>
                  <Label htmlFor="add-name">Full Name *</Label>
                  <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
                </div>
                {renderDepartmentField(role, setRole, "add-role")}
                {renderSubTeamField(role, subTeam, setSubTeam)}
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding..." : "Add Employee"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Edit Employee Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditEmployee(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
          {editEmployee && (
            <form onSubmit={handleEdit} className="space-y-4 mt-2">
              <div>
                <Label htmlFor="edit-name">Full Name</Label>
                <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              {renderDepartmentField(editRole, setEditRole, "edit-role")}
              {renderSubTeamField(editRole, editSubTeam, setEditSubTeam)}
              <div>
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Team Comparison Panel */}
      {compareIds.length === 2 && employees && (() => {
        const emp1 = employees.find(e => e.id === compareIds[0]);
        const emp2 = employees.find(e => e.id === compareIds[1]);
        if (!emp1 || !emp2) return null;
        return (
          <div className="mx-6 mt-6 bg-card rounded-lg border border-primary/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-primary" />
                Comparing Agents
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setCompareIds([])}>Clear</Button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <CompareCard employee={emp1} />
              <CompareCard employee={emp2} />
            </div>
          </div>
        );
      })()}

      <div className="p-6">
        {isLoading ? (
          <p className="text-muted-foreground">Loading employees...</p>
        ) : !employees || employees.length === 0 ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No employees yet</h3>
            <p className="text-muted-foreground mt-1 mb-4">Import from the CSV or add employees manually.</p>
            <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
              <Upload className="w-4 h-4 mr-2" />
              {importMutation.isPending ? "Importing..." : "Import from CSV"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {departments.map(({ department, subTeams, employees: deptEmployees }) => {
              const isCollapsed = collapsedDepts.has(department);
              const allInDept = [...deptEmployees, ...(subTeams?.flatMap(st => st.employees) || [])];
              const activeCount = allInDept.filter(e => e.status === "Active").length;
              const hasSubTeams = subTeams && subTeams.length > 0;

              return (
                <div key={department} className="bg-card rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => toggleDept(department)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span className="font-semibold text-sm text-foreground">{department}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {activeCount} active / {allInDept.length} total
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div>
                      {hasSubTeams && subTeams!.map(({ name: stName, employees: stEmps }) => (
                        <div key={stName}>
                          <div className="px-6 py-1.5 bg-muted/40 border-t border-border">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stName}</span>
                            <span className="text-xs text-muted-foreground ml-2">({stEmps.length})</span>
                          </div>
                          {renderTable(stEmps)}
                        </div>
                      ))}
                      {deptEmployees.length > 0 && (
                        <div>
                          {hasSubTeams && (
                            <div className="px-6 py-1.5 bg-muted/40 border-t border-border">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unassigned Sub-Team</span>
                              <span className="text-xs text-muted-foreground ml-2">({deptEmployees.length})</span>
                            </div>
                          )}
                          {renderTable(deptEmployees)}
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
