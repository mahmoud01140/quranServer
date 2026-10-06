import { google } from 'googleapis';
import { Readable } from 'stream';

// ─── Google Drive Configuration ─────────────────────────────────────
// Uses a Service Account for server-side uploads (no OAuth consent).
// Only used for the PUBLIC LIBRARY — Cloudinary remains for audio/receipts.

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const isGoogleDriveEnabled = Boolean(
  process.env.GOOGLE_DRIVE_FOLDER_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
);

let driveClient = null;
let authClient = null;

/**
 * Lazily initialise the service-account JWT (singleton).
 * The key never leaves the server — browsers only ever receive
 * single-use resumable-upload session URIs (see below).
 */
const getAuthClient = () => {
  if (authClient) return authClient;
  authClient = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    // .env stores the key with literal "\n" — convert to real newlines
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    SCOPES,
  );
  return authClient;
};

/**
 * Lazily initialise the Google Drive API client.
 * We only create the JWT + drive instance once (singleton).
 */
const getDriveClient = () => {
  if (driveClient) return driveClient;
  driveClient = google.drive({ version: 'v3', auth: getAuthClient() });
  return driveClient;
};

/**
 * Create a resumable-upload session for DIRECT browser-to-Drive upload.
 * The browser PUTs the file bytes straight to Google (our server never sees
 * them — no Vercel body/timeout limits). The session is single-use and bound
 * to one pre-defined filename + parent folder, so the browser cannot redirect
 * the file anywhere else.
 *
 * @param {{ filename: string, mimeType: string, size: number, subfolder?: string }}
 * @returns {Promise<{ sessionUri: string }>}
 */
export const createResumableUploadSession = async ({ filename, mimeType, size, subfolder }) => {
  const auth = getAuthClient();
  const drive = getDriveClient();
  const parentId = subfolder
    ? await getOrCreateSubfolder(drive, subfolder)
    : process.env.GOOGLE_DRIVE_FOLDER_ID;

  // Initiate the resumable session via an authorized raw request and capture
  // the single-use upload URI from the Location header.
  const res = await auth.request({
    url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
    },
    data: {
      name: filename,
      parents: [parentId],
      mimeType,
    },
  });

  const sessionUri = res?.headers?.location;
  if (!sessionUri) {
    throw new Error('Drive did not return an upload session URI');
  }
  return { sessionUri };
};

/**
 * Verify a browser-uploaded file really lives inside OUR Drive folder tree
 * (root = GOOGLE_DRIVE_FOLDER_ID, depth ≤ 2 since we only create root/subfolder).
 * Guards against forged driveFileIds pointing at foreign files.
 * @returns {Promise<false | { id, name, mimeType, size }>}
 */
export const verifyDriveFileInOurTree = async (fileId) => {
  try {
    const drive = getDriveClient();
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, parents',
    });
    const parents = meta.data.parents || [];
    if (parents.includes(rootId)) {
      return { id: meta.data.id, name: meta.data.name, mimeType: meta.data.mimeType, size: Number(meta.data.size) || 0 };
    }
    // One level up: our subfolders live directly under root
    for (const parentId of parents) {
      try {
        const parent = await drive.files.get({ fileId: parentId, fields: 'id, parents' });
        if ((parent.data.parents || []).includes(rootId)) {
          return { id: meta.data.id, name: meta.data.name, mimeType: meta.data.mimeType, size: Number(meta.data.size) || 0 };
        }
      } catch (_) { }
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Grant anyone-with-link reader access (used after verifying a browser upload).
 */
export const makeDriveFilePublic = async (fileId) => {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  const updated = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, webViewLink, webContentLink',
  });
  return {
    fileId: updated.data.id,
    fileName: updated.data.name,
    mimeType: updated.data.mimeType,
    size: Number(updated.data.size) || 0,
    webViewLink: updated.data.webViewLink,
    webContentLink: updated.data.webContentLink,
    directLink: `https://drive.google.com/uc?export=download&id=${updated.data.id}`,
  };
};

/**
 * Upload a file buffer to Google Drive inside the configured folder.
 * Returns { fileId, webViewLink, webContentLink, directLink }
 *
 * @param {Buffer} buffer     - The file content
 * @param {string} filename   - Original filename (used as Drive name)
 * @param {string} mimeType   - MIME type of the file
 * @param {string} [subfolder] - Optional subfolder name inside the root folder
 */
export const uploadToGoogleDrive = async (buffer, filename, mimeType, subfolder) => {
  const drive = getDriveClient();
  const parentId = subfolder
    ? await getOrCreateSubfolder(drive, subfolder)
    : process.env.GOOGLE_DRIVE_FOLDER_ID;

  const fileMetadata = {
    name: filename,
    parents: [parentId],
  };

  const media = {
    mimeType,
    body: Readable.from(buffer),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, mimeType, size, webViewLink, webContentLink',
  });

  const file = response.data;

  // Make the file publicly readable (anyone with link can view/download)
  await drive.permissions.create({
    fileId: file.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  // Re-fetch to get updated links after permission change
  const updated = await drive.files.get({
    fileId: file.id,
    fields: 'id, name, mimeType, size, webViewLink, webContentLink',
  });

  return {
    fileId: updated.data.id,
    fileName: updated.data.name,
    mimeType: updated.data.mimeType,
    size: Number(updated.data.size) || 0,
    webViewLink: updated.data.webViewLink,       // opens in browser viewer
    webContentLink: updated.data.webContentLink, // direct download
    // Reliable direct-embed URL for images/PDF/video preview
    directLink: `https://drive.google.com/uc?export=download&id=${updated.data.id}`,
  };
};

/**
 * Delete a file from Google Drive by its fileId.
 */
export const deleteFromGoogleDrive = async (fileId) => {
  if (!fileId) return false;
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
    return true;
  } catch (err) {
    console.error('Google Drive delete error:', err.message);
    return false;
  }
};

/**
 * Get or create a subfolder inside the root Drive folder.
 * Caches folder IDs in memory to avoid repeated API calls.
 */
const subfolderCache = new Map();

const getOrCreateSubfolder = async (drive, folderName) => {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const cacheKey = `${rootId}/${folderName}`;

  if (subfolderCache.has(cacheKey)) return subfolderCache.get(cacheKey);

  // Check if subfolder already exists
  const search = await drive.files.list({
    q: `'${rootId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    spaces: 'drive',
  });

  if (search.data.files.length > 0) {
    subfolderCache.set(cacheKey, search.data.files[0].id);
    return search.data.files[0].id;
  }

  // Create the subfolder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
    },
    fields: 'id',
  });

  subfolderCache.set(cacheKey, folder.data.id);
  return folder.data.id;
};

export { isGoogleDriveEnabled };
export default getDriveClient;
