import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SCORE_EXCELLENT, SCORE_GOOD } from "@/lib/constants";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaretDown, CaretRight, Clock, DownloadSimple, TrendUp, Users } from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface TeamData {
  team: string;
  employeeCount: number;
  callCount: number;
  avgScore: number | null;
  avgConfidence: number | null;
  completedCalls: number;
  failedCalls: number;
  avgDuration: number | null;
  employees: string[];
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  pseudonym: string | null;
  callCount: number;
  avgScore: number | null;
  avgDuration: number | null;
  lastCallDate: string | null;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

function formatDuration(seconds: number | null): string {
  if (!seconds) return "N/A";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-sm">N/A</span>;
  const color = score >= SCORE_EXCELLENT * 10 ? "bg-green-500" : score >= SCORE_GOOD * 10 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2 max-w-[100px]">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className="text-sm font-medium w-8">{score}</span>
    </div>
  );
}

function TeamDetail({ teamName }: { teamName: string }) {
  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/analytics/team", teamName],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Loading team members...</div>;
  if (members.length === 0) return <div className="text-sm text-muted-foreground p-4">No active employees in this team.</div>;

  return (
    <div className="border-t mt-2 pt-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-1 px-2 font-medium">Employee</th>
            <th className="text-right py-1 px-2 font-medium">Calls</th>
            <th className="text-right py-1 px-2 font-medium">Avg Score</th>
            <th className="text-right py-1 px-2 font-medium">Avg Duration</th>
            <th className="text-right py-1 px-2 font-medium">Last Call</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-t border-muted/50">
              <td className="py-1.5 px-2">
                <span className="font-medium">{m.pseudonym || m.name}</span>
              </td>
              <td className="text-right py-1.5 px-2">{m.callCount}</td>
              <td className="text-right py-1.5 px-2"><ScoreBar score={m.avgScore} /></td>
              <td className="text-right py-1.5 px-2">{formatDuration(m.avgDuration)}</td>
              <td className="text-right py-1.5 px-2 text-muted-foreground">
                {m.lastCallDate ? new Date(m.lastCallDate).toLocaleDateString() : "Never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TeamAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.set("from", dateFrom);
  if (dateTo) queryParams.set("to", dateTo);
  const qs = queryParams.toString();

  const { data: teams = [], isLoading } = useQuery<TeamData[]>({
    queryKey: ["/api/analytics/teams", qs],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const chartData = teams
    .filter((t) => t.avgScore !== null)
    .map((t, i) => ({ name: t.team, score: t.avgScore, fill: COLORS[i % COLORS.length] }));

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    window.open(`/api/export/team-analytics?${params.toString()}`, "_blank");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Team Analytics</h1>
          <p className="text-muted-foreground">Compare performance across sub-teams</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <DownloadSimple className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Average Performance Score by Team</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" className="text-xs" interval={0} />
                <YAxis domain={[0, 100]} className="text-xs" />
                <Tooltip />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Team cards */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading team analytics...</div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No team data available. Assign employees to sub-teams to see analytics.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teams.map((team, idx) => (
            <Card key={team.team}>
              <CardContent className="pt-4">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedTeam(expandedTeam === team.team ? null : team.team)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <div>
                      <h3 className="font-semibold">{team.team}</h3>
                      <p className="text-xs text-muted-foreground">{team.employeeCount} employees</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{team.callCount} calls</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <TrendUp className="w-3.5 h-3.5 text-muted-foreground" />
                        <ScoreBar score={team.avgScore} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{formatDuration(team.avgDuration)}</span>
                      </div>
                    </div>
                    {expandedTeam === team.team ? (
                      <CaretDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <CaretRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
                {expandedTeam === team.team && <TeamDetail teamName={team.team} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
