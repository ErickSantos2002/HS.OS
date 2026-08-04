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

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu código de verificação — dn.os dn.ia</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>dn.os</Text>
        <Text style={brand}>dn.ia</Text>
        <Heading style={h1}>Código de verificação</Heading>
        <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footerText}>
          Este código expira em breve. Se você não solicitou, pode ignorar este
          email com segurança.
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

export default ReauthenticationEmail

const main = { backgroundColor: '#0a0a0a', fontFamily: "'Inter', 'Rajdhani', Arial, sans-serif" }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const logo = { fontSize: '20px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0', letterSpacing: '0.5px' }
const brand = { fontSize: '13px', color: '#3D61FF', margin: '0 0 32px', fontWeight: '600' as const }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#a3a3a3', lineHeight: '1.6', margin: '0 0 20px' }
const codeStyle = { fontFamily: "'JetBrains Mono', Courier, monospace", fontSize: '28px', fontWeight: 'bold' as const, color: '#3D61FF', margin: '0 0 32px', letterSpacing: '4px' }
const footerText = { fontSize: '13px', color: '#666666', margin: '0 0 24px', lineHeight: '1.5' }
const footerBrand = { fontSize: '12px', color: '#444444', margin: '0', borderTop: '1px solid #1a1a1a', paddingTop: '20px' }
const footerLink = { color: '#444444', textDecoration: 'none' }
