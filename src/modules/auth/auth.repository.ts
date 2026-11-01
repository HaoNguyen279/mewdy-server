import prisma from "../../lib/prisma.js";
import { getCachedFirebaseUser, getCachedGoogleUser, invalidateAuthUserCache } from "../../middlewares/authenticate.js";

const authUserSelect = {
  id: true,
  email: true,
  email_verified: true,
  phone: true,
  status: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
} as const;

export class AuthRepository {
  async findByEmail(email: string) {
    return prisma.users.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: authUserSelect,
    });
  }

  async findByPhone(phone: string) {
    return prisma.users.findUnique({
      where: { phone },
      select: authUserSelect,
    });
  }

  async findPasswordUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { ...authUserSelect, password_hash: true },
    });
  }

  async findPasswordUserByPhone(phone: string) {
    return prisma.users.findUnique({
      where: { phone },
      select: { ...authUserSelect, password_hash: true },
    });
  }

  async createPasswordUser(email: string | null, phone: string | null, passwordHash: string) {
    return prisma.users.create({
      data: { email, phone, password_hash: passwordHash, email_verified: false, last_active_at: new Date() },
      select: authUserSelect,
    });
  }

  async findByGoogleSub(googleSub: string) {
    return getCachedGoogleUser(googleSub);
  }

  async createGoogleUser(googleSub: string, email: string | null, emailVerified: boolean) {
    return prisma.users.create({
      data: {
        google_sub: googleSub,
        email,
        email_verified: emailVerified,
        last_active_at: new Date(),
      },
      select: authUserSelect,
    });
  }

  async recordSignIn(id: string, verifiedProviderEmail: string | null = null) {
    const user = await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id },
        data: { last_active_at: new Date(), updated_at: new Date() },
      });
      if (verifiedProviderEmail) {
        await tx.users.updateMany({
          where: { id, email: { equals: verifiedProviderEmail, mode: "insensitive" } },
          data: { email_verified: true },
        });
      }
      return tx.users.findUnique({ where: { id }, select: authUserSelect });
    });
    await invalidateAuthUserCache();
    return user;
  }

  async recordFirebaseSignIn(id: string, firebaseEmail: string | null, emailVerified: boolean) {
    const user = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.users.findUnique({
        where: { id },
        select: { email: true },
      });
      if (!existingUser) return null;

      const now = new Date();
      const emailMatches =
        !firebaseEmail ||
        !existingUser.email ||
        existingUser.email.toLowerCase() === firebaseEmail.toLowerCase();

      await tx.users.update({
        where: { id },
        data: {
          last_active_at: now,
          updated_at: now,
          ...(firebaseEmail
            ? { email_verified: emailMatches && emailVerified }
            : {}),
        },
      });

      return tx.users.findUnique({ where: { id }, select: authUserSelect });
    });
    await invalidateAuthUserCache();
    return user;
  }

  async findByFirebaseUid(firebaseUid: string) {
    return getCachedFirebaseUser(firebaseUid);
  }

  /** Bypass cached misses when reconciling a concurrent first Firebase sign-in. */
  async findByFirebaseUidFromDatabase(firebaseUid: string) {
    return prisma.users.findUnique({
      where: { firebase_uid: firebaseUid },
      select: authUserSelect,
    });
  }

  async createFirebaseUser(firebaseUid: string, email: string | null, emailVerified: boolean) {
    return prisma.users.create({
      data: {
        firebase_uid: firebaseUid,
        email,
        email_verified: emailVerified,
        last_active_at: new Date(),
      },
      select: authUserSelect,
    });
  }

  async linkFirebaseToExisting(id: string, firebaseUid: string) {
    const user = await prisma.users.update({
      where: { id },
      data: {
        firebase_uid: firebaseUid,
        updated_at: new Date(),
      },
      select: authUserSelect,
    });
    await invalidateAuthUserCache();
    return user;
  }

  async setProfileVerifiedByFirebaseUid(firebaseUid: string, isVerified: boolean) {
    const user = await prisma.users.findUnique({
      where: { firebase_uid: firebaseUid },
      select: { id: true },
    });
    if (!user) return false;

    const result = await prisma.profiles.updateMany({
      where: { user_id: user.id },
      data: { is_verified: isVerified },
    });
    return result.count > 0;
  }
}
