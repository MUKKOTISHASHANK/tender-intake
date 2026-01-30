import healthRoutes from "./healthRoutes.js";
import analyzeRoutes from "./analyzeRoutes.js";

export function registerRoutes(app) {
  app.use("/health", healthRoutes);
  app.use("/", analyzeRoutes);
}

