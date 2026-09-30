import { z } from 'zod';

/**
 * Environment variables, validated once at start-up. The app refuses to start when a
 * required variable is missing or malformed, and lists every problem at once.
 *
 * Service keys (Clerk, Cloudinary, Resend) and JOB_SECRET are required everywhere except
 * NODE_ENV=test, where the test suites stand in for those services.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB_NAME: z.string().min(1).default('blacklink'),

  // Only this origin may call the API from a browser.
  CLIENT_URL: z.string().url(),
  // Where the API itself is reachable publicly (used in email one-click unsubscribe links).
  API_PUBLIC_URL: z.string().url().optional(),

  // Global limit: requests per IP per window.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // Clerk (Phase 2). Checked below: required unless NODE_ENV=test.
  CLERK_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_/, 'must start with pk_test_ or pk_live_').optional(),
  CLERK_SECRET_KEY: z.string().regex(/^sk_(test|live)_/, 'must start with sk_test_ or sk_live_').optional(),
  CLERK_WEBHOOK_SECRET: z.string().regex(/^whsec_/, 'must start with whsec_').optional(),
  // Phase 5+: Cloudinary.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // Phase 6+: Resend and scheduled jobs.
  RESEND_API_KEY: z.string().regex(/^re_/, 'must start with re_').optional(),
  EMAIL_FROM: z.string().optional(),
  JOB_SECRET: z.string().min(32).optional(),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === 'test') return;
  const required = {
    CLERK_PUBLISHABLE_KEY: 'Clerk dashboard',
    CLERK_SECRET_KEY: 'Clerk dashboard',
    CLERK_WEBHOOK_SECRET: 'Clerk dashboard',
    CLOUDINARY_CLOUD_NAME: 'Cloudinary console',
    CLOUDINARY_API_KEY: 'Cloudinary console',
    CLOUDINARY_API_SECRET: 'Cloudinary console',
    RESEND_API_KEY: 'Resend dashboard',
    EMAIL_FROM: 'an address on a domain verified in Resend',
    JOB_SECRET: 'at least 32 random characters',
  };
  for (const [key, where] of Object.entries(required)) {
    if (!v[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Required (${where})` });
  }
  // Live keys belong in production only, so a laptop can never write to the real user base.
  if (v.NODE_ENV !== 'production' && v.CLERK_SECRET_KEY?.startsWith('sk_live_')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLERK_SECRET_KEY'], message: 'Use a test key outside production' });
  }
});

function load() {
  // Empty values ("KEY=" in .env) count as unset, so optional keys can stay blank.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Logger isn't configured yet (it depends on env), so write straight to stderr.
    process.stderr.write(`Invalid environment configuration:\n${problems}\nSee server/.env.example.\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
