import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Tender Gap Analyzer API is running",
  });
});

export default router;

