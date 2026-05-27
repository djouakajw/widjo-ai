/**
 * Script de configuration Supabase
 * Crée les tables videos, jobs et le bucket de stockage
 */
import 'dotenv/config';
import { supabaseAdmin } from './supabase.js';

async function setupDatabase() {
  console.log('🚀 Configuration de Supabase pour WIDJO...\n');

  // ─── 1. Créer la table videos ─────────────────────────────────────────────
  console.log('📋 Création de la table videos...');
  const { error: videosError } = await supabaseAdmin.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS videos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT,
        prompt TEXT NOT NULL,
        video_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index pour les requêtes par user_id
      CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
      CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    `
  });

  if (videosError) {
    // Essayer via l'API REST directement
    console.log('  ⚠️  RPC non disponible, utilisation de l\'API REST...');
  } else {
    console.log('  ✅ Table videos créée');
  }

  // ─── 2. Créer la table jobs ───────────────────────────────────────────────
  console.log('📋 Création de la table jobs...');
  const { error: jobsError } = await supabaseAdmin.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL DEFAULT 'text-to-video',
        prompt TEXT NOT NULL,
        output_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);
    `
  });

  if (!jobsError) {
    console.log('  ✅ Table jobs créée');
  }

  // ─── 3. Créer le bucket de stockage ──────────────────────────────────────
  console.log('🪣  Création du bucket videos...');
  const { error: bucketError } = await supabaseAdmin.storage.createBucket('videoss', {
    public: true,
    fileSizeLimit: 524288000, // 500 MB
    allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  });

  if (bucketError && !bucketError.message.includes('already exists')) {
    console.log(`  ⚠️  Bucket: ${bucketError.message}`);
  } else {
    console.log('  ✅ Bucket videos prêt');
  }

  // ─── 4. Vérifier la connexion ─────────────────────────────────────────────
  console.log('\n🔍 Vérification de la connexion...');
  const { data, error: pingError } = await supabaseAdmin
    .from('videos')
    .select('count')
    .limit(1);

  if (pingError) {
    console.log(`  ⚠️  ${pingError.message}`);
    console.log('\n📌 Les tables doivent être créées manuellement dans Supabase SQL Editor.');
    console.log('   Copie le SQL ci-dessous dans : https://hmarstwuwqblftajqhxh.supabase.co/project/default/sql\n');
    printManualSQL();
  } else {
    console.log('  ✅ Connexion Supabase OK');
    console.log('\n🎉 Configuration terminée ! Lance l\'API avec : npm run dev');
  }
}

function printManualSQL() {
  console.log(`
-- ═══════════════════════════════════════════════════════
-- WIDJO — SQL à exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

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

-- Activer Row Level Security (optionnel mais recommandé)
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Politique : accès public en lecture/écriture (pour le dev)
CREATE POLICY "Public access" ON videos FOR ALL USING (true);
CREATE POLICY "Public access" ON jobs FOR ALL USING (true);
`);
}

setupDatabase().catch(console.error);
