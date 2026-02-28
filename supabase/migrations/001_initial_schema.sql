-- ============================================================
-- CORE TABLES
-- ============================================================

-- User settings (LLM provider, API keys, notification preferences)
create table user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  llm_provider text default 'anthropic'
    check (llm_provider in ('anthropic', 'openai', 'google')),
  llm_model text default 'claude-sonnet-4-6',
  anthropic_key_encrypted text,
  openai_key_encrypted text,
  google_key_encrypted text,
  notification_email text,
  email_alerts_enabled boolean default false,
  event_monitor_frequency text default 'every_4_hours',
  weekly_plan_day text default 'monday',
  weekly_plan_time text default '07:00',
  broker_name text default 'fidelity_uk',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Strategy profiles (versioned, output of advisory mode)
create table strategy_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  version integer not null default 1,
  is_current boolean default true,
  financial_situation jsonb not null default '{}',
  goals jsonb not null default '{}',
  risk_profile jsonb not null default '{}',
  investment_beliefs jsonb not null default '{}',
  strategy jsonb not null default '{}',
  tactical_framework jsonb not null default '{}',
  completed_stages integer[] default '{}',
  is_complete boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PORTFOLIO & HOLDINGS
-- ============================================================

-- Current holdings (latest state, updated on each CSV import or manual edit)
create table holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  name text not null,
  isin text,
  sedol text,
  instrument_type text not null
    check (instrument_type in ('etf', 'stock', 'fund', 'bond', 'cash', 'investment_trust')),
  quantity numeric not null default 0,
  avg_cost_gbp numeric not null default 0,
  cost_basis_gbp numeric not null default 0,
  current_price_gbp numeric,
  current_value_gbp numeric,
  gain_loss_gbp numeric,
  gain_loss_pct numeric,
  sector text,
  currency text default 'GBP',
  notes text,
  is_active boolean default true,
  last_import_at timestamptz,
  added_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Portfolio snapshots (one per CSV import — the foundation of performance history)
create table portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  snapshot_date date not null,
  total_value_gbp numeric not null,
  total_cost_gbp numeric not null,
  total_gain_loss_gbp numeric not null,
  total_gain_loss_pct numeric not null,
  cash_gbp numeric default 0,
  num_holdings integer not null,
  import_method text not null default 'csv',
  broker text default 'fidelity_uk',
  source_file text,
  notes text,
  created_at timestamptz default now()
);

-- Individual holding values at time of each snapshot
create table snapshot_holdings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references portfolio_snapshots(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  name text not null,
  isin text,
  sedol text,
  instrument_type text not null,
  quantity numeric not null,
  price_gbp numeric not null,
  value_gbp numeric not null,
  cost_basis_gbp numeric,
  gain_loss_gbp numeric,
  gain_loss_pct numeric,
  allocation_pct numeric
);

-- Watchlist
create table watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  name text not null,
  isin text,
  instrument_type text default 'etf',
  reason text,
  target_entry_price numeric,
  added_at timestamptz default now(),
  is_active boolean default true
);

-- ============================================================
-- MARKET DATA & PERFORMANCE
-- ============================================================

-- Historical price data for holdings, watchlist, benchmarks, candidates
create table price_history (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  price_date date not null,
  open_gbp numeric,
  high_gbp numeric,
  low_gbp numeric,
  close_gbp numeric not null,
  volume bigint,
  currency text default 'GBP',
  source text default 'yahoo',
  created_at timestamptz default now(),
  unique(symbol, price_date)
);

-- Tracked symbols (what we fetch prices for)
create table tracked_symbols (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  name text,
  yahoo_symbol text,
  track_reason text not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(symbol, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Market data cache (for real-time/intraday quotes, short TTL)
create table market_data_cache (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  data_type text not null,
  data jsonb not null,
  fetched_at timestamptz default now(),
  expires_at timestamptz not null,
  unique(symbol, data_type)
);

-- Macro indicators from FRED
create table macro_indicators (
  id uuid primary key default gen_random_uuid(),
  indicator_code text not null,
  indicator_name text not null,
  value numeric not null,
  observation_date date not null,
  source text default 'fred',
  created_at timestamptz default now(),
  unique(indicator_code, observation_date)
);

-- ============================================================
-- WEEKLY PLANS & ALERTS
-- ============================================================

-- Weekly plans
create table weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_of date not null,
  plan jsonb not null,
  portfolio_snapshot_id uuid references portfolio_snapshots(id),
  market_context jsonb,
  performance_context jsonb,
  llm_provider text,
  llm_model text,
  execution_status text default 'pending'
    check (execution_status in ('pending', 'partial', 'complete', 'skipped')),
  executed_actions jsonb default '[]',
  created_at timestamptz default now()
);

-- Event alerts
create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  event_category text not null,
  headline text not null,
  urgency text not null
    check (urgency in ('immediate', 'same_day', 'next_weekly_review')),
  affected_holdings text[] default '{}',
  affected_thesis text[] default '{}',
  affected_watchlist text[] default '{}',
  framework_response text,
  llm_analysis text,
  suggested_actions jsonb default '[]',
  requires_action boolean default false,
  action_deadline text,
  is_read boolean default false,
  is_dismissed boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- ADVISORY & TRADE TRACKING
-- ============================================================

-- Advisory chat history
create table advisory_chat (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  profile_id uuid references strategy_profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  stage integer,
  created_at timestamptz default now()
);

-- Trade log (tracks execution of plans + ad-hoc trades)
create table trade_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  plan_id uuid references weekly_plans(id) on delete set null,
  alert_id uuid references alerts(id) on delete set null,
  symbol text not null,
  name text,
  action text not null check (action in ('buy', 'sell')),
  quantity numeric not null,
  price_gbp numeric not null,
  total_gbp numeric not null,
  fees_gbp numeric default 0,
  rationale text,
  executed_at timestamptz default now()
);

