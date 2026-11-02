import type { swipe_action } from "../../generated/prisma/enums.js";
import { invalidateUserMatchesCache } from "../matches/matches.service.js";
import { invalidateUserRecommendationsCache } from "../recommendations/recommendations.service.js";
import { SwipesRepository, type SwipeResult } from "./swipes.repository.js";
import type { CreateSwipeInput, ListSwipesQuery } from "./swipes.validation.js";
import { swipesTotal, matchesTotal } from "../../observability/metrics.js";
export class SwipesHttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "SwipesHttpError";
  }
}

export class SwipesService {
  constructor(private readonly swipesRepo: SwipesRepository) {}

  async createSwipe(input: CreateSwipeInput): Promise<SwipeResult> {
    const [swiperExists, swipedExists] = await Promise.all([
      this.swipesRepo.userExists(input.swiper_id),
      this.swipesRepo.userExists(input.swiped_id),
    ]);

    if (!swiperExists) {
      throw new SwipesHttpError(404, `Swiper user '${input.swiper_id}' not found`);
    }

    if (!swipedExists) {
      throw new SwipesHttpError(404, `Target user '${input.swiped_id}' not found`);
    }

    const existingSwipe = await this.swipesRepo.findSwipe(input.swiper_id, input.swiped_id);
    if (existingSwipe) {
      throw new SwipesHttpError(409, "You have already swiped on this user");
    }

    const result = await this.swipesRepo.createSwipeWithMatchCheck(
      input.swiper_id,
      input.swiped_id,
      input.action as swipe_action
    );

     swipesTotal.inc({ direction: input.action });

    // 3. Monitor tổng số match
    if (result.isMatch) {
      matchesTotal.inc();
    }
    const invalidations = [invalidateUserRecommendationsCache(input.swiper_id)];
    if (result.isMatch) {
      invalidations.push(
        invalidateUserRecommendationsCache(input.swiped_id),
        invalidateUserMatchesCache(input.swiper_id),
        invalidateUserMatchesCache(input.swiped_id),
      );
    }
    await Promise.all(invalidations);
    return result;
  }

  async getSwipesByUserId(userId: string, query?: Partial<ListSwipesQuery>) {
    const userExists = await this.swipesRepo.userExists(userId);
    if (!userExists) {
      throw new SwipesHttpError(404, `User '${userId}' not found`);
    }

    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 20));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.swipesRepo.getSwipesByUserId(userId, {
        skip,
        take: limit,
        action: query?.action as swipe_action | undefined,
        sortOrder: query?.sortOrder ?? "desc",
      }),
      this.swipesRepo.countSwipesByUserId(userId, query?.action as swipe_action | undefined),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserSwipedMe(userId: string, query?: Partial<ListSwipesQuery>) {
    const userExists = await this.swipesRepo.userExists(userId);
    if (!userExists) {
      throw new SwipesHttpError(404, `User '${userId}' not found`);
    }

    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 20));
    const skip = (page - 1) * limit;

    const { data, total } = await this.swipesRepo.getUserSwipedMe(userId, {
      skip,
      take: limit,
      sortOrder: query?.sortOrder ?? "desc",
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
