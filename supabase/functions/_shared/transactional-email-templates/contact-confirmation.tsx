import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { name?: string }

const ContactConfirmation = ({ name }: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Merci pour votre message — Microbalade</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `Merci ${name} !` : 'Merci pour votre message !'}
        </Heading>
        <Text style={text}>
          Nous avons bien reçu votre demande et reviendrons vers vous sous 48h.
        </Text>
        <Text style={text}>
          À très vite,<br />L'équipe Microbalade
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactConfirmation,
  subject: 'Merci pour votre message — Microbalade',
  displayName: 'Confirmation contact',
  previewData: { name: 'Jean' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#111', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
