import { z } from "zod";

export const feedbackCategories = { bug: "Bug", feature: "Feature Idea", other: "Other" } as const;
export type FeedbackCategory = keyof typeof feedbackCategories;
export const feedbackMessageLimit = 3000;

export const feedbackSchema = z.strictObject({
  category: z.enum(["bug", "feature", "other"]),
  message: z.string().trim().min(10, "Please include at least 10 characters.").max(feedbackMessageLimit),
  // Pathname only: query strings can contain authentication links or other secrets.
  pathname: z.string().min(1).max(1024).regex(/^\/(?!\/)[^?#\s\u0000-\u001f\\]*$/),
  metadata: z.strictObject({
    userAgent: z.string().max(1024).optional(),
    viewport: z.strictObject({
      width: z.number().int().min(1).max(20000),
      height: z.number().int().min(1).max(20000),
    }).optional(),
  }).optional(),
});

export type FeedbackPayload = z.infer<typeof feedbackSchema>;
