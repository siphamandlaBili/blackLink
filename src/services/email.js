import { render } from '@react-email/render';
import { Resend } from 'resend';
import { env, isTest } from '../config/env.js';
import { emailElement, TEMPLATES } from '../emails/templates.js';
import { unsubscribeToken } from './unsubscribe.js';

/*
 * Email delivery through Resend. Templates live in src/emails. Callers go through
 * services/notifications.js, which decides whether an email should be sent at all.
 *
 * NODE_ENV=test: nothing leaves the machine. Messages are recorded in `testOutbox`, and
 * `failNextSends(n)` makes the next n sends fail, to exercise the retry path.
 */
const resend = !isTest && env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const API_URL = env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;

export const testOutbox = [];
let failures = 0;
export const failNextSends = (n) => {
  failures = n;
};

/** Addresses that must never receive mail: seeded demo accounts and placeholder emails. */
export const isSendable = (email) => Boolean(email) && !/@(seed\.blacklink\.test|[^@]*\.invalid)$/i.test(email);

/**
 * Renders a template with the standard links (settings, one-click unsubscribe).
 * @param {string} template  Key of TEMPLATES.
 * @param {Object} props     Template props, plus firstName.
 * @param {{ userId: string, pref: string }} who  For the unsubscribe link.
 */
export async function renderEmail(template, props, { userId, pref }) {
  const token = unsubscribeToken(userId, pref);
  const full = {
    ...props,
    // Served by the API itself (routes/notifications.js), so it works without the web app.
    unsubscribeUrl: `${API_URL}/api/unsubscribe?token=${token}`,
    preferencesUrl: `${env.CLIENT_URL}/settings/notifications`,
    exploreUrl: props.exploreUrl ?? `${env.CLIENT_URL}/explore`,
    guidelinesUrl: `${env.CLIENT_URL}/review-guidelines`,
  };
  const element = emailElement(template, full);
  return {
    subject: TEMPLATES[template].subject(full),
    html: await render(element),
    text: await render(element, { plainText: true }),
    // RFC 8058 one-click unsubscribe: mail apps show an "Unsubscribe" button that POSTs here.
    headers: {
      'List-Unsubscribe': `<${API_URL}/api/unsubscribe?token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** Sends one rendered email. Throws on failure; the caller decides about retries. */
export async function sendEmail({ to, subject, html, text, headers }) {
  if (isTest) {
    if (failures > 0) {
      failures -= 1;
      throw new Error('Simulated send failure');
    }
    testOutbox.push({ to, subject, html, text, headers });
    return { id: `test-${testOutbox.length}` };
  }
  if (!resend || !env.EMAIL_FROM) throw new Error('Email is not configured (RESEND_API_KEY, EMAIL_FROM)');
  const { data, error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html, text, headers });
  if (error) throw new Error(`${error.name}: ${error.message}`);
  return { id: data.id };
}
