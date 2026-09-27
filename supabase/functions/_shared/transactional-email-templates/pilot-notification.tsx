import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  commune_nom?: string
  code_postal?: string
  population?: number | string
  contact_nom?: string
  fonction?: string
  email?: string
  telephone?: string
  message?: string
}

const PilotNotification = (p: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Nouvelle demande de pilote gratuit Microbalade</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Demande de pilote gratuit (3 mois)</Heading>
        <Section style={card}>
          <Text style={label}>Commune</Text>
          <Text style={value}>{p.commune_nom || '—'} {p.code_postal ? `(${p.code_postal})` : ''}</Text>
          <Text style={label}>Population</Text>
          <Text style={value}>{p.population ? `${p.population} hab.` : '—'}</Text>
          <Text style={label}>Contact</Text>
          <Text style={value}>{p.contact_nom || '—'}</Text>
          <Text style={label}>Fonction</Text>
          <Text style={value}>{p.fonction || '—'}</Text>
          <Text style={label}>Email</Text>
          <Text style={value}>{p.email || '—'}</Text>
          <Text style={label}>Téléphone</Text>
          <Text style={value}>{p.telephone || '—'}</Text>
          <Hr style={hr} />
          <Text style={label}>Message</Text>
          <Text style={messageStyle}>{p.message || '—'}</Text>
        </Section>
        <Text style={{ fontSize: '14px', margin: '20px 0 0' }}>
          <Link href="https://microbalade.fr/admin/communes" style={{ color: '#E8622A', fontWeight: 'bold' }}>
            Ouvrir l'administration (onglet Pilotes)
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PilotNotification,
  subject: (d: Record<string, any>) => `Pilote gratuit — ${d.commune_nom || 'Nouvelle demande'}`,
  displayName: 'Notification demande de pilote',
  previewData: {
    commune_nom: 'Arques', code_postal: '62510', population: 9800, contact_nom: 'Jean Dupont',
    fonction: 'DGS', email: 'jean@example.com', telephone: '0612345678', message: 'Intéressés par un test.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#111111', margin: '0 0 20px' }
const card = { backgroundColor: '#f8f8f8', borderRadius: '12px', padding: '20px' }
const label = { fontSize: '11px', textTransform: 'uppercase' as const, color: '#888', margin: '12px 0 2px', letterSpacing: '0.05em' }
const value = { fontSize: '14px', color: '#111', margin: '0' }
const messageStyle = { fontSize: '14px', color: '#333', lineHeight: '1.5', margin: '4px 0 0', whiteSpace: 'pre-wrap' as const }
const hr = { borderColor: '#e5e5e5', margin: '16px 0' }
