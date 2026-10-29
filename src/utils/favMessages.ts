export const FAV_MESSAGES = [
  'Me bendice',
  'Me unge',
  'Me ministra',
  'Qué bendición!',
  'Gloria a Dios!',
  'Aleluya!',
] as const;

/** Random message for the favourite burst; never repeats the previous one so it feels varied. */
export function randomFavMessage(previous?: string): string {
  const pool = FAV_MESSAGES.filter((m) => m !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}
