import prisma from "../../lib/prisma.js";
import type { user_status } from "../../generated/prisma/enums.js";

export const userSafeSelect = {
  id: true,
  email: true,
  email_verified: true,
  phone: true,
  status: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
} as const;

export interface SafeUser {
  id: string;
  email: string | null;
  email_verified: boolean;
  phone: string | null;
  status: user_status;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
  profiles?: any;
  preferences?: any;
  photos?: any;
}

export interface FindUsersOptions {
  skip: number;
  take: number;
  where?: {
    status?: user_status;
    OR?: Array<{
      email?: { contains: string; mode: "insensitive" };
      phone?: { contains: string };
    }>;
  };
  orderBy?: {
    [key: string]: "asc" | "desc";
  };
  includeProfile?: boolean;
}

export class UsersRepository {
  async create(data: {
    email?: string | null;
    phone?: string | null;
    password_hash?: string | null;
    status?: user_status;
  }): Promise<SafeUser> {
    return prisma.users.create({
      data: {
        email: data.email ?? null,
        phone: data.phone ?? null,
        password_hash: data.password_hash ?? null,
        email_verified: false,
        status: data.status ?? "active",
      },
      select: userSafeSelect,
    });
  }

  async findById(id: string, includeRelations = false): Promise<SafeUser | null> {
    if (includeRelations) {
      return prisma.users.findUnique({
        where: { id },
        select: {
          ...userSafeSelect,
          profiles: true,
          preferences: true,
          photos: true,
        },
      });
    }

    return prisma.users.findUnique({
      where: { id },
      select: userSafeSelect,
    });
  }

  async findByIdWithPassword(id: string) {
    return prisma.users.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string) {
    return prisma.users.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });
  }

  async findByPhone(phone: string) {
    return prisma.users.findUnique({
      where: { phone },
    });
  }

  async findMany(options: FindUsersOptions): Promise<SafeUser[]> {
    return prisma.users.findMany({
      skip: options.skip,
      take: options.take,
      where: options.where,
      orderBy: options.orderBy,
      select: {
        ...userSafeSelect,
        profiles: options.includeProfile ? true : false,
      },
    });
  }

  async count(where?: FindUsersOptions["where"]): Promise<number> {
    return prisma.users.count({
      where,
    });
  }

  async update(
    id: string,
    data: {
      email?: string | null;
      phone?: string | null;
      status?: user_status;
      password_hash?: string | null;
      last_active_at?: Date | null;
    }
  ): Promise<SafeUser> {
    return prisma.users.update({
      where: { id },
      data: {
        ...data,
        ...(data.email !== undefined ? { email_verified: false } : {}),
        updated_at: new Date(),
      },
      select: userSafeSelect,
    });
  }

  async updateStatus(id: string, status: user_status): Promise<SafeUser> {
    return prisma.users.update({
      where: { id },
      data: {
        status,
        updated_at: new Date(),
      },
      select: userSafeSelect,
    });
  }

  async updateLastActive(id: string): Promise<SafeUser> {
    return prisma.users.update({
      where: { id },
      data: {
        last_active_at: new Date(),
      },
      select: userSafeSelect,
    });
  }

  async softDelete(id: string): Promise<SafeUser> {
    return prisma.users.update({
      where: { id },
      data: {
        status: "deleted",
        updated_at: new Date(),
      },
      select: userSafeSelect,
    });
  }

  async hardDelete(id: string): Promise<SafeUser> {
    return prisma.users.delete({
      where: { id },
      select: userSafeSelect,
    });
  }
}
