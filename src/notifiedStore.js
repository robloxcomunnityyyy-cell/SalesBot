import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function loadNotified(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.notifiedIds)) {
      return new Set();
    }

    return new Set(parsed.notifiedIds);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set();
    }

    throw error;
  }
}

export async function saveNotified(filePath, notifiedIds) {
  await mkdir(dirname(filePath), { recursive: true });

  const payload = {
    notifiedIds: [...notifiedIds].sort(),
    updatedAt: new Date().toISOString()
  };

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
