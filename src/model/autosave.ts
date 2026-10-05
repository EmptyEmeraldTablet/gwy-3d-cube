import { SerializedScene } from './serialize';

export interface LocalSnapshot { savedAt: number; scene: SerializedScene; }
const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('spatial-geometry', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('projects');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function readAutosave(): Promise<LocalSnapshot | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('projects').objectStore('projects').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function writeAutosave(scene: SerializedScene): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put({ scene, savedAt: Date.now() } satisfies LocalSnapshot, 'current'); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
