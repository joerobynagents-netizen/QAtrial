const LEGACY_OFFLINE_DATABASE = 'qatrial-offline';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Retire the legacy service worker and all of the data it could have kept.
 * This intentionally runs in the page (instead of depending solely on a
 * service-worker update) so a newly delivered shell repairs an old client at
 * its next boot.
 */
export async function retireLegacyClientCache(): Promise<void> {
  const tasks: Promise<unknown>[] = [deleteDatabase(LEGACY_OFFLINE_DATABASE)];

  if ('serviceWorker' in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined),
    );
  }

  if ('caches' in window) {
    tasks.push(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined),
    );
  }

  await Promise.all(tasks);
}

/** Clear browser-held application state before returning to the root shell. */
export async function clearClientDataAndReload(): Promise<void> {
  await retireLegacyClientCache();
  localStorage.clear();
  sessionStorage.clear();
  window.location.replace('/');
}
