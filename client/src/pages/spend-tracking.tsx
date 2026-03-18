import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, TrendingUp, Calendar, FlaskConical, Phone } from "lucide-react";
import { LoadingIndicator } from "@/components/ui/loading";
import { type UsageRecord } from "@shared/schema";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatCostPrecise(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

type Period = "current-month" | "last-month" | "ytd" | "all-time";

function filterByPeriod(records: UsageRecord[], period: Period): UsageRecord[] {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  switch (period) {
    case "current-month":
      return records.filter(r => new Date(r.timestamp) >= startOfMonth);
    case "last-month":
      return records.filter(r => {
        const d = new Date(r.timestamp);
        return d >= startOfLastMonth && d <= endOfLastMonth;
      });
    case "ytd":
      return records.filter(r => new Date(r.timestamp) >= startOfYear);
    case "all-time":
      return records;
  }
}

function computeStats(records: UsageRecord[]) {
  const totalCost = records.reduce((sum, r) => sum + r.totalEstimatedCost, 0);
  const assemblyaiCost = records.reduce((sum, r) => sum + (r.services.assemblyai?.estimatedCost || 0), 0);
  const bedrockCost = records.reduce((sum, r) =>
    sum + (r.services.bedrock?.estimatedCost || 0) + (r.services.bedrockSecondary?.estimatedCost || 0), 0);
  const callCount = records.filter(r => r.type === "call").length;
  const abTestCount = records.filter(r => r.type === "ab-test").length;
  const avgCostPerCall = callCount > 0 ? totalCost / (callCount + abTestCount) : 0;

  return { totalCost, assemblyaiCost, bedrockCost, callCount, abTestCount, avgCostPerCall };
}

function getDailyData(records: UsageRecord[]) {
  const dailyMap = new Map<string, { date: string; cost: number; calls: number; abTests: number }>();

  for (const r of records) {
    const date = r.timestamp.split("T")[0];
    const existing = dailyMap.get(date) || { date, cost: 0, calls: 0, abTests: 0 };
    existing.cost += r.totalEstimatedCost;
    if (r.type === "call") existing.calls++;
    else existing.abTests++;
    dailyMap.set(date, existing);
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getUserData(records: UsageRecord[]) {
  const userMap = new Map<string, { user: string; cost: number; count: number }>();
  for (const r of records) {
    const existing = userMap.get(r.user) || { user: r.user, cost: 0, count: 0 };
    existing.cost += r.totalEstimatedCost;
    existing.count++;
    userMap.set(r.user, existing);
  }
  return Array.from(userMap.values()).sort((a, b) => b.cost - a.cost);
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function SpendTrackingPage() {
  const { data: records = [], isLoading } = useQuery<UsageRecord[]>({
    queryKey: ["/api/usage"],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <LoadingIndicator text="Loading spend data..." />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Spend Tracking</h1>
        <p className="text-muted-foreground mt-1">Monitor estimated API costs for AssemblyAI transcription and Bedrock AI analysis.</p>
      </div>

      <Tabs defaultValue="current-month">
        <TabsList>
          <TabsTrigger value="current-month">Current Month</TabsTrigger>
          <TabsTrigger value="last-month">Last Month</TabsTrigger>
          <TabsTrigger value="ytd">Year to Date</TabsTrigger>
          <TabsTrigger value="all-time">All Time</TabsTrigger>
        </TabsList>

        {(["current-month", "last-month", "ytd", "all-time"] as Period[]).map(period => (
          <TabsContent key={period} value={period}>
            <PeriodView records={filterByPeriod(records, period)} period={period} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <CardDescription>Last 50 processed calls and A/B tests</CardDescription>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No usage data recorded yet. Costs will appear here after calls are processed.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {records.slice(0, 50).map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors">
                  <div className="flex items-center gap-3">
                    {r.type === "call" ? (
                      <Phone className="w-4 h-4 text-blue-500" />
                    ) : (
                      <FlaskConical className="w-4 h-4 text-purple-500" />
                    )}
                    <div>
                      <span className="text-sm font-medium">
                        {r.type === "call" ? "Call Analysis" : "A/B Test"}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">by {r.user}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">
                        {r.services.assemblyai && (
                          <span>AAI: {formatCostPrecise(r.services.assemblyai.estimatedCost)}</span>
                        )}
                        {r.services.bedrock && (
                          <span className="ml-2">Bedrock: {formatCostPrecise(r.services.bedrock.estimatedCost)}</span>
                        )}
                        {r.services.bedrockSecondary && (
                          <span className="ml-2">+{formatCostPrecise(r.services.bedrockSecondary.estimatedCost)}</span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs min-w-[60px] justify-center">
                      {formatCostPrecise(r.totalEstimatedCost)}
                    </Badge>
                    <span className="text-xs text-muted-foreground w-32 text-right">
                      {new Date(r.timestamp).toLocaleDateString()} {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PeriodView({ records, period }: { records: UsageRecord[]; period: Period }) {
  const stats = computeStats(records);
  const dailyData = getDailyData(records);
  const userData = getUserData(records);

  const serviceSplit = [
    { name: "AssemblyAI", value: stats.assemblyaiCost },
    { name: "Bedrock", value: stats.bedrockCost },
  ].filter(s => s.value > 0);

  const periodLabel = {
    "current-month": "this month",
    "last-month": "last month",
    "ytd": "year to date",
    "all-time": "all time",
  }[period];

  return (
    <div className="space-y-6 mt-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Estimated Cost</p>
                <p className="text-2xl font-bold">{formatCost(stats.totalCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Phone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Calls Processed</p>
                <p className="text-2xl font-bold">{stats.callCount}</p>
                {stats.abTestCount > 0 && (
                  <p className="text-xs text-muted-foreground">+ {stats.abTestCount} A/B tests</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Cost / Call</p>
                <p className="text-2xl font-bold">{formatCost(stats.avgCostPerCall)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Period</p>
                <p className="text-lg font-semibold capitalize">{periodLabel}</p>
                <p className="text-xs text-muted-foreground">{records.length} records</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {records.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Daily spend chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Daily Spend</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyData.length > 1 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} className="text-muted-foreground" />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                      labelFormatter={label => new Date(label + "T00:00:00").toLocaleDateString()}
                    />
                    <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px]">
                  <p className="text-sm text-muted-foreground">Need at least 2 days of data for a chart</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Service split pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost by Service</CardTitle>
            </CardHeader>
            <CardContent>
              {serviceSplit.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={serviceSplit}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, value }) => `${name}: $${value.toFixed(2)}`}
                    >
                      {serviceSplit.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px]">
                  <p className="text-sm text-muted-foreground">No cost data</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cost by user */}
      {userData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by User</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(150, userData.length * 40)}>
              <BarChart data={userData} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} className="text-muted-foreground" />
                <YAxis type="category" dataKey="user" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Total Cost"]} />
                <Bar dataKey="cost" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
