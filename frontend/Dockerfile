# Frontend HS.OS — React + Vite, servido por nginx
# Deploy: EasyPanel, domínio hsos.healthsafetytech.com
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* bun.lockb* ./
RUN npm install

COPY . .

# A API vive em OUTRO domínio (hsosapi.healthsafetytech.com), então esta URL é
# absoluta e o navegador faz chamada cross-origin — quem autoriza é o CORS do
# backend, via FRONTEND_URL. Em dev o valor é /api, que o proxy do Vite resolve.
#
# Vite embute variáveis VITE_* no bundle em tempo de BUILD, não de execução:
# mudar a URL da API exige rebuild da imagem, não basta trocar a env do serviço.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
