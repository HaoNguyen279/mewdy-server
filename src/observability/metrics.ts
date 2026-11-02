import * as client from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const register = new client.Registry();


client.collectDefaultMetrics({ register });


const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Thoi gian xu ly HTTP request",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});


export const swipesTotal = new client.Counter({
  name: "dating_swipes_total",
  help: "So luot swipe",
  labelNames: ["direction"],
  registers: [register],
});

export const matchesTotal = new client.Counter({
  name: "dating_matches_total",
  help: "So match duoc tao",
  registers: [register],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
   
    const route = req.route?.path ? req.baseUrl + req.route.path : "unmatched";
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}