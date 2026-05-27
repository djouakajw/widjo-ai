import app from './app.js';

const PORT = parseInt(process.env.PORT ?? '3001');
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`\n✅ WIDJO API v2.0 — http://localhost:${PORT}`);
console.log(`   POST /api/generate-video`);
console.log(`   GET  /api/status/:job_id`);
console.log(`   POST /api/videos/webhook`);
console.log(`   GET  /api/prompt/templates\n`);
