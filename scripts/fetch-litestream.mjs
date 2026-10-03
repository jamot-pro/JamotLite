// Fetches the pinned Litestream release for the Docker image and refuses it
// unless its SHA-256 matches the release's published checksums (RUNTIME D43).
// Usage: node scripts/fetch-litestream.mjs <amd64|arm64> <out dir>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.5.17";
const BUILDS = {
	amd64: {
		file: `litestream-${VERSION}-linux-x86_64.tar.gz`,
		sha256: "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d",
	},
	arm64: {
		file: `litestream-${VERSION}-linux-arm64.tar.gz`,
		sha256: "f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5",
	},
};

const [arch = "amd64", out = "/litestream"] = process.argv.slice(2);
const build = BUILDS[arch];
if (!build) throw new Error(`no Litestream build pinned for ${arch}`);
const url = `https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/${build.file}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== build.sha256)
	throw new Error(`${build.file}: sha256 ${sha}, expected ${build.sha256}`);
mkdirSync(out, { recursive: true });
const tarball = join(out, build.file);
writeFileSync(tarball, bytes);
execFileSync("tar", ["-xzf", tarball, "-C", out, "litestream"]);
console.log(`litestream ${VERSION} (${arch}) verified and unpacked in ${out}`);
