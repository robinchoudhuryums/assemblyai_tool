import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Brain, CheckCircle, Clock, Key, PencilSimple, Shield, Sliders, Trash, UserPlus, Users, Warning, X, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as sharedQueryClient } from "@/lib/queryClient";
import { USER_ROLES } from "@shared/schema";
import type { AccessRequest, Employee } from "@shared/schema";
import { ROLE_CONFIG } from "@/lib/constants";

type TabView = "users" | "requests" | "roles" | "pipeline" | "models";

interface DbUser {
  id: string;
  username: string;
  role: string;
  displayName: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabView>("users");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Access Requests ──
  const { data: requests, isLoading: requestsLoading, error: requestsError } = useQuery<AccessRequest[]>({
    queryKey: ["/api/access-requests"],
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "denied" }) => {
      const res = await apiRequest("PATCH", `/api/access-requests/${id}`, { status });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-requests"] });
      toast({
        title: variables.status === "approved" ? "Request Approved" : "Request Denied",
        description: variables.status === "approved"
          ? "You can now create a user account in the Users tab."
          : "The access request has been denied.",
      });
    },
    onError: (error) => {
      toast({ title: "Action Failed", description: error.message, variant: "destructive" });
    },
  });

  const pendingRequests = requests?.filter(r => r.status === "pending") || [];
  const reviewedRequests = requests?.filter(r => r.status !== "pending") || [];

  // ── Users ──
  const { data: users, isLoading: usersLoading, error: usersError } = useQuery<DbUser[]>({
    queryKey: ["/api/users"],
  });

  // Self-service viewer onboarding: surface viewers with no matching employee.
  // These users see empty data + 403s with no error — a common "why can't
  // I see anything?" support puzzle. The endpoint is admin-scoped.
  const { data: unlinked } = useQuery<{ count: number; users: DbUser[] }>({
    queryKey: ["/api/users/unlinked"],
  });

  // Employee list feeds the "Link to employee" dropdown on each unlinked row.
  // The same query is used elsewhere in admin; TanStack Query dedupes.
  const { data: allEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: Boolean(unlinked && unlinked.count > 0),
  });

  // Per-row state: which employee the admin chose to link each user to.
  const [linkSelections, setLinkSelections] = useState<Record<string, string>>({});

  const linkEmployeeMutation = useMutation({
    mutationFn: async ({ userId, employeeId }: { userId: string; employeeId: string }) => {
      const res = await apiRequest("POST", `/api/users/${userId}/link-employee`, { employeeId });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to link user");
      }
      return res.json();
    },
    onSuccess: (_updated, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/unlinked"] });
      setLinkSelections(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      toast({ title: "User linked", description: "Display name updated to match employee." });
    },
    onError: (error) => {
      toast({ title: "Link failed", description: (error as Error).message, variant: "destructive" });
    },
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", password: "", displayName: "", role: "viewer" });
  const [editingUser, setEditingUser] = useState<DbUser | null>(null);
  const [editForm, setEditForm] = useState({ displayName: "", role: "", active: true });
  const [resetPasswordUser, setResetPasswordUser] = useState<DbUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // Phase E: if the server attaches a `warning` to the response (no matching
  // employee for a viewer/manager), show an amber panel with the fuzzy
  // candidates so the admin can one-click link without navigating to the
  // banner below. Cleared when the admin creates another user or closes.
  type CreateWarning = {
    userId: string;
    code: string;
    message: string;
    candidates: Array<{ id: string; name: string; email: string | null; similarity: number }>;
  };
  const [createWarning, setCreateWarning] = useState<CreateWarning | null>(null);

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const res = await apiRequest("POST", "/api/users", data);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/unlinked"] });
      setShowCreateForm(false);
      setCreateForm({ username: "", password: "", displayName: "", role: "viewer" });
      if (created?.warning?.code === "no_matching_employee") {
        setCreateWarning({
          userId: created.id,
          code: created.warning.code,
          message: created.warning.message,
          candidates: Array.isArray(created.warning.candidates) ? created.warning.candidates : [],
        });
      } else {
        setCreateWarning(null);
      }
      toast({ title: "User Created", description: "The new user account is ready." });
    },
    onError: (error) => {
      toast({ title: "Failed to Create User", description: error.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingUser(null);
      toast({ title: "User Updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to Update User", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, newPassword: pw }: { id: string; newPassword: string }) => {
      const res = await apiRequest("POST", `/api/users/${id}/reset-password`, { newPassword: pw });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: () => {
      setResetPasswordUser(null);
      setNewPassword("");
      toast({ title: "Password Reset", description: "The user's password has been updated." });
    },
    onError: (error) => {
      toast({ title: "Failed to Reset Password", description: error.message, variant: "destructive" });
    },
  });

  const deactivateUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to deactivate user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Deactivated" });
    },
    onError: (error) => {
      toast({ title: "Failed to Deactivate User", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = (user: DbUser) => {
    setEditingUser(user);
    setEditForm({ displayName: user.displayName, role: user.role, active: user.active });
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="admin-page">
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
          <span className="text-foreground">Admin</span>
        </nav>
        <div className="flex-1" />
        {pendingRequests.length > 0 && (
          <span
            className="font-mono uppercase inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1.5"
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              background: "var(--amber-soft)",
              borderColor: "color-mix(in oklch, var(--amber), transparent 50%)",
              color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
            }}
          >
            {pendingRequests.length} pending request{pendingRequests.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          Administration
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          {tab === "users" && "Users"}
          {tab === "requests" && "Access requests"}
          {tab === "roles" && "Role definitions"}
          {tab === "pipeline" && "Pipeline settings"}
          {tab === "models" && "AI models"}
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex gap-2 px-7 py-3 bg-background border-b border-border flex-wrap"
      >
        <AdminTab icon={Users} label="Users" active={tab === "users"} onClick={() => setTab("users")} />
        <AdminTab
          icon={UserPlus}
          label="Access Requests"
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          badge={pendingRequests.length > 0 ? pendingRequests.length : undefined}
        />
        <AdminTab icon={Shield} label="Role Definitions" active={tab === "roles"} onClick={() => setTab("roles")} />
        <AdminTab icon={Sliders} label="Pipeline Settings" active={tab === "pipeline"} onClick={() => setTab("pipeline")} />
        <AdminTab icon={Brain} label="AI Models" active={tab === "models"} onClick={() => setTab("models")} />
      </div>

      <div className="px-7 py-6 space-y-6">
        {/* ════════════════ USERS TAB ════════════════ */}
        {tab === "users" && (
          <div className="space-y-8">
            {/* Unlinked viewer banner — shows only when there are viewers with no matching employee row. */}
            {unlinked && unlinked.count > 0 && (
              <div
                className="border bg-card"
                style={{
                  borderRadius: "var(--radius)",
                  boxShadow: "inset 3px 0 0 var(--amber)",
                  padding: "16px 20px",
                }}
                data-testid="unlinked-users-banner"
              >
                <div className="flex items-start gap-3">
                  <Warning style={{ width: 20, height: 20, color: "var(--amber)", flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1">
                    <div
                      className="font-mono uppercase text-muted-foreground"
                      style={{ fontSize: 10, letterSpacing: "0.14em" }}
                    >
                      Onboarding
                    </div>
                    <div className="font-medium text-foreground mt-1">
                      {unlinked.count} viewer{unlinked.count === 1 ? "" : "s"} not linked to an employee
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      These viewers see empty dashboards because their username (email) and display name don't
                      match any employee row. Update the corresponding employee's email to match the user's
                      login, or rename the user's display name to match an employee.
                    </p>
                    <div className="mt-3 space-y-2">
                      {unlinked.users.slice(0, 5).map((u: any) => {
                        const selectedId = linkSelections[u.id] || "";
                        const isLinking = linkEmployeeMutation.isPending && linkEmployeeMutation.variables?.userId === u.id;
                        const candidates: Array<{ id: string; name: string; email: string | null; similarity: number }> =
                          Array.isArray(u.candidates) ? u.candidates : [];
                        return (
                          <div
                            key={u.id}
                            className="py-2 border-t first:border-t-0"
                            data-testid={`unlinked-row-${u.id}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-mono text-xs flex items-center gap-2 flex-1 min-w-[220px]">
                                <span style={{ color: "var(--muted-foreground)" }}>{u.username}</span>
                                <span style={{ color: "var(--muted-foreground)" }}>·</span>
                                <span className="text-foreground">{u.name}</span>
                                {u.role && u.role !== "viewer" && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)" }}>·</span>
                                    <span className="uppercase" style={{ color: "var(--muted-foreground)", fontSize: 10, letterSpacing: "0.1em" }}>
                                      {u.role}
                                    </span>
                                  </>
                                )}
                              </div>
                              <select
                                value={selectedId}
                                onChange={(e) => setLinkSelections(prev => ({ ...prev, [u.id]: e.target.value }))}
                                className="h-8 min-w-[180px] border bg-background text-foreground font-mono text-xs px-2"
                                style={{ borderRadius: "calc(var(--radius) - 2px)" }}
                                disabled={isLinking || !allEmployees}
                                data-testid={`unlinked-select-${u.id}`}
                              >
                                <option value="">Link to employee…</option>
                                {(allEmployees || [])
                                  .filter((e) => e.status !== "Inactive")
                                  .map((e) => (
                                    <option key={e.id} value={e.id}>
                                      {e.name} {e.email ? `(${e.email})` : ""}
                                    </option>
                                  ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!selectedId || isLinking}
                                onClick={() => {
                                  if (!selectedId) return;
                                  linkEmployeeMutation.mutate({ userId: u.id, employeeId: selectedId });
                                }}
                                data-testid={`unlinked-link-${u.id}`}
                              >
                                {isLinking ? "Linking…" : "Link"}
                              </Button>
                            </div>
                            {candidates.length > 0 && (
                              <div
                                className="flex flex-wrap items-center gap-1.5 mt-1.5 ml-0.5"
                                data-testid={`unlinked-candidates-${u.id}`}
                              >
                                <span
                                  className="font-mono uppercase text-muted-foreground"
                                  style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                >
                                  Did you mean
                                </span>
                                {candidates.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      // One-click pre-select + link — short-circuits the dropdown.
                                      setLinkSelections((prev) => ({ ...prev, [u.id]: c.id }));
                                      linkEmployeeMutation.mutate({ userId: u.id, employeeId: c.id });
                                    }}
                                    disabled={isLinking}
                                    className="font-mono text-xs border border-border rounded-sm px-2 py-0.5 hover:bg-secondary transition-colors disabled:opacity-50"
                                    style={{ fontSize: 11 }}
                                    title={c.email ? `${c.email} · similarity ${c.similarity}` : `similarity ${c.similarity}`}
                                    data-testid={`unlinked-candidate-${u.id}-${c.id}`}
                                  >
                                    {c.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {unlinked.users.length > 5 && (
                        <div className="font-mono text-xs text-muted-foreground pt-1">
                          + {unlinked.users.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {createWarning && (
              <div
                className="border bg-card"
                style={{
                  borderRadius: "var(--radius)",
                  boxShadow: "inset 3px 0 0 var(--amber)",
                  padding: "14px 18px",
                }}
                data-testid="create-warning-banner"
              >
                <div className="flex items-start gap-3">
                  <Warning style={{ width: 18, height: 18, color: "var(--amber)", flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1">
                    <div
                      className="font-mono uppercase text-muted-foreground"
                      style={{ fontSize: 10, letterSpacing: "0.14em" }}
                    >
                      Onboarding warning
                    </div>
                    <p className="text-sm text-foreground mt-1">{createWarning.message}</p>
                    {createWarning.candidates.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className="font-mono uppercase text-muted-foreground"
                          style={{ fontSize: 10, letterSpacing: "0.12em" }}
                        >
                          Did you mean
                        </span>
                        {createWarning.candidates.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              linkEmployeeMutation.mutate(
                                { userId: createWarning.userId, employeeId: c.id },
                                { onSuccess: () => setCreateWarning(null) },
                              );
                            }}
                            disabled={linkEmployeeMutation.isPending}
                            className="font-mono border border-border rounded-sm px-2 py-0.5 hover:bg-secondary transition-colors disabled:opacity-50"
                            style={{ fontSize: 11 }}
                            title={c.email ? `${c.email} · similarity ${c.similarity}` : `similarity ${c.similarity}`}
                            data-testid={`create-warning-candidate-${c.id}`}
                          >
                            {c.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCreateWarning(null)}
                          className="font-mono uppercase text-muted-foreground hover:text-foreground transition-colors ml-2"
                          style={{ fontSize: 10, letterSpacing: "0.1em" }}
                          data-testid="create-warning-dismiss"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-1">
                        No fuzzy matches found — link manually via the Onboarding banner above, or add a matching employee row first.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Create user inline panel */}
            <AdminPanel>
              <div className="p-6">
                <AdminSectionHeader
                  kicker="Directory"
                  icon={Users}
                  title="User accounts"
                  description="Create and manage database-backed users. AUTH_USERS env var is a boot fallback only; prefer DB users for audit trail + password rotation."
                  action={
                    <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)} data-testid="toggle-create-user">
                      {showCreateForm ? (
                        <>
                          <X className="w-4 h-4 mr-1.5" /> Cancel
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4 mr-1.5" /> New user
                        </>
                      )}
                    </Button>
                  }
                />

                {showCreateForm && (
                  <form
                    className="mb-6 p-5 rounded-sm border border-border"
                    style={{ background: "var(--paper-2)" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      createUserMutation.mutate(createForm);
                    }}
                  >
                    <div
                      className="font-mono uppercase text-muted-foreground mb-4"
                      style={{ fontSize: 10, letterSpacing: "0.12em" }}
                    >
                      New user
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <AdminFieldLabel htmlFor="new-user-username">Username</AdminFieldLabel>
                        <Input
                          id="new-user-username"
                          type="text"
                          value={createForm.username}
                          onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                          required
                          autoComplete="off"
                          className="font-mono text-sm"
                        />
                      </div>
                      <div>
                        <AdminFieldLabel htmlFor="new-user-name">Display name</AdminFieldLabel>
                        <Input
                          id="new-user-name"
                          type="text"
                          value={createForm.displayName}
                          onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <AdminFieldLabel htmlFor="new-user-password">Password</AdminFieldLabel>
                        <Input
                          id="new-user-password"
                          type="password"
                          value={createForm.password}
                          onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                          required
                          autoComplete="new-password"
                          placeholder="12+ chars · upper · lower · digit · special"
                        />
                      </div>
                      <div>
                        <AdminFieldLabel htmlFor="new-user-role">Role</AdminFieldLabel>
                        <select
                          id="new-user-role"
                          className="flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={createForm.role}
                          onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager / QA</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={createUserMutation.isPending}>
                        {createUserMutation.isPending ? "Creating…" : "Create user"}
                      </Button>
                    </div>
                  </form>
                )}

                {/* User list */}
                {usersError ? (
                  <AccessRequestsErrorState message={usersError.message} />
                ) : usersLoading ? (
                  <div className="space-y-3 pt-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !users || users.length === 0 ? (
                  <div className="text-center py-14">
                    <Users
                      style={{ width: 32, height: 32, margin: "0 auto", color: "var(--muted-foreground)" }}
                    />
                    <div
                      className="font-mono uppercase text-muted-foreground mt-3"
                      style={{ fontSize: 10, letterSpacing: "0.14em" }}
                    >
                      Empty directory
                    </div>
                    <p className="text-sm text-foreground mt-2">
                      No database users yet. Create one above or bootstrap via <code className="font-mono text-xs">AUTH_USERS</code>.
                    </p>
                  </div>
                ) : (
                  <div className="-mx-6 border-t border-border">
                    {users.map((user) => (
                      <AdminListRow key={user.id} faded={!user.active}>
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: "var(--paper-2)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <Users style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground text-sm">{user.displayName}</p>
                            <AdminRolePill role={user.role} />
                            {!user.active && <AdminStatusPill kind="inactive">Inactive</AdminStatusPill>}
                          </div>
                          <p
                            className="font-mono text-muted-foreground mt-0.5"
                            style={{ fontSize: 11, letterSpacing: "0.02em" }}
                          >
                            @{user.username}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(user)}
                            title="Edit user"
                            data-testid={`edit-user-${user.id}`}
                          >
                            <PencilSimple className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setResetPasswordUser(user);
                              setNewPassword("");
                            }}
                            title="Reset password"
                            data-testid={`reset-password-${user.id}`}
                          >
                            <Key className="w-4 h-4" />
                          </Button>
                          {user.active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              style={{ color: "var(--destructive)" }}
                              onClick={() => {
                                if (confirm(`Deactivate ${user.displayName}? They will no longer be able to log in.`)) {
                                  deactivateUserMutation.mutate(user.id);
                                }
                              }}
                              title="Deactivate user"
                              data-testid={`deactivate-user-${user.id}`}
                            >
                              <Trash className="w-4 h-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              style={{ color: "var(--sage)" }}
                              onClick={() => updateUserMutation.mutate({ id: user.id, data: { active: true } })}
                              title="Reactivate user"
                              data-testid={`reactivate-user-${user.id}`}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </AdminListRow>
                    ))}
                  </div>
                )}
              </div>
            </AdminPanel>

            {/* Edit user inline panel */}
            {editingUser && (
              <AdminPanel tone="accent">
                <div className="p-6">
                  <AdminSectionHeader
                    kicker="Edit"
                    icon={PencilSimple}
                    title={editingUser.displayName}
                    description={`Update role, status, or display name for @${editingUser.username}. Changes audit-logged.`}
                    action={
                      <Button variant="ghost" size="sm" onClick={() => setEditingUser(null)} title="Close">
                        <X className="w-4 h-4" />
                      </Button>
                    }
                  />
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data: Record<string, unknown> = {};
                      if (editForm.displayName !== editingUser.displayName) data.displayName = editForm.displayName;
                      if (editForm.role !== editingUser.role) data.role = editForm.role;
                      if (editForm.active !== editingUser.active) data.active = editForm.active;
                      if (Object.keys(data).length === 0) {
                        setEditingUser(null);
                        return;
                      }
                      updateUserMutation.mutate({ id: editingUser.id, data });
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <AdminFieldLabel htmlFor="edit-user-name">Display name</AdminFieldLabel>
                        <Input
                          id="edit-user-name"
                          type="text"
                          value={editForm.displayName}
                          onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <AdminFieldLabel htmlFor="edit-user-role">Role</AdminFieldLabel>
                        <select
                          id="edit-user-role"
                          className="flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={editForm.role}
                          onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager / QA</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <AdminFieldLabel htmlFor="edit-user-status">Status</AdminFieldLabel>
                        <select
                          id="edit-user-status"
                          className="flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={editForm.active ? "active" : "inactive"}
                          onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.value === "active" }))}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t border-border">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingUser(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={updateUserMutation.isPending}>
                        {updateUserMutation.isPending ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                </div>
              </AdminPanel>
            )}

            {/* Reset password inline panel */}
            {resetPasswordUser && (
              <AdminPanel tone="accent">
                <div className="p-6">
                  <AdminSectionHeader
                    kicker="Credentials"
                    icon={Key}
                    title={`Reset password · ${resetPasswordUser.displayName}`}
                    description="The new password will be validated against the complexity policy and password-history window (last 5 passwords cannot be reused)."
                    action={
                      <Button variant="ghost" size="sm" onClick={() => setResetPasswordUser(null)} title="Close">
                        <X className="w-4 h-4" />
                      </Button>
                    }
                  />
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      resetPasswordMutation.mutate({ id: resetPasswordUser.id, newPassword });
                    }}
                  >
                    <div style={{ maxWidth: 420 }}>
                      <AdminFieldLabel htmlFor="reset-new-password">New password</AdminFieldLabel>
                      <Input
                        id="reset-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="12+ chars · upper · lower · digit · special"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t border-border">
                      <Button type="button" variant="outline" size="sm" onClick={() => setResetPasswordUser(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={resetPasswordMutation.isPending}>
                        {resetPasswordMutation.isPending ? "Resetting…" : "Reset password"}
                      </Button>
                    </div>
                  </form>
                </div>
              </AdminPanel>
            )}
          </div>
        )}

        {/* ════════════════ ACCESS REQUESTS TAB ════════════════ */}
        {tab === "requests" && (
          <div className="space-y-8">
            <AdminPanel>
              <div className="p-6">
                <AdminSectionHeader
                  kicker="Pending"
                  icon={Clock}
                  title={`Pending requests · ${pendingRequests.length}`}
                  description="Review and approve or deny access requests. After approving, create the user account in the Users tab with the assigned role."
                />

                {requestsError ? (
                  <AccessRequestsErrorState message={requestsError.message} />
                ) : requestsLoading ? (
                  <div className="space-y-3 pt-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="h-8 w-20" />
                        <Skeleton className="h-8 w-20" />
                      </div>
                    ))}
                  </div>
                ) : pendingRequests.length === 0 ? (
                  <div className="text-center py-14">
                    <div
                      className="mx-auto mb-4 rounded-full flex items-center justify-center"
                      style={{
                        width: 56,
                        height: 56,
                        background: "var(--sage-soft)",
                        border: "1px solid color-mix(in oklch, var(--sage), transparent 55%)",
                      }}
                    >
                      <CheckCircle style={{ width: 24, height: 24, color: "var(--sage)" }} />
                    </div>
                    <div
                      className="font-mono uppercase text-muted-foreground"
                      style={{ fontSize: 10, letterSpacing: "0.14em" }}
                    >
                      Inbox zero
                    </div>
                    <p className="text-sm text-foreground mt-2">No pending access requests.</p>
                  </div>
                ) : (
                  <div className="-mx-6 border-t border-border">
                    {pendingRequests.map((req) => (
                      <AdminListRow key={req.id}>
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: "var(--copper-soft)",
                            border: "1px solid color-mix(in oklch, var(--accent), transparent 65%)",
                          }}
                        >
                          <Users style={{ width: 18, height: 18, color: "var(--accent)" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground">{req.name}</p>
                            <AdminRolePill role={req.requestedRole} />
                          </div>
                          <p
                            className="text-xs text-muted-foreground font-mono mt-0.5"
                            style={{ letterSpacing: "0.02em" }}
                          >
                            {req.email}
                          </p>
                          {req.reason && (
                            <p
                              className="text-sm italic mt-2 pl-3 text-foreground/85"
                              style={{ borderLeft: "2px solid var(--border)" }}
                            >
                              &ldquo;{req.reason}&rdquo;
                            </p>
                          )}
                          <p
                            className="font-mono uppercase text-muted-foreground mt-2"
                            style={{ fontSize: 9, letterSpacing: "0.1em" }}
                          >
                            Requested {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "recently"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => reviewMutation.mutate({ id: req.id, status: "approved" })}
                            disabled={reviewMutation.isPending}
                            data-testid={`approve-request-${req.id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1.5" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reviewMutation.mutate({ id: req.id, status: "denied" })}
                            disabled={reviewMutation.isPending}
                            style={{
                              color: "var(--destructive)",
                              borderColor: "color-mix(in oklch, var(--destructive), transparent 60%)",
                            }}
                            data-testid={`deny-request-${req.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-1.5" />
                            Deny
                          </Button>
                        </div>
                      </AdminListRow>
                    ))}
                  </div>
                )}
              </div>
            </AdminPanel>

            {reviewedRequests.length > 0 && (
              <AdminPanel>
                <div className="p-6">
                  <AdminSectionHeader
                    kicker="Archive"
                    title="Review history"
                    description="Requests that have already been actioned. Ordered newest first."
                  />
                  <div className="-mx-6 border-t border-border">
                    {reviewedRequests.map((req) => (
                      <AdminListRow key={req.id} faded={req.status === "denied"}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{req.name}</p>
                            <span
                              className="text-xs text-muted-foreground font-mono"
                              style={{ letterSpacing: "0.02em" }}
                            >
                              {req.email}
                            </span>
                          </div>
                        </div>
                        <AdminRolePill role={req.requestedRole} />
                        {req.status === "approved" ? (
                          <AdminStatusPill kind="approved" icon={CheckCircle}>
                            Approved
                          </AdminStatusPill>
                        ) : req.status === "denied" ? (
                          <AdminStatusPill kind="denied" icon={XCircle}>
                            Denied
                          </AdminStatusPill>
                        ) : (
                          <AdminStatusPill kind="pending" icon={Clock}>
                            {req.status}
                          </AdminStatusPill>
                        )}
                        <span
                          className="font-mono uppercase text-muted-foreground tabular-nums shrink-0"
                          style={{ fontSize: 9, letterSpacing: "0.1em" }}
                        >
                          {req.reviewedAt ? new Date(req.reviewedAt).toLocaleDateString() : "—"}
                          {req.reviewedBy ? ` · ${req.reviewedBy}` : ""}
                        </span>
                      </AdminListRow>
                    ))}
                  </div>
                </div>
              </AdminPanel>
            )}
          </div>
        )}

        {/* ════════════════ ROLE DEFINITIONS TAB ════════════════ */}
        {tab === "roles" && (
          <div className="space-y-6">
            <AdminPanel>
              <div className="p-6">
                <AdminSectionHeader
                  kicker="Reference"
                  icon={Shield}
                  title="Role definitions"
                  description="Capability matrix for each role tier. Enforced server-side via requireRole() middleware — UI gates mirror backend authorization."
                />
              </div>
              <div className="border-t border-border">
                {USER_ROLES.map((role) => (
                  <RoleDefinitionRow key={role.value} role={role} />
                ))}
              </div>
            </AdminPanel>
          </div>
        )}

        {/* ════════════════ PIPELINE SETTINGS TAB ════════════════ */}
        {tab === "pipeline" && <PipelineSettingsCard />}

        {/* ════════════════ AI MODELS TAB ════════════════ */}
        {tab === "models" && <ModelTiersCard />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pipeline quality-gate settings — runtime-tunable thresholds that
// control when the audio-processing pipeline skips Bedrock analysis.
// Backed by /api/admin/pipeline-settings; persists to S3.
// ─────────────────────────────────────────────────────────────
interface PipelineSettingsResponse {
  minCallDurationSec: number;
  minTranscriptLength: number;
  minTranscriptConfidence: number;
  source: {
    minCallDurationSec: "default" | "env" | "override";
    minTranscriptLength: "default" | "env" | "override";
    minTranscriptConfidence: "default" | "env" | "override";
  };
  updatedAt?: string;
  updatedBy?: string;
}

function PipelineSettingsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PipelineSettingsResponse>({
    queryKey: ["/api/admin/pipeline-settings"],
  });

  const [draft, setDraft] = useState<{
    minCallDurationSec: string;
    minTranscriptLength: string;
    minTranscriptConfidence: string;
  }>({ minCallDurationSec: "", minTranscriptLength: "", minTranscriptConfidence: "" });

  // Populate the draft when the query resolves. Kept as strings so the
  // user can clear a field to type a new value without React numeric
  // coercion eating keystrokes.
  useEffect(() => {
    if (data) {
      setDraft({
        minCallDurationSec: String(data.minCallDurationSec),
        minTranscriptLength: String(data.minTranscriptLength),
        minTranscriptConfidence: String(data.minTranscriptConfidence),
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (patch: Record<string, number | null>) => {
      const res = await apiRequest("PATCH", "/api/admin/pipeline-settings", patch);
      return res.json() as Promise<PipelineSettingsResponse>;
    },
    onSuccess: () => {
      sharedQueryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline-settings"] });
      toast({ title: "Settings saved", description: "New thresholds apply to the next call processed." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const resetField = (key: "minCallDurationSec" | "minTranscriptLength" | "minTranscriptConfidence") => {
    // null = clear override, fall back to env/default baseline.
    saveMut.mutate({ [key]: null });
  };

  const handleSave = () => {
    const parsed: Record<string, number> = {};
    const fields: Array<[keyof typeof draft, number, number]> = [
      ["minCallDurationSec", 0, 600],
      ["minTranscriptLength", 0, 10_000],
      ["minTranscriptConfidence", 0, 1],
    ];
    for (const [key, lo, hi] of fields) {
      const n = parseFloat(draft[key]);
      if (!Number.isFinite(n) || n < lo || n > hi) {
        toast({
          title: "Invalid value",
          description: `${key}: must be a number between ${lo} and ${hi}.`,
          variant: "destructive",
        });
        return;
      }
      // Only send fields the admin actually changed.
      if (data && n !== data[key]) parsed[key] = n;
    }
    if (Object.keys(parsed).length === 0) {
      toast({ title: "No changes", description: "Nothing to save." });
      return;
    }
    saveMut.mutate(parsed);
  };

  if (isLoading || !data) {
    return <Skeleton className="h-64" />;
  }

  return (
    <AdminPanel>
      <div className="p-6">
        <AdminSectionHeader
          kicker="Runtime tuning"
          icon={Sliders}
          title="Pipeline quality gates"
          description="Thresholds that control when the audio-processing pipeline skips Bedrock analysis. Lower values process more calls (more AI spend); higher values skip more borderline recordings. Changes apply to the next call processed and survive restarts (persisted to S3)."
        />
        <div className="space-y-6 pt-2">
          <PipelineField
            label="Minimum call duration"
            unit="seconds"
            value={data.minCallDurationSec.toString()}
            source={data.source.minCallDurationSec}
            onReset={() => resetField("minCallDurationSec")}
            resetDisabled={saveMut.isPending}
            hint="Calls shorter than this skip AI analysis. Typical: 15s. Lower for short-form scripts."
          >
            <Input
              type="number"
              min={0}
              max={600}
              step={1}
              value={draft.minCallDurationSec}
              onChange={(e) => setDraft({ ...draft, minCallDurationSec: e.target.value })}
              className="font-mono tabular-nums"
            />
          </PipelineField>

          <PipelineField
            label="Minimum transcript length"
            unit="characters"
            value={data.minTranscriptLength.toString()}
            source={data.source.minTranscriptLength}
            onReset={() => resetField("minTranscriptLength")}
            resetDisabled={saveMut.isPending}
            hint="Transcripts shorter than this skip AI. Typical: 10 chars. Prevents AI spend on garbled / empty recordings."
          >
            <Input
              type="number"
              min={0}
              max={10_000}
              step={1}
              value={draft.minTranscriptLength}
              onChange={(e) => setDraft({ ...draft, minTranscriptLength: e.target.value })}
              className="font-mono tabular-nums"
            />
          </PipelineField>

          <PipelineField
            label="Minimum transcript confidence"
            unit={`${Math.round(data.minTranscriptConfidence * 100)}%`}
            value={data.minTranscriptConfidence.toFixed(2)}
            source={data.source.minTranscriptConfidence}
            onReset={() => resetField("minTranscriptConfidence")}
            resetDisabled={saveMut.isPending}
            hint="AssemblyAI per-word confidence average below this skips AI. Typical: 0.60. Lower to 0.40–0.50 if poor-tier synthetic calls aren't clearing the gate."
          >
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.minTranscriptConfidence}
              onChange={(e) => setDraft({ ...draft, minTranscriptConfidence: e.target.value })}
              className="font-mono tabular-nums"
            />
          </PipelineField>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              {data.updatedAt ? (
                <>
                  Last changed {new Date(data.updatedAt).toLocaleString()}
                  {data.updatedBy ? ` · ${data.updatedBy}` : ""}
                </>
              ) : (
                <>Using env / default baseline</>
              )}
            </div>
            <Button onClick={handleSave} disabled={saveMut.isPending} data-testid="save-pipeline-settings">
              {saveMut.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </AdminPanel>
  );
}

/** Warm-paper source pill — renders "Default" / "Env var" / "Override" in mono. */
function AdminSourcePill({ src }: { src: "default" | "env" | "override" | "legacy-env" }) {
  if (src === "override")
    return <AdminStatusPill kind="approved">Override</AdminStatusPill>;
  if (src === "env") return <AdminStatusPill kind="neutral">Env var</AdminStatusPill>;
  if (src === "legacy-env") return <AdminStatusPill kind="neutral">Legacy env</AdminStatusPill>;
  return <AdminStatusPill kind="inactive">Default</AdminStatusPill>;
}

/** Warm-paper pipeline-setting field — label + current effective value +
 *  source pill + optional Reset link, followed by the numeric input. */
function PipelineField({
  label,
  unit,
  value,
  source,
  onReset,
  resetDisabled,
  hint,
  children,
}: {
  label: string;
  unit: string;
  value: string;
  source: "default" | "env" | "override";
  onReset: () => void;
  resetDisabled: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="min-w-0">
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.12em" }}
          >
            {label}
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span
              className="font-display font-medium tabular-nums text-foreground"
              style={{ fontSize: 20 }}
            >
              {value}
            </span>
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.08em" }}
            >
              {unit}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AdminSourcePill src={source} />
          {source === "override" && (
            <button
              type="button"
              className="font-mono uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
              onClick={onReset}
              disabled={resetDisabled}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {children}
      <p className="text-xs text-muted-foreground mt-2" style={{ lineHeight: 1.5 }}>
        {hint}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI Model Tiers — runtime overrides for the Anthropic model IDs
// used across the app. Three tiers: strong (primary analysis),
// fast (short-call + scenario generator), reasoning (reserved).
// Backed by GET/PATCH /api/admin/model-tiers, persisted to S3.
// ─────────────────────────────────────────────────────────────
type TierName = "strong" | "fast" | "reasoning";

interface TierSnapshot {
  tier: TierName;
  effectiveModel: string;
  source: "override" | "env" | "legacy-env" | "default";
  override?: {
    model: string;
    updatedBy: string;
    updatedAt: string;
    reason?: string;
  };
  envValue?: string;
  defaultValue: string;
}

interface ModelTiersResponse {
  tiers: TierSnapshot[];
}

const TIER_META: Record<TierName, { label: string; purpose: string; usedBy: string }> = {
  strong: {
    label: "Strong (primary analysis)",
    purpose: "Sonnet-class. Used for call-transcript analysis, agent summaries, and the scenario rewriter.",
    usedBy: "Call pipeline (analyzeCallTranscript), agent profile summaries, script rewriter + generator when 'Use Sonnet' is toggled.",
  },
  fast: {
    label: "Fast (cost-optimized)",
    purpose: "Haiku-class. Used for short routine calls and script generation by default.",
    usedBy: "Short-call optimization in the pipeline, scenario generator default path.",
  },
  reasoning: {
    label: "Reasoning (reserved)",
    purpose: "Opus-class. Nothing reads it yet — reserved for future features that need extended reasoning.",
    usedBy: "Not currently invoked by any feature.",
  },
};

function ModelTiersCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ModelTiersResponse>({
    queryKey: ["/api/admin/model-tiers"],
  });

  const [drafts, setDrafts] = useState<Record<TierName, string>>({
    strong: "", fast: "", reasoning: "",
  });

  // Hydrate drafts from the response — only for tiers that don't already
  // have an in-flight edit (so a Save click doesn't snap to the old value
  // while the PATCH round-trip is pending).
  useEffect(() => {
    if (!data) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const snap of data.tiers) {
        if (!next[snap.tier]) next[snap.tier] = snap.effectiveModel;
      }
      return next;
    });
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (payload: { tier: TierName; model: string | null; reason?: string }) => {
      const res = await apiRequest("PATCH", "/api/admin/model-tiers", payload);
      return res.json() as Promise<ModelTiersResponse>;
    },
    onSuccess: () => {
      sharedQueryClient.invalidateQueries({ queryKey: ["/api/admin/model-tiers"] });
      toast({ title: "Model tier updated", description: "New model applies to the next Bedrock call." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      <AdminPanel>
        <div className="p-6">
          <AdminSectionHeader
            kicker="Anthropic routing"
            icon={Brain}
            title="AI model tiers"
            description="All Anthropic model IDs used across the app resolve through these three tiers. Override a tier when Anthropic ships a new model, AWS renames an inference profile, or you want to switch for cost/quality reasons. Changes apply to the next Bedrock call and survive restarts (persisted to S3)."
          />
        </div>
        <div className="border-t border-border">
          {data.tiers.map((snap) => (
            <ModelTierRow
              key={snap.tier}
              snap={snap}
              draft={drafts[snap.tier]}
              onChange={(v) => setDrafts({ ...drafts, [snap.tier]: v })}
              onSave={() =>
                saveMut.mutate({
                  tier: snap.tier,
                  model: drafts[snap.tier].trim(),
                  reason: "admin-ui",
                })
              }
              onReset={() => saveMut.mutate({ tier: snap.tier, model: null })}
              busy={saveMut.isPending}
            />
          ))}
        </div>
      </AdminPanel>

      <AdminPanel>
        <div className="p-6 space-y-2">
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Tips
          </div>
          <ul className="space-y-1.5 text-xs text-foreground" style={{ lineHeight: 1.55 }}>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>
                Use model IDs exactly as AWS Bedrock expects them (e.g.{" "}
                <code className="font-mono text-xs">us.anthropic.claude-sonnet-4-6</code> or{" "}
                <code className="font-mono text-xs">anthropic.claude-3-5-haiku-20241022-v1:0</code>). AWS rejects unknown strings with 400.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>
                Find valid IDs for your account + region via{" "}
                <code className="font-mono text-xs">aws bedrock list-foundation-models</code> or{" "}
                <code className="font-mono text-xs">aws bedrock list-inference-profiles</code> (requires the matching IAM action).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>Overriding "strong" also updates the batch-inference path — both on-demand and batch calls use the new model after save.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>
                If a tier's model ID is invalid, fallback logic in the script generator and short-call pipeline silently retries on the "strong" tier. You'll see a toast or pm2 warn when this happens.
              </span>
            </li>
          </ul>
        </div>
      </AdminPanel>
    </div>
  );
}

/** Warm-paper model-tier row — meta + controlled input + save/reset + variant metadata. */
function ModelTierRow({
  snap,
  draft,
  onChange,
  onSave,
  onReset,
  busy,
}: {
  snap: TierSnapshot;
  draft: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const meta = TIER_META[snap.tier];
  const isOverride = snap.source === "override";
  const canSave = !busy && draft !== snap.effectiveModel && !!draft.trim();
  return (
    <div className="p-6 border-b border-border last:border-b-0 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              {snap.tier}
            </div>
            <AdminSourcePill src={snap.source} />
          </div>
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 16, letterSpacing: "-0.1px", lineHeight: 1.2 }}
          >
            {meta.label}
          </div>
          <p className="text-xs text-muted-foreground mt-1" style={{ lineHeight: 1.5, maxWidth: 560 }}>
            {meta.purpose}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1" style={{ lineHeight: 1.5, maxWidth: 560 }}>
            <span
              className="font-mono uppercase"
              style={{ fontSize: 9, letterSpacing: "0.12em" }}
            >
              Used by
            </span>{" "}
            {meta.usedBy}
          </p>
        </div>
        {isOverride && (
          <button
            type="button"
            className="font-mono uppercase text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            onClick={onReset}
            disabled={busy}
          >
            Reset
          </button>
        )}
      </div>

      <div>
        <AdminFieldLabel>Effective model ID</AdminFieldLabel>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            placeholder={snap.defaultValue}
            className="font-mono text-xs"
          />
          <Button size="sm" disabled={!canSave} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-border">
        <ModelTierMeta label="Default" value={snap.defaultValue} />
        <ModelTierMeta label="Env var" value={snap.envValue ?? "— (unset)"} />
        <ModelTierMeta label="Override" value={snap.override?.model ?? "— (none)"} />
      </div>

      {snap.override && (
        <p
          className="font-mono text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.04em" }}
        >
          Set by {snap.override.updatedBy} on {new Date(snap.override.updatedAt).toLocaleString()}
          {snap.override.reason ? ` — ${snap.override.reason}` : ""}
        </p>
      )}
    </div>
  );
}

function ModelTierMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 9, letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      <div className="font-mono text-xs text-foreground break-all mt-1">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper admin primitives — shared visual vocabulary across the
// tab bodies. Mirrors the Reports SectionHeader/FilterLabel pattern
// so the app feels like one document, not five unrelated dashboards.
// ─────────────────────────────────────────────────────────────

/** Mono uppercase kicker + display-font title — opens every panel. */
function AdminSectionHeader({
  kicker,
  title,
  description,
  icon: Icon,
  action,
}: {
  kicker: string;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ style?: React.CSSProperties }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {Icon && <Icon style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {title}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5" style={{ maxWidth: 640 }}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Mono uppercase label — sits over inputs in admin forms. */
function AdminFieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono uppercase text-muted-foreground block mb-1.5"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </label>
  );
}

/** Warm-paper pill — request/status indicator, replaces colored badges. */
function AdminStatusPill({
  kind,
  children,
  icon: Icon,
}: {
  kind: "pending" | "approved" | "denied" | "inactive" | "neutral";
  children: React.ReactNode;
  icon?: React.ComponentType<{ style?: React.CSSProperties }>;
}) {
  const palette: Record<typeof kind, { bg: string; border: string; color: string }> = {
    pending: {
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 50%)",
      color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
    },
    approved: {
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "color-mix(in oklch, var(--sage), var(--ink) 25%)",
    },
    denied: {
      bg: "var(--warm-red-soft)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
      color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
    },
    inactive: {
      bg: "var(--paper-2)",
      border: "var(--border)",
      color: "var(--muted-foreground)",
    },
    neutral: {
      bg: "var(--card)",
      border: "var(--border)",
      color: "var(--foreground)",
    },
  };
  const p = palette[kind];
  return (
    <span
      className="font-mono uppercase inline-flex items-center gap-1 rounded-sm px-2 py-1"
      style={{
        fontSize: 9,
        letterSpacing: "0.1em",
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.color,
      }}
    >
      {Icon && <Icon style={{ width: 10, height: 10 }} />}
      {children}
    </span>
  );
}

/** Warm-paper role indicator — replaces the colored shadcn Badge. */
function AdminRolePill({ role }: { role: string }) {
  const label = ROLE_CONFIG[role]?.label || role;
  return <AdminStatusPill kind="neutral">{label}</AdminStatusPill>;
}

/** Hairline-separated row — document-like layout used for user/request lists. */
function AdminListRow({
  children,
  faded = false,
}: {
  children: React.ReactNode;
  faded?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0"
      style={{ opacity: faded ? 0.55 : 1 }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Role-definition row — two-column grid with per-role capability
// matrix. Uses ✓/✕ glyphs with sage/muted coloring instead of the
// prior colored pills so the overall page stays document-like.
// ─────────────────────────────────────────────────────────────
const ROLE_CAPABILITIES: Record<string, Array<[boolean, string]>> = {
  viewer: [
    [true, "View dashboard & metrics"],
    [true, "View call transcripts"],
    [true, "View reports & charts"],
    [true, "View employee profiles"],
    [true, "Search calls"],
    [true, "Play audio recordings"],
    [false, "Upload calls"],
    [false, "Edit analysis"],
    [false, "Delete calls"],
    [false, "Manage employees"],
  ],
  manager: [
    [true, "All Viewer permissions"],
    [true, "Upload call recordings"],
    [true, "Assign calls to employees"],
    [true, "Edit call analysis"],
    [true, "Manage employees"],
    [true, "Export reports"],
    [true, "Delete calls"],
    [false, "Manage users"],
    [false, "Approve access requests"],
    [false, "Bulk import"],
  ],
  admin: [
    [true, "All Manager permissions"],
    [true, "Manage users & roles"],
    [true, "Approve/deny access requests"],
    [true, "Bulk CSV import"],
    [true, "System configuration"],
    [true, "Full API access"],
  ],
};

function RoleDefinitionRow({
  role,
}: {
  role: { value: string; label: string; description: string };
}) {
  const caps = ROLE_CAPABILITIES[role.value] || [];
  return (
    <div className="flex gap-6 p-6 border-b border-border last:border-b-0">
      <div className="shrink-0" style={{ width: 200 }}>
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {role.value}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {role.label}
        </div>
        <p className="text-xs text-muted-foreground mt-2" style={{ lineHeight: 1.5 }}>
          {role.description}
        </p>
      </div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {caps.map(([allowed, label], i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-sm"
            style={{ color: allowed ? "var(--foreground)" : "var(--muted-foreground)" }}
          >
            {allowed ? (
              <CheckCircle
                style={{ width: 13, height: 13, color: "var(--sage)", flexShrink: 0 }}
                weight="bold"
              />
            ) : (
              <XCircle
                style={{ width: 13, height: 13, color: "var(--muted-foreground)", flexShrink: 0, opacity: 0.5 }}
              />
            )}
            <span style={{ textDecoration: allowed ? "none" : "line-through", textDecorationColor: "color-mix(in oklch, var(--muted-foreground), transparent 60%)" }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Warm-paper error state used by tab bodies when a query fails. */
function AccessRequestsErrorState({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-sm"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "14px 18px",
      }}
    >
      <Warning style={{ width: 16, height: 16, color: "var(--destructive)", marginTop: 1, flexShrink: 0 }} />
      <div>
        <div
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--destructive)" }}
        >
          Load failed
        </div>
        <p className="text-sm text-foreground mt-1">{message}</p>
      </div>
    </div>
  );
}

/** Warm-paper inline panel (create/edit forms) — bordered paper-card shell. */
function AdminPanel({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className="rounded-sm border bg-card"
      style={{
        borderColor:
          tone === "accent"
            ? "color-mix(in oklch, var(--accent), transparent 60%)"
            : "var(--border)",
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper admin-tab button — mono uppercase with an optional badge
// (used for the "Access Requests · N pending" indicator).
// ─────────────────────────────────────────────────────────────
function AdminTab({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background border border-foreground"
          : "bg-card border border-border text-foreground hover:bg-secondary"
      }`}
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      <Icon style={{ width: 12, height: 12 }} />
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full tabular-nums"
          style={{
            width: 16,
            height: 16,
            fontSize: 9,
            background: active ? "var(--background)" : "var(--amber)",
            color: active ? "var(--foreground)" : "var(--paper)",
            marginLeft: 2,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
