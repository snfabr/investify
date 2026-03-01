-- Add unique constraint on holdings(user_id, symbol) so that
-- the CSV import confirm route can upsert with onConflict: 'user_id,symbol'
create unique index idx_holdings_user_symbol on holdings(user_id, symbol);
