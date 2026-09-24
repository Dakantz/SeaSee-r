import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  client: '@hey-api/client-fetch',
  input: process.env.OPENAPI_INPUT || 'http://localhost:8000/openapi.json',
  output: 'src/client',
});
