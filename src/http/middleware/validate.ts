import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

/**
 * Validate req.body against a zod schema, replacing it with the parsed value.
 * A ZodError propagates to the error handler as a clean 400.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body) as z.infer<S>;
    next();
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Express 5's req.query is a getter; stash the parsed value for handlers.
    res_locals_set(req, schema.parse(req.query));
    next();
  };
}

function res_locals_set(req: Request, value: unknown) {
  (req as Request & { validatedQuery?: unknown }).validatedQuery = value;
}
