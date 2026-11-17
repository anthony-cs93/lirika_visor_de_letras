// Single Vercel serverless function for the whole API (Hobby plan allows max 12 functions).
// vercel.json rewrites every /api/* request here; the shared Express app (app.ts) does the routing.
import app from '../app.js';

export default app;
