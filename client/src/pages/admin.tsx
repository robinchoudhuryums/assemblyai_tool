import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, UserPlus, CheckCircle2, XCircle, Clock, Eye, Settings, ChevronRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { USER_ROLES } from "@shared/schema";
import type { AccessRequest } from "@shared/schema";

type TabView = "requests" | "roles";

export default function AdminPage() {
  const [tab, setTab] = useState<TabView>("requests");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery<AccessRequest[]>({
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
          ? "You can now add this user to AUTH_USERS with the approved role."
          : "The access request has been denied.",
      });
    },
    onError: (error) => {
      toast({ title: "Action Failed", description: error.message, variant: "destructive" });
    },
  });

  const pendingRequests = requests?.filter(r => r.status === "pending") || [];
  const reviewedRequests = requests?.filter(r => r.status !== "pending") || [];

  const roleIcons: Record<string, React.ReactNode> = {
    viewer: <Eye className="w-4 h-4 text-blue-500" />,
    manager: <Settings className="w-4 h-4 text-amber-500" />,
    admin: <Shield className="w-4 h-4 text-purple-500" />,
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
      case "denied":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"><XCircle className="w-3 h-3 mr-1" />Denied</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      viewer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    const labels: Record<string, string> = { viewer: "Viewer", manager: "Manager / QA", admin: "Admin" };
    return <Badge className={colors[role] || "bg-gray-100 text-gray-800"}>{labels[role] || role}</Badge>;
  };

  return (
    <div className="min-h-screen" data-testid="admin-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Administration</h2>
            <p className="text-muted-foreground">Manage access requests and user permissions</p>
          </div>
          {pendingRequests.length > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-sm px-3 py-1">
              {pendingRequests.length} pending request{pendingRequests.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <Button
            variant={tab === "requests" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("requests")}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Access Requests
            {pendingRequests.length > 0 && (
              <span className="ml-2 bg-yellow-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {pendingRequests.length}
              </span>
            )}
          </Button>
          <Button
            variant={tab === "roles" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("roles")}
          >
            <Shield className="w-4 h-4 mr-2" />
            Role Definitions
          </Button>
        </div>

        {/* ACCESS REQUESTS TAB */}
        {tab === "requests" && (
          <div className="space-y-6">
            {/* Pending Requests */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="w-5 h-5 text-yellow-500" />
                  Pending Requests ({pendingRequests.length})
                </CardTitle>
                <CardDescription>
                  Review and approve or deny access requests. After approving, add the user to your AUTH_USERS environment variable with their assigned role.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
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
                  <div className="text-center py-12">
                    <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-100 to-green-50 dark:from-green-900/30 dark:to-green-900/10 rounded-full flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-7 h-7 text-green-500" />
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
                          {req.reason && (
                            <p className="text-xs text-muted-foreground mt-1">"{req.reason}"</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Requested {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "recently"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => reviewMutation.mutate({ id: req.id, status: "approved" })}
                            disabled={reviewMutation.isPending}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => reviewMutation.mutate({ id: req.id, status: "denied" })}
                            disabled={reviewMutation.isPending}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Deny
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reviewed Requests History */}
            {reviewedRequests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Review History</CardTitle>
                </CardHeader>
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
                        {req.reviewedAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(req.reviewedAt).toLocaleDateString()}
                          </span>
                        )}
                        {req.reviewedBy && (
                          <span className="text-xs text-muted-foreground">by {req.reviewedBy}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Setup instructions */}
            <Card className="border-dashed bg-muted/30">
              <CardContent className="pt-6">
                <h4 className="text-sm font-semibold text-foreground mb-2">Setting Up New Users</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  After approving a request, add the user to your <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">AUTH_USERS</code> environment variable:
                </p>
                <div className="bg-background border border-border rounded-md p-3 font-mono text-xs text-foreground">
                  AUTH_USERS=admin:password:admin:Admin Name,<span className="text-primary">newuser:password:viewer:Their Name</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Format: <code className="bg-muted px-1 py-0.5 rounded font-mono">username:password:role:displayName</code> — Roles: <strong>viewer</strong>, <strong>manager</strong>, <strong>admin</strong>
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ROLE DEFINITIONS TAB */}
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

                      {/* Permission details per role */}
                      {role.value === "viewer" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> View dashboard & metrics</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> View call transcripts</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> View reports & charts</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> View employee profiles</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Search calls</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Play audio recordings</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Upload calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Edit analysis</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Delete calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Manage employees</div>
                        </div>
                      )}
                      {role.value === "manager" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> All Viewer permissions</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Upload call recordings</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Assign calls to employees</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Edit call analysis</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Manage employees</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Export reports</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Delete calls</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Manage users</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Approve access requests</div>
                          <div className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" /> Bulk import</div>
                        </div>
                      )}
                      {role.value === "admin" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> All Manager permissions</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Manage users & roles</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Approve/deny access requests</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Bulk CSV import</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> System configuration</div>
                          <div className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="w-3 h-3" /> Full API access</div>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
