import { defineConfig } from 'vitest/config';

// Testes do servidor (Node/CommonJS). Escopado a server/ para não varrer o
// client/ (que tem seu próprio toolchain e node_modules com *.test.js).
export default defineConfig({
  test: {
    include: ['server/**/*.test.js'],
    environment: 'node',
    // Não escrever arquivo de log durante os testes.
    env: { LOG_TO_FILE: '0' },
  },
});
