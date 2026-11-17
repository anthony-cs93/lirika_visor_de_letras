# Plan: letra sincronizada (LRC) en Lirika

Estado: **propuesto, sin implementar**. Este documento solo describe el trabajo; ningún archivo de código se ha tocado.

## 1. Objetivo

Que Lirika use las letras sincronizadas de LRCLIB (una marca de tiempo por línea) para que, mientras se toca o se escucha la canción, el visor **resalte la línea actual y desplace la letra solo**, en lugar de la velocidad fija de auto-scroll de hoy.

Fuera de alcance por ahora: reproducir audio dentro de la app (LRCLIB no trae audio).

## 2. Punto de partida (qué hay hoy)

| Pieza | Dónde | Situación actual |
|---|---|---|
| Búsqueda en LRCLIB | `app.ts` → `searchWebLyrics()` y `/api/lyrics/web-search` | Ya devuelve `plainLyrics` **y** `syncedLyrics` por resultado. |
| Buscador unificado | `src/components/LyricsSearchModal.tsx` | Un solo botón; busca en base general + LRCLIB + Letras.com. Los resultados de LRCLIB con `syncedLyrics` ya muestran el tag **Sincronizada**. |
| Descarte de tiempos | `pickResult()` en `LyricsSearchModal.tsx` → `cleanLrcContent()` en `src/utils/lyricsParser.ts` | Convierte el LRC a texto plano y **pierde los tiempos**. Es el punto exacto a cambiar. |
| Modelo de canción | `src/types/song.ts` (`Song`) | No tiene campo para tiempos. |
| Persistencia/sync | `src/utils/storage.ts` + tabla `songs` (columna `data` = JSON completo) | Un campo nuevo en `Song` viaja solo: **no hace falta migración de base de datos**. |
| Visor | `src/components/SongViewer.tsx` | Full: scroll continuo a `scrollPx` px/s o `scrollSecs` totales; Live: avanza de sección por duración estimada. Ambos ignoran tiempos reales. |

## 3. Diseño

### 3.1 Datos

Añadir a `Song` (ver `src/types/song.ts`):

```ts
syncedLyrics?: string;   // LRC crudo tal como llega de LRCLIB (fuente de verdad)
syncOffsetMs?: number;   // ajuste fino por canción, positivo = adelantar la letra
```

- Guardar el LRC **crudo**; derivar la lista `{ timeMs, text }[]` al abrir la canción con un parser nuevo (`parseLrc` en `lyricsParser.ts`). Así no hay formato intermedio que mantener.
- Soportar marcas `[mm:ss.xx]` y `[mm:ss.xxx]`, varias marcas por línea (`[00:10.00][01:30.00] texto`) y etiquetas de metadatos (`[ar:]`, `[ti:]`, `[offset:]`), que se ignoran salvo `offset`.

### 3.2 Alinear tiempos con el texto/bloques

Las líneas del LRC no traen secciones (Verso, Coro…), y los bloques de la app salen de `parseLyricsToBlocks()` sobre el texto limpio.

- Al guardar desde LRCLIB, el texto de la canción se genera **a partir de las mismas líneas** del LRC (misma cantidad y orden), de modo que `línea i del texto ↔ marca i del LRC`.
- Al editar la letra después:
  - si el **número de líneas no vacías** no cambia → los tiempos se conservan;
  - si cambia → marcar la canción como **"desincronizada"** (aviso en el visor) y ofrecer volver a la versión de LRCLIB o seguir con auto-scroll normal.
- Las líneas vacías del LRC (pausas instrumentales) se tratan como separadores de bloque cuando coinciden con saltos de línea del texto.

### 3.3 Reloj en el visor (modo sincronizado)

