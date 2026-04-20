import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Brain, CheckCircle, Clock, Eye, Gear, Key, Lock, PencilSimple, Shield, Sliders, Trash, UserPlus, Users, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as sharedQueryClient } from "@/lib/queryClient";
import { USER_ROLES } from "@shared/schema";
import type { AccessRequest } from "@shared/schema";
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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", password: "", displayName: "", role: "viewer" });
  const [editingUser, setEditingUser] = useState<DbUser | null>(null);
  const [editForm, setEditForm] = useState({ displayName: "", role: "", active: true });
  const [resetPasswordUser, setResetPasswordUser] = useState<DbUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const res = await apiRequest("POST", "/api/users", data);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowCreateForm(false);
      setCreateForm({ username: "", password: "", displayName: "", role: "viewer" });
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

  // ── Shared helpers ──
  const roleIcons: Record<string, React.ReactNode> = {
    viewer: <Eye className="w-4 h-4 text-blue-500" />,
    manager: <Gear className="w-4 h-4 text-amber-500" />,
    admin: <Shield className="w-4 h-4 text-purple-500" />,
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case "denied":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"><XCircle className="w-3 h-3 mr-1" />Denied</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const roleBadge = (role: string) => {
    const config = ROLE_CONFIG[role];
    return <Badge className={config?.badgeClass || "bg-gray-100 text-gray-800"}>{config?.label || role}</Badge>;
  };

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
          <div className="space-y-6">
            {/* Create User */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    User Accounts
                  </CardTitle>
                  <CardDescription>Create and manage database-backed user accounts.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  {showCreateForm ? "Cancel" : "Create User"}
                </Button>
              </CardHeader>
              <CardContent>
                {/* Create form */}
                {showCreateForm && (
                  <form
                    className="mb-6 p-4 rounded-lg border border-border bg-muted/30 space-y-3"
                    onSubmit={(e) => { e.preventDefault(); createUserMutation.mutate(createForm); }}
                  >
                    <h4 className="font-semibold text-sm text-foreground">New User</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Username</label>
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={createForm.username}
                          onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
                          required
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Display Name</label>
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={createForm.displayName}
                          onChange={(e) => setCreateForm(f => ({ ...f, displayName: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Password</label>
                        <input
                          type="password"
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={createForm.password}
                          onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                          required
                          autoComplete="new-password"
                          placeholder="Min 12 chars, upper/lower/digit/special"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Role</label>
                        <select
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={createForm.role}
                          onChange={(e) => setCreateForm(f => ({ ...f, role: e.target.value }))}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager / QA</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>Cancel</Button>
                      <Button type="submit" size="sm" disabled={createUserMutation.isPending}>
                        {createUserMutation.isPending ? "Creating..." : "Create User"}
                      </Button>
                    </div>
                  </form>
                )}

                {/* User list */}
                {usersError ? (
                  <div className="text-center py-12 text-destructive">
                    <Shield className="w-8 h-8 mx-auto mb-2" />
                    <p className="font-semibold">Failed to load users</p>
                    <p className="text-sm text-muted-foreground">{usersError.message}</p>
                  </div>
                ) : usersLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1.5 flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div>
                      </div>
                    ))}
                  </div>
                ) : !users || users.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No database users yet. Create one above or use AUTH_USERS env var for bootstrapping.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {users.map((user) => (
                      <div key={user.id} className={`flex items-center gap-4 p-3 rounded-lg border border-border ${!user.active ? "opacity-50 bg-muted/20" : "bg-muted/30"}`}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary/10 shrink-0">
                          {roleIcons[user.role] || <Users className="w-5 h-5 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground text-sm">{user.displayName}</p>
                            {roleBadge(user.role)}
                            {!user.active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">@{user.username}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(user)} title="Edit user">
                            <PencilSimple className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setResetPasswordUser(user); setNewPassword(""); }} title="Reset password">
                            <Key className="w-4 h-4" />
                          </Button>
                          {user.active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => {
                                if (confirm(`Deactivate ${user.displayName}? They will no longer be able to log in.`)) {
                                  deactivateUserMutation.mutate(user.id);
                                }
                              }}
                              title="Deactivate user"
                            >
                              <Trash className="w-4 h-4" />
                            </Button>
                          )}
                          {!user.active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-green-600"
                              onClick={() => updateUserMutation.mutate({ id: user.id, data: { active: true } })}
                              title="Reactivate user"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Edit user dialog (inline) */}
            {editingUser && (
              <Card className="border-primary/50">
                <CardHeader>
                  <CardTitle className="text-lg">Edit User: {editingUser.displayName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data: Record<string, unknown> = {};
                      if (editForm.displayName !== editingUser.displayName) data.displayName = editForm.displayName;
                      if (editForm.role !== editingUser.role) data.role = editForm.role;
                      if (editForm.active !== editingUser.active) data.active = editForm.active;
                      if (Object.keys(data).length === 0) { setEditingUser(null); return; }
                      updateUserMutation.mutate({ id: editingUser.id, data });
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Display Name</label>
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={editForm.displayName}
                          onChange={(e) => setEditForm(f => ({ ...f, displayName: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Role</label>
                        <select
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={editForm.role}
                          onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager / QA</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <select
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                          value={editForm.active ? "active" : "inactive"}
                          onChange={(e) => setEditForm(f => ({ ...f, active: e.target.value === "active" }))}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingUser(null)}>Cancel</Button>
                      <Button type="submit" size="sm" disabled={updateUserMutation.isPending}>
                        {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Reset password dialog (inline) */}
            {resetPasswordUser && (
              <Card className="border-primary/50">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Key className="w-5 h-5" />
                    Reset Password: {resetPasswordUser.displayName}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => { e.preventDefault(); resetPasswordMutation.mutate({ id: resetPasswordUser.id, newPassword }); }}
                  >
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">New Password</label>
                      <input
                        type="password"
                        className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="Min 12 chars, upper/lower/digit/special"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setResetPasswordUser(null)}>Cancel</Button>
                      <Button type="submit" size="sm" disabled={resetPasswordMutation.isPending}>
                        {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ════════════════ ACCESS REQUESTS TAB ════════════════ */}
        {tab === "requests" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="w-5 h-5 text-yellow-500" />
                  Pending Requests ({pendingRequests.length})
                </CardTitle>
                <CardDescription>
                  Review and approve or deny access requests. After approving, create the user account in the Users tab with their assigned role.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {requestsError ? (
                  <div className="text-center py-12 text-destructive">
                    <Shield className="w-8 h-8 mx-auto mb-2" />
                    <p className="font-semibold">Failed to load access requests</p>
                    <p className="text-sm text-muted-foreground">{requestsError.message}</p>
                  </div>
                ) : requestsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1.5 flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div>
                        <Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" />
                      </div>
                    ))}
                  </div>
                ) : pendingRequests.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-100 to-green-50 dark:from-green-900/30 dark:to-green-900/10 rounded-full flex items-center justify-center mb-3">
                      <CheckCircle className="w-7 h-7 text-green-500" />
                    </div>
                    <p className="text-sm text-muted-foreground">No pending access requests</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingRequests.map((req) => (
                      <div key={req.id} className="flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30">
                        <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="font-semibold text-foreground">{req.name}</p>
                            {roleBadge(req.requestedRole)}
                          </div>
                          <p className="text-sm text-muted-foreground">{req.email}</p>
                          {req.reason && <p className="text-xs text-muted-foreground mt-1">"{req.reason}"</p>}
                          <p className="text-xs text-muted-foreground mt-1">
                            Requested {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "recently"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button size="sm" onClick={() => reviewMutation.mutate({ id: req.id, status: "approved" })} disabled={reviewMutation.isPending}>
                            <CheckCircle className="w-4 h-4 mr-1" />Approve
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => reviewMutation.mutate({ id: req.id, status: "denied" })}
                            disabled={reviewMutation.isPending}
                          >
                            <XCircle className="w-4 h-4 mr-1" />Deny
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {reviewedRequests.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Review History</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {reviewedRequests.map((req) => (
                      <div key={req.id} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{req.name}</p>
                            <span className="text-xs text-muted-foreground">({req.email})</span>
                          </div>
                        </div>
                        {roleBadge(req.requestedRole)}
                        {statusBadge(req.status)}
                        {req.reviewedAt && <span className="text-xs text-muted-foreground">{new Date(req.reviewedAt).toLocaleDateString()}</span>}
                        {req.reviewedBy && <span className="text-xs text-muted-foreground">by {req.reviewedBy}</span>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ════════════════ ROLE DEFINITIONS TAB ════════════════ */}
        {tab === "roles" && (
          <div className="space-y-4">
            {USER_ROLES.map((role) => (
              <Card key={role.value}>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted shrink-0">
                      {roleIcons[role.value]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{role.label}</h3>
                        {roleBadge(role.value)}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{role.description}</p>

                      {role.value === "viewer" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> View dashboard & metrics</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> View call transcripts</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> View reports & charts</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> View employee profiles</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Search calls</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Play audio recordings</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Upload calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Edit analysis</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Delete calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Manage employees</div>
                        </div>
                      )}
                      {role.value === "manager" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> All Viewer permissions</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Upload call recordings</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Assign calls to employees</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Edit call analysis</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Manage employees</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Export reports</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Delete calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Manage users</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Approve access requests</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Bulk import</div>
                        </div>
                      )}
                      {role.value === "admin" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> All Manager permissions</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Manage users & roles</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Approve/deny access requests</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Bulk CSV import</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> System configuration</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="w-3 h-3" /> Full API access</div>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
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

  const sourceBadge = (src: "default" | "env" | "override") => {
    const color = src === "override" ? "bg-purple-200 text-purple-900" : src === "env" ? "bg-blue-200 text-blue-900" : "bg-gray-200 text-gray-900";
    const label = src === "override" ? "Override" : src === "env" ? "Env var" : "Default";
    return <Badge className={`${color} text-[10px]`}>{label}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sliders className="w-5 h-5" />
          Pipeline Quality Gates
        </CardTitle>
        <CardDescription>
          Thresholds that control when the audio-processing pipeline skips Bedrock analysis. Lower values process more calls (more AI spend); higher values skip more borderline recordings.
          Changes apply to the next call processed and survive server restarts (persisted to S3).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Minimum call duration (seconds): <strong>{data.minCallDurationSec}</strong></Label>
            <div className="flex items-center gap-2">
              {sourceBadge(data.source.minCallDurationSec)}
              {data.source.minCallDurationSec === "override" && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => resetField("minCallDurationSec")} disabled={saveMut.isPending}>Reset</button>
              )}
            </div>
          </div>
          <Input
            type="number"
            min={0}
            max={600}
            step={1}
            value={draft.minCallDurationSec}
            onChange={(e) => setDraft({ ...draft, minCallDurationSec: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">Calls shorter than this skip AI analysis. Typical: 15s. Lower for short-form scripts.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Minimum transcript length (characters): <strong>{data.minTranscriptLength}</strong></Label>
            <div className="flex items-center gap-2">
              {sourceBadge(data.source.minTranscriptLength)}
              {data.source.minTranscriptLength === "override" && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => resetField("minTranscriptLength")} disabled={saveMut.isPending}>Reset</button>
              )}
            </div>
          </div>
          <Input
            type="number"
            min={0}
            max={10_000}
            step={1}
            value={draft.minTranscriptLength}
            onChange={(e) => setDraft({ ...draft, minTranscriptLength: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">Transcripts shorter than this skip AI. Typical: 10 chars. Prevents AI spend on garbled / empty recordings.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Minimum transcript confidence: <strong>{data.minTranscriptConfidence.toFixed(2)}</strong> ({Math.round(data.minTranscriptConfidence * 100)}%)</Label>
            <div className="flex items-center gap-2">
              {sourceBadge(data.source.minTranscriptConfidence)}
              {data.source.minTranscriptConfidence === "override" && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => resetField("minTranscriptConfidence")} disabled={saveMut.isPending}>Reset</button>
              )}
            </div>
          </div>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.minTranscriptConfidence}
            onChange={(e) => setDraft({ ...draft, minTranscriptConfidence: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            AssemblyAI per-word confidence average below this skips AI. Typical: 0.60. Lower to 0.40–0.50 if poor-tier synthetic calls (disfluency-heavy) aren't clearing the gate.
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-xs text-muted-foreground">
            {data.updatedAt ? (
              <>Last changed {new Date(data.updatedAt).toLocaleString()}{data.updatedBy ? ` by ${data.updatedBy}` : ""}.</>
            ) : (
              <>Using env / default baseline (no admin overrides).</>
            )}
          </div>
          <Button onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
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

  const sourceBadge = (src: TierSnapshot["source"]) => {
    const map: Record<TierSnapshot["source"], { color: string; label: string }> = {
      override:    { color: "bg-purple-200 text-purple-900", label: "Admin override" },
      env:         { color: "bg-blue-200 text-blue-900",     label: "Env var" },
      "legacy-env":{ color: "bg-cyan-200 text-cyan-900",     label: "Legacy env var" },
      default:     { color: "bg-gray-200 text-gray-900",     label: "Baked-in default" },
    };
    const { color, label } = map[src];
    return <Badge className={`${color} text-[10px]`}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Model Tiers
          </CardTitle>
          <CardDescription>
            All Anthropic model IDs used across the app resolve through these three tiers. Set an override when
            Anthropic ships a new model, AWS renames an inference profile, or you want to switch a specific tier
            for cost/quality reasons. Changes apply to the next Bedrock call and survive restarts (persisted to S3).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.tiers.map((snap) => {
            const meta = TIER_META[snap.tier];
            const isOverride = snap.source === "override";
            return (
              <div key={snap.tier} className="space-y-2 pb-6 border-b last:border-b-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Label className="text-base font-semibold">{meta.label}</Label>
                      {sourceBadge(snap.source)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{meta.purpose}</p>
                    <p className="text-[11px] text-muted-foreground mt-1"><strong>Used by:</strong> {meta.usedBy}</p>
                  </div>
                  {isOverride && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => saveMut.mutate({ tier: snap.tier, model: null })}
                      disabled={saveMut.isPending}
                    >
                      Reset to default
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Effective model ID
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={drafts[snap.tier]}
                      onChange={(e) => setDrafts({ ...drafts, [snap.tier]: e.target.value })}
                      placeholder={snap.defaultValue}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      disabled={saveMut.isPending || drafts[snap.tier] === snap.effectiveModel || !drafts[snap.tier].trim()}
                      onClick={() => saveMut.mutate({
                        tier: snap.tier,
                        model: drafts[snap.tier].trim(),
                        reason: "admin-ui",
                      })}
                    >
                      Save
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <div>
                      <div className="font-medium text-foreground mb-0.5">Default</div>
                      <div className="font-mono break-all">{snap.defaultValue}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground mb-0.5">Env var</div>
                      <div className="font-mono break-all">{snap.envValue ?? "— (unset)"}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground mb-0.5">Override</div>
                      <div className="font-mono break-all">{snap.override?.model ?? "— (none)"}</div>
                    </div>
                  </div>

                  {snap.override && (
                    <p className="text-[10px] text-muted-foreground">
                      Set by {snap.override.updatedBy} on {new Date(snap.override.updatedAt).toLocaleString()}
                      {snap.override.reason ? ` — ${snap.override.reason}` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-4 text-xs space-y-2">
          <p className="font-medium">Tips</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Use model IDs exactly as AWS Bedrock expects them (e.g. <code className="font-mono">us.anthropic.claude-sonnet-4-6</code> or
              {" "}<code className="font-mono">anthropic.claude-3-5-haiku-20241022-v1:0</code>). AWS rejects unknown strings with 400.
            </li>
            <li>
              Find valid IDs for your account + region via <code className="font-mono">aws bedrock list-foundation-models</code> or
              {" "}<code className="font-mono">aws bedrock list-inference-profiles</code> (requires the matching IAM action).
            </li>
            <li>
              Overriding "strong" also updates the batch-inference path — both on-demand and batch calls use the new model after save.
            </li>
            <li>
              If a tier's model ID is invalid, fallback logic in the script generator and short-call pipeline silently retries on the "strong" tier. You'll see a toast or pm2 warn when this happens.
            </li>
          </ul>
        </CardContent>
      </Card>
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
