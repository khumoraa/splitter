import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes the user's data to a JSON file in the cache folder and opens the system share sheet ("Save to Files", AirDrop, ...). */
export async function shareAsJsonFile(data: unknown, baseName: string): Promise<'shared' | 'unavailable'> {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `${baseName}-${stamp}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(data, null, 2));
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: baseName });
  return 'shared';
}
