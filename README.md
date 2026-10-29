# Lirika · Lector y editor de letras

Lee y edita letras de canciones: modos **Full** y **Live**, auto-scroll, favoritas, secciones (V1, C, Pr, P, In…),
modo claro/oscuro y sincronización offline + nube (Turso).

## Desarrollo local

```bash
npm install
npm run dev          # http://localhost:3000 (Vite + API Express)
```

Variables en `.env` (ver `.env.example`): `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.
Sin ellas la sincronización en la nube no funciona.

> En Windows, si la ruta de la carpeta contiene `&`, `npm run dev` falla. Usa:
> `node node_modules/tsx/dist/cli.mjs server.ts`

## Despliegue en Vercel

1. Importa el repositorio en Vercel. Se detecta **Vite**; `vercel.json` ya fija el build (`vite build` → `dist/`).
2. En *Settings → Environment Variables* agrega:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `SITE_URL` (opcional, solo con dominio propio; por defecto usa el dominio de producción de Vercel)
3. Despliega. Cada ruta `/api/*` es una función (`api/health.ts`, `api/sync/*.ts`, `api/lyrics/*.ts`) que reutiliza `app.ts`,
   el mismo Express que usa el servidor local.

### Estructura relevante

| Archivo | Para qué |
| --- | --- |
| `app.ts` | Rutas `/api` (sync con Turso, buscadores de letras) |
| `server.ts` | Servidor local: Vite en desarrollo / `dist/` en producción local |
| `api/**` | Una función de Vercel por ruta, todas sobre `app.ts` |
| `vercel.json` | Build, caché y cabeceras de seguridad |
| `public/` | Favicon, íconos PWA, `og-image.png`, `manifest.webmanifest`, `robots.txt` |
