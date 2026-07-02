import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wrap an async route handler so a rejected promise reaches the error handler
 * instead of crashing the process. (Express 4 does not auto-catch async errors.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
