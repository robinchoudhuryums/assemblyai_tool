import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Play, Download, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { CallWithDetails, Employee } from "@shared/schema";
import { AudioWaveform } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function CallsTable() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: calls, isLoading: isLoadingCalls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", {
      status: statusFilter === "all" ? "" : statusFilter,
      sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
      employee: employeeFilter === "all" ? "" : employeeFilter
    }],
  });

  const { data: employees, isLoading: isLoadingEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const deleteMutation = useMutation({
    mutationFn: (callId: string) => fetch(`/api/calls/${callId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({
        title: "Call Deleted",
        description: "The call recording has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete the call.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (callId: string) => {
    if (window.confirm("Are you sure you want to permanently delete this call and all its data?")) {
      deleteMutation.mutate(callId);
    }
  };

  if (isLoadingCalls || isLoadingEmployees) {
    return (
      <div className="flex items-center justify-center h-64">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading calls...</p>
      </div>
    );
  }

  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return <Badge variant="secondary">Unknown</Badge>;
    const variants: Record<string, any> = {
      positive: "default", neutral: "secondary", negative: "destructive",
    };
    return (
      <Badge variant={variants[sentiment] || "secondary"}>
        {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
      </Badge>
    );
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <Badge variant="secondary">Unknown</Badge>;
    const colors: Record<string, string> = {
      completed: "bg-green-100 text-green-800",
      processing: "bg-blue-100 text-blue-800",
      failed: "bg-red-100 text-red-800",
    };
    return (
      <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const renderStars = (score: number) => {
    const filledStars = Math.floor(score / 2);
    const emptyStars = 5 - filledStars;
    return (
      <div className="flex text-yellow-400 text-xs">
        {[...Array(filledStars)].map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}
        {[...Array(emptyStars)].map((_, i) => <Star key={i} className="w-3 h-3" />)}
      </div>
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="calls-table">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Recent Calls</h3>
        <div className="flex items-center space-x-2">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-40" data-testid="employee-filter">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees?.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
            <SelectTrigger className="w-40" data-testid="sentiment-filter">
              <SelectValue placeholder="All Sentiment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sentiment</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Date</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Employee</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Duration</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Sentiment</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Score</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {calls?.map((call, index) => (
              <tr key={call.id} className="border-b border-border hover:bg-muted transition-colors">
                <td className="py-3 px-2">
                  <div>
                    <p className="font-medium text-foreground">{new Date(call.uploadedAt || "").toLocaleDateString()}</p>
                    <p className="text-xs text-muted-foreground">{new Date(call.uploadedAt || "").toLocaleTimeString()}</p>
                  </div>
                </td>
                <td className="py-3 px-2">
                  {call.employee ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-primary font-semibold text-xs">{call.employee.initials ?? 'N/A'}</span>
                      </div>
                      <span className="font-medium">{call.employee.name ?? 'Unknown'}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </td>
                <td className="py-3 px-2 text-muted-foreground">
                  {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '-'}
                </td>
                <td className="py-3 px-2">{getSentimentBadge(call.sentiment?.overallSentiment)}</td>
                <td className="py-3 px-2">
                  {call.analysis?.performanceScore && (
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-green-600">{Number(call.analysis.performanceScore).toFixed(1)}</span>
                      {renderStars(Number(call.analysis.performanceScore))}
                    </div>
                  )}
                </td>
                <td className="py-3 px-2">{getStatusBadge(call.status)}</td>
                <td className="py-3 px-2">
                  <div className="flex items-center space-x-2">
                    <Link href={`/transcripts/${call.id}`}>
                      <Button size="sm" variant="ghost" disabled={call.status !== 'completed'}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button size="sm" variant="ghost"><Play className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={call.status !== 'completed'}><Download className="w-4 h-4" /></Button>
                    <Button
                      size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                      onClick={() => handleDelete(call.id)} disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )) ?? []}
          </tbody>
        </table>
      </div>
      
      {!calls?.length && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No call recordings found</p>
          <Link href="/upload"><Button className="mt-4">Upload Your First Call</Button></Link>
        </div>
      )}
    </div>
  );
}
