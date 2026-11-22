// Locally bundled edition. Use the same JSON schema and localStorage key as the web edition.
export async function openPortRecovery(account) {
  if (!account || !document.querySelector('meta[name="local-port-recovery"]')) return null;
  const url = './api/local-workspace';
  const username = encodeURIComponent(account.username);
  const snapshot = { state: null, revision: '', ready: false };
  try {
    const response = await fetch(url, {cache: 'no-store', headers: {'X-Workspace-Account': username}});
    if (response.ok) Object.assign(snapshot, await response.json(), {ready: true});
  } catch { /* The browser cache remains available to read. */ }

  snapshot.write = (serialized) => {
    if (!snapshot.ready) throw new Error('Reload the workspace');
    // A confirmed save must survive immediately closing the local service window.
    // Existing business actions commit synchronously; this request only goes to loopback.
    const request = new XMLHttpRequest();
    request.open('POST', url, false);
    request.setRequestHeader('Content-Type', 'application/json');
    request.setRequestHeader('X-Workspace-Account', username);
    request.setRequestHeader('X-Workspace-Revision', snapshot.revision);
    request.send(serialized);
    if (request.status !== 200) throw new Error('Reload the workspace');
    snapshot.revision = JSON.parse(request.responseText).revision;
  };
  return snapshot;
}
