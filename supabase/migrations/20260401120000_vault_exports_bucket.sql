-- Create private Storage bucket for local-first vault mode.
-- When DATAVAULT_STORE_FULL_PAYLOAD=false, run-sync uploads per-page Markdown here
-- instead of persisting raw_json blocks in notion_pages.
--
-- Path layout: {auth.uid()}/{connector_id}/pages/{notion_page_id}.md
--
-- Uploads: service-role only (Edge Function) — bypasses RLS intentionally.
-- Downloads: authenticated users can only read/list their own prefix via the policy below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vault-exports',
  'vault-exports',
  false,
  52428800, -- 50 MB per file; individual Markdown pages will be well under this
  null       -- any mime type (text/markdown, text/plain)
)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- RLS: authenticated users may only select objects under their own user-id prefix.
-- run-sync writes via service-role and bypasses RLS intentionally.
create policy "vault_exports_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vault-exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);
