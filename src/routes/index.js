import healthRoutes from "./healthRoutes.js";
import analyzeRoutes from "./analyzeRoutes.js";
import preBidQueryRoutes from "./preBidQueryRoutes.js";

export function registerRoutes(app) {
  app.use("/health", healthRoutes);
  app.use("/", analyzeRoutes);
  app.use("/pre-bid-queries", preBidQueryRoutes);
}

