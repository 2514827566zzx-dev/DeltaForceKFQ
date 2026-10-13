let database;
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('delta-harmonica', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('imports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readImports() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('imports').objectStore('imports').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveImport(song) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').put(song);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
