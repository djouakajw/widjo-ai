import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { supabaseAdmin } from './supabase.js';

const app = Fastify({ logger: false });
await app.register(cors, { origin: '*' });

const BUCKET = 'videoss';

const VIDEO_STYLES = ['cinematic', 'anime', 'realistic', 'ads', 'documentary', 'music-video', 'short-film'];
const VIDEO_DURATIONS = [5, 10, 15, 30, 60];
const JOB_TYPES = ['text-to-video', 'image-to-video', 'video-to-video', 'text-to-image', 'lip-sync', 'thumbnail'];

const PROMPT_TEMPLATES: Record<string, string> = {
  cinematic: 'Cinematic shot, 4K, dramatic lighting, shallow depth of field, film grain',
  anime: 'Anime style, vibrant colors, dynamic motion, Studio Ghibli inspired',
  realistic: 'Photorealistic, ultra-detailed, natural lighting, 8K resolution',
  ads: 'Professional advertisement, clean background, product focus, commercial quality',
  documentary: 'Documentary style, handheld camera, natural light, authentic feel',
};

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok', service: 'WIDJO API', version: '2.0.0',
  supabase: 'https://hmarstwuwqblftajqhxh.supabase.co',
  features: ['text-to-video', 'image-to-video', 'video-to-video', 'lip-sync', 'thumbnail', 'prompt-ai', 'credits'],
  timestamp: new Date().toISOString(),
}));

// ─── Prompt ───────────────────────────────────────────────────────────────────
app.post('/api/prompt/enhance', async (request, reply) => {
  const { prompt, style = 'cinematic', language = 'fr', duration = 10 } = request.body as Record<string, unknown> as { prompt: string; style?: string; language?: string; duration?: number };
  if (!prompt) return reply.status(400).send({ error: 'Prompt requis' });
  const translated = language === 'fr' ? `${prompt} [translated from French]` : prompt;
  const styleModifier = PROMPT_TEMPLATES[style] ?? PROMPT_TEMPLATES.cinematic;
  const enhanced = `${translated}, ${styleModifier}, duration: ${duration}s, high quality`;
  return reply.send({
    original: prompt, enhanced, style, duration,
    suggestions: [
      `${prompt}, golden hour lighting, ${styleModifier}`,
      `${prompt}, slow motion, ${styleModifier}`,
      `${prompt}, aerial view, ${styleModifier}`,
    ],
  });
});

app.get('/api/prompt/templates', async (_req, reply) => reply.send({
  styles: VIDEO_STYLES, durations: VIDEO_DURATIONS,
  templates: Object.entries(PROMPT_TEMPLATES).map(([style, modifier]) => ({
    style, modifier, example: `A woman dancing in Paris, ${modifier}`,
  })),
}));

