-- Add account_holder column to holdings and snapshot_holdings
-- so we can filter the portfolio view by account holder (e.g. joint ISAs)

alter table holdings
  add column account_holder text not null default '';

alter table snapshot_holdings
  add column account_holder text not null default '';

-- Replace the old unique index (user_id, symbol) with one that also
-- includes account_holder, so two account holders can each hold the
-- same fund (and each ISA can have its own Cash row).
drop index idx_holdings_user_symbol;
create unique index idx_holdings_user_symbol_holder
  on holdings(user_id, symbol, account_holder);
