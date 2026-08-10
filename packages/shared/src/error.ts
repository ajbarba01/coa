import { z } from 'zod';

/** The house error shape the core throws. */
export const coaErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type CoaError = z.infer<typeof coaErrorSchema>;
