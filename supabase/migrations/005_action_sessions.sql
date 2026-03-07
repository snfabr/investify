create table action_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'Advisory Session',
  summary text,
  messages jsonb not null default '[]',
  recommendation jsonb,
  status text default 'completed' check (status in ('in_progress', 'completed')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

alter table action_sessions enable row level security;
create policy "own_data" on action_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_action_sessions_user on action_sessions(user_id, created_at desc);
