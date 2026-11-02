import prisma from "../../lib/prisma.js";
import type { swipe_action } from "../../generated/prisma/enums.js";

export interface SwipeResult {
  swipe: {
    id: string;
    swiper_id: string;
    swiped_id: string;
    action: swipe_action;
    created_at: Date;
  };
  isMatch: boolean;
  match?: any;
  conversation?: any;
}

const safeUserSelect = {
  id: true,
  status: true,
  profiles: {
    select: {
      display_name: true,
      birth_date: true,
      gender: true,
      bio: true,
      city: true,
      ward: true,
      hobbies: true,
      job_title: true,
      is_verified: true,
    },
  },
  photos: {
    select: {
      url: true,
      is_primary: true,
      position: true,
    },
  },
};

export class SwipesRepository {
  async findSwipe(swiperId: string, swipedId: string) {
    return prisma.swipes.findUnique({
      where: {
        swiper_id_swiped_id: {
          swiper_id: swiperId,
          swiped_id: swipedId,
        },
      },
    });
  }

  async userExists(userId: string): Promise<boolean> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return Boolean(user);
  }

  async createSwipeWithMatchCheck(
    swiperId: string,
    swipedId: string,
    action: swipe_action
  ): Promise<SwipeResult> {
    return prisma.$transaction(async (tx) => {
      // 1. Ghi nhận lượt quẹt của swiper
      const swipe = await tx.swipes.create({
        data: {
          swiper_id: swiperId,
          swiped_id: swipedId,
          action,
        },
      });

      // Nếu action là pass thì chắc chắn không match
      if (action === "pass") {
        return {
          swipe,
          isMatch: false,
        };
      }

      // 2. Kiểm tra xem người kia (swiped_id) trước đó đã từng like / super_like swiper chưa
      const reciprocalSwipe = await tx.swipes.findUnique({
        where: {
          swiper_id_swiped_id: {
            swiper_id: swipedId,
            swiped_id: swiperId,
          },
        },
      });

      const isMutual =
        reciprocalSwipe &&
        (reciprocalSwipe.action === "like" || reciprocalSwipe.action === "super_like");

      if (!isMutual) {
        return {
          swipe,
          isMatch: false,
        };
      }

      // 3. Hai bên đã like nhau -> Tạo Match!
      // Ràng buộc DB: user1_id < user2_id
      const [user1_id, user2_id] =
        swiperId < swipedId ? [swiperId, swipedId] : [swipedId, swiperId];

      // Kiểm tra tránh tạo trùng lặp match
      const existingMatch = await tx.matches.findUnique({
        where: {
          user1_id_user2_id: {
            user1_id,
            user2_id,
          },
        },
        include: {
          conversations: true,
        },
      });

      if (existingMatch) {
        return {
          swipe,
          isMatch: true,
          match: existingMatch,
          conversation: existingMatch.conversations,
        };
      }

      // Tạo bản ghi matches kèm theo conversation trong cùng transaction
      const newMatch = await tx.matches.create({
        data: {
          user1_id,
          user2_id,
          status: "active",
          matched_at: new Date(),
          conversations: {
            create: {
              created_at: new Date(),
            },
          },
        },
        include: {
          conversations: true,
          users_matches_user1_idTousers: {
            select: safeUserSelect,
          },
          users_matches_user2_idTousers: {
            select: safeUserSelect,
          },
        },
      });

      return {
        swipe,
        isMatch: true,
        match: newMatch,
        conversation: newMatch.conversations,
      };
    });
  }

  async getSwipesByUserId(
    userId: string,
    options: { skip: number; take: number; action?: swipe_action; sortOrder?: "asc" | "desc" }
  ) {
    const where: {
      swiper_id: string;
      action?: swipe_action;
    } = {
      swiper_id: userId,
    };

    if (options.action) {
      where.action = options.action;
    }

    return prisma.swipes.findMany({
      where,
      skip: options.skip,
      take: options.take,
      orderBy: {
        created_at: options.sortOrder ?? "desc",
      },
      include: {
        users_swipes_swiped_idTousers: {
          select: safeUserSelect,
        },
      },
    });
  }

  async countSwipesByUserId(userId: string, action?: swipe_action): Promise<number> {
    return prisma.swipes.count({
      where: {
        swiper_id: userId,
        ...(action && { action }),
      },
    });
  }

  async getUserSwipedMe(
    userId: string,
    options: { skip: number; take: number; sortOrder?: "asc" | "desc" }
  ) {
    const [outgoingSwipes, activeMatches] = await Promise.all([
      prisma.swipes.findMany({
        where: { swiper_id: userId },
        select: { swiped_id: true },
      }),
      prisma.matches.findMany({
        where: {
          status: "active",
          OR: [{ user1_id: userId }, { user2_id: userId }],
        },
        select: { user1_id: true, user2_id: true },
      }),
    ]);

    const excludedUserIds = new Set<string>([
      ...outgoingSwipes.map((swipe) => swipe.swiped_id),
      ...activeMatches.map((match) =>
        match.user1_id === userId ? match.user2_id : match.user1_id
      ),
    ]);

    const where = {
      swiped_id: userId,
      action: { in: ["like", "super_like"] as swipe_action[] },
      swiper_id: { notIn: [...excludedUserIds] },
    };

    const [data, total] = await Promise.all([
      prisma.swipes.findMany({
        where,
        skip: options.skip,
        take: options.take,
        orderBy: {
          created_at: options.sortOrder ?? "desc",
        },
        include: {
          users_swipes_swiper_idTousers: {
            select: safeUserSelect,
          },
        },
      }),
      prisma.swipes.count({ where }),
    ]);

    return { data, total };
  }
}
