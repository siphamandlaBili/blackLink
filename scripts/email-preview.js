// Renders every email template to HTML files you can open in a browser, with sample data.
// Nothing is sent.   npm run email:preview   → server/.email-previews/*.html
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderEmail } from '../src/services/email.js';

const OUT = new URL('../.email-previews/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const app = 'http://localhost:5173';
const soon = new Date(Date.now() + 20 * 3600000);
const samples = {
  welcome: {},
  business_published: { businessName: 'Gogo Catering', businessUrl: `${app}/business/gogo-catering` },
  new_review: { businessName: 'Gogo Catering', reviewerName: 'Thabo M.', rating: 5, excerpt: 'Catered our family day and everyone asked who made the food. On time, friendly and fair prices.', reviewUrl: `${app}/business/gogo-catering#reviews` },
  owner_reply: { businessName: 'Gogo Catering', replyText: 'Siyabonga Thabo! It was a pleasure feeding your family. See you in December.', reviewUrl: `${app}/business/gogo-catering#reviews` },
  report_outcome: { outcome: 'removed' },
  event_reminder: { eventTitle: 'Vilakazi Street Makers Market', startsAt: soon, venue: 'Vilakazi Street, near the Mandela House', priceCents: 0, eventUrl: `${app}/events/vilakazi-makers-market` },
  weekly_digest: {
    newBusinesses: [{ name: 'Glen Grill House', detail: 'protea glen', url: `${app}/business/glen-grill-house` }, { name: 'Emdeni Shuffle Dance School', detail: 'emdeni', url: `${app}/business/emdeni-shuffle-dance-school` }],
    events: [{ title: 'Vilakazi Street Makers Market', startsAt: soon, venue: 'Vilakazi Street', url: `${app}/events/vilakazi-makers-market` }],
    trending: [{ name: 'Sakhumzi Corner Grill', detail: '★ 4.7 (38)', url: `${app}/business/sakhumzi-corner-grill` }],
  },
};

for (const [name, props] of Object.entries(samples)) {
  const { subject, html } = await renderEmail(name, { firstName: 'Thandeka', ...props }, { userId: '64b000000000000000000001', pref: 'product' });
  writeFileSync(new URL(`${name}.html`, OUT), html);
  process.stdout.write(`${name.padEnd(20)} ${subject}\n`);
}
process.stdout.write(`\nOpen server/.email-previews/*.html in a browser.\n`);
