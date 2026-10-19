// Bundles the relay into one file. The server imports the shared wire-format code from packages/protocol (TypeScript
// source in the workspace), so it is bundled rather than compiled file by file. NestJS needs decorators but not
// emitted metadata: every injection uses an explicit token.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  // Nest loads optional packages lazily; leave what it probes for out of the bundle.
  external: ['@nestjs/microservices', '@nestjs/websockets', '@nestjs/websockets/*', '@nestjs/microservices/*', 'class-transformer', 'class-validator', 'pg-native', 'cpu-features', '@nestjs/platform-express', '@fastify/static', '@fastify/view', '@fastify/multipart'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
