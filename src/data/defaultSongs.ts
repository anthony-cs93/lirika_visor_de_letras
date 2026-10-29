import { Song } from '../types/song';

export const INITIAL_SONGS: Song[] = [
  {
    id: 'soda-musica-ligera',
    title: 'De Música Ligera',
    artist: 'Soda Stereo',
    album: 'Canción Animal (1990)',
    tempo: 124,
    tags: ['Rock en Español', 'Clásico', 'Favoritas'],
    isFavorite: true,
    createdAt: '2026-01-10T12:00:00Z',
    updatedAt: '2026-01-10T12:00:00Z',
    source: 'local',
    lyrics: `[Intro]
(Introducción instrumental)

[Verso 1]
Ella durmió al calor de las brasas
Y yo desperté queriendo soñarla
Algún tiempo atrás pensé en escribirle
Que nunca sortié las trampas del amor

[Coro]
De aquel amor de música ligera
Nada nos libra, nada más queda

[Verso 2]
No le envié cenizas de rosas
Ni quise evitar un roce secreto

[Coro]
De aquel amor de música ligera
Nada nos libra, nada más queda
De aquel amor de música ligera
Nada nos libra, nada más queda

[Solo]
(Solo de guitarra)

[Puente]
Nada más queda, nada más queda
Nada más queda, nada más queda

[Outro]
Nada más queda...
¡Gracias totales!`,
  },
  {
    id: 'mana-rayando-sol',
    title: 'Rayando El Sol',
    artist: 'Maná',
    album: 'Falta Amor (1990)',
    tempo: 96,
    tags: ['Balada', 'Acústico', 'Favoritas'],
    isFavorite: true,
    createdAt: '2026-01-12T10:00:00Z',
    updatedAt: '2026-01-12T10:00:00Z',
    source: 'local',
    lyrics: `[Intro]
(Introducción acústica)

[Verso 1]
Rayando el sol, desesperación
Es más fácil llegar al sol que a tu corazón
Me muero por ti, viviendo sin ti
Y no aguanto, me duele tanto estar así

[Pre-Coro]
Tú no sabes lo que es el amor
Ni te importa el dolor

[Coro]
Rayando el sol
Ooh, desesperación
Es más fácil llegar al sol que a tu corazón
Rayando el sol, rayando el sol

[Verso 2]
A tu casa yo fui y no te encontré
En el parque, en la plaza, en el cine yo te busqué
Te tengo atrapada entre mi piel y mi alma
Y no aguanto, ya no puedo tanto estar así

[Coro]
Rayando el sol
Ooh, desesperación
Es más fácil llegar al sol que a tu corazón
Rayando el sol, rayando el sol

[Puente]
Dime si me quieres un poco
Dime si me tienes en tu mente
Porque ya me estoy volviendo loco
Desesperadamente

[Outro]
Rayando el sol...`,
  },
  {
    id: 'jarabe-la-flaca',
    title: 'La Flaca',
    artist: 'Jarabe de Palo',
    album: 'La Flaca (1996)',
    tempo: 112,
    tags: ['Pop Rock', 'Latino'],
    isFavorite: false,
    createdAt: '2026-01-15T09:00:00Z',
    updatedAt: '2026-01-15T09:00:00Z',
    source: 'local',
    lyrics: `[Intro]
(Introducción de guitarra y percusión)

[Verso 1]
En la Habana casi no hace frío
Pero aquella noche sí que corría viento
Y en el Malecón de La Habana
Yo encontré mi perdición

[Verso 2]
Por un beso de la flaca daría lo que fuera
Por un beso de ella, aunque sólo uno fuera
Por un beso de la flaca daría lo que fuera
Por un beso de ella, aunque sólo uno fuera

[Coro]
Cien libras de piel y hueso
Cuarenta kilos de salsa
Y en la cara dos soles
Que sin palabras hablaban

[Verso 3]
Mojada por el sudor que de su pecho caía
Bailaba sin parar, la noche se consumía
Y en el aire flotaba el aroma a tabaco y ron
Mientras yo le entregaba mi rendido corazón

[Coro]
Por un beso de la flaca daría lo que fuera
Por un beso de ella, aunque sólo uno fuera
Por un beso de la flaca daría lo que fuera
Aunque sólo uno fuera...

[Outro]
La Flaca duerme al fin.`,
  },
  {
    id: 'queen-bohemian-rhapsody',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera (1975)',
    tempo: 72,
    tags: ['Rock Clásico', 'Favoritas'],
    isFavorite: true,
    createdAt: '2026-01-16T14:00:00Z',
    updatedAt: '2026-01-16T14:00:00Z',
    source: 'local',
    lyrics: `[Intro]
Is this the real life?
Is this just fantasy?
Caught in a landslide, no escape from reality
Open your eyes, look up to the skies and see
I'm just a poor boy, I need no sympathy
Because I'm easy come, easy go, little high, little low
Any way the wind blows doesn't really matter to me, to me

[Verso 1]
Mama, just killed a man
Put a gun against his head, pulled my trigger, now he's dead
Mama, life had just begun
But now I've gone and thrown it all away
Mama, oooh, didn't mean to make you cry
If I'm not back again this time tomorrow
Carry on, carry on as if nothing really matters

[Verso 2]
Too late, my time has come
Sends shivers down my spine, body's aching all the time
Goodbye, everybody, I've got to go
Gotta leave you all behind and face the truth
Mama, oooh, I don't wanna die
I sometimes wish I'd never been born at all

[Solo]
(Guitar Solo)

[Puente]
I see a little silhouetto of a man
Scaramouche, Scaramouche, will you do the Fandango?
Thunderbolt and lightning, very, very frightening me!
Galileo, Galileo, Galileo Figaro Magnifico!
I'm just a poor boy nobody loves me
He's just a poor boy from a poor family
Spare him his life from this monstrosity!

[Coro]
Easy come, easy go, will you let me go?
Bismillah! No, we will not let you go!
Let him go! Bismillah! We will not let you go!
Let me go! Never, never let me go!

[Outro]
Nothing really matters, anyone can see
Nothing really matters, nothing really matters to me
Any way the wind blows...`,
  },
];
