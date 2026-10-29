// Vercel serverless entry: every /api/* request is handled by the same Express app used in local dev.
import app from '../app.js';

export default app;
