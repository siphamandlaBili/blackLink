import { Button, Heading, Section, Text } from '@react-email/components';
import { h, theme } from './Layout.js';

/* Small building blocks shared by the templates. */

export const Title = ({ children }) => h(Heading, { as: 'h1', style: { fontSize: '22px', lineHeight: '28px', fontWeight: 600, color: theme.ink, margin: '0 0 12px' } }, children);

export const P = ({ children, muted }) => h(Text, { style: { fontSize: '15px', lineHeight: '23px', color: muted ? theme.muted : theme.ink, margin: '0 0 14px' } }, children);

/** Primary action: solid gold with near-black text. */
export const CTA = ({ href, children }) =>
  h(
    Section,
    { style: { margin: '20px 0 4px' } },
    h(Button, { href, style: { backgroundColor: theme.gold, color: theme.onGold, fontSize: '15px', fontWeight: 600, padding: '12px 20px', borderRadius: '8px', textDecoration: 'none' } }, children),
  );

/** A quoted block (review text, reply) on a soft background. */
export const Quote = ({ children }) =>
  h(Section, { style: { backgroundColor: theme.soft, borderRadius: '8px', padding: '14px 16px', margin: '4px 0 16px' } }, h(Text, { style: { fontSize: '15px', lineHeight: '22px', color: theme.ink, margin: 0 } }, children));

export const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** A short list item: bold name, muted detail, optional link. */
export const Item = ({ name, detail, href }) =>
  h(
    Section,
    { style: { margin: '0 0 12px' } },
    h(Text, { style: { fontSize: '15px', lineHeight: '21px', fontWeight: 600, color: theme.ink, margin: 0 } }, href ? h('a', { href, style: { color: theme.ink, textDecoration: 'none' } }, name) : name),
    detail ? h(Text, { style: { fontSize: '13px', lineHeight: '19px', color: theme.muted, margin: 0 } }, detail) : null,
  );
