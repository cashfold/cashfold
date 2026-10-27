import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The logos and icons (assets/README.md): the files the build and the pages depend on exist, are the size they are used at, and the manifest
// names only files that are there. A real logo replaces the placeholder with `pnpm gen:assets`; this fails when something is left out or the
// wrong size, before an installer or a favicon ships with a broken or blurry image.

const at = (...parts: string[]) => join(process.cwd(), ...parts);

/** Width and height from the header of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1"), `${path} is a PNG`).toBe(
    "PNG",
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the master mark", () => {
  it("is a square SVG", () => {
    const svg = readFileSync(at("assets/logo/mark.svg"), "utf8");
    expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);
  });

  it("has a logo for light and for dark pages", () => {
    for (const file of ["logo-light.svg", "logo-dark.svg"])
      expect(existsSync(at("assets/logo", file)), file).toBe(true);
  });
});

describe("the desktop app icon", () => {
  it("is a square PNG of at least 512 pixels, from which electron-builder makes the .ico and the .icns", () => {
    const { width, height } = pngSize(at("apps/desktop/build/icon.png"));
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
  });
});

describe("the desktop tray and taskbar images", () => {
  it("has the macOS template images at 1x and 2x, and the coloured tray image for the other systems", () => {
    expect(pngSize(at("apps/desktop/build/tray/trayTemplate.png"))).toEqual({
      width: 16,
      height: 16,
    });
    expect(pngSize(at("apps/desktop/build/tray/trayTemplate@2x.png"))).toEqual({
      width: 32,
      height: 32,
    });
  });

  it.each([
    ["tray.png", 16],
    ["tray@1.25x.png", 20],
    ["tray@1.5x.png", 24],
    ["tray@2x.png", 32],
    ["tray@3x.png", 48],
  ])(
    "has the coloured tray image %s at %d pixels, one for each display scale",
    (name, size) => {
      expect(pngSize(at("apps/desktop/build/tray", name))).toEqual({
        width: size,
        height: size,
      });
    },
  );

  it.each(["1", "2", "3", "4", "5", "6", "7", "8", "9", "9plus"])(
    "has the 32 pixel taskbar overlay %s",
    (name) => {
      expect(pngSize(at("apps/desktop/build/badges", `${name}.png`))).toEqual({
        width: 32,
        height: 32,
      });
    },
  );

  it("is packaged with the app, because the shell reads them from inside it", async () => {
    const builder = (
      await import(at("apps/desktop/electron-builder.config.mjs"))
    ).default as { files: string[] };
    expect(builder.files).toEqual(
      expect.arrayContaining(["build/badges/**", "build/tray/**"]),
    );
  });
});

describe("the web app icons", () => {
  const sizes: Array<[string, number]> = [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
  ];

  it.each(sizes)("%s is %d pixels square", (file, size) => {
    expect(pngSize(at("apps/web/public", file))).toEqual({
      width: size,
      height: size,
    });
  });

  it("has a favicon.ico that holds at least one image", () => {
    const ico = readFileSync(at("apps/web/public/favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });

  it("has a manifest whose icons all exist at the size they say", () => {
    const manifest = JSON.parse(
      readFileSync(at("apps/web/public/manifest.webmanifest"), "utf8"),
    ) as {
      name: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };
    expect(manifest.name).toBe("Cashfold");
    for (const icon of manifest.icons) {
      const file = at("apps/web/public", icon.src.replace(/^\//, ""));
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === "image/png") {
        const [width, height] = icon.sizes.split("x").map(Number);
        expect(pngSize(file), icon.src).toEqual({ width, height });
      }
    }
  });
});

describe("the images used outside the app", () => {
  it("has a social preview of 1280 x 640 (GitHub shows it when the repository is shared)", () => {
    expect(pngSize(at("assets/social/social-preview.png"))).toEqual({
      width: 1280,
      height: 640,
    });
  });

  it("has the screenshots as PNG files", () => {
    for (const file of [
      "01-overview.png",
      "02-transactions.png",
      "03-budgets.png",
      "04-desktop.png",
    ]) {
      expect(
        pngSize(at("assets/screenshots", file)).width,
        file,
      ).toBeGreaterThanOrEqual(800);
    }
  });
});
