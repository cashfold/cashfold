import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Three places name a Node version: the minimum the project supports (`engines`), the version development and CI use (.nvmrc), and the version
// the relay image runs (deploy/Dockerfile.server). The image should be no older than the minimum, or it breaks the promise `engines` makes,
// and no newer than CI, or production would run a Node that no test has ever seen. Which version the image uses is a choice for the
// maintainer; this only stops the three from drifting apart by accident.

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const major = (text: string): number => Number(/(\d+)/.exec(text)![1]);

const minimum = major((JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node);
const development = major(read('.nvmrc'));
const images = [...read('deploy/Dockerfile.server').matchAll(/^FROM node:(\S+)/gm)].map((m) => major(m[1]!));

describe('Node versions', () => {
  it('the image builds and runs on the same major', () => {
    expect(images.length).toBeGreaterThan(0);
    expect(new Set(images).size).toBe(1);
  });

  it('the image is not older than the minimum the project supports', () => {
    expect(images[0]).toBeGreaterThanOrEqual(minimum);
  });

  it('the image is not newer than the version CI tests', () => {
    expect(images[0]).toBeLessThanOrEqual(development);
  });

  it('development is not older than the minimum', () => {
    expect(development).toBeGreaterThanOrEqual(minimum);
  });
});
