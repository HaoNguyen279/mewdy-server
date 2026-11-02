import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma");
}

const poolMax = Number(process.env.DATABASE_POOL_MAX ?? "1");
if (!Number.isSafeInteger(poolMax) || poolMax < 1) {
  throw new Error("DATABASE_POOL_MAX must be a positive integer");
}

const adapter = new PrismaPg({ connectionString, max: poolMax });
const prisma = new PrismaClient({ adapter });

export default prisma;
