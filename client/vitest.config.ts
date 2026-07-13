import { defineConfig } from 'vitest/config';

// Testes do client. Ambiente jsdom para código que depende do DOM (ex.: o conversor
// HTML↔markdown das notas do Nextcloud usa DOMParser + DOMPurify). Optamos por jsdom
// em vez de happy-dom porque o DOMPurify remove tags de bloco (h1/ul/blockquote) sob
// happy-dom — comportamento que diverge do browser real; com jsdom bate.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
