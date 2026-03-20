import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Bell, CheckCircle, FileX, Key, Shield, Warning, XCircle } from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SecuritySummary {
  totalAlerts: number;
  unacknowledgedAlerts: number;
  criticalAlerts: number;
  activeBreach: boolean;
  mfaEnforcementEnabled: boolean;
  recentAlertTypes: Record<string, number>;
}

interface SecurityAlert {
  id: string;
  timestamp: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, unknown>;
  acknowledged: boolean;
}

interface BreachReport {
  id: string;
  reportedAt: string;
  reportedBy: string;
  description: string;
  affectedIndividuals: number;
  dataTypes: string[];
  discoveryDate: string;
  containmentActions: string;
  notificationStatus: "pending" | "notified" | "resolved";
  timeline: Array<{ timestamp: string; action: string; actor: string }>;
}

interface MFAUser {
  username: string;
  enabled: boolean;
  createdAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function SecurityPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: summary } = useQuery<SecuritySummary>({
    queryKey: ["/api/admin/security-summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000,
  });

  const { data: alerts = [] } = useQuery<SecurityAlert[]>({
    queryKey: ["/api/admin/security-alerts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000,
  });

  const { data: breaches = [] } = useQuery<BreachReport[]>({
    queryKey: ["/api/admin/breach-reports"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: mfaUsers = [] } = useQuery<MFAUser[]>({
    queryKey: ["/api/auth/mfa/users"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("PATCH", `/api/admin/security-alerts/${alertId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security-summary"] });
    },
  });

  // Breach report form state
  const [showBreachForm, setShowBreachForm] = useState(false);
  const [breachDesc, setBreachDesc] = useState("");
  const [breachAffected, setBreachAffected] = useState("");
  const [breachDiscovery, setBreachDiscovery] = useState("");
  const [breachContainment, setBreachContainment] = useState("");
  const [breachDataTypes, setBreachDataTypes] = useState("");

  const createBreachMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/breach-reports", {
        description: breachDesc,
        affectedIndividuals: parseInt(breachAffected) || 0,
        dataTypes: breachDataTypes.split(",").map((s) => s.trim()).filter(Boolean),
        discoveryDate: breachDiscovery,
        containmentActions: breachContainment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/breach-reports"] });
      setShowBreachForm(false);
      setBreachDesc(""); setBreachAffected(""); setBreachDiscovery(""); setBreachContainment(""); setBreachDataTypes("");
      toast({ title: "Breach Report Filed", description: "Incident has been logged to the HIPAA audit trail." });
    },
    onError: () => toast({ title: "Error", description: "Failed to create breach report", variant: "destructive" }),
  });

  const updateBreachMutation = useMutation({
    mutationFn: async ({ id, status, action }: { id: string; status: string; action: string }) => {
      await apiRequest("PATCH", `/api/admin/breach-reports/${id}`, { status, action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/breach-reports"] });
      toast({ title: "Breach Status Updated" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Security & Compliance</h1>
        <p className="text-muted-foreground">HIPAA security monitoring, breach management, and MFA status</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Alerts</span>
            </div>
            <div className="text-2xl font-bold mt-1">{summary?.unacknowledgedAlerts ?? 0}</div>
            <p className="text-xs text-muted-foreground">unacknowledged</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Warning className="w-4 h-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Critical</span>
            </div>
            <div className="text-2xl font-bold mt-1">{summary?.criticalAlerts ?? 0}</div>
            <p className="text-xs text-muted-foreground">critical alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <FileX className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Active Breach</span>
            </div>
            <div className="text-2xl font-bold mt-1">{summary?.activeBreach ? "Yes" : "None"}</div>
            <p className="text-xs text-muted-foreground">{breaches.filter((b) => b.notificationStatus !== "resolved").length} open reports</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">MFA</span>
            </div>
            <div className="text-2xl font-bold mt-1">{mfaUsers.length}</div>
            <p className="text-xs text-muted-foreground">users with MFA enabled{summary?.mfaEnforcementEnabled ? " (enforced)" : ""}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Security Alerts</TabsTrigger>
          <TabsTrigger value="breaches">Breach Reports</TabsTrigger>
          <TabsTrigger value="mfa">MFA Status</TabsTrigger>
        </TabsList>

        {/* ALERTS TAB */}
        <TabsContent value="alerts" className="space-y-3 mt-4">
          {alerts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No security alerts. All systems normal.</CardContent></Card>
          ) : (
            alerts.map((alert) => (
              <Card key={alert.id} className={alert.acknowledged ? "opacity-60" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[alert.severity]}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium">{alert.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {Object.entries(alert.details).map(([k, v]) => (
                            <span key={k} className="mr-3">{k}: <strong>{String(v)}</strong></span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {!alert.acknowledged && (
                      <Button size="sm" variant="outline" onClick={() => acknowledgeAlertMutation.mutate(alert.id)}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Acknowledge
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* BREACHES TAB */}
        <TabsContent value="breaches" className="space-y-4 mt-4">
          <Button onClick={() => setShowBreachForm(!showBreachForm)} variant={showBreachForm ? "secondary" : "default"}>
            <FileX className="w-4 h-4 mr-2" />
            {showBreachForm ? "Cancel" : "Report New Breach"}
          </Button>

          {showBreachForm && (
            <Card>
              <CardHeader><CardTitle className="text-lg">New Breach Report (HIPAA 164.408)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Input value={breachDesc} onChange={(e) => setBreachDesc(e.target.value)} placeholder="What happened?" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Discovery Date</label>
                    <Input type="date" value={breachDiscovery} onChange={(e) => setBreachDiscovery(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Affected Individuals</label>
                    <Input type="number" value={breachAffected} onChange={(e) => setBreachAffected(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Data Types Involved</label>
                  <Input value={breachDataTypes} onChange={(e) => setBreachDataTypes(e.target.value)} placeholder="PHI, audio recordings, transcripts (comma-separated)" />
                </div>
                <div>
                  <label className="text-sm font-medium">Containment Actions Taken</label>
                  <Input value={breachContainment} onChange={(e) => setBreachContainment(e.target.value)} placeholder="What steps were taken to contain the breach?" />
                </div>
                <Button onClick={() => createBreachMutation.mutate()} disabled={!breachDesc || !breachDiscovery}>
                  Submit Breach Report
                </Button>
              </CardContent>
            </Card>
          )}

          {breaches.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No breach reports on file.</CardContent></Card>
          ) : (
            breaches.map((breach) => (
              <Card key={breach.id}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          breach.notificationStatus === "resolved" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" :
                          breach.notificationStatus === "notified" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" :
                          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        }`}>
                          {breach.notificationStatus.toUpperCase()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Reported by {breach.reportedBy} on {new Date(breach.reportedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="font-medium mt-1">{breach.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {breach.affectedIndividuals} individuals affected | Discovered: {breach.discoveryDate}
                      </p>
                      {breach.dataTypes.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {breach.dataTypes.map((dt) => (
                            <span key={dt} className="px-1.5 py-0.5 bg-muted rounded text-xs">{dt}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {breach.notificationStatus !== "resolved" && (
                      <div className="flex gap-2">
                        {breach.notificationStatus === "pending" && (
                          <Button size="sm" variant="outline" onClick={() => updateBreachMutation.mutate({
                            id: breach.id, status: "notified", action: "Affected individuals notified"
                          })}>
                            Mark Notified
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => updateBreachMutation.mutate({
                          id: breach.id, status: "resolved", action: "Breach resolved and documented"
                        })}>
                          Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                  {/* Timeline */}
                  {breach.timeline.length > 0 && (
                    <div className="border-t pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Timeline</p>
                      {breach.timeline.map((entry, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex gap-2">
                          <span>{new Date(entry.timestamp).toLocaleString()}</span>
                          <span>—</span>
                          <span>{entry.action} ({entry.actor})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* MFA TAB */}
        <TabsContent value="mfa" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">MFA-Enabled Users</CardTitle>
              <CardDescription>
                {summary?.mfaEnforcementEnabled
                  ? "MFA enforcement is ON — all users are required to set up two-factor authentication."
                  : "MFA enforcement is OFF. Set REQUIRE_MFA=true to enforce for all users."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mfaUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No users have MFA enabled yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left py-2 font-medium">Username</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Enabled Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mfaUsers.map((u) => (
                      <tr key={u.username} className="border-b border-muted/50">
                        <td className="py-2 font-medium">{u.username}</td>
                        <td className="py-2">
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-3.5 h-3.5" /> Active
                          </span>
                        </td>
                        <td className="py-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
