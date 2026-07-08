/** 타임라인에 내려주는 데이터 형태 (RLS 적용 후 서버에서 fetch) */

export type TLClient = { id: string; name: string };

export type TLProject = {
  id: string;
  client_id: string;
  name: string;
  code: string;
  status: string;
  prod_anchor_date: string | null;
};

export type TLMilestone = {
  id: string;
  project_id: string;
  label: string;
  due_date: string;
};

export type TLTask = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  assignee_id: string | null;
  start_date: string;
  end_date: string;
  status: string;
  sort_order: number;
};

export type TLProfile = {
  id: string;
  name: string;
  role: string;
  color: string;
};

export type TLManager = {
  project_id: string;
  profile_id: string;
  assigned_by: string;
  created_at: string;
};

export type TimelineData = {
  clients: TLClient[];
  projects: TLProject[];
  milestones: TLMilestone[];
  tasks: TLTask[];
  profiles: TLProfile[];
  managers: TLManager[];
};
