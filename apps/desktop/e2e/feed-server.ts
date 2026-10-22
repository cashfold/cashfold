import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error a plain script module without types
import { generateUpdateKeyPair, signUpdate } from '../../../scripts/lib/update-signature.mjs';

// A stand-in for the release page, for the update tests: the feed file for this platform, the installer, and the signature next to it, served
// from this machine. What it serves can be spoiled in each of the ways an update can be wrong.

export type SignatureMode = 'good' | 'missing' | 'altered' | 'stranger' | 'other-file';

export interface FeedOptions {
  version?: string;
  signature?: SignatureMode;
  /** Serve different bytes than the feed's hash describes (a corrupted download). */
  corruptInstaller?: boolean;
}

/** The feed file name and installer name the updater looks for on this platform. */
export function feedNames(version: string): { feedFile: string; installer: string } {
  if (process.platform === 'darwin') return { feedFile: 'latest-mac.yml', installer: `Cashfold-${version}-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip` };
  if (process.platform === 'win32') return { feedFile: 'latest.yml', installer: `Cashfold-${version}-win-x64.exe` };
  return { feedFile: 'latest-linux.yml', installer: `Cashfold-${version}-linux-x64.AppImage` };
}

export class FeedServer {
  readonly requests: string[] = [];
  options: Required<FeedOptions>;
  trustedKey = '';
  private strangerKey = '';
  private signingKey = '';
  private server: Server | undefined;
  private port = 0;

  constructor(options: FeedOptions = {}) {
    this.options = { version: '1.3.0', signature: 'good', corruptInstaller: false, ...options };
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(port = 0): Promise<void> {
    const pair = (await generateUpdateKeyPair()) as { privateKey: string; publicKey: string };
    const stranger = (await generateUpdateKeyPair()) as { privateKey: string; publicKey: string };
    this.trustedKey = pair.publicKey;
    this.signingKey = pair.privateKey;
    this.strangerKey = stranger.privateKey;
    this.server = createServer((request, response) => void this.handle(request.url ?? '/', (status, body, type) => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(body);
    }));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server?.closeAllConnections();
    this.server = undefined;
  }

  /** Requests for the installer or its signature, i.e. everything past looking at the feed. */
  get downloads(): string[] {
    return this.requests.filter((r) => !/latest.*\.yml$/.test(r));
  }

  private installerBytes(corrupt: boolean): Buffer {
    return Buffer.alloc(200_000, corrupt ? 9 : 4);
  }

  private async handle(rawPath: string, reply: (status: number, body: Buffer | string, type: string) => void): Promise<void> {
    const path = rawPath.split('?')[0] ?? rawPath; // the updater adds a cache-busting query
    this.requests.push(path);
    const { version, signature, corruptInstaller } = this.options;
    const { feedFile, installer } = feedNames(version);
    const sha512 = createHash('sha512').update(this.installerBytes(false)).digest('base64');
    if (path === `/${feedFile}`) {
      const yaml = `version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${sha512}\n    size: 200000\npath: ${installer}\nsha512: ${sha512}\nreleaseDate: '2026-10-22T00:00:00.000Z'\n`;
      return reply(200, yaml, 'text/yaml');
    }
    if (path === `/${installer}`) return reply(200, this.installerBytes(corruptInstaller), 'application/octet-stream');
    if (path === `/v${version}/${installer}.sig`) {
      if (signature === 'missing') return reply(404, 'not found', 'text/plain');
      const key = signature === 'stranger' ? this.strangerKey : this.signingKey;
      const name = signature === 'other-file' ? `Cashfold-${version}-other.bin` : installer;
      let text = (await signUpdate(key, name, sha512)) as string;
      if (signature === 'altered') text = `${text.slice(0, 4)}${text[4] === 'A' ? 'B' : 'A'}${text.slice(5)}`;
      return reply(200, text, 'text/plain');
    }
    return reply(404, 'not found', 'text/plain');
  }
}
