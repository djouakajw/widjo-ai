import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY ?? '';
const BUCKET = 'videoss';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Styles & config ──────────────────────────────────────────────────────────

const PROMPT_TEMPLATES: Record<string, string> = {
  cinematic: 'Cinematic shot, 4K, dramatic lighting, shallow depth of field, film grain',
  anime: 'Anime style, vibrant colors, dynamic motion, Studio Ghibli inspired',
  realistic: 'Photorealistic, ultra-detailed, natural lighting, 8K resolution',
  ads: 'Professional advertisement, clean background, product focus, commercial quality',
  documentary: 'Documentary style, handheld camera, natural light, authentic feel',
};

const VIDEO_STYLES = ['cinematic', 'anime', 'realistic', 'ads', 'documentary', 'music-video', 'short-film'];
const VIDEO_DURATIONS = [5, 10, 15, 30, 60];
const JOB_TYPES = ['text-to-video', 'image-to-video', 'video-to-video', 'text-to-image', 'lip-sync', 'thumbnail'];

// ─── Replicate models ─────────────────────────────────────────────────────────

const REPLICATE_MODELS: Record<string, string> = {
  'text-to-video':  'minimax/video-01',
  'image-to-video': 'stability-ai/stable-video-diffusion',
  'wan':            'wavespeedai/wan-2.1-t2v-480p',
  'fast':           'lucataco/animate-diff-v2',
};

// ─── Replicate API ────────────────────────────────────────────────────────────

async function replicatePredict(model: string, input: Record<string, unknown>, webhookUrl?: string) {
  const body: Record<string, unknown> = { input };
  if (webhookUrl) {
    body.webhook = webhookUrl;
    body.webhook_events_filter = ['completed'];
  }
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${REPLICATE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function replicateGetPrediction(predictionId: string) {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { 'Authorization': `Bearer ${REPLICATE_API_KEY}` },
  });
  return res.json();
}

