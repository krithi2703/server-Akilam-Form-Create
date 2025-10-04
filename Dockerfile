FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
RUN npm install sharp
COPY . .
EXPOSE 8500
CMD ["npm", "start"]
