/**
 * Validates req.body, req.query and req.params against zod schemas and replaces them
 * with the parsed, coerced values. Schemas should use .strict(),
 * so unknown keys, including Mongo operators like "$gt", are rejected.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) {
      // Express 4 exposes req.query via a getter; store the parsed copy separately.
      req.validatedQuery = schemas.query.parse(req.query);
    }
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  } catch (err) {
    next(err);
  }
};
