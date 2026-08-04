/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme seu email — dn.os dn.ia</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>dn.os</Text>
        <Text style={brand}>dn.ia</Text>
        <Heading style={h1}>Confirme seu email</Heading>
        <Text style={text}>
          Obrigado por se cadastrar no{' '}
          <strong>dn.os da dn.ia</strong>!
        </Text>
        <Text style={text}>
          Confirme seu endereço de email ({recipient}) clicando no botão abaixo:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verificar email
        </Button>
        <Text style={footerText}>
          Se você não criou uma conta, pode ignorar este email com segurança.
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

export default SignupEmail

const main = { backgroundColor: '#0a0a0a', fontFamily: "'Inter', 'Rajdhani', Arial, sans-serif" }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const logo = { fontSize: '20px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0', letterSpacing: '0.5px' }
const brand = { fontSize: '13px', color: '#3D61FF', margin: '0 0 32px', fontWeight: '600' as const }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#fafafa', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#a3a3a3', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: '#3D61FF', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, borderRadius: '6px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' as const, margin: '8px 0 32px' }
const footerText = { fontSize: '13px', color: '#666666', margin: '0 0 24px', lineHeight: '1.5' }
const footerBrand = { fontSize: '12px', color: '#444444', margin: '0', borderTop: '1px solid #1a1a1a', paddingTop: '20px' }
const footerLink = { color: '#444444', textDecoration: 'none' }
