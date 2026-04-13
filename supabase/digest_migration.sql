-- player_digests: stores AI-generated daily outlook per player
-- Regenerated at most once per 24h by /api/players/[id]/digest

create table if not exists player_digests (
  player_id    uuid        primary key references players(id) on delete cascade,
  digest       text        not null,
  generated_at timestamptz not null default now()
);

-- Only approved users can read digests via the API (enforced at route level).
-- Service role writes; anon has no access.
alter table player_digests enable row level security;

DO $$ BEGIN
  CREATE POLICY "service role full access" ON player_digests
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
