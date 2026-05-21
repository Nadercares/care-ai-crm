-- Policy documents (Roadmap Stage 4 - Policy Review agent)
-- Stores the uploaded policy file name and its extracted text so the Policy
-- Review agent can read the actual policy wording.

alter table public.policies add column document_name text;
alter table public.policies add column document_text text;
