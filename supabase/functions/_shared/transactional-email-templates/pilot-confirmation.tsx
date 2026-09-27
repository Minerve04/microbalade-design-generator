import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { name?: string; commune?: string }

const PilotConfirmation = ({ name, commune }: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Votre demande de pilote gratuit Microbalade</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `Merci ${name} !` : 'Merci pour votre demande !'}</Heading>
        <Text style={text}>
          Nous avons bien reçu votre demande de pilote gratuit de 3 mois{commune ? ` pour ${commune}` : ''}.
          Nous revenons vers vous sous 48 h.
        </Text>
        <Text style={text}>À très vite,<br />L'équipe Microbalade</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PilotConfirmation,
  subject: 'Votre demande de pilote gratuit — Microbalade',
  displayName: 'Confirmation demande de pilote',
  previewData: { name: 'Jean', commune: 'Arques' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#111', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