// ─── Generate Video (endpoint principal) ─────────────────────────────────────
app.post('/api/generate-video', async (request, reply) => {
  const { prompt, user_id = 'anonymous', style = 'cinematic', duration = 10, type = 'text-to-video', source_image_url, source_video_url, audio_url } = request.body as Record<string, unknown> as { prompt: string; user_id?: string; style?: string; duration?: number; type?: string; source_image_url?: string; source_video_url?: string; audio_url?: string };
  if (!prompt?.trim()) return reply.status(400).send({ error: 'Prompt requis' });
  const styleModifier = PROMPT_TEMPLATES[style] ?? '';
  const enhancedPrompt = styleModifier ? `${prompt.trim()}, ${styleModifier}` : prompt.trim();
  const { data: video } = await supabaseAdmin.from('videos').insert({ user_id, prompt: enhancedPrompt, status: 'pending' }).select().single();
  const { data: job } = await supabaseAdmin.from('jobs').insert({ type, prompt: enhancedPrompt, status: 'pending', video_id: video?.id }).select().single();
  const apiUrl = process.env.API_URL ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001';
  return reply.status(201).send({
    success: true, job_id: job?.id, video_id: video?.id,
    prompt_original: prompt, prompt_enhanced: enhancedPrompt,
    style, duration, type, status: 'pending',
    runpod_payload: { job_id: job?.id, prompt: enhancedPrompt, style, duration, type, source_image_url, source_video_url, audio_url, webhook_url: `${apiUrl}/api/videos/webhook` },
    status_url: `${apiUrl}/api/jobs/${job?.id}`,
    message: 'Job créé. Envoyez runpod_payload à RunPod pour démarrer.',
  });
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────
app.post('/api/jobs', async (request, reply) => {
  const { prompt, user_id, type = 'text-to-video', style = 'cinematic', duration = 10, source_image_url, source_video_url, audio_url, width = 1280, height = 720 } = request.body as Record<string, unknown> as { prompt: string; user_id?: string; type?: string; style?: string; duration?: number; source_image_url?: string; source_video_url?: string; audio_url?: string; width?: number; height?: number };
  if (!prompt?.trim()) return reply.status(400).send({ error: 'Le prompt est requis' });
  if (!JOB_TYPES.includes(type)) return reply.status(400).send({ error: `Type invalide. Valeurs: ${JOB_TYPES.join(', ')}` });
  if (!VIDEO_DURATIONS.includes(duration)) return reply.status(400).send({ error: `Durée invalide. Valeurs: ${VIDEO_DURATIONS.join(', ')}s` });
  const { data: video, error: ve } = await supabaseAdmin.from('videos').insert({ user_id, prompt: prompt.trim(), status: 'pending' }).select().single();
  if (ve) return reply.status(500).send({ error: ve.message });
  const { data: job, error: je } = await supabaseAdmin.from('jobs').insert({ type, prompt: prompt.trim(), status: 'pending', video_id: video.id }).select().single();
  if (je) return reply.status(500).send({ error: je.message });
  const apiUrl = process.env.API_URL ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001';
  return reply.status(201).send({ job_id: job.id, video_id: video.id, type, style, duration, status: 'pending', runpod_payload: { job_id: job.id, prompt: prompt.trim(), style, duration, type, width, height, source_image_url, source_video_url, audio_url, webhook_url: `${apiUrl}/api/videos/webhook` }, message: 'Job créé.' });
});

app.get('/api/jobs', async (request, reply) => {
  const { status, type, limit = '20', offset = '0' } = request.query as Record<string, string>;
  let q = supabaseAdmin.from('jobs').select('*').order('created_at', { ascending: false }).range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return reply.status(500).send({ error: error.message });
  return reply.send({ jobs: data, count: data?.length ?? 0 });
});

app.get('/api/jobs/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { data, error } = await supabaseAdmin.from('jobs').select('*, videos(*)').eq('id', id).single();
  if (error || !data) return reply.status(404).send({ error: 'Job introuvable' });
  return reply.send({ job_id: data.id, type: data.type, prompt: data.prompt, status: data.status, output_url: data.output_url, error_message: data.error_message, video: data.videos, created_at: data.created_at });
});

app.patch('/api/jobs/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { status, output_url, error_message } = request.body as Record<string, string>;
  const valid = ['pending', 'processing', 'completed', 'failed'];
  if (!valid.includes(status)) return reply.status(400).send({ error: `Statut invalide: ${valid.join(', ')}` });
  const { data, error } = await supabaseAdmin.from('jobs').update({ status, output_url, error_message, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return reply.status(404).send({ error: 'Job introuvable' });
  if (data.video_id) await supabaseAdmin.from('videos').update({ status, video_url: output_url, updated_at: new Date().toISOString() }).eq('id', data.video_id);
  return reply.send({ job_id: data.id, status: data.status, output_url: data.output_url });
});

// ─── Videos ───────────────────────────────────────────────────────────────────
app.get('/api/videos', async (request, reply) => {
  const { user_id, status, limit = '20' } = request.query as Record<string, string>;
  let q = supabaseAdmin.from('videos').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (user_id) q = q.eq('user_id', user_id);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return reply.status(500).send({ error: error.message });
  return reply.send({ videos: data, count: data?.length ?? 0 });
});

app.get('/api/videos/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { data, error } = await supabaseAdmin.from('videos').select('*').eq('id', id).single();
  if (error || !data) return reply.status(404).send({ error: 'Vidéo introuvable' });
  return reply.send(data);
});

app.post('/api/videos/upload-url', async (request, reply) => {
  const { filename, video_id } = request.body as Record<string, string>;
  const path = `${video_id}/${Date.now()}-${filename}`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return reply.status(500).send({ error: error.message });
  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return reply.send({ upload_url: data.signedUrl, token: data.token, path, public_url: pub.publicUrl });
});

app.post('/api/videos/webhook', async (request, reply) => {
  const { job_id, video_url, status = 'completed', error_message } = request.body as Record<string, string>;
  if (!job_id) return reply.status(400).send({ error: 'job_id requis' });
  const { data } = await supabaseAdmin.from('jobs').update({ status, output_url: video_url, error_message, updated_at: new Date().toISOString() }).eq('id', job_id).select().single();
  if (data?.video_id) await supabaseAdmin.from('videos').update({ status, video_url, updated_at: new Date().toISOString() }).eq('id', data.video_id);
  return reply.send({ success: true, job_id, status, video_url });
});

// ─── Status alias ─────────────────────────────────────────────────────────────
app.get('/api/status/:job_id', async (request, reply) => {
  const { job_id } = request.params as { job_id: string };
  const { data, error } = await supabaseAdmin.from('jobs').select('id, status, output_url, error_message, created_at').eq('id', job_id).single();
  if (error || !data) return reply.status(404).send({ error: 'Job introuvable' });
  return reply.send({ job_id: data.id, status: data.status, video_url: data.output_url, error: data.error_message, created_at: data.created_at, is_ready: data.status === 'completed' });
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users/:id/credits', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { data: jobs } = await supabaseAdmin.from('jobs').select('type, status').eq('status', 'completed');
  const costs: Record<string, number> = { 'text-to-video': 10, 'image-to-video': 8, 'video-to-video': 12, 'text-to-image': 2, 'lip-sync': 5, 'thumbnail': 1 };
  const used = (jobs ?? []).reduce((s, j) => s + (costs[j.type] ?? 5), 0);
  return reply.send({ user_id: id, credits_total: 100, credits_used: used, credits_remaining: Math.max(0, 100 - used) });
});

app.get('/api/users/:id/history', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { data, error } = await supabaseAdmin.from('videos').select('*, jobs(type, status)').eq('user_id', id).order('created_at', { ascending: false }).limit(50);
  if (error) return reply.status(500).send({ error: error.message });
  return reply.send({ user_id: id, history: data, count: data?.length ?? 0 });
});

export default app;
