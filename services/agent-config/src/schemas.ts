import { z } from "zod";

export const agentConfigSchema = z.object({
  sources: z.array(z.string()).min(1),
  categories: z.array(z.string()).min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  currency: z.string().default("USD"),
  region: z.string().optional(),
  useBrowser: z.coerce.boolean().optional(),
  preferences: z.object({
    minOrderSize: z.coerce.number().int().nonnegative(),
    maxOrderSize: z.coerce.number().int().nonnegative(),
  }),
});

export const createAgentSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(2),
  config: agentConfigSchema,
  active: z.boolean().optional().default(true),
});

export const updateAgentSchema = createAgentSchema.partial().extend({
  id: z.string().min(3),
});
