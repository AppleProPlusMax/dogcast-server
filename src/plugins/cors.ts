import cors from '@fastify/cors';
import fp from 'fastify-plugin';

export default fp(async (app) => {
  await app.register(cors, {
    origin: app.config.CORS_ORIGINS.length > 0 ? app.config.CORS_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
});
