export interface ServerConfig {
  readonly port: number;
  readonly databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return { port: Number(env['PORT'] ?? 8080), databaseUrl };
}
