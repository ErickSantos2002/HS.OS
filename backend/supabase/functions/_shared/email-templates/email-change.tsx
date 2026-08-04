/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme a alteração de email — dn.os dn.ia</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>dn.os</Text>
        <Text style={brand}>dn.ia</Text>
        <Heading style={h1}>Confirme a alteração de email</Heading>
        <Text style={text}>
          Você solicitou a alteração do seu email no{' '}
          <strong>dn.os da dn.ia</strong> de{' '}
          <Link href={`mailto:${email}`} style={link}>{email}</Link>{' '}
          para{' '}
          <Link href={`mailto:${newEmail}`} style={link}>{newEmail}</Link>.
        </Text>
        <Text style={text}>
          <Link href={confirmationUrl} style={link}>Clique aqui para confirmar a alteração</Link>.
        </Text>
        <Text style={footerText}>
          Se você não solicitou esta alteração, proteja sua conta imediatamente.
        </Text>
        <Text style={footerBrand}>
          <Link href="https://missioncontroldnia.lovable.app" style={footerLink}>
            dn.ia · dn.os
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

const main = { backgroundColor: '#0a0a0a', fontFamily: "'Inter', 'Rajdhani', Arial, sans-serif" }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const logo = { fontSize: '20px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0', letterSpacing: '0.5px' }
const brand = { fontSize: '13px', color: '#3D61FF', margin: '0 0 32px', fontWeight: '600' as const }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#a3a3a3', lineHeight: '1.6', margin: '0 0 20px' }
const link = { color: '#3D61FF', textDecoration: 'underline' }
const footerText = { fontSize: '13px', color: '#666666', margin: '0 0 24px', lineHeight: '1.5' }
const footerBrand = { fontSize: '12px', color: '#444444', margin: '0', borderTop: '1px solid #1a1a1a', paddingTop: '20px' }
const footerLink = { color: '#444444', textDecoration: 'none' }
