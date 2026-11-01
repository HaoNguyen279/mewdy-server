import { cacheService } from "../lib/cache.js";
import prisma from "../lib/prisma.js";

const authUserSelect = {
  id: true,
  email: true,
  email_verified: true,
  phone: true,
  status: true,
  firebase_uid: true,
  google_sub: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
} as const;

export function getCachedFirebaseUser(firebaseUid: string) {
  return cacheService.getOrSet(`auth:user:firebase:${firebaseUid}`, 900, () =>
    prisma.users.findUnique({
      where: { firebase_uid: firebaseUid },
      select: authUserSelect,
    }),
  );
}

export function getCachedGoogleUser(googleSub: string) {
  return cacheService.getOrSet(`auth:user:google:${googleSub}`, 900, () =>
    prisma.users.findUnique({
      where: { google_sub: googleSub },
      select: authUserSelect,
    }),
  );
}

/** Identity keys contain provider IDs, so clear the auth namespace after account changes. */
export function invalidateAuthUserCache(): Promise<void> {
  return cacheService.delByPattern("auth:user:*");
}
