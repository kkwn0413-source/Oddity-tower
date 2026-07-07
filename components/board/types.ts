/** 보드 화면 데이터 형태 (서버에서 RLS 적용 fetch 후 전달) */

export type BoardInfo = {
  id: string;
  kind: "project" | "personal" | "shared" | string;
  project_id: string | null;
  owner_id: string | null;
  title: string;
  shared: boolean;
  projectCode?: string | null;
};

export type BoardZone = {
  id: string;
  title: string;
  sort_order: number;
  batch_label: string | null;
};

export type BoardImage = {
  id: string;
  zone_id: string;
  uploader_id: string;
  kind: string; // 'upload' | 'url'
  src: string; // 렌더 가능한 URL (upload는 signed URL로 변환됨)
  filename: string | null;
  starred: boolean;
  hidden: boolean;
  memo: string | null;
  verdict: "good" | "bad" | null;
  verdict_memo: string | null;
  verdict_by: string | null;
  verdict_at: string | null;
  doc_group: string | null;
  sort_order: number;
};

export type BoardMeeting = {
  id: string;
  round: number;
  title: string | null;
  met_at: string;
  body: string | null;
  author_id: string;
  updated_at: string;
  items: { id: string; kind: string; body: string; sort_order: number }[];
  comments: {
    id: string;
    author_id: string;
    body: string;
    resolved: boolean;
    created_at: string;
  }[];
  revisionCount: number;
};

export type BoardDirectionLog = {
  id: string;
  author_id: string;
  body: string;
  status: string;
  supersedes: string | null;
  created_at: string;
};

export type BoardAsset = {
  id: string;
  name: string;
  url: string | null;
  sort_order: number;
};

export type TeamMember = { id: string; name: string; color: string; role: string };

export type BoardData = {
  board: BoardInfo;
  zones: BoardZone[];
  images: BoardImage[];
  meetings: BoardMeeting[];
  directionLogs: BoardDirectionLog[];
  assets: BoardAsset[];
  team: TeamMember[];
};
