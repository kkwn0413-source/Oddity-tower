-- =============================================================================
-- 0009: task-files 버킷 storage 정책 (6단계 — 파일 업로드)
--  * 경로 규약: {task_id}/{uuid}.{ext} — 표시 이름(자동 네이밍)은 task_files.name에 보관
--  * 조회/업로드: can_access_task (director 전체 + 담당 freelancer)
--  * 삭제: director만 (5단계 권한 방침과 동일 — 보수적)
-- =============================================================================

drop policy if exists "task_files_read" on storage.objects;
create policy "task_files_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-files'
    and public.can_access_task(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "task_files_insert" on storage.objects;
create policy "task_files_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and public.can_access_task(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "task_files_delete" on storage.objects;
create policy "task_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-files' and public.is_director());