- Un reloj propio (`performance.now()`), **no** audio: arranca con Play (reutilizando la cuenta regresiva de 3 s que ya existe), se pausa con el mismo botón.
- En cada frame se calcula la línea actual (búsqueda binaria sobre los tiempos + `syncOffsetMs`).
- **Full:** el scroll interpola la posición entre la línea actual y la siguiente según el tiempo → movimiento continuo y natural. Sigue sincronizando el chip de sección activo con el scroll (ya implementado).
- **Live:** cambia de sección cuando la línea actual pasa a otro bloque, en vez de usar la duración estimada.
- La línea actual se resalta (sin volver a opacar el resto, para respetar el diseño "todo al mismo nivel": solo un énfasis suave en la línea activa, a confirmar).
- Si la canción **no** tiene `syncedLyrics`, el visor se comporta exactamente como hoy.

### 3.4 Control durante la música (fase 2)

- **Offset ±0,5 s** (botones en el panel de velocidad), guardado en `syncOffsetMs`.
- **Tocar una línea = saltar** el reloj a su tiempo (re-sincronizar con la música real).
- Pausar y reanudar desde la línea actual.

### 3.5 Canciones sin tiempos (fase 3, opcional)

Editor "toca para marcar": se reproduce la canción por fuera, y el usuario toca cada línea al cantarse; se genera un LRC propio y se guarda en `syncedLyrics`.

## 4. Fases y tareas

### Fase 1 — Guardar y seguir (MVP)
- [ ] `Song`: añadir `syncedLyrics?` y `syncOffsetMs?` (`src/types/song.ts`).
- [ ] `lyricsParser.ts`: `parseLrc(lrc)` → `{ timeMs, text }[]`, con pruebas de los formatos de §3.1.
- [ ] `LyricsSearchModal.tsx`: en `pickResult`/`openEditor`/`handleSave`, conservar `syncedLyrics` del resultado elegido y generar el texto desde sus líneas; indicar en el editor que la canción quedará sincronizada.
- [ ] `SongViewer.tsx`: reloj, cálculo de línea actual y scroll interpolado en Full; avance de sección por tiempo en Live; resaltado suave de la línea activa.
- [ ] Indicador en la lista de canciones (icono o tag "Sincronizada") para las canciones con tiempos.
- [ ] Verificar que el campo nuevo se sincroniza con Turso (tabla `songs`, columna `data`) y no rompe canciones existentes.

### Fase 2 — Ajuste en vivo
- [ ] Offset ±0,5 s con persistencia por canción.
- [ ] Tocar una línea para saltar el reloj a su tiempo.
- [ ] Aviso "desincronizada" al editar la letra y cambiar el número de líneas (§3.2).

### Fase 3 — Tiempos propios
- [ ] Editor "toca para marcar" para canciones sin LRC en LRCLIB.
- [ ] Posibilidad de importar un archivo `.lrc`.

## 5. Riesgos y decisiones abiertas

1. **Versión equivocada.** LRCLIB tiene varias versiones por canción (estudio, en vivo, remasters) y los tiempos solo sirven si coinciden con la grabación usada. Mitigación: mostrar la duración en los resultados de LRCLIB y permitir offset.
2. **Cobertura.** El catálogo es débil en alabanzas y música cristiana poco conocida; muchas canciones no tendrán LRC → de ahí la fase 3.
3. **Deriva del reloj.** Un cronómetro manual puede desfasarse de la música real; se compensa con offset y salto por toque (fase 2).
4. **Calidad de los LRC.** Pueden traer líneas duplicadas, errores o formato irregular; el editor actual permite corregir el texto antes de guardar.
5. **Decisión pendiente:** cómo se reproduce la música (fuera de la app con cronómetro manual, que es lo planteado aquí, o audio dentro de la app, que sería un proyecto mucho mayor).
6. **Decisión pendiente:** estilo exacto del resaltado de la línea activa en Full, dado que se eliminaron los bloques opacados.

## 6. Criterios de aceptación (fase 1)

- Al guardar una canción desde un resultado "Sincronizada" de LRCLIB, queda con sus tiempos y se ve la marca en la lista.
- En el visor, al pulsar Play, la línea actual se resalta y la letra se desplaza siguiendo los tiempos, en Full y en Live.
- Una canción sin `syncedLyrics` funciona exactamente igual que hoy.
- Los tiempos sobreviven a cerrar la app y a sincronizar con otro dispositivo.
- `tsc` sin errores y sin regresiones en canciones existentes.
