/* eslint-env serviceworker */
/**
 * Service worker minimal de SallyCourse (Prompt 200) — UNIQUEMENT le Web Push
 * (aucun cache offline, aucune interception de requête : le SW ne doit rien
 * changer au comportement de l'application).
 *
 * La charge utile est le JSON chiffré envoyé par packages/shared/src/web-push.ts
 * ({ title, body, url }) : rappel de série quotidienne (streak-reminder du
 * worker), badge débloqué, etc. Un push sans corps lisible affiche quand même
 * une notification générique (userVisibleOnly: true impose de notifier).
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'SallyCourse';
  const options = {
    body: payload.body || '',
    // Pas d'`icon`/`badge` : l'app n'expose pas encore d'asset d'icône — le
    // navigateur applique son icône par défaut (rien à charger, rien à 404).
    // Ouvre le lien au clic (voir notificationclick ci-dessous).
    data: { url: payload.url || '/learn' },
    // Un rappel de série remplace le précédent plutôt que de s'empiler.
    tag: payload.tag || 'sallycourse',
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/learn';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Réutilise un onglet déjà ouvert sur l'application si possible.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
