import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Crown, Fire, Lightning, Medal, Rocket, Shield, Star, TrendUp, Trophy, Heart, CheckCircle } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingIndicator } from "@/components/ui/loading";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BadgeData {
  id: string;
  badgeType: string;
  earnedAt: string;
  label: string;
  description: string;
  icon: string;
}

interface LeaderboardEntry {
  employeeId: string;
  employeeName: string;
  subTeam?: string;
  totalCalls: number;
  avgScore: number;
  totalPoints: number;
  currentStreak: number;
  badges: BadgeData[];
  rank: number;
}

const BADGE_ICONS: Record<string, typeof Star> = {
  star: Star,
  fire: Fire,
  lightning: Lightning,
  rocket: Rocket,
  trophy: Trophy,
  crown: Crown,
  "trend-up": TrendUp,
  shield: Shield,
  heart: Heart,
  "check-circle": CheckCircle,
};

function BadgeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = BADGE_ICONS[icon] || Star;
  return <Icon className={className} />;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-6 h-6 text-yellow-500" weight="fill" />;
  if (rank === 2) return <Medal className="w-6 h-6 text-gray-400" weight="fill" />;
  if (rank === 3) return <Medal className="w-6 h-6 text-amber-600" weight="fill" />;
  return <span className="text-sm font-bold text-muted-foreground w-6 text-center">{rank}</span>;
}

function StreakIndicator({ streak }: { streak: number }) {
  if (streak === 0) return null;
  return (
    <div className="flex items-center gap-0.5">
      <Fire className="w-4 h-4 text-orange-500" weight="fill" />
      <span className="text-xs font-bold text-orange-600 dark:text-orange-400">{streak}</span>
    </div>
  );
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<string>("all");

  const { data, isLoading } = useQuery<{ leaderboard: LeaderboardEntry[]; period: string }>({
    queryKey: ["/api/gamification/leaderboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/leaderboard?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      return res.json();
    },
  });

  const leaderboard = data?.leaderboard || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingIndicator text="Loading leaderboard..." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-7 h-7 text-yellow-500" weight="duotone" />
            Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agent rankings based on performance scores, consistency, and achievements
          </p>
        </div>
      </div>

      <Tabs value={period} onValueChange={setPeriod}>
        <TabsList>
          <TabsTrigger value="week">This Week</TabsTrigger>
          <TabsTrigger value="month">This Month</TabsTrigger>
          <TabsTrigger value="all">All Time</TabsTrigger>
        </TabsList>

        <TabsContent value={period} className="mt-4">
          {leaderboard.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No data available for this period.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Top 3 podium */}
              {leaderboard.length >= 3 && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[1, 0, 2].map((idx) => {
                    const entry = leaderboard[idx];
                    if (!entry) return null;
                    const isFirst = idx === 0;
                    return (
                      <Card
                        key={entry.employeeId}
                        className={`text-center ${isFirst ? "border-yellow-400 dark:border-yellow-600 bg-yellow-50/50 dark:bg-yellow-950/20 row-span-2" : ""}`}
                      >
                        <CardContent className="pt-6 pb-4">
                          <RankBadge rank={entry.rank} />
                          <Link href={`/scorecard/${entry.employeeId}`}>
                            <h3 className="font-semibold mt-2 hover:underline cursor-pointer">{entry.employeeName}</h3>
                          </Link>
                          {entry.subTeam && (
                            <p className="text-xs text-muted-foreground">{entry.subTeam}</p>
                          )}
                          <div className="text-2xl font-bold mt-2">{entry.totalPoints.toLocaleString()}</div>
                          <p className="text-xs text-muted-foreground">points</p>
                          <div className="flex items-center justify-center gap-3 mt-3 text-xs">
                            <span>{entry.avgScore.toFixed(1)} avg</span>
                            <span>{entry.totalCalls} calls</span>
                            <StreakIndicator streak={entry.currentStreak} />
                          </div>
                          {entry.badges.length > 0 && (
                            <div className="flex justify-center gap-1 mt-3 flex-wrap">
                              {entry.badges.slice(0, 5).map((b) => (
                                <Tooltip key={b.id}>
                                  <TooltipTrigger>
                                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                                      <BadgeIcon icon={b.icon} className="w-4 h-4 text-primary" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-semibold">{b.label}</p>
                                    <p className="text-xs text-muted-foreground">{b.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                              {entry.badges.length > 5 && (
                                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                                  +{entry.badges.length - 5}
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Full ranking table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Full Rankings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <div className="grid grid-cols-[2.5rem_1fr_5rem_4rem_4rem_5rem_4rem] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      <div>#</div>
                      <div>Agent</div>
                      <div className="text-right">Points</div>
                      <div className="text-right">Avg</div>
                      <div className="text-right">Calls</div>
                      <div className="text-right">Streak</div>
                      <div className="text-right">Badges</div>
                    </div>
                    {leaderboard.map((entry) => (
                      <div
                        key={entry.employeeId}
                        className="grid grid-cols-[2.5rem_1fr_5rem_4rem_4rem_5rem_4rem] gap-2 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors items-center"
                      >
                        <div className="flex justify-center">
                          <RankBadge rank={entry.rank} />
                        </div>
                        <div>
                          <Link href={`/scorecard/${entry.employeeId}`}>
                            <span className="font-medium hover:underline cursor-pointer">{entry.employeeName}</span>
                          </Link>
                          {entry.subTeam && (
                            <span className="text-xs text-muted-foreground ml-2">{entry.subTeam}</span>
                          )}
                        </div>
                        <div className="text-right font-bold">{entry.totalPoints.toLocaleString()}</div>
                        <div className="text-right">
                          <Badge variant={entry.avgScore >= 8 ? "default" : entry.avgScore >= 6 ? "secondary" : "destructive"} className="text-xs">
                            {entry.avgScore.toFixed(1)}
                          </Badge>
                        </div>
                        <div className="text-right text-sm">{entry.totalCalls}</div>
                        <div className="text-right">
                          <StreakIndicator streak={entry.currentStreak} />
                        </div>
                        <div className="text-right flex justify-end gap-0.5">
                          {entry.badges.slice(0, 3).map((b) => (
                            <Tooltip key={b.id}>
                              <TooltipTrigger>
                                <BadgeIcon icon={b.icon} className="w-4 h-4 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>{b.label}</TooltipContent>
                            </Tooltip>
                          ))}
                          {entry.badges.length > 3 && (
                            <span className="text-xs text-muted-foreground">+{entry.badges.length - 3}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
