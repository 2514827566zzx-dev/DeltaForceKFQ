import { readFile, writeFile } from 'node:fs/promises';
import { parseMidi } from './dist/music.js';
import { createHash } from 'node:crypto';
const root = new URL('./dist/', import.meta.url);
const catalogURL = new URL('assets/library.json', root);
const songs = JSON.parse(await readFile(catalogURL, 'utf8'));
for (const song of songs) {
  const bytes = await readFile(new URL(song.file, root));
  const score = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (score.notes.length !== song.expectedNotes) throw new Error(`${song.name}: ${score.notes.length} != ${song.expectedNotes}`);
  song.duration = score.duration; song.bpm = score.bpm;
  song.hash = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(catalogURL, JSON.stringify(songs, null, 2));
console.log(`Prepared ${songs.length} songs; every note count matches the source catalog.`);
