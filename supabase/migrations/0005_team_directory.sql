-- =============================================================================
-- 0005 — 팀 디렉토리 RPC
-- profiles SELECT는 본인+director로 제한돼 있으나(스펙 5장), 회의록·첨삭·보드에
-- 작성자 이름/색 표시는 협업 필수. 민감정보 없는 (id, name, color, role)만
-- security definer로 노출. (이메일·기타 필드는 제외)
-- =============================================================================

create or replace function public.team_directory()
returns table (id uuid, name text, color text, role text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.color, p.role
  from public.profiles p
  where auth.uid() is not null;
$$;

grant execute on function public.team_directory() to authenticated;