function getApiUrl(req: VercelRequest): string {
  const host = req.headers.host ?? 'widjo-ai.vercel.app';
  return host.includes('localhost') ? `http://${host}` : `https://${host}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const body = req.body ?? {};
  const query = req.query ?? {};

  try {

    // ── GET /health ──────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/health') {
      return res.json({
        status: 'ok', service: 'WIDJO API', version: '3.0.0',
        supabase: !!SUPABASE_URL,
        replicate: !!REPLICATE_API_KEY,
        features: ['text-to-video', 'image-to-video', 'lip-sync', 'thumbnail', 'prompt-ai'],
        timestamp: new Date().toISOString(),
      });
    }

    // ── GET /api/replicate/models ────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/api/replicate/models')) {
      return res.json({
        models: Object.entries(REPLICATE_MODELS).map(([type, model]) => ({
          type, model, url: `https://replicate.com/${model}`,
        })),
        account: 'widjo',
      });
    }

    // ── GET /api/replicate/status/:predictionId ──────────────────────────────
    const repStatusMatch = url.match(/^\/api\/replicate\/status\/([^/]+)$/);
    if (method === 'GET' && repStatusMatch) {
      if (!REPLICATE_API_KEY) return res.status(400).json({ error: 'REPLICATE_API_KEY non configurée' });
      const data = await replicateGetPrediction(repStatusMatch[1]);
      return res.json(data);
    }

    // ── GET /api/prompt/templates ────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/api/prompt/templates')) {
      return res.json({
        styles: VIDEO_STYLES, durations: VIDEO_DURATIONS,
        models: REPLICATE_MODELS,
        templates: Object.entries(PROMPT_TEMPLATES).map(([style, modifier]) => ({
          style, modifier, example: `A woman dancing in Paris, ${modifier}`,
        })),
      });
    }

    // ── POST /api/prompt/enhance ─────────────────────────────────────────────
    if (method === 'POST' && url.startsWith('/api/prompt/enhance')) {
      const { prompt, style = 'cinematic', language = 'fr', duration = 10 } = body;
      if (!prompt) return res.status(400).json({ error: 'Prompt requis' });
      const translated = language === 'fr' ? `${prompt} [translated from French]` : prompt;
      const mod = PROMPT_TEMPLATES[style] ?? PROMPT_TEMPLATES.cinematic;
      return res.json({
        original: prompt,
        enhanced: `${translated}, ${mod}, duration: ${duration}s, high quality`,
        style, duration,
        suggestions: [
          `${prompt}, golden hour lighting, ${mod}`,
          `${prompt}, slow motion, ${mod}`,
          `${prompt}, aerial view, ${mod}`,
        ],
      });
    }

    // ── POST /api/generate-video ─────────────────────────────────────────────
    // Flux complet : prompt → Replicate → webhook → Supabase
    if (method === 'POST' && url.startsWith('/api/generate-video')) {
      const {
        prompt, user_id = 'anonymous', style = 'cinematic',
        duration = 5, type = 'text-to-video',
        source_image_url, audio_url,
        model, // optionnel: forcer un modèle spécifique
      } = body;

      if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt requis' });
      if (!REPLICATE_API_KEY) return res.status(400).json({ error: 'REPLICATE_API_KEY non configurée sur Vercel' });

      const enhancedPrompt = `${prompt.trim()}, ${PROMPT_TEMPLATES[style] ?? ''}`.trim();
      const apiUrl = getApiUrl(req);
      const webhookUrl = `${apiUrl}/api/videos/webhook`;

      // Créer video + job en base
      const { data: video } = await supabase.from('videos')
        .insert({ user_id, prompt: enhancedPrompt, status: 'pending' }).select().single();
      const { data: job } = await supabase.from('jobs')
        .insert({ type, prompt: enhancedPrompt, status: 'pending', video_id: video?.id }).select().single();

      // Choisir le modèle Replicate
      const selectedModel = model ?? REPLICATE_MODELS[type] ?? REPLICATE_MODELS['text-to-video'];

      // Construire l'input selon le type
      const replicateInput: Record<string, unknown> = {
        prompt: enhancedPrompt,
        num_frames: duration * 8, // ~8 frames/sec
      };
      if (type === 'image-to-video' && source_image_url) {
        replicateInput.image = source_image_url;
      }
      if (audio_url) replicateInput.audio = audio_url;

      // Soumettre à Replicate avec webhook
      let prediction = null;
      try {
        prediction = await replicatePredict(selectedModel, replicateInput, `${webhookUrl}?job_id=${job?.id}`);

        // Mettre à jour le statut
        if (prediction?.id) {
          await supabase.from('jobs').update({ status: 'processing' }).eq('id', job?.id);
          await supabase.from('videos').update({ status: 'processing' }).eq('id', video?.id);
        }
      } catch (e) {
        console.error('Replicate error:', e);
      }

      return res.status(201).json({
        success: true,
        job_id: job?.id,
        video_id: video?.id,
        prompt_original: prompt,
        prompt_enhanced: enhancedPrompt,
        style, duration, type,
        model: selectedModel,
        status: prediction?.id ? 'processing' : 'pending',
        replicate: prediction ? {
          prediction_id: prediction.id,
          status: prediction.status,
          urls: prediction.urls,
        } : null,
        status_url: `${apiUrl}/api/jobs/${job?.id}`,
        replicate_status_url: prediction?.id ? `${apiUrl}/api/replicate/status/${prediction.id}` : null,
        message: prediction?.id
          ? `Génération démarrée sur Replicate (${prediction.id}). Résultat via webhook.`
          : 'Job créé. Configurez REPLICATE_API_KEY sur Vercel pour démarrer.',
      });
    }

    // ── POST /api/jobs ───────────────────────────────────────────────────────
    if (method === 'POST' && url === '/api/jobs') {
      const { prompt, user_id, type = 'text-to-video', style = 'cinematic', duration = 5, source_image_url, audio_url } = body;
      if (!prompt?.trim()) return res.status(400).json({ error: 'Le prompt est requis' });
      if (!JOB_TYPES.includes(type)) return res.status(400).json({ error: `Type invalide: ${JOB_TYPES.join(', ')}` });
      if (!VIDEO_DURATIONS.includes(duration)) return res.status(400).json({ error: `Durée invalide: ${VIDEO_DURATIONS.join(', ')}s` });
      const { data: video, error: ve } = await supabase.from('videos').insert({ user_id, prompt: prompt.trim(), status: 'pending' }).select().single();
      if (ve) return res.status(500).json({ error: ve.message });
      const { data: job, error: je } = await supabase.from('jobs').insert({ type, prompt: prompt.trim(), status: 'pending', video_id: video.id }).select().single();
      if (je) return res.status(500).json({ error: je.message });
      const apiUrl = getApiUrl(req);
      return res.status(201).json({
        job_id: job.id, video_id: video.id, type, style, duration, status: 'pending',
        replicate_payload: {
          model: REPLICATE_MODELS[type] ?? REPLICATE_MODELS['text-to-video'],
          input: { prompt: prompt.trim(), num_frames: duration * 8, source_image_url, audio_url },
          webhook: `${apiUrl}/api/videos/webhook?job_id=${job.id}`,
        },
        message: 'Job créé.',
      });
    }

    // ── GET /api/jobs ────────────────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/api/jobs') && !url.match(/\/api\/jobs\/.+/)) {
      const { status, type, limit = '20', offset = '0' } = query as Record<string, string>;
      let q = supabase.from('jobs').select('*').order('created_at', { ascending: false }).range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      if (status) q = q.eq('status', status);
      if (type) q = q.eq('type', type);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ jobs: data, count: data?.length ?? 0 });
    }

    // ── GET /api/jobs/:id ────────────────────────────────────────────────────
    const jobMatch = url.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === 'GET' && jobMatch) {
      const { data, error } = await supabase.from('jobs').select('*, videos(*)').eq('id', jobMatch[1]).single();
      if (error || !data) return res.status(404).json({ error: 'Job introuvable' });
      return res.json({ job_id: data.id, type: data.type, prompt: data.prompt, status: data.status, output_url: data.output_url, video: data.videos, created_at: data.created_at });
    }

    // ── PATCH /api/jobs/:id/status ───────────────────────────────────────────
    const jobStatusMatch = url.match(/^\/api\/jobs\/([^/]+)\/status$/);
    if (method === 'PATCH' && jobStatusMatch) {
      const { status, output_url, error_message } = body;
      const { data, error } = await supabase.from('jobs').update({ status, output_url, error_message, updated_at: new Date().toISOString() }).eq('id', jobStatusMatch[1]).select().single();
      if (error || !data) return res.status(404).json({ error: 'Job introuvable' });
      if (data.video_id) await supabase.from('videos').update({ status, video_url: output_url, updated_at: new Date().toISOString() }).eq('id', data.video_id);
      return res.json({ job_id: data.id, status: data.status, output_url: data.output_url });
    }

    // ── GET /api/videos ──────────────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/api/videos') && !url.match(/\/api\/videos\/.+/)) {
      const { user_id, status, limit = '20' } = query as Record<string, string>;
      let q = supabase.from('videos').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
      if (user_id) q = q.eq('user_id', user_id);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ videos: data, count: data?.length ?? 0 });
    }

    // ── GET /api/videos/:id ──────────────────────────────────────────────────
    const videoMatch = url.match(/^\/api\/videos\/([^/]+)$/);
    if (method === 'GET' && videoMatch) {
      const { data, error } = await supabase.from('videos').select('*').eq('id', videoMatch[1]).single();
      if (error || !data) return res.status(404).json({ error: 'Vidéo introuvable' });
      return res.json(data);
    }

    // ── POST /api/videos/upload-url ──────────────────────────────────────────
    if (method === 'POST' && url.startsWith('/api/videos/upload-url')) {
      const { filename, video_id } = body;
      const path = `${video_id}/${Date.now()}-${filename}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) return res.status(500).json({ error: error.message });
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return res.json({ upload_url: data.signedUrl, path, public_url: pub.publicUrl });
    }

    // ── POST /api/videos/webhook ─────────────────────────────────────────────
    // Appelé par Replicate quand la vidéo est générée
    if (method === 'POST' && url.startsWith('/api/videos/webhook')) {
      // Replicate envoie : { id, status, output, error }
      // Notre webhook custom envoie : { job_id, video_url, status }
      const job_id = (query as Record<string, string>).job_id ?? body.job_id;
      const replicateOutput = body.output; // URL ou tableau d'URLs
      const video_url = body.video_url
        ?? (Array.isArray(replicateOutput) ? replicateOutput[0] : replicateOutput)
        ?? null;
      const status = body.status === 'succeeded' ? 'completed' : (body.status ?? 'completed');
      const error_message = body.error ?? null;

      if (!job_id) return res.status(400).json({ error: 'job_id requis (query param ou body)' });

      const { data } = await supabase.from('jobs')
        .update({ status, output_url: video_url, error_message, updated_at: new Date().toISOString() })
        .eq('id', job_id).select().single();
      if (data?.video_id) {
        await supabase.from('videos')
          .update({ status, video_url, updated_at: new Date().toISOString() })
          .eq('id', data.video_id);
      }
      return res.json({ success: true, job_id, status, video_url });
    }

    // ── GET /api/status/:job_id ──────────────────────────────────────────────
    const statusMatch = url.match(/^\/api\/status\/([^/]+)$/);
    if (method === 'GET' && statusMatch) {
      const { data, error } = await supabase.from('jobs').select('id, status, output_url, error_message, created_at').eq('id', statusMatch[1]).single();
      if (error || !data) return res.status(404).json({ error: 'Job introuvable' });
      return res.json({ job_id: data.id, status: data.status, video_url: data.output_url, is_ready: data.status === 'completed' });
    }

    // ── GET /api/users/:id/credits ───────────────────────────────────────────
    const creditsMatch = url.match(/^\/api\/users\/([^/]+)\/credits$/);
    if (method === 'GET' && creditsMatch) {
      const { data: jobs } = await supabase.from('jobs').select('type, status').eq('status', 'completed');
      const costs: Record<string, number> = { 'text-to-video': 10, 'image-to-video': 8, 'video-to-video': 12, 'text-to-image': 2, 'lip-sync': 5, 'thumbnail': 1 };
      const used = (jobs ?? []).reduce((s: number, j: { type: string }) => s + (costs[j.type] ?? 5), 0);
      return res.json({ user_id: creditsMatch[1], credits_total: 100, credits_used: used, credits_remaining: Math.max(0, 100 - used) });
    }

    // ── GET /api/users/:id/history ───────────────────────────────────────────
    const historyMatch = url.match(/^\/api\/users\/([^/]+)\/history$/);
    if (method === 'GET' && historyMatch) {
      const { data, error } = await supabase.from('videos').select('*, jobs(type, status)').eq('user_id', historyMatch[1]).order('created_at', { ascending: false }).limit(50);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ user_id: historyMatch[1], history: data, count: data?.length ?? 0 });
    }

    // ── 404 ──────────────────────────────────────────────────────────────────
    return res.status(404).json({
      error: 'Route introuvable',
      routes: [
        'GET  /health',
        'POST /api/generate-video       — Générer avec Replicate',
        'GET  /api/status/:job_id       — Statut rapide',
        'GET  /api/replicate/models     — Modèles disponibles',
        'GET  /api/replicate/status/:id — Statut Replicate',
        'POST /api/jobs                 — Créer un job',
        'GET  /api/jobs                 — Lister les jobs',
        'GET  /api/jobs/:id             — Détail job',
        'PATCH /api/jobs/:id/status     — Mettre à jour statut',
        'GET  /api/videos               — Lister vidéos',
        'GET  /api/videos/:id           — Détail vidéo',
        'POST /api/videos/webhook       — Webhook Replicate',
        'POST /api/videos/upload-url    — URL upload Supabase',
        'POST /api/prompt/enhance       — Améliorer prompt',
        'GET  /api/prompt/templates     — Styles & modèles',
        'GET  /api/users/:id/credits    — Crédits',
        'GET  /api/users/:id/history    — Historique',
      ],
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error', details: (err as Error).message });
  }
}