-- CSV import log (track all imports for audit trail)
create table csv_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  snapshot_id uuid references portfolio_snapshots(id),
  filename text not null,
  file_size integer,
  broker text default 'fidelity_uk',
  rows_parsed integer,
  rows_imported integer,
  errors jsonb default '[]',
  status text default 'success'
    check (status in ('success', 'partial', 'failed')),
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table user_settings enable row level security;
alter table strategy_profiles enable row level security;
alter table holdings enable row level security;
alter table portfolio_snapshots enable row level security;
alter table snapshot_holdings enable row level security;
alter table watchlist enable row level security;
alter table price_history enable row level security;
alter table tracked_symbols enable row level security;
alter table market_data_cache enable row level security;
alter table macro_indicators enable row level security;
alter table weekly_plans enable row level security;
alter table alerts enable row level security;
alter table advisory_chat enable row level security;
alter table trade_log enable row level security;
alter table csv_imports enable row level security;

-- User-owned tables: restrict to own data
create policy "own_data" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on strategy_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on holdings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on portfolio_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on snapshot_holdings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on watchlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on weekly_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on advisory_chat for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on trade_log for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_data" on csv_imports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Shared tables: authenticated read, service role write
create policy "auth_read" on price_history for select using (auth.role() = 'authenticated');
create policy "service_write" on price_history for all using (true) with check (true);

create policy "auth_read" on market_data_cache for select using (auth.role() = 'authenticated');
create policy "service_write" on market_data_cache for all using (true) with check (true);

create policy "auth_read" on macro_indicators for select using (auth.role() = 'authenticated');
create policy "service_write" on macro_indicators for all using (true) with check (true);

-- tracked_symbols: user can manage their own, shared benchmarks readable by all
create policy "own_or_shared" on tracked_symbols for select
  using (auth.uid() = user_id or user_id is null);
create policy "own_write" on tracked_symbols for insert
  with check (auth.uid() = user_id);
create policy "own_update" on tracked_symbols for update
  using (auth.uid() = user_id);
create policy "own_delete" on tracked_symbols for delete
  using (auth.uid() = user_id);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_holdings_active on holdings(user_id) where is_active = true;
create index idx_snapshots_date on portfolio_snapshots(user_id, snapshot_date desc);
create index idx_snapshot_holdings_lookup on snapshot_holdings(snapshot_id);
create index idx_snapshot_holdings_user on snapshot_holdings(user_id, symbol);
create index idx_watchlist_active on watchlist(user_id) where is_active = true;
create index idx_price_history_lookup on price_history(symbol, price_date desc);
create index idx_price_history_range on price_history(symbol, price_date);
create index idx_tracked_active on tracked_symbols(is_active) where is_active = true;
create index idx_weekly_plans_week on weekly_plans(user_id, week_of desc);
create index idx_alerts_unread on alerts(user_id, created_at desc) where is_read = false;
create index idx_trade_log_date on trade_log(user_id, executed_at desc);
create index idx_macro_date on macro_indicators(indicator_code, observation_date desc);
create index idx_profiles_current on strategy_profiles(user_id) where is_current = true;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_user_settings_updated before update on user_settings
  for each row execute function update_updated_at();
create trigger tr_strategy_profiles_updated before update on strategy_profiles
  for each row execute function update_updated_at();
create trigger tr_holdings_updated before update on holdings
  for each row execute function update_updated_at();

-- Deactivate old profiles when new current one is created
create or replace function deactivate_old_profiles()
returns trigger as $$
begin
  if new.is_current = true then
    update strategy_profiles set is_current = false
    where user_id = new.user_id and id != new.id and is_current = true;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tr_profile_version after insert on strategy_profiles
  for each row execute function deactivate_old_profiles();

-- When holdings are updated from CSV, auto-add to tracked_symbols
create or replace function auto_track_holding()
returns trigger as $$
begin
  insert into tracked_symbols (user_id, symbol, name, track_reason)
  values (new.user_id, new.symbol, new.name, 'holding')
  on conflict do nothing;
  return new;
end;
$$ language plpgsql;

create trigger tr_auto_track_holding after insert on holdings
  for each row execute function auto_track_holding();

-- Same for watchlist
create or replace function auto_track_watchlist()
returns trigger as $$
begin
  insert into tracked_symbols (user_id, symbol, name, track_reason)
  values (new.user_id, new.symbol, new.name, 'watchlist')
  on conflict do nothing;
  return new;
end;
$$ language plpgsql;

create trigger tr_auto_track_watchlist after insert on watchlist
  for each row execute function auto_track_watchlist();

-- Enable realtime on alerts
alter publication supabase_realtime add table alerts;

-- ============================================================
-- SEED DATA: Benchmark symbols
-- ============================================================

insert into tracked_symbols (user_id, symbol, name, yahoo_symbol, track_reason) values
  (null, 'VWRL.L', 'Vanguard FTSE All-World ETF', 'VWRL.L', 'benchmark'),
  (null, '^FTSE', 'FTSE 100', '^FTSE', 'benchmark'),
  (null, '^GSPC', 'S&P 500', '^GSPC', 'benchmark'),
  (null, 'VUSA.L', 'Vanguard S&P 500 ETF (GBP)', 'VUSA.L', 'benchmark'),
  (null, 'IGLT.L', 'iShares Core UK Gilts', 'IGLT.L', 'benchmark')
on conflict do nothing;
