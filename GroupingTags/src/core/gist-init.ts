import {AuthManager} from './auth';
import {gmFetch} from './network';

const API_BASE = 'https://api.github.com/gists';

export async function initializeGist() {
  const token = await AuthManager.getToken();
  if (!token) return; // Stop if no token

  const existingId = AuthManager.getGistId();

  // 1. Check existing Gist validity
  if (existingId) {
    try {
      // Fetch Gist info
      await fetchGist(existingId, token);

      return existingId;
    } catch (e) {
      console.warn('⚠️ Existing Gist not found. Creating new one.');
      // Fallback to creation
    }
  }

  // 2. Create new Gist
  const newGistId = await createNewGist(token);
  AuthManager.setGistId(newGistId);

  return newGistId;
}

// Gist Creation API
async function createNewGist(token: string): Promise<string> {
  // Initial Setup: manifest and README
  const initialFiles = {
    'manifest.json': {
      content: JSON.stringify(
        {
          schemaVersion: 1,
          lastSynced: Date.now(),
          device: navigator.userAgent,
          totalGroups: 0,
        },
        null,
        2,
      ),
    },
    'README.md': {
      content:
        '# Danbooru Grouping Tags Data\n\nThis Gist is a data store for the UserScript.',
    },
  };

  const response = await gmFetch(API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      description: 'Danbooru Grouping Tags Data',
      public: false, // Secret Gist
      files: initialFiles,
    }),
  });

  // validated by gmFetch
  const data = await response.json();
  return data.id;
}

// Gist Fetch Helper
async function fetchGist(gistId: string, token: string) {
  const res = await gmFetch(`${API_BASE}/${gistId}`, {
    headers: {Authorization: `token ${token}`},
  });
  return res.json();
}
