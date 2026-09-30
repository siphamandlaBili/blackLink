import React from 'react';
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components';

/*
 * Shared email layout. Email clients don't support CSS variables or dark themes well, so
 * colours are literal here: a light, flat page with one gold accent. No gradients, no
 * borders, no images required (it reads fine with images off), and a narrow column that
 * works on phones.
 */
export const theme = {
  page: '#F5F5F4',
  card: '#FFFFFF',
  ink: '#18181B',
  muted: '#52525B',
  gold: '#F5B301',
  onGold: '#0A0A0B',
  soft: '#F4F4F5',
  font: 'Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
};
export const h = React.createElement;

const styles = {
  body: { backgroundColor: theme.page, fontFamily: theme.font, margin: 0, padding: '24px 0' },
  container: { maxWidth: '560px', margin: '0 auto', padding: '0 16px' },
  brand: { fontSize: '18px', fontWeight: 700, color: theme.ink, margin: '0 0 16px' },
  gold: { color: theme.gold },
  card: { backgroundColor: theme.card, borderRadius: '12px', padding: '28px 24px' },
  footer: { fontSize: '12px', lineHeight: '18px', color: theme.muted, margin: '20px 0 0', textAlign: 'center' },
  footerLink: { color: theme.muted, textDecoration: 'underline' },
};

/**
 * @param {{ preview: string, unsubscribeUrl?: string, preferencesUrl: string, children: React.ReactNode }} props
 */
export function Layout({ preview, unsubscribeUrl, preferencesUrl, children }) {
  return h(
    Html,
    { lang: 'en' },
    h(Head, null),
    h(Preview, null, preview),
    h(
      Body,
      { style: styles.body },
      h(
        Container,
        { style: styles.container },
        h(Text, { style: styles.brand }, 'Black ', h('span', { style: styles.gold }, 'Link')),
        h(Section, { style: styles.card }, children),
        h(
          Text,
          { style: styles.footer },
          'Black Link · Soweto’s business hub. ',
          unsubscribeUrl ? h(Link, { href: unsubscribeUrl, style: styles.footerLink }, 'Unsubscribe from these emails') : null,
          unsubscribeUrl ? ' · ' : null,
          h(Link, { href: preferencesUrl, style: styles.footerLink }, 'Email settings'),
        ),
      ),
    ),
  );
}
