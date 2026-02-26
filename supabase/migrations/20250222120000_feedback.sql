-- Tabla para feedback de usuarios (QueryPanel y mejora del sistema)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  query text,
  response text,
  feedback text not null default '',
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  mode text
);

comment on table public.feedback is 'Feedback opcional de usuarios sobre respuestas de consultas legales (anti-alucinación y mejora continua).';

-- Opcional: RLS para que solo el servicio (service_role) inserte; anon puede insertar si se expone
alter table public.feedback enable row level security;

create policy "Service role can do anything on feedback"
  on public.feedback
  for all
  to service_role
  using (true)
  with check (true);

-- Permitir inserciones anónimas (el front envía desde QueryPanel; auth opcional)
create policy "Allow insert feedback for anon and authenticated"
  on public.feedback
  for insert
  to anon, authenticated
  with check (true);
