import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  role?: string
  organization?: string
  email?: string
  phone?: string
  message?: string
}

const ContactNotification = ({ name, role, organization, email, phone, message }: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Nouveau message depuis le formulaire Microbalade</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Nouveau message Microbalade</Heading>
        <Section style={card}>
          <Text style={label}>Nom</Text>
          <Text style={value}>{name || '—'}</Text>
          <Text style={label}>Fonction</Text>
          <Text style={value}>{role || '—'}</Text>
          <Text style={label}>Organisation</Text>
          <Text style={value}>{organization || '—'}</Text>
          <Text style={label}>Email</Text>
          <Text style={value}>{email || '—'}</Text>
          <Text style={label}>Téléphone</Text>
          <Text style={value}>{phone || '—'}</Text>
          <Hr style={hr} />
          <Text style={label}>Message</Text>
          <Text style={messageStyle}>{message || '—'}</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactNotification,
  subject: (d: Record<string, any>) => `Contact Microbalade — ${d.organization || d.name || 'Nouveau message'}`,
  displayName: 'Notification formulaire contact',
  previewData: {
    name: 'Jean Dupont', role: 'Maire', organization: 'Commune de Saint-Omer',
    email: 'jean@example.com', phone: '0612345678', message: 'Bonjour, nous souhaitons en savoir plus.',
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
