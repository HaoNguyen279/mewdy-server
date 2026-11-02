import prisma from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export class PhotoLimitError extends Error {
  constructor() {
    super("A user can upload at most 9 photos");
    this.name = "PhotoLimitError";
  }
}

export class PhotoOrderError extends Error {
  constructor() {
    super("Photo order must contain every photo owned by the user exactly once");
    this.name = "PhotoOrderError";
  }
}

export class PhotosRepository {
  listForUser(userId: string) {
    return prisma.photos.findMany({
      where: { user_id: userId },
      orderBy: [{ position: "asc" }, { created_at: "asc" }],
    });
  }

  getOwnedPhoto(userId: string, photoId: string) {
    return prisma.photos.findFirst({
      where: { id: photoId, user_id: userId },
    });
  }

  async createForUser(userId: string, url: string, cloudinaryPublicId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.users.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) return null;

      const [count, latestPhoto] = await Promise.all([
        tx.photos.count({ where: { user_id: userId } }),
        tx.photos.findFirst({
          where: { user_id: userId },
          orderBy: { position: "desc" },
          select: { position: true },
        }),
      ]);
      if (count >= 9) throw new PhotoLimitError();

      const position = (latestPhoto?.position ?? -1) + 1;
      return tx.photos.create({
        data: {
          user_id: userId,
          url,
          cloudinary_public_id: cloudinaryPublicId,
          position,
          is_primary: count === 0,
        },
      });
    });
  }

  async setOrder(userId: string, orderedPhotoIds: string[]) {
    return prisma.$transaction(async (tx) => {
      const photos = await tx.photos.findMany({
        where: { user_id: userId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      const currentIds = new Set(photos.map((photo) => photo.id));
      if (
        orderedPhotoIds.length !== photos.length ||
        new Set(orderedPhotoIds).size !== orderedPhotoIds.length ||
        orderedPhotoIds.some((id) => !currentIds.has(id))
      ) {
        throw new PhotoOrderError();
      }

      await tx.$executeRawUnsafe("SET CONSTRAINTS photos_user_position_uq DEFERRED;");

      await tx.photos.updateMany({
        where: { user_id: userId },
        data: { is_primary: false },
      });
      for (const [position, id] of orderedPhotoIds.entries()) {
        await tx.photos.update({
          where: { id },
          data: { position, is_primary: position === 0 },
        });
      }

      return tx.photos.findMany({
        where: { user_id: userId },
        orderBy: { position: "asc" },
      });
    });
  }

  async deleteForUser(userId: string, photoId: string) {
    return prisma.$transaction(async (tx) => {
      const photos = await tx.photos.findMany({
        where: { user_id: userId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      const deletedPhoto = photos.find((photo) => photo.id === photoId);
      if (!deletedPhoto) return null;

      const remaining = photos.filter((photo) => photo.id !== photoId);
      await tx.$executeRawUnsafe("SET CONSTRAINTS photos_user_position_uq DEFERRED;");

      await tx.photos.updateMany({
        where: { user_id: userId },
        data: { is_primary: false },
      });
      await tx.photos.delete({ where: { id: photoId } });
      for (const [position, photo] of remaining.entries()) {
        await tx.photos.update({
          where: { id: photo.id },
          data: { position, is_primary: position === 0 },
        });
      }

      return deletedPhoto;
    });
  }
}
