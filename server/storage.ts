import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let bucketEnsured = false;

function getStorageConfig() {
  const url = process.env.SUPABASE_URL?.trim() || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'nepefy-uploads';
  return { url, serviceKey, bucket };
}

function getSupabaseAdminClient(): SupabaseClient | null {
  const { url, serviceKey } = getStorageConfig();
  if (!url || !serviceKey) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function isSupabaseStorageConfigured(): boolean {
  const { url, serviceKey } = getStorageConfig();
  return Boolean(url && serviceKey);
}

async function ensureBucketExists(client: SupabaseClient, bucket: string): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: buckets } = await client.storage.listBuckets();
    if (!buckets?.some((b: { name: string }) => b.name === bucket)) {
      await client.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      });
    }
    bucketEnsured = true;
  } catch {
    // Non-fatal if bucket already exists or restricted by policy
  }
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Uploads a base64 data URL image to Supabase Storage and returns its public HTTPS URL.
 * Gracefully returns the input string unchanged if it is already an HTTP(S) URL or if
 * Supabase Storage credentials are not configured.
 */
export async function uploadImageAsset(
  dataOrUrl: string,
  folder: 'kyc' | 'deposits' | 'p2p' | 'support' | 'avatars',
  ownerId: string
): Promise<string> {
  const trimmed = String(dataOrUrl || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const client = getSupabaseAdminClient();
  if (!client) return trimmed;

  const match = trimmed.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/is);
  if (!match) return trimmed;

  const mime = match[1].toLowerCase();
  const base64Payload = match[2];
  const ext = MIME_TO_EXT[mime];
  if (!ext) return trimmed;
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer.length) return trimmed;

  const { bucket } = getStorageConfig();
  await ensureBucketExists(client, bucket);

  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
  const objectPath = `${folder}/${safeOwner}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  const { error } = await client.storage.from(bucket).upload(objectPath, buffer, {
    contentType: mime,
    upsert: false,
  });

  if (error) {
    console.warn('[storage] Supabase upload fallback to inline payload:', error.message);
    return trimmed;
  }

  const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
  return data?.publicUrl || trimmed;
}
