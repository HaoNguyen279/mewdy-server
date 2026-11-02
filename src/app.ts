import express, { Router } from "express";
import cors from "./config/cors.js";
import "dotenv/config";
import profilesRouter from "./modules/profiles/profiles.routes.js";
import swipesRouter from "./modules/swipes/swipes.routes.js";
import usersRouter from "./modules/users/users.routes.js";
import photosRouter from "./modules/photos/photos.routes.js";
import preferencesRouter from "./modules/preferences/preferences.routes.js";
import matchesRouter from "./modules/matches/matches.routes.js";
import recommendationsRouter from "./modules/recommendations/recommendations.routes.js";
import authRouter from "./modules/auth/auth.routes.js";
import chatRouter from "./modules/chat/chat.routes.js";
import discoveryGroupsRouter from "./modules/discovery-groups/discovery-groups.routes.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { register, metricsMiddleware } from "./observability/metrics.js";
const app = express();

app.use(cors);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Server is running" });
});

app.get("/", (_req, res) => {
  res.json({
    message: "Dating App API is running",
  });
});

app.use(metricsMiddleware);

app.use("/api/profiles", profilesRouter);
app.use("/api/swipes", swipesRouter);
app.use("/api/users", usersRouter);
app.use("/api/users", photosRouter);
app.use("/api/preferences", preferencesRouter);
app.use("/api/matches", matchesRouter);
app.use("/api/chat", chatRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/discovery-groups", discoveryGroupsRouter);
app.use("/auth", authRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

const metricsApp = express();
metricsApp.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
metricsApp.listen(9464, () => console.log("Metrics at http://localhost:9464/metrics"))
