import { createAuthedClient } from './client';

const api = createAuthedClient();

export interface FlowStatus {
  status: string;
  count: number;
  stuck: number;
  avgAge: number;
}

export interface AgingIssue {
  id: number;
  subject: string;
  status: string;
  assignee: string | null;
  priority: string | null;
  project: string | null;
  days: number;
}

export interface FlowAnalytics {
  totalOpen: number;
  capped: boolean;
  thresholds: { watch: number; stuck: number };
  buckets: { fresh: number; watch: number; stuck: number };
  statusDistribution: FlowStatus[];
  agingList: AgingIssue[];
  stuckByAssignee: { name: string; count: number }[];
  cycle: { count: number; avg: number | null; median: number | null };
  oldest: number;
  generatedAt: number;
}

export async function getFlowAnalytics(projectId?: number): Promise<FlowAnalytics> {
  const { data } = await api.get<FlowAnalytics>('/analytics/flow', {
    params: projectId ? { project_id: projectId } : {},
  });
  return data;
}
