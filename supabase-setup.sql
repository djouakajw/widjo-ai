-- ═══════════════════════════════════════════════════════════════
-- WIDJO — Setup complet Supabase
-- Colle ce SQL dans : Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- 1. Table videos
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  prompt TEXT NOT NULL,
  video_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'text-to-video',
  prompt TEXT NOT NULL,
  output_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Index pour les performances
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);

-- 4. Row Level Security (accès public pour le dev)
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access" ON videos;
DROP POLICY IF EXISTS "Public access" ON jobs;

CREATE POLICY "Public access" ON videos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON jobs FOR ALL USING (true) WITH CHECK (true);

-- 5. Vérification
SELECT 'videos' as table_name, count(*) FROM videos
UNION ALL
SELECT 'jobs', count(*) FROM jobs;
